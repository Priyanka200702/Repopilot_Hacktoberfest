import axios from 'axios'
import { API_BASE_URL } from './api'
import { useRepoStore } from '../store/useRepoStore'
import type { VoiceLang } from './speech'

export type VoiceAction =
  | { type: 'navigate'; tab: string }
  | { type: 'explainPage'; tab: string }
  | { type: 'startTour' }
  | { type: 'openFileStory'; path: string; sha?: string }
  | { type: 'openDetailedAnalysis'; path: string; sha?: string }
  | { type: 'openChat'; question: string }

export interface NarrationResponse {
  sentences: string[]
  source: 'gemma' | 'facts'
  model?: string
  notice?: string
  cached?: boolean
}

export interface CommandResponse {
  say: string
  actions: VoiceAction[]
  source: 'gemma' | 'fallback'
  model?: string
  notice?: string
}

function headers() {
  const { aiKey, aiProvider } = useRepoStore.getState()
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (aiKey) h['X-AI-Key'] = aiKey
  if (aiProvider) h['X-AI-Provider'] = aiProvider
  return h
}

export async function fetchNarration(body: {
  owner: string
  repo: string
  tab: string
  length: 'full' | 'brief'
  language: VoiceLang
  pageText?: string
  filePath?: string
  analysis?: unknown
}): Promise<NarrationResponse> {
  const analysis = body.analysis || useRepoStore.getState().analysis
  const res = await axios.post(`${API_BASE_URL}/voice/narrate`, { ...body, analysis }, { headers: headers(), timeout: 60000 })
  return res.data
}

export async function sendVoiceCommand(body: {
  owner: string
  repo: string
  transcript: string
  currentPage: string
  language: VoiceLang
  history: { role: 'user' | 'assistant'; text: string }[]
  analysis?: unknown
}): Promise<CommandResponse> {
  const analysis = body.analysis || useRepoStore.getState().analysis
  const res = await axios.post(`${API_BASE_URL}/voice/command`, { ...body, analysis }, { headers: headers(), timeout: 45000 })
  return res.data
}
