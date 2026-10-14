import { motion } from 'framer-motion'
import { CheckCircle2, XCircle, Clock, Check, ShieldCheck, Lightbulb, Play } from 'lucide-react'
import { useRepoStore } from '../store/useRepoStore'

export default function RepositorySnapshot() {
  const { analysis, aiSummary, aiSummaryError, isAiSummaryLoading, fetchAiSummary } = useRepoStore()

  if (!analysis) return null

  const { summary, entryPoint, setupSteps = [] } = analysis

  const projectType = summary?.projectType || "Unknown Project"
  const architectureType = summary?.architectureType || "Unknown Architecture"
  const primaryTechStack = summary?.primaryTechStack || []
  const complexity = summary?.complexity || "Unknown"
  const onboardingTime = summary?.onboardingTime || "Unknown"
  const projectMaturity = summary?.projectMaturity || []
  const quickInsights = summary?.quickInsights || []

  return (
    <div className="space-y-4 mb-8">
      {/* 1. Main Header / Overview */}
      <div className="glass-panel p-6 rounded-xl border border-[var(--border-color)] relative overflow-hidden">
        {/* Ambient background glow */}
        <div className="absolute top-0 right-0 w-[500px] h-full bg-gradient-to-l from-indigo-500/10 via-purple-500/5 to-transparent pointer-events-none blur-3xl" />

        <div className="flex flex-col lg:flex-row gap-6 relative z-10">

          {/* Left Column: Core Identity */}
          <div className="flex-1 space-y-5">
            <div>
              <div className="flex items-center space-x-3 mb-2">
                <span className="px-3 py-1.5 text-xs uppercase font-bold tracking-wider rounded-full bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 dark:border-indigo-500/30">
                  {projectType}
                </span>
                {architectureType !== "Unknown Architecture" && (
                  <span className="px-3 py-1.5 text-xs uppercase font-bold tracking-wider rounded-full bg-purple-500/10 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/20 dark:border-purple-500/30">
                    {architectureType}
                  </span>
                )}
              </div>
              <h2 className="text-2xl font-bold tracking-tight mb-2">Executive Summary</h2>
              <p className="text-base text-[var(--text-secondary)] leading-relaxed max-w-2xl">
                {isAiSummaryLoading ? (
                  <span className="animate-pulse">Gemma 4 is writing the summary...</span>
                ) : aiSummary ? (
                  aiSummary
                ) : (
                  summary?.oneLiner || 'Repository analysed.'
                )}
              </p>
              {!isAiSummaryLoading && aiSummaryError && (
                <p className="mt-2 text-xs text-[var(--text-secondary)] flex flex-wrap items-center gap-2" title={aiSummaryError}>
                  <span>Gemma 4 summary unavailable right now; showing the static summary.</span>
                  <button
                    onClick={() => analysis?.meta && fetchAiSummary(analysis.meta.owner, analysis.meta.repo)}
                    className="underline underline-offset-2 hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    Retry
                  </button>
                </p>
              )}
            </div>

            <div className="pt-2">
              <span className="text-sm font-bold uppercase tracking-widest text-[var(--text-secondary)] block mb-3">
                Primary Tech Stack
              </span>
              <div className="flex flex-wrap gap-2">
                {primaryTechStack.map((tech) => (
                  <span key={tech} className="px-4 py-1.5 text-sm font-medium rounded-md bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] shadow-sm">
                    {tech}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Stats & Setup */}
          <div className="lg:w-80 flex flex-col gap-3 lg:w-72 shrink-0">
            <div className="bg-[var(--bg-secondary)] rounded-lg p-5 border border-[var(--border-color)] shadow-inner">
              <div className="text-sm font-bold text-[var(--text-secondary)] mb-1 uppercase tracking-wider text-center">Complexity</div>
              <div className="flex justify-center items-center h-8">
                <span className={`font-black text-lg ${complexity === 'Enterprise' || complexity === 'Large' ? 'text-rose-600 dark:text-rose-500' : 'text-[var(--accent-secondary)]'}`}>
                  {complexity}
                </span>
              </div>
            </div>

            <div className="bg-[var(--bg-secondary)] rounded-lg p-5 border border-[var(--border-color)] shadow-inner">
              <div className="flex items-center justify-center space-x-2 text-sm font-bold text-[var(--text-secondary)] mb-1 uppercase tracking-wider">
                <Clock className="w-4 h-4" />
                <span>Onboarding</span>
              </div>
              <div className="flex justify-center items-center h-8">
                <span className="font-black text-lg text-amber-600 dark:text-amber-500">{onboardingTime}</span>
              </div>
            </div>

            <div className="bg-[var(--bg-secondary)] rounded-lg p-5 border border-[var(--border-color)] shadow-inner">
              <div className="flex items-center space-x-2 text-sm font-bold text-[var(--text-secondary)] mb-2 uppercase tracking-wider">
                <Play className="w-4 h-4" />
                <span>Primary Entry Point</span>
              </div>
              <div className="bg-[var(--bg-primary)] rounded p-3 overflow-hidden border border-[var(--border-color)]">
                <code className="text-sm text-[var(--text-primary)] font-mono whitespace-nowrap">
                  {entryPoint?.file || 'N/A'}
                </code>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Grid for Developer Guide, Project Maturity, Quick Insights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Developer Starting Guide */}
        <div className="glass-panel p-6 rounded-xl border border-[var(--border-color)]">
          <div className="flex items-center space-x-2 mb-6">
            <CheckCircle2 className="w-5 h-5 text-[var(--text-secondary)]" />
            <h3 className="font-bold text-base uppercase tracking-wider text-[var(--text-secondary)]">Developer Starting Guide</h3>
          </div>
          <div className="space-y-4">
            {setupSteps.map((step, idx) => (
              <div key={idx} className="flex items-start space-x-3 group">
                <div className="mt-0.5 opacity-50 group-hover:opacity-100 transition-opacity">
                  <Check className="w-4 h-4 text-[var(--accent-secondary)]" />
                </div>
                <span className="text-base text-[var(--text-primary)] group-hover:text-[var(--accent-primary)] transition-colors">
                  {step.title}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Project Maturity */}
        <div className="glass-panel p-6 rounded-xl border border-[var(--border-color)]">
          <div className="flex items-center space-x-2 mb-6">
            <ShieldCheck className="w-5 h-5 text-[var(--text-secondary)]" />
            <h3 className="font-bold text-base uppercase tracking-wider text-[var(--text-secondary)]">Project Maturity</h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {projectMaturity.map((item, idx) => (
              <div key={idx} className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-md p-3 flex items-center justify-between shadow-sm">
                <span className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">{item.check}</span>
                {item.status === 'Present' || item.status === 'Configured' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-500" />
                ) : (
                  <XCircle className="w-4 h-4 text-[var(--border-color)]" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Quick Insights */}
        <div className="glass-panel p-6 rounded-xl border border-[var(--border-color)]">
          <div className="flex items-center space-x-2 mb-6">
            <Lightbulb className="w-5 h-5 text-amber-600 dark:text-amber-500" />
            <h3 className="font-bold text-base uppercase tracking-wider text-[var(--text-secondary)]">Quick Insights</h3>
          </div>
          <div className="space-y-3">
            {quickInsights.map((insight, idx) => (
              <div key={idx} className="flex items-start space-x-3 bg-[var(--bg-secondary)] p-4 rounded-lg border border-[var(--border-color)] shadow-sm">
                <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                <span className="text-base text-[var(--text-primary)] leading-snug">{insight}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
