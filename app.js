const tools = [
  { id: 'json-formatter', name: 'JSON Formatter', description: 'Format, validate, and pretty-print JSON.', category: 'data', icon: '{}' },
  { id: 'yaml-converter', name: 'YAML Converter', description: 'Convert cleanly between YAML and JSON.', category: 'data', icon: 'Y' },
  { id: 'csv-viewer', name: 'CSV Viewer', description: 'Preview CSV, TSV, and semicolon data as a table.', category: 'data', icon: '≡' },
  { id: 'json-diff', name: 'JSON Diff', description: 'Compare structured objects path by path.', category: 'data', icon: 'Δ' },
  { id: 'jwt-decoder', name: 'JWT Decoder', description: 'Inspect token headers, claims, and expiry.', category: 'security', icon: 'JWT' },
  { id: 'hash-generator', name: 'Hash Generator', description: 'Generate SHA and HMAC digests locally.', category: 'security', icon: '#' },
  { id: 'csp-builder', name: 'CSP Builder', description: 'Build a strict Content Security Policy.', category: 'security', icon: 'CSP' },
  { id: 'password-entropy', name: 'Password Entropy', description: 'Estimate strength and time to crack.', category: 'security', icon: '•••' },
  { id: 'cidr-calculator', name: 'CIDR Calculator', description: 'Calculate a CIDR, or build one from a range.', category: 'network', icon: '/24' },
  { id: 'url-parser', name: 'URL Parser', description: 'Break a URL into fields, or build one from them.', category: 'network', icon: '://' },
  { id: 'http-headers', name: 'HTTP Header Inspector', description: 'Explain request and response headers.', category: 'network', icon: 'H' },
  { id: 'dns-lookup', name: 'DNS Lookup', description: 'Query live records via DNS-over-HTTPS.', category: 'network', icon: 'DNS' },
  { id: 'regex-tester', name: 'Regex Tester', description: 'Test expressions against sample text.', category: 'text', icon: '.*' },
  { id: 'case-converter', name: 'Case Converter', description: 'Switch between common naming styles.', category: 'text', icon: 'Aa' },
  { id: 'text-diff', name: 'Text Diff', description: 'Compare two text blocks line by line.', category: 'text', icon: '±' },
  { id: 'slug-generator', name: 'Slug Generator', description: 'Create URL-safe slugs from text.', category: 'text', icon: '-' },
  { id: 'docker-linter', name: 'Dockerfile Linter', description: 'Check images against best practices.', category: 'devops', icon: 'D' },
  { id: 'compose-validator', name: 'Compose Validator', description: 'Validate a Compose file, or build one.', category: 'devops', icon: 'DC' },
  { id: 'cron-builder', name: 'Cron Builder', description: 'Explain cron expressions and preview runs.', category: 'devops', icon: '⏱' },
  { id: 'gitignore-builder', name: '.gitignore Builder', description: 'Combine templates for your stack.', category: 'devops', icon: 'git' },
  { id: 'uuid-generator', name: 'UUID Generator', description: 'Generate v4/v7 UUIDs, or inspect one.', category: 'generators', icon: 'ID' },
  { id: 'id-generator', name: 'ULID / NanoID', description: 'Generate, or decode a ULID’s timestamp.', category: 'generators', icon: 'UL' },
  { id: 'timestamp-converter', name: 'Timestamp Converter', description: 'Convert Unix and ISO timestamps.', category: 'generators', icon: 'T' },
  { id: 'random-string', name: 'Random String', description: 'Generate configurable random strings.', category: 'generators', icon: 'R' },
  { id: 'passphrase-generator', name: 'Passphrase Generator', description: 'Build memorable word-based passphrases.', category: 'generators', icon: '⚿' },
  { id: 'lorem-ipsum', name: 'Lorem Ipsum', description: 'Generate placeholder words and paragraphs.', category: 'generators', icon: '¶' },
  { id: 'luhn-check', name: 'Luhn / Test Cards', description: 'Validate or generate Luhn card numbers.', category: 'generators', icon: '⊞' },
  { id: 'qr-generator', name: 'QR Generator', description: 'Render QR codes, or paste an image to decode.', category: 'generators', icon: 'QR' },

  // Encode pack (tools-encode.js)
  { id: 'base64', name: 'Base64', description: 'Encode or decode base64 and base64url.', category: 'encode', icon: 'b64' },
  { id: 'url-encode', name: 'URL Encode', description: 'Percent-encode or decode text and URLs.', category: 'encode', icon: '%' },
  { id: 'html-entities', name: 'HTML Entities', description: 'Encode or decode HTML entities.', category: 'encode', icon: '&' },
  { id: 'unicode-escape', name: 'Unicode Escape', description: 'Convert to and from \\u escapes.', category: 'encode', icon: '\\u' },
  { id: 'hex-text', name: 'Hex ↔ Text', description: 'Encode text as hex, or decode hex bytes.', category: 'encode', icon: '0x' },
  { id: 'binary-text', name: 'Binary ↔ Text', description: 'Encode text as bits, or decode them.', category: 'encode', icon: '01' },
  { id: 'quoted-printable', name: 'Quoted-Printable', description: 'Encode or decode =XX email text.', category: 'encode', icon: '=' },
  { id: 'punycode', name: 'Punycode / IDNA', description: 'Convert Unicode domains to xn-- and back.', category: 'encode', icon: 'xn' },
  { id: 'rot13', name: 'ROT13', description: 'The classic self-inverse letter rotation.', category: 'encode', icon: '13' },
  { id: 'morse-code', name: 'Morse Code', description: 'Translate text to and from Morse.', category: 'encode', icon: '·−' },
  { id: 'utf8-inspector', name: 'UTF-8 Inspector', description: 'Break text into code points and bytes.', category: 'encode', icon: 'U+' },
  { id: 'hex-dump', name: 'Hex Dump', description: 'Offset / hex / ASCII dump of text bytes.', category: 'encode', icon: 'HD' },
  { id: 'ascii-table', name: 'ASCII Table', description: 'Browse and filter the ASCII table.', category: 'encode', icon: 'A' },
  { id: 'base-converter', name: 'Base Converter', description: 'Convert numbers between bases 2–36.', category: 'encode', icon: '2₃' },
  { id: 'roman-numerals', name: 'Roman Numerals', description: 'Convert numbers to and from Roman.', category: 'encode', icon: 'Ⅻ' },

  // Text upgrades (tools-encode.js)
  { id: 'text-counter', name: 'Text Counter', description: 'Count words, lines, characters, bytes.', category: 'text', icon: '#' },
  { id: 'line-tools', name: 'Line Tools', description: 'Sort, dedupe, reverse, shuffle lines.', category: 'text', icon: '≣' },

  // Web/format pack (tools-web.js)
  { id: 'json-transform', name: 'JSON Transform', description: 'Minify, pretty-print, or sort keys.', category: 'data', icon: 'J↕' },
  { id: 'json-merge', name: 'JSON Merge', description: 'Deep-merge two or more JSON documents.', category: 'data', icon: 'J+' },
  { id: 'json-to-csv', name: 'JSON → CSV', description: 'Flatten a JSON array into CSV.', category: 'data', icon: 'J▸' },
  { id: 'csv-to-json', name: 'CSV → JSON', description: 'Convert CSV into a JSON array.', category: 'data', icon: '▸J' },
  { id: 'json-schema', name: 'JSON Schema', description: 'Infer a JSON Schema from a sample.', category: 'data', icon: 'JS' },
  { id: 'jsonpath', name: 'JSONPath Tester', description: 'Query JSON with a JSONPath expression.', category: 'data', icon: '$.' },
  { id: 'xml-formatter', name: 'XML Formatter', description: 'Indent XML and convert it to JSON.', category: 'data', icon: '</>' },
  { id: 'html-formatter', name: 'HTML Formatter', description: 'Indent and tidy HTML markup.', category: 'web', icon: 'H' },
  { id: 'html-to-markdown', name: 'HTML → Markdown', description: 'Convert HTML into Markdown.', category: 'web', icon: 'H▸' },
  { id: 'markdown-to-html', name: 'Markdown → HTML', description: 'Render Markdown as HTML.', category: 'web', icon: '▸H' },
  { id: 'markdown-toc', name: 'Markdown TOC', description: 'Build a table of contents from headings.', category: 'web', icon: '☰' },
  { id: 'sql-formatter', name: 'SQL Formatter', description: 'Format SQL across its clauses.', category: 'web', icon: 'SQL' },
  { id: 'csv-to-insert', name: 'CSV → SQL INSERT', description: 'Turn CSV rows into INSERT statements.', category: 'web', icon: 'INS' },
  { id: 'color-converter', name: 'Color Converter', description: 'Convert HEX, RGB, HSL and check luminance.', category: 'web', icon: '◑' },
  { id: 'contrast-checker', name: 'Contrast Checker', description: 'Check WCAG contrast between two colors.', category: 'web', icon: '◐' },

  // Network additions (tools-web.js)
  { id: 'ip-calculator', name: 'IP Calculator', description: 'Convert an IPv4 to int, hex, binary, IPv6.', category: 'network', icon: 'IP' },
  { id: 'reverse-dns', name: 'Reverse DNS', description: 'Look up the PTR record for an IPv4.', category: 'network', icon: 'PTR' },
  { id: 'port-lookup', name: 'Port Lookup', description: 'Identify well-known TCP/UDP ports.', category: 'network', icon: ':P' },
  { id: 'mime-lookup', name: 'MIME Lookup', description: 'Map extensions to MIME types and back.', category: 'network', icon: 'M' },
  { id: 'status-code', name: 'HTTP Status Codes', description: 'Look up any HTTP status code.', category: 'network', icon: '2xx' },
  { id: 'cookie-parser', name: 'Cookie Parser', description: 'Break down a header, or build one from fields.', category: 'network', icon: '🍪' },
  { id: 'query-string', name: 'Query String', description: 'Decode or build URL query strings.', category: 'network', icon: '?=' },
  { id: 'curl-builder', name: 'curl Builder', description: 'Assemble a curl command from parts.', category: 'network', icon: '$' },
  { id: 'file-signature', name: 'File Signature', description: 'Identify a file, or look up a type’s magic bytes.', category: 'network', icon: '⌘' },

  // Security addition (tools-web.js)
  { id: 'jwt-generate', name: 'JWT Generator', description: 'Build an unsigned test JWT from JSON.', category: 'security', icon: 'JW+' }
];

const CATEGORIES = [
  ['data', 'Data'],
  ['encode', 'Encode & Convert'],
  ['web', 'Web & Format'],
  ['security', 'Security'],
  ['network', 'Network'],
  ['text', 'Text'],
  ['devops', 'DevOps'],
  ['generators', 'Generators']
];

// These tools should not fire on every keystroke: network tools hit the wire,
// and generators would re-randomize while you type.
const MANUAL_TOOLS = new Set([
  'dns-lookup', 'reverse-dns',
  'uuid-generator', 'id-generator', 'random-string',
  'passphrase-generator', 'lorem-ipsum'
]);

const STORAGE_KEYS = {
  favorites: 'devtoolbox.favorites',
  theme: 'devtoolbox.theme',
  lastTool: 'devtoolbox.lastTool'
};
const DEFAULT_FAVORITES = ['json-formatter', 'jwt-decoder', 'cidr-calculator', 'regex-tester'];
const LIVE_DELAY_MS = 280;

function storageGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* private mode etc. */ }
}
function loadIdList(key, fallback) {
  let list;
  try { list = JSON.parse(storageGet(key)); } catch (e) { list = null; }
  if (!Array.isArray(list)) list = fallback;
  return list.filter(id => tools.some(tool => tool.id === id));
}

const favorites = new Set(loadIdList(STORAGE_KEYS.favorites, DEFAULT_FAVORITES));
let activeToolId = loadIdList(STORAGE_KEYS.lastTool, ['json-formatter'])[0] || 'json-formatter';
let runCounter = 0;
let liveTimer = null;

const toolList = document.getElementById('toolList');
const searchInput = document.getElementById('searchInput');
const input = document.getElementById('toolInput');
const output = document.getElementById('toolOutput');
const status = document.getElementById('toolStatus');
const runButton = document.getElementById('runTool');
const favoriteButton = document.getElementById('favoriteButton');
const swapButton = document.getElementById('swapOutput');
const copyButton = document.getElementById('copyOutput');
const themeToggle = document.getElementById('themeToggle');
const seam = document.querySelector('.seam');

function activeTool() {
  return tools.find(tool => tool.id === activeToolId);
}

function isManual(id = activeToolId) {
  return MANUAL_TOOLS.has(id);
}

/* ---------- navigation rail ---------- */

function matchesQuery(tool, query) {
  return !query || `${tool.name} ${tool.description} ${tool.category}`.toLowerCase().includes(query);
}

function renderList() {
  const query = searchInput.value.trim().toLowerCase();
  toolList.innerHTML = '';
  let shown = 0;

  const addGroup = (label, groupTools, showPin) => {
    if (!groupTools.length) return;
    const heading = document.createElement('p');
    heading.className = 'group-label';
    heading.textContent = label;
    toolList.appendChild(heading);
    for (const tool of groupTools) {
      const row = document.createElement('button');
      row.className = `tool-row${tool.id === activeToolId ? ' active' : ''}`;
      row.type = 'button';

      const glyph = document.createElement('span');
      glyph.className = 'tool-glyph';
      glyph.textContent = tool.icon;

      const name = document.createElement('span');
      name.textContent = tool.name;

      row.append(glyph, name);
      if (showPin && favorites.has(tool.id)) {
        const pin = document.createElement('span');
        pin.className = 'pin';
        pin.textContent = '★';
        row.appendChild(pin);
      }
      row.addEventListener('click', () => {
        openTool(tool.id);
        closeNav();
      });
      toolList.appendChild(row);
      shown++;
    }
  };

  const pinned = [...favorites].map(id => tools.find(tool => tool.id === id)).filter(tool => matchesQuery(tool, query));
  addGroup('Pinned', pinned, false);
  for (const [key, label] of CATEGORIES) {
    addGroup(label, tools.filter(tool => tool.category === key && matchesQuery(tool, query)), true);
  }

  if (!shown) {
    const empty = document.createElement('p');
    empty.className = 'list-empty';
    empty.textContent = `Nothing matches “${searchInput.value.trim()}”. Try a shorter term.`;
    toolList.appendChild(empty);
  }
}

/* ---------- workspace ---------- */

function setStatus(message, type = '') {
  status.textContent = message;
  status.className = `status${type ? ` ${type}` : ''}`;
}

function showIdle(message) {
  output.textContent = message;
  output.className = 'output idle';
  swapButton.disabled = true;
}

function applyResult(result) {
  const { output: text, status: message, format } =
    typeof result === 'string' ? { output: result } : result;
  output.textContent = text;
  output.className = `output${format === 'qr' ? ' qr' : ''}`;
  swapButton.disabled = format === 'qr' || !text;
  setStatus(message || 'Done.', 'success');
}

function applyError(error, inputWasEmpty) {
  if (inputWasEmpty) {
    // An empty pane isn't a mistake — show the tool's own hint as guidance.
    showIdle(error.message);
    setStatus('Waiting for input.');
    return;
  }
  output.textContent = error.message;
  output.className = 'output error';
  swapButton.disabled = true;
  setStatus('Check the input.', 'error');
}

async function runActiveTool() {
  const runner = ToolKit.runners[activeToolId];
  if (!runner) return;
  const token = ++runCounter;
  const value = input.value;
  document.body.classList.add('running');
  try {
    const result = await runner(value);
    if (token === runCounter) applyResult(result);
  } catch (error) {
    if (token === runCounter) applyError(error, !value.trim());
  } finally {
    if (token === runCounter) document.body.classList.remove('running');
  }
}

function scheduleLiveRun() {
  if (isManual()) return;
  clearTimeout(liveTimer);
  liveTimer = setTimeout(runActiveTool, LIVE_DELAY_MS);
}

function openTool(id) {
  const tool = tools.find(item => item.id === id);
  if (!tool) return;
  activeToolId = id;
  runCounter++; // discard results from any in-flight run of the previous tool
  clearTimeout(liveTimer);
  storageSet(STORAGE_KEYS.lastTool, JSON.stringify([id]));

  document.getElementById('activeToolName').textContent = tool.name;
  document.getElementById('activeToolDescription').textContent = tool.description;
  document.getElementById('toolCategory').textContent = tool.category;
  favoriteButton.textContent = favorites.has(id) ? '★' : '☆';
  favoriteButton.classList.toggle('pinned', favorites.has(id));
  seam.classList.toggle('manual', isManual(id));

  input.value = ToolKit.examples[id] ?? '';
  input.placeholder = ToolKit.placeholders[id] ?? 'Paste input here';
  document.body.classList.remove('running');

  if (isManual(id)) {
    showIdle('Press run when ready.');
    setStatus('This tool runs on demand.');
  } else {
    setStatus('Runs as you type.');
    runActiveTool();
  }
  renderList();
}

/* ---------- theme ---------- */

function applyTheme(theme) {
  document.body.classList.toggle('light', theme === 'light');
  themeToggle.textContent = theme === 'light' ? '☾' : '☼';
  themeToggle.setAttribute('aria-label', theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
}

function initialTheme() {
  const stored = storageGet(STORAGE_KEYS.theme);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/* ---------- mobile nav ---------- */

function closeNav() {
  document.body.classList.remove('nav-open');
}

document.getElementById('navToggle').addEventListener('click', () => {
  document.body.classList.add('nav-open');
  searchInput.focus();
});
document.getElementById('scrim').addEventListener('click', closeNav);

/* ---------- events ---------- */

searchInput.addEventListener('input', renderList);

document.addEventListener('keydown', event => {
  const inSearch = document.activeElement === searchInput;
  const inInput = document.activeElement === input;

  if (event.key === '/' && !inSearch && !inInput) {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
  if (event.key === 'Escape') {
    if (inSearch && searchInput.value) {
      searchInput.value = '';
      renderList();
    } else {
      closeNav();
    }
  }
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    runActiveTool();
  }
  // Arrow keys walk the tool list.
  const rows = [...toolList.querySelectorAll('.tool-row')];
  const focusIndex = rows.indexOf(document.activeElement);
  if (event.key === 'ArrowDown' && (inSearch || focusIndex > -1)) {
    event.preventDefault();
    (rows[focusIndex + 1] || rows[0])?.focus();
  }
  if (event.key === 'ArrowUp' && focusIndex > -1) {
    event.preventDefault();
    if (focusIndex === 0) searchInput.focus();
    else rows[focusIndex - 1].focus();
  }
});

input.addEventListener('input', scheduleLiveRun);
runButton.addEventListener('click', runActiveTool);

input.addEventListener('paste', (event) => {
  if (activeToolId !== 'qr-generator') return;
  const item = [...(event.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  if (!item) return;
  event.preventDefault();
  const file = item.getAsFile();
  const reader = new FileReader();
  reader.onload = () => {
    input.value = 'decode-image:' + reader.result;
    runActiveTool();
  };
  reader.onerror = () => setStatus('Could not read the pasted image from the clipboard.');
  reader.readAsDataURL(file);
});

document.getElementById('clearTool').addEventListener('click', () => {
  input.value = '';
  runCounter++;
  clearTimeout(liveTimer);
  showIdle(isManual() ? 'Press run when ready.' : 'Paste input on the left — results appear as you type.');
  setStatus('Cleared.');
  input.focus();
});

document.getElementById('loadExample').addEventListener('click', () => {
  input.value = ToolKit.examples[activeToolId] ?? '';
  if (isManual()) setStatus('Example loaded — press run.');
  else runActiveTool();
});

swapButton.addEventListener('click', () => {
  if (swapButton.disabled) return;
  input.value = output.textContent;
  setStatus('Output moved to input.');
  if (!isManual()) runActiveTool();
  else showIdle('Press run when ready.');
});

copyButton.addEventListener('click', async () => {
  const text = output.textContent;
  if (!text || output.classList.contains('idle')) {
    setStatus('Nothing to copy yet.', 'error');
    return;
  }
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch (error) {
    const scratch = document.createElement('textarea');
    scratch.value = text;
    document.body.appendChild(scratch);
    scratch.select();
    copied = document.execCommand('copy');
    scratch.remove();
  }
  setStatus(copied ? 'Copied.' : 'Copy failed — select the output manually.', copied ? 'success' : 'error');
  if (copied) {
    copyButton.textContent = 'Copied';
    setTimeout(() => { copyButton.textContent = 'Copy'; }, 1200);
  }
});

favoriteButton.addEventListener('click', () => {
  if (favorites.has(activeToolId)) favorites.delete(activeToolId);
  else favorites.add(activeToolId);
  storageSet(STORAGE_KEYS.favorites, JSON.stringify([...favorites]));
  favoriteButton.textContent = favorites.has(activeToolId) ? '★' : '☆';
  favoriteButton.classList.toggle('pinned', favorites.has(activeToolId));
  renderList();
});

themeToggle.addEventListener('click', () => {
  const next = document.body.classList.contains('light') ? 'dark' : 'light';
  storageSet(STORAGE_KEYS.theme, next);
  applyTheme(next);
});

/* ---------- init ---------- */

applyTheme(initialTheme());
renderList();
openTool(activeToolId);
