# RepoPilot UI

**RepoPilot UI is an interactive codebase onboarding command center for analyzing GitHub repositories.**

## About the Project

### What the Repository is For
This repository provides the full web application codebase for RepoPilot UI, serving as the central hub for automated repository analysis, static code inspection, architecture visualization, and AI-driven documentation generation.

### What It Is
RepoPilot UI is a full-stack web application organized around a decoupled client-server architecture. The frontend is built with React, Vite, and Tailwind CSS, featuring interactive dashboards, dependency trees, security audits, and onboarding command tabs. The backend is an Express server running static analysis services, AST parsers, metadata extractors, and multi-provider AI integrations.

### How It Works
Execution starts from the backend entry point at `server/src/index.js` and frontend entry point at `client/src/main.tsx`. When a user submits a GitHub repository URL, the server fetches repository file structures via the GitHub API, parses source files with Babel AST parsers, extracts route definitions and environment requirements, and calculates security and architecture scores. The frontend renders this structured metadata into interactive visual panels.

### How It Is Used
Developers and engineering teams can use RepoPilot UI to onboard onto new codebases quickly. By analyzing any public repository, users can inspect API endpoints, environment variables, security posture, dependency relationships, and generate human-written README documentation.

## Quick Start

```bash
# Clone the repository
git clone https://github.com/GoDoFMoRtAlItY/RepoPilot-UI.git
cd RepoPilot-UI

# Install server dependencies and start backend
cd server
npm install
npm run dev

# Open a new terminal, install client dependencies and start frontend
cd ../client
npm install
npm run dev
```

The frontend application will run at http://localhost:5173/ and connect to the backend server at http://localhost:3001.

## Environment Variables

Configure the following variables in `server/.env`:

| Key | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | No | `3001` | Backend HTTP server port |
| `CORS_ORIGIN` | No | `http://localhost:5173` | Allowed CORS origins |
| `GITHUB_TOKEN` | Yes | - | GitHub Personal Access Token for API rate limit (5,000 req/hr) |
| `GEMINI_API_KEY` | One of these | - | Google AI Studio key; runs Gemma 4 (`gemma-4-31b-it`) |
| `OPENROUTER_API_KEY` | One of these | - | OpenRouter key; runs Gemma 4 (`google/gemma-4-31b-it`) |
| `OLLAMA_URL` | One of these | - | Local Ollama server; runs Gemma 4 locally (`gemma4:e4b`) |
| `GEMMA_MODEL` / `GEMMA_FAST_MODEL` | No | `gemma-4-31b-it` / `gemma-4-26b-a4b-it` | Gemma 4 models for long and short tasks |

## Time Machine (Gemma 4)

Every file has a story. In **Important Files**, expand a file and click **Tell this file's story** to see how it evolved: when it was created, the milestone commits that changed its responsibilities, renames and moves, and how today's version differs from the first one. The **Time Machine** tab shows the repository's major milestones.

- Git establishes what changed and when (commits, diffs, renames, imports, functions, routes). Gemma 4 explains what the changes mean, using milestone refs only, and its JSON is schema-validated before it is shown. Explanations are labelled as Gemma inferences; reasons are only given when the commit message or diff supports them.
- History is fetched lazily, only when a story is opened. A typical file story costs 1-2 commit-list calls per path (one more per rename followed), up to 20 commit-detail calls (cached per SHA forever), 2 content calls and **one** Gemma call. Reopening an unchanged file is served from cache with no GitHub detail calls and no Gemma call. The repository timeline costs about 1 + 1 + 12 GitHub calls and one Gemma call, and analyses only the latest 100 commits (flagged when older history exists).
- If Gemma is not configured or fails, both views still work and show the Git facts.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/time-machine/file-story` `{ owner, repo, path, ref?, refresh? }` | Story for one file |
| `GET /api/time-machine/:owner/:repo/commit/:sha?path=` | Lazy diff for one commit and file |
| `POST /api/time-machine/repo-evolution` `{ owner, repo, ref?, refresh? }` | Repository milestones |

Gemma is reached through the first configured backend: `GEMINI_API_KEY` (model `gemma-4-31b-it`), `OPENROUTER_API_KEY` (model `google/gemma-4-31b-it`) or a local `OLLAMA_URL` (model `gemma4:e4b`). Override with `GEMMA_BACKEND`, `GEMMA_MODEL` and `GEMMA_OLLAMA_MODEL`. Run the server tests with `cd server && npm test`.

## Voice assistant (Gemma 4)

A floating mic button (bottom right, or **Alt+V**) on the dashboard and the Detailed Analysis page.

- **Explain this page**: a spoken walkthrough of whatever page is open, written by Gemma 4 from that page's analysis data, with live captions and word highlighting. On the Detailed Analysis page it explains the file.
- **Guided tour**: "give me a tour" walks through Overview, Setup Guide, Architecture, APIs, Env Variables, Security, Onboarding Score and Time Machine, navigating and narrating each page (skip / end controls; the next page's script is prefetched while the current one plays).
- **Navigation and actions**: "open the security audit", "tell me the story of authController", "analyze orders.js", "back to the dashboard". Common commands are matched instantly in the browser; anything else (questions, fuzzy requests) goes to Gemma 4, which can also trigger actions. Every action Gemma proposes is checked against real pages and analysed files on the server.
- **Questions**: "how do I run this project?" gets a short spoken answer from the analysis.
- **English and Hindi**, voice and speed settings, hands-free mode, pause / resume / repeat, Esc to stop.
- If Gemma 4 is unavailable, page explanations fall back to scripts built from the analysis facts, so the tour still works.

Speech uses the browser's Web Speech APIs: speaking works in all modern browsers; listening works in Chrome, Edge and Safari (Chrome sends audio to Google's speech service). Other browsers can type commands in the panel. Endpoints: `POST /api/voice/narrate`, `POST /api/voice/command`.

## AI: Gemma 4 everywhere

Every AI feature runs on Gemma 4 through one provider (`server/src/services/ai/providers/GemmaProvider.js`): detailed file analysis, AI file descriptions, the AI Assistant, executive summary, security review, API explanations, README generation and the Time Machine. `GET /api/ai/status` shows which Gemma backend and model the server will use. Users can bring their own Google AI Studio or OpenRouter key in API Key Settings; it is used to call Gemma 4. If Gemma is unavailable, features fall back to RepoPilot's rule-based static analysis and say so (set `GEMMA_STRICT=true` to turn that off).

## Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS, Lucide React, Framer Motion, Zustand
- **Backend**: Node.js, Express 5, Octokit, Babel Parser, LRU Cache
- **AI**: Gemma 4 for every AI feature (31B for analysis, chat, README and Time Machine; 26B A4B for short tasks), served via Google AI Studio, OpenRouter or a local Ollama server
