/**
 * README generation runs on Gemma 4 (via ProviderManager). If Gemma is not
 * configured or fails, the caller falls back to generateFallbackReadme().
 *
 * @param {object} analysisJson repository analysis
 * @param {{key?: string, provider?: string}|string} [override] user key (BYOK) from request headers
 * @returns {Promise<string>} README markdown written by Gemma
 * @throws when Gemma did not produce the README (so the route can use the fallback)
 */
async function generateReadme(analysisJson, override) {
  const ProviderManager = require('./ai/ProviderManager');
  const result = await ProviderManager.execute('generateReadme', analysisJson, normalizeOverride(override));
  if (result.success && result.provider === 'gemma' && result.data) {
    return result.data;
  }
  throw new Error(result.success ? 'Gemma unavailable; using structured README' : result.message);
}

function normalizeOverride(override) {
  if (!override) return { key: undefined, provider: undefined };
  if (typeof override === 'string') return { key: override, provider: undefined };
  return { key: override.key || undefined, provider: override.provider || undefined };
}

/**
 * Clean fallback README when no API key is provided
 */
function generateFallbackReadme(analysisJson) {
  const { summary, setupSteps, envVars, routes, apis } = analysisJson || {};
  const { owner, repo, description } = analysisJson?.meta || { owner: 'Owner', repo: 'Project' };

  const projectType = summary?.projectType || 'Software Application';
  const archType = summary?.architectureType || 'Modular Architecture';
  const stackList = (summary?.primaryTechStack || []).join(', ') || 'Node.js, JavaScript';
  const entryFile = analysisJson?.entryPoint?.file || 'the main entry point';

  let readme = `# ${repo || 'Project'}\n\n`;

  // 1. One-line project summary at the top
  const oneLiner = summary?.oneLiner || `${repo || 'This software'} is a ${projectType} built using ${stackList}.`;
  readme += `**${oneLiner}**\n\n`;

  // 2. Detailed project overview
  readme += `## About the Project\n\n`;
  
  readme += `### What the Repository is For\n`;
  readme += `This repository contains the codebase for ${repo || 'the application'}. It provides developers and maintainers with an organized environment to build, test, and deploy ${projectType.toLowerCase()} features effectively.\n\n`;

  readme += `### What It Is\n`;
  readme += `${repo || 'The project'} is structured as a ${projectType} utilizing a ${archType}. `;
  if (description) {
    readme += `${description} `;
  }
  readme += `It combines backend logic, client interfaces, data models, and API utilities using ${stackList}.\n\n`;

  readme += `### How It Works\n`;
  readme += `Execution starts at \`${entryFile}\`. Incoming requests pass through middleware layers to handle routing, authentication, and validation before reaching core services. `;
  if (routes && routes.length > 0) {
    readme += `The application exposes ${routes.length} active API endpoints for system communication. `;
  }
  if (envVars && envVars.length > 0) {
    readme += `System behavior and external connections are configured using ${envVars.length} environment variables. `;
  }
  readme += `\n\n`;

  readme += `### How It Is Used\n`;
  readme += `Developers can clone the repository, install dependencies, configure environment settings, and launch the application locally or in production environments. It can operate as a standalone service or integrate with existing technical pipelines.\n\n`;

  // 3. Quick Start
  readme += `## Quick Start\n\n`;
  if (setupSteps && setupSteps.length > 0) {
    readme += `\`\`\`bash\n`;
    setupSteps.forEach(step => {
      readme += `# ${step.title}\n${step.command}\n\n`;
    });
    readme = readme.trimEnd() + `\n\`\`\`\n\n`;
  } else {
    readme += `\`\`\`bash\n# Install project dependencies\nnpm install\n\n# Start the development server\nnpm run dev\n\`\`\`\n\n`;
  }

  // 4. Environment Variables
  if (envVars && envVars.length > 0) {
    readme += `## Environment Variables\n\nConfigure the following environment keys in your .env file:\n\n`;
    readme += `| Key | Required | Default |\n| --- | --- | --- |\n`;
    envVars.forEach(ev => {
      readme += `| \`${ev.name}\` | ${ev.required ? 'Yes' : 'No'} | ${ev.defaultValue ? `\`${ev.defaultValue}\`` : '-'} |\n`;
    });
    readme += '\n';
  }

  // 5. API Endpoints
  if (routes && routes.length > 0) {
    readme += `## API Endpoints\n\n`;
    readme += `| Method | Endpoint Path | Source File |\n| --- | --- | --- |\n`;
    routes.slice(0, 15).forEach(rt => {
      readme += `| \`${rt.method}\` | \`${rt.path}\` | \`${rt.file}\` |\n`;
    });
    if (routes.length > 15) {
      readme += `\n*${routes.length - 15} additional endpoints omitted for brevity.*\n`;
    }
    readme += '\n';
  }

  // 6. Tech Stack
  if (apis && apis.length > 0) {
    readme += `## Tech Stack\n\n`;
    const categories = {};
    apis.forEach(api => {
      if (!categories[api.category]) categories[api.category] = [];
      categories[api.category].push(api.name);
    });
    
    for (const [cat, items] of Object.entries(categories)) {
      const categoryName = cat.charAt(0).toUpperCase() + cat.slice(1);
      readme += `${categoryName}: ${items.join(', ')}\n\n`;
    }
  }

  return readme.trim();
}

module.exports = {
  generateReadme,
  generateFallbackReadme
};
