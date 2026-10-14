import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { VoiceLang } from '../lib/speech'

export type VoiceStatus = 'idle' | 'listening' | 'thinking' | 'speaking' | 'paused'

export interface VoiceMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  source?: 'gemma' | 'facts' | 'fallback' | 'local'
}

export interface Captions {
  sentences: string[]
  current: number
  word: { start: number; end: number } | null
}

export interface PageContext {
  kind: 'detailed-analysis'
  path: string
  text: string
}

interface VoiceSettings {
  lang: VoiceLang
  rate: number
  voiceURI: string | null
  handsFree: boolean
  muted: boolean
}

interface VoiceState extends VoiceSettings {
  open: boolean
  status: VoiceStatus
  interim: string
  error: string | null
  messages: VoiceMessage[]
  captions: Captions | null
  lastSpoken: string[] | null
  tour: { active: boolean; step: number; total: number; label: string } | null
  pageContext: PageContext | null

  setOpen: (open: boolean) => void
  setStatus: (status: VoiceStatus) => void
  setInterim: (text: string) => void
  setError: (error: string | null) => void
  addMessage: (m: Omit<VoiceMessage, 'id'>) => void
  setCaptions: (c: Captions | null) => void
  setLastSpoken: (s: string[] | null) => void
  setTour: (t: VoiceState['tour']) => void
  setPageContext: (p: PageContext | null) => void
  updateSettings: (s: Partial<VoiceSettings>) => void
}

/** Settings are remembered per browser; storage failures (private mode) are ignored. */
const safeStorage = createJSONStorage(() => {
  try {
    const probe = '__rp_voice_probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return localStorage
  } catch {
    const mem = new Map<string, string>()
    return {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, v) },
      removeItem: (k: string) => { mem.delete(k) },
    }
  }
})

export const useVoiceStore = create<VoiceState>()(
  persist(
    (set) => ({
      lang: 'en',
      rate: 1,
      voiceURI: null,
      handsFree: false,
      muted: false,

      open: false,
      status: 'idle',
      interim: '',
      error: null,
      messages: [],
      captions: null,
      lastSpoken: null,
      tour: null,
      pageContext: null,

      setOpen: (open) => set({ open }),
      setStatus: (status) => set({ status }),
      setInterim: (interim) => set({ interim }),
      setError: (error) => set({ error }),
      addMessage: (m) => set(state => ({
        messages: [...state.messages, { ...m, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }].slice(-12),
      })),
      setCaptions: (captions) => set({ captions }),
      setLastSpoken: (lastSpoken) => set({ lastSpoken }),
      setTour: (tour) => set({ tour }),
      setPageContext: (pageContext) => set({ pageContext }),
      updateSettings: (s) => set(s),
    }),
    {
      name: 'repopilot-voice-settings',
      storage: safeStorage,
      partialize: (s) => ({ lang: s.lang, rate: s.rate, voiceURI: s.voiceURI, handsFree: s.handsFree, muted: s.muted }),
    }
  )
)
