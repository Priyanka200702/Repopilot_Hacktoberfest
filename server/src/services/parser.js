const { extractRoutes } = require('../parser/extractRoutes');
const { analyzeFiles } = require('../parser/apiIntelligence');
const { extractEnvVars } = require('../parser/extractEnvVars');
const { extractApis } = require('../parser/extractApis');
const { detectEntryPoint } = require('../parser/detectEntryPoint');
const { classifyFiles } = require('../parser/classifyFiles');
const { buildGraph } = require('../parser/buildGraph');
const { generateSetup } = require('../parser/generateSetup');
const { scanSecurityComprehensive } = require('../parser/securityScanner');
const { calculateScore } = require('../parser/scoreCalculator');
const { buildGithubUrl } = require('../utils/githubUrl');
const apiPackagesLookup = require('../parser/lookups/apiPackages.json');
const { extractMetadata } = require('./metadataExtractor');
const { generateDockerSandbox } = require('../parser/generateDockerSandbox');
const { isTestOrFixturePath } = require('../utils/filterFiles');

/** Routes found by both extractors (or twice in one file) are counted once; details are merged. */
function dedupeRoutes(list) {
  const byKey = new Map();
  for (const r of list) {
    // app.use('/api/x', router) mounts a router; it is not an endpoint a caller can hit.
    if (!r || String(r.method || '').toUpperCase() === 'USE') continue;
    const key = `${String(r.method || '').toUpperCase()}|${r.path}|${r.file}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, r); continue; }
    for (const [k, v] of Object.entries(r)) {
      if (prev[k] === undefined || prev[k] === null || prev[k] === '' || (Array.isArray(prev[k]) && !prev[k].length)) prev[k] = v;
    }
  }
  return [...byKey.values()];
}

/**
 * Main orchestrator for analyzing a repository.
 * Uses regex-based parsing (no WASM/Tree-sitter needed).
 */
async function analyzeRepo(owner, repo, filesWithContent, meta, onUpdate) {
  // Application code only: tests, fixtures and mock data are left out of entry-point,
  // route, env-var and stack detection (they still appear in the explorer and security scan).
  const nonTestFiles = filesWithContent.filter(f => !isTestOrFixturePath(f.path));
  const appFiles = nonTestFiles.length ? nonTestFiles : filesWithContent;
  let routes = [];
  const envVars = [];
  const apis = [];
  let codeFiles = [];
  let entryPoint = { file: 'app.js', line: 1, confidence: 'low', reason: 'Fallback', githubUrl: '' };
  const fileRoles = [];
  let graph = { nodes: [], edges: [] };
  let setupSteps = [];
  let securityAlerts = [];
  let comprehensiveSecurity = {};
  let onboardingScore = { score: 50, breakdown: [] };
  let packageJson = null;
  let jsTsFiles = [];
  let allFilesMetadata = [];
  let apiHealth = 100;

  try {
    // 1. Find and parse package.json
    const pkgJsonFile = filesWithContent.find(f => f.path === 'package.json');
    if (pkgJsonFile) {
      try {
        packageJson = JSON.parse(pkgJsonFile.content);
      } catch (e) {
        console.warn('Invalid package.json');
      }
    }

    // 2. Classify files (path-based + content heuristics)
    try {
      const classified = classifyFiles(filesWithContent);
      fileRoles.push(...(classified || []));
    } catch (e) {
      console.warn('classifyFiles failed:', e.message);
    }

    // 3. Detect Entry Point
    try {
      entryPoint = detectEntryPoint(appFiles, packageJson) || entryPoint;
    } catch (e) {
      console.warn('detectEntryPoint failed:', e.message);
    }

    // 4. (Removed old security scan, moved to step 9)

    // 4.5 Extract File Metadata & Deterministic Descriptions
    for (const file of filesWithContent) {
      try {
        const fileMeta = extractMetadata(file.content, file.path);
        allFilesMetadata.push({
          ...fileMeta,
          size: file.size,
          sha: file.sha // Assuming github.js provides sha, we'll verify this
        });
      } catch (e) {
        console.warn(`Metadata extraction failed for ${file.path}:`, e.message);
      }
    }

    // 5. Regex-based analysis per code file
    codeFiles = appFiles.filter(f =>
      f.path.endsWith('.js') || f.path.endsWith('.jsx') ||
      f.path.endsWith('.ts') || f.path.endsWith('.tsx') ||
      f.path.endsWith('.py') || f.path.endsWith('.go') ||
      f.path.endsWith('.rb') || f.path.endsWith('.java')
    );
    jsTsFiles = appFiles.filter(f => 
      f.path.endsWith('.js') || f.path.endsWith('.jsx') || 
      f.path.endsWith('.ts') || f.path.endsWith('.tsx')
    );

    for (const file of codeFiles) {
      try {
        // Extract APIs/packages
        const fileApis = extractApis(null, file.content, file.path, apiPackagesLookup) || [];
        apis.push(...fileApis);

        // Extract Env Vars
        const fileEnvVars = extractEnvVars(null, file.content, file.path) || [];
        envVars.push(...fileEnvVars);

        // Extract Routes
        const fileRoutes = extractRoutes(null, file.content, file.path) || [];
        routes.push(...fileRoutes);
      } catch (err) {
        console.warn(`Analysis failed for ${file.path}:`, err.message);
      }
    }

    // 5.5 Comprehensive API Intelligence
    try {
      const apiIntell = analyzeFiles(jsTsFiles);
      routes.push(...apiIntell.routes);
      apiHealth = apiIntell.apiHealth;
    } catch (e) {
      console.warn('API Intelligence failed:', e.message);
    }

    // 5.8 Detect CDN-loaded libraries from HTML files
    const htmlFiles = appFiles.filter(f => f.path.endsWith('.html') || f.path.endsWith('.htm'));
    for (const hf of htmlFiles) {
      const content = hf.content.toLowerCase();
      const checkCdn = (keyword, pkg, cat, name) => {
        if (content.includes(keyword)) {
          apis.push({
            name, package: pkg, category: cat, importFile: hf.path, importLine: 1, githubUrl: ''
          });
        }
      };
      
      checkCdn('bootstrap', 'bootstrap', 'styling', 'Bootstrap');
      checkCdn('jquery', 'jquery', 'utility', 'jQuery');
      checkCdn('font-awesome', 'font-awesome', 'styling', 'Font Awesome');
      checkCdn('tailwindcss', 'tailwindcss', 'styling', 'Tailwind CSS');
      checkCdn('tailwind.min.css', 'tailwindcss', 'styling', 'Tailwind CSS');
      checkCdn('animate.css', 'animate.css', 'styling', 'Animate.css');
      checkCdn('gsap', 'gsap', 'animation', 'GSAP');
      checkCdn('chart.js', 'chart.js', 'visualization', 'Chart.js');
      checkCdn('three.', 'three', 'visualization', 'Three.js');
    }

    // 6. Generate Setup Steps
    try {
      setupSteps = generateSetup(packageJson, envVars, `https://github.com/${owner}/${repo}`) || [];
    } catch (e) {
      console.warn('generateSetup failed:', e.message);
    }

    // 7. Graph Builder
    try {
      routes = dedupeRoutes(routes);
      graph = buildGraph(entryPoint, routes, envVars, apis, fileRoles, appFiles) || graph;
    } catch (e) {
      console.warn('buildGraph failed:', e.message);
    }

    // 8. Score Calculation
    try {
      onboardingScore = calculateScore(filesWithContent, packageJson, envVars, routes, entryPoint) || onboardingScore;
    } catch (e) {
      console.warn('calculateScore failed:', e.message);
    }

    // 9. Comprehensive Security Scan
    try {
      const compSecurity = scanSecurityComprehensive(filesWithContent, packageJson, envVars);
      securityAlerts = compSecurity.securityAlerts || [];
      comprehensiveSecurity = compSecurity;
    } catch (e) {
      console.warn('scanSecurityComprehensive failed:', e.message);
      comprehensiveSecurity = {};
    }

  } catch (error) {
    console.error('Orchestrator error:', error.message);
  }

  // Deduplicate env vars by name
  const uniqueEnvVars = [];
  const seenEnvNames = new Set();
  for (const ev of envVars) {
    if (!seenEnvNames.has(ev.name)) {
      seenEnvNames.add(ev.name);
      uniqueEnvVars.push(ev);
    }
  }

  // Deduplicate APIs by package
  const uniqueApis = [];
  const seenApiPkgs = new Set();
  for (const api of apis) {
    if (!seenApiPkgs.has(api.package)) {
      seenApiPkgs.add(api.package);
      uniqueApis.push(api);
    }
  }

  // Detect project type from APIs and file structure
  let projectType = detectProjectType(uniqueApis, filesWithContent, packageJson);
  const oneLiner = generateOneLiner(owner, repo, meta, projectType, uniqueApis, routes, uniqueEnvVars);

  // Enhance all paths with githubUrls
  const attachUrl = (item) => ({
    ...item,
    githubUrl: buildGithubUrl(owner, repo, meta.commitSha, item.file || item.importFile || item.path, item.line || item.importLine)
  });

  // --- Dashboard Snapshot Metrics ---

  // 1. Primary Tech Stack
  const techSet = new Set();
  const majorTech = ['react', 'express', 'vue', 'angular', 'next', 'nuxt', 'svelte', 'tailwindcss', 'mongodb', 'mongoose', 'prisma', 'firebase', 'supabase', 'zustand', 'redux', 'framer-motion', 'typescript'];
  apis.forEach(api => {
    const pkg = api.package.toLowerCase();
    if (majorTech.includes(pkg)) techSet.add(pkg);
    else if (pkg.includes('react')) techSet.add('react');
  });
  if (filesWithContent.some(f => f.path.endsWith('.ts') || f.path.endsWith('.tsx'))) techSet.add('typescript');
  const primaryTechStack = Array.from(techSet).map(t => t.charAt(0).toUpperCase() + t.slice(1));
  
  // If no framework detected, detect from file extensions
  const hasHtml = filesWithContent.some(f => f.path.endsWith('.html') || f.path.endsWith('.htm'));
  const hasCss  = filesWithContent.some(f => f.path.endsWith('.css') || f.path.endsWith('.scss') || f.path.endsWith('.sass') || f.path.endsWith('.less'));
  const hasVanillaJs = filesWithContent.some(f => f.path.endsWith('.js') || f.path.endsWith('.mjs'));
  const hasReactStack = primaryTechStack.some(t => t.toLowerCase() === 'react' || t.toLowerCase() === 'next');

  if (primaryTechStack.length === 0) {
    if (hasHtml) techSet.add('html');
    if (hasCss)  techSet.add('css');
    if (hasVanillaJs && !hasReactStack) techSet.add('javascript');
    primaryTechStack.push(...Array.from(techSet).map(t => t.charAt(0).toUpperCase() + t.slice(1)));
  }
  if (primaryTechStack.length === 0) primaryTechStack.push('Node.js');

  // 2. Project Type & Architecture
  let projectTypeStr = "Node.js Application";
  let architectureType = "Backend Only";
  
  const hasReact = primaryTechStack.some(t => t.toLowerCase() === 'react');
  const hasNext = primaryTechStack.some(t => t.toLowerCase() === 'next');
  const hasExpress = primaryTechStack.some(t => t.toLowerCase() === 'express');
  const hasHtmlFiles = filesWithContent.some(f => f.path.endsWith('.html') || f.path.endsWith('.htm'));
  
  if (hasNext) {
    projectTypeStr = "Next.js Application";
    architectureType = "Full Stack / SSR";
  } else if (hasReact && hasExpress) {
    projectTypeStr = "React + Express App";
    architectureType = "Client-Server Architecture";
  } else if (hasReact) {
    projectTypeStr = "React SPA";
    architectureType = "Frontend Only";
  } else if (hasExpress) {
    projectTypeStr = "Express.js REST API";
    architectureType = "REST API";
  } else if (!hasNext && !hasReact && !hasExpress && hasHtmlFiles) {
    projectTypeStr = "Static Web Project";
    architectureType = "Frontend Only";
  }
  
  // Combine if needed or just use the new projectTypeStr
  if (!hasNext && !hasReact && !hasExpress) {
    projectTypeStr = projectType;
  }
  projectType = projectTypeStr;

  // 3. Complexity & Onboarding Time
  let complexity = "Small";
  let onboardingTime = "10-15 minutes";
  const totalF = filesWithContent.length;
  if (totalF > 500) {
    complexity = "Enterprise";
    onboardingTime = "2+ hours";
  } else if (totalF > 200) {
    complexity = "Large";
    onboardingTime = "45-60 minutes";
  } else if (totalF > 50) {
    complexity = "Medium";
    onboardingTime = "20-30 minutes";
  } else if (totalF < 10) {
    complexity = "Very Small";
    onboardingTime = "5-10 minutes";
  }

  // 4. Project Maturity
  const projectMaturity = [];
  const addMaturity = (check, condition, good, bad) => {
    projectMaturity.push({ check, status: condition ? good : bad });
  };
  addMaturity('README', filesWithContent.some(f => f.path.toLowerCase() === 'readme.md'), 'Present', 'Missing');
  addMaturity('Docker', filesWithContent.some(f => f.path.toLowerCase().includes('docker')), 'Present', 'Missing');
  addMaturity('TypeScript', filesWithContent.some(f => f.path.endsWith('.ts') || f.path.endsWith('.tsx')), 'Present', 'Missing');
  addMaturity('Linting', filesWithContent.some(f => f.path.includes('.eslintrc') || f.path.includes('eslint.config')), 'Configured', 'Missing');
  addMaturity('CI/CD', filesWithContent.some(f => f.path.includes('.github/workflows')), 'Present', 'Missing');

  // 5. Quick Insights
  const quickInsights = [];
  quickInsights.push(`Project contains ${filesWithContent.length} files with ${routes.length} mapped API routes.`);
  if (envVars.length > 0) quickInsights.push(`${envVars.length} environment variables detected.`);
  if (hasReact) quickInsights.push(`Uses modern React architecture.`);
  if (hasExpress) quickInsights.push(`Backend follows Express Router pattern.`);
  if (!filesWithContent.some(f => f.path.toLowerCase().includes('docker'))) quickInsights.push(`Docker configuration is missing.`);
  else quickInsights.push(`Docker is configured for containerization.`);

  // Generate Sandbox Environment
  const sandboxEnvironment = generateDockerSandbox(primaryTechStack, projectType, uniqueEnvVars);

  // --- Background AI Description Processing (Level 2) ---
  const { compressContext } = require('../parser/contextCompressor');
  const ProviderManager = require('./ai/ProviderManager');

  // Mark all js/ts files as loading in the returned object so UI knows they are pending
  allFilesMetadata.forEach(meta => {
    if (meta.extension === '.js' || meta.extension === '.jsx' || meta.extension === '.ts' || meta.extension === '.tsx') {
      meta.loading = true;
    }
  });

  const finalAnalysis = {
    sandboxEnvironment,
    meta,
    summary: {
      totalFiles: filesWithContent.length,
      analyzedFiles: codeFiles.length,
      projectType,
      architectureType,
      primaryTechStack,
      complexity,
      onboardingTime,
      projectMaturity,
      quickInsights,
      oneLiner,
    },
    entryPoint: attachUrl(entryPoint),
    setupSteps,
    envVars: uniqueEnvVars.map(attachUrl),
    routes: routes.map(attachUrl),
    apiHealth,
    apis: uniqueApis.map(attachUrl),
    fileRoles: fileRoles.map(attachUrl),
    files: allFilesMetadata.map(attachUrl),
    graph: {
      nodes: graph.nodes.map(n => ({
        ...n,
        githubUrl: n.file ? buildGithubUrl(owner, repo, meta.commitSha, n.file, n.line) : null
      })),
      edges: graph.edges
    },
    onboardingScore,
    securityAlerts: securityAlerts.map(attachUrl),
    securityScore: comprehensiveSecurity?.securityScore || 100,
    dependencySecurity: comprehensiveSecurity?.dependencySecurity || [],
    gitHygiene: comprehensiveSecurity?.gitHygiene || [],
    configSecurity: comprehensiveSecurity?.configSecurity || [],
    staticCodeAnalysis: (comprehensiveSecurity?.staticCodeAnalysis || []).map(attachUrl),
    envAudit: comprehensiveSecurity?.envAudit || [],
    bestPractices: comprehensiveSecurity?.bestPractices || [],
    securityRecommendations: comprehensiveSecurity?.securityRecommendations || []
  };

  let aiPromise = Promise.resolve();
  // If we have an onUpdate callback, we send the initial complete object
  if (onUpdate) {
    onUpdate({ type: 'complete', data: finalAnalysis });
    
    // We intentionally don't await this so it runs in the background
    // and streams updates as they finish
    aiPromise = (async () => {
      const activeLimit = 1; // One background Gemma call at a time to stay inside free-tier limits
      // Limit to the top architectural files (default 5) to preserve free-tier quota for
      // executive summaries & chat. GEMMA_FILE_DESCRIPTIONS=0 disables this step.
      // Metadata objects do not carry file content, so look it up from the fetched files.
      const contentByPath = new Map(filesWithContent.map(f => [f.path, f.content]));
      const describeLimit = Number(process.env.GEMMA_FILE_DESCRIPTIONS ?? 3);
      const targetFiles = allFilesMetadata
        .map(f => ({ ...f, content: contentByPath.get(f.path) }))
        .filter(f => f.role && f.role !== 'other' && f.role !== 'Unknown' && f.role !== 'unknown' && f.content && f.content.length < 15000)
        .slice(0, Math.max(0, describeLimit));
      
      let index = 0;
      let active = 0;

      const processNext = async () => {
        if (index >= targetFiles.length) return;
        const file = targetFiles[index++];
        active++;

        try {
          // Find matching metadata to check imports/exports (we didn't store AST metadata per file easily, but extractMetadata sets some)
          const metaMatch = allFilesMetadata.find(m => m.path === file.path) || {};
          const compressed = compressContext(file.content, metaMatch);
          
          // Background work runs at low priority so it never delays what the user clicks on.
          const aiResponse = await ProviderManager.execute('generateFileDescription', file.path, compressed, undefined, { priority: 'low' });
          
          // Only replace the deterministic description with a real Gemma one; otherwise keep it.
          if (aiResponse && aiResponse.success && aiResponse.provider === 'gemma' && aiResponse.data) {
            // Also store it in the cached analysis so the description survives a page reload.
            const cachedEntry = finalAnalysis.files.find(m => m.path === file.path);
            if (cachedEntry) cachedEntry.description = aiResponse.data;
            onUpdate({ type: 'file_update', path: file.path, description: aiResponse.data });
          }
        } catch (err) {
          console.warn(`[Gemma] File description skipped for ${file.path}: ${err.message}`);
        }

        active--;
        if (index < targetFiles.length) {
          // 1-second delay between requests to protect free tier rate limits (15 RPM)
          await new Promise(resolve => setTimeout(resolve, 1000));
          await processNext();
        }
      };

      const workers = [];
      for (let i = 0; i < activeLimit && i < targetFiles.length; i++) {
        workers.push(processNext());
      }
      await Promise.all(workers);
    })();
  }

  return { analysis: finalAnalysis, aiPromise };
}

function detectProjectType(apis, files, packageJson) {
  const apiPkgs = apis.map(a => a.package);
  const filePaths = files.map(f => f.path);

  // Check frameworks
  if (apiPkgs.includes('next') || filePaths.some(f => f.startsWith('pages/') || f.startsWith('app/'))) return 'Next.js Application';
  if (apiPkgs.includes('@nestjs/core') || apiPkgs.includes('nest')) return 'NestJS Application';
  if (apiPkgs.includes('fastify')) return 'Fastify API';
  if (apiPkgs.includes('koa')) return 'Koa.js API';
  if (apiPkgs.includes('express')) return 'Express.js API';

  // Check databases
  if (apiPkgs.includes('mongoose')) return 'Node.js + MongoDB Application';
  if (apiPkgs.includes('prisma') || apiPkgs.includes('@prisma/client')) return 'Node.js + Prisma Application';
  if (apiPkgs.includes('sequelize')) return 'Node.js + Sequelize Application';

  // Python frameworks
  if (filePaths.some(f => f === 'manage.py')) return 'Django Application';
  if (apiPkgs.includes('flask') || apiPkgs.includes('Flask')) return 'Flask API';
  if (apiPkgs.includes('fastapi') || apiPkgs.includes('FastAPI')) return 'FastAPI Application';

  // Go
  if (filePaths.some(f => f.endsWith('.go'))) return 'Go Application';

  // Ruby
  if (filePaths.some(f => f === 'Gemfile')) return 'Ruby Application';

  // React/Vue/Angular
  if (apiPkgs.includes('react')) return 'React Application';
  if (apiPkgs.includes('vue')) return 'Vue.js Application';
  if (apiPkgs.includes('@angular/core')) return 'Angular Application';

  // Generic
  if (packageJson) return 'Node.js Application';
  return 'Software Project';
}

function generateOneLiner(owner, repo, meta, projectType, apis, routes, envVars) {
  const parts = [];
  parts.push(`${/^[aeiou]/i.test(String(projectType)) ? 'An' : 'A'} ${projectType}`);

  if (meta.description) {
    parts[0] = meta.description;
  }

  const dbApis = apis.filter(a => a.category === 'database');
  const authApis = apis.filter(a => a.category === 'auth');

  if (dbApis.length > 0) {
    parts.push(`using ${dbApis.map(a => a.name).join(' and ')}`);
  }
  if (authApis.length > 0) {
    parts.push(`with ${authApis.map(a => a.name).join(' and ')} authentication`);
  }
  if (routes.length > 0) {
    parts.push(`exposing ${routes.length} API route${routes.length > 1 ? 's' : ''}`);
  }

  return parts.join(', ') + '.';
}

module.exports = {
  analyzeRepo
};
