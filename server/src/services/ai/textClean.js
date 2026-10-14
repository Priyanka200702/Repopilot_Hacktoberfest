/**
 * Turn model output into short, plain text for UI panels that render text
 * directly (overview summary, security review, API explanations, file
 * descriptions). Removes markdown (** bold **, headings, bullets, links),
 * emojis, chatty preambles, then trims to a sentence/word budget.
 */

// Chatty openers: "Sure! ...", "Okay, ...", "Here is the summary: ...". Word boundaries keep words like "Okta" intact.
const PREAMBLE = /^(?:(?:sure|certainly|of course|okay|ok|absolutely)\b[,:!.]?\s+|here(?:'s| is| are)\b[^.:\n]*:\s*)/i;
const LABEL = /^(?:executive summary|summary|security review|overview|explanation|description|answer)\s*[:\-–]\s*/i;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{FE0F}\u{200D}]/gu;

function stripMarkdown(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, ' ')                 // code blocks
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')            // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')         // links -> text
    .replace(/^\s{0,3}#{1,6}\s+.*$/gm, ' ')          // heading lines (labels, not content)
    .replace(/^\s*>\s?/gm, '')                       // blockquotes
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, '')      // bullets / numbered lists
    .replace(/(\*\*|__)(.*?)\1/g, '$2')              // bold
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2') // italics
    .replace(/[*_]{2,}/g, '')                        // leftover markers
    .replace(/`([^`]+)`/g, '$1')                     // inline code
    .replace(/<\/?[a-z][^>]*>/gi, ' ');              // stray html tags
}

function splitSentences(text) {
  return text.split(/(?<=[.!?])\s+(?=["'(\[]?[A-Z0-9])/).map(x => x.trim()).filter(Boolean);
}

/**
 * @param {string} text
 * @param {{maxSentences?: number, maxWords?: number}} [opts]
 */
function toPlainText(text, { maxSentences = 3, maxWords = 70 } = {}) {
  if (!text) return '';
  let t = stripMarkdown(text)
    .replace(EMOJI, '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])(?=\s|$)/g, '$1')        // "tool ." -> "tool." but keep " .env"
    .trim();
  // Openers can stack ("Sure! Here is the summary: ..."), so strip a few times.
  for (let i = 0; i < 3; i++) {
    const stripped = t.replace(PREAMBLE, '').replace(LABEL, '').trim();
    if (!stripped || stripped === t) break;
    t = stripped;
  }
  t = t.replace(/^["']|["']$/g, '').trim();

  // Sentence budget (keep whole sentences). A sentence ends at . ! ? followed by a space and
  // a capital letter or digit, so ".env", "v1.2" or "e.g. this" do not split.
  const sentences = splitSentences(t);
  let out = sentences.slice(0, maxSentences).join(' ').replace(/\s+/g, ' ').trim();

  // Word budget: cut at the last full sentence that fits, else hard-cut with an ellipsis.
  const words = out.split(' ');
  if (words.length > maxWords) {
    const kept = [];
    let count = 0;
    for (const s of splitSentences(out)) {
      const n = s.trim().split(/\s+/).length;
      if (count + n > maxWords) break;
      kept.push(s.trim());
      count += n;
    }
    out = kept.length ? kept.join(' ') : `${words.slice(0, maxWords).join(' ').replace(/[,;:]$/, '')}…`;
  }
  if (out && !/[.!?…]$/.test(out)) out += '.';
  return out.charAt(0).toUpperCase() + out.slice(1);
}

module.exports = { toPlainText, stripMarkdown };
