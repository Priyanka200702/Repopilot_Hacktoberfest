/**
 * Instant voice commands, matched in the browser with no AI round-trip.
 * Anything not matched here (questions, fuzzy requests, Hindi) goes to Gemma 4
 * through /api/voice/command.
 */

export const TABS = [
  'Overview',
  'Setup Guide',
  'Important Files',
  'Time Machine',
  'Architecture',
  'APIs & Routes',
  'Env Variables',
  'Security Audit',
  'Tech Debt Radar',
  'Onboarding Score',
  'README Generator',
  'AI Assistant',
] as const
export type Tab = (typeof TABS)[number]

/** Guided tour order (kept in sync with server/src/services/voice/pageFacts.js TOUR). */
export const TOUR_STEPS: Tab[] = ['Overview', 'Setup Guide', 'Architecture', 'APIs & Routes', 'Env Variables', 'Security Audit', 'Onboarding Score', 'Time Machine']

// Ordered: more specific phrases first.
const TAB_SYNONYMS: [RegExp, Tab][] = [
  [/\b(time machine|history|evolution|timeline|commits?)\b/, 'Time Machine'],
  [/\b(tech(nical)? debt|debt radar|radar)\b/, 'Tech Debt Radar'],
  [/\b(onboarding score|onboarding|score card|scorecard)\b/, 'Onboarding Score'],
  [/\b(readme|read me)\b/, 'README Generator'],
  [/\b(ai assistant|assistant|chat|mentor)\b/, 'AI Assistant'],
  [/\b(security|audit|vulnerabilit(y|ies)|secrets?)\b/, 'Security Audit'],
  [/\b(env(ironment)?( variables?| vars?)?|variables?|config(uration)?)\b/, 'Env Variables'],
  [/\b(apis?|routes?|endpoints?)\b/, 'APIs & Routes'],
  [/\b(architecture|diagram|graph|structure|dependency map)\b/, 'Architecture'],
  [/\b(important files|files?|explorer|file tree)\b/, 'Important Files'],
  [/\b(setup( guide)?|set up|install(ation)?|getting started|how to run)\b/, 'Setup Guide'],
  [/\b(overview|home|dashboard|summary|snapshot)\b/, 'Overview'],
]

export type Intent =
  | { kind: 'stop' }
  | { kind: 'skip' }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'repeat' }
  | { kind: 'faster' }
  | { kind: 'slower' }
  | { kind: 'help' }
  | { kind: 'tour' }
  | { kind: 'explain'; tab?: Tab }
  | { kind: 'navigate'; tab: Tab }
  | { kind: 'back' }
  | { kind: 'fileStory'; path: string; sha?: string }
  | { kind: 'detailed'; path: string; sha?: string }
  | { kind: 'language'; lang: 'en' | 'hi' }

export interface FileRef {
  path: string
  sha?: string
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\b(hey|hi|ok|okay)\s+(pilot|repo ?pilot)\b[,!.]?/g, ' ')
    .replace(/\b(please|can you|could you|would you|kindly|just|now)\b/g, ' ')
    .replace(/[?!,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function findTab(text: string): Tab | undefined {
  for (const [re, tab] of TAB_SYNONYMS) if (re.test(text)) return tab
  return undefined
}

/**
 * Turn a spoken file name ("auth controller dot ts", "index js") into a real
 * analysed file. Returns null when nothing (or more than one file) matches.
 */
export function resolveSpokenFile(spoken: string, files: FileRef[]): FileRef | null {
  const s = spoken
    .toLowerCase()
    .replace(/\b(the|file|called|named|of)\b/g, ' ')
    .replace(/\s+dot\s+/g, '.')
    .replace(/\s+(js|jsx|ts|tsx|py|go|java|json|md|css|html)\b/g, '.$1')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s) return null
  const compact = s.replace(/[\s_-]/g, '')
  const scored = files
    .map(f => {
      const base = f.path.toLowerCase().split('/').pop() || ''
      const stem = base.replace(/\.[^.]+$/, '').replace(/[\s_-]/g, '')
      const full = f.path.toLowerCase()
      let score = 0
      if (full === s || full.endsWith(`/${s}`)) score = 100
      else if (base === s || base.replace(/[\s_-]/g, '') === compact) score = 90
      else if (stem === compact || stem === compact.replace(/\.[^.]+$/, '')) score = 80
      else if (compact.length >= 4 && stem.includes(compact.replace(/\.[^.]+$/, ''))) score = 40
      return { f, score }
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
  if (!scored.length) return null
  if (scored.length > 1 && scored[0].score === scored[1].score) return null // ambiguous: let Gemma decide
  return scored[0].f
}

const NAV_VERB = /^(open|go to|goto|show( me)?( the)?|take me to|navigate to|switch to|jump to|bring up|display)\b/

export function parseIntent(raw: string, files: FileRef[] = []): Intent | null {
  const t = normalize(raw)
  if (!t) return null

  if (/^(stop|cancel|quiet|be quiet|shut up|silence|enough|stop talking)$/.test(t)) return { kind: 'stop' }
  if (/^(skip|next|skip this|skip step|skip page|next step|next page)$/.test(t)) return { kind: 'skip' }
  if (/^(pause|hold on|wait)$/.test(t)) return { kind: 'pause' }
  if (/^(resume|continue|go on|carry on|keep going)$/.test(t)) return { kind: 'resume' }
  if (/^(repeat|repeat that|say that again|again|what did you say)$/.test(t)) return { kind: 'repeat' }
  if (/\b(speak|talk|go)?\s*(faster|quicker)\b|^speed up$/.test(t)) return { kind: 'faster' }
  if (/\b(speak|talk|go)?\s*slower\b|^slow down$/.test(t)) return { kind: 'slower' }
  // Checked on the raw text: normalize() removes "can you", which would turn "what can you do" into "what do".
  if (/^\s*(help|what can you do|what can i say|what do you do|commands)\s*[?.!]*\s*$/i.test(raw)) return { kind: 'help' }
  if (/\b(speak|talk|reply|answer) in hindi\b|^hindi$/.test(t)) return { kind: 'language', lang: 'hi' }
  if (/\b(speak|talk|reply|answer) in english\b|^english$/.test(t)) return { kind: 'language', lang: 'en' }
  if (/\b(tour|walk me through|show me around|give me a walkthrough|demo mode)\b/.test(t)) return { kind: 'tour' }
  if (/^(go )?back( to the dashboard)?$|^(back to|return to) (the )?dashboard$/.test(t)) return { kind: 'back' }

  // "tell me the story of X", "history of X", "time machine for X"
  const story = t.match(/\b(?:story|history|time machine)\s+(?:of|for)\s+(.+)$/)
  if (story) {
    const f = resolveSpokenFile(story[1], files)
    if (f) return { kind: 'fileStory', path: f.path, sha: f.sha }
  }
  // "analyze X", "detailed analysis of X", "walk me through file X", "explain file X"
  const detailed = t.match(/\b(?:analy[sz]e|detailed analysis of|line by line(?: analysis)? of|explain (?:the )?file|walk me through (?:the )?file)\s+(.+)$/)
  if (detailed) {
    const f = resolveSpokenFile(detailed[1], files)
    if (f) return { kind: 'detailed', path: f.path, sha: f.sha }
  }

  // "explain this page", "what am I looking at", "explain the security audit"
  if (/\b(explain|describe|narrate|read|walk me through|talk me through|summari[sz]e)\b.*\b(this|the|current)?\s*(page|screen|tab|file)\b|what am i looking at|what is this page|what's on (this|the) (page|screen)/.test(t)) {
    const other = /\b(this|current)\b/.test(t) ? undefined : findTab(t.replace(/\b(page|screen|tab)\b/g, ''))
    return { kind: 'explain', tab: other }
  }
  if (/^(explain|describe|narrate)\b/.test(t)) {
    const tab = findTab(t)
    if (tab) return { kind: 'explain', tab }
  }

  // Navigation only with a navigation verb, or when the utterance is just a page name,
  // so questions like "what's the security score" go to Gemma instead.
  if (NAV_VERB.test(t)) {
    const tab = findTab(t.replace(NAV_VERB, ''))
    if (tab) return { kind: 'navigate', tab }
  }
  const bare = t.replace(/\b(the|page|tab)\b/g, '').trim()
  for (const [re, tab] of TAB_SYNONYMS) {
    const m = bare.match(re)
    if (m && m[0].length >= bare.length - 1) return { kind: 'navigate', tab }
  }
  return null
}

export const HELP_TEXT = [
  'Say "explain this page" for a spoken walkthrough of what you are looking at.',
  'Say "give me a tour" and I will walk you through the whole analysis.',
  'Say "open the security audit", or any page name, to jump there.',
  'Say "tell me the story of" and a file name to see how it evolved.',
  'Or just ask a question, like "how do I run this project?"',
]
