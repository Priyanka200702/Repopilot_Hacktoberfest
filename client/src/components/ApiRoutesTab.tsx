import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Terminal, Search, Lock, Unlock, ChevronDown, ChevronUp, 
  ExternalLink, Activity, Database, Shield, Zap,
  Cpu, FileCode, Sparkles, Server
} from 'lucide-react'
import { useRepoStore } from '../store/useRepoStore'

export default function ApiRoutesTab() {
  const { analysis, searchQueryApis, setSearchQueryApis, fetchApiExplanation, apiExplanations, analyzedRepo } = useRepoStore()
  
  const [selectedMethod, setSelectedMethod] = useState<string>('All')
  const [filterAuth, setFilterAuth] = useState<string>('All') // All, Protected, Public
  const [filterType, setFilterType] = useState<string>('All') // All, CRUD, External
  
  const [expandedRoute, setExpandedRoute] = useState<string | null>(null)

  if (!analysis) return null;

  const routes = analysis.routes || [];
  const apiHealth = analysis.apiHealth || 100;

  // Overview Stats
  const totalEndpoints = routes.length;
  const getCount = routes.filter(r => r.method === 'GET').length;
  const postCount = routes.filter(r => r.method === 'POST').length;
  const putPatchCount = routes.filter(r => r.method === 'PUT' || r.method === 'PATCH').length;
  const deleteCount = routes.filter(r => r.method === 'DELETE').length;
  
  const protectedCount = routes.filter(r => r.auth).length;
  
  const dynamicCount = routes.filter(r => r.path.includes(':')).length;
  
  const controllers = new Set(routes.map(r => r.controller).filter(Boolean));

  // Filters
  const filteredRoutes = routes.filter((route) => {
    const matchesSearch = route.path.toLowerCase().includes(searchQueryApis.toLowerCase()) || 
                          (route.description && route.description.toLowerCase().includes(searchQueryApis.toLowerCase())) ||
                          (route.controller && route.controller.toLowerCase().includes(searchQueryApis.toLowerCase()));
                          
    const matchesMethod = selectedMethod === 'All' || route.method === selectedMethod;
    const matchesAuth = filterAuth === 'All' || 
                        (filterAuth === 'Protected' && route.auth) || 
                        (filterAuth === 'Public' && !route.auth);
                        
    const matchesType = filterType === 'All' ||
                        (filterType === 'CRUD' && (route.dbOperations?.length || 0) > 0) ||
                        (filterType === 'External' && (route.externalApis?.length || 0) > 0);

    return matchesSearch && matchesMethod && matchesAuth && matchesType;
  });

  const methodColors: Record<string, string> = {
    GET: 'bg-green-500/10 border-green-500/30 text-green-400',
    POST: 'bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400',
    PUT: 'bg-orange-500/10 border-orange-500/30 text-orange-400',
    PATCH: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400',
    DELETE: 'bg-red-500/10 border-red-500/30 text-red-400',
    ALL: 'bg-purple-500/10 border-purple-500/20 dark:border-purple-500/30 text-purple-600 dark:text-purple-400'
  }

  const toggleExpand = (path: string, method: string) => {
    const key = `${method}_${path}`;
    setExpandedRoute(expandedRoute === key ? null : key);
  }

  const handleFetchExplanation = (path: string, method: string) => {
    if (analyzedRepo) {
      const [owner, repo] = analyzedRepo.split('/');
      fetchApiExplanation(owner, repo, path, method);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6 font-mono text-[var(--text-primary)] text-left pb-12"
    >
      {/* HUD Header & API Health */}
      <div className="glass-panel p-6 rounded-xl relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-6 border-cyan-500/20">
        <div className="absolute top-0 left-0 w-80 h-full bg-gradient-to-r from-blue-500/5 to-transparent pointer-events-none" />
        <div className="space-y-2 relative z-10 flex-1">
          <div className="text-xs text-cyan-600 dark:text-cyan-400 font-semibold uppercase flex items-center space-x-1.5">
            <Terminal className="w-3.5 h-3.5" />
            <span>API Intelligence Dashboard</span>
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-[var(--text-primary)] tracking-tight font-sans">
            APIs & Routes
          </h2>
          <p className="text-[var(--text-secondary)] text-xs md:text-sm font-sans max-w-xl leading-relaxed">
            Automatic architecture analysis of server endpoints, middleware, execution flow, authentication, and database operations.
          </p>
        </div>

        {/* API Health Score */}
        <div className="relative z-10 flex items-center space-x-6 shrink-0 bg-[var(--bg-secondary)] p-4 rounded-xl border border-[var(--border-color)]">
          <div className="space-y-1 text-center">
            <div className="text-[10px] text-[var(--text-secondary)] font-bold uppercase tracking-wider flex items-center justify-center space-x-1">
               <Activity className="w-3 h-3 text-cyan-600 dark:text-cyan-400" />
               <span>API Health</span>
            </div>
            <div className="flex items-baseline justify-center space-x-1">
              <span className={`text-4xl font-black ${apiHealth >= 90 ? 'text-green-400' : apiHealth >= 70 ? 'text-yellow-400' : 'text-red-400'}`}>
                {apiHealth}
              </span>
              <span className="text-[var(--text-secondary)] text-sm">/ 100</span>
            </div>
            <div className={`text-[9px] font-bold uppercase tracking-wider ${apiHealth >= 90 ? 'text-green-400' : apiHealth >= 70 ? 'text-yellow-400' : 'text-red-400'}`}>
              {apiHealth >= 90 ? 'Excellent' : apiHealth >= 70 ? 'Good' : 'Needs Improvement'}
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 1: API Overview Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {[
          { label: 'Total', value: totalEndpoints, color: 'text-[var(--text-primary)]' },
          { label: 'GET', value: getCount, color: 'text-green-400' },
          { label: 'POST', value: postCount, color: 'text-blue-600 dark:text-blue-400' },
          { label: 'PUT/PATCH', value: putPatchCount, color: 'text-orange-400' },
          { label: 'DELETE', value: deleteCount, color: 'text-red-400' },
          { label: 'Protected', value: protectedCount, color: 'text-purple-600 dark:text-purple-400' },
          { label: 'Dynamic', value: dynamicCount, color: 'text-yellow-400' },
          { label: 'Controllers', value: controllers.size, color: 'text-cyan-600 dark:text-cyan-400' }
        ].map((stat, i) => (
          <div key={i} className="glass-panel p-3 rounded-lg flex flex-col items-center justify-center text-center space-y-1">
            <span className="text-[9px] text-[var(--text-secondary)] uppercase font-bold tracking-wider">{stat.label}</span>
            <span className={`text-xl font-black font-sans ${stat.color}`}>{stat.value}</span>
          </div>
        ))}
      </div>

      {/* SECTION 17: Interactive Search & Filters */}
      <div className="glass-panel p-4 rounded-xl flex flex-col xl:flex-row gap-4 xl:items-center xl:justify-between bg-[var(--bg-secondary)]">
        <div className="relative flex-1 w-full max-w-xl">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)]" />
          <input
            type="text"
            value={searchQueryApis}
            onChange={(e) => setSearchQueryApis(e.target.value)}
            placeholder="Search API endpoints or controllers..."
            className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] hover:border-[var(--border-color)] focus:border-cyan-400 rounded-lg pl-10 pr-4 py-2.5 text-xs text-slate-200 placeholder-slate-500 transition-all font-mono outline-none"
          />
        </div>

        <div className="flex flex-wrap gap-4 items-center shrink-0">
          <div className="flex space-x-2 items-center">
            <span className="text-[var(--text-secondary)] text-[10px] uppercase font-bold">Method</span>
            <select 
              value={selectedMethod} onChange={(e) => setSelectedMethod(e.target.value)}
              className="bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] text-[10px] rounded px-2 py-1 outline-none focus:border-cyan-400"
            >
              <option value="All">All</option>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>

          <div className="flex space-x-2 items-center">
            <span className="text-[var(--text-secondary)] text-[10px] uppercase font-bold">Auth</span>
            <select 
              value={filterAuth} onChange={(e) => setFilterAuth(e.target.value)}
              className="bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] text-[10px] rounded px-2 py-1 outline-none focus:border-cyan-400"
            >
              <option value="All">All</option>
              <option value="Protected">Protected</option>
              <option value="Public">Public</option>
            </select>
          </div>

          <div className="flex space-x-2 items-center">
            <span className="text-[var(--text-secondary)] text-[10px] uppercase font-bold">Operations</span>
            <select 
              value={filterType} onChange={(e) => setFilterType(e.target.value)}
              className="bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] text-[10px] rounded px-2 py-1 outline-none focus:border-cyan-400"
            >
              <option value="All">All</option>
              <option value="CRUD">Database CRUD</option>
              <option value="External">External APIs</option>
            </select>
          </div>
        </div>
      </div>

      {/* SECTION 2 & 18: Endpoint Explorer */}
      <div className="space-y-3 max-h-[800px] overflow-y-auto custom-scrollbar pr-2">
        {filteredRoutes.length === 0 ? (
          <div className="glass-panel p-12 text-center rounded-xl flex flex-col items-center">
            <Server className="w-8 h-8 text-slate-600 mb-3" />
            <span className="text-sm font-sans text-[var(--text-secondary)]">No routing paths match your filter options.</span>
          </div>
        ) : (
          filteredRoutes.map((route, i) => {
            const expKey = `${route.method}_${route.path}`;
            const isExpanded = expandedRoute === expKey;
            const mColor = methodColors[route.method] || 'bg-slate-500/10 text-[var(--text-secondary)] border-[var(--border-color)]';
            
            const expState = apiExplanations[expKey];

            return (
              <div 
                key={expKey + i} 
                className={`glass-panel rounded-xl overflow-hidden transition-all duration-300 ${
                  isExpanded ? 'border-cyan-500/40 shadow-[0_0_15px_rgba(34,211,238,0.05)]' : 'hover:border-[var(--border-color)]'
                }`}
              >
                {/* Endpoint Header */}
                <div 
                  onClick={() => toggleExpand(route.path, route.method)}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between cursor-pointer hover:bg-[var(--bg-secondary)] gap-4"
                >
                  <div className="flex items-center space-x-3.5 flex-1 min-w-0">
                    <span className={`px-2.5 py-1 border rounded font-bold text-[10px] tracking-wide shrink-0 ${mColor}`}>
                      {route.method}
                    </span>
                    
                    <div className="min-w-0 flex flex-col gap-1">
                      <code className="text-[var(--text-primary)] text-xs md:text-sm font-semibold truncate block">
                        {route.path}
                      </code>
                      <div className="flex items-center gap-2 text-[9px] text-[var(--text-secondary)]">
                        {route.controller && <span className="text-cyan-600 dark:text-cyan-400 font-mono">Controller: {route.controller}</span>}
                        <span>•</span>
                        <span>{route.file}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3 shrink-0">
                    {/* Badges */}
                    <div className="flex space-x-1.5 hidden md:flex">
                      {route.auth ? (
                         <span title="Authentication Protected" className="w-5 h-5 flex items-center justify-center bg-red-500/10 border border-red-500/30 rounded text-red-400">
                           <Lock className="w-3 h-3" />
                         </span>
                      ) : (
                         <span title="Public Endpoint" className="w-5 h-5 flex items-center justify-center bg-green-500/10 border border-green-500/30 rounded text-green-400">
                           <Unlock className="w-3 h-3" />
                         </span>
                      )}
                      
                      {(route.dbOperations?.length || 0) > 0 && (
                        <span title="Database Operations" className="w-5 h-5 flex items-center justify-center bg-blue-500/10 border border-blue-500/30 rounded text-blue-600 dark:text-blue-400">
                          <Database className="w-3 h-3" />
                        </span>
                      )}
                      
                      {(route.externalApis?.length || 0) > 0 && (
                        <span title="External APIs" className="w-5 h-5 flex items-center justify-center bg-yellow-500/10 border border-yellow-500/30 rounded text-yellow-400">
                          <Activity className="w-3 h-3" />
                        </span>
                      )}
                    </div>
                    
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-[var(--text-secondary)]" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-[var(--text-secondary)]" />
                    )}
                  </div>
                </div>

                {/* Expanded Details */}
                <AnimatePresence initial={false}>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className="border-t border-slate-900 bg-[var(--bg-primary)] font-mono text-xs overflow-hidden"
                    >
                      <div className="p-4 md:p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
                        
                        {/* Left Column: Flow & Details */}
                        <div className="lg:col-span-2 space-y-6">
                          
                          {/* SECTION 19: AI Explanation */}
                          <div className="bg-[var(--bg-secondary)] border border-cyan-500/20 p-4 rounded-lg relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-3 opacity-10 pointer-events-none">
                              <Sparkles className="w-16 h-16 text-cyan-600 dark:text-cyan-500" />
                            </div>
                            <div className="flex items-center justify-between mb-3 relative z-10">
                               <div className="flex items-center space-x-2">
                                 <Sparkles className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                                 <span className="text-[var(--text-primary)] font-bold text-xs uppercase tracking-wider">AI Endpoint Explanation</span>
                               </div>
                               {(!expState || (!expState.data && !expState.isLoading)) && (
                                 <button 
                                   onClick={() => handleFetchExplanation(route.path, route.method)}
                                   className="px-2.5 py-1 text-[9px] bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30 rounded hover:bg-cyan-500/20 transition-colors uppercase font-bold"
                                 >
                                   Generate
                                 </button>
                               )}
                            </div>
                            <div className="relative z-10">
                              {expState?.isLoading ? (
                                <div className="animate-pulse space-y-1.5">
                                  <div className="h-2 bg-[var(--bg-secondary)] rounded w-full"></div>
                                  <div className="h-2 bg-[var(--bg-secondary)] rounded w-5/6"></div>
                                  <div className="h-2 bg-[var(--bg-secondary)] rounded w-4/6"></div>
                                </div>
                              ) : expState?.data ? (
                                <p className="text-xs font-sans text-[var(--text-primary)] leading-relaxed">
                                  {expState.data}
                                </p>
                              ) : expState?.error ? (
                                <p className="text-xs text-[var(--text-secondary)]" title={expState.error}>Gemma 4 could not explain this endpoint just now. Press Generate to try again.</p>
                              ) : (
                                <p className="text-[10px] text-[var(--text-secondary)] italic">Generate a Gemma 4 explanation for this endpoint.</p>
                              )}
                            </div>
                          </div>

                          {/* SECTION 3 & 8: Execution Flow */}
                          <div className="space-y-3">
                            <div className="text-[9px] text-[var(--text-secondary)] uppercase tracking-widest flex items-center space-x-1">
                              <Cpu className="w-3 h-3 text-cyan-600 dark:text-cyan-400" />
                              <span>Execution Flow</span>
                            </div>
                            <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] p-4 rounded-lg flex flex-col md:flex-row md:items-center gap-2 overflow-x-auto text-[10px]">
                               <div className="flex items-center space-x-2 shrink-0">
                                 <div className="px-2 py-1 bg-[var(--bg-secondary)] text-[var(--text-primary)] rounded">Router</div>
                                 <ChevronDown className="w-3 h-3 text-[var(--text-secondary)] md:-rotate-90" />
                               </div>
                               
                               {route.middleware.map((mw, idx) => (
                                 <div key={idx} className="flex items-center space-x-2 shrink-0">
                                   <div className={`px-2 py-1 rounded border ${
                                     route.auth === mw ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-[var(--bg-secondary)]/50 border-[var(--border-color)] text-[var(--text-primary)]'
                                   }`}>
                                     {mw}()
                                   </div>
                                   <ChevronDown className="w-3 h-3 text-[var(--text-secondary)] md:-rotate-90" />
                                 </div>
                               ))}

                               <div className="flex items-center space-x-2 shrink-0">
                                 <div className="px-2 py-1 bg-cyan-500/10 border border-cyan-500/30 text-cyan-600 dark:text-cyan-400 rounded font-bold">
                                   {route.controller}()
                                 </div>
                                 {(route.dbOperations?.length || 0 > 0 || route.externalApis?.length || 0 > 0) && (
                                   <ChevronDown className="w-3 h-3 text-[var(--text-secondary)] md:-rotate-90" />
                                 )}
                               </div>

                               {(route.dbOperations?.length || 0 > 0 || route.externalApis?.length || 0 > 0) && (
                                 <div className="flex gap-2 shrink-0">
                                   {(route.dbOperations?.length || 0) > 0 && (
                                     <div className="px-2 py-1 bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400 rounded">
                                       Database
                                     </div>
                                   )}
                                   {(route.externalApis?.length || 0) > 0 && (
                                     <div className="px-2 py-1 bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 rounded">
                                       External API
                                     </div>
                                   )}
                                 </div>
                               )}
                            </div>
                          </div>

                          {/* SECTION 6: Request Parameters */}
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <div className="text-[9px] text-[var(--text-secondary)] uppercase tracking-widest">Parameters</div>
                              <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-3">
                                {route.parameters && (route.parameters?.length || 0) > 0 ? (
                                  <div className="space-y-1.5">
                                    {route.parameters.map((p, idx) => (
                                      <div key={idx} className="flex items-center justify-between text-[10px]">
                                        <span className="text-cyan-600 dark:text-cyan-400 font-bold">{p.name}</span>
                                        <span className="text-[var(--text-secondary)] bg-[var(--bg-primary)] px-1.5 rounded uppercase text-[8px]">{p.type}</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-[var(--text-secondary)]">No request parameters detected.</span>
                                )}
                              </div>
                            </div>
                            
                            <div className="space-y-2">
                              <div className="text-[9px] text-[var(--text-secondary)] uppercase tracking-widest">Responses</div>
                              <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-3">
                                {route.responseTypes && (route.responseTypes?.length || 0) > 0 ? (
                                  <div className="flex flex-wrap gap-1.5">
                                    {route.responseTypes.map((rt, idx) => (
                                      <span key={idx} className={`px-2 py-0.5 rounded border text-[10px] font-bold ${
                                        rt >= 200 && rt < 300 ? 'bg-green-500/10 border-green-500/30 text-green-400' :
                                        rt >= 400 && rt < 500 ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400' :
                                        rt >= 500 ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border-color)]'
                                      }`}>
                                        {rt}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-[var(--text-secondary)]">Dynamic or undefined responses.</span>
                                )}
                              </div>
                            </div>
                          </div>

                        </div>

                        {/* Right Column: Metadata */}
                        <div className="space-y-4">
                          {/* Code Location */}
                          <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-4 space-y-3">
                             <div className="flex items-center space-x-2 text-[10px] text-[var(--text-secondary)] uppercase font-bold tracking-wider">
                               <FileCode className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                               <span>Source Code</span>
                             </div>
                             <div className="text-[10px] text-[var(--text-primary)] break-all leading-relaxed">
                               {route.file}:{route.line}
                             </div>
                             {route.githubUrl && (
                                <a 
                                  href={route.githubUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mt-2 inline-flex items-center space-x-1.5 text-[10px] font-bold text-cyan-600 dark:text-cyan-400 hover:text-cyan-300 uppercase"
                                >
                                  <span>View in GitHub</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                             )}
                          </div>

                          {/* Security & Complexity */}
                          <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-4 space-y-4">
                             <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-3">
                               <div className="flex items-center space-x-2 text-[10px] text-[var(--text-secondary)] uppercase font-bold tracking-wider">
                                 <Shield className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                                 <span>Security Score</span>
                               </div>
                               <span className={`font-black text-sm ${route.securityScore >= 90 ? 'text-green-400' : route.securityScore >= 70 ? 'text-yellow-400' : 'text-red-400'}`}>
                                 {route.securityScore}/100
                               </span>
                             </div>
                             
                             <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-3">
                               <div className="flex items-center space-x-2 text-[10px] text-[var(--text-secondary)] uppercase font-bold tracking-wider">
                                 <Zap className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                                 <span>Complexity</span>
                               </div>
                               <span className={`px-2 py-0.5 rounded text-[9px] uppercase font-bold ${
                                 route.complexity === 'Simple' ? 'bg-green-500/10 text-green-400' :
                                 route.complexity === 'Medium' ? 'bg-yellow-500/10 text-yellow-400' : 'bg-red-500/10 text-red-400'
                               }`}>
                                 {route.complexity}
                               </span>
                             </div>

                             <div className="space-y-1.5">
                               <div className="text-[9px] text-[var(--text-secondary)] uppercase tracking-widest mb-1">Tags</div>
                               {route.auth && (
                                 <div className="flex items-center space-x-1.5 text-[10px] text-red-400">
                                   <Lock className="w-3 h-3" />
                                   <span>Auth: {route.auth}</span>
                                 </div>
                               )}
                               {route.dbOperations.map((db, i) => (
                                 <div key={i} className="flex items-center space-x-1.5 text-[10px] text-blue-600 dark:text-blue-400">
                                   <Database className="w-3 h-3" />
                                   <span>DB {db}</span>
                                 </div>
                               ))}
                               {route.externalApis.map((api, i) => (
                                 <div key={i} className="flex items-center space-x-1.5 text-[10px] text-yellow-400">
                                   <Activity className="w-3 h-3" />
                                   <span>{api} Integration</span>
                                 </div>
                               ))}
                             </div>
                          </div>
                        </div>

                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })
        )}
      </div>
    </motion.div>
  )
}
