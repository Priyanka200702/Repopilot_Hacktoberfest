import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  ShieldAlert, ShieldCheck, AlertTriangle, ShieldBan, FileCode, ExternalLink,
  Settings, Code, FileQuestion, CheckCircle2, ChevronDown, ChevronRight,
  Activity, Sparkles, AlertOctagon, XCircle
} from 'lucide-react'
import { useRepoStore } from '../store/useRepoStore'


interface Vulnerability {
  severity: string;
  type: string;
  message: string;
  file?: string;
  line?: number;
  matchedPattern?: string;
  package?: string;
  installedVersion?: string;
  safeVersion?: string;
  codeSnippet?: string;
  recommendation?: string;
  referenceLink?: string;
}

export default function SecurityTab() {
  const { analysis, aiSecurityReview, isAiSecurityReviewLoading, aiSecurityReviewError, fetchAiSecurityReview, analyzedRepo } = useRepoStore()
  const [filterCategory, setFilterCategory] = useState<string>('All')
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({})

  if (!analysis) return null

  const {
    securityAlerts = [],
    dependencySecurity = [],
    gitHygiene = [],
    configSecurity = [],
    staticCodeAnalysis = [],
    envAudit = [],
    bestPractices = [],
    securityRecommendations = []
  } = analysis

  // Prepare data for Severity Summary
  const allVulnerabilities: Vulnerability[] = [...securityAlerts, ...dependencySecurity, ...gitHygiene, ...staticCodeAnalysis] as Vulnerability[]
  const critical = allVulnerabilities.filter(v => v.severity === 'critical')
  const high = allVulnerabilities.filter(v => v.severity === 'high')
  const medium = allVulnerabilities.filter(v => v.severity === 'medium')
  const low = allVulnerabilities.filter(v => v.severity === 'low')

  const securityScore = analysis.securityScore ?? 100;

  // Filter logic for Vulnerability Explorer
  const getFilteredVulnerabilities = () => {
    switch (filterCategory) {
      case 'Critical': return critical
      case 'High': return high
      case 'Medium': return medium
      case 'Low': return low
      case 'Secrets': return securityAlerts
      case 'Dependencies': return dependencySecurity
      case 'Git Hygiene': return gitHygiene
      case 'Static Analysis': return staticCodeAnalysis
      default: return allVulnerabilities
    }
  }

  const filteredVulns = getFilteredVulnerabilities()

  const toggleExpand = (idx: number) => {
    setExpandedCards(prev => ({ ...prev, [idx]: !prev[idx] }))
  }

  const getSeverityIcon = (severity: string) => {
    switch(severity) {
      case 'critical': return <AlertOctagon className="w-4 h-4 text-purple-500" />
      case 'high': return <ShieldBan className="w-4 h-4 text-red-500" />
      case 'medium': return <AlertTriangle className="w-4 h-4 text-orange-400" />
      case 'low': return <ShieldAlert className="w-4 h-4 text-yellow-400" />
      default: return <ShieldCheck className="w-4 h-4 text-[var(--text-secondary)]" />
    }
  }

  const getSeverityColor = (severity: string) => {
    switch(severity) {
      case 'critical': return 'bg-purple-500/10 border-purple-500/20 dark:border-purple-500/30 text-purple-600 dark:text-purple-400'
      case 'high': return 'bg-red-500/10 border-red-500/30 text-red-400'
      case 'medium': return 'bg-orange-500/10 border-orange-500/30 text-orange-400'
      case 'low': return 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
      default: return 'bg-slate-500/10 border-slate-500/30 text-[var(--text-secondary)]'
    }
  }

  const handleFetchAiReview = () => {
    if (analyzedRepo) {
      const [owner, repo] = analyzedRepo.split('/')
      fetchAiSecurityReview(owner, repo)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6 font-mono text-[var(--text-primary)] text-left pb-12"
    >
      {/* SECTION 1: Security Score & Header */}
      <div className="glass-panel p-6 rounded-xl relative overflow-hidden flex flex-col lg:flex-row justify-between gap-6 border-cyan-500/20">
        <div className="absolute top-0 right-0 w-[400px] h-full bg-gradient-to-l from-cyan-500/10 to-transparent pointer-events-none" />
        
        <div className="space-y-2 relative z-10 flex-1">
          <div className="text-xs text-cyan-600 dark:text-cyan-400 font-semibold uppercase flex items-center space-x-1.5">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Repository Security Intelligence</span>
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-[var(--text-primary)] tracking-tight font-sans">
            Security Dashboard
          </h2>
          <p className="text-[var(--text-secondary)] text-xs md:text-sm font-sans max-w-xl leading-relaxed">
            Comprehensive static analysis of secrets, dependencies, configuration, and code quality.
          </p>
        </div>

        <div className="relative z-10 flex items-center space-x-6 shrink-0 bg-[var(--bg-secondary)] p-4 rounded-xl border border-[var(--border-color)]">
          <div className="space-y-1 text-center">
            <div className="text-[10px] text-[var(--text-secondary)] font-bold uppercase tracking-wider">Security Score</div>
            <div className="flex items-baseline justify-center space-x-1">
              <span className={`text-4xl font-black ${securityScore >= 90 ? 'text-green-400' : securityScore >= 70 ? 'text-yellow-400' : 'text-red-400'}`}>
                {securityScore}
              </span>
              <span className="text-[var(--text-secondary)] text-sm">/ 100</span>
            </div>
          </div>
          
          <div className="h-16 w-px bg-[var(--bg-secondary)]" />
          
          <div className="grid grid-cols-2 gap-2 text-[10px]">
             <div className="flex flex-col items-center p-1.5 bg-[var(--bg-secondary)] rounded border border-[var(--border-color)] w-16">
               <span className="text-[var(--text-secondary)] font-bold">CRIT</span>
               <span className="text-purple-600 dark:text-purple-400 font-bold text-sm">{critical.length}</span>
             </div>
             <div className="flex flex-col items-center p-1.5 bg-[var(--bg-secondary)] rounded border border-[var(--border-color)] w-16">
               <span className="text-[var(--text-secondary)] font-bold">HIGH</span>
               <span className="text-red-400 font-bold text-sm">{high.length}</span>
             </div>
             <div className="flex flex-col items-center p-1.5 bg-[var(--bg-secondary)] rounded border border-[var(--border-color)] w-16">
               <span className="text-[var(--text-secondary)] font-bold">MED</span>
               <span className="text-orange-400 font-bold text-sm">{medium.length}</span>
             </div>
             <div className="flex flex-col items-center p-1.5 bg-[var(--bg-secondary)] rounded border border-[var(--border-color)] w-16">
               <span className="text-[var(--text-secondary)] font-bold">LOW</span>
               <span className="text-yellow-400 font-bold text-sm">{low.length}</span>
             </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="space-y-6 lg:col-span-2">
          
          {/* SECTION 10: AI Security Review */}
          <div className="glass-panel p-5 rounded-xl border border-cyan-500/20 bg-gradient-to-br from-slate-900 to-cyan-950/20 relative overflow-hidden">
            <div className="absolute -top-10 -right-10 w-32 h-32 bg-cyan-500/10 blur-3xl rounded-full pointer-events-none" />
            <div className="flex items-center justify-between mb-3 relative z-10">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                <h3 className="text-[var(--text-primary)] font-bold font-sans">AI Security Review</h3>
              </div>
              {!aiSecurityReview && !isAiSecurityReviewLoading && (
                 <button 
                   onClick={handleFetchAiReview}
                   className="px-3 py-1 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 text-[10px] uppercase font-bold rounded border border-cyan-500/30 transition-colors"
                 >
                   Generate Review
                 </button>
              )}
            </div>
            <div className="relative z-10">
              {isAiSecurityReviewLoading ? (
                <div className="animate-pulse space-y-2">
                  <div className="h-2 bg-[var(--bg-secondary)] rounded w-full"></div>
                  <div className="h-2 bg-[var(--bg-secondary)] rounded w-5/6"></div>
                  <div className="h-2 bg-[var(--bg-secondary)] rounded w-4/6"></div>
                </div>
              ) : aiSecurityReview ? (
                <p className="text-sm text-[var(--text-primary)] font-sans leading-relaxed">
                  {aiSecurityReview}
                </p>
              ) : aiSecurityReviewError ? (
                <p className="text-xs text-[var(--text-secondary)]" title={aiSecurityReviewError}>Gemma 4 could not write the review just now. Press Generate Review to try again.</p>
              ) : (
                <p className="text-xs text-[var(--text-secondary)]">Get a short Gemma 4 review of this repository's security scan.</p>
              )}
            </div>
          </div>

          {/* SECTION 12: Interactive Vulnerability Explorer */}
          <div className="glass-panel rounded-xl overflow-hidden flex flex-col">
            <div className="p-4 border-b border-[var(--border-color)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[var(--bg-secondary)]">
              <h3 className="text-[var(--text-primary)] font-bold font-sans flex items-center space-x-2">
                <Activity className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                <span>Vulnerability Explorer</span>
              </h3>
              
              {/* Filters */}
              <div className="flex flex-wrap gap-1.5">
                {['All', 'Critical', 'High', 'Secrets', 'Dependencies', 'Git Hygiene', 'Static Analysis'].map(cat => (
                  <button
                    key={cat}
                    onClick={() => setFilterCategory(cat)}
                    className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded transition-colors ${
                      filterCategory === cat 
                        ? 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border border-cyan-500/40' 
                        : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-color)] hover:border-[var(--border-color)]'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 space-y-3 max-h-[600px] overflow-y-auto custom-scrollbar">
              {filteredVulns.length === 0 ? (
                <div className="py-12 text-center flex flex-col items-center">
                   <div className="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mb-3">
                     <CheckCircle2 className="w-6 h-6 text-green-400" />
                   </div>
                   <span className="text-sm font-sans text-[var(--text-secondary)]">No vulnerabilities found for this filter.</span>
                </div>
              ) : (
                filteredVulns.map((vuln, idx) => (
                  <div key={idx} className={`rounded-lg border bg-[var(--bg-secondary)] transition-colors ${getSeverityColor(vuln.severity)}`}>
                    <button 
                      onClick={() => toggleExpand(idx)}
                      className="w-full p-3 flex items-start gap-3 text-left hover:bg-white/[0.02] transition-colors"
                    >
                      <div className="mt-0.5">{getSeverityIcon(vuln.severity)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <h4 className="font-bold text-sm text-[var(--text-primary)] font-sans truncate">{vuln.type}</h4>
                          <span className="text-[9px] uppercase font-bold tracking-wider opacity-70 border px-1.5 py-0.5 rounded border-current">
                            {vuln.severity}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--text-primary)] font-sans truncate opacity-90">{vuln.message}</p>
                      </div>
                      <div className="mt-1">
                        {expandedCards[idx] ? <ChevronDown className="w-4 h-4 opacity-50" /> : <ChevronRight className="w-4 h-4 opacity-50" />}
                      </div>
                    </button>
                    
                    <AnimatePresence>
                      {expandedCards[idx] && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden border-t border-[var(--border-color)]"
                        >
                          <div className="p-4 space-y-3 bg-[var(--bg-primary)]">
                            {(vuln as any).matchedPattern && (
                              <div className="flex flex-col space-y-1 text-xs">
                                <span className="text-[var(--text-secondary)] font-bold uppercase text-[9px]">Matched Pattern</span>
                                <span className="text-[var(--text-primary)]">{(vuln as any).matchedPattern}</span>
                              </div>
                            )}
                            {(vuln as any).package && (
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div>
                                  <span className="text-[var(--text-secondary)] font-bold uppercase text-[9px] block">Package</span>
                                  <span className="text-[var(--text-primary)]">{(vuln as any).package} ({(vuln as any).installedVersion})</span>
                                </div>
                                <div>
                                  <span className="text-[var(--text-secondary)] font-bold uppercase text-[9px] block">Safe Version</span>
                                  <span className="text-green-400 font-mono">{(vuln as any).safeVersion}</span>
                                </div>
                              </div>
                            )}
                            {(vuln as any).codeSnippet && (
                              <div className="flex flex-col space-y-1 text-xs">
                                <span className="text-[var(--text-secondary)] font-bold uppercase text-[9px]">Code Snippet</span>
                                <code className="block bg-[var(--bg-primary)] p-2 rounded border border-[var(--border-color)] text-[10px] text-red-400 overflow-x-auto whitespace-pre">
                                  {(vuln as any).codeSnippet}
                                </code>
                              </div>
                            )}
                            {(vuln as any).file && (
                              <div className="flex flex-col space-y-1 text-xs">
                                <span className="text-[var(--text-secondary)] font-bold uppercase text-[9px]">Location</span>
                                <div className="flex items-center space-x-2">
                                  <FileCode className="w-3 h-3 text-cyan-600 dark:text-cyan-400" />
                                  <span className="text-cyan-300 font-mono text-[10px]">{(vuln as any).file}{(vuln as any).line ? `:${(vuln as any).line}` : ''}</span>
                                </div>
                              </div>
                            )}
                            {(vuln as any).recommendation && (
                              <div className="flex flex-col space-y-1 text-xs mt-2 p-2 bg-blue-500/5 border border-blue-500/20 rounded">
                                <span className="text-blue-600 dark:text-blue-400 font-bold uppercase text-[9px]">Recommendation</span>
                                <span className="text-blue-100">{(vuln as any).recommendation}</span>
                              </div>
                            )}
                            {(vuln as any).referenceLink && (
                              <div className="pt-2 flex justify-end">
                                <a 
                                  href={(vuln as any).referenceLink} target="_blank" rel="noreferrer"
                                  className="flex items-center space-x-1 text-[10px] font-bold uppercase text-cyan-600 dark:text-cyan-400 hover:text-cyan-300 transition-colors"
                                >
                                  <span>Reference</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column (Widgets) */}
        <div className="space-y-6">
          
          {/* SECTION 9: Recommendations */}
          <div className="glass-panel p-5 rounded-xl border border-[var(--border-color)]">
            <h3 className="text-[var(--text-primary)] font-bold font-sans text-sm mb-4 flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-green-400" />
              <span>Action Items</span>
            </h3>
            <ul className="space-y-3">
              {securityRecommendations.map((rec, i) => (
                <li key={i} className="flex items-start space-x-2 text-xs text-[var(--text-primary)]">
                  <span className="text-cyan-600 dark:text-cyan-500 mt-0.5 select-none">›</span>
                  <span className="leading-relaxed">{rec}</span>
                </li>
              ))}
              {securityRecommendations.length === 0 && (
                 <li className="text-xs text-[var(--text-secondary)] italic">No specific recommendations.</li>
              )}
            </ul>
          </div>

          {/* SECTION 8: Best Practices */}
          <div className="glass-panel p-5 rounded-xl border border-[var(--border-color)]">
            <h3 className="text-[var(--text-primary)] font-bold font-sans text-sm mb-4 flex items-center space-x-2">
              <Settings className="w-4 h-4 text-[var(--text-secondary)]" />
              <span>Best Practices</span>
            </h3>
            <div className="space-y-2">
              {bestPractices.map((bp, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-[var(--text-secondary)]">{bp.practice}</span>
                  {bp.status === 'Passed' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-slate-600" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* SECTION 5: Configuration */}
          <div className="glass-panel p-5 rounded-xl border border-[var(--border-color)]">
            <h3 className="text-[var(--text-primary)] font-bold font-sans text-sm mb-4 flex items-center space-x-2">
              <Code className="w-4 h-4 text-[var(--text-secondary)]" />
              <span>Configuration Status</span>
            </h3>
            <div className="space-y-2">
              {configSecurity.map((cfg, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-[var(--text-secondary)]">{cfg.feature}</span>
                  <span className={`font-bold text-[9px] uppercase ${cfg.status === 'Configured' ? 'text-green-400' : 'text-[var(--text-secondary)]'}`}>
                    {cfg.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* SECTION 7: Env Variables */}
          <div className="glass-panel p-5 rounded-xl border border-[var(--border-color)]">
            <h3 className="text-[var(--text-primary)] font-bold font-sans text-sm mb-4 flex items-center space-x-2">
              <FileQuestion className="w-4 h-4 text-[var(--text-secondary)]" />
              <span>Env Audit</span>
            </h3>
            <div className="space-y-3">
              {envAudit.length === 0 ? (
                 <div className="text-xs text-[var(--text-secondary)] italic">No environment variables found.</div>
              ) : (
                envAudit.map((env, i) => (
                  <div key={i} className="flex flex-col text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--text-primary)] font-mono">{env.variable}</span>
                      <span className={`font-bold text-[9px] uppercase ${
                        env.status === 'Missing' ? 'text-red-400' :
                        env.status === 'Unused' ? 'text-yellow-400' :
                        env.status === 'Hardcoded Default' ? 'text-orange-400' :
                        'text-green-400'
                      }`}>
                        {env.status}
                      </span>
                    </div>
                    {env.desc && <span className="text-[10px] text-[var(--text-secondary)] mt-0.5">{env.desc}</span>}
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </div>
    </motion.div>
  )
}
