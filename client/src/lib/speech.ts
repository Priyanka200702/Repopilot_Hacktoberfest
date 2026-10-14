/**
 * Thin, defensive wrappers around the browser's Web Speech APIs.
 *
 * - Listening uses SpeechRecognition (Chrome, Edge, Safari). Unsupported
 *   browsers fall back to typing in the voice panel.
 * - Speaking uses speechSynthesis, one utterance per sentence (avoids Chrome's
 *   habit of cutting long utterances) with sentence and word progress events
 *   for live captions. If no voice is available, captions still advance on a
 *   timer, so the guided tour never stalls.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type VoiceLang = 'en' | 'hi'
export const LANG_CODES: Record<VoiceLang, string> = { en: 'en-IN', hi: 'hi-IN' }

// ---------------------------------------------------------------- listening

export function recognitionSupported(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
}

export interface Recognizer {
  stop: () => void
  abort: () => void
}

export function startRecognition(opts: {
  lang: VoiceLang
  onInterim: (text: string) => void
  onFinal: (text: string) => void
  onError: (message: string) => void
  onEnd: () => void
}): Recognizer | null {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!Ctor) return null
  const rec = new Ctor()
  rec.lang = LANG_CODES[opts.lang]
  rec.interimResults = true
  rec.continuous = false
  rec.maxAlternatives = 1
  let finalText = ''
  rec.onresult = (event: any) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i]
      if (r.isFinal) finalText += r[0].transcript
      else interim += r[0].transcript
    }
    if (interim) opts.onInterim(finalText + interim)
  }
  rec.onerror = (event: any) => {
    const code = event?.error || 'unknown'
    const messages: Record<string, string> = {
      'not-allowed': 'Microphone access was blocked. Allow the mic in the address bar, or type your command.',
      'service-not-allowed': 'Speech recognition is not allowed here. Type your command instead.',
      'no-speech': "I didn't hear anything. Tap the mic and try again.",
      'audio-capture': 'No microphone was found.',
      network: 'Speech recognition needs an internet connection.',
      aborted: '',
    }
    const msg = messages[code] ?? `Speech recognition error: ${code}`
    if (msg) opts.onError(msg)
  }
  rec.onend = () => {
    const text = finalText.trim()
    if (text) opts.onFinal(text)
    opts.onEnd()
  }
  try {
    rec.start()
  } catch {
    opts.onError('Could not start the microphone.')
    return null
  }
  return { stop: () => rec.stop(), abort: () => rec.abort() }
}

// ---------------------------------------------------------------- speaking

export function synthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null

/** Voices load asynchronously in Chrome; wait for them (max ~1.5 s). */
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!synthesisSupported()) return Promise.resolve([])
  if (voicesPromise) return voicesPromise
  voicesPromise = new Promise(resolve => {
    const now = window.speechSynthesis.getVoices()
    if (now.length) return resolve(now)
    const done = () => resolve(window.speechSynthesis.getVoices())
    window.speechSynthesis.addEventListener?.('voiceschanged', done, { once: true })
    setTimeout(done, 1500)
  })
  return voicesPromise.then(v => {
    if (!v.length) voicesPromise = null // try again next time
    return v
  })
}

const QUALITY = /(natural|neural|google|premium|enhanced|siri|online)/i

/** Best available voice for a language, honouring a saved choice. */
export function pickVoice(voices: SpeechSynthesisVoice[], lang: VoiceLang, preferredURI?: string | null): SpeechSynthesisVoice | null {
  if (preferredURI) {
    const chosen = voices.find(v => v.voiceURI === preferredURI)
    if (chosen && chosen.lang.toLowerCase().startsWith(lang)) return chosen
  }
  const code = LANG_CODES[lang].toLowerCase()
  const sameLocale = voices.filter(v => v.lang.toLowerCase().replace('_', '-') === code)
  const sameLang = voices.filter(v => v.lang.toLowerCase().startsWith(lang))
  const englishFallbacks = lang === 'en' ? voices.filter(v => /^en-(gb|us|au)/i.test(v.lang)) : []
  for (const pool of [sameLocale, sameLang, englishFallbacks]) {
    if (!pool.length) continue
    return pool.find(v => QUALITY.test(v.name)) || pool[0]
  }
  return null
}

export function voicesFor(voices: SpeechSynthesisVoice[], lang: VoiceLang): SpeechSynthesisVoice[] {
  return voices.filter(v => v.lang.toLowerCase().startsWith(lang))
}

/** Split long text into speakable chunks (sentences, then commas for very long ones). */
export function toChunks(sentences: string[]): string[] {
  const out: string[] = []
  for (const s of sentences) {
    const parts = s.split(/(?<=[.!?।])\s+/).filter(Boolean)
    for (const p of parts) {
      if (p.length <= 220) { out.push(p); continue }
      let buf = ''
      for (const piece of p.split(/(?<=,)\s+/)) {
        if ((buf + ' ' + piece).length > 220 && buf) { out.push(buf.trim()); buf = piece } else buf = `${buf} ${piece}`
      }
      if (buf.trim()) out.push(buf.trim())
    }
  }
  return out
}

export interface SpeechHandle {
  stop: () => void
  pause: () => void
  resume: () => void
  /** True when real audio is playing (false = timed captions only). */
  audible: boolean
}

/**
 * Speak sentences one by one.
 * onSentence(i) fires when sentence i starts; onWord(i, start, end) on word
 * boundaries when the voice supports them; onDone once at the end (not after stop()).
 */
export function speak(
  sentences: string[],
  opts: {
    lang: VoiceLang
    rate: number
    voiceURI?: string | null
    muted?: boolean
    onSentence: (index: number) => void
    onWord?: (index: number, start: number, end: number) => void
    onDone: () => void
  }
): SpeechHandle {
  let stopped = false
  let paused = false
  let index = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  const audible = synthesisSupported() && !opts.muted

  const finish = () => { if (!stopped) { stopped = true; opts.onDone() } }

  const timedNext = () => {
    if (stopped) return
    if (index >= sentences.length) return finish()
    opts.onSentence(index)
    const words = sentences[index].split(/\s+/).length
    const ms = Math.max(1400, (words / (2.6 * opts.rate)) * 1000)
    index++
    timer = setTimeout(() => { if (!paused) timedNext() }, ms)
  }

  if (!audible) {
    timedNext()
    return {
      audible: false,
      stop: () => { stopped = true; if (timer) clearTimeout(timer) },
      pause: () => { paused = true; if (timer) clearTimeout(timer) },
      resume: () => { if (paused) { paused = false; timedNext() } },
    }
  }

  const synth = window.speechSynthesis
  synth.cancel()
  let fellBack = false

  loadVoices().then(voices => {
    if (stopped) return
    const voice = pickVoice(voices, opts.lang, opts.voiceURI)
    const speakNext = () => {
      if (stopped || fellBack) return
      if (index >= sentences.length) return finish()
      const i = index++
      const u = new SpeechSynthesisUtterance(sentences[i])
      u.lang = voice?.lang || LANG_CODES[opts.lang]
      if (voice) u.voice = voice
      u.rate = opts.rate
      u.pitch = 1
      u.onstart = () => opts.onSentence(i)
      u.onboundary = (e: SpeechSynthesisEvent) => {
        if (e.name && e.name !== 'word') return
        const text = sentences[i]
        const start = e.charIndex
        const len = (e as any).charLength || (text.slice(start).match(/^\S+/)?.[0].length ?? 0)
        opts.onWord?.(i, start, start + len)
      }
      u.onend = () => speakNext()
      u.onerror = (e: SpeechSynthesisErrorEvent) => {
        if (stopped || e.error === 'interrupted' || e.error === 'canceled') return
        // No usable voice / blocked autoplay: keep going with timed captions.
        fellBack = true
        index = i
        timedNext()
      }
      synth.speak(u)
    }
    if (!voice && voices.length === 0) {
      fellBack = true
      timedNext()
    } else {
      speakNext()
    }
  })

  return {
    audible: true,
    stop: () => { stopped = true; if (timer) clearTimeout(timer); synth.cancel() },
    pause: () => { paused = true; if (fellBack) { if (timer) clearTimeout(timer) } else synth.pause() },
    resume: () => {
      if (!paused) return
      paused = false
      if (fellBack) timedNext()
      else synth.resume()
    },
  }
}
