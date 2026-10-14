/**
 * Facts and fallback narration for every RepoPilot page.
 *
 * buildPageFacts() picks the data a listener needs for one page out of the
 * cached analysis. Gemma 4 turns these facts into a spoken explanation; if
 * Gemma is unavailable, factsNarration() produces a plain spoken script from
 * the same facts so the voice guide (and the guided tour) never goes silent.
 */

const TABS = [
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
];
const DETAILED = 'Detailed Analysis';

/** Order used by the guided tour. */
const TOUR = ['Overview', 'Setup Guide', 'Architecture', 'APIs & Routes', 'Env Variables', 'Security Audit', 'Onboarding Score', 'Time Machine'];

const base = (p) => String(p || '').split('/').pop();
const plural = (n, word, many) => `${n} ${n === 1 ? word : (many || `${word}s`)}`;
const listWords = (items, max = 3) => {
  const xs = (items || []).filter(Boolean).slice(0, max);
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
};
const countBy = (list, key) => (list || []).reduce((m, x) => { const k = String(x?.[key] || 'unknown').toLowerCase(); m[k] = (m[k] || 0) + 1; return m; }, {});

/** Strip markdown so a Detailed Analysis page can be summarised or read aloud. */
function markdownToSpeech(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/[*_]{1,2}/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function timeMachineFacts(evolution) {
  if (!evolution) return { loaded: false };
  return {
    loaded: true,
    commitsExamined: evolution.window?.commitsInWindow,
    from: evolution.window?.from?.slice(0, 10),
    to: evolution.window?.to?.slice(0, 10),
    overview: evolution.overview?.text || null,
    milestones: (evolution.milestones || []).slice(0, 6).map(m => ({ date: m.date?.slice(0, 10), title: m.title, tags: m.tags })),
  };
}

/**
 * @param {string} tab page name (one of TABS, or 'Detailed Analysis')
 * @param {object} a cached analysis
 * @param {{pageText?: string, filePath?: string, evolution?: object}} [extra]
 */
function buildPageFacts(tab, a, extra = {}) {
  const s = a?.summary || {};
  switch (tab) {
    case 'Overview':
      return {
        repository: a?.meta ? `${a.meta.owner}/${a.meta.repo}` : undefined,
        aiSummary: s.aiExecutiveSummary || null,
        oneLiner: s.oneLiner,
        projectType: s.projectType,
        architecture: s.architectureType,
        stack: (s.primaryTechStack || []).slice(0, 6),
        complexity: s.complexity,
        onboardingTime: s.onboardingTime,
        filesAnalysed: s.analyzedFiles || s.totalFiles,
        entryPoint: a?.entryPoint?.file,
        insights: (s.quickInsights || []).slice(0, 4),
      };
    case 'Setup Guide':
      return {
        steps: (a?.setupSteps || []).slice(0, 8).map(x => ({ title: x.title, command: x.command })),
        requiredEnvVars: (a?.envVars || []).filter(e => e.required).map(e => e.name).slice(0, 6),
      };
    case 'Important Files':
      return {
        totalFiles: (a?.files || []).length,
        keyFiles: (a?.files || [])
          .filter(f => f.role && !/unknown|other/i.test(f.role))
          .slice(0, 8)
          .map(f => ({ name: base(f.path), role: f.role, description: f.description })),
        entryPoint: a?.entryPoint?.file,
      };
    case 'Time Machine':
      return timeMachineFacts(extra.evolution);
    case 'Architecture': {
      const nodes = a?.graph?.nodes || [];
      const edges = a?.graph?.edges || [];
      const degree = {};
      edges.forEach(e => { degree[e.source] = (degree[e.source] || 0) + 1; degree[e.target] = (degree[e.target] || 0) + 1; });
      const hubs = Object.entries(degree).sort((x, y) => y[1] - x[1]).slice(0, 4)
        .map(([id]) => nodes.find(n => n.id === id)?.label || base(id));
      return { architecture: s.architectureType, modules: nodes.length, connections: edges.length, mostConnected: hubs, entryPoint: a?.entryPoint?.file };
    }
    case 'APIs & Routes': {
      const routes = a?.routes || [];
      return {
        routeCount: routes.length,
        byMethod: countBy(routes, 'method'),
        protectedRoutes: routes.filter(r => r.auth).length,
        examples: routes.slice(0, 5).map(r => `${r.method} ${r.path}`),
        externalApis: (a?.apis || []).slice(0, 6).map(x => x.name),
      };
    }
    case 'Env Variables': {
      const vars = a?.envVars || [];
      return {
        total: vars.length,
        required: vars.filter(v => v.required).map(v => v.name).slice(0, 8),
        withDefaults: vars.filter(v => v.defaultValue).length,
      };
    }
    case 'Security Audit':
      return {
        securityScore: a?.securityScore,
        aiReview: a?.aiSecurityReview || null,
        alertsBySeverity: countBy(a?.securityAlerts, 'severity'),
        exposedSecrets: (a?.securityAlerts || []).filter(x => x.type === 'Exposed Secret').length,
        vulnerableDependencies: (a?.dependencySecurity || []).length,
        codeFindings: (a?.staticCodeAnalysis || []).length,
        gitHygieneIssues: (a?.gitHygiene || []).length,
        topRecommendations: (a?.securityRecommendations || []).slice(0, 3),
      };
    case 'Tech Debt Radar':
      return {
        securityItems: (a?.securityAlerts || []).length,
        dependencyItems: (a?.dependencySecurity || []).length,
        codeQualityItems: (a?.staticCodeAnalysis || []).length,
        hygieneItems: (a?.gitHygiene || []).length,
        recommendations: (a?.securityRecommendations || []).slice(0, 3),
      };
    case 'Onboarding Score': {
      const b = a?.onboardingScore?.breakdown || [];
      return {
        score: a?.onboardingScore?.score,
        passed: b.filter(x => x.passed).map(x => x.check).slice(0, 6),
        missing: b.filter(x => !x.passed).map(x => ({ check: x.check, tip: x.detail })).slice(0, 4),
      };
    }
    case 'README Generator':
      return { purpose: 'Generates a README for this repository with Gemma 4 from the analysis.', hasSetupSteps: (a?.setupSteps || []).length > 0, routeCount: (a?.routes || []).length };
    case 'AI Assistant':
      return { purpose: 'Chat with Gemma 4 about this repository. Answers cite file and line.', exampleQuestions: ['How do I run this project?', 'Where is authentication handled?', 'Which environment variables are required?'] };
    case DETAILED:
      return { file: extra.filePath, walkthrough: markdownToSpeech(extra.pageText).slice(0, 6000) };
    default:
      return {};
  }
}

/**
 * A spoken script built only from facts (no AI). Short, natural sentences.
 * @param {'full'|'brief'} length
 */
function factsNarration(tab, f, length = 'full') {
  const out = [];
  const brief = length === 'brief';
  switch (tab) {
    case 'Overview':
      if (f.aiSummary) out.push(f.aiSummary);
      else if (f.oneLiner) out.push(f.oneLiner);
      if (f.stack?.length) out.push(`It is built with ${listWords(f.stack, 4)}.`);
      if (f.complexity) out.push(`Complexity is ${String(f.complexity).toLowerCase()}, and a new developer needs about ${f.onboardingTime || 'a short while'} to get going.`);
      if (!brief && f.entryPoint) out.push(`Execution starts in ${base(f.entryPoint)}.`);
      if (!brief && f.insights?.length) out.push(f.insights[0]);
      break;
    case 'Setup Guide':
      if (f.steps?.length) {
        out.push(`There are ${plural(f.steps.length, 'setup step')} to get this project running.`);
        f.steps.slice(0, brief ? 2 : 5).forEach((st, i) => out.push(`Step ${i + 1}: ${st.title}.`));
      } else out.push('No setup steps were detected for this repository.');
      if (f.requiredEnvVars?.length) out.push(`Before running it, set ${listWords(f.requiredEnvVars, 3)}.`);
      break;
    case 'Important Files':
      out.push(`This page lists the ${plural(f.totalFiles || 0, 'analysed file')}, grouped by folder.`);
      if (f.entryPoint) out.push(`Start reading at ${base(f.entryPoint)}, the entry point.`);
      if (!brief && f.keyFiles?.length) out.push(`Other key files include ${listWords(f.keyFiles.map(k => k.name), 3)}.`);
      out.push('Open any file to get a Gemma walkthrough, or ask me to tell its story.');
      break;
    case 'Time Machine':
      if (f.loaded) {
        out.push(`I looked at ${plural(f.commitsExamined || 0, 'recent commit')}${f.from ? `, from ${f.from} to ${f.to}` : ''}.`);
        if (f.overview) out.push(f.overview);
        if (f.milestones?.length) out.push(`Key milestones include ${listWords(f.milestones.map(m => m.title), 3)}.`);
      } else {
        out.push('The Time Machine shows how this repository evolved, milestone by milestone.');
        out.push('Gemma explains what each change meant, and every file has its own story you can open.');
      }
      break;
    case 'Architecture':
      out.push(`The architecture graph shows ${plural(f.modules || 0, 'module')} and ${plural(f.connections || 0, 'connection')}.`);
      if (f.mostConnected?.length) out.push(`The most connected parts are ${listWords(f.mostConnected, 3)}.`);
      if (!brief && f.entryPoint) out.push(`Everything starts from ${base(f.entryPoint)}.`);
      break;
    case 'APIs & Routes':
      if (f.routeCount) {
        out.push(`This project exposes ${plural(f.routeCount, 'API route')}.`);
        const methods = Object.entries(f.byMethod || {}).map(([m, n]) => `${n} ${m.toUpperCase()}`);
        if (methods.length) out.push(`That is ${listWords(methods, 4)}.`);
        if (!brief) out.push(`${plural(f.protectedRoutes || 0, 'route')} ${f.protectedRoutes === 1 ? 'requires' : 'require'} authentication.`);
      } else out.push('No HTTP routes were detected in this repository.');
      if (!brief && f.externalApis?.length) out.push(`It talks to ${listWords(f.externalApis, 3)}.`);
      break;
    case 'Env Variables':
      out.push(`${plural(f.total || 0, 'environment variable')} ${f.total === 1 ? 'was' : 'were'} found.`);
      if (f.required?.length) out.push(`The required ones are ${listWords(f.required, 4)}.`);
      if (!brief) out.push(`${f.withDefaults || 0} of them have default values.`);
      break;
    case 'Security Audit':
      if (f.securityScore !== undefined) out.push(`The security score is ${f.securityScore} out of 100.`);
      if (f.aiReview && !brief) out.push(f.aiReview);
      else {
        out.push(`The scan found ${plural(f.exposedSecrets || 0, 'exposed secret')}, ${plural(f.vulnerableDependencies || 0, 'vulnerable dependency', 'vulnerable dependencies')} and ${plural(f.codeFindings || 0, 'code finding')}.`);
        if (f.topRecommendations?.length) out.push(`The first thing to fix: ${String(f.topRecommendations[0]).replace(/\.$/, '')}.`);
      }
      break;
    case 'Tech Debt Radar':
      out.push(`The radar groups ${(f.securityItems || 0) + (f.dependencyItems || 0) + (f.codeQualityItems || 0) + (f.hygieneItems || 0)} items into security, dependencies, code quality and hygiene.`);
      if (f.recommendations?.length) out.push(`Top recommendation: ${String(f.recommendations[0]).replace(/\.$/, '')}.`);
      break;
    case 'Onboarding Score':
      out.push(`This repository scores ${f.score ?? 'unknown'} out of 100 for onboarding.`);
      if (f.passed?.length && !brief) out.push(`It does well on ${listWords(f.passed, 3)}.`);
      if (f.missing?.length) out.push(`To improve, ${String(f.missing[0].tip || f.missing[0].check).replace(/\.$/, '')}.`);
      break;
    case 'README Generator':
      out.push('This page writes a clean README for the repository with Gemma 4, using the setup steps, routes and environment variables found in the analysis.');
      break;
    case 'AI Assistant':
      out.push('This is the AI Assistant. Ask Gemma 4 anything about the code, and answers point to the exact file and line.');
      break;
    case DETAILED: {
      const text = f.walkthrough || '';
      const sentences = text.replace(/\n/g, ' ').split(/(?<=[.!?])\s+/).filter(x => x.length > 3);
      out.push(...sentences.slice(0, brief ? 3 : 8));
      if (!out.length) out.push(`This page explains ${base(f.file) || 'the selected file'} line by line.`);
      break;
    }
    default:
      out.push('I can explain any page, take you on a tour, or open files for you.');
  }
  return out.filter(Boolean).map(x => String(x).trim()).filter(Boolean);
}

module.exports = { TABS, TOUR, DETAILED, buildPageFacts, factsNarration, markdownToSpeech };
