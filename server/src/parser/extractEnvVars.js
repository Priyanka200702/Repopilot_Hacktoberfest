/**
 * Extract environment variable usage from source code using regex patterns.
 * Supports Node.js process.env, Python os.environ, .env files, and more.
 */

// Regex patterns for environment variable access
const ENV_PATTERNS = [
  // Node.js: process.env.VAR_NAME or process.env['VAR_NAME'] or process.env["VAR_NAME"]
  {
    regex: /process\.env\.([A-Z_][A-Z0-9_]*)/g,
    extract: (match) => match[1]
  },
  {
    regex: /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g,
    extract: (match) => match[1]
  },
  // Python: os.environ.get('VAR') or os.environ['VAR'] or os.getenv('VAR')
  {
    regex: /os\.environ(?:\.get)?\s*\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
    extract: (match) => match[1]
  },
  {
    regex: /os\.environ\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g,
    extract: (match) => match[1]
  },
  {
    regex: /os\.getenv\s*\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
    extract: (match) => match[1]
  },
  // Go: os.Getenv("VAR")
  {
    regex: /os\.Getenv\s*\(\s*"([A-Z_][A-Z0-9_]*)"\s*\)/g,
    extract: (match) => match[1]
  },
  // Ruby: ENV['VAR'] or ENV.fetch('VAR')
  {
    regex: /ENV\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g,
    extract: (match) => match[1]
  },
  {
    regex: /ENV\.fetch\s*\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
    extract: (match) => match[1]
  },
  // Java: System.getenv("VAR")
  {
    regex: /System\.getenv\s*\(\s*"([A-Z_][A-Z0-9_]*)"\s*\)/g,
    extract: (match) => match[1]
  }
];

// Pattern to detect default values: process.env.X || 'default' or process.env.X ?? 'default'
const DEFAULT_VALUE_REGEX = /process\.env\.([A-Z_][A-Z0-9_]*)\s*(?:\|\||[\?\?])\s*['"]([^'"]*)['"]/g;
const DEFAULT_VALUE_REGEX2 = /process\.env\.([A-Z_][A-Z0-9_]*)\s*(?:\|\||[\?\?])\s*(\d+)/g;

function extractEnvVars(tree, content, filePath) {
  // We use content directly (regex-based, tree is ignored for backward compat)
  const fileContent = content || '';
  const envVars = [];
  const seen = new Map(); // name -> first occurrence

  // Collect default values first
  const defaults = {};
  let defMatch;
  
  const defRegex1 = new RegExp(DEFAULT_VALUE_REGEX.source, 'g');
  while ((defMatch = defRegex1.exec(fileContent)) !== null) {
    defaults[defMatch[1]] = defMatch[2];
  }
  const defRegex2 = new RegExp(DEFAULT_VALUE_REGEX2.source, 'g');
  while ((defMatch = defRegex2.exec(fileContent)) !== null) {
    defaults[defMatch[1]] = defMatch[2];
  }

  // Extract env var references
  for (const pattern of ENV_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match;
    while ((match = regex.exec(fileContent)) !== null) {
      const name = pattern.extract(match);
      
      if (!name || name.length < 2) continue;
      
      // Compute line number
      const linesBefore = fileContent.substring(0, match.index).split('\n');
      const line = linesBefore.length;

      // Skip mentions inside comments ("// process.env.VAR_NAME", " * ...", "# ...")
      const lineStart = linesBefore[linesBefore.length - 1];
      if (/^\s*(\/\/|\*|\/\*|#)/.test(lineStart) || /\/\/.*$/.test(lineStart.replace(/(['"`]).*?\1/g, '').replace(/https?:\/\//g, ''))) continue;

      // Track unique env vars per file
      const key = `${name}:${filePath}`;
      if (seen.has(key)) continue;
      seen.set(key, true);

      const defaultValue = defaults[name] || null;
      const hasDefault = defaultValue !== null;

      envVars.push({
        name,
        file: filePath,
        line,
        defaultValue,
        required: !hasDefault,
        githubUrl: ''
      });
    }
  }

  return envVars;
}

module.exports = { extractEnvVars };
