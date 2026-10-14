/* eslint-disable @typescript-eslint/no-explicit-any */
import { create } from 'zustand'
import { API_BASE_URL, analyzeRepository, askAiQuestion, getAiSummary, getAiSecurityReview, getApiExplanation } from '../lib/api'

// RepoPilot runs on Gemma 4. User keys can be Google AI Studio ("gemini") or OpenRouter keys.
const GEMMA_KEY_PROVIDERS = ['gemini', 'openrouter']
const storedProvider = sessionStorage.getItem('repopilot_ai_provider')
const storedProviderValid = storedProvider !== null && GEMMA_KEY_PROVIDERS.includes(storedProvider)
if (storedProvider && !storedProviderValid) {
  // Keys saved for providers RepoPilot no longer uses (e.g. OpenAI, Anthropic) cannot run Gemma.
  sessionStorage.removeItem('repopilot_ai_key')
  sessionStorage.removeItem('repopilot_ai_provider')
}

// -- API Types (matching backend schema) --
export interface RepoAnalysis {
  sandboxEnvironment?: { dockerfile: string, dockerCompose: string };
  meta: {
    owner: string
    repo: string
    defaultBranch: string
    description: string
    language: string
    stars: number
    analyzedAt: string
    commitSha: string
  }
  summary: {
    totalFiles: number
    analyzedFiles: number
    projectType: string
    architectureType: string
    primaryTechStack: string[]
    complexity: string
    onboardingTime: string
    projectMaturity: { check: string, status: string }[]
    quickInsights: string[]
    aiExecutiveSummary?: string
    oneLiner: string
  }
  entryPoint: {
    file: string
    line: number
    confidence: string
    reason: string
    githubUrl: string
  }
  setupSteps: {
    order: number
    title: string
    command: string
    description: string
    note: string | null
  }[]
  envVars: {
    name: string
    file: string
    line: number
    defaultValue: string | null
    required: boolean
    githubUrl: string
  }[]
  routes: {
    method: string;
    path: string;
    file: string;
    line: number;
    controller?: string;
    middleware: string[];
    auth: string | null;
    parameters: { type: string, name: string }[];
    responseTypes: number[];
    dbOperations: string[];
    externalApis: string[];
    complexity: string;
    securityScore: number;
    description?: string;
    githubUrl: string;
    usesEnvVars: string[];
    usesApis: string[];
    aiExplanation?: string;
  }[]
  apiHealth: number;
  apis: {
    name: string
    package: string
    importFile: string
    importLine: number
    category: string
    githubUrl: string
  }[]
  fileRoles: {
    file: string
    role: string
    size: number
    githubUrl: string
  }[]
  files: {
    path: string
    filename: string
    extension: string
    role: string
    imports: string[]
    exports: string[]
    functions: number
    classes: number
    routeCount: number
    middlewareCount: number
    linesOfCode: number
    entryPoint: boolean
    framework: string
    description: string
    size: number
    sha: string
    githubUrl: string | null
  }[]
  graph: {
    nodes: { id: string, type: string, label: string, file: string, line: number, githubUrl: string }[]
    edges: { id: string, source: string, target: string, label: string }[]
  }
  onboardingScore: {
    score: number
    breakdown: { check: string, passed: boolean, points: number, detail: string }[]
  }
  securityAlerts: {
    severity: string
    type: string
    message: string
    file: string
    line: number
    githubUrl: string
  }[]
  securityScore: number;
  dependencySecurity: { severity: string; type: string; package: string; installedVersion: string; safeVersion: string; message: string; referenceLink: string; }[];
  gitHygiene: { severity: string; type: string; message: string; file: string; matchedPattern: string; recommendation: string; }[];
  missingFiles: { file: string; required: boolean; }[];
  configSecurity: { feature: string; status: string; }[];
  staticCodeAnalysis: { severity: string; type: string; message: string; file: string; line: number; codeSnippet: string; recommendation: string; githubUrl: string; }[];
  envAudit: { variable: string; status: string; desc: string; }[];
  bestPractices: { practice: string; status: string; }[];
  securityRecommendations: string[];
  aiSecurityReview?: string;
}

export interface ChatMessage {
  id: string
  sender: 'user' | 'assistant'
  text: string
  timestamp: string
  citations?: { file: string, line: number, githubUrl: string }[]
  mode?: 'advanced' | 'basic'
}

interface RepoStore {
  // State
  currentTab: string
  analyzedRepo: string | null
  isAnalyzing: boolean
  error: string | null
  analysis: RepoAnalysis | null
  chatMessages: ChatMessage[]
  searchQueryFiles: string
  searchQueryApis: string
  aiKey: string | null
  aiProvider: string | null
  
  // AI Summary State
  aiSummary: string | null
  isAiSummaryLoading: boolean
  aiSummaryError: string | null
  
  // AI Security Review State
  aiSecurityReview: string | null
  isAiSecurityReviewLoading: boolean
  aiSecurityReviewError: string | null
  
  // API Explanations State
  apiExplanations: Record<string, { data: string | null, isLoading: boolean, error: string | null }>
  
  // Actions
  setCurrentTab: (tab: string) => void
  setAiKeyAndProvider: (key: string, provider: string) => void
  testAiKey: (provider: string, key: string) => Promise<boolean>
  setSearchQueryFiles: (query: string) => void
  setSearchQueryApis: (query: string) => void
  analyzeRepo: (owner: string, repo: string, force?: boolean) => Promise<void>
  fetchAiSummary: (owner: string, repo: string) => Promise<void>
  fetchAiSecurityReview: (owner: string, repo: string) => Promise<void>
  fetchApiExplanation: (owner: string, repo: string, path: string, method: string) => Promise<void>
  sendChatMessage: (text: string) => Promise<void>
}

export const useRepoStore = create<RepoStore>((set, get) => ({
  currentTab: 'Overview',
  analyzedRepo: null,
  isAnalyzing: false,
  error: null,
  analysis: null,
  aiSummary: null,
  isAiSummaryLoading: false,
  aiSummaryError: null,
  aiSecurityReview: null,
  isAiSecurityReviewLoading: false,
  aiSecurityReviewError: null,
  apiExplanations: {},
  chatMessages: [
    {
      id: 'welcome',
      sender: 'assistant',
      text: "Hello! I am your RepoPilot Onboarding Assistant. Paste a GitHub repository URL above to get started.",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ],
  searchQueryFiles: '',
  searchQueryApis: '',
  aiKey: storedProviderValid ? sessionStorage.getItem('repopilot_ai_key') : null,
  aiProvider: storedProviderValid ? storedProvider : null,

  setCurrentTab: (tab: string) => set({ currentTab: tab }),
  
  setAiKeyAndProvider: (key: string, provider: string) => {
    if (key && provider !== 'default') {
      sessionStorage.setItem('repopilot_ai_key', key)
      sessionStorage.setItem('repopilot_ai_provider', provider)
      set({ aiKey: key, aiProvider: provider })
    } else {
      sessionStorage.removeItem('repopilot_ai_key')
      sessionStorage.removeItem('repopilot_ai_provider')
      set({ aiKey: null, aiProvider: null })
    }
  },

  testAiKey: async (provider: string, key: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/ai/test-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, key })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Validation failed');
      return data.valid === true;
    } catch (error: any) {
      throw error;
    }
  },
  
  setSearchQueryFiles: (query: string) => set({ searchQueryFiles: query }),
  
  setSearchQueryApis: (query: string) => set({ searchQueryApis: query }),
  
  analyzeRepo: async (owner: string, repo: string, force = false) => {
    set({ 
      analyzedRepo: `${owner}/${repo}`, 
      isAnalyzing: true, 
      error: null,
      analysis: null,
      aiSummary: null,
      isAiSummaryLoading: false,
      aiSummaryError: null,
      aiSecurityReview: null,
      isAiSecurityReviewLoading: false,
      aiSecurityReviewError: null,
      apiExplanations: {},
      chatMessages: [
        {
          id: 'welcome2',
          sender: 'assistant',
          text: `Analyzing ${owner}/${repo}... this might take a few seconds depending on the repository size.`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]
    })
    
    try {
      const data = await analyzeRepository(owner, repo, force)
      if (!data) {
        set({
          isAnalyzing: false,
          error: 'Analysis completed but returned no data. The server may be experiencing issues.',
          chatMessages: [
            {
              id: `error-null-${Date.now()}`,
              sender: 'assistant',
              text: `Analysis of **${owner}/${repo}** completed but no data was received. This may happen if the GitHub API rate limit is exhausted. Please wait a few minutes and try again.`,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }
          ]
        })
        return
      }
      const existingSummary = data?.summary?.aiExecutiveSummary || null
      set({ 
        analysis: data, 
        isAnalyzing: false,
        aiSummary: existingSummary,
        chatMessages: [
          {
            id: `success-${Date.now()}`,
            sender: 'assistant',
            text: `Successfully analyzed **${owner}/${repo}**! I've extracted ${data.routes.length} routes, ${data.envVars.length} environment variables, and ${data.apis.length} API dependencies.\n\nWhat would you like to know about this repository?`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]
      })

      if (!existingSummary) {
        get().fetchAiSummary(owner, repo)
      }
    } catch (error: any) {
      set({ 
        isAnalyzing: false, 
        error: error?.response?.data?.error || 'Failed to analyze repository',
        chatMessages: [
          {
            id: `error-${Date.now()}`,
            sender: 'assistant',
            text: `Error analyzing repository: ${error?.response?.data?.error || error.message}. Please make sure the repository is public.`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]
      })
    }
  },

  fetchAiSummary: async (owner: string, repo: string) => {
    set({ isAiSummaryLoading: true, aiSummaryError: null })
    try {
      const { aiKey, aiProvider } = get()
      const data = await getAiSummary(owner, repo, aiKey || undefined, aiProvider || undefined)
      set({
        aiSummary: data.aiExecutiveSummary,
        isAiSummaryLoading: false,
        aiSummaryError: data.aiExecutiveSummary ? null : (data.error || 'Gemma 4 summary is unavailable right now')
      })
      // Sync the nested summary inside the analysis object
      set((state) => {
        if (state.analysis) {
          return {
            analysis: {
              ...state.analysis,
              summary: {
                ...state.analysis.summary,
                aiExecutiveSummary: data.aiExecutiveSummary
              }
            }
          }
        }
        return {}
      })
    } catch (error: any) {
      set({
        isAiSummaryLoading: false,
        aiSummaryError: error?.message || 'Failed to load AI summary'
      })
    }
  },

  fetchAiSecurityReview: async (owner: string, repo: string) => {
    set({ isAiSecurityReviewLoading: true, aiSecurityReviewError: null })
    try {
      const { aiKey, aiProvider } = get()
      const data = await getAiSecurityReview(owner, repo, aiKey || undefined, aiProvider || undefined)
      set({
        aiSecurityReview: data.aiSecurityReview,
        isAiSecurityReviewLoading: false,
        aiSecurityReviewError: data.aiSecurityReview ? null : (data.error || 'Gemma 4 review is unavailable right now')
      })
      // Sync the nested summary inside the analysis object
      set((state) => {
        if (state.analysis) {
          return {
            analysis: {
              ...state.analysis,
              aiSecurityReview: data.aiSecurityReview
            }
          }
        }
        return {}
      })
    } catch (error: any) {
      set({
        isAiSecurityReviewLoading: false,
        aiSecurityReviewError: error?.message || 'Failed to load AI security review'
      })
    }
  },

  fetchApiExplanation: async (owner: string, repo: string, path: string, method: string) => {
    const key = `${method}_${path}`
    set((state) => ({
      apiExplanations: {
        ...state.apiExplanations,
        [key]: { data: null, isLoading: true, error: null }
      }
    }))
    try {
      const { aiKey, aiProvider } = get()
      const data = await getApiExplanation(owner, repo, path, method, aiKey || undefined, aiProvider || undefined)
      
      set((state) => ({
        apiExplanations: {
          ...state.apiExplanations,
          [key]: { data: data.aiExplanation, isLoading: false, error: data.aiExplanation ? null : (data.error || 'Gemma 4 explanation is unavailable right now') }
        }
      }))
    } catch (error: any) {
      set((state) => ({
        apiExplanations: {
          ...state.apiExplanations,
          [key]: { data: null, isLoading: false, error: error?.message || 'Failed to load explanation' }
        }
      }))
    }
  },

  sendChatMessage: async (text: string) => {
    const { analyzedRepo, aiKey, aiProvider } = get()
    
    if (!analyzedRepo) return

    const [owner, repo] = analyzedRepo.split('/')

    const userMsg: ChatMessage = {
      id: `m_user_${Date.now()}`,
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    set(state => ({ chatMessages: [...state.chatMessages, userMsg] }))

    try {
      const response = await askAiQuestion(owner, repo, text, aiKey || undefined, aiProvider || undefined)
      
      const aiMsg: ChatMessage = {
        id: `m_ai_${Date.now()}`,
        sender: 'assistant',
        text: response.answer,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        citations: response.citations,
        mode: response.mode
      }

      set(state => ({ chatMessages: [...state.chatMessages, aiMsg] }))
    } catch (error: any) {
      const errorMsg: ChatMessage = {
        id: `m_ai_err_${Date.now()}`,
        sender: 'assistant',
        text: `Error contacting AI service: ${error.response?.data?.error || error.message}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
      set(state => ({ chatMessages: [...state.chatMessages, errorMsg] }))
    }
  }
}))
