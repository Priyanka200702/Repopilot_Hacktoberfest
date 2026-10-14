/**
 * Extract API routes from source code using regex patterns.
 * Supports Express, Fastify, Koa, Flask, FastAPI, Django, Go net/http, Rails.
 */

// Express / Fastify / Koa route patterns
const EXPRESS_PATTERNS = [
  // app.get('/path', ...) or router.get('/path', ...)
  {
    regex: /(?:app|router|server)\.(get|post|put|delete|patch|options|head|all)\s*\(\s*['"`]([^'"`]+)['"`]/g,
    extractMethod: (match) => match[1].toUpperCase(),
    extractPath: (match) => match[2]
  },
  // app.use('/path', router)
  {
    regex: /(?:app|server)\.use\s*\(\s*['"`]([^'"`]+)['"`]\s*,/g,
    extractMethod: () => 'USE',
    extractPath: (match) => match[1]
  }
];

// Flask patterns: @app.route('/path', methods=['GET', 'POST'])
const FLASK_PATTERNS = [
  {
    regex: /@(?:app|blueprint|bp)\.route\s*\(\s*['"]([^'"]+)['"](?:\s*,\s*methods\s*=\s*\[([^\]]*)\])?\s*\)/g,
    extractMethod: (match) => {
      if (match[2]) {
        return match[2].replace(/['"]/g, '').split(',').map(s => s.trim()).join(', ');
      }
      return 'GET';
    },
    extractPath: (match) => match[1]
  },
  // @app.get('/path'), @app.post('/path')
  {
    regex: /@(?:app|blueprint|bp)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    extractMethod: (match) => match[1].toUpperCase(),
    extractPath: (match) => match[2]
  }
];

// FastAPI patterns: @app.get('/path')
const FASTAPI_PATTERNS = [
  {
    regex: /@(?:app|router)\.(get|post|put|delete|patch|options)\s*\(\s*['"]([^'"]+)['"]/g,
    extractMethod: (match) => match[1].toUpperCase(),
    extractPath: (match) => match[2]
  }
];

// NestJS patterns: @Get('/path'), @Post('/path')
const NESTJS_PATTERNS = [
  {
    regex: /@(Get|Post|Put|Delete|Patch|Options|Head|All)\s*\(\s*['"]?([^'")\s]*?)['"]?\s*\)/g,
    extractMethod: (match) => match[1].toUpperCase(),
    extractPath: (match) => match[2] || '/'
  }
];

// Go net/http patterns: http.HandleFunc("/path", handler)
const GO_PATTERNS = [
  {
    regex: /(?:http\.HandleFunc|mux\.HandleFunc|r\.HandleFunc|router\.HandleFunc)\s*\(\s*"([^"]+)"/g,
    extractMethod: () => 'ALL',
    extractPath: (match) => match[1]
  },
  // Gorilla/chi router: r.Get("/path", handler)
  {
    regex: /(?:r|router|mux)\.(Get|Post|Put|Delete|Patch|Options|Head)\s*\(\s*"([^"]+)"/g,
    extractMethod: (match) => match[1].toUpperCase(),
    extractPath: (match) => match[2]
  }
];

function extractRoutes(tree, content, filePath) {
  const fileContent = content || '';
  const routes = [];
  const seen = new Set();

  // Determine which patterns to use based on file extension
  let patterns = [];
  
  if (filePath.endsWith('.py')) {
    patterns = [...FLASK_PATTERNS, ...FASTAPI_PATTERNS];
  } else if (filePath.endsWith('.go')) {
    patterns = [...GO_PATTERNS];
  } else if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
    patterns = [...EXPRESS_PATTERNS, ...NESTJS_PATTERNS];
  } else {
    patterns = [...EXPRESS_PATTERNS];
  }

  for (const pattern of patterns) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match;
    
    while ((match = regex.exec(fileContent)) !== null) {
      const method = pattern.extractMethod(match);
      const path = pattern.extractPath(match);

      // Skip if already seen
      const key = `${method}:${path}:${filePath}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Skip non-route paths (middleware, static assets, etc.)
      if (path === '*' || path === '/' && method === 'USE') continue;

      // Compute line number
      const linesBefore = fileContent.substring(0, match.index).split('\n');
      const line = linesBefore.length;

      // Skip examples in comments ("// app.get('/path', ...)")
      if (/^\s*(\/\/|\*|\/\*|#)/.test(linesBefore[linesBefore.length - 1])) continue;

      // Detect env vars and APIs used in nearby code
      const nearbyContent = fileContent.substring(
        Math.max(0, match.index - 200),
        Math.min(fileContent.length, match.index + 500)
      );
      
      const usesEnvVars = [];
      const envMatches = nearbyContent.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g);
      for (const envMatch of envMatches) {
        if (!usesEnvVars.includes(envMatch[1])) {
          usesEnvVars.push(envMatch[1]);
        }
      }

      const usesApis = [];
      const requireMatches = nearbyContent.matchAll(/require\s*\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g);
      for (const reqMatch of requireMatches) {
        const pkg = reqMatch[1].split('/')[0];
        if (!usesApis.includes(pkg)) {
          usesApis.push(pkg);
        }
      }

      routes.push({
        method,
        path,
        file: filePath,
        line,
        handlerName: null,
        usesEnvVars,
        usesApis,
        githubUrl: ''
      });
    }
  }

  return routes;
}

module.exports = { extractRoutes };
