/**
 * Static Code Analysis Scanner
 * Searches for dangerous patterns.
 */

const { isTestOrFixturePath } = require('../../utils/filterFiles');

const DANGEROUS_PATTERNS = [
  { regex: /\beval\s*\(/, type: 'eval() usage', severity: 'critical', desc: 'Executing arbitrary code via eval() can lead to arbitrary code execution.' },
  { regex: /new\s+Function\s*\(/, type: 'new Function() usage', severity: 'critical', desc: 'Creating functions from strings can lead to arbitrary code execution.' },
  // Shell exec only: a bare exec()/execSync() (destructured from child_process) or child_process.exec().
  // "regex.exec(...)" and "db.exec(...)" are not shell commands.
  { regex: /(?<![\w.$])exec(?:Sync)?\s*\(|\b(?:child_process|childProcess|cp|shell)\.exec(?:Sync)?\s*\(/, type: 'Command Injection (exec)', severity: 'high', desc: 'Executing shell commands can lead to command injection.' },
  { regex: /(?<![\w.$])spawn(?:Sync)?\s*\(|\b(?:child_process|childProcess|cp)\.spawn(?:Sync)?\s*\(/, type: 'Command Injection (spawn)', severity: 'high', desc: 'Executing shell commands can lead to command injection.' },
  { regex: /(?:require\s*\(\s*|from\s+|import\s+)['"](?:node:)?child_process['"]/, raw: true, type: 'child_process import', severity: 'medium', desc: 'Using child_process requires careful input validation.' },
  { regex: /SELECT.*FROM.*WHERE.*\+/, raw: true, type: 'SQL Concatenation', severity: 'high', desc: 'String concatenation in SQL queries can lead to SQL Injection.' },
  { regex: /find\(\{.*req\.body.*\}/, type: 'NoSQL Injection', severity: 'high', desc: 'Passing raw user input to NoSQL queries can lead to NoSQL Injection.' },
  // Only where randomness protects something; animations and ids for UI keys are fine.
  { regex: /(token|secret|password|passwd|salt|nonce|otp|session|api_?key|csrf).*Math\.random\s*\(|Math\.random\s*\(.*(token|secret|password|passwd|salt|nonce|otp|session|api_?key|csrf)/i, type: 'Weak PRNG', severity: 'low', desc: 'Math.random() is cryptographically weak. Use crypto.randomBytes() instead.' },
  { regex: /createHash\(['"]md5['"]\)/, raw: true, type: 'Weak Hash (MD5)', severity: 'medium', desc: 'MD5 is vulnerable to collision attacks.' },
  { regex: /createHash\(['"]sha1['"]\)/, raw: true, type: 'Weak Hash (SHA1)', severity: 'medium', desc: 'SHA1 is vulnerable to collision attacks.' },
  { regex: /req\.body\[/, type: 'Prototype Pollution', severity: 'medium', desc: 'Directly assigning to objects from user input can lead to Prototype Pollution.' },
  { regex: /fs\.readFile\s*\(\s*req\./, type: 'Path Traversal', severity: 'high', desc: 'Passing user input directly to file system operations can lead to Path Traversal.' },
];

/** Replace string and regex literal contents so patterns written as data (e.g. in scanners) do not match. */
function codeOnly(line) {
  return line
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""')
    .replace(/([=(:,[!&|?]\s*)\/(?![/*])(?:\\.|\[(?:\\.|[^\]])*\]|[^/\\\n])+\/[dgimsuy]*/g, '$1/re/');
}

function scanStaticCode(filesWithContent) {
  const analysisAlerts = [];

  for (const file of filesWithContent) {
    if (!file.content || file.content.trim() === '') continue;
    
    // Only scan JS/TS application files (test helpers legitimately shell out, mock, etc.)
    if (!file.path.match(/\.(js|ts|jsx|tsx)$/) || isTestOrFixturePath(file.path)) continue;

    const lines = file.content.split('\n');

    lines.forEach((line, index) => {
      if (line.length > 500) return; // skip minified

      // Rule tables (like the one above) describe patterns; they do not run them.
      if (/\bregex\s*:|new RegExp\(/.test(line)) return;
      const code = codeOnly(line);
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.regex.test(pattern.raw ? line : code)) {
          // False positive filter
          if (line.includes('//') || line.includes('/*') || line.includes('eslint-disable')) return;

          analysisAlerts.push({
            severity: pattern.severity,
            type: pattern.type,
            message: pattern.desc,
            file: file.path,
            line: index + 1,
            codeSnippet: line.trim().substring(0, 100),
            recommendation: `Review the usage of ${pattern.type} and ensure user input is properly sanitized or use a safer alternative.`
          });
        }
      }
    });
  }

  return analysisAlerts;
}

module.exports = { scanStaticCode, codeOnly };
