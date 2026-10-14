/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Loader2, ArrowLeft, AlertCircle, FileCode, RefreshCw } from 'lucide-react'
import { useRepoStore } from '../store/useRepoStore'
import { useVoiceStore } from '../store/useVoiceStore'
import Navbar from './Navbar'
import { getDetailedFileAnalysis } from '../lib/api'
import ReactMarkdown from 'react-markdown'

const loadingTexts = [
  "Gemma 4 is reading the file...",
  "Explaining the key functions...",
  "Writing the walkthrough (large files can take up to a minute)..."
]

export default function LineByLineAnalysis() {
  const { owner, repo } = useParams()
  const [searchParams] = useSearchParams()
  const path = searchParams.get('path')
  const sha = searchParams.get('sha')
  const navigate = useNavigate()

  const { aiKey, aiProvider } = useRepoStore()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<string | null>(null)
  // Set when Gemma could not finish and the server returned its static-analysis fallback.
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null)
  const [loadingTextIndex, setLoadingTextIndex] = useState(0)

  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      setLoadingTextIndex(prev => (prev + 1) % loadingTexts.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [loading]);

  const fetchAnalysis = async () => {
    if (!owner || !repo || !path || !sha) {
      setError('Missing parameters for line-by-line analysis.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    setAnalysis(null)
    setFallbackNotice(null)
    setLoadingTextIndex(0)

    try {
      const response = await getDetailedFileAnalysis(owner, repo, path, sha, aiKey || undefined, aiProvider || undefined)
      setAnalysis(response.analysis)
      // Let the voice assistant explain this walkthrough ("explain this file").
      useVoiceStore.getState().setPageContext({ kind: 'detailed-analysis', path, text: response.analysis })
      setFallbackNotice(response.provider === 'fallback' ? (response.notice || 'Gemma 4 was unavailable; showing static analysis.') : null)
    } catch (err: any) {
      console.error(err)
      setError(err?.response?.data?.error || 'Unable to reach the analysis service. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAnalysis()
  }, [owner, repo, path, sha, aiKey, aiProvider])

  useEffect(() => () => useVoiceStore.getState().setPageContext(null), [])

  return (
    <div className="flex-grow flex min-h-screen overflow-hidden relative z-10 flex-col bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans">
      <Navbar onToggleMobileMenu={() => {}} />

      <main data-voice-scroll className="flex-grow p-4 md:p-6 overflow-y-auto relative grid-bg">
        <div className="absolute inset-0 scanlines opacity-5 pointer-events-none" />

        <div className="max-w-4xl mx-auto space-y-6 relative z-10">

          <div className="glass-panel p-6 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] space-y-4">
            <div className="flex items-center space-x-3 border-b border-[var(--border-color)] pb-4">
              <FileCode className="w-6 h-6 text-cyan-600 dark:text-cyan-400" />
              <div>
                <h1 className="text-xl font-bold text-[var(--text-primary)]">{path?.split('/').pop()}</h1>
                <p className="text-xs text-[var(--text-secondary)] font-mono">{path}</p>
              </div>
            </div>

            {loading && (
              <div className="flex flex-col items-center justify-center py-20 space-y-5">
                <Loader2 className="w-8 h-8 text-cyan-600 dark:text-cyan-400 animate-spin" />
                <motion.p
                  key={loadingTextIndex}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="text-sm text-cyan-700 dark:text-cyan-300 font-mono font-semibold dark:font-normal"
                >
                  {loadingTexts[loadingTextIndex]}
                </motion.p>
              </div>
            )}

            {error && !loading && (
              <div className="p-8 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl flex flex-col items-center justify-center space-y-4">
                <AlertCircle className="w-10 h-10 text-[var(--text-secondary)]" />
                <p className="text-[var(--text-secondary)] font-sans text-sm">{error}</p>
                <button 
                  onClick={fetchAnalysis}
                  className="mt-2 flex items-center space-x-2 px-4 py-2 bg-[var(--bg-secondary)] hover:bg-slate-700 border border-[var(--border-color)] text-[var(--text-primary)] rounded-lg text-xs font-bold transition-all"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>RETRY ANALYSIS</span>
                </button>
              </div>
            )}

            {analysis && !loading && !error && fallbackNotice && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs font-sans">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="flex-1">{fallbackNotice}</span>
                <button
                  onClick={fetchAnalysis}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md border border-amber-500/40 hover:bg-amber-500/10 text-[10px] font-bold tracking-wider cursor-pointer shrink-0"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>RETRY WITH GEMMA 4</span>
                </button>
              </div>
            )}

            {analysis && !loading && !error && (
              <div className="analysis-prose prose dark:prose-invert prose-sm max-w-none prose-pre:bg-[var(--bg-secondary)] prose-pre:border prose-pre:border-[var(--border-color)]">
                <ReactMarkdown>{analysis}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
