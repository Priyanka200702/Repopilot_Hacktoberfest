const IGNORED_DIRECTORIES = [
  'node_modules',
  'dist',
  'build',
  '.git',
  'coverage',
  '.next',
  '__pycache__',
  '.vscode',
  '.idea',
  'archive',
  'vendor',
  'assets'
];

const IGNORED_FILES = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml'
];

const IGNORED_EXTENSIONS = [
  '.lock',
  '.min.js',
  '.map',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.mp4',
  '.mp3'
];

const ALLOWED_EXTENSIONS = [
  // JavaScript / TypeScript
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  // Web
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.vue', '.svelte',
  // Mobile
  '.dart',       // Flutter / Dart
  '.swift',      // iOS / Swift
  '.kt', '.kts', // Kotlin / Android
  '.m', '.mm',   // Objective-C
  // Systems
  '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh',  // C / C++
  '.rs',         // Rust
  '.go',         // Go
  '.zig',        // Zig
  // JVM
  '.java',       // Java
  '.scala',      // Scala
  '.groovy',     // Groovy
  '.gradle',     // Gradle build files
  // Scripting
  '.py',         // Python
  '.rb',         // Ruby
  '.php',        // PHP
  '.lua',        // Lua
  '.r', '.R',    // R
  '.pl', '.pm',  // Perl
  '.ex', '.exs', // Elixir
  '.erl', '.hrl',// Erlang
  '.clj', '.cljs', // Clojure
  '.hs',         // Haskell
  // Shell & DevOps
  '.sh', '.bash', '.zsh', '.fish', '.bat', '.cmd', '.ps1',
  // Data & Config
  '.json', '.yaml', '.yml', '.toml', '.xml', '.ini', '.cfg',
  '.env', '.env.example', '.env.local', '.env.production',
  // Database & Query
  '.sql', '.graphql', '.gql', '.prisma',
  // Documentation & Markup
  '.md', '.mdx', '.rst', '.txt', '.adoc',
  // Build & CI
  '.cmake', '.makefile', '.mk',
  // Other
  '.proto',      // Protocol Buffers
  '.tf', '.hcl', // Terraform
  '.nix',        // Nix
  '.ino',        // Arduino
];

function isParseableFile(filePath, size = 0) {
  // Skip oversized files (500 KB)
  if (size > 500 * 1024) return false;

  // Skip ignored directories
  const parts = filePath.split('/');
  if (parts.some(part => IGNORED_DIRECTORIES.includes(part))) return false;

  // Skip ignored filenames
  const fileName = parts[parts.length - 1];
  if (IGNORED_FILES.includes(fileName)) return false;

  // Skip ignored extensions
  if (IGNORED_EXTENSIONS.some(ext => filePath.endsWith(ext))) return false;

  // Allow only known extensions + dotfiles like .env, .gitignore
  const hasAllowedExt = ALLOWED_EXTENSIONS.some(ext => filePath.endsWith(ext));
  const isDotFile = fileName.startsWith('.') && !fileName.includes('.min.');

  return hasAllowedExt || isDotFile;
}

// Test suites, fixtures, mocks and sample data describe how the app is TESTED,
// not how it runs. Counting them made test files look like the entry point,
// added test-only packages (e.g. mongoose) to the stack and inflated route and
// env-var counts. They stay in the file explorer and the security scan.
const TEST_DIRS = /(^|\/)(__tests__|__mocks__|__fixtures__|tests?|specs?|e2e|cypress|playwright|fixtures?|mocks?|testdata|test-data|test_data|examples?|samples?)\//i;
const TEST_FILES = /(^|\/)([^/]+\.(test|spec|e2e|stories|story|cy)\.[a-z0-9]+|test_[^/]+\.(js|cjs|mjs|ts|py|go|rb)|[^/]+_(test|spec)\.(go|py|js|ts|rb)|conftest\.py|setup-?tests\.[a-z]+|(jest|vitest|karma|playwright|cypress)\.config\.[a-z]+)$/i;
const MOCK_DATA = /(^|\/)(mock|mocks|fake|dummy|sample|seed)[^/]*\.(json|ya?ml|csv)$/i;

function isTestOrFixturePath(filePath = '') {
  const p = String(filePath).replace(/\\/g, '/');
  return TEST_DIRS.test(p) || TEST_FILES.test(p) || MOCK_DATA.test(p);
}

module.exports = {
  isParseableFile,
  isTestOrFixturePath
};
