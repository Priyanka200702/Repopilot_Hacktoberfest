const BaseProvider = require('./BaseProvider');

/**
 * A rich static-analysis fallback when all AI providers are rate-limited.
 * Extracts each function/class definition, isolates its OWN body using
 * brace-counting or indentation, then infers purpose from keywords.
 */
class MockProvider extends BaseProvider {
  constructor() {
    super('Mock');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Core body extractor
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Remove the "42: " line-number prefix the route layer adds.
   */
  _stripLineNumbers(content) {
    return content.replace(/^\d+:\s?/gm, '');
  }

  /**
   * Given the full source (without line-number prefix) and the index of the
   * line where a function/class starts, return only the lines that belong to
   * that definition's own body (not nested definitions).
   *
   * Strategy:
   *   - Brace-counting for C-style languages (JS/TS/Dart/Java/Go/Kotlin/Swift).
   *   - Indentation-based for Python.
   */
  _extractBody(lines, startIdx) {
    const headerLine = lines[startIdx] || '';
    const isPython = !headerLine.includes('{') && headerLine.trimEnd().endsWith(':');

    if (isPython) {
      // Python: collect lines that are more indented than the def line
      const defIndent = headerLine.search(/\S/);
      const body = [];
      for (let i = startIdx + 1; i < lines.length && i < startIdx + 120; i++) {
        const line = lines[i];
        if (line.trim() === '') { body.push(line); continue; }
        const indent = line.search(/\S/);
        if (indent <= defIndent) break;
        body.push(line);
      }
      return body.join('\n');
    }

    // Brace-counting: start counting from the header line onwards
    let depth = 0;
    let started = false;
    const body = [];

    for (let i = startIdx; i < lines.length && i < startIdx + 150; i++) {
      const line = lines[i];
      for (const ch of line) {
        if (ch === '{') { depth++; started = true; }
        if (ch === '}') { depth--; }
      }
      if (i > startIdx) body.push(line); // skip the declaration line itself
      if (started && depth <= 0) break;   // closed the outer brace
    }

    return body.join('\n');
  }

  /**
   * Scan every line for a function/class declaration, then extract only that
   * function's isolated body.
   * Returns: [{ name, body }]
   */
  _extractFunctions(rawCode) {
    const lines = rawCode.split('\n');
    const results = [];
    const seen = new Set();

    // Combined regex — try each in order and take first match per line
    const patterns = [
      // JS/TS arrow const
      /(?:export\s+)?(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>/,
      // JS/TS function declaration
      /(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/,
      // Class declaration
      /(?:export\s+)?(?:abstract\s+)?(?:public\s+)?class\s+([a-zA-Z_$][a-zA-Z0-9_$<>]*)/,
      // Dart/Java/C# typed method
      /(?:@\w+\s+)*(?:static\s+)?(?:async\s+)?(?:void|Widget|Future<[^>]*>|int|double|String|bool|Map<[^>]*>|List<[^>]*>|dynamic|BuildContext)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/,
      // Python def
      /^def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/,
      // Go func
      /^func\s+(?:\([^)]*\)\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/,
    ];

    const SKIP = new Set(['if', 'for', 'while', 'switch', 'catch', 'return',
      'in', 'of', 'new', 'await', 'else', 'try', 'do',
      'print', 'super', 'assert']);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pat of patterns) {
        const m = pat.exec(line);
        if (m && m[1] && !SKIP.has(m[1])) {
          const name = m[1];
          if (!seen.has(name)) {
            seen.add(name);
            const body = this._extractBody(lines, i);
            results.push({ name, body });
          }
          break;
        }
      }
    }

    return results;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Keyword inference engine — generates UNIQUE bullets per function body
  // ─────────────────────────────────────────────────────────────────────────

  _inferDescription(name, body) {
    const b = body.toLowerCase();
    const bullets = [];

    const has = (...patterns) => patterns.some(p => p instanceof RegExp ? p.test(b) : b.includes(p));

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    if (has('initstate', 'super.initstate'))
      bullets.push('Runs once when the widget first mounts — initializes controllers and fetches initial data.');
    if (has('dispose()', 'controller.dispose', 'super.dispose'))
      bullets.push('Releases resources and controllers to prevent memory leaks when the widget is removed.');

    // ── Authentication ────────────────────────────────────────────────────────
    if (has('currentuser', 'firebase.auth', 'auth.currentuser', 'user.uid', 'getuser'))
      bullets.push('Verifies the currently logged-in user to ensure authentication before proceeding.');
    if (has('signout', 'logout', /sign_?out\s*\(/))
      bullets.push('Signs the user out and clears the active session.');
    if (has('login', 'signin', /sign_?in\s*\(/, 'authenticate'))
      bullets.push('Handles user login and initialises the authenticated session.');
    if (has('token', 'jwt', 'bearer', 'authorization'))
      bullets.push('Validates or attaches an authentication token to the request.');

    // ── Network / HTTP ────────────────────────────────────────────────────────
    if (has('fetch(', 'axios.', 'http.', 'dio.', /\.get\s*\(/, /\.post\s*\(/, /\.put\s*\(/, /\.delete\s*\(/))
      bullets.push('Makes an HTTP request to an external API or backend service.');
    if (has('await '))
      bullets.push('Runs asynchronous operations and waits for their completion before continuing.');

    // ── Firestore / Firebase ──────────────────────────────────────────────────
    if (has('firestore', 'firebase', '.collection(', '.doc(', '.where('))
      bullets.push('Interacts with a Firestore database collection to read or write data.');
    if (has('batch.', '.commit('))
      bullets.push('Uses a Firestore batch write to execute multiple database operations atomically.');
    if (has('.set(', '.update(', '.add(') && has('firestore', 'firebase', 'db', 'collection', 'batch'))
      bullets.push('Creates or updates a document in the Firestore database.');
    if (has('.delete(') && has('firebase', 'firestore', 'db', 'collection'))
      bullets.push('Deletes a document or record from the database.');
    if (has('.get()', '.stream(', '.snapshots('))
      bullets.push('Fetches or streams data from Firestore and returns the result.');

    // ── Notifications ─────────────────────────────────────────────────────────
    if (has('notification', 'fcm', 'pushnotification', 'sendnotification', 'firebase_messaging'))
      bullets.push('Sends a push notification to one or more devices via FCM.');
    if (has('email', 'sendmail', 'nodemailer', 'smtp'))
      bullets.push('Sends an email using a configured mail service.');

    // ── Location / GPS ────────────────────────────────────────────────────────
    if (has('geolocator', 'location()', 'gps', 'latitude', 'longitude', 'getposition', 'getcurrentposition'))
      bullets.push('Retrieves the device\'s current GPS coordinates.');
    if (has('geocod', 'addressfrom', 'getaddress', 'placemarks'))
      bullets.push('Converts GPS coordinates into a human-readable address (reverse geocoding).');

    // ── State / UI ────────────────────────────────────────────────────────────
    if (has('setstate', 'notifylisteners', 'emit(', 'statemanager'))
      bullets.push('Triggers a UI rebuild by updating the component\'s state.');
    if (has('textcontroller', 'controller.text', 'focusnode', 'editingcontroller'))
      bullets.push('Reads or manages input from a text field controller.');
    if (has('showdialog', 'alertdialog', 'showbottomsheet', 'showmodalbottomsheet'))
      bullets.push('Opens a dialog or bottom sheet for user interaction.');
    if (has('snackbar', 'toast', 'showsnackbar'))
      bullets.push('Shows a snackbar or toast notification as user feedback.');
    if (has('navigator.push', 'navigation.navigate', 'context.go(', 'routes.'))
      bullets.push('Navigates the user to another screen or route.');
    if (name === 'build' && has('scaffold', 'column', 'row', 'container', 'text(', 'padding', 'widget.'))
      bullets.push('Constructs and returns the widget tree that defines this screen\'s visual layout.');
    else if (name !== 'build' && has('scaffold', 'column', 'row', 'container', 'text(', 'padding', 'widget.'))
      bullets.push('Returns a reusable UI widget or sub-component for rendering.');
    if (has('animation', 'animationcontroller', 'tweenanimation', 'ticker'))
      bullets.push('Controls a UI animation such as a slide, fade, or confetti effect.');

    // ── Validation ────────────────────────────────────────────────────────────
    if (has('.isempty', '.trim()', 'validate(', 'formkey', 'validator', 'required'))
      bullets.push('Validates form inputs and returns errors for empty or invalid fields.');

    // ── Date / Time ───────────────────────────────────────────────────────────
    if (has('datepicker', 'timepicker', 'showdatepicker', 'showtimepicker'))
      bullets.push('Opens a date or time picker dialog so the user can select a value.');
    if (has('timestamp', 'datetime.now', 'new date()', 'toisostring') && !has('showdatepicker'))
      bullets.push('Captures or formats the current date and time as a timestamp.');

    // ── File / Image ──────────────────────────────────────────────────────────
    if (has('imagepicker', 'image_picker', 'pickedfile', 'pickimage'))
      bullets.push('Opens the camera or gallery for the user to select an image.');
    if (has('fs.read', 'fs.write', 'readfile', 'writefile', 'path.join') && !has('imagepicker'))
      bullets.push('Reads from or writes to a local file on disk.');
    if (has('upload', 'storagereference', 'firebase.storage', 'putfile'))
      bullets.push('Uploads a file or image to cloud storage.');

    // ── Map ───────────────────────────────────────────────────────────────────
    if (has('googlemapcontroller', 'mapcontroller', 'setmarker', 'latlng'))
      bullets.push('Controls a Google Maps widget — places markers or repositions the camera.');

    // ── Express / API routes ──────────────────────────────────────────────────
    if (has('res.json', 'res.send', 'res.status', 'req.body', 'req.params'))
      bullets.push('Handles an HTTP route — reads the request payload and sends a JSON response.');
    if (has('router.get', 'router.post', 'router.put', 'router.delete'))
      bullets.push('Registers HTTP API routes for this module.');
    if (has('middleware', 'next('))
      bullets.push('Acts as Express middleware — processes the request before passing it on.');

    // ── React hooks ───────────────────────────────────────────────────────────
    if (has('usestate', 'useeffect', 'usecallback', 'usememo', 'useref'))
      bullets.push('Uses React hooks to manage local component state or side effects.');
    if (has('props.', '{children}'))
      bullets.push('Receives props from a parent component to customise its behaviour.');

    // ── Utilities ─────────────────────────────────────────────────────────────
    if (has('.filter(', '.map(', '.reduce(', '.find(', '.sort('))
      bullets.push('Transforms or filters a list/array to produce a derived result.');
    if (has('json.parse', 'json.stringify', 'jsonencode', 'jsondecode'))
      bullets.push('Serialises or deserialises data between JSON and a Dart/JS object.');
    if (has('console.log', 'print(', 'debugprint', 'logger.'))
      bullets.push('Logs debug information to the console during development.');
    if (has('trycatch', 'try {', 'catch (', 'catch('))
      bullets.push('Wraps operations in try/catch to handle errors gracefully.');

    // ── Constructor fallback ──────────────────────────────────────────────────
    if (has('super(', 'this.') && bullets.length === 0)
      bullets.push('Initialises class properties and runs constructor-time setup logic.');

    // ── Generic fallback ──────────────────────────────────────────────────────
    if (bullets.length === 0)
      bullets.push('Executes a specific step in the application logic for this feature.');

    return [...new Set(bullets)];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // File-level summary builder
  // ─────────────────────────────────────────────────────────────────────────

  _buildSummary(fileName) {
    const baseName = fileName.split('/').pop().replace(/\.[^/.]+$/, '');
    const ext = (fileName.split('.').pop() || '').toLowerCase();

    const langMap = {
      dart: 'Flutter/Dart', js: 'JavaScript', ts: 'TypeScript', tsx: 'React (TSX)',
      jsx: 'React (JSX)', py: 'Python', go: 'Go', java: 'Java', kt: 'Kotlin',
      swift: 'Swift', rb: 'Ruby', rs: 'Rust', php: 'PHP', vue: 'Vue'
    };
    const lang = langMap[ext] || 'source code';

    const nameL = baseName.toLowerCase();
    let purpose = 'provides core application logic';
    if (nameL.includes('auth') || nameL.includes('login') || nameL.includes('signin'))
      purpose = 'handles user authentication and login flows';
    else if (nameL.includes('home')) purpose = 'renders the main home screen of the application';
    else if (nameL.includes('profile')) purpose = 'manages the user profile view and related actions';
    else if (nameL.includes('dashboard')) purpose = 'renders the dashboard and aggregates summary data';
    else if (nameL.includes('settings')) purpose = 'manages application settings and user preferences';
    else if (nameL.includes('api') || nameL.includes('route') || nameL.includes('router'))
      purpose = 'defines API routes and handles incoming HTTP requests';
    else if (nameL.includes('service') || nameL.includes('provider'))
      purpose = 'encapsulates a service layer for data access or business logic';
    else if (nameL.includes('model') || nameL.includes('entity'))
      purpose = 'defines a data model or entity structure used across the app';
    else if (nameL.includes('util') || nameL.includes('helper') || nameL.includes('filter'))
      purpose = 'provides utility and helper functions reused across the codebase';
    else if (nameL.includes('widget') || nameL.includes('component') || nameL.includes('button') || nameL.includes('card'))
      purpose = 'defines a reusable UI widget or component';
    else if (nameL.includes('screen') || nameL.includes('page'))
      purpose = 'renders a full application screen and handles its interactions';
    else if (nameL.includes('index'))
      purpose = 'acts as the entry point and wires the application together';
    else if (nameL.includes('add') || nameL.includes('create'))
      purpose = 'provides a form or workflow for creating new records or items';
    else if (nameL.includes('detail') || nameL.includes('view'))
      purpose = 'renders the detailed view of a selected item';
    else if (nameL.includes('list') || nameL.includes('feed'))
      purpose = 'fetches and displays a list of items from the data source';

    return `This is a **${lang}** file that **${purpose}**. It is composed of the classes and functions described below.`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  async generateDetailedAnalysis(fileName, fileContent, overrideKey) {
    const rawCode = this._stripLineNumbers(fileContent);
    const summary = this._buildSummary(fileName);
    const functions = this._extractFunctions(rawCode);

    let functionsList = '';

    if (functions.length === 0) {
      functionsList = '1. **Module-level execution**\n   - Runs top-level instructions when this file is imported or executed directly.';
    } else {
      functionsList = functions.map((fn, i) => {
        const bullets = this._inferDescription(fn.name, fn.body);
        const bulletLines = bullets.map(b => `   - ${b}`).join('\n');
        return `${i + 1}. **\`${fn.name}\`**\n${bulletLines}`;
      }).join('\n\n');
    }

    functionsList += `\n\n> Static analysis fallback: Gemma 4 was not available for this request, so each description is inferred from the code inside that function. Retry to get the Gemma 4 walkthrough.`;

    return `## File Overview\n${summary}\n\n---\n\n## Functions & Classes\n\n${functionsList}`;
  }

  async generateFileDescription(fileName, compressedContext, overrideKey) {
    const name = fileName.split('/').pop().replace(/\.[^/.]+$/, '');
    return `Core project module that manages application logic and structures for ${name}.`;
  }

  async answerQuestion(question, analysisJson, overrideKey) {
    return {
      answer: `*(Mock AI Fallback)* I am currently running in offline mock mode because the configured AI models are rate-limited or out of credits. \n\nYou asked: "${question}"\n\nTo restore full intelligence, please update your API keys or wait for rate limits to reset.`,
      citations: []
    };
  }

  async generateExecutiveSummary(analysisJson, overrideKey) {
    return "*(Mock AI Fallback)* The repository analysis was completed successfully, but the AI executive summary generation is unavailable due to API rate limits or exhausted credits. Please update the API configuration to restore AI insights.";
  }

  async generateSecurityReview(analysisJson, overrideKey) {
    return "*(Mock AI Fallback)* Security review unavailable due to AI rate limits.";
  }

  async generateApiExplanation(route, overrideKey) {
    return "*(Mock AI Fallback)* API explanation unavailable due to AI rate limits.";
  }

  async generateReadme(analysisJson, overrideKey) {
    const { generateFallbackReadme } = require('../../aiReadme');
    return generateFallbackReadme(analysisJson);
  }
}

module.exports = MockProvider;
