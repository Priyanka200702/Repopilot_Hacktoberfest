/**
 * Voice assistant brain on the client: listening, instant commands, Gemma 4
 * commands, page narration and the guided tour. Kept outside React so long
 * running flows (a tour that navigates across pages) never use stale state.
 * The VoiceAssistant component supplies navigation callbacks via setContext().
 */
import { useVoiceStore } from '../store/useVoiceStore'
import { parseIntent, TOUR_STEPS, HELP_TEXT, type FileRef, type Intent } from './voiceIntents'
import { recognitionSupported, startRecognition, speak, toChunks, type Recognizer, type SpeechHandle } from './speech'
import { fetchNarration, sendVoiceCommand, type VoiceAction } from './voiceApi'
import { spotlight, clearSpotlight } from './spotlight'

export interface VoiceContext {
  owner: string
  repo: string
  currentPage: string
  onAnalyzePage: boolean
  files: FileRef[]
  goToTab: (tab: string) => void
  goToDashboard: () => void
  openDetailedAnalysis: (path: string, sha?: string) => void
  openStory: (path: string) => void
  closeOverlays: () => void
  askChat: (question: string) => void
}

const base = (p: string) => p.split('/').pop() || p
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

const LOCAL_TEXT = {
  en: {
    tourIntro: (repo: string) => `Let's take a quick tour of ${repo}.`,
    tourEnd: "That's the tour. Ask me anything about this repository, or tell me to open a file's story.",
    opening: (tab: string) => `Opening ${tab}.`,
    story: (f: string) => `Here is the story of ${f}.`,
    detailed: (f: string) => `Opening the detailed analysis of ${f}.`,
    back: 'Back to the dashboard.',
    faster: 'Okay, a little faster.',
    slower: 'Okay, a little slower.',
    nothing: 'There is nothing to repeat yet.',
    langSet: "Okay, I'll speak English.",
    serverDown: "I couldn't reach the RepoPilot server. Check that the backend is running.",
    noPage: "I couldn't load the explanation for this page.",
  },
  hi: {
    tourIntro: (repo: string) => `चलिए ${repo} का एक छोटा सा टूर करते हैं।`,
    tourEnd: 'टूर पूरा हुआ। इस repository के बारे में कुछ भी पूछिए।',
    opening: (tab: string) => `${tab} खोल रहा हूँ।`,
    story: (f: string) => `यह रही ${f} की कहानी।`,
    detailed: (f: string) => `${f} का detailed analysis खोल रहा हूँ।`,
    back: 'Dashboard पर वापस।',
    faster: 'ठीक है, थोड़ा तेज़।',
    slower: 'ठीक है, थोड़ा धीरे।',
    nothing: 'अभी दोहराने के लिए कुछ नहीं है।',
    langSet: 'ठीक है, अब मैं हिंदी में बात करूँगा।',
    serverDown: 'RepoPilot server से जुड़ नहीं पाया।',
    noPage: 'इस पेज की जानकारी लोड नहीं हो पाई।',
  },
}

export const TOUR_PAGE_EXPLANATIONS: Record<'en' | 'hi', Record<string, string[]>> = {
  en: {
    'Overview': [
      'This is the Overview dashboard.',
      'It summarizes the architecture, primary tech stack, complexity rating, and onboarding insights for this repository.',
    ],
    'Setup Guide': [
      'This is the Setup Guide.',
      'It walks through the prerequisite installation commands, run scripts, and required environment variables.',
    ],
    'Architecture': [
      'This is the Architecture view.',
      'It provides an interactive dependency graph mapping out key modules, entry points, and component connections.',
    ],
    'APIs & Routes': [
      'This is the APIs and Routes catalog.',
      'It discovers all HTTP endpoints, route methods, controllers, parameters, and authentication requirements.',
    ],
    'Env Variables': [
      'This is the Environment Variables panel.',
      'It detects all required secrets and configuration keys, documenting default values and missing variables.',
    ],
    'Security Audit': [
      'This is the Security Audit report.',
      'It inspects vulnerable dependencies, exposed secrets, static code security alerts, and remediation advice.',
    ],
    'Onboarding Score': [
      'This is the Onboarding Readiness Score.',
      'It grades the repository on documentation, test coverage, setup clarity, and codebase organization.',
    ],
    'Time Machine': [
      'This is the Time Machine.',
      'It tracks the milestone history of the repository and allows inspecting how each file evolved over time.',
    ],
  },
  hi: {
    'Overview': [
      'यह प्रोजेक्ट का ओवरव्यू डैशबोर्ड है।',
      'यहाँ आपको रिपॉजिटरी का आर्किटेक्चर, टेक स्टैक, और मुख्य इनसाइट्स देखने को मिलते हैं।',
    ],
    'Setup Guide': [
      'यह सेटअप गाइड पेज है।',
      'यहाँ प्रोजेक्ट को अपने सिस्टम पर चलाने के लिए ज़रूरी स्टेप्स और कमांड्स दिए गए हैं।',
    ],
    'Architecture': [
      'यह आर्किटेक्चर मैप है।',
      'यह कोडबेस के मुख्य मॉड्यूल्स, एंट्री पॉइंट्स और उनके आपसी कनेक्शन्स को विज़ुअलाइज़ करता है।',
    ],
    'APIs & Routes': [
      'यह API और रूट्स कैटलॉग है।',
      'यहाँ सभी HTTP एंडपॉइंट्स, मेथड्स, और ऑथेंटिकेशन की पूरी जानकारी है।',
    ],
    'Env Variables': [
      'यह एन्वायरनमेंट वैरिएबल्स पैनल है।',
      'यहाँ प्रोजेक्ट के सभी ज़रूरी कॉन्फ़िगरेशन कीज़ और सीक्रेट्स की स्थिति दिखाई गई है।',
    ],
    'Security Audit': [
      'यह सिक्योरिटी ऑडिट पेज है।',
      'यहाँ संभावित सुरक्षा जोखिमों, डिपेंडेंसी कमियों और बचाव के सुझावों का विश्लेषण है।',
    ],
    'Onboarding Score': [
      'यह ऑनबोर्डिंग रेडीनेस स्कोर है।',
      'यह मापता है कि नया डेवलपर इस कोडबेस पर कितनी आसानी से काम शुरू कर सकता है।',
    ],
    'Time Machine': [
      'यह टाइम मशीन पेज है।',
      'यहाँ रिपॉजिटरी के विकास के बड़े पड़ाव और हर फ़ाइल का इतिहास देखा जा सकता है।',
    ],
  },
}

class VoiceController {
  private ctx: VoiceContext | null = null
  private rec: Recognizer | null = null
  private speech: SpeechHandle | null = null
  private resolveSpeech: (() => void) | null = null
  private tourToken: { cancelled: boolean; skip: boolean } | null = null
  private currentOperationId = 0

  setContext(ctx: VoiceContext) {
    this.ctx = ctx
  }

  private get store() {
    return useVoiceStore.getState()
  }

  private get text() {
    return LOCAL_TEXT[this.store.lang]
  }

  // ------------------------------------------------------------ speaking

  /**
   * Speak lines with live captions. Resolves when finished or stopped.
   * With spotlight, each sentence scrolls to and highlights the part of the page it is about.
   */
  speakLines(lines: string[], opts: { spotlight?: boolean } = {}): Promise<void> {
    this.stopSpeaking()
    const chunks = toChunks(lines.filter(Boolean))
    if (!chunks.length) return Promise.resolve()
    const st = this.store
    st.setLastSpoken(chunks)
    st.setCaptions({ sentences: chunks, current: 0, word: null })
    st.setStatus('speaking')
    return new Promise<void>(resolve => {
      this.resolveSpeech = resolve
      this.speech = speak(chunks, {
        lang: st.lang,
        rate: st.rate,
        voiceURI: st.voiceURI,
        muted: st.muted,
        onSentence: i => {
          this.store.setCaptions({ sentences: chunks, current: i, word: null })
          if (opts.spotlight) spotlight(chunks[i], i, chunks.length)
        },
        onWord: (i, start, end) => this.store.setCaptions({ sentences: chunks, current: i, word: { start, end } }),
        onDone: () => {
          this.speech = null
          if (opts.spotlight) setTimeout(() => { if (!this.speech) clearSpotlight() }, 1200)
          if (this.store.status === 'speaking' || this.store.status === 'paused') this.store.setStatus('idle')
          const r = this.resolveSpeech
          this.resolveSpeech = null
          r?.()
        },
      })
    })
  }

  stopSpeaking() {
    clearSpotlight()
    this.speech?.stop()
    this.speech = null
    const r = this.resolveSpeech
    this.resolveSpeech = null
    r?.()
    if (this.store.status === 'speaking' || this.store.status === 'paused') this.store.setStatus('idle')
  }

  pause() {
    if (!this.speech) return
    this.speech.pause()
    this.store.setStatus('paused')
  }

  resume() {
    if (!this.speech) return
    this.speech.resume()
    this.store.setStatus('speaking')
  }

  private async reply(text: string, source: 'gemma' | 'facts' | 'fallback' | 'local' = 'local') {
    this.store.addMessage({ role: 'assistant', text, source })
    await this.speakLines([text])
  }

  // ------------------------------------------------------------ listening

  listen() {
    const st = this.store
    st.setOpen(true)
    if (!recognitionSupported()) {
      st.setError('Voice input works in Chrome, Edge or Safari. You can type your command below.')
      return
    }
    this.stopAll()
    st.setError(null)
    st.setInterim('')
    st.setStatus('listening')
    this.rec = startRecognition({
      lang: st.lang,
      onInterim: t => this.store.setInterim(t),
      onFinal: t => { void this.handle(t) },
      onError: msg => this.store.setError(msg),
      onEnd: () => {
        this.rec = null
        if (this.store.status === 'listening') this.store.setStatus('idle')
        this.store.setInterim('')
      },
    })
    if (!this.rec) st.setStatus('idle')
  }

  stopListening() {
    this.rec?.stop()
  }

  isListening() {
    return Boolean(this.rec)
  }

  stopAll() {
    this.currentOperationId++
    if (this.tourToken) this.tourToken.cancelled = true
    this.tourToken = null
    this.store.setTour(null)
    this.rec?.abort()
    this.rec = null
    this.stopSpeaking()
    this.store.setInterim('')
    if (this.store.status !== 'idle') this.store.setStatus('idle')
  }

  // ------------------------------------------------------------ commands

  /** Entry point for anything the user said or typed. */
  async handle(raw: string) {
    const text = raw.trim()
    if (!text || !this.ctx) return
    this.store.setError(null)
    this.store.addMessage({ role: 'user', text })
    this.store.setInterim('')
    const intent = parseIntent(text, this.ctx.files)
    if (intent) {
      await this.runIntent(intent)
    } else {
      await this.askGemma(text)
    }
    this.maybeListenAgain()
  }

  private maybeListenAgain() {
    const st = this.store
    if (st.handsFree && st.open && !this.tourToken && st.status === 'idle') {
      setTimeout(() => { if (this.store.status === 'idle' && !this.tourToken) this.listen() }, 350)
    }
  }

  private async runIntent(intent: Intent) {
    const ctx = this.ctx!
    const t = this.text
    switch (intent.kind) {
      case 'stop': this.stopAll(); return
      case 'skip': {
        if (this.tourToken) {
          this.skipTourStep()
        } else {
          this.stopAll()
        }
        return
      }
      case 'pause': this.pause(); return
      case 'resume': this.resume(); return
      case 'repeat': {
        const last = this.store.lastSpoken
        if (last?.length) await this.speakLines(last)
        else await this.reply(t.nothing)
        return
      }
      case 'faster':
      case 'slower': {
        const rate = Math.min(1.6, Math.max(0.7, this.store.rate + (intent.kind === 'faster' ? 0.15 : -0.15)))
        this.store.updateSettings({ rate: Math.round(rate * 100) / 100 })
        await this.reply(intent.kind === 'faster' ? t.faster : t.slower)
        return
      }
      case 'help':
        this.store.addMessage({ role: 'assistant', text: HELP_TEXT.join(' '), source: 'local' })
        await this.speakLines(HELP_TEXT.slice(0, 3))
        return
      case 'language':
        this.store.updateSettings({ lang: intent.lang })
        await this.reply(LOCAL_TEXT[intent.lang].langSet)
        return
      case 'tour': await this.tour(); return
      case 'explain': {
        const page = intent.tab || ctx.currentPage
        if (intent.tab) ctx.goToTab(intent.tab)
        await this.explain(page)
        return
      }
      case 'navigate':
        ctx.goToTab(intent.tab)
        await this.reply(t.opening(intent.tab))
        return
      case 'back':
        ctx.goToDashboard()
        await this.reply(t.back)
        return
      case 'fileStory':
        ctx.openStory(intent.path)
        await this.reply(t.story(base(intent.path)))
        return
      case 'detailed':
        ctx.openDetailedAnalysis(intent.path, intent.sha)
        await this.reply(t.detailed(base(intent.path)))
        return
    }
  }

  private async askGemma(text: string) {
    const ctx = this.ctx!
    const opId = ++this.currentOperationId
    const st = this.store
    st.setStatus('thinking')
    try {
      const history = st.messages.slice(-5, -1).map(m => ({ role: m.role, text: m.text }))
      const r = await sendVoiceCommand({
        owner: ctx.owner, repo: ctx.repo, transcript: text, currentPage: ctx.currentPage, language: st.lang, history,
      })
      if (this.currentOperationId !== opId) return
      let followUp: VoiceAction | undefined
      for (const a of r.actions || []) {
        if (a.type === 'navigate') ctx.goToTab(a.tab)
        else if (a.type === 'openFileStory') ctx.openStory(a.path)
        else if (a.type === 'openDetailedAnalysis') ctx.openDetailedAnalysis(a.path, a.sha)
        else if (a.type === 'openChat') ctx.askChat(a.question)
        else followUp = a
      }
      if (this.store.status === 'thinking') this.store.setStatus('idle')
      await this.reply(r.say, r.source)
      if (this.currentOperationId !== opId) return
      if (followUp?.type === 'explainPage') {
        ctx.goToTab(followUp.tab)
        await this.explain(followUp.tab)
      } else if (followUp?.type === 'startTour') {
        await this.tour()
      }
    } catch {
      if (this.currentOperationId !== opId) return
      this.store.setStatus('idle')
      await this.reply(this.text.serverDown, 'fallback')
    }
  }

  // ------------------------------------------------------------ narration

  /** Spoken, detailed explanation of a page (Gemma 4, facts fallback on the server). */
  async explain(page: string) {
    const ctx = this.ctx
    if (!ctx) return
    const opId = ++this.currentOperationId
    const st = this.store
    st.setOpen(true)
    st.setStatus('thinking')
    try {
      const pc = st.pageContext
      const isDetailed = page === 'Detailed Analysis'
      const r = await fetchNarration({
        owner: ctx.owner,
        repo: ctx.repo,
        tab: page,
        length: 'full',
        language: st.lang,
        pageText: isDetailed ? pc?.text : undefined,
        filePath: isDetailed ? pc?.path : undefined,
      })
      if (this.currentOperationId !== opId) return
      if (this.store.status === 'thinking') this.store.setStatus('idle')
      this.store.addMessage({ role: 'assistant', text: r.sentences.join(' '), source: r.source })
      await this.speakLines(r.sentences, { spotlight: true })
    } catch {
      if (this.currentOperationId !== opId) return
      this.store.setStatus('idle')
      await this.reply(this.text.noPage, 'fallback')
    }
  }

  // ------------------------------------------------------------ guided tour

  skipTourStep() {
    if (!this.tourToken) return
    this.tourToken.skip = true
    this.stopSpeaking()
  }

  async tour() {
    const ctx = this.ctx
    if (!ctx) return
    this.stopAll()
    ctx.closeOverlays()
    const token = { cancelled: false, skip: false }
    this.tourToken = token
    const st = this.store
    st.setOpen(false) // keep the page visible; captions show above the button
    const steps = TOUR_STEPS
    const prefetch = (i: number) =>
      fetchNarration({ owner: ctx.owner, repo: ctx.repo, tab: steps[i], length: 'brief', language: this.store.lang })
        .then(r => r.sentences)
        .catch(() => null)

    let next = prefetch(0)
    st.setTour({ active: true, step: 0, total: steps.length, label: 'Starting' })
    await this.speakLines([this.text.tourIntro(ctx.repo)])

    for (let i = 0; i < steps.length; i++) {
      if (token.cancelled) return
      token.skip = false
      this.store.setTour({ active: true, step: i + 1, total: steps.length, label: steps[i] })
      this.ctx?.goToTab(steps[i])
      this.store.setStatus('thinking')
      const lines = await next
      if (i + 1 < steps.length) next = prefetch(i + 1)
      if (token.cancelled) return
      clearSpotlight(true) // start each page from the top
      await wait(450) // let the page render before talking about it
      if (token.cancelled) return
      await this.speakLines(lines?.length ? lines : [steps[i]], { spotlight: true })
      if (token.cancelled) return
      await wait(token.skip ? 100 : 500)
    }
    if (token.cancelled) return
    this.tourToken = null
    this.store.setTour(null)
    this.store.addMessage({ role: 'assistant', text: this.text.tourEnd, source: 'local' })
    await this.speakLines([this.text.tourEnd])
  }

  stopTour() {
    this.stopAll()
  }
}

export const voiceController = new VoiceController()
