const { isTestOrFixturePath } = require('../../utils/filterFiles');

/**
 * Secret Scanner
 * Deterministic Regex-based scanner for exposed secrets in codebase.
 */

const SECRET_PATTERNS = [
  { type: 'GitHub Token', regex: /(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36}/ },
  { type: 'GitLab Token', regex: /glpat-[A-Za-z0-9_\-]{20}/ },
  { type: 'OpenAI Key', regex: /sk-[A-Za-z0-9]{48}/ },
  { type: 'Gemini Key', regex: /AIza[0-9A-Za-z-_]{35}/ },
  { type: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/ },
  // Any 40-char base64 run matched hashes, SHAs and paths; only flag it next to an AWS secret name.
  { type: 'AWS Secret Key', regex: /aws.{0,20}(secret|key).{0,10}[:=]\s*['"]?[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/i },
  { type: 'Google API Key', regex: /AIza[0-9A-Za-z\-_]{35}/ },
  { type: 'Bearer Token', regex: /Bearer\s+[A-Za-z0-9\-._~+/]{24,}=*/ },
  { type: 'Private RSA Key', regex: /-----BEGIN RSA PRIVATE KEY-----/ },
  { type: 'SSH Key', regex: /-----BEGIN OPENSSH PRIVATE KEY-----/ },
  // Only URIs that carry a username and password.
  { type: 'MongoDB URI', regex: /mongodb(?:\+srv)?:\/\/[^\s:@/'"]+:[^\s@/'"]+@[^\s'"]+/ },
  { type: 'Postgres/DB URL', regex: /(postgres|mysql|redis):\/\/[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+@[a-zA-Z0-9_.-]+/ },
  { type: 'Stripe Key', regex: /(sk_live|rk_live)_[0-9a-zA-Z]{24}/ },
  { type: 'Slack Token', regex: /xox[baprs]-[0-9]{12}-[0-9]{12}-[a-zA-Z0-9]{24}/ },
  { type: 'Twilio Key', regex: /SK[0-9a-fA-F]{32}/ },
  { type: 'Password Pattern', regex: /(password|passwd|pwd)\s*=\s*['"][^'"]+['"]/i },
  { type: 'JWT Secret', regex: /jwt_secret\s*=\s*['"][^'"]+['"]/i },
];

function scanSecrets(filesWithContent) {
  const secretsFound = [];

  for (const file of filesWithContent) {
    if (!file.content || file.content.trim() === '') continue;

    // Skip obviously safe files: lockfiles, docs, and test fixtures (fake keys by design)
    if (file.path.endsWith('package-lock.json') || file.path.endsWith('.svg')) continue;
    if (/\.(md|mdx|rst|txt|adoc)$/i.test(file.path) || isTestOrFixturePath(file.path)) continue;

    const lines = file.content.split('\n');

    lines.forEach((line, index) => {
      // Avoid super long minified lines
      if (line.length > 500) return;

      for (const pattern of SECRET_PATTERNS) {
        if (pattern.regex.test(line)) {
          
          // Basic false-positive filtering: examples, tests, placeholders, template values
          // and the patterns themselves (regex definitions in scanners/linters).
          const lower = line.toLowerCase();
          if (lower.includes('example') || lower.includes('test') || /your[_-]|xxx|placeholder|<[a-z_]+>|\$\{|process\.env/i.test(line)) continue;
          if (/regex\s*:|new RegExp\(|\/\^?\(?\??[A-Za-z(]*-----BEGIN/.test(line)) continue;

          secretsFound.push({
            severity: 'critical',
            type: 'Exposed Secret',
            message: `Possible ${pattern.type} exposed in code.`,
            file: file.path,
            line: index + 1,
            matchedPattern: pattern.type,
            recommendation: `Revoke this ${pattern.type} immediately and use an environment variable instead.`
          });
        }
      }
    });
  }

  return secretsFound;
}

module.exports = { scanSecrets };
