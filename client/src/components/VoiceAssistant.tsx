import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Mic,
  MicOff,
  Square,
  Pause,
  Play,
  RotateCcw,
  X,
  Send,
  Settings2,
  Sparkles,
  Loader2,
  Compass,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useRepoStore } from '../store/useRepoStore'
import { useUIStore } from '../store/useUIStore'
import { useVoiceStore, type Captions } from '../store/useVoiceStore'
import { voiceController } from '../lib/voiceController'
import { loadVoices, recognitionSupported, voicesFor } from '../lib/speech'
import FileTimeMachine from './FileTimeMachine'

/** Equaliser bars shown while the assistant is speaking. */
function SpeakingBars({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-end gap-[3px] h-5 ${className}`} aria-hidden>
      {[0, 1, 2, 3, 4].map(i => (
        <motion.span
          key={i}
          className="w-[3px] rounded-full bg-current"
          animate={{ height: ['30%', '100%', '45%', '85%', '30%'] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.12, ease: 'easeInOut' }}
        />
      ))}
    </div>
  )
}

/** Current sentence with the spoken word highlighted (when the voice reports word boundaries). */
function CaptionLine({ captions, large = false }: { captions: Captions; large?: boolean }) {
  const sentence = captions.sentences[captions.current] || ''
  const w = captions.word
  const cls = large ? 'text-sm md:text-base' : 'text-xs'
  if (!w || w.end <= w.start || w.end > sentence.length) {
    return <p className={`${cls} leading-relaxed text-[var(--text-primary)] font-sans`}>{sentence}</p>
  }
  return (
    <p className={`${cls} leading-relaxed text-[var(--text-primary)] font-sans`}>
      <span className="opacity-60">{sentence.slice(0, w.start)}</span>
      <span className="rounded px-0.5 bg-cyan-500/25 text-[var(--text-primary)]">{sentence.slice(w.start, w.end)}</span>
      <span>{sentence.slice(w.end)}</span>
    </p>
  )
}

const STATUS_LABEL: Record<string, string> = {
  idle: 'Ready',
  listening: 'Listening...',
  thinking: 'Gemma 4 is thinking...',
  speaking: 'Speaking',
  paused: 'Paused',
}

export default function VoiceAssistant() {
  const { owner, repo } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const onAnalyzePage = location.pathname.endsWith('/analyze')
  const { analysis, currentTab, setCurrentTab, sendChatMessage } = useRepoStore()
  const { theme } = useUIStore()
  const v = useVoiceStore()
  const [storyPath, setStoryPath] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const closeStory = useCallback(() => setStoryPath(null), [])
  const files = useMemo(() => (analysis?.files || []).map(f => ({ path: f.path, sha: f.sha })), [analysis?.files])
  const currentPage = onAnalyzePage ? 'Detailed Analysis' : currentTab
  const entryFile = analysis?.entryPoint?.file
  const micSupported = recognitionSupported()

  // Give the controller the latest navigation callbacks and page context.
  useEffect(() => {
    if (!owner || !repo) return
    voiceController.setContext({
      owner,
      repo,
      currentPage,
      onAnalyzePage,
      files,
      goToTab: (tab: string) => {
        setStoryPath(null)
        setCurrentTab(tab)
        if (onAnalyzePage) navigate(`/repo/${owner}/${repo}`)
      },
      goToDashboard: () => navigate(`/repo/${owner}/${repo}`),
      openDetailedAnalysis: (path: string, sha?: string) => {
        const fileSha = sha || files.find(f => f.path === path)?.sha
        if (fileSha) navigate(`/repo/${owner}/${repo}/analyze?path=${encodeURIComponent(path)}&sha=${fileSha}`)
      },
      openStory: (path: string) => setStoryPath(path),
      closeOverlays: () => setStoryPath(null),
      askChat: (question: string) => {
        setCurrentTab('AI Assistant')
        if (onAnalyzePage) navigate(`/repo/${owner}/${repo}`)
        void sendChatMessage(question)
      },
    })
  }, [owner, repo, currentPage, onAnalyzePage, files, navigate, setCurrentTab, sendChatMessage])

  // Stop talking when the assistant leaves the page.
  useEffect(() => () => voiceController.stopAll(), [])

  // Voices for the settings menu (loaded asynchronously by the browser).
  useEffect(() => {
    let alive = true
    loadVoices().then(list => { if (alive) setVoices(list) })
    return () => { alive = false }
  }, [])

  // Alt+V toggles the microphone; Escape stops speaking or the tour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.code === 'KeyV') {
        e.preventDefault()
        if (voiceController.isListening()) voiceController.stopListening()
        else voiceController.listen()
      } else if (e.key === 'Escape') {
        const s = useVoiceStore.getState().status
        if (s === 'speaking' || s === 'paused' || useVoiceStore.getState().tour) voiceController.stopAll()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Keep the conversation scrolled to the latest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [v.messages.length, v.interim])

  if (!owner || !repo) return null

  const suggestions = onAnalyzePage
    ? ['Explain this file', 'Back to the dashboard', 'Give me a tour']
    : [
        'Explain this page',
        'Give me a tour',
        'Open the security audit',
        'How do I run this project?',
        ...(entryFile ? [`Tell me the story of ${entryFile.split('/').pop()}`] : []),
      ]

  const sendTyped = () => {
    const t = typed.trim()
    if (!t) return
    setTyped('')
    void voiceController.handle(t)
  }

  const onFab = () => {
    if (v.status === 'listening') return voiceController.stopListening()
    if (v.status === 'speaking' || v.status === 'paused' || v.tour) return voiceController.stopAll()
    if (!v.open) {
      v.setOpen(true)
      if (micSupported) voiceController.listen()
      return
    }
    voiceController.listen()
  }

  const fabState = v.status === 'listening' ? 'listening' : v.status === 'thinking' ? 'thinking' : v.status === 'speaking' || v.status === 'paused' ? 'speaking' : 'idle'
  const langVoices = voicesFor(voices, v.lang)

  const ui = (
    <div className={theme}>
      {/* Guided tour banner */}
      <AnimatePresence>
        {v.tour && (
          <motion.div
            initial={{ y: -40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -40, opacity: 0 }}
            className="fixed top-3 left-1/2 -translate-x-1/2 z-[95] w-[min(520px,calc(100vw-2rem))] rounded-2xl border border-cyan-500/30 bg-[var(--bg-primary)]/95 backdrop-blur-xl shadow-2xl px-4 py-3 text-[var(--text-primary)]"
            role="status"
          >
            <div className="flex items-center gap-3">
              <Compass className="w-4 h-4 text-cyan-600 dark:text-cyan-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-mono font-bold tracking-widest text-cyan-600 dark:text-cyan-400">
                  GUIDED TOUR {v.tour.step > 0 ? `· ${v.tour.step}/${v.tour.total}` : ''}
                </div>
                <div className="text-sm font-semibold truncate font-sans">{v.tour.label}</div>
              </div>
              <button onClick={() => voiceController.skipTourStep()} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--border-color)] text-[10px] font-bold tracking-wider hover:border-cyan-500/40 cursor-pointer">
                <SkipForward className="w-3.5 h-3.5" /> SKIP
              </button>
              <button onClick={() => voiceController.stopTour()} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--border-color)] text-[10px] font-bold tracking-wider hover:border-rose-500/40 cursor-pointer">
                <Square className="w-3 h-3" /> END
              </button>
            </div>
            <div className="mt-2 h-1 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
              <motion.div className="h-full bg-gradient-to-r from-cyan-500 to-violet-500" animate={{ width: `${(v.tour.step / v.tour.total) * 100}%` }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Live captions when the panel is closed */}
      <AnimatePresence>
        {!v.open && v.captions && (v.status === 'speaking' || v.status === 'paused') && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed bottom-24 right-4 md:right-6 z-[90] w-[min(440px,calc(100vw-2rem))] rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/95 backdrop-blur-xl shadow-2xl p-4"
            aria-live="polite"
          >
            <div className="flex items-center gap-2 mb-1.5 text-violet-600 dark:text-violet-300">
              <SpeakingBars className="h-3" />
              <span className="text-[9px] font-mono font-bold tracking-widest">REPOPILOT · GEMMA 4</span>
            </div>
            <CaptionLine captions={v.captions} large />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Panel */}
      <AnimatePresence>
        {v.open && (
          <motion.section
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            className="fixed bottom-24 right-4 md:right-6 z-[90] w-[min(390px,calc(100vw-2rem))] max-h-[min(640px,calc(100vh-8rem))] flex flex-col rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)]/95 backdrop-blur-xl shadow-2xl text-[var(--text-primary)] text-left overflow-hidden"
            aria-label="RepoPilot voice assistant"
          >
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-color)]">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-cyan-500/20 to-violet-500/20 border border-cyan-500/20">
                <Sparkles className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold font-sans leading-tight">RepoPilot Voice</div>
                <div className="text-[10px] font-mono text-[var(--text-secondary)] truncate">
                  {STATUS_LABEL[v.status]} · {currentPage}
                </div>
              </div>
              <div className="flex rounded-lg border border-[var(--border-color)] overflow-hidden text-[10px] font-bold font-mono" role="group" aria-label="Language">
                {(['en', 'hi'] as const).map(l => (
                  <button
                    key={l}
                    onClick={() => v.updateSettings({ lang: l, voiceURI: null })}
                    className={`px-2 py-1 cursor-pointer ${v.lang === l ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300' : 'text-[var(--text-secondary)]'}`}
                    aria-pressed={v.lang === l}
                  >
                    {l === 'en' ? 'EN' : 'हिं'}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowSettings(s => !s)} className="p-1.5 rounded-lg hover:bg-[var(--bg-secondary)] cursor-pointer" title="Voice settings" aria-expanded={showSettings}>
                <Settings2 className="w-4 h-4" />
              </button>
              <button onClick={() => { voiceController.stopAll(); v.setOpen(false) }} className="p-1.5 rounded-lg hover:bg-[var(--bg-secondary)] cursor-pointer" title="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Settings */}
            <AnimatePresence>
              {showSettings && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-b border-[var(--border-color)]">
                  <div className="px-4 py-3 space-y-3 text-xs font-sans">
                    <label className="block space-y-1">
                      <span className="text-[10px] font-mono font-bold tracking-wider text-[var(--text-secondary)]">VOICE</span>
                      <select
                        value={v.voiceURI || ''}
                        onChange={e => v.updateSettings({ voiceURI: e.target.value || null })}
                        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 text-xs"
                      >
                        <option value="">Best available ({v.lang === 'en' ? 'English' : 'Hindi'})</option>
                        {langVoices.map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} ({voice.lang})</option>)}
                      </select>
                      {!langVoices.length && <span className="text-[10px] text-[var(--text-secondary)]">No {v.lang === 'en' ? 'English' : 'Hindi'} voice installed in this browser; the closest voice is used.</span>}
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[10px] font-mono font-bold tracking-wider text-[var(--text-secondary)]">SPEED · {v.rate.toFixed(2)}×</span>
                      <input type="range" min={0.7} max={1.6} step={0.05} value={v.rate} onChange={e => v.updateSettings({ rate: Number(e.target.value) })} className="w-full accent-cyan-500" />
                    </label>
                    <div className="flex items-center justify-between gap-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={v.handsFree} onChange={e => v.updateSettings({ handsFree: e.target.checked })} className="accent-cyan-500" />
                        <span>Hands-free (listen again after each answer)</span>
                      </label>
                      <button onClick={() => v.updateSettings({ muted: !v.muted })} className="p-1.5 rounded-lg border border-[var(--border-color)] cursor-pointer" title={v.muted ? 'Unmute (captions only now)' : 'Mute voice, keep captions'}>
                        {v.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <p className="text-[10px] text-[var(--text-secondary)]">Shortcut: Alt+V to talk, Esc to stop. Speech recognition is provided by your browser.</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Conversation */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 min-h-[120px]">
              {v.messages.length === 0 && !v.interim && (
                <div className="text-xs font-sans text-[var(--text-secondary)] space-y-1.5">
                  <p className="text-[var(--text-primary)] font-semibold">Hi! I can walk you through this analysis.</p>
                  <p>Tap the mic and say “explain this page”, “give me a tour”, or ask anything about {repo}.</p>
                </div>
              )}
              {v.messages.map(m => (
                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs font-sans leading-relaxed ${m.role === 'user' ? 'bg-cyan-500/15 text-[var(--text-primary)] rounded-br-sm' : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] rounded-bl-sm'}`}>
                    {m.text}
                    {m.role === 'assistant' && m.source && m.source !== 'local' && (
                      <div className="mt-1 text-[9px] font-mono tracking-wider text-[var(--text-secondary)]">
                        {m.source === 'gemma' ? 'GEMMA 4' : m.source === 'facts' ? 'FROM ANALYSIS FACTS' : 'OFFLINE REPLY'}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {v.interim && (
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2 text-xs font-sans italic text-[var(--text-secondary)] border border-dashed border-cyan-500/40">{v.interim}</div>
                </div>
              )}
              {v.status === 'thinking' && (
                <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-violet-600 dark:text-violet-300 bg-violet-500/10 px-3 py-2 rounded-xl border border-violet-500/20">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Gemma 4 is thinking...
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (v.tour) voiceController.skipTourStep()
                      else voiceController.stopAll()
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 text-violet-700 dark:text-violet-200 text-[10px] font-sans font-bold cursor-pointer transition-colors"
                  >
                    <SkipForward className="w-3 h-3" /> Skip
                  </button>
                </div>
              )}
            </div>

            {/* Captions for what is being spoken right now */}
            {v.captions && (v.status === 'speaking' || v.status === 'paused') && (
              <div className="mx-4 mb-2 rounded-xl border border-violet-500/25 bg-violet-500/5 px-3 py-2" aria-live="polite">
                <div className="flex items-center gap-2 mb-1 text-violet-600 dark:text-violet-300">
                  <SpeakingBars className="h-3" />
                  <span className="text-[9px] font-mono font-bold tracking-widest">
                    SPEAKING {v.captions.sentences.length > 1 ? `· ${v.captions.current + 1}/${v.captions.sentences.length}` : ''}
                  </span>
                </div>
                <CaptionLine captions={v.captions} />
              </div>
            )}

            {v.error && (
              <div className="mx-4 mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] font-sans text-amber-700 dark:text-amber-300">{v.error}</div>
            )}

            {/* Suggestions */}
            {v.status === 'idle' && (
              <div className="px-4 pb-2 flex flex-wrap gap-1.5">
                {suggestions.map(s => (
                  <button key={s} onClick={() => void voiceController.handle(s)} className="px-2.5 py-1 rounded-full border border-[var(--border-color)] text-[11px] font-sans text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-cyan-500/40 cursor-pointer">
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Controls */}
            <div className="flex items-center gap-2 px-3 py-3 border-t border-[var(--border-color)]">
              <button
                onClick={() => (v.status === 'listening' ? voiceController.stopListening() : voiceController.listen())}
                disabled={!micSupported}
                className={`p-2 rounded-xl border cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${v.status === 'listening' ? 'border-rose-500/50 bg-rose-500/10 text-rose-600 dark:text-rose-400' : 'border-[var(--border-color)] hover:border-cyan-500/40'}`}
                title={micSupported ? 'Talk (Alt+V)' : 'Voice input needs Chrome, Edge or Safari'}
              >
                {v.status === 'listening' ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <form onSubmit={e => { e.preventDefault(); sendTyped() }} className="flex-1 min-w-0 flex items-center gap-1.5">
                <input
                  value={typed}
                  onChange={e => setTyped(e.target.value)}
                  placeholder={micSupported ? 'Or type a command...' : 'Type a command...'}
                  className="flex-1 min-w-0 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-xs font-sans outline-none focus:border-cyan-500/50"
                  aria-label="Type a command"
                />
                <button type="submit" disabled={!typed.trim()} className="p-2 rounded-xl border border-[var(--border-color)] disabled:opacity-40 cursor-pointer" title="Send">
                  <Send className="w-4 h-4" />
                </button>
              </form>
              {(v.status === 'speaking' || v.status === 'paused') && (
                <button onClick={() => (v.status === 'paused' ? voiceController.resume() : voiceController.pause())} className="p-2 rounded-xl border border-[var(--border-color)] cursor-pointer" title={v.status === 'paused' ? 'Resume' : 'Pause'}>
                  {v.status === 'paused' ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                </button>
              )}
              {v.status !== 'idle' ? (
                <button onClick={() => voiceController.stopAll()} className="p-2 rounded-xl border border-[var(--border-color)] cursor-pointer" title="Stop (Esc)">
                  <Square className="w-4 h-4" />
                </button>
              ) : v.lastSpoken ? (
                <button onClick={() => void voiceController.speakLines(v.lastSpoken || [])} className="p-2 rounded-xl border border-[var(--border-color)] cursor-pointer" title="Repeat">
                  <RotateCcw className="w-4 h-4" />
                </button>
              ) : null}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Floating button */}
      <div className="fixed bottom-5 right-4 md:right-6 z-[91]">
        <AnimatePresence>
          {fabState === 'listening' && [0, 1].map(i => (
            <motion.span
              key={i}
              className="absolute inset-0 rounded-full bg-rose-500/30"
              initial={{ scale: 1, opacity: 0.6 }}
              animate={{ scale: 1.9, opacity: 0 }}
              transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.8 }}
            />
          ))}
        </AnimatePresence>
        <motion.button
          onClick={onFab}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          className={`relative w-[60px] h-[60px] rounded-full flex items-center justify-center text-white shadow-[0_8px_30px_rgba(34,211,238,0.35)] cursor-pointer border border-white/20 ${
            fabState === 'listening' ? 'bg-gradient-to-br from-rose-500 to-pink-600' : 'bg-gradient-to-br from-cyan-500 to-violet-600'
          }`}
          aria-label={fabState === 'listening' ? 'Stop listening' : fabState === 'speaking' ? 'Stop speaking' : 'Talk to RepoPilot'}
          title="Talk to RepoPilot (Alt+V)"
        >
          {fabState === 'thinking' && (
            <motion.span className="absolute inset-[-3px] rounded-full border-2 border-transparent border-t-white/90" animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} />
          )}
          {fabState === 'speaking' ? <SpeakingBars /> : fabState === 'listening' ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </motion.button>
      </div>

      <AnimatePresence>
        {storyPath && (
          <FileTimeMachine
            key={storyPath}
            owner={owner}
            repo={repo}
            path={storyPath}
            refSha={analysis?.meta?.commitSha}
            onClose={closeStory}
          />
        )}
      </AnimatePresence>
    </div>
  )

  return createPortal(ui, document.body)
}
