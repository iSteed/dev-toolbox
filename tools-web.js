/*
 * Tool pack: web formats, colors, config, and a few networking helpers.
 * Registers into the ToolKit created by tools.js (load after it).
 */
(function (global) {
  'use strict';

  const ToolKit = typeof module !== 'undefined' && module.exports
    ? require('./tools.js')
    : global.ToolKit;
  const { requireInput, alignTable, truncate, relativeTime, parseCSV, detectDelimiter } = ToolKit.helpers;

  // ================================================================ helpers

  function decodeBase64Url(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return decodeURIComponent(atob(padded).split('').map(c => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
  }

  // ================================================================ JSON family

  function stableStringify(value, sortKeys) {
    return JSON.stringify(value, sortKeys ? (function () {
      return (key, val) => {
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          return Object.keys(val).sort().reduce((acc, k) => { acc[k] = val[k]; return acc; }, {});
        }
        return val;
      };
    })() : undefined, 2);
  }

  function deepMerge(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) return b.slice();
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const out = { ...a };
      for (const key of Object.keys(b)) out[key] = key in a ? deepMerge(a[key], b[key]) : b[key];
      return out;
    }
    return b;
  }

  function flattenForCsv(objects) {
    const keys = [];
    for (const obj of objects) {
      for (const key of Object.keys(obj)) if (!keys.includes(key)) keys.push(key);
    }
    return keys;
  }

  function csvEscape(field) {
    const s = field === null || field === undefined ? '' : String(field);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function inferType(value) {
    if (value === null) return { type: 'null' };
    if (Array.isArray(value)) {
      const items = value.map(inferType);
      const first = items[0] ? JSON.stringify(items[0]) : null;
      const uniform = items.length > 0 && items.every(t => JSON.stringify(t) === first);
      return { type: 'array', items: uniform ? items[0] : {} };
    }
    if (typeof value === 'object') {
      const properties = {};
      for (const [k, v] of Object.entries(value)) properties[k] = inferType(v);
      return { type: 'object', properties, required: Object.keys(value) };
    }
    if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
    if (typeof value === 'boolean') return { type: 'boolean' };
    return { type: 'string' };
  }

  // JSONPath: supports $ . .. name [n] [*] and wildcards.
  function jsonPath(root, expr) {
    const tokens = [];
    // Order matters: recursive-descent-with-name before bare "..", dotted name, etc.
    const re = /\.\.([A-Za-z_$][\w$]*)|\.\.|\.([A-Za-z_$][\w$]*)|\[(\d+)\]|\['([^']*)'\]|\["([^"]*)"\]|\[\*\]|\*|\$/g;
    let m;
    let consumed = 0;
    while ((m = re.exec(expr))) {
      if (m.index !== consumed) break; // a gap means an unparseable character
      consumed = re.lastIndex;
      if (m[0] === '$') continue;
      if (m[1] !== undefined) { tokens.push({ recurse: true }, { key: m[1] }); }
      else if (m[0] === '..') tokens.push({ recurse: true });
      else if (m[0] === '[*]' || m[0] === '*') tokens.push({ wildcard: true });
      else if (m[2] !== undefined) tokens.push({ key: m[2] });
      else if (m[3] !== undefined) tokens.push({ index: Number(m[3]) });
      else tokens.push({ key: m[4] ?? m[5] });
    }
    if (consumed !== expr.length) throw new Error(`Could not parse the path near "${expr.slice(consumed)}".`);

    let current = [root];
    for (const token of tokens) {
      const next = [];
      for (const node of current) {
        if (token.recurse) {
          const stack = [node];
          while (stack.length) {
            const item = stack.pop();
            next.push(item);
            if (item && typeof item === 'object') for (const v of Object.values(item)) stack.push(v);
          }
        } else if (token.wildcard) {
          if (Array.isArray(node)) next.push(...node);
          else if (node && typeof node === 'object') next.push(...Object.values(node));
        } else if (token.key !== undefined) {
          if (node && typeof node === 'object' && token.key in node) next.push(node[token.key]);
        } else if (token.index !== undefined) {
          if (Array.isArray(node) && token.index < node.length) next.push(node[token.index]);
        }
      }
      current = next;
    }
    return current;
  }

  // ================================================================ XML

  function formatXml(xml) {
    const PADDING = '  ';
    let formatted = '';
    let indent = 0;
    const normalized = xml.replace(/>\s*</g, '><').trim();
    const tokens = normalized.match(/<[^>]+>|[^<]+/g) || [];
    for (const token of tokens) {
      if (/^<\//.test(token)) {
        indent = Math.max(0, indent - 1);
        formatted += PADDING.repeat(indent) + token + '\n';
      } else if (/^<[?!]/.test(token) || /\/>$/.test(token)) {
        formatted += PADDING.repeat(indent) + token + '\n';
      } else if (/^</.test(token)) {
        const tagName = token.match(/^<([\w:.-]+)/);
        formatted += PADDING.repeat(indent) + token + '\n';
        // Only indent if it isn't immediately closed on the same conceptual line.
        if (tagName) indent++;
      } else {
        const text = token.trim();
        if (text) {
          // Attach short text to the line above rather than a new line.
          formatted = formatted.replace(/\n$/, '') + text + '\n';
        }
      }
    }
    return formatted.trim();
  }

  function xmlToJson(xml) {
    let pos = 0;
    const src = xml.trim();

    function skipMisc() {
      for (;;) {
        const before = pos;
        while (pos < src.length && /\s/.test(src[pos])) pos++;
        if (src.startsWith('<?', pos)) pos = src.indexOf('?>', pos) + 2;
        else if (src.startsWith('<!--', pos)) pos = src.indexOf('-->', pos) + 3;
        else if (src.startsWith('<!', pos)) pos = src.indexOf('>', pos) + 1;
        if (pos === before) break;
      }
    }

    function parseElement() {
      if (src[pos] !== '<') throw new Error('Expected an element start.');
      pos++;
      const nameMatch = src.slice(pos).match(/^[\w:.-]+/);
      if (!nameMatch) throw new Error('Malformed tag name at position ' + pos + '.');
      const name = nameMatch[0];
      pos += name.length;
      const node = {};
      // attributes
      for (;;) {
        while (pos < src.length && /\s/.test(src[pos])) pos++;
        if (src[pos] === '/' || src[pos] === '>') break;
        const attr = src.slice(pos).match(/^([\w:.-]+)\s*=\s*("[^"]*"|'[^']*')/);
        if (!attr) throw new Error(`Malformed attribute in <${name}>.`);
        node['@' + attr[1]] = attr[2].slice(1, -1);
        pos += attr[0].length;
      }
      if (src[pos] === '/') { pos += 2; return { name, value: emptyValue(node) }; }
      pos++; // '>'
      let text = '';
      const children = {};
      let childCount = 0;
      for (;;) {
        if (src.startsWith('</', pos)) {
          pos += 2;
          const close = src.slice(pos).match(/^[\w:.-]+/)[0];
          pos += close.length;
          while (src[pos] !== '>') pos++;
          pos++;
          break;
        }
        if (src.startsWith('<!--', pos)) { pos = src.indexOf('-->', pos) + 3; continue; }
        if (src.startsWith('<![CDATA[', pos)) {
          const end = src.indexOf(']]>', pos);
          text += src.slice(pos + 9, end);
          pos = end + 3;
          continue;
        }
        if (src[pos] === '<') {
          const child = parseElement();
          childCount++;
          if (child.name in children) {
            if (!Array.isArray(children[child.name])) children[child.name] = [children[child.name]];
            children[child.name].push(child.value);
          } else {
            children[child.name] = child.value;
          }
        } else {
          const nextTag = src.indexOf('<', pos);
          text += decodeEntities(src.slice(pos, nextTag === -1 ? src.length : nextTag));
          pos = nextTag === -1 ? src.length : nextTag;
        }
      }
      const attrs = Object.keys(node);
      if (childCount === 0 && attrs.length === 0) return { name, value: text.trim() || '' };
      Object.assign(node, children);
      const trimmed = text.trim();
      if (trimmed) node['#text'] = trimmed;
      return { name, value: node };
    }

    function emptyValue(node) {
      return Object.keys(node).length ? node : '';
    }
    function decodeEntities(s) {
      return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&');
    }

    skipMisc();
    const root = parseElement();
    skipMisc();
    if (pos < src.length) throw new Error('Unexpected content after the root element.');
    return { [root.name]: root.value };
  }

  // ================================================================ HTML formatter

  const HTML_VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const HTML_INLINE = new Set(['a', 'b', 'i', 'em', 'strong', 'span', 'code', 'small', 'sub', 'sup', 'abbr', 'label', 'u', 's', 'mark', 'kbd', 'q', 'cite', 'time', 'var']);

  function formatHtml(html) {
    const tokens = html.replace(/>\s+</g, '><').trim().match(/<[^>]+>|[^<]+/g) || [];
    const out = [];
    let indent = 0;
    const pad = () => '  '.repeat(Math.max(0, indent));
    for (const raw of tokens) {
      const token = raw.trim();
      if (!token) continue;
      if (/^<!--/.test(token) || /^<!/.test(token)) {
        out.push(pad() + token);
      } else if (/^<\//.test(token)) {
        const name = token.slice(2, -1).toLowerCase();
        if (HTML_INLINE.has(name)) { out[out.length - 1] = (out[out.length - 1] || '') + token; continue; }
        indent--;
        out.push(pad() + token);
      } else if (/^</.test(token)) {
        const name = (token.match(/^<([\w-]+)/) || [])[1]?.toLowerCase() || '';
        const selfClose = /\/>$/.test(token) || HTML_VOID.has(name);
        if (HTML_INLINE.has(name)) { out.push(pad() + token); continue; }
        out.push(pad() + token);
        if (!selfClose) indent++;
      } else {
        out.push(pad() + token);
      }
    }
    return out.join('\n');
  }

  // ================================================================ SQL formatter

  const SQL_NEWLINE_BEFORE = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'GROUP BY', 'ORDER BY', 'HAVING',
    'LIMIT', 'OFFSET', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'JOIN',
    'ON', 'UNION ALL', 'UNION', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'RETURNING'];
  const SQL_KEYWORDS = new Set(['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'NULL', 'AS', 'ON', 'IN', 'IS',
    'LIKE', 'BETWEEN', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'JOIN', 'INNER', 'LEFT',
    'RIGHT', 'FULL', 'CROSS', 'OUTER', 'UNION', 'ALL', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
    'DELETE', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
    'ASC', 'DESC', 'RETURNING', 'WITH', 'EXISTS', 'INT', 'TRUE', 'FALSE']);

  const SQL_FUNCTIONS = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'ROUND', 'ABS',
    'UPPER', 'LOWER', 'LENGTH', 'SUBSTRING', 'CONCAT', 'CAST', 'NULLIF', 'GREATEST', 'LEAST', 'NOW']);

  function formatSql(sql) {
    // Tokenize, keeping strings/comments intact.
    const tokens = sql.match(/'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\/|[(),;]|[\w.]+|\S/g) || [];
    let result = '';
    let i = 0;
    let prevUp = '';
    const upperTokens = tokens.map(t => t.toUpperCase());
    while (i < tokens.length) {
      let matched = null;
      for (const phrase of SQL_NEWLINE_BEFORE) {
        const parts = phrase.split(' ');
        if (parts.every((p, k) => upperTokens[i + k] === p)) { matched = { phrase, len: parts.length }; break; }
      }
      if (matched) {
        result += (result ? '\n' : '') + matched.phrase;
        prevUp = matched.phrase.split(' ').pop();
        i += matched.len;
        continue;
      }
      const tok = tokens[i];
      const up = upperTokens[i];
      if (tok === ',') result += ',';
      else if (tok === '(') result += SQL_FUNCTIONS.has(prevUp) ? '(' : ' (';
      else if (tok === ')') result += ')';
      else if (tok === ';') result += ';\n';
      else if (SQL_KEYWORDS.has(up)) result += (/[\n(]$/.test(result) || !result ? '' : ' ') + up;
      else result += (/[\n(]$/.test(result) || !result ? '' : ' ') + tok;
      prevUp = up;
      i++;
    }
    return result.split('\n').map(l => l.replace(/\s+,/g, ',').replace(/\(\s+/g, '(').trimEnd()).join('\n').trim();
  }

  // ================================================================ colors

  function parseColor(text) {
    const s = text.trim().toLowerCase();
    let m;
    if ((m = s.match(/^#?([0-9a-f]{3})$/))) {
      return [0, 1, 2].map(i => parseInt(m[1][i] + m[1][i], 16)).concat(1);
    }
    if ((m = s.match(/^#?([0-9a-f]{6})$/))) {
      return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
    }
    if ((m = s.match(/^#?([0-9a-f]{8})$/))) {
      return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)).concat(parseInt(m[1].slice(6, 8), 16) / 255);
    }
    if ((m = s.match(/^rgba?\(([^)]+)\)$/))) {
      const parts = m[1].split(/[,\s/]+/).filter(Boolean);
      const rgb = parts.slice(0, 3).map(p => p.endsWith('%') ? Math.round(parseFloat(p) * 2.55) : parseInt(p, 10));
      const a = parts[3] !== undefined ? (parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) : 1;
      if (rgb.some(v => !Number.isFinite(v) || v < 0 || v > 255)) throw new Error('RGB channels must be 0–255.');
      return [...rgb, a];
    }
    if ((m = s.match(/^hsla?\(([^)]+)\)$/))) {
      const parts = m[1].split(/[,\s/]+/).filter(Boolean);
      const h = parseFloat(parts[0]);
      const sat = parseFloat(parts[1]) / 100;
      const l = parseFloat(parts[2]) / 100;
      const a = parts[3] !== undefined ? (parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) : 1;
      return [...hslToRgb(h, sat, l), a];
    }
    throw new Error(`Could not read "${text.trim()}" — try #3af, #33aaff, rgb(51,170,255), or hsl(...).`);
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = t => {
      t = (t + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)].map(v => Math.round(v * 255));
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
  }

  function relativeLuminance([r, g, b]) {
    const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  // ================================================================ networking helpers

  const PORTS = {
    20: 'FTP data', 21: 'FTP control', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS',
    67: 'DHCP server', 68: 'DHCP client', 69: 'TFTP', 80: 'HTTP', 110: 'POP3', 119: 'NNTP',
    123: 'NTP', 143: 'IMAP', 161: 'SNMP', 194: 'IRC', 389: 'LDAP', 443: 'HTTPS', 465: 'SMTPS',
    514: 'Syslog', 587: 'SMTP submission', 636: 'LDAPS', 993: 'IMAPS', 995: 'POP3S',
    1080: 'SOCKS proxy', 1433: 'MS SQL Server', 1521: 'Oracle DB', 1723: 'PPTP', 2049: 'NFS',
    2181: 'ZooKeeper', 3000: 'Node/Rails dev', 3306: 'MySQL/MariaDB', 3389: 'RDP', 4200: 'Angular dev',
    5000: 'Flask/dev', 5173: 'Vite dev', 5432: 'PostgreSQL', 5601: 'Kibana', 5672: 'AMQP/RabbitMQ',
    6379: 'Redis', 8000: 'HTTP alt/dev', 8080: 'HTTP proxy/alt', 8443: 'HTTPS alt', 8888: 'Jupyter/alt',
    9000: 'SonarQube/PHP-FPM', 9092: 'Kafka', 9200: 'Elasticsearch', 11211: 'Memcached',
    15672: 'RabbitMQ mgmt', 27017: 'MongoDB', 5900: 'VNC'
  };

  const MIME_TYPES = {
    html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
    json: 'application/json', xml: 'application/xml', csv: 'text/csv', txt: 'text/plain', md: 'text/markdown',
    pdf: 'application/pdf', zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif', bmp: 'image/bmp',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', avi: 'video/x-msvideo',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
    wasm: 'application/wasm', yaml: 'application/yaml', yml: 'application/yaml', toml: 'application/toml',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
  const MIME_TO_EXT = {};
  for (const [ext, mime] of Object.entries(MIME_TYPES)) if (!MIME_TO_EXT[mime]) MIME_TO_EXT[mime] = ext;

  const FILE_SIGNATURES = [
    ['89 50 4E 47', 'PNG image'], ['FF D8 FF', 'JPEG image'], ['47 49 46 38', 'GIF image'],
    ['52 49 46 46', 'RIFF container (WAV/AVI/WebP)'], ['25 50 44 46', 'PDF document'],
    ['50 4B 03 04', 'ZIP archive (also DOCX/XLSX/JAR/APK)'], ['50 4B 05 06', 'Empty ZIP archive'],
    ['1F 8B', 'GZIP archive'], ['42 5A 68', 'BZIP2 archive'], ['FD 37 7A 58 5A', 'XZ archive'],
    ['37 7A BC AF 27 1C', '7-Zip archive'], ['75 73 74 61 72', 'TAR archive'],
    ['7F 45 4C 46', 'ELF executable'], ['4D 5A', 'Windows PE executable (EXE/DLL)'],
    ['CA FE BA BE', 'Java class file'], ['00 00 01 00', 'ICO icon'],
    ['3C 3F 78 6D 6C', 'XML document'], ['3C 73 76 67', 'SVG image'],
    ['49 44 33', 'MP3 audio (ID3)'], ['66 4C 61 43', 'FLAC audio'], ['4F 67 67 53', 'OGG media'],
    ['00 00 00 18 66 74 79 70', 'MP4 video'], ['1A 45 DF A3', 'Matroska/WebM video'],
    ['D0 CF 11 E0', 'MS Office (legacy OLE2)'], ['77 4F 46 46', 'WOFF font'], ['77 4F 46 32', 'WOFF2 font']
  ];

  const STATUS_CODES = {
    100: 'Continue', 101: 'Switching Protocols', 103: 'Early Hints',
    200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 206: 'Partial Content',
    301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 304: 'Not Modified',
    307: 'Temporary Redirect', 308: 'Permanent Redirect',
    400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden',
    404: 'Not Found', 405: 'Method Not Allowed', 406: 'Not Acceptable', 408: 'Request Timeout',
    409: 'Conflict', 410: 'Gone', 411: 'Length Required', 413: 'Payload Too Large',
    414: 'URI Too Long', 415: 'Unsupported Media Type', 418: "I'm a teapot", 422: 'Unprocessable Content',
    425: 'Too Early', 429: 'Too Many Requests', 431: 'Request Header Fields Too Large',
    500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway',
    503: 'Service Unavailable', 504: 'Gateway Timeout', 505: 'HTTP Version Not Supported', 511: 'Network Authentication Required'
  };
  const STATUS_MEANING = {
    1: 'Informational — request received, continuing.',
    2: 'Success — the request succeeded.',
    3: 'Redirection — further action is needed to complete the request.',
    4: 'Client error — the request has a problem.',
    5: 'Server error — the server failed to fulfill a valid request.'
  };

  // ================================================================ runners

  const runners = {

    'json-transform'(value) {
      const lines = value.split('\n');
      const first = (lines[0] || '').trim().toLowerCase();
      const OPS = { minify: 1, pretty: 1, sort: 1, 'sort-keys': 1 };
      let op = 'pretty';
      let body = value;
      if (first in OPS) { op = first === 'sort-keys' ? 'sort' : first; body = lines.slice(1).join('\n'); }
      const parsed = JSON.parse(requireInput(body, 'Paste JSON. Optional first line: minify, pretty, or sort.'));
      if (op === 'minify') {
        const min = JSON.stringify(parsed);
        return { output: min, status: `Minified to ${min.length.toLocaleString()} characters.` };
      }
      const out = stableStringify(parsed, op === 'sort');
      return { output: out, status: op === 'sort' ? 'Pretty-printed with keys sorted A–Z.' : `Pretty-printed ${out.length.toLocaleString()} characters.` };
    },

    'json-merge'(value) {
      const parts = value.split(/\r?\n[ \t]*---[ \t]*\r?\n/);
      if (parts.length < 2) throw new Error('Provide two or more JSON documents separated by lines containing only ---.');
      let merged;
      parts.forEach((part, i) => {
        let doc;
        try { doc = JSON.parse(part); } catch (e) { throw new Error(`Document ${i + 1} is not valid JSON: ${e.message}`); }
        merged = i === 0 ? doc : deepMerge(merged, doc);
      });
      return { output: stableStringify(merged, false), status: `Deep-merged ${parts.length} documents (later wins; arrays replaced).` };
    },

    'json-to-csv'(value) {
      const parsed = JSON.parse(requireInput(value, 'Paste a JSON array of objects to convert to CSV.'));
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      if (!rows.every(r => r && typeof r === 'object' && !Array.isArray(r))) {
        throw new Error('CSV conversion needs an array of flat objects (one row each).');
      }
      const keys = flattenForCsv(rows);
      const lines = [keys.map(csvEscape).join(',')];
      for (const row of rows) {
        lines.push(keys.map(k => {
          const v = row[k];
          return csvEscape(v && typeof v === 'object' ? JSON.stringify(v) : v);
        }).join(','));
      }
      return { output: lines.join('\n'), status: `${rows.length} row(s) × ${keys.length} column(s).` };
    },

    'csv-to-json'(value) {
      const input = requireInput(value, 'Paste CSV to convert to a JSON array of objects.');
      const delim = detectDelimiter(input);
      const rows = parseCSV(input, delim).filter(r => !(r.length === 1 && r[0] === ''));
      if (rows.length < 2) throw new Error('Need a header row plus at least one data row.');
      const header = rows[0];
      const coerce = v => {
        if (v === '') return null;
        if (/^-?\d+$/.test(v)) return parseInt(v, 10);
        if (/^-?\d*\.\d+$/.test(v)) return parseFloat(v);
        if (v === 'true') return true;
        if (v === 'false') return false;
        return v;
      };
      const objects = rows.slice(1).map(row => {
        const obj = {};
        header.forEach((key, i) => { obj[key] = coerce(row[i] ?? ''); });
        return obj;
      });
      return { output: JSON.stringify(objects, null, 2), status: `${objects.length} object(s) from ${header.length} column(s).` };
    },

    'json-schema'(value) {
      const parsed = JSON.parse(requireInput(value, 'Paste a JSON sample to infer a schema from.'));
      const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...inferType(parsed) };
      return { output: JSON.stringify(schema, null, 2), status: 'Draft 2020-12 schema inferred from the sample.' };
    },

    'jsonpath'(value) {
      const lines = value.split('\n');
      const expr = (lines[0] || '').trim();
      if (!expr.startsWith('$')) throw new Error('Put a JSONPath expression on the first line (e.g. $.items[*].name), JSON below.');
      const parsed = JSON.parse(requireInput(lines.slice(1).join('\n'), 'Add the JSON document below the path.'));
      const results = jsonPath(parsed, expr);
      if (!results.length) return { output: '(no matches)', status: 'Path matched nothing.' };
      return {
        output: JSON.stringify(results.length === 1 ? results[0] : results, null, 2),
        status: `${results.length} match(es).`
      };
    },

    'xml-formatter'(value) {
      const input = requireInput(value, 'Paste XML to format, or convert to JSON.');
      if (/^\s*[{[]/.test(input)) {
        throw new Error('This tool formats XML. To go JSON → XML is not supported; use xml → json here.');
      }
      const json = xmlToJson(input);
      return {
        output: formatXml(input) + '\n\n--- as JSON ---\n' + JSON.stringify(json, null, 2),
        status: 'Formatted, and converted to JSON.'
      };
    },

    'html-formatter'(value) {
      const input = requireInput(value, 'Paste HTML to format and tidy.');
      const formatted = formatHtml(input);
      return { output: formatted, status: `Formatted ${formatted.split('\n').length} line(s).` };
    },

    'html-to-markdown'(value) {
      let html = requireInput(value, 'Paste HTML to convert to Markdown.');
      html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
      const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
      let md = html
        .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => '\n' + '#'.repeat(+n) + ' ' + t.trim() + '\n')
        .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
        .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
        .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
        .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, t) => '\n```\n' + t.replace(/<[^>]+>/g, '').trim() + '\n```\n')
        .replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
        .replace(/<img[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']*)["'][^>]*>/gi, '![$1]($2)')
        .replace(/<img[^>]*src=["']([^"']*)["'][^>]*>/gi, '![]($1)')
        .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
        .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t) => '> ' + t.replace(/<[^>]+>/g, '').trim() + '\n')
        .replace(/<br\s*\/?>/gi, '  \n')
        .replace(/<\/(p|div|ul|ol|section|article|header|footer)>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n');
      return { output: decode(md).trim(), status: 'Converted to Markdown (common tags).' };
    },

    'markdown-to-html'(value) {
      const input = requireInput(value, 'Paste Markdown to render as HTML.');
      const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const inline = s => esc(s)
        .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
      const lines = input.split('\n');
      const out = [];
      let inList = false, inCode = false, para = [];
      const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
      const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
      for (const line of lines) {
        if (/^```/.test(line)) {
          flushPara(); closeList();
          if (inCode) { out.push('</code></pre>'); inCode = false; }
          else { out.push('<pre><code>'); inCode = true; }
          continue;
        }
        if (inCode) { out.push(esc(line)); continue; }
        const h = line.match(/^(#{1,6})\s+(.*)$/);
        if (h) { flushPara(); closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
        if (/^\s*[-*+]\s+/.test(line)) {
          flushPara();
          if (!inList) { out.push('<ul>'); inList = true; }
          out.push('<li>' + inline(line.replace(/^\s*[-*+]\s+/, '')) + '</li>');
          continue;
        }
        if (/^\s*>\s?/.test(line)) { flushPara(); closeList(); out.push('<blockquote>' + inline(line.replace(/^\s*>\s?/, '')) + '</blockquote>'); continue; }
        if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { flushPara(); closeList(); out.push('<hr>'); continue; }
        if (line.trim() === '') { flushPara(); closeList(); continue; }
        para.push(line.trim());
      }
      flushPara(); closeList();
      if (inCode) out.push('</code></pre>');
      return { output: out.join('\n'), status: 'Rendered to HTML.' };
    },

    'markdown-toc'(value) {
      const input = requireInput(value, 'Paste Markdown — a table of contents is built from its headings.');
      const seen = {};
      const entries = [];
      let inCode = false;
      for (const line of input.split('\n')) {
        if (/^```/.test(line)) { inCode = !inCode; continue; }
        if (inCode) continue;
        const h = line.match(/^(#{1,6})\s+(.*?)\s*#*$/);
        if (!h || h[1].length === 1) continue; // skip the H1 title
        const text = h[2].replace(/[*`_]/g, '').trim();
        let slug = text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
        if (seen[slug] !== undefined) { seen[slug]++; slug += '-' + seen[slug]; } else seen[slug] = 0;
        entries.push('  '.repeat(h[1].length - 2) + `- [${text}](#${slug})`);
      }
      if (!entries.length) throw new Error('No headings (##–######) found to build a table of contents.');
      return { output: entries.join('\n'), status: `${entries.length} heading(s).` };
    },

    'sql-formatter'(value) {
      const input = requireInput(value, 'Paste a SQL query to format.');
      const formatted = formatSql(input);
      return { output: formatted, status: `Formatted ${input.split(';').filter(s => s.trim()).length || 1} statement(s).` };
    },

    'csv-to-insert'(value) {
      const lines = value.split('\n');
      let table = 'my_table';
      let body = value;
      const tableLine = lines[0].match(/^\s*table\s*[:=]\s*(\w+)\s*$/i);
      if (tableLine) { table = tableLine[1]; body = lines.slice(1).join('\n'); }
      const delim = detectDelimiter(body);
      const rows = parseCSV(body, delim).filter(r => !(r.length === 1 && r[0] === ''));
      if (rows.length < 2) throw new Error('Need a header row and at least one data row. Optional first line: "table: users".');
      const cols = rows[0];
      const lit = v => {
        if (v === '') return 'NULL';
        if (/^-?\d+(\.\d+)?$/.test(v)) return v;
        if (/^(true|false)$/i.test(v)) return v.toUpperCase();
        return "'" + v.replace(/'/g, "''") + "'";
      };
      const statements = rows.slice(1).map(row =>
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => lit(row[i] ?? '')).join(', ')});`
      );
      return { output: statements.join('\n'), status: `${statements.length} INSERT statement(s) for "${table}".` };
    },

    'color-converter'(value) {
      const input = requireInput(value, 'Enter a color: #33aaff, rgb(51,170,255), hsl(207,100%,60%)…').split('\n')[0];
      const [r, g, b, a] = parseColor(input);
      const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
      const [h, s, l] = rgbToHsl(r, g, b);
      const lum = relativeLuminance([r, g, b]);
      const onWhite = (1.05) / (lum + 0.05);
      const onBlack = (lum + 0.05) / 0.05;
      const rows = [
        ['HEX', hex + (a < 1 ? Math.round(a * 255).toString(16).padStart(2, '0') : '')],
        ['RGB', `rgb(${r}, ${g}, ${b})`],
        ['RGBA', `rgba(${r}, ${g}, ${b}, ${+a.toFixed(3)})`],
        ['HSL', `hsl(${h}, ${s}%, ${l}%)`],
        ['Luminance', lum.toFixed(4)],
        ['Contrast vs white', onWhite.toFixed(2) + ':1'],
        ['Contrast vs black', onBlack.toFixed(2) + ':1'],
        ['Readable text on it', onWhite >= onBlack ? 'white' : 'black']
      ];
      return { output: alignTable(rows), status: `${hex} · hsl(${h}, ${s}%, ${l}%)` };
    },

    'contrast-checker'(value) {
      const input = requireInput(value, 'Enter two colors (foreground then background), one per line or space-separated.');
      const parts = input.split(/[\n,]|\s{2,}| (?=#|rgb|hsl)/i).map(s => s.trim()).filter(Boolean);
      if (parts.length < 2) throw new Error('Give two colors — foreground and background.');
      const l1 = relativeLuminance(parseColor(parts[0]));
      const l2 = relativeLuminance(parseColor(parts[1]));
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const grade = (threshold) => ratio >= threshold ? '✓ pass' : '✗ fail';
      const rows = [
        ['Foreground', parts[0]],
        ['Background', parts[1]],
        ['Contrast ratio', ratio.toFixed(2) + ':1'],
        ['AA  normal text (4.5:1)', grade(4.5)],
        ['AA  large text (3:1)', grade(3)],
        ['AAA normal text (7:1)', grade(7)],
        ['AAA large text (4.5:1)', grade(4.5)],
        ['UI components (3:1)', grade(3)]
      ];
      return { output: alignTable(rows), status: `${ratio.toFixed(2)}:1 — ${ratio >= 4.5 ? 'passes AA for body text' : ratio >= 3 ? 'passes AA for large text only' : 'fails WCAG AA'}.` };
    },

    'ip-calculator'(value) {
      const input = requireInput(value, 'Enter an IPv4 address to inspect and convert.').split('\n')[0].trim();
      const m = input.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      if (!m) throw new Error('Enter a dotted IPv4 address like 192.168.1.10.');
      const octets = m.slice(1).map(Number);
      if (octets.some(o => o > 255)) throw new Error('Each octet must be 0–255.');
      const int = ((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
      const hex = octets.map(o => o.toString(16).padStart(2, '0')).join('');
      const cls = octets[0] < 128 ? 'A' : octets[0] < 192 ? 'B' : octets[0] < 224 ? 'C' : octets[0] < 240 ? 'D (multicast)' : 'E (reserved)';
      const ipv6 = `::ffff:${octets[0].toString(16).padStart(2, '0')}${octets[1].toString(16).padStart(2, '0')}:${octets[2].toString(16).padStart(2, '0')}${octets[3].toString(16).padStart(2, '0')}`;
      const rows = [
        ['Dotted', octets.join('.')],
        ['Integer', int.toString()],
        ['Hex', '0x' + hex],
        ['Binary', octets.map(o => o.toString(2).padStart(8, '0')).join('.')],
        ['Class', cls],
        ['IPv4-mapped IPv6', ipv6],
        ['6to4 prefix', `2002:${hex.slice(0, 4)}:${hex.slice(4)}::/48`]
      ];
      return { output: alignTable(rows), status: `Class ${cls[0]} · integer ${int}.` };
    },

    'port-lookup'(value) {
      const query = requireInput(value, 'Enter a port number, or a keyword like "sql" or "mail".').trim().toLowerCase();
      if (/^\d+$/.test(query)) {
        const port = Number(query);
        if (port < 0 || port > 65535) throw new Error('Ports range from 0 to 65535.');
        const name = PORTS[port];
        const range = port < 1024 ? 'well-known (0–1023)' : port < 49152 ? 'registered (1024–49151)' : 'dynamic/ephemeral (49152–65535)';
        return {
          output: alignTable([
            ['Port', String(port)],
            ['Service', name || '(no well-known assignment)'],
            ['Range', range]
          ]),
          status: name ? `${port} → ${name}` : `${port} has no common assignment.`
        };
      }
      const hits = Object.entries(PORTS).filter(([p, name]) => name.toLowerCase().includes(query));
      if (!hits.length) throw new Error(`No well-known service matches "${query}".`);
      return {
        output: alignTable([['PORT', 'SERVICE'], ...hits.map(([p, name]) => [p, name])]),
        status: `${hits.length} match(es) for "${query}".`
      };
    },

    'mime-lookup'(value) {
      const query = requireInput(value, 'Enter a file extension (png), filename (logo.svg), or MIME type (text/css).').trim().toLowerCase();
      if (query.includes('/')) {
        const ext = MIME_TO_EXT[query];
        const all = Object.entries(MIME_TYPES).filter(([, mime]) => mime === query).map(([e]) => e);
        if (!all.length) throw new Error(`"${query}" is not in the common MIME table.`);
        return { output: alignTable([['MIME type', query], ['Extensions', all.map(e => '.' + e).join(', ')]]), status: `${query} → .${ext}` };
      }
      const ext = query.includes('.') ? query.split('.').pop() : query;
      const mime = MIME_TYPES[ext];
      if (!mime) throw new Error(`No common MIME type for ".${ext}".`);
      return {
        output: alignTable([['Extension', '.' + ext], ['MIME type', mime], ['Content-Type header', `Content-Type: ${mime}${mime.startsWith('text/') || mime.endsWith('json') || mime.endsWith('xml') ? '; charset=utf-8' : ''}`]]),
        status: `.${ext} → ${mime}`
      };
    },

    'file-signature'(value) {
      const input = requireInput(value, 'Paste the first bytes of a file as hex (e.g. 89 50 4E 47).').trim();
      const compact = input.replace(/(0x|[\s,:])/gi, '').toLowerCase();
      if (!/^[0-9a-f]+$/.test(compact) || compact.length < 2) throw new Error('Enter file bytes as hex, like "89 50 4E 47" or "ffd8ff".');
      const bytes = [];
      for (let i = 0; i + 1 < compact.length; i += 2) bytes.push(parseInt(compact.slice(i, i + 2), 16));
      const asHex = bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
      const matches = FILE_SIGNATURES.filter(([sig]) => asHex.startsWith(sig)).sort((a, b) => b[0].length - a[0].length);
      if (!matches.length) {
        return { output: `Leading bytes: ${asHex}\n\nNo known magic-number match. It may be plain text or an uncommon format.`, status: 'No signature matched.' };
      }
      return {
        output: [`Leading bytes: ${asHex}`, '', 'Matches:', ...matches.map(([sig, name]) => `  ${sig.padEnd(24)} ${name}`)].join('\n'),
        status: `Likely: ${matches[0][1]}.`
      };
    },

    'status-code'(value) {
      const query = requireInput(value, 'Enter an HTTP status code (404) or a keyword (redirect).').trim().toLowerCase();
      if (/^\d{3}$/.test(query)) {
        const code = Number(query);
        const text = STATUS_CODES[code];
        return {
          output: alignTable([
            ['Status', `${code} ${text || '(unassigned)'}`],
            ['Class', STATUS_MEANING[Math.floor(code / 100)] || 'Unknown class.'],
            ['Retryable?', [408, 425, 429, 500, 502, 503, 504].includes(code) ? 'Often yes (with backoff).' : 'Not by default.']
          ]),
          status: text ? `${code} → ${text}` : `${code} is not a standard code.`
        };
      }
      const hits = Object.entries(STATUS_CODES).filter(([c, t]) => t.toLowerCase().includes(query) || (STATUS_MEANING[c[0]] || '').toLowerCase().includes(query));
      if (!hits.length) throw new Error(`No status code matches "${query}".`);
      return { output: alignTable([['CODE', 'TEXT'], ...hits.map(([c, t]) => [c, t])]), status: `${hits.length} match(es).` };
    },

    'cookie-parser'(value) {
      const input = requireInput(value, 'Paste a Cookie or Set-Cookie header value.');
      if (/^\s*set-cookie:/i.test(input) || /(;\s*(httponly|secure|samesite|max-age|expires|domain|path)\b)/i.test(input)) {
        const clean = input.replace(/^\s*set-cookie:\s*/i, '');
        const parts = clean.split(';').map(s => s.trim());
        const [name, ...valRest] = parts[0].split('=');
        const rows = [['Name', name], ['Value', truncate(valRest.join('='), 60)]];
        const flags = [];
        const notes = [];
        for (const attr of parts.slice(1)) {
          const [k, v] = attr.split('=');
          const key = k.trim().toLowerCase();
          if (v === undefined) flags.push(k.trim());
          else rows.push([k.trim(), v.trim()]);
          if (key === 'samesite' && v && v.trim().toLowerCase() === 'none') notes.push('SameSite=None requires Secure, or browsers reject it.');
        }
        if (flags.length) rows.push(['Flags', flags.join(', ')]);
        if (!/httponly/i.test(clean)) notes.push('No HttpOnly — this cookie is readable by JavaScript (XSS risk for session tokens).');
        if (!/secure/i.test(clean)) notes.push('No Secure — this cookie can be sent over plain HTTP.');
        if (!/samesite/i.test(clean)) notes.push('No SameSite — browsers default to Lax; set it explicitly.');
        return {
          output: alignTable(rows) + (notes.length ? '\n\nSecurity notes:\n' + notes.map(n => '  ⚠ ' + n).join('\n') : ''),
          status: 'Parsed a Set-Cookie header.'
        };
      }
      const clean = input.replace(/^\s*cookie:\s*/i, '');
      const cookies = clean.split(';').map(s => s.trim()).filter(Boolean).map(pair => {
        const idx = pair.indexOf('=');
        return [idx === -1 ? pair : pair.slice(0, idx), idx === -1 ? '' : pair.slice(idx + 1)];
      });
      if (!cookies.length) throw new Error('No cookies found.');
      return { output: alignTable([['NAME', 'VALUE'], ...cookies.map(([k, v]) => [k, truncate(v, 60)])]), status: `${cookies.length} cookie(s).` };
    },

    'query-string'(value) {
      const input = requireInput(value, 'Paste a URL or query string to break apart, or key=value lines to build one.');
      if (input.includes('?') || (/^[^\n=]+=[^\n]*$/.test(input.split('\n')[0]) && input.includes('&') && !input.includes('\n'))) {
        const qs = input.includes('?') ? input.slice(input.indexOf('?') + 1).split('#')[0] : input;
        const params = new URLSearchParams(qs);
        const rows = [...params.entries()];
        if (!rows.length) throw new Error('No query parameters found.');
        return { output: alignTable([['KEY', 'VALUE'], ...rows.map(([k, v]) => [k, v])]), status: `${rows.length} parameter(s) decoded.` };
      }
      const params = new URLSearchParams();
      for (const line of input.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        const idx = t.indexOf('=');
        if (idx === -1) throw new Error(`Line "${truncate(t, 30)}" is not key=value.`);
        params.append(t.slice(0, idx).trim(), t.slice(idx + 1).trim());
      }
      return { output: '?' + params.toString(), status: 'Built a URL-encoded query string.' };
    },

    'curl-builder'(value) {
      const input = requireInput(value, 'Line 1: METHOD url. Then header lines "Key: Value", and a "body: ..." line — or paste a curl command to parse it.');
      if (/^\s*curl\b/.test(input)) {
        const joined = input.replace(/\\\r?\n/g, ' ');
        const tokens = joined.match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\S+/g) || [];
        const unquote = (t) => {
          if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
            return t.slice(1, -1).replace(/\\(.)/g, '$1');
          }
          return t;
        };
        let method = null, url = null, body = null;
        const headers = [];
        for (let i = 1; i < tokens.length; i++) {
          const t = unquote(tokens[i]);
          if (t === '-X' || t === '--request') { method = unquote(tokens[++i]); continue; }
          if (t === '-H' || t === '--header') { headers.push(unquote(tokens[++i])); continue; }
          if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary') { body = unquote(tokens[++i]); continue; }
          if (t.startsWith('-')) continue;
          if (!url) url = t;
        }
        if (!url) throw new Error('Could not find a URL in that curl command.');
        if (!method) method = body !== null ? 'POST' : 'GET';
        const out = [`${method.toUpperCase()} ${url}`, ...headers];
        if (body !== null) out.push(`body: ${body}`);
        return { output: out.join('\n'), status: `Parsed a ${method.toUpperCase()} curl command — edit and run again to rebuild it.` };
      }
      const lines = input.split('\n').map(l => l.trim()).filter(Boolean);
      const first = lines[0].match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)$/i) || lines[0].match(/^(\S+)$/);
      if (!first) throw new Error('First line should be "METHOD url" or just a url.');
      const method = first[2] ? first[1].toUpperCase() : 'GET';
      const url = first[2] || first[1];
      const parts = [`curl -X ${method} '${url}'`];
      let body = null;
      for (const line of lines.slice(1)) {
        const bodyMatch = line.match(/^body\s*[:=]\s*([\s\S]*)$/i);
        if (bodyMatch) { body = bodyMatch[1]; continue; }
        const h = line.match(/^([\w-]+):\s*(.*)$/);
        if (h) parts.push(`  -H '${h[1]}: ${h[2]}'`);
      }
      if (body !== null) parts.push(`  -d '${body.replace(/'/g, "'\\''")}'`);
      return { output: parts.join(' \\\n'), status: `Built a ${method} curl command.` };
    },

    'jwt-generate'(value) {
      const input = requireInput(value, 'Paste a JSON payload — an unsigned (alg=none) JWT is built from it.');
      let payload;
      try { payload = JSON.parse(input); } catch (e) { throw new Error('Payload must be valid JSON: ' + e.message); }
      const b64url = obj => btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const header = { alg: 'none', typ: 'JWT' };
      const token = `${b64url(header)}.${b64url(payload)}.`;
      const notes = [];
      if (payload.exp) notes.push(`exp: ${new Date(payload.exp * 1000).toISOString()} (${relativeTime(new Date(payload.exp * 1000))})`);
      notes.push('alg=none means UNSIGNED — fine for local testing, never accept these server-side.');
      return {
        output: token + '\n\n' + notes.map(n => '• ' + n).join('\n'),
        status: 'Unsigned test JWT built. Decode it in the JWT Decoder.'
      };
    },

    async 'reverse-dns'(value) {
      const ip = requireInput(value, 'Enter an IPv4 address to reverse-resolve.').split('\n')[0].trim();
      const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      if (!m) throw new Error('Enter a dotted IPv4 address like 8.8.8.8.');
      if (m.slice(1).some(o => Number(o) > 255)) throw new Error('Each octet must be 0–255.');
      const arpa = m.slice(1).reverse().join('.') + '.in-addr.arpa';
      let data;
      try {
        const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${arpa}&type=PTR`, { headers: { accept: 'application/dns-json' } });
        if (!res.ok) throw new Error(`resolver returned HTTP ${res.status}`);
        data = await res.json();
      } catch (e) {
        throw new Error('Reverse lookup failed (' + e.message + '). This tool queries Cloudflare DNS-over-HTTPS and needs network access.');
      }
      const answers = (data.Answer || []).filter(a => a.type === 12);
      if (!answers.length) return { output: `${ip}\n\nNo PTR record (no reverse DNS configured).`, status: 'No PTR record.' };
      return {
        output: `${ip}  →  ${arpa}\n\n` + answers.map(a => '  ' + a.data).join('\n'),
        status: `${answers.length} PTR record(s) via Cloudflare DoH.`
      };
    }
  };

  // ================================================================ examples & placeholders

  Object.assign(ToolKit.examples, {
    'json-transform': 'sort\n{"name":"toolbox","active":true,"count":77,"author":"you"}',
    'json-merge': '{"server":{"port":8080,"tls":false},"tags":["a"]}\n---\n{"server":{"tls":true,"host":"0.0.0.0"},"tags":["b"]}',
    'json-to-csv': '[{"id":1,"name":"Ada","role":"eng"},{"id":2,"name":"Grace","role":"admiral"}]',
    'csv-to-json': 'id,name,active,score\n1,Ada,true,9.5\n2,Grace,false,8',
    'json-schema': '{"id":1,"name":"toolbox","tags":["dev","local"],"meta":{"stars":42,"fork":false}}',
    'jsonpath': '$.tools[*].name\n{"tools":[{"name":"json","cat":"data"},{"name":"jwt","cat":"security"}]}',
    'xml-formatter': '<catalog><book id="bk1"><title>Dev Toolbox</title><price>0</price></book><book id="bk2"><title>Local First</title></book></catalog>',
    'html-formatter': '<section class="hero"><h1>Dev Toolbox</h1><p>77 tools, <a href="/">one bench</a>.</p><ul><li>fast</li><li>local</li></ul></section>',
    'html-to-markdown': '<h2>Features</h2><p>Runs <strong>locally</strong> with <a href="https://example.com">no server</a>.</p><ul><li>Fast</li><li>Private</li></ul>',
    'markdown-to-html': '# Dev Toolbox\n\nRuns **locally** in your *browser*.\n\n- No accounts\n- No build step\n\n> One bench, many tools.',
    'markdown-toc': '# Guide\n\n## Getting Started\n\n### Install\n\n### Configure\n\n## Usage\n\n## Troubleshooting',
    'sql-formatter': "select u.id, u.name, count(o.id) as orders from users u left join orders o on o.user_id = u.id where u.active = true group by u.id, u.name having count(o.id) > 3 order by orders desc limit 10;",
    'csv-to-insert': 'table: users\nid,name,email,active\n1,Ada,ada@example.com,true\n2,Grace,grace@example.com,false',
    'color-converter': '#3a7bd5',
    'contrast-checker': '#5b6470\n#ffffff',
    'ip-calculator': '192.168.10.42',
    'port-lookup': '5432',
    'mime-lookup': 'woff2',
    'file-signature': '89 50 4E 47 0D 0A 1A 0A',
    'status-code': '418',
    'cookie-parser': 'Set-Cookie: session=abc123; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax',
    'query-string': 'https://example.com/search?q=dev+toolbox&page=2&sort=stars&tag=local',
    'curl-builder': 'POST https://api.example.com/v1/tools\nContent-Type: application/json\nAuthorization: Bearer TOKEN\nbody: {"name":"json-formatter"}',
    'jwt-generate': '{"sub":"1234567890","name":"Dev Toolbox","admin":true,"iat":1516239022,"exp":1893456000}',
    'reverse-dns': '1.1.1.1'
  });

  Object.assign(ToolKit.placeholders, {
    'json-transform': 'Optional first line: minify · pretty · sort. JSON below…',
    'json-merge': 'Two or more JSON documents separated by lines containing only ---…',
    'json-to-csv': 'A JSON array of flat objects → CSV…',
    'csv-to-json': 'CSV with a header row → JSON array of objects…',
    'json-schema': 'A JSON sample → an inferred JSON Schema (draft 2020-12)…',
    'jsonpath': 'Line 1: a JSONPath like $.items[*].id — JSON below…',
    'xml-formatter': 'Paste XML to indent and convert to JSON…',
    'html-formatter': 'Paste HTML to indent and tidy…',
    'html-to-markdown': 'Paste HTML to convert to Markdown…',
    'markdown-to-html': 'Paste Markdown to render as HTML…',
    'markdown-toc': 'Paste Markdown — headings become a linked table of contents…',
    'sql-formatter': 'Paste a SQL query to format across clauses…',
    'csv-to-insert': 'Optional first line "table: name", then CSV with a header row…',
    'color-converter': '#33aaff · rgb(51,170,255) · hsl(207,100%,60%)…',
    'contrast-checker': 'Two colors — foreground then background (one per line)…',
    'ip-calculator': 'An IPv4 address to convert to int, hex, binary, IPv6…',
    'port-lookup': 'A port number (5432) or a keyword (redis, mail)…',
    'mime-lookup': 'An extension (png), filename (a.svg), or MIME type (text/css)…',
    'file-signature': 'Leading file bytes as hex: 89 50 4E 47…',
    'status-code': 'An HTTP status (404) or a keyword (redirect, teapot)…',
    'cookie-parser': 'A Cookie or Set-Cookie header value…',
    'query-string': 'A URL/query string to decode, or key=value lines to build one…',
    'curl-builder': 'Line 1: METHOD url · Header: value lines · body: … — or paste a curl command to parse it…',
    'jwt-generate': 'A JSON payload → an unsigned (alg=none) test JWT…',
    'reverse-dns': 'An IPv4 address to reverse-resolve via DNS-over-HTTPS…'
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = ToolKit;
  Object.assign(ToolKit.runners, runners);
})(typeof window !== 'undefined' ? window : globalThis);
