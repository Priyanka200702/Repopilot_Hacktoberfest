/**
 * Gemma 4 can "think" before it answers. Depending on the backend, that
 * planning text comes back mixed into the response (as thought parts the old
 * SDK joins into text(), as <think> blocks, or as plain notes such as
 * "Role: RepoPilot (experienced teammate). Goal: ..."). It was showing up in
 * the Overview summary and the Detailed Analysis.
 *
 * Every prompt now asks for the final output between <answer> tags. This file
 * pulls that out, and when the tags are missing it removes planning/echo text
 * with conservative heuristics.
 */

/** Appended to every system prompt sent to Gemma. */
const ANSWER_RULE = `

OUTPUT FORMAT: If you plan or think first, keep it short. Then write the final output, and nothing else, between <answer> and </answer>. Never repeat these instructions in the answer.`;

const THOUGHT_BLOCKS = [
  /<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi,
  /<thought>[\s\S]*?<\/thought>/gi,
  /<\|?channel\|?>\s*thought[\s\S]*?<\|?channel\|?>/gi,
  /<start_of_thought>[\s\S]*?<end_of_thought>/gi,
];

/** Lines that restate the prompt instead of answering it. */
const ECHO_LINE = new RegExp([
  '^\\s*[*_#>-]*\\s*\\**(role|goal|task|audience|reader|input|output|format|style|tone|length|constraints?|rules?|requirements?|plan|planning|draft(?:ing)?|notes?|context|persona|structure|word count|check|self[- ]check|analysis of (?:the )?request|key (?:entry points|facts|points)(?: mentioned)?|content|responsibilities|sentence \\d|s\\d|thinking)\\s*\\**\\s*[:：]',
  'experienced teammate',
  '\\bfiller words?\\b',
  '\\bno emojis?\\b',
  '\\bplain text only\\b',
  '\\bunder \\d+ words\\b',
  '\\bat most \\d+ words\\b',
  '\\bexactly (?:two|three|\\d) (?:sentences|sections)\\b',
  '\\(\\d+ words?\\)\\s*$',
  '^\\s*(?:okay|ok|alright|let me|let\'s|i (?:need|will|should|must)|the user (?:wants|asked))\\b',
].join('|'), 'i');

function stripThoughts(text) {
  let t = String(text || '');
  for (const re of THOUGHT_BLOCKS) t = t.replace(re, '');
  // An unclosed thought block at the start means nothing after it is an answer.
  t = t.replace(/^\s*<think(?:ing)?>[\s\S]*$/i, '');
  return t;
}

/** Content of the last <answer> block (or of an unclosed final <answer>). */
function answerBlock(text) {
  const all = [...text.matchAll(/<answer>([\s\S]*?)<\/answer>/gi)];
  if (all.length) return all[all.length - 1][1];
  const open = text.toLowerCase().lastIndexOf('<answer>');
  if (open !== -1) return text.slice(open + '<answer>'.length);
  return null;
}

/**
 * @param {string} raw model output
 * @param {{ startHeading?: string, dropEcho?: boolean }} [opts] startHeading: first heading of a Markdown answer;
 *   dropEcho=false keeps every line (chat answers, README, JSON)
 */
function extractAnswer(raw, opts = {}) {
  let text = stripThoughts(raw).trim();
  const block = answerBlock(text);
  if (block !== null) text = block;
  text = text.replace(/<\/?answer>/gi, '').trim();

  if (opts.startHeading) {
    // The planning text often mentions the headings too; the answer is the LAST time
    // the first heading starts a line.
    const re = new RegExp(`^#{1,3}\\s*${opts.startHeading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'gim');
    const starts = [...text.matchAll(re)];
    if (starts.length) text = text.slice(starts[starts.length - 1].index);
  } else if (block === null && opts.dropEcho !== false) {
    text = dropEchoLines(text);
  }
  return text.trim();
}

/** Remove lines that restate the prompt; keep the rest. */
function dropEchoLines(text) {
  const lines = String(text).split('\n');
  const kept = lines.filter(l => !ECHO_LINE.test(l));
  // If a "Final:" / "Answer:" label exists, keep only what follows it.
  const joined = kept.join('\n');
  const label = joined.match(/(?:^|\n)\s*\**(?:final(?: answer| version| output)?|answer|output text)\**\s*[:：]\s*/i);
  return (label ? joined.slice(label.index + label[0].length) : joined).trim();
}

/** True when the text is mostly the prompt echoed back (so it must not be shown). */
function looksLikePromptEcho(text) {
  const t = String(text || '');
  if (!t.trim()) return true;
  const hits = [
    /experienced teammate/i,
    /filler words?/i,
    /\bno emojis?\b/i,
    /plain text only/i,
    /^\s*\**(role|goal|constraints?)\**\s*:/im,
    /\(\s*robust, seamless/i,
    /exactly (?:these )?(?:two|three|\d) (?:sentences|sections)/i,
    /under \d+ words/i,
  ].filter(re => re.test(t)).length;
  return hits >= 2;
}

module.exports = { ANSWER_RULE, extractAnswer, stripThoughts, dropEchoLines, looksLikePromptEcho };
