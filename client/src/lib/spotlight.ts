/**
 * Voice spotlight: while the assistant speaks about a page, scroll to the part
 * of the page each sentence talks about and highlight it.
 *
 * A sentence is matched to a page section by the words they share (section
 * headings count most, so "There are 26 environment variables" lands on the
 * "Environment Variables" card). When nothing matches, sections are walked in
 * page order, so the tour still moves through the whole page.
 */

const ROOT = '[data-voice-scroll]'
const CLASS = 'voice-spotlight'
const STOP = new Set(
  'the this that these those there their they them with from into have has had will would should could your you about which what when where while page shows show here than then also just only very more most some each every over under onto been being were was are and for not but can its it’s it\'s one two three'.split(' '),
)

let current: HTMLElement | null = null
let lastIndex = -1

function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9_.-]{3,}/g) || [])
    .map(w => w.replace(/^[.-]+|[.-]+$/g, ''))
    .filter(w => w.length >= 3 && !STOP.has(w))
}

function stem(w: string) {
  return w.replace(/(ies|es|s)$/, '')
}

function visible(el: HTMLElement) {
  const r = el.getBoundingClientRect()
  return r.width > 40 && r.height > 24 && getComputedStyle(el).visibility !== 'hidden'
}

/** Card-like blocks on the current page, in page order. */
function sections(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = []
  const seen = new Set<HTMLElement>()
  root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, [data-voice-section]').forEach(h => {
    if (h.closest('[data-voice-ignore]')) return
    const box = (h.matches('[data-voice-section]')
      ? h
      : h.closest<HTMLElement>('[data-voice-section], .glass-panel, section, [class*="rounded-xl"], [class*="rounded-2xl"], [class*="rounded-lg"]')) || h.parentElement
    if (!box || box === root || seen.has(box) || !root.contains(box) || !visible(box)) return
    // Prefer the smallest box: drop any already-collected ancestor of this one.
    for (const prev of [...out]) {
      if (prev.contains(box)) { out.splice(out.indexOf(prev), 1); seen.delete(prev) }
    }
    if (out.some(prev => box.contains(prev))) return
    seen.add(box)
    out.push(box)
  })
  return out.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
}

function score(sentenceWords: string[], box: HTMLElement): number {
  const heading = box.querySelector('h1, h2, h3, h4')?.textContent || ''
  const head = new Set(words(heading).map(stem))
  const body = new Set(words((box.textContent || '').slice(0, 600)).map(stem))
  let s = 0
  for (const w of sentenceWords) {
    const k = stem(w)
    if (head.has(k)) s += 3
    else if (body.has(k)) s += /[\d._/]/.test(w) ? 2 : 1 // names and numbers are strong signals
  }
  return s
}

/** Highlight the section sentence `index` of `total` is about. Safe to call anywhere. */
export function spotlight(sentence: string, index: number, total: number) {
  if (typeof document === 'undefined') return
  const root = document.querySelector<HTMLElement>(ROOT)
  if (!root) return
  const boxes = sections(root)
  if (!boxes.length) return

  const ws = words(sentence)
  let best: HTMLElement = boxes[0]
  let bestScore = 0
  for (const b of boxes) {
    const s = score(ws, b)
    if (s > bestScore) { bestScore = s; best = b }
  }
  if (bestScore < 3) {
    // No clear match: keep moving down the page in step with the narration.
    const i = total <= 1 ? 0 : Math.round((index * (boxes.length - 1)) / (total - 1))
    best = boxes[Math.max(i, Math.min(lastIndex + 1, boxes.length - 1), 0)] || boxes[0]
  }
  lastIndex = boxes.indexOf(best)
  focus(best, root)
}

function focus(el: HTMLElement, root: HTMLElement) {
  if (current && current !== el) current.classList.remove(CLASS)
  current = el
  el.classList.add(CLASS)
  const tall = el.getBoundingClientRect().height > root.clientHeight * 0.7
  try {
    el.scrollIntoView({ behavior: 'smooth', block: tall ? 'start' : 'center' })
  } catch {
    el.scrollIntoView()
  }
}

/** Remove the highlight (end of speech, stop, page change). */
export function clearSpotlight(scrollTop = false) {
  current?.classList.remove(CLASS)
  current = null
  lastIndex = -1
  if (scrollTop && typeof document !== 'undefined') {
    document.querySelector<HTMLElement>(ROOT)?.scrollTo({ top: 0, behavior: 'smooth' })
  }
}
