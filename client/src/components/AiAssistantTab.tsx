import { useState, useRef, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { 
  MessageSquareCode, 
  Send, 
  Bot, 
  User, 
  Loader2, 
  ArrowRight,
  Key,
  Lock,
  ExternalLink,
  Download,
  Sparkles
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useRepoStore } from '../store/useRepoStore'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

// Markdown renderer component for AI responses
function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '')
          const codeString = String(children).replace(/\n$/, '')
          
          if (match) {
            return (
              <div className="relative group my-3 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between bg-[var(--bg-secondary)] border border-[var(--border-color)] px-3 py-1.5 text-[9px] text-[var(--text-secondary)] font-mono uppercase tracking-widest">
                  <span>{match[1]}</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(codeString)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--text-secondary)] hover:text-cyan-600 dark:text-cyan-400"
                  >
                    Copy
                  </button>
                </div>
                <SyntaxHighlighter
                  style={oneDark}
                  language={match[1]}
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    borderRadius: '0 0 8px 8px',
                    fontSize: '11px',
                    lineHeight: '1.6',
                    padding: '14px',
                    background: '#0d1117',
                    border: '1px solid #1e293b',
                    borderTop: 'none'
                  }}
                >
                  {codeString}
                </SyntaxHighlighter>
              </div>
            )
          }
          
          return (
            <code className="px-1.5 py-0.5 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded text-cyan-600 dark:text-cyan-400 text-[11px] font-mono" {...props}>
              {children}
            </code>
          )
        },
        h1: ({ children }) => <h1 className="text-lg font-bold text-[var(--text-primary)] mt-4 mb-2 font-sans">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-bold text-[var(--text-primary)] mt-3 mb-2 font-sans">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-bold text-slate-200 mt-3 mb-1.5 font-sans">{children}</h3>,
        p: ({ children }) => <p className="text-xs leading-relaxed mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="list-disc list-inside space-y-1 text-xs mb-2 ml-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 text-xs mb-2 ml-1">{children}</ol>,
        li: ({ children }) => <li className="text-xs leading-relaxed">{children}</li>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-cyan-600 dark:text-cyan-400 hover:text-cyan-300 underline underline-offset-2">
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-cyan-500/40 pl-3 my-2 text-[var(--text-secondary)] italic text-xs">
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-3 rounded-lg border border-[var(--border-color)]">
            <table className="w-full text-xs">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-[var(--bg-secondary)] text-[var(--text-secondary)]">{children}</thead>,
        th: ({ children }) => <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wider border-b border-[var(--border-color)]">{children}</th>,
        td: ({ children }) => <td className="px-3 py-2 border-b border-slate-900 text-[var(--text-primary)]">{children}</td>,
        strong: ({ children }) => <strong className="font-bold text-[var(--text-primary)]">{children}</strong>,
        hr: () => <hr className="border-[var(--border-color)] my-3" />,
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

export default function AiAssistantTab() {
  const { chatMessages, sendChatMessage, aiKey, aiProvider, isAnalyzing, analysis } = useRepoStore()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [inputText, setInputText] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  
  const chatEndRef = useRef<HTMLDivElement>(null)

  const requireAuth = (callback?: () => void) => {
    if (!user) {
      navigate('/login', { state: { warning: 'Without sign-in, you cannot access the AI Assistant.' } })
      return false
    }
    if (callback) callback()
    return true
  }

  // Dynamic suggested questions based on the analyzed repo
  const suggestedQuestions = [
    'How does authentication work in this project?',
    'Explain the database schema and models.',
    'Where are the API routes defined and how are they structured?',
    `What does ${analysis?.entryPoint?.file || 'the entry point'} do?`,
    'What are the main dependencies and why are they used?',
    'How should I set up this project for local development?'
  ]

  // Scroll to bottom whenever messages update
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, isTyping])

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!requireAuth()) return
    if (!inputText.trim()) return

    const userText = inputText
    setInputText('')
    setIsTyping(true)
    await sendChatMessage(userText)
    setIsTyping(false)
  }

  const handleSelectSuggestion = async (q: string) => {
    if (!requireAuth()) return
    setIsTyping(true)
    await sendChatMessage(q)
    setIsTyping(false)
  }



  // Export chat as markdown
  const exportChat = useCallback(() => {
    const repoName = analysis?.meta ? `${analysis.meta.owner}/${analysis.meta.repo}` : 'unknown'
    const lines = [
      `# RepoPilot Chat — ${repoName}`,
      `_Exported on ${new Date().toLocaleString()}_\n`,
      '---\n'
    ]
    
    for (const msg of chatMessages) {
      const sender = msg.sender === 'assistant' ? '🤖 **RepoPilot Mentor**' : '👤 **Developer**'
      lines.push(`### ${sender} — ${msg.timestamp}`)
      if (msg.mode) lines.push(`> Mode: ${msg.mode}`)
      lines.push('')
      lines.push(msg.text)
      
      if (msg.citations && msg.citations.length > 0) {
        lines.push('\n**Sources:**')
        for (const cite of msg.citations) {
          lines.push(`- [${cite.file}${cite.line ? `:${cite.line}` : ''}](${cite.githubUrl})`)
        }
      }
      lines.push('\n---\n')
    }
    
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `repopilot-chat-${repoName.replace('/', '-')}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [chatMessages, analysis])



  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="h-[calc(100vh-120px)] flex flex-col font-mono text-[var(--text-primary)] text-left select-none relative"
    >
      {/* Top HUD Stats Panel */}
      <div className="glass-panel p-4 rounded-xl border-[var(--border-color)] flex items-center justify-between shrink-0 mb-4 bg-[var(--surface-card)]">
        <div className="flex items-center space-x-2">
          <MessageSquareCode className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
          <div>
            <h2 className="text-[var(--text-primary)] font-sans font-bold text-sm tracking-wide">RepoPilot Technical Mentor</h2>
            <p className="text-[10px] font-mono tracking-wider text-purple-600 dark:text-purple-400">POWERED BY GEMMA 4</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => requireAuth(exportChat)}
            className="flex items-center space-x-1.5 text-[9px] text-[var(--text-secondary)] hover:text-cyan-600 dark:text-cyan-400 transition-colors uppercase border border-[var(--border-color)] hover:border-cyan-500/40 rounded-lg px-2.5 py-1.5 bg-[var(--bg-primary)] hover:bg-[var(--bg-secondary)] cursor-pointer"
            title="Export chat as markdown"
          >
            <Download className="w-3 h-3" />
            <span>Export</span>
          </button>
          <div className="flex items-center space-x-1.5 text-[8px] font-mono px-2 py-0.5 rounded border border-[var(--border-color)]">
            {aiKey ? (
              <span className="text-cyan-400 font-bold uppercase" title="Using Custom User Key">
                🔑 {aiProvider || 'CUSTOM'} KEY
              </span>
            ) : (
              <span className="text-[var(--text-secondary)] font-bold uppercase" title="Using Default System Key">
                🌐 SYSTEM AI DEFAULT
              </span>
            )}
          </div>

          <span className="inline-flex items-center space-x-1.5 text-[8px] bg-green-500/10 border border-green-500/20 text-green-400 px-2 py-0.5 rounded font-bold font-mono">
            <span>AI_AGENT_ONLINE</span>
          </span>
        </div>
      </div>

      {/* Main Chat Log scrollbox */}
      <div className="flex-1 glass-panel rounded-xl border-[var(--border-color)] p-4 md:p-5 overflow-y-auto mb-4 space-y-4 select-text">
        {chatMessages.map((msg) => {
          const isAi = msg.sender === 'assistant'
          return (
            <div 
              key={msg.id}
              className={`flex items-start gap-3.5 max-w-3xl ${isAi ? 'mr-auto text-left' : 'ml-auto flex-row-reverse text-right'}`}
            >
              {/* Profile icon */}
              <div className={`p-2 rounded-lg border shrink-0 ${
                isAi 
                  ? 'bg-blue-600/10 border-blue-500/35 text-cyan-600 dark:text-cyan-400' 
                  : 'bg-purple-600/10 border-purple-500/35 text-purple-600 dark:text-purple-400'
              }`}>
                {isAi ? <Bot className="w-4.5 h-4.5" /> : <User className="w-4.5 h-4.5" />}
              </div>

              {/* Message content panel */}
              <div className="space-y-1.5 flex-1 min-w-0">
                <div className={`flex items-center gap-2 text-[10px] text-[var(--text-secondary)] ${isAi ? 'justify-start' : 'justify-end'}`}>
                  <span className="font-semibold text-[var(--text-secondary)]">{isAi ? 'REPOPILOT MENTOR' : 'DEVELOPER'}</span>
                  <span>•</span>
                  <span>{msg.timestamp}</span>
                  {msg.mode && (
                    <>
                      <span>•</span>
                      <span className={`px-1.5 py-0.5 rounded uppercase font-bold tracking-widest border ${
                        msg.mode === 'advanced' ? 'bg-purple-500/10 border-purple-500/20 dark:border-purple-500/30 text-purple-600 dark:text-purple-400' : 'bg-[var(--bg-secondary)] border-[var(--border-color)] text-[var(--text-secondary)]'
                      }`}>
                        {msg.mode} MODE
                      </span>
                    </>
                  )}
                </div>
                
                <div className={`p-4 rounded-xl border font-sans ${
                  isAi 
                    ? 'bg-[var(--surface-sunken)] border-[var(--border-color)] text-[var(--text-primary)]'
                    : 'bg-blue-600/15 border-blue-500/30 text-[var(--text-primary)]'
                }`}>
                  {isAi ? (
                    <MarkdownRenderer content={msg.text} />
                  ) : (
                    <p className="whitespace-pre-wrap text-xs leading-relaxed">{msg.text}</p>
                  )}

                  {/* Citations */}
                  {msg.citations && msg.citations.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-[var(--border-color)] space-y-2">
                      <p className="text-[10px] text-[var(--text-secondary)] font-mono tracking-widest uppercase mb-1">Sources Cited:</p>
                      <div className="flex flex-wrap gap-2">
                        {msg.citations.map((cite, i) => (
                          <a 
                            key={i}
                            href={cite.githubUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center space-x-1.5 px-2 py-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] hover:border-cyan-500/50 rounded text-[10px] font-mono text-[var(--text-secondary)] hover:text-cyan-600 dark:text-cyan-400 transition-colors group"
                          >
                            <span>{cite.file}{cite.line ? `:${cite.line}` : ''}</span>
                            <ExternalLink className="w-2.5 h-2.5 opacity-50 group-hover:opacity-100" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        {/* Typing Loading Simulator */}
        {isTyping && (
          <div className="flex items-start gap-3.5 mr-auto max-w-lg">
            <div className="p-2 rounded-lg border bg-blue-600/10 border-blue-500/30 text-cyan-600 dark:text-cyan-400 shrink-0">
              <Bot className="w-4.5 h-4.5 animate-bounce" />
            </div>
            <div className="p-3.5 rounded-xl bg-[var(--surface-sunken)] border border-[var(--border-color)] text-[var(--text-secondary)] text-xs flex items-center space-x-2 font-mono">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-600 dark:text-cyan-400" />
              <span className="animate-pulse">Consulting codebase knowledge graph...</span>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Suggested prompts row */}
      {chatMessages.length <= 2 && !isTyping && (
        <div className="shrink-0 mb-3 space-y-2">
          <div className="flex items-center space-x-1.5 text-[10px] text-[var(--text-secondary)]">
            <Sparkles className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-500" />
            <span>SUGGESTED DISPATCH QUERIES:</span>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {suggestedQuestions.map((q) => (
              <button
                key={q}
                onClick={() => handleSelectSuggestion(q)}
                className="px-3.5 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] hover:border-cyan-500/50 hover:bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:text-[var(--text-primary)] transition-all text-xs flex items-center space-x-1.5 cursor-pointer active:scale-95"
              >
                <span>{q}</span>
                <ArrowRight className="w-3 h-3 text-cyan-600 dark:text-cyan-400" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat bottom input bar */}
      <form onSubmit={handleSend} className="shrink-0 relative flex items-center">
        <input
          type="text"
          value={inputText}
          onChange={(e) => {
            if (!requireAuth()) return;
            setInputText(e.target.value);
          }}
          onFocus={() => requireAuth()}
          onClick={() => requireAuth()}
          placeholder={isAnalyzing ? "Waiting for analysis..." : "Ask about files, architecture, database schemas, authentication flows..."}
          disabled={isTyping || isAnalyzing}
          className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] hover:border-slate-750 focus:border-cyan-400 rounded-xl pl-4 pr-14 py-3 text-xs md:text-sm text-slate-200 placeholder-slate-500 transition-all font-mono outline-none shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          onClick={(e) => {
            if (!requireAuth()) e.preventDefault();
          }}
          disabled={isTyping || isAnalyzing || !inputText.trim()}
          className="absolute right-2.5 p-2 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 rounded-lg text-[var(--text-primary)] transition-all cursor-pointer active:scale-95 shadow-[0_0_10px_rgba(34,211,238,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </motion.div>
  )
}
