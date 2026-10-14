import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  History,
  X,
  Loader2,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Sparkles,
  GitCommitHorizontal,
  FileDiff,
  ArrowRightLeft,
  Info,
} from 'lucide-react'
import { useRepoStore } from '../store/useRepoStore'
import { useUIStore } from '../store/useUIStore'
import {
  getFileStory,
  getCommitFileDiff,
  timeMachineErrorMessage,
  type FileStoryResponse,
  type StoryChapter,
  type StructuralFacts,
  type TimelineEntry,
  type CommitFileDiff,
  type AiInfo,
  type Source,
} from '../lib/timeMachine'

interface FileTimeMachineProps {
  owner: string
  repo: string
  path: string
  /** Commit SHA the dashboard analysed; keeps the story consistent with the rest of the UI. */
  refSha?: string
  onClose: () => void
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; data: FileStoryResponse }

const LOADING_STEPS = [
  'Fetching the commits that touched this file...',
  'Reading the diffs of the important commits...',
  'Following renames and moves...',
  'Asking Gemma to explain the history...',
]

const KIND_STYLE: Record<string, string> = {
  origin: 'text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  rename: 'text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/10',
  removal: 'text-rose-600 dark:text-rose-400 border-rose-500/30 bg-rose-500/10',
  security: 'text-rose-600 dark:text-rose-400 border-rose-500/30 bg-rose-500/10',
  refactor: 'text-violet-600 dark:text-violet-400 border-violet-500/30 bg-violet-500/10',
  feature: 'text-cyan-600 dark:text-cyan-400 border-cyan-500/30 bg-cyan-500/10',
  fix: 'text-orange-600 dark:text-orange-400 border-orange-500/30 bg-orange-500/10',
}

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'unknown date'

function SourceBadge({ source, confidence }: { source: Source; confidence?: string | null }) {
  if (source === 'gemma') {
    return (
      <span
        title="Explanation written by Gemma from the commit evidence. Inferred, not a Git fact."
        className="inline-flex items-center gap-1 text-[9px] font-mono font-bold tracking-wider uppercase px-1.5 py-0.5 rounded border border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300"
      >
        <Sparkles className="w-2.5 h-2.5" /> Gemma{confidence ? ` · ${confidence} confidence` : ''}
      </span>
    )
  }
  return (
    <span
      title="Built directly from Git data (commit message, diff, file contents)."
      className="inline-flex items-center gap-1 text-[9px] font-mono font-bold tracking-wider uppercase px-1.5 py-0.5 rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
    >
      <GitCommitHorizontal className="w-2.5 h-2.5" /> Git facts
    </span>
  )
}

function AiStatusBanner({ ai }: { ai: AiInfo }) {
  if (ai.status === 'ok' || ai.status === 'partial') {
    return (
      <div className="flex items-center gap-2 text-[10px] font-mono text-violet-600 dark:text-violet-300">
        <Sparkles className="w-3.5 h-3.5" />
        <span>
          Explained by {ai.model || 'Gemma'}{ai.backend ? ` via ${ai.backend}` : ''}
          {ai.status === 'partial' ? ' · some model output was rejected by validation' : ''}
        </span>
      </div>
    )
  }
  const text =
    ai.status === 'not_configured'
      ? 'Gemma is not configured on the server (set GEMINI_API_KEY, OPENROUTER_API_KEY or OLLAMA_URL). Showing Git facts only.'
      : ai.message || 'Gemma was unavailable. Showing Git facts only.'
  return (
    <div className="flex items-start gap-2 text-[11px] font-sans p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
      <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span>{text}</span>
    </div>
  )
}

function Chips({ items, tone, label }: { items: string[]; tone: 'add' | 'remove' | 'neutral'; label: string }) {
  if (!items || items.length === 0) return null
  const toneClass =
    tone === 'add'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : tone === 'remove'
        ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
        : 'border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-secondary)]">{label}</span>
      {items.slice(0, 8).map(item => (
        <code key={item} className={`text-[10px] px-1.5 py-0.5 rounded border ${toneClass}`}>{item}</code>
      ))}
      {items.length > 8 && <span className="text-[10px] text-[var(--text-secondary)]">+{items.length - 8} more</span>}
    </div>
  )
}

function FactsRow({ facts }: { facts: StructuralFacts | null | undefined }) {
  if (!facts) return null
  return (
    <div className="space-y-1.5">
      <Chips label="Added" tone="add" items={[...facts.addedSymbols, ...facts.addedRoutes]} />
      <Chips label="Removed" tone="remove" items={[...facts.removedSymbols, ...facts.removedRoutes]} />
      <Chips label="Changed" tone="neutral" items={facts.modifiedSymbols} />
      <Chips label="New imports" tone="add" items={facts.addedImports} />
      <Chips label="Dropped imports" tone="remove" items={facts.removedImports} />
    </div>
  )
}

function DiffView({ patch, truncated, totalLines }: { patch: string | null; truncated: boolean; totalLines: number }) {
  if (!patch) {
    return <p className="text-[11px] text-[var(--text-secondary)] font-sans">GitHub did not provide a diff for this file in this commit (very large or binary change).</p>
  }
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden">
      <pre className="text-[10.5px] leading-[1.45] font-mono overflow-x-auto max-h-80 p-3">
        {patch.split('\n').map((line, i) => {
          const cls = line.startsWith('@@')
            ? 'text-cyan-600 dark:text-cyan-400'
            : line.startsWith('+')
              ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/5'
              : line.startsWith('-')
                ? 'text-rose-700 dark:text-rose-400 bg-rose-500/5'
                : 'text-[var(--text-secondary)]'
          return <div key={i} className={`whitespace-pre ${cls}`}>{line || ' '}</div>
        })}
      </pre>
      {truncated && (
        <div className="text-[10px] font-mono text-[var(--text-secondary)] border-t border-[var(--border-color)] px-3 py-1.5">
          Showing the first lines of a {totalLines}-line diff. Open the commit on GitHub for the full change.
        </div>
      )}
    </div>
  )
}

function ChapterCard({ chapter, index }: { chapter: StoryChapter; index: number }) {
  const [showDiff, setShowDiff] = useState(false)
  const reasonLabel =
    chapter.reasonBasis === 'commit_message' ? 'from the commit message' : chapter.reasonBasis === 'diff' ? 'from the diff' : null

  return (
    <div className="relative pl-8">
      <div className="absolute left-[7px] top-1.5 w-3 h-3 rounded-full border-2 border-cyan-500 bg-[var(--bg-primary)]" />
      <div className="glass-panel rounded-xl p-4 space-y-3 border border-[var(--border-color)]">
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono">
          <span className="font-bold text-cyan-600 dark:text-cyan-400 tracking-wider">CHAPTER {index + 1}</span>
          <span className="text-[var(--text-secondary)]">{fmtDate(chapter.date)}</span>
          <span className="text-[var(--text-secondary)]">· {chapter.author}</span>
          <span
            title="Category guessed from Git status and commit-message keywords"
            className={`uppercase tracking-wider px-1.5 py-0.5 rounded border ${KIND_STYLE[chapter.kind] || 'border-[var(--border-color)] text-[var(--text-secondary)]'}`}
          >
            {chapter.kind}
          </span>
          {chapter.stats && (
            <span className="text-[var(--text-secondary)]">
              <span className="text-emerald-600 dark:text-emerald-400">+{chapter.stats.additions}</span>{' '}
              <span className="text-rose-600 dark:text-rose-400">-{chapter.stats.deletions}</span>
            </span>
          )}
          <span className="ml-auto"><SourceBadge source={chapter.source} confidence={chapter.confidence} /></span>
        </div>

        <h4 className="text-sm font-bold text-[var(--text-primary)] font-sans">{chapter.title}</h4>

        {chapter.renamedFrom && (
          <div className="flex items-center gap-1.5 text-[11px] font-mono text-amber-700 dark:text-amber-300">
            <ArrowRightLeft className="w-3.5 h-3.5" /> moved from <code>{chapter.renamedFrom}</code>
          </div>
        )}

        <p className="text-xs leading-relaxed text-[var(--text-secondary)] font-sans">{chapter.explanation}</p>

        {chapter.source === 'gemma' && (
          <div className="text-xs font-sans">
            {chapter.reasonForChange ? (
              <p className="text-[var(--text-primary)]">
                <span className="font-semibold">Why: </span>
                {chapter.reasonForChange}
                {reasonLabel && <span className="text-[10px] font-mono text-[var(--text-secondary)]"> ({reasonLabel})</span>}
              </p>
            ) : (
              <p className="text-[var(--text-secondary)] italic">The reason for this change is not stated in the commit evidence.</p>
            )}
            {chapter.impact && <p className="text-[var(--text-secondary)] mt-1"><span className="font-semibold text-[var(--text-primary)]">Impact: </span>{chapter.impact}</p>}
          </div>
        )}

        <div className="border-t border-[var(--border-color)] pt-2.5 space-y-2">
          <div className="text-[10px] font-mono text-[var(--text-secondary)] flex items-start gap-1.5">
            <GitCommitHorizontal className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span className="break-words"><code>{chapter.shortSha}</code> “{chapter.message.split('\n')[0]}”</span>
          </div>
          <FactsRow facts={chapter.facts} />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowDiff(v => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[10px] font-bold tracking-wider text-[var(--text-primary)] hover:border-cyan-500/40 cursor-pointer"
          >
            <FileDiff className="w-3.5 h-3.5" /> {showDiff ? 'HIDE DIFF' : 'SHOW DIFF'}
          </button>
          <a href={chapter.commitUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[var(--border-color)] text-[10px] font-bold tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <ExternalLink className="w-3.5 h-3.5" /> COMMIT
          </a>
          <a href={chapter.blobUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[var(--border-color)] text-[10px] font-bold tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <ExternalLink className="w-3.5 h-3.5" /> FILE AT THIS POINT
          </a>
        </div>

        <AnimatePresence>
          {showDiff && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <DiffView patch={chapter.patch.excerpt} truncated={chapter.patch.truncated} totalLines={chapter.patch.totalLines} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function TimelineRow({ entry, owner, repo }: { entry: TimelineEntry; owner: string; repo: string }) {
  const [open, setOpen] = useState(false)
  const [diff, setDiff] = useState<CommitFileDiff | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && !diff && !loading) {
      setLoading(true)
      setError(null)
      try {
        setDiff(await getCommitFileDiff(owner, repo, entry.sha, entry.path))
      } catch (err) {
        setError(timeMachineErrorMessage(err))
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <div className={`rounded-lg border ${entry.isMilestone ? 'border-cyan-500/30 bg-cyan-500/5' : 'border-[var(--border-color)]'} `}>
      <button onClick={toggle} className="w-full flex items-center gap-3 px-3 py-2 text-left cursor-pointer">
        <code className="text-[10px] text-[var(--text-secondary)] shrink-0">{entry.shortSha}</code>
        <span className="text-[10px] font-mono text-[var(--text-secondary)] shrink-0 w-24">{fmtDate(entry.date)}</span>
        <span className="text-xs font-sans text-[var(--text-primary)] truncate flex-1">{entry.title}</span>
        {entry.ref && <span className="text-[9px] font-mono font-bold text-cyan-600 dark:text-cyan-400 shrink-0">MILESTONE</span>}
        {open ? <ChevronUp className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {loading && <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading diff...</div>}
          {error && <div className="text-[11px] text-rose-600 dark:text-rose-400">{error}</div>}
          {diff && (
            diff.file ? (
              <>
                <FactsRow facts={diff.file.facts} />
                <DiffView patch={diff.file.patch.excerpt} truncated={diff.file.patch.truncated} totalLines={diff.file.patch.totalLines} />
              </>
            ) : (
              <p className="text-[11px] text-[var(--text-secondary)]">This commit does not list a change to this path (it may touch more than 300 files).</p>
            )
          )}
          <a href={entry.commitUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] font-mono text-cyan-600 dark:text-cyan-400"><ExternalLink className="w-3 h-3" /> View on GitHub</a>
        </div>
      )}
    </div>
  )
}

export default function FileTimeMachine({ owner, repo, path, refSha, onClose }: FileTimeMachineProps) {
  const { aiKey, aiProvider } = useRepoStore()
  const { theme } = useUIStore()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [step, setStep] = useState(0)
  const [reloadToken, setReloadToken] = useState(0)
  const [showAllCommits, setShowAllCommits] = useState(false)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    let cancelled = false
    getFileStory({ owner, repo, path, ref: refSha, refresh: reloadToken > 0, aiKey, aiProvider })
      .then(data => { if (!cancelled) setState({ status: 'done', data }) })
      .catch(err => { if (!cancelled) setState({ status: 'error', message: timeMachineErrorMessage(err) }) })
    return () => { cancelled = true }
  }, [owner, repo, path, refSha, aiKey, aiProvider, reloadToken])

  useEffect(() => {
    if (state.status !== 'loading') return
    const id = setInterval(() => setStep(s => (s + 1) % LOADING_STEPS.length), 2200)
    return () => clearInterval(id)
  }, [state.status])

  useEffect(() => {
    // One stable listener that always calls the latest onClose. Re-registering on every
    // render could drop an Escape press when another listener re-renders the parent mid-event.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const reload = () => {
    setState({ status: 'loading' })
    setStep(0)
    setReloadToken(t => t + 1)
  }

  const story = state.status === 'done' ? state.data.story : null
  const fileName = path.split('/').pop()

  // Rendered in a portal: dashboard tabs live inside transformed (animated) containers,
  // which would otherwise trap a fixed overlay underneath the top navbar. The theme
  // class is re-applied because the portal sits outside the app's theme wrapper.
  return createPortal(
    <div className={theme}>
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex justify-end bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.aside
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        transition={{ type: 'spring', damping: 26, stiffness: 260 }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`History of ${path}`}
        className="h-full w-full max-w-3xl overflow-y-auto bg-[var(--bg-primary)] text-[var(--text-primary)] border-l border-[var(--border-color)] shadow-2xl text-left"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[var(--bg-primary)]/95 backdrop-blur border-b border-[var(--border-color)] px-5 py-4 space-y-2">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 shrink-0">
              <History className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-mono font-bold tracking-widest text-cyan-600 dark:text-cyan-400">FILE TIME MACHINE</div>
              <h2 className="text-lg font-bold text-[var(--text-primary)] font-sans truncate">{fileName}</h2>
              <p className="text-[11px] font-mono text-[var(--text-secondary)] truncate">{path}</p>
            </div>
            <button onClick={reload} disabled={state.status === 'loading'} title="Rebuild the story" className="p-2 rounded-lg border border-[var(--border-color)] text-[var(--text-primary)] hover:border-cyan-500/40 disabled:opacity-40 cursor-pointer">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={onClose} title="Close" className="p-2 rounded-lg border border-[var(--border-color)] text-[var(--text-primary)] hover:border-rose-500/40 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
          {story && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-[var(--text-secondary)]">
              <span><strong className="text-[var(--text-primary)]">{story.history.commitCount}{story.history.truncated ? '+' : ''}</strong> commits</span>
              <span><strong className="text-[var(--text-primary)]">{story.chapters.length}</strong> milestones</span>
              <span>since <strong className="text-[var(--text-primary)]">{fmtDate(story.origin.date)}</strong></span>
              {story.file.pathHistory.length > 1 && <span>moved {story.file.pathHistory.length - 1}×</span>}
              {story.file.state === 'deleted' && <span className="text-rose-600 dark:text-rose-400">deleted at the analysed commit</span>}
            </div>
          )}
        </div>

        <div className="p-5 space-y-5">
          {state.status === 'loading' && (
            <div className="py-24 flex flex-col items-center gap-4">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-600 dark:text-cyan-400" />
              <motion.p key={step} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="text-xs font-mono text-[var(--text-secondary)]">
                {LOADING_STEPS[step]}
              </motion.p>
            </div>
          )}

          {state.status === 'error' && (
            <div className="p-8 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] flex flex-col items-center gap-3 text-center">
              <AlertCircle className="w-8 h-8 text-rose-500" />
              <p className="text-sm text-[var(--text-secondary)] font-sans">{state.message}</p>
              <button onClick={reload} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border-color)] text-xs font-bold cursor-pointer">
                <RefreshCw className="w-3.5 h-3.5" /> RETRY
              </button>
            </div>
          )}

          {state.status === 'done' && !story && (
            <div className="p-8 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] text-center space-y-2">
              <History className="w-8 h-8 mx-auto text-[var(--text-secondary)]" />
              <p className="text-sm text-[var(--text-primary)] font-semibold">No history found</p>
              <p className="text-xs text-[var(--text-secondary)] font-sans">{state.data.message}</p>
            </div>
          )}

          {story && (
            <>
              <AiStatusBanner ai={story.ai} />

              {/* Summary */}
              <section className="glass-panel rounded-xl p-4 space-y-2 border border-[var(--border-color)]">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-mono font-bold tracking-widest text-[var(--text-secondary)]">THE STORY SO FAR</h3>
                  <SourceBadge source={story.summary.source} />
                </div>
                <p className="text-sm leading-relaxed text-[var(--text-primary)] font-sans">{story.summary.text}</p>
              </section>

              {/* Origin */}
              <section className="glass-panel rounded-xl p-4 space-y-2.5 border border-emerald-500/20">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[10px] font-mono font-bold tracking-widest text-emerald-600 dark:text-emerald-400">ORIGIN</h3>
                  <SourceBadge source={story.origin.source} />
                </div>
                <p className="text-xs font-sans text-[var(--text-secondary)]">
                  {story.origin.confirmed ? 'Created' : 'Earliest known version'} on <strong className="text-[var(--text-primary)]">{fmtDate(story.origin.date)}</strong> by {story.origin.author}
                  {story.origin.path !== story.file.path && <> as <code>{story.origin.path}</code></>} in <code>{story.origin.shortSha}</code> “{story.origin.message.split('\n')[0]}”.
                </p>
                {story.origin.explanation && <p className="text-xs leading-relaxed text-[var(--text-primary)] font-sans">{story.origin.explanation}</p>}
                <div className="flex flex-wrap gap-2">
                  <a href={story.origin.commitUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] font-mono text-cyan-600 dark:text-cyan-400"><ExternalLink className="w-3 h-3" /> Origin commit</a>
                  {story.origin.blobUrl && <a href={story.origin.blobUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] font-mono text-cyan-600 dark:text-cyan-400"><ExternalLink className="w-3 h-3" /> First version of the file</a>}
                </div>
              </section>

              {/* Chapters */}
              <section className="space-y-3">
                <h3 className="text-[10px] font-mono font-bold tracking-widest text-[var(--text-secondary)]">MILESTONES</h3>
                <div className="relative space-y-4 before:absolute before:left-[12px] before:top-2 before:bottom-2 before:w-px before:bg-[var(--border-color)]">
                  {story.chapters.map((ch, i) => <ChapterCard key={ch.sha} chapter={ch} index={i} />)}
                </div>
              </section>

              {/* Architectural evolution */}
              {story.architecturalEvolution && (
                <section className="glass-panel rounded-xl p-4 space-y-2 border border-[var(--border-color)]">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-mono font-bold tracking-widest text-[var(--text-secondary)]">HOW ITS RESPONSIBILITIES CHANGED</h3>
                    <SourceBadge source={story.architecturalEvolution.source} />
                  </div>
                  <p className="text-xs leading-relaxed text-[var(--text-primary)] font-sans">{story.architecturalEvolution.text}</p>
                </section>
              )}

              {/* Current state + comparison */}
              <section className="glass-panel rounded-xl p-4 space-y-3 border border-cyan-500/20">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-mono font-bold tracking-widest text-cyan-600 dark:text-cyan-400">TODAY VS. THE FIRST VERSION</h3>
                  <SourceBadge source={story.currentState.source} />
                </div>
                {story.currentState.explanation && <p className="text-xs leading-relaxed text-[var(--text-primary)] font-sans">{story.currentState.explanation}</p>}
                {story.comparison && (
                  <>
                    <div className="grid grid-cols-3 gap-px rounded-lg overflow-hidden border border-[var(--border-color)] text-[11px] font-mono">
                      {[
                        ['', 'First version', 'Today'],
                        ['Lines', story.comparison.origin.linesOfCode, story.comparison.current.linesOfCode],
                        ['Functions', story.comparison.origin.functions, story.comparison.current.functions],
                        ['Imports', story.comparison.origin.imports.length, story.comparison.current.imports.length],
                        ['Exports', story.comparison.origin.exports.length, story.comparison.current.exports.length],
                      ].map((row, r) => row.map((cell, c) => (
                        <div key={`${r}-${c}`} className={`px-2.5 py-1.5 bg-[var(--bg-secondary)] ${r === 0 || c === 0 ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)] font-bold'}`}>{cell}</div>
                      )))}
                    </div>
                    <Chips label="Imports gained" tone="add" items={story.comparison.importsAdded} />
                    <Chips label="Imports lost" tone="remove" items={story.comparison.importsRemoved} />
                  </>
                )}
                {story.currentState.lingeringInfluences.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-secondary)]">Earlier changes that still shape it</div>
                    {story.currentState.lingeringInfluences.map(l => {
                      const idx = story.chapters.findIndex(c => c.sha === l.sha)
                      return (
                        <p key={l.ref} className="text-xs font-sans text-[var(--text-secondary)]">
                          <span className="font-mono font-bold text-cyan-600 dark:text-cyan-400">Chapter {idx + 1}: </span>{l.note}
                        </p>
                      )
                    })}
                  </div>
                )}
              </section>

              {/* Gaps & uncertainty */}
              {(story.history.gaps.length > 0 || story.uncertainties.length > 0) && (
                <section className="rounded-xl p-4 space-y-1.5 border border-amber-500/25 bg-amber-500/5">
                  <h3 className="text-[10px] font-mono font-bold tracking-widest text-amber-700 dark:text-amber-300">WHAT THIS HISTORY CANNOT TELL YOU</h3>
                  {[...story.history.gaps, ...story.uncertainties].map((g, i) => (
                    <p key={i} className="text-xs font-sans text-[var(--text-secondary)]">• {g.replace(/`/g, '')}</p>
                  ))}
                </section>
              )}

              {/* All commits */}
              <section className="space-y-2">
                <button onClick={() => setShowAllCommits(v => !v)} className="flex items-center gap-2 text-[10px] font-mono font-bold tracking-widest text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer">
                  {showAllCommits ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  ALL {story.timeline.length} COMMITS TO THIS FILE
                </button>
                {showAllCommits && (
                  <div className="space-y-1.5">
                    {story.timeline.map(entry => <TimelineRow key={entry.sha} entry={entry} owner={owner} repo={repo} />)}
                  </div>
                )}
              </section>

              <footer className="text-[10px] font-mono text-[var(--text-secondary)] border-t border-[var(--border-color)] pt-3 flex flex-wrap gap-x-4 gap-y-1">
                <span>GitHub calls: {state.status === 'done' ? state.data.meta.apiCalls.github : 0} (+{state.status === 'done' ? state.data.meta.apiCalls.githubCached : 0} cached)</span>
                <span>Gemma calls: {state.status === 'done' ? state.data.meta.apiCalls.ai ?? 0 : 0}</span>
                <span>{state.status === 'done' && state.data.meta.cache === 'hit' ? 'Served from cache' : 'Freshly generated'}</span>
              </footer>
            </>
          )}
        </div>
      </motion.aside>
    </motion.div>
    </div>,
    document.body
  )
}
