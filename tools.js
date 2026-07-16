/*
 * Tool implementations for Dev Toolbox.
 * Every runner takes the raw input string and returns either a string,
 * an object { output, status?, format? }, or a Promise of one of those.
 * Runners throw Error with a user-facing message on bad input.
 */
(function (global) {
  'use strict';

  const QR = typeof module !== 'undefined' && module.exports ? require('./qr.js') : global.QR;

  // ---------------------------------------------------------------- helpers

  const SEPARATOR = /\r?\n[ \t]*---[ \t]*\r?\n/;

  function splitTwo(value, what) {
    const parts = value.split(SEPARATOR);
    if (parts.length !== 2) {
      throw new Error(`Provide ${what} separated by a line containing only three dashes (---).`);
    }
    return [parts[0].trim(), parts[1].trim()];
  }

  function requireInput(value, hint) {
    if (!value.trim()) throw new Error(hint);
    return value.trim();
  }

  function pad(text, width) {
    return String(text).padEnd(width);
  }

  function truncate(text, max) {
    const s = String(text);
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  function alignTable(rows, gap = '  ') {
    const widths = [];
    for (const row of rows) {
      row.forEach((cell, i) => {
        widths[i] = Math.max(widths[i] || 0, String(cell).length);
      });
    }
    return rows
      .map(row => row.map((cell, i) => (i === row.length - 1 ? String(cell) : pad(cell, widths[i]))).join(gap).trimEnd())
      .join('\n');
  }

  function humanDuration(seconds) {
    if (!Number.isFinite(seconds)) return 'forever';
    if (seconds < 1) return 'under a second';
    const units = [
      ['year', 31557600],
      ['day', 86400],
      ['hour', 3600],
      ['minute', 60],
      ['second', 1]
    ];
    for (const [name, span] of units) {
      if (seconds >= span) {
        const n = seconds / span;
        if (name === 'year' && n > 1e6) return `${n.toPrecision(3).replace(/e\+?/, 'e')} years`;
        const rounded = n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
        return `${rounded} ${name}${rounded === 1 ? '' : 's'}`;
      }
    }
    return 'under a second';
  }

  function relativeTime(date, now = new Date()) {
    const diff = (date.getTime() - now.getTime()) / 1000;
    const abs = Math.abs(diff);
    if (abs < 2) return 'right about now';
    return diff < 0 ? `${humanDuration(abs)} ago` : `in ${humanDuration(abs)}`;
  }

  // ---------------------------------------------------------------- YAML (subset)
  // Supports block mappings/sequences, quoted and plain scalars, flow ([], {})
  // collections, comments, and literal/folded block scalars. Anchors, aliases,
  // tags, and multi-document streams are rejected with a clear error.

  function yamlParse(text) {
    const entries = [];
    String(text).split(/\r?\n/).forEach((rawLine, idx) => {
      if (/^\s*$/.test(rawLine)) {
        entries.push({ blank: true, lineNo: idx + 1 });
        return;
      }
      const line = rawLine.replace(/\t/g, '  ');
      const indent = line.match(/^ */)[0].length;
      const content = line.slice(indent);
      if (content.startsWith('#')) return;
      if (/^(---|\.\.\.)\s*$/.test(content)) {
        if (entries.some(e => !e.blank)) throw new Error('YAML: multi-document streams are not supported in this prototype.');
        return;
      }
      entries.push({ indent, content, lineNo: idx + 1 });
    });
    while (entries.length && entries[entries.length - 1].blank) entries.pop();

    let pos = 0;

    function fail(message, e) {
      throw new Error(`YAML line ${e ? e.lineNo : '?'}: ${message}`);
    }

    function peek() {
      let p = pos;
      while (p < entries.length && entries[p].blank) p++;
      return p < entries.length ? entries[p] : null;
    }

    function consume(entry) {
      while (entries[pos] !== entry) pos++;
      pos++;
    }

    function stripComment(s) {
      let inSingle = false, inDouble = false;
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inDouble) {
          if (c === '\\') i++;
          else if (c === '"') inDouble = false;
        } else if (inSingle) {
          if (c === "'") {
            if (s[i + 1] === "'") i++;
            else inSingle = false;
          }
        } else if (c === '"') inDouble = true;
        else if (c === "'") inSingle = true;
        else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
      }
      return s;
    }

    function isSeqItem(content) {
      return content === '-' || content.startsWith('- ');
    }

    function isBlockScalar(s) {
      return /^[|>][+-]?$/.test(s);
    }

    // Finds the colon separating key from value; returns { key, rest } or null.
    function splitKey(content, e) {
      let keyEnd = -1;
      if (content[0] === '"' || content[0] === "'") {
        const q = content[0];
        let j = 1;
        for (; j < content.length; j++) {
          if (q === '"' && content[j] === '\\') { j++; continue; }
          if (content[j] === q) {
            if (q === "'" && content[j + 1] === "'") { j++; continue; }
            break;
          }
        }
        if (j >= content.length) fail('unterminated quoted key', e);
        const after = content.slice(j + 1).match(/^\s*:/);
        if (!after) return null;
        keyEnd = j + 1 + after[0].length - 1;
      } else {
        for (let j = 0; j < content.length; j++) {
          if (content[j] === ':' && (j === content.length - 1 || content[j + 1] === ' ')) {
            keyEnd = j;
            break;
          }
        }
        if (keyEnd === -1) return null;
      }
      const keyText = content.slice(0, keyEnd).replace(/\s*:$/, '').trim();
      const rest = content.slice(keyEnd + 1);
      return { key: parseKeyText(keyText, e), rest };
    }

    function parseKeyText(keyText, e) {
      if (keyText[0] === '"' || keyText[0] === "'") {
        const v = parseQuoted(keyText, e);
        return String(v);
      }
      if (keyText === '<<') fail('merge keys (<<) are not supported', e);
      return keyText;
    }

    function parseQuoted(s, e) {
      if (s[0] === "'") {
        if (s[s.length - 1] !== "'" || s.length < 2) fail('unterminated single-quoted string', e);
        return s.slice(1, -1).replace(/''/g, "'");
      }
      if (s[s.length - 1] !== '"' || s.length < 2) fail('unterminated double-quoted string', e);
      let out = '';
      for (let i = 1; i < s.length - 1; i++) {
        const c = s[i];
        if (c !== '\\') { out += c; continue; }
        const n = s[++i];
        if (n === 'n') out += '\n';
        else if (n === 't') out += '\t';
        else if (n === 'r') out += '\r';
        else if (n === '0') out += '\0';
        else if (n === 'u') { out += String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16)); i += 4; }
        else out += n;
      }
      return out;
    }

    function plainScalar(s, e) {
      if (s === '' || s === '~' || /^null$/i.test(s)) return null;
      if (/^true$/i.test(s)) return true;
      if (/^false$/i.test(s)) return false;
      if (/^[+-]?\d+$/.test(s)) return parseInt(s, 10);
      if (/^[+-]?(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s) || /^[+-]?\d+[eE][+-]?\d+$/.test(s)) return parseFloat(s);
      if (s[0] === '&' || s[0] === '*') fail('anchors and aliases are not supported in this prototype', e);
      if (s[0] === '!') fail('tags are not supported in this prototype', e);
      return s;
    }

    function parseFlow(s, e) {
      let i = 0;
      function skipWs() { while (i < s.length && /\s/.test(s[i])) i++; }
      function quotedAt() {
        const q = s[i];
        let j = i + 1;
        for (; j < s.length; j++) {
          if (q === '"' && s[j] === '\\') { j++; continue; }
          if (s[j] === q) {
            if (q === "'" && s[j + 1] === "'") { j++; continue; }
            break;
          }
        }
        if (j >= s.length) fail('unterminated string in flow value', e);
        const raw = s.slice(i, j + 1);
        i = j + 1;
        return parseQuoted(raw, e);
      }
      function value() {
        skipWs();
        const c = s[i];
        if (c === '[') {
          i++;
          const arr = [];
          skipWs();
          if (s[i] === ']') { i++; return arr; }
          for (;;) {
            arr.push(value());
            skipWs();
            if (s[i] === ',') { i++; continue; }
            if (s[i] === ']') { i++; return arr; }
            fail('malformed flow sequence', e);
          }
        }
        if (c === '{') {
          i++;
          const obj = {};
          skipWs();
          if (s[i] === '}') { i++; return obj; }
          for (;;) {
            skipWs();
            let key;
            if (s[i] === '"' || s[i] === "'") key = String(quotedAt());
            else {
              let start = i;
              while (i < s.length && !/[:,}]/.test(s[i])) i++;
              key = s.slice(start, i).trim();
            }
            skipWs();
            if (s[i] !== ':') fail('expected ":" in flow mapping', e);
            i++;
            obj[key] = value();
            skipWs();
            if (s[i] === ',') { i++; continue; }
            if (s[i] === '}') { i++; return obj; }
            fail('malformed flow mapping', e);
          }
        }
        if (c === '"' || c === "'") return quotedAt();
        let start = i;
        while (i < s.length && !/[,\]}]/.test(s[i])) i++;
        return plainScalar(s.slice(start, i).trim(), e);
      }
      const v = value();
      skipWs();
      if (i !== s.length) fail('unexpected trailing content after flow value', e);
      return v;
    }

    function parseScalar(s, e) {
      if (s[0] === '"' || s[0] === "'") return parseQuoted(s, e);
      if (s[0] === '[' || s[0] === '{') return parseFlow(s, e);
      return plainScalar(s, e);
    }

    function parseBlockScalar(indicator, parentIndent) {
      const folded = indicator[0] === '>';
      const chomp = indicator[1] || '';
      const lines = [];
      let blockIndent = null;
      while (pos < entries.length) {
        const e = entries[pos];
        if (e.blank) { lines.push(''); pos++; continue; }
        if (e.indent <= parentIndent) break;
        if (blockIndent === null) blockIndent = e.indent;
        lines.push(' '.repeat(Math.max(0, e.indent - blockIndent)) + e.content);
        pos++;
      }
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      let text;
      if (folded) {
        text = '';
        for (const ln of lines) {
          if (ln === '') text += '\n';
          else text += (text === '' || text.endsWith('\n') ? '' : ' ') + ln;
        }
      } else {
        text = lines.join('\n');
      }
      return chomp === '-' ? text : text + '\n';
    }

    function parseValueBody(rest, e, ownIndent) {
      const restStripped = stripComment(rest).trim();
      if (restStripped === '') {
        const nxt = peek();
        if (nxt && isSeqItem(nxt.content) && nxt.indent === ownIndent) return parseSequence(ownIndent);
        return parseNode(ownIndent + 1);
      }
      if (isBlockScalar(restStripped)) return parseBlockScalar(restStripped, ownIndent);
      return parseScalar(restStripped, e);
    }

    function parseMapping(indent, seed) {
      const obj = {};
      const setKey = (key, val, e) => {
        if (Object.prototype.hasOwnProperty.call(obj, key)) fail(`duplicate key "${key}"`, e);
        obj[key] = val;
      };
      if (seed) setKey(seed.kv.key, parseValueBody(seed.kv.rest, seed.entry, indent), seed.entry);
      for (;;) {
        const e = peek();
        if (!e || e.indent !== indent || isSeqItem(e.content)) break;
        const kv = splitKey(stripComment(e.content).trimEnd(), e);
        if (!kv) fail(`expected "key: value" but got "${truncate(e.content, 40)}"`, e);
        consume(e);
        setKey(kv.key, parseValueBody(kv.rest, e, indent), e);
      }
      return obj;
    }

    function parseSequence(indent) {
      const arr = [];
      for (;;) {
        const e = peek();
        if (!e || e.indent !== indent || !isSeqItem(e.content)) break;
        consume(e);
        const rest = e.content === '-' ? '' : e.content.slice(2);
        const restStripped = stripComment(rest).trim();
        if (restStripped === '') {
          arr.push(parseNode(indent + 1));
        } else if (isBlockScalar(restStripped)) {
          arr.push(parseBlockScalar(restStripped, indent));
        } else if (isSeqItem(restStripped)) {
          fail('nested inline sequences ("- - x") are not supported', e);
        } else {
          const kv = splitKey(restStripped, e);
          if (kv) {
            arr.push(parseMapping(indent + 2, { kv, entry: e }));
          } else {
            arr.push(parseScalar(restStripped, e));
          }
        }
      }
      return arr;
    }

    function parseNode(minIndent) {
      const e = peek();
      if (!e || e.indent < minIndent) return null;
      if (isSeqItem(e.content)) return parseSequence(e.indent);
      const kv = splitKey(stripComment(e.content).trimEnd(), e);
      if (kv) return parseMapping(e.indent);
      // Bare scalar document
      consume(e);
      const scalar = parseScalar(stripComment(e.content).trim(), e);
      const leftover = peek();
      if (leftover) fail('multi-line plain scalars are not supported', leftover);
      return scalar;
    }

    const doc = parseNode(0);
    const leftover = peek();
    if (leftover) fail(`unexpected content "${truncate(leftover.content, 40)}" (check indentation)`, leftover);
    return doc;
  }

  function yamlStringify(value) {
    function isAmbiguous(s) {
      return /^(true|false|null|~|yes|no|on|off)$/i.test(s)
        || /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s);
    }

    function scalarToYaml(v) {
      if (v === null || v === undefined) return 'null';
      if (typeof v === 'boolean' || typeof v === 'number') return String(v);
      const s = String(v);
      const plainOk = s !== ''
        && !/^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(s)
        && !/[\n\t]/.test(s)
        && !/: /.test(s)
        && !/ #/.test(s)
        && !/[\s:]$/.test(s)
        && !isAmbiguous(s);
      return plainOk ? s : JSON.stringify(s);
    }

    function isEmptyContainer(v) {
      return Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0;
    }

    function nodeToYaml(v, indent) {
      const padding = ' '.repeat(indent);
      const lines = [];
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item !== null && typeof item === 'object' && !isEmptyContainer(item)) {
            if (Array.isArray(item)) {
              lines.push(padding + '-');
              lines.push(nodeToYaml(item, indent + 2));
            } else {
              const block = nodeToYaml(item, indent + 2).split('\n');
              block[0] = padding + '- ' + block[0].trimStart();
              lines.push(block.join('\n'));
            }
          } else if (item !== null && typeof item === 'object') {
            lines.push(padding + '- ' + (Array.isArray(item) ? '[]' : '{}'));
          } else if (typeof item === 'string' && item.includes('\n')) {
            lines.push(padding + '- ' + JSON.stringify(item));
          } else {
            lines.push(padding + '- ' + scalarToYaml(item));
          }
        }
      } else {
        for (const [k, val] of Object.entries(v)) {
          const key = scalarToYaml(String(k));
          if (val !== null && typeof val === 'object') {
            if (isEmptyContainer(val)) {
              lines.push(`${padding}${key}: ${Array.isArray(val) ? '[]' : '{}'}`);
            } else {
              lines.push(`${padding}${key}:`);
              lines.push(nodeToYaml(val, indent + 2));
            }
          } else if (typeof val === 'string' && val.includes('\n')) {
            const body = val.replace(/\n$/, '');
            lines.push(`${padding}${key}: |${val.endsWith('\n') ? '' : '-'}`);
            for (const ln of body.split('\n')) lines.push(padding + '  ' + ln);
          } else {
            lines.push(`${padding}${key}: ${scalarToYaml(val)}`);
          }
        }
      }
      return lines.join('\n');
    }

    if (value === null || typeof value !== 'object') return scalarToYaml(value) + '\n';
    if (isEmptyContainer(value)) return (Array.isArray(value) ? '[]' : '{}') + '\n';
    return nodeToYaml(value, 0) + '\n';
  }

  // ---------------------------------------------------------------- diff helpers

  function diffLines(aText, bText) {
    const a = aText.split('\n');
    const b = bText.split('\n');

    // Trim common prefix/suffix to keep the DP table small.
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length, endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
    const midA = a.slice(start, endA);
    const midB = b.slice(start, endB);
    if (midA.length * midB.length > 9e6) {
      throw new Error('Inputs are too large to diff in this prototype (try smaller blocks).');
    }

    const n = midA.length, m = midB.length;
    const dp = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * (m + 1) + j] = midA[i] === midB[j]
          ? dp[(i + 1) * (m + 1) + j + 1] + 1
          : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
      }
    }
    const ops = [];
    for (let k = 0; k < start; k++) ops.push(['=', a[k]]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { ops.push(['=', midA[i]]); i++; j++; }
      else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) { ops.push(['-', midA[i]]); i++; }
      else { ops.push(['+', midB[j]]); j++; }
    }
    while (i < n) { ops.push(['-', midA[i]]); i++; }
    while (j < m) { ops.push(['+', midB[j]]); j++; }
    for (let k = endA; k < a.length; k++) ops.push(['=', a[k]]);
    return ops;
  }

  function jsonDiff(a, b, path, out) {
    const fmt = v => truncate(JSON.stringify(v), 64);
    if (a === b) return out;
    const aIsObj = a !== null && typeof a === 'object';
    const bIsObj = b !== null && typeof b === 'object';
    if (!aIsObj || !bIsObj || Array.isArray(a) !== Array.isArray(b)) {
      if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`~ ${path}: ${fmt(a)} → ${fmt(b)}`);
      return out;
    }
    if (Array.isArray(a)) {
      const len = Math.max(a.length, b.length);
      for (let i = 0; i < len; i++) {
        if (i >= a.length) out.push(`+ ${path}[${i}]: ${fmt(b[i])}`);
        else if (i >= b.length) out.push(`- ${path}[${i}]: ${fmt(a[i])}`);
        else jsonDiff(a[i], b[i], `${path}[${i}]`, out);
      }
      return out;
    }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      const sub = `${path}.${key}`;
      if (!(key in b)) out.push(`- ${sub}: ${fmt(a[key])}`);
      else if (!(key in a)) out.push(`+ ${sub}: ${fmt(b[key])}`);
      else jsonDiff(a[key], b[key], sub, out);
    }
    return out;
  }

  // ---------------------------------------------------------------- CSV

  function parseCSV(text, delim) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let sawAny = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"' && field === '') {
        inQuotes = true;
        sawAny = true;
      } else if (c === delim) {
        row.push(field);
        field = '';
        sawAny = true;
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        sawAny = false;
      } else {
        field += c;
        sawAny = true;
      }
    }
    if (field !== '' || sawAny || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function detectDelimiter(text) {
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    let best = ',', bestCount = 0;
    for (const d of [',', ';', '\t', '|']) {
      const count = firstLine.split(d).length - 1;
      if (count > bestCount) { best = d; bestCount = count; }
    }
    return best;
  }

  // ---------------------------------------------------------------- CIDR

  function ipToInt(ip, label) {
    const parts = ip.split('.');
    if (parts.length !== 4) throw new Error(`"${label}" is not a valid IPv4 address.`);
    let n = 0;
    for (const p of parts) {
      if (!/^\d{1,3}$/.test(p) || Number(p) > 255) throw new Error(`"${label}" is not a valid IPv4 address.`);
      n = (n << 8) | Number(p);
    }
    return n >>> 0;
  }

  function intToIp(n) {
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }

  function ipRangeNote(ipInt) {
    const inRange = (cidr) => {
      const [base, bits] = cidr.split('/');
      const mask = bits === '0' ? 0 : (~0 << (32 - Number(bits))) >>> 0;
      return ((ipInt & mask) >>> 0) === ((ipToInt(base, base) & mask) >>> 0);
    };
    if (inRange('10.0.0.0/8') || inRange('172.16.0.0/12') || inRange('192.168.0.0/16')) return 'Private range (RFC 1918)';
    if (inRange('127.0.0.0/8')) return 'Loopback range';
    if (inRange('169.254.0.0/16')) return 'Link-local range';
    if (inRange('100.64.0.0/10')) return 'Carrier-grade NAT range (RFC 6598)';
    if (inRange('224.0.0.0/4')) return 'Multicast range';
    return 'Public range';
  }

  // ---------------------------------------------------------------- cron

  const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const DOW_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const CRON_MACROS = {
    '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *',
    '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *'
  };

  function parseCronField(raw, min, max, names, fieldName) {
    const resolve = (token) => {
      if (/^\d+$/.test(token)) return Number(token);
      const idx = names ? names.indexOf(token.toUpperCase()) : -1;
      if (idx === -1) throw new Error(`Cron ${fieldName}: "${token}" is not a number${names ? ' or name' : ''}.`);
      return idx + min;
    };
    const values = new Set();
    for (const part of raw.split(',')) {
      const m = part.match(/^(.+?)(?:\/(\d+))?$/);
      if (!m || part === '') throw new Error(`Cron ${fieldName}: cannot parse "${part}".`);
      const step = m[2] ? Number(m[2]) : 1;
      if (step < 1) throw new Error(`Cron ${fieldName}: step must be at least 1.`);
      let lo, hi;
      const base = m[1];
      if (base === '*') { lo = min; hi = max; }
      else {
        const range = base.match(/^(.+?)-(.+)$/);
        if (range) { lo = resolve(range[1]); hi = resolve(range[2]); }
        else { lo = resolve(base); hi = m[2] ? max : lo; }
      }
      const wrap = v => (fieldName === 'day-of-week' && v === 7 ? 0 : v);
      if (wrap(lo) < min || (fieldName !== 'day-of-week' && hi > max) || (fieldName === 'day-of-week' && hi > 7)) {
        throw new Error(`Cron ${fieldName}: value out of range ${min}-${max} in "${part}".`);
      }
      if (lo > hi) throw new Error(`Cron ${fieldName}: range "${part}" is inverted.`);
      for (let v = lo; v <= hi; v += step) values.add(wrap(v));
    }
    return values;
  }

  function describeCronField(raw, values, min, max, names) {
    if (raw === '*') return 'any';
    const sorted = [...values].sort((x, y) => x - y);
    const label = v => (names ? names[v - min] : String(v));
    const chunks = [];
    for (let i = 0; i < sorted.length;) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
      chunks.push(j - i >= 2 ? `${label(sorted[i])}-${label(sorted[j])}` : sorted.slice(i, j + 1).map(label).join(', '));
      i = j + 1;
    }
    return chunks.join(', ');
  }

  // ---------------------------------------------------------------- dictionaries

  const HEADER_INFO = {
    'accept': 'Media types the client can handle, in preference order.',
    'accept-encoding': 'Compression algorithms the client supports (gzip, br, zstd).',
    'accept-language': 'Preferred response languages, in preference order.',
    'authorization': 'Credentials for the request (Basic, Bearer, etc.). Never log this value.',
    'cache-control': 'Caching directives (max-age, no-store, private, ...).',
    'connection': 'Hop-by-hop connection options (keep-alive, close). Ignored in HTTP/2+.',
    'content-encoding': 'Compression applied to the response body.',
    'content-length': 'Size of the message body in bytes.',
    'content-security-policy': 'Restricts where scripts, styles, and other resources may load from.',
    'content-type': 'Media type of the message body (e.g. application/json; charset=utf-8).',
    'cookie': 'Cookies previously set by the server, sent back on each request.',
    'etag': 'Version identifier for the resource, used for conditional requests.',
    'expires': 'Legacy expiry date for caching; Cache-Control max-age wins when both exist.',
    'host': 'Target host and port; required in HTTP/1.1, selects the virtual host.',
    'if-modified-since': 'Conditional request: only send the body if changed since this date.',
    'if-none-match': 'Conditional request: only send the body if the ETag no longer matches.',
    'last-modified': 'When the resource was last changed; pairs with If-Modified-Since.',
    'location': 'Redirect target (3xx) or the URL of a newly created resource (201).',
    'origin': 'Scheme + host + port that initiated the request; the basis of CORS checks.',
    'pragma': 'Deprecated HTTP/1.0 caching directive; use Cache-Control instead.',
    'referer': 'URL of the page that made the request (yes, the misspelling is standard).',
    'set-cookie': 'Asks the client to store a cookie; check Secure, HttpOnly, and SameSite.',
    'strict-transport-security': 'Forces HTTPS for future visits (HSTS).',
    'transfer-encoding': 'How the body is framed on the wire (usually chunked).',
    'user-agent': 'Client software identifier string.',
    'vary': 'Request headers that change the response; critical for correct caching.',
    'www-authenticate': 'Server challenge describing how to authenticate (with a 401).',
    'x-content-type-options': '"nosniff" stops browsers from guessing content types.',
    'x-forwarded-for': 'Original client IP(s) added by proxies; spoofable, treat with care.',
    'x-frame-options': 'Legacy clickjacking protection; superseded by CSP frame-ancestors.',
    'x-request-id': 'Correlation ID for tracing a request across services (non-standard).',
    'x-xss-protection': 'Deprecated; modern browsers ignore it. Use a strong CSP instead.',
    'access-control-allow-origin': 'CORS: which origins may read this response.',
    'access-control-allow-methods': 'CORS preflight: HTTP methods allowed for the actual request.',
    'access-control-allow-headers': 'CORS preflight: request headers allowed for the actual request.',
    'retry-after': 'How long to wait before retrying (seconds or HTTP date), often with 429/503.'
  };

  const CSP_BASELINE = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'"]],
    ['style-src', ["'self'"]],
    ['img-src', ["'self'", 'data:']],
    ['font-src', ["'self'"]],
    ['connect-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
    ['upgrade-insecure-requests', []]
  ];

  const CSP_INFO = {
    'default-src': 'Fallback for every fetch directive not listed explicitly.',
    'script-src': 'Where JavaScript may be loaded and executed from.',
    'style-src': 'Where stylesheets may be loaded from.',
    'img-src': 'Where images may be loaded from.',
    'font-src': 'Where web fonts may be loaded from.',
    'connect-src': 'Targets for fetch/XHR/WebSocket/EventSource connections.',
    'media-src': 'Where audio and video may be loaded from.',
    'object-src': 'Plugins (<object>/<embed>); keep this \'none\'.',
    'frame-src': 'What may be embedded in iframes on this page.',
    'worker-src': 'Where workers and service workers may be loaded from.',
    'child-src': 'Legacy fallback for frame-src and worker-src.',
    'manifest-src': 'Where the web app manifest may be loaded from.',
    'base-uri': 'Restricts <base href>, preventing base tag hijacking.',
    'form-action': 'Where forms on this page are allowed to submit.',
    'frame-ancestors': 'Who may embed THIS page (replaces X-Frame-Options).',
    'upgrade-insecure-requests': 'Rewrites http:// subresource URLs to https://.',
    'report-to': 'Reporting group that receives CSP violation reports.',
    'report-uri': 'Deprecated violation-report endpoint (still widely used).',
    'sandbox': 'Applies iframe-style sandboxing to the page itself.',
    'script-src-elem': 'Script sources for <script> elements specifically.',
    'script-src-attr': 'Script sources for inline event handlers specifically.',
    'style-src-elem': 'Style sources for <style> and <link> elements specifically.',
    'style-src-attr': 'Style sources for inline style attributes specifically.',
    'block-all-mixed-content': 'Deprecated; upgrade-insecure-requests covers this.'
  };

  const GITIGNORE_TEMPLATES = {
    node: ['node_modules/', 'npm-debug.log*', 'yarn-debug.log*', 'yarn-error.log*', '.pnpm-debug.log*', 'dist/', 'build/', '.cache/', '.eslintcache', '*.tsbuildinfo', 'coverage/'],
    python: ['__pycache__/', '*.py[cod]', '*.egg-info/', '.eggs/', 'build/', 'dist/', '.venv/', 'venv/', '.pytest_cache/', '.mypy_cache/', '.ruff_cache/', '.coverage', 'htmlcov/'],
    go: ['*.exe', '*.exe~', '*.dll', '*.so', '*.dylib', '*.test', '*.out', 'vendor/', 'go.work.sum'],
    rust: ['target/', 'Cargo.lock  # keep for binaries, ignore for libraries', '**/*.rs.bk'],
    java: ['*.class', '*.jar', '*.war', 'target/', '.gradle/', 'build/', 'out/', 'hs_err_pid*'],
    dotnet: ['bin/', 'obj/', '*.user', '.vs/', 'packages/', 'TestResults/'],
    cpp: ['*.o', '*.obj', '*.a', '*.lib', '*.so', '*.dylib', '*.dll', '*.exe', 'build/', 'cmake-build-*/', 'CMakeCache.txt', 'CMakeFiles/'],
    web: ['dist/', 'build/', '.parcel-cache/', '.next/', '.nuxt/', '.svelte-kit/', '.astro/'],
    macos: ['.DS_Store', '.AppleDouble', '.LSOverride', 'Icon?', '._*', '.Spotlight-V100', '.Trashes'],
    windows: ['Thumbs.db', 'Thumbs.db:encryptable', 'ehthumbs.db', 'Desktop.ini', '$RECYCLE.BIN/', '*.lnk'],
    linux: ['*~', '.fuse_hidden*', '.directory', '.Trash-*', '.nfs*'],
    vscode: ['.vscode/*', '!.vscode/settings.json', '!.vscode/tasks.json', '!.vscode/launch.json', '!.vscode/extensions.json'],
    jetbrains: ['.idea/', '*.iml', 'out/', '.idea_modules/'],
    vim: ['[._]*.s[a-v][a-z]', '[._]*.sw[a-p]', 'Session.vim', '*.un~'],
    terraform: ['.terraform/', '*.tfstate', '*.tfstate.*', 'crash.log', '*.tfvars  # often contains secrets', '.terraform.lock.hcl'],
    docker: ['docker-compose.override.yml', '.docker/'],
    env: ['.env', '.env.*', '!.env.example']
  };

  const DNS_TYPES = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, CAA: 257 };
  const DNS_TYPE_NAMES = Object.fromEntries(Object.entries(DNS_TYPES).map(([k, v]) => [v, k]));
  const DNS_STATUS = { 0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN', 4: 'NOTIMP', 5: 'REFUSED' };

  // ---------------------------------------------------------------- crypto helpers

  function bytesToHex(buffer) {
    return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
  }

  async function digestHex(algorithm, bytes) {
    return bytesToHex(await crypto.subtle.digest(algorithm, bytes));
  }

  function decodeBase64Url(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  // ---------------------------------------------------------------- runners

  const runners = {

    'json-formatter'(value) {
      const parsed = JSON.parse(requireInput(value, 'Paste JSON to format.'));
      const pretty = JSON.stringify(parsed, null, 2);
      return { output: pretty, status: `Valid JSON — ${pretty.length.toLocaleString()} characters formatted.` };
    },

    'yaml-converter'(value) {
      const input = requireInput(value, 'Paste YAML to convert to JSON, or JSON to convert to YAML.');
      const looksJson = /^[{[]/.test(input);
      if (looksJson) {
        try {
          return { output: yamlStringify(JSON.parse(input)).trimEnd(), status: 'Converted JSON → YAML.' };
        } catch (e) { /* fall through to YAML */ }
      }
      try {
        return { output: JSON.stringify(yamlParse(input), null, 2), status: 'Converted YAML → JSON.' };
      } catch (yamlError) {
        if (looksJson) throw new Error('Input looks like JSON but neither JSON nor YAML parsing succeeded: ' + yamlError.message);
        throw yamlError;
      }
    },

    'csv-viewer'(value) {
      const input = requireInput(value, 'Paste CSV (or TSV) data.');
      const delim = detectDelimiter(input);
      const rows = parseCSV(input, delim).filter(r => !(r.length === 1 && r[0] === ''));
      if (!rows.length) throw new Error('No rows found.');
      const cols = Math.max(...rows.map(r => r.length));
      const shown = rows.slice(0, 101);
      const widths = [];
      for (const row of shown) {
        for (let c = 0; c < cols; c++) {
          widths[c] = Math.min(28, Math.max(widths[c] || 3, String(row[c] ?? '').length));
        }
      }
      const renderRow = row => Array.from({ length: cols }, (_, c) => pad(truncate(row[c] ?? '', 28), widths[c])).join(' | ').trimEnd();
      const lines = [renderRow(shown[0]), widths.map(w => '-'.repeat(w)).join('-+-')];
      for (const row of shown.slice(1)) lines.push(renderRow(row));
      if (rows.length > shown.length) lines.push(`… ${rows.length - shown.length} more row(s) not shown`);
      const delimName = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' }[delim];
      return {
        output: lines.join('\n'),
        status: `${rows.length - 1} data row(s) × ${cols} column(s), ${delimName}-separated (first row treated as header).`
      };
    },

    'json-diff'(value) {
      const [aText, bText] = splitTwo(value, 'two JSON documents');
      let a, b;
      try { a = JSON.parse(aText); } catch (e) { throw new Error('First document is not valid JSON: ' + e.message); }
      try { b = JSON.parse(bText); } catch (e) { throw new Error('Second document is not valid JSON: ' + e.message); }
      const changes = jsonDiff(a, b, '$', []);
      if (!changes.length) return { output: 'No differences — the two documents are structurally identical.', status: 'Documents match.' };
      const added = changes.filter(c => c.startsWith('+')).length;
      const removed = changes.filter(c => c.startsWith('-')).length;
      const changed = changes.filter(c => c.startsWith('~')).length;
      return {
        output: ['Legend: + added   - removed   ~ changed', '', ...changes.sort()].join('\n'),
        status: `${changes.length} difference(s): ${added} added, ${removed} removed, ${changed} changed.`
      };
    },

    'jwt-decoder'(value) {
      const token = requireInput(value, 'Paste a JWT (header.payload.signature).');
      const parts = token.split('.');
      if (parts.length < 2 || parts.length > 3) throw new Error('A JWT has 2 or 3 dot-separated base64url segments.');
      let header, payload;
      try { header = JSON.parse(decodeBase64Url(parts[0])); } catch (e) { throw new Error('Could not decode the header segment: ' + e.message); }
      try { payload = JSON.parse(decodeBase64Url(parts[1])); } catch (e) { throw new Error('Could not decode the payload segment: ' + e.message); }
      const notes = [];
      if (header.alg) notes.push(`Algorithm: ${header.alg}${header.alg === 'none' ? ' — unsigned token!' : ''}`);
      const claimDate = (claim, label) => {
        if (typeof payload[claim] === 'number') {
          const d = new Date(payload[claim] * 1000);
          notes.push(`${label}: ${d.toISOString()} (${relativeTime(d)})`);
          return d;
        }
        return null;
      };
      claimDate('iat', 'Issued');
      claimDate('nbf', 'Not valid before');
      const exp = claimDate('exp', 'Expires');
      if (exp) notes.push(exp.getTime() < Date.now() ? '✗ Token is EXPIRED.' : '✓ Token is not expired.');
      else notes.push('No exp claim — token never expires.');
      notes.push(parts[2] ? 'Signature present but NOT verified (decoding only).' : 'No signature segment.');
      return {
        output: JSON.stringify({ header, payload }, null, 2) + '\n\n' + notes.map(n => '• ' + n).join('\n'),
        status: 'Decoded (signature not verified).'
      };
    },

    async 'hash-generator'(value) {
      if (typeof crypto === 'undefined' || !crypto.subtle) {
        throw new Error('Web Crypto is unavailable here — serve the page over HTTPS or localhost.');
      }
      const input = requireInput(value, 'Enter text to hash — or a key, a --- line, then a message for HMAC.');
      const encoder = new TextEncoder();
      if (SEPARATOR.test(input)) {
        const [keyText, message] = splitTwo(input, 'a key and a message');
        const results = [];
        for (const hash of ['SHA-256', 'SHA-512']) {
          const key = await crypto.subtle.importKey('raw', encoder.encode(keyText), { name: 'HMAC', hash }, false, ['sign']);
          results.push([`HMAC-${hash}`, bytesToHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)))]);
        }
        return {
          output: [
            `Key:     ${truncate(keyText, 48)} (${encoder.encode(keyText).length} bytes)`,
            `Message: ${truncate(message, 48)} (${encoder.encode(message).length} bytes)`,
            '',
            ...results.map(([name, hex]) => `${name}:\n${hex}`)
          ].join('\n'),
          status: 'HMAC computed locally.'
        };
      }
      const bytes = encoder.encode(input);
      const lines = [`Input: ${bytes.length} byte(s) of UTF-8`, ''];
      for (const alg of ['SHA-256', 'SHA-1', 'SHA-384', 'SHA-512']) {
        lines.push(`${alg}:\n${await digestHex(alg, bytes)}`);
      }
      lines.push('', 'Tip: to compute an HMAC, enter the key, a line with only ---, then the message.');
      return lines.join('\n');
    },

    'csp-builder'(value) {
      const policy = new Map(CSP_BASELINE.map(([k, v]) => [k, [...v]]));
      const warnings = [];
      for (const rawLine of value.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const m = line.match(/^([a-z-]+):?\s*(.*)$/i);
        if (!m) { warnings.push(`Ignored line: "${truncate(line, 40)}"`); continue; }
        const directive = m[1].toLowerCase();
        if (!(directive in CSP_INFO)) {
          warnings.push(`Unknown directive "${directive}" — ignored. Valid: ${Object.keys(CSP_INFO).slice(0, 8).join(', ')}, ...`);
          continue;
        }
        const sources = m[2].trim() ? m[2].trim().split(/\s+/) : [];
        const current = policy.get(directive) || [];
        for (const src of sources) {
          if (!current.includes(src)) current.push(src);
          if (src === "'unsafe-inline'" || src === 'unsafe-inline') warnings.push(`'unsafe-inline' in ${directive} largely defeats the policy — prefer nonces or hashes.`);
          if (src === "'unsafe-eval'" || src === 'unsafe-eval') warnings.push(`'unsafe-eval' in ${directive} allows eval() — avoid if possible.`);
          if (src === '*') warnings.push(`Wildcard * in ${directive} allows any origin — avoid.`);
        }
        // A directive that only allowed 'none' must drop it once real sources are added.
        if (sources.length && current.includes("'none'") && current.length > 1) {
          policy.set(directive, current.filter(s => s !== "'none'"));
        } else {
          policy.set(directive, current);
        }
      }
      const headerValue = [...policy.entries()]
        .map(([k, v]) => (v.length ? `${k} ${v.join(' ')}` : k))
        .join('; ');
      const breakdown = [...policy.entries()].map(([k, v]) =>
        `${k}\n  ${v.length ? v.join(' ') : '(no value)'}\n  ↳ ${CSP_INFO[k]}`);
      return {
        output: [
          '# Paste into your server config / response headers:',
          `Content-Security-Policy: ${headerValue}`,
          '',
          '# Directive breakdown',
          ...breakdown,
          ...(warnings.length ? ['', '# Warnings', ...warnings.map(w => '⚠ ' + w)] : [])
        ].join('\n'),
        status: warnings.length ? `Policy built with ${warnings.length} warning(s).` : 'Strict policy built.'
      };
    },

    'password-entropy'(value) {
      if (!value.length) throw new Error('Enter a password or passphrase to analyze.');
      const pools = [
        [/[a-z]/, 26, 'lowercase letters'],
        [/[A-Z]/, 26, 'uppercase letters'],
        [/[0-9]/, 10, 'digits'],
        [/[ ]/, 1, 'spaces'],
        [/[^a-zA-Z0-9 ]/, 32, 'symbols']
      ];
      let poolSize = 0;
      const present = [];
      for (const [regex, size, name] of pools) {
        if (regex.test(value)) { poolSize += size; present.push(name); }
      }
      const bits = value.length * Math.log2(poolSize);
      const rating = bits < 28 ? 'Very weak' : bits < 40 ? 'Weak' : bits < 60 ? 'Fair' : bits < 90 ? 'Strong' : 'Very strong';
      const guesses = Math.pow(2, bits - 1); // average guesses to crack
      return {
        output: [
          `Length:        ${value.length} characters`,
          `Character set: ${present.join(', ')} (pool of ~${poolSize})`,
          `Entropy:       ~${bits.toFixed(1)} bits`,
          `Rating:        ${rating}`,
          '',
          'Average time to crack (brute force):',
          `  Online, throttled (100/s):     ${humanDuration(guesses / 100)}`,
          `  Offline, fast GPU rig (10¹⁰/s): ${humanDuration(guesses / 1e10)}`,
          '',
          'Assumes randomly chosen characters. Real-world passwords built from',
          'dictionary words, names, or patterns are far weaker than this estimate.'
        ].join('\n'),
        status: `${rating} — ~${bits.toFixed(0)} bits of entropy.`
      };
    },

    'cidr-calculator'(value) {
      const input = requireInput(value, 'Enter CIDR notation, e.g. 192.168.1.0/24.').split('\n')[0].trim();
      const m = input.match(/^([\d.]+)(?:\/(\d{1,2}))?$/);
      if (!m) throw new Error('Use the form a.b.c.d/prefix, e.g. 10.0.0.0/8.');
      const prefix = m[2] === undefined ? 32 : Number(m[2]);
      if (prefix > 32) throw new Error('Prefix length must be between 0 and 32.');
      const ip = ipToInt(m[1], m[1]);
      const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
      const network = (ip & mask) >>> 0;
      const broadcast = (network | ~mask) >>> 0;
      const total = Math.pow(2, 32 - prefix);
      const usable = prefix >= 31 ? total : total - 2;
      const rows = [
        ['Input', `${m[1]}/${prefix}`],
        ['Netmask', intToIp(mask)],
        ['Wildcard', intToIp(~mask >>> 0)],
        ['Network', intToIp(network)],
        ['Broadcast', prefix >= 31 ? '(none for /31 and /32)' : intToIp(broadcast)],
        ['First host', prefix >= 31 ? intToIp(network) : intToIp(network + 1)],
        ['Last host', prefix >= 31 ? intToIp(broadcast) : intToIp(broadcast - 1)],
        ['Usable hosts', usable.toLocaleString() + (prefix === 31 ? ' (point-to-point, RFC 3021)' : '')],
        ['Total addresses', total.toLocaleString()],
        ['Range type', ipRangeNote(network)]
      ];
      return { output: alignTable(rows), status: `${usable.toLocaleString()} usable host(s) in ${intToIp(network)}/${prefix}.` };
    },

    'url-parser'(value) {
      let input = requireInput(value, 'Paste a URL to parse.').split('\n')[0].trim();
      const notes = [];
      if (!/^[a-z][a-z0-9+.-]*:/i.test(input)) {
        input = 'https://' + input;
        notes.push('No scheme given — assumed https://');
      }
      let url;
      try { url = new URL(input); } catch (e) { throw new Error('Not a valid URL: ' + input); }
      const defaultPorts = { 'http:': '80', 'https:': '443', 'ftp:': '21', 'ws:': '80', 'wss:': '443' };
      const rows = [
        ['Protocol', url.protocol],
        ['Username', url.username || '(none)'],
        ['Password', url.password ? '••• (present)' : '(none)'],
        ['Hostname', url.hostname],
        ['Port', url.port || `${defaultPorts[url.protocol] || '(none)'} (default)`],
        ['Path', url.pathname],
        ['Fragment', url.hash || '(none)'],
        ['Origin', url.origin]
      ];
      const params = [...url.searchParams.entries()];
      const lines = [alignTable(rows)];
      if (params.length) {
        lines.push('', `Query parameters (${params.length}):`);
        lines.push(alignTable(params.map(([k, v]) => ['  ' + k, '= ' + v])));
      } else {
        lines.push('', 'Query parameters: (none)');
      }
      if (notes.length) lines.push('', ...notes.map(n => '• ' + n));
      return lines.join('\n');
    },

    'http-headers'(value) {
      const input = requireInput(value, 'Paste raw HTTP headers, one per line.');
      const lines = input.split('\n').map(l => l.trim()).filter(Boolean);
      const out = [];
      let known = 0, unknown = 0;
      for (const line of lines) {
        const requestLine = line.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|CONNECT|TRACE)\s+(\S+)/i);
        const statusLine = line.match(/^HTTP\/[\d.]+\s+(\d{3})/);
        if (requestLine) { out.push(`▶ Request line: ${requestLine[1].toUpperCase()} ${requestLine[2]}`); continue; }
        if (statusLine) { out.push(`▶ Status line: HTTP ${statusLine[1]}`); continue; }
        const m = line.match(/^([A-Za-z0-9-]+):\s*(.*)$/);
        if (!m) { out.push(`? Unparseable line: "${truncate(line, 50)}"`); continue; }
        const name = m[1];
        const info = HEADER_INFO[name.toLowerCase()];
        out.push(`${name}: ${truncate(m[2], 70)}`);
        if (info) { out.push(`  ↳ ${info}`); known++; }
        else { out.push('  ↳ Not a common standard header (custom or less common).'); unknown++; }
      }
      return {
        output: out.join('\n'),
        status: `${known + unknown} header(s) annotated — ${known} recognized, ${unknown} custom/uncommon.`
      };
    },

    async 'dns-lookup'(value) {
      const parts = requireInput(value, 'Enter a domain, optionally followed by a record type: example.com MX').split(/\s+/);
      const name = parts[0].replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const type = (parts[1] || 'A').toUpperCase();
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+\.?$/i.test(name)) {
        throw new Error(`"${name}" does not look like a valid domain name.`);
      }
      if (!(type in DNS_TYPES)) {
        throw new Error(`Unsupported record type "${type}". Try: ${Object.keys(DNS_TYPES).join(', ')}.`);
      }
      let data;
      try {
        const res = await fetch(
          `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
          { headers: { accept: 'application/dns-json' } }
        );
        if (!res.ok) throw new Error(`resolver returned HTTP ${res.status}`);
        data = await res.json();
      } catch (e) {
        throw new Error('DNS query failed (' + e.message + '). This tool needs network access — it queries Cloudflare DNS-over-HTTPS.');
      }
      const lines = [`${name}  ${type} — status: ${DNS_STATUS[data.Status] || data.Status}`, ''];
      const records = data.Answer || [];
      if (records.length) {
        lines.push(alignTable([
          ['NAME', 'TTL', 'TYPE', 'DATA'],
          ...records.map(r => [r.name, r.TTL, DNS_TYPE_NAMES[r.type] || r.type, truncate(r.data, 80)])
        ]));
      } else if (data.Authority && data.Authority.length) {
        lines.push('No answer records. Authority section:');
        lines.push(...data.Authority.map(r => `  ${r.name}  ${DNS_TYPE_NAMES[r.type] || r.type}  ${truncate(r.data, 80)}`));
      } else {
        lines.push('No records found.');
      }
      return { output: lines.join('\n'), status: `Resolved via Cloudflare DNS-over-HTTPS — ${records.length} record(s).` };
    },

    'regex-tester'(value) {
      const lines = value.split('\n');
      const firstLine = (lines[0] || '').trim();
      if (!firstLine) throw new Error('Put the regular expression on the first line and the text to test below it.');
      const rest = lines.slice(1).join('\n');
      if (!rest.trim()) throw new Error('Add the text to test on the lines below the pattern.');
      let source = firstLine, flags = 'g';
      const literal = firstLine.match(/^\/(.*)\/([a-z]*)$/s);
      if (literal) {
        source = literal[1];
        flags = literal[2];
        if (!flags.includes('g')) flags += 'g';
      }
      let regex;
      try { regex = new RegExp(source, flags); } catch (e) { throw new Error('Invalid regular expression: ' + e.message); }
      const matches = [];
      for (const m of rest.matchAll(regex)) {
        matches.push(m);
        if (matches.length >= 500) break;
        if (m[0] === '') regex.lastIndex++; // avoid infinite loop on empty matches
      }
      if (!matches.length) {
        return { output: `Pattern: /${source}/${flags}\n\nNo matches.`, status: 'No matches.' };
      }
      const out = [`Pattern: /${source}/${flags}`, `Matches: ${matches.length}${matches.length >= 500 ? ' (capped)' : ''}`, ''];
      matches.slice(0, 100).forEach((m, i) => {
        out.push(`#${i + 1} @ index ${m.index}: "${truncate(m[0], 60)}"`);
        for (let g = 1; g < m.length; g++) {
          out.push(`    group ${g}: ${m[g] === undefined ? '(no match)' : '"' + truncate(m[g], 50) + '"'}`);
        }
        if (m.groups) {
          for (const [gname, gval] of Object.entries(m.groups)) {
            out.push(`    <${gname}>: ${gval === undefined ? '(no match)' : '"' + truncate(gval, 50) + '"'}`);
          }
        }
      });
      out.push('', 'Text with matches marked:');
      let marked = '';
      let last = 0;
      for (const m of matches) {
        marked += rest.slice(last, m.index) + '«' + m[0] + '»';
        last = m.index + m[0].length;
      }
      marked += rest.slice(last);
      out.push(marked);
      return { output: out.join('\n'), status: `${matches.length} match(es).` };
    },

    'case-converter'(value) {
      const input = requireInput(value, 'Enter a phrase or identifier to convert.');
      const words = input
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map(w => w.toLowerCase());
      if (!words.length) throw new Error('No letters or digits found in the input.');
      const capitalize = w => w[0].toUpperCase() + w.slice(1);
      const rows = [
        ['camelCase', words[0] + words.slice(1).map(capitalize).join('')],
        ['PascalCase', words.map(capitalize).join('')],
        ['snake_case', words.join('_')],
        ['kebab-case', words.join('-')],
        ['CONSTANT_CASE', words.join('_').toUpperCase()],
        ['Title Case', words.map(capitalize).join(' ')],
        ['dot.case', words.join('.')],
        ['path/case', words.join('/')]
      ];
      return alignTable(rows);
    },

    'text-diff'(value) {
      const [a, b] = splitTwo(value, 'two text blocks');
      if (a === b) return { output: 'No differences — the two blocks are identical.', status: 'Blocks match.' };
      const ops = diffLines(a, b);
      const added = ops.filter(([op]) => op === '+').length;
      const removed = ops.filter(([op]) => op === '-').length;
      const body = ops.map(([op, line]) => (op === '=' ? '  ' : op + ' ') + line).join('\n');
      return { output: body, status: `+${added} added line(s), −${removed} removed line(s).` };
    },

    'slug-generator'(value) {
      const input = requireInput(value, 'Enter a title or phrase to slugify.');
      const slug = input
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      if (!slug) throw new Error('Nothing slug-worthy found in the input.');
      return { output: slug, status: `${slug.length} characters.` };
    },

    'docker-linter'(value) {
      const source = requireInput(value, 'Paste a Dockerfile.');
      const rawLines = source.split('\n');
      const instructions = [];
      for (let i = 0; i < rawLines.length; i++) {
        if (/^\s*(#|$)/.test(rawLines[i])) continue;
        let text = rawLines[i];
        const startLine = i + 1;
        while (/\\\s*$/.test(text) && i + 1 < rawLines.length) {
          i++;
          text = text.replace(/\\\s*$/, ' ') + rawLines[i].trim();
        }
        const m = text.match(/^\s*([A-Za-z]+)\s+([\s\S]*)$/);
        if (m) instructions.push({ line: startLine, keyword: m[1].toUpperCase(), args: m[2].trim() });
      }
      const issues = [];
      const issue = (line, level, message) => issues.push({ line, level, message });
      const froms = instructions.filter(inst => inst.keyword === 'FROM');
      if (!froms.length) issue(1, 'error', 'No FROM instruction — every Dockerfile needs a base image.');
      for (const f of froms) {
        const image = f.args.split(/\s+/)[0];
        if (image !== 'scratch' && !image.startsWith('$')) {
          if (!image.includes(':') && !image.includes('@')) issue(f.line, 'warn', `Base image "${image}" has no tag — it defaults to :latest, which is not reproducible.`);
          else if (image.endsWith(':latest')) issue(f.line, 'warn', `Base image "${image}" is pinned to :latest — pin a version for reproducible builds.`);
        }
      }
      for (const inst of instructions) {
        const { line, keyword, args } = inst;
        if (keyword === 'MAINTAINER') issue(line, 'warn', 'MAINTAINER is deprecated — use LABEL maintainer="..." instead.');
        if (keyword === 'RUN') {
          if (/\bsudo\b/.test(args)) issue(line, 'warn', 'sudo in RUN rarely works as expected — Docker builds already run as root; use USER instead.');
          if (/\bapt-get upgrade\b/.test(args)) issue(line, 'warn', 'apt-get upgrade makes builds unreproducible — pin package versions instead.');
          if (/\bapt-get install\b/.test(args)) {
            if (!args.includes('--no-install-recommends')) issue(line, 'info', 'apt-get install without --no-install-recommends pulls extra packages and bloats the image.');
            if (!/rm\s+-rf\s+\/var\/lib\/apt\/lists/.test(args)) issue(line, 'warn', 'apt-get install should end with "rm -rf /var/lib/apt/lists/*" in the same RUN to keep the layer small.');
            if (!/apt-get update/.test(args)) issue(line, 'info', 'Run "apt-get update && apt-get install" in the same RUN, or installs may use a stale package index from a cached layer.');
          }
          if (/\bpip3? install\b/.test(args) && !args.includes('--no-cache-dir')) issue(line, 'info', 'pip install without --no-cache-dir leaves the wheel cache in the image.');
          if (/(^|&&|;)\s*cd\s/.test(args)) issue(line, 'info', 'Avoid "cd" in RUN — use WORKDIR so the change is visible and persistent.');
        }
        if (keyword === 'ADD' && !/^(https?:|.*\.(tar(\.(gz|bz2|xz))?|tgz|zip)([\s"]|$))/.test(args)) {
          issue(line, 'info', 'Prefer COPY over ADD unless you need URL fetching or automatic archive extraction.');
        }
        if (keyword === 'EXPOSE') {
          for (const port of args.split(/\s+/)) {
            const num = Number(port.split('/')[0]);
            if (!port.startsWith('$') && (!Number.isInteger(num) || num < 1 || num > 65535)) issue(line, 'error', `EXPOSE port "${port}" is not a valid port number.`);
          }
        }
        if ((keyword === 'CMD' || keyword === 'ENTRYPOINT') && !args.startsWith('[')) {
          issue(line, 'info', `${keyword} uses shell form — exec form (JSON array) handles signals like SIGTERM correctly.`);
        }
        if (keyword === 'WORKDIR' && !args.startsWith('/') && !args.startsWith('$')) {
          issue(line, 'info', 'WORKDIR with a relative path depends on previous state — use an absolute path.');
        }
      }
      if (froms.length && !instructions.some(inst => inst.keyword === 'USER')) {
        issue(froms[froms.length - 1].line, 'warn', 'No USER instruction — the container will run as root. Add a non-root user for defense in depth.');
      }
      if (froms.length && !instructions.some(inst => inst.keyword === 'HEALTHCHECK')) {
        issue(froms[froms.length - 1].line, 'info', 'No HEALTHCHECK — orchestrators cannot tell whether the app inside is actually healthy.');
      }
      if (!issues.length) {
        return { output: `✓ No issues found in ${instructions.length} instruction(s). Nicely done.`, status: 'Lint passed.' };
      }
      issues.sort((x, y) => x.line - y.line);
      const icon = { error: '✗', warn: '⚠', info: '•' };
      const output = issues.map(({ line, level, message }) => `${icon[level]} line ${String(line).padStart(3)} [${level}]  ${message}`).join('\n');
      const counts = ['error', 'warn', 'info'].map(l => [l, issues.filter(i => i.level === l).length]).filter(([, n]) => n);
      return { output, status: counts.map(([l, n]) => `${n} ${l}`).join(', ') + ` across ${instructions.length} instruction(s).` };
    },

    'compose-validator'(value) {
      const source = requireInput(value, 'Paste a docker-compose.yml / compose.yaml file.');
      let doc;
      try { doc = yamlParse(source); } catch (e) { throw new Error('Not parseable as YAML — ' + e.message); }
      if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('A Compose file must be a YAML mapping at the top level.');
      const errors = [], warnings = [];
      if ('version' in doc) warnings.push(`Top-level "version: ${doc.version}" is obsolete in the Compose Specification — you can remove it.`);
      const services = doc.services;
      if (!services || typeof services !== 'object' || Array.isArray(services)) {
        errors.push('Missing or invalid top-level "services" mapping.');
      } else if (!Object.keys(services).length) {
        errors.push('"services" is empty — define at least one service.');
      } else {
        const names = Object.keys(services);
        const containerNames = new Map();
        const namedVolumes = doc.volumes && typeof doc.volumes === 'object' ? Object.keys(doc.volumes) : [];
        const namedNetworks = doc.networks && typeof doc.networks === 'object' ? Object.keys(doc.networks) : [];
        for (const [name, svc] of Object.entries(services)) {
          const where = `services.${name}`;
          if (svc === null || typeof svc !== 'object' || Array.isArray(svc)) {
            errors.push(`${where} must be a mapping.`);
            continue;
          }
          if (!svc.image && !svc.build) errors.push(`${where} needs either "image" or "build".`);
          if (typeof svc.image === 'string' && !svc.image.startsWith('$') && !svc.image.includes(':') && !svc.image.includes('@')) {
            warnings.push(`${where}.image "${svc.image}" has no tag — it defaults to :latest.`);
          }
          if (svc.container_name) {
            if (containerNames.has(svc.container_name)) errors.push(`container_name "${svc.container_name}" is used by both "${containerNames.get(svc.container_name)}" and "${name}".`);
            containerNames.set(svc.container_name, name);
          }
          if (svc.ports !== undefined) {
            if (!Array.isArray(svc.ports)) errors.push(`${where}.ports must be a list.`);
            else {
              const isPort = s => /^\d+(-\d+)?$/.test(s);
              const isIp = s => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
              svc.ports.forEach((p, i) => {
                if (typeof p === 'number') return;
                if (typeof p === 'object' && p !== null) return; // long syntax
                if (typeof p !== 'string') {
                  errors.push(`${where}.ports[${i}] must be a string, number, or long-syntax mapping.`);
                  return;
                }
                if (p.includes('$')) return; // contains a variable; skip validation
                const segments = p.replace(/\/(tcp|udp)$/, '').split(':');
                const valid = (segments.length === 1 && isPort(segments[0]))
                  || (segments.length === 2 && isPort(segments[0]) && isPort(segments[1]))
                  || (segments.length === 3 && isIp(segments[0]) && isPort(segments[1]) && isPort(segments[2]));
                if (!valid) {
                  errors.push(`${where}.ports[${i}] "${p}" is not a valid port mapping (expected "[IP:]HOST:CONTAINER" or "CONTAINER").`);
                }
              });
            }
          }
          if (svc.environment !== undefined) {
            if (Array.isArray(svc.environment)) {
              svc.environment.forEach((e, i) => {
                if (typeof e !== 'string' || (!e.includes('=') && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(e))) {
                  errors.push(`${where}.environment[${i}] should look like "KEY=value" (or "KEY" to pass through).`);
                }
              });
            } else if (typeof svc.environment !== 'object' || svc.environment === null) {
              errors.push(`${where}.environment must be a list or a mapping.`);
            }
          }
          if (svc.depends_on !== undefined) {
            const deps = Array.isArray(svc.depends_on) ? svc.depends_on
              : (svc.depends_on && typeof svc.depends_on === 'object' ? Object.keys(svc.depends_on) : null);
            if (deps === null) errors.push(`${where}.depends_on must be a list or a mapping.`);
            else for (const dep of deps) {
              if (!names.includes(dep)) errors.push(`${where}.depends_on references unknown service "${dep}".`);
            }
          }
          if (svc.restart !== undefined && !/^(no|always|unless-stopped|on-failure(:\d+)?)$/.test(String(svc.restart))) {
            warnings.push(`${where}.restart "${svc.restart}" is not one of: no, always, unless-stopped, on-failure[:N]. (YAML tip: quote "no".)`);
          }
          if (svc.privileged === true) warnings.push(`${where} is privileged — it has full access to the host. Avoid unless strictly needed.`);
          if (Array.isArray(svc.volumes)) {
            svc.volumes.forEach((v, i) => {
              if (typeof v !== 'string') return;
              const src = v.split(':')[0];
              if (src && !src.startsWith('.') && !src.startsWith('/') && !src.startsWith('$') && !src.startsWith('~') && v.includes(':')) {
                if (!namedVolumes.includes(src)) warnings.push(`${where}.volumes[${i}] uses named volume "${src}" which is not declared under top-level "volumes".`);
              }
            });
          }
          if (Array.isArray(svc.networks)) {
            for (const net of svc.networks) {
              if (typeof net === 'string' && net !== 'default' && !namedNetworks.includes(net)) {
                warnings.push(`${where}.networks references "${net}" which is not declared under top-level "networks".`);
              }
            }
          }
        }
      }
      const lines = [];
      if (errors.length) lines.push(`Errors (${errors.length}):`, ...errors.map(e => '  ✗ ' + e));
      if (warnings.length) lines.push(`${errors.length ? '\n' : ''}Warnings (${warnings.length}):`, ...warnings.map(w => '  ⚠ ' + w));
      if (!errors.length && !warnings.length) {
        const count = Object.keys(doc.services).length;
        return { output: `✓ Structure looks valid — ${count} service(s) defined, no issues found.`, status: 'Validation passed.' };
      }
      return {
        output: lines.join('\n'),
        status: errors.length ? `${errors.length} error(s), ${warnings.length} warning(s).` : `Valid with ${warnings.length} warning(s).`
      };
    },

    'cron-builder'(value) {
      let expr = requireInput(value, 'Enter a cron expression, e.g. */15 9-17 * * MON-FRI').split('\n')[0].trim();
      const notes = [];
      if (expr.startsWith('@')) {
        if (expr === '@reboot') {
          return { output: '@reboot runs once at daemon startup — it has no schedule to expand.', status: 'Macro explained.' };
        }
        if (!(expr in CRON_MACROS)) throw new Error(`Unknown macro "${expr}". Known: ${Object.keys(CRON_MACROS).join(', ')}, @reboot.`);
        notes.push(`Macro ${expr} expands to "${CRON_MACROS[expr]}".`);
        expr = CRON_MACROS[expr];
      }
      const fields = expr.split(/\s+/);
      if (fields.length !== 5) throw new Error(`Expected 5 fields (minute hour day-of-month month day-of-week), got ${fields.length}.`);
      const [minRaw, hourRaw, domRaw, monRaw, dowRaw] = fields;
      const minutes = parseCronField(minRaw, 0, 59, null, 'minute');
      const hours = parseCronField(hourRaw, 0, 23, null, 'hour');
      const doms = parseCronField(domRaw, 1, 31, null, 'day-of-month');
      const months = parseCronField(monRaw, 1, 12, MONTH_NAMES, 'month');
      const dows = parseCronField(dowRaw, 0, 6, DOW_NAMES, 'day-of-week');
      const domAny = domRaw === '*';
      const dowAny = dowRaw === '*';

      const table = alignTable([
        ['Field', 'Value', 'Matches'],
        ['minute', minRaw, describeCronField(minRaw, minutes, 0, 59, null)],
        ['hour', hourRaw, describeCronField(hourRaw, hours, 0, 23, null)],
        ['day of month', domRaw, describeCronField(domRaw, doms, 1, 31, null)],
        ['month', monRaw, describeCronField(monRaw, months, 1, 12, MONTH_NAMES)],
        ['day of week', dowRaw, describeCronField(dowRaw, dows, 0, 6, DOW_NAMES)]
      ]);
      if (!domAny && !dowAny) notes.push('Both day fields are restricted — standard cron runs when EITHER matches.');

      const dayMatches = (d) => {
        if (!months.has(d.getMonth() + 1)) return false;
        const domHit = doms.has(d.getDate());
        const dowHit = dows.has(d.getDay());
        if (domAny && dowAny) return true;
        if (!domAny && !dowAny) return domHit || dowHit;
        return domAny ? dowHit : domHit;
      };
      const sortedHours = [...hours].sort((a, b) => a - b);
      const sortedMinutes = [...minutes].sort((a, b) => a - b);
      const start = new Date();
      start.setSeconds(0, 0);
      start.setMinutes(start.getMinutes() + 1);
      const runs = [];
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const limit = new Date(start.getFullYear() + 4, start.getMonth(), start.getDate());
      while (runs.length < 3 && day < limit) {
        if (dayMatches(day)) {
          outer:
          for (const h of sortedHours) {
            for (const m of sortedMinutes) {
              const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
              if (candidate >= start) {
                runs.push(candidate);
                if (runs.length === 3) break outer;
              }
            }
          }
        }
        day.setDate(day.getDate() + 1);
      }
      const lines = [table, '', 'Next runs (local time):'];
      if (runs.length) lines.push(...runs.map(r => '  ' + r.toString().replace(/ GMT.*$/, '') + `  (${relativeTime(r)})`));
      else lines.push('  (no run within the next 4 years — check the day/month combination)');
      if (notes.length) lines.push('', ...notes.map(n => '• ' + n));
      return { output: lines.join('\n'), status: runs.length ? `Next run ${relativeTime(runs[0])}.` : 'Expression parsed, but no upcoming run found.' };
    },

    'gitignore-builder'(value) {
      const requested = requireInput(value, `Enter stacks separated by commas or spaces. Available: ${Object.keys(GITIGNORE_TEMPLATES).join(', ')}.`)
        .toLowerCase()
        .split(/[\s,]+/)
        .filter(Boolean);
      const aliases = { js: 'node', javascript: 'node', typescript: 'node', ts: 'node', py: 'python', golang: 'go', 'c++': 'cpp', csharp: 'dotnet', 'c#': 'dotnet', mac: 'macos', osx: 'macos', idea: 'jetbrains', intellij: 'jetbrains', dotfiles: 'env' };
      const unknown = [];
      const chosen = [];
      for (const item of requested) {
        const key = GITIGNORE_TEMPLATES[item] ? item : aliases[item];
        if (!key) unknown.push(item);
        else if (!chosen.includes(key)) chosen.push(key);
      }
      if (unknown.length) {
        throw new Error(`Unknown template(s): ${unknown.join(', ')}. Available: ${Object.keys(GITIGNORE_TEMPLATES).join(', ')}.`);
      }
      const sections = chosen.map(key => `# --- ${key} ---\n${GITIGNORE_TEMPLATES[key].join('\n')}`);
      return {
        output: `# .gitignore generated by Dev Toolbox (${chosen.join(' + ')})\n\n${sections.join('\n\n')}\n`,
        status: `Combined ${chosen.length} template(s).`
      };
    },

    'uuid-generator'(value) {
      const count = Math.min(100, Math.max(1, parseInt(value.trim(), 10) || 1));
      const list = Array.from({ length: count }, () => crypto.randomUUID());
      return { output: list.join('\n'), status: `Generated ${count} UUID v4 value(s). Enter a number for more.` };
    },

    'timestamp-converter'(value) {
      const input = value.trim();
      let date;
      let note = '';
      if (!input) {
        date = new Date();
        note = 'No input — showing the current time.';
      } else {
        const numeric = Number(input);
        if (Number.isFinite(numeric) && /^-?\d+(\.\d+)?$/.test(input)) {
          date = new Date(numeric < 1e12 ? numeric * 1000 : numeric);
          note = numeric < 1e12 ? 'Interpreted as Unix seconds.' : 'Interpreted as Unix milliseconds.';
        } else {
          date = new Date(input);
          note = 'Parsed as a date string.';
        }
      }
      if (Number.isNaN(date.getTime())) throw new Error('Enter a Unix timestamp (seconds or ms) or an ISO date like 2026-07-15T12:00:00Z.');
      const rows = [
        ['ISO 8601 (UTC)', date.toISOString()],
        ['UTC', date.toUTCString()],
        ['Local', date.toString()],
        ['Unix seconds', String(Math.floor(date.getTime() / 1000))],
        ['Unix milliseconds', String(date.getTime())],
        ['Relative', relativeTime(date)]
      ];
      return { output: alignTable(rows) + (note ? `\n\n• ${note}` : ''), status: 'Converted.' };
    },

    'random-string'(value) {
      const charsets = {
        alnum: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
        hex: '0123456789abcdef',
        url: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_~',
        ascii: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,-./:;<=>?@[]^_{|}~',
        digits: '0123456789'
      };
      let length = 32;
      let charsetName = 'alnum';
      for (const token of value.toLowerCase().split(/[\s,]+/).filter(Boolean)) {
        if (/^\d+$/.test(token)) length = Number(token);
        else if (charsets[token]) charsetName = token;
        else throw new Error(`Unknown option "${token}". Use a length (4-256) and optionally a charset: ${Object.keys(charsets).join(', ')}.`);
      }
      if (length < 4 || length > 256) throw new Error('Length must be between 4 and 256.');
      const charset = charsets[charsetName];
      // Rejection sampling for an unbiased pick from the charset.
      const threshold = 256 - (256 % charset.length);
      let result = '';
      while (result.length < length) {
        const batch = crypto.getRandomValues(new Uint8Array(length * 2));
        for (const byte of batch) {
          if (byte < threshold && result.length < length) result += charset[byte % charset.length];
        }
      }
      const bits = (length * Math.log2(charset.length)).toFixed(0);
      return { output: result, status: `${length} characters from the ${charsetName} charset (~${bits} bits of entropy).` };
    },

    'qr-generator'(value) {
      const input = requireInput(value, 'Enter text or a URL to encode (up to ~210 bytes).');
      const { modules, version, size } = QR.encodeText(input);
      return {
        output: QR.toHalfBlocks(modules),
        format: 'qr',
        status: `QR version ${version} (${size}×${size} modules). Scans best on the light theme; most phone cameras also read the inverted dark-theme rendering.`
      };
    }
  };

  // ---------------------------------------------------------------- examples & placeholders

  const examples = {
    'json-formatter': '{"name":"dev-toolbox","private":true,"tools":24,"tags":["json","jwt","uuid"],"nested":{"works":true}}',
    'yaml-converter': 'service: dev-toolbox\nreplicas: 3\nports:\n  - 8080\n  - 8443\nresources:\n  limits:\n    cpu: 500m\n    memory: 256Mi\nfeatures:\n  darkMode: true\n  telemetry: null',
    'csv-viewer': 'name,role,team,location\nAda Lovelace,Engineer,Compilers,"London, UK"\nGrace Hopper,Rear Admiral,Languages,Arlington\nKatherine Johnson,Analyst,Trajectories,Hampton',
    'json-diff': '{"name":"api","version":"1.2.0","deps":{"express":"4.18.2","zod":"3.22.0"},"private":true}\n---\n{"name":"api","version":"1.3.0","deps":{"express":"4.19.0","pino":"9.0.0"},"license":"MIT"}',
    'jwt-decoder': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkRldiBUb29sYm94IiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE4OTM0NTYwMDB9.sig-not-verified',
    'hash-generator': 'The quick brown fox jumps over the lazy dog',
    'csp-builder': '# Extend the strict baseline (directive + extra sources per line):\nscript-src https://cdn.example.com\nimg-src https://images.example.com\nconnect-src https://api.example.com wss://live.example.com',
    'password-entropy': 'correct horse battery staple',
    'cidr-calculator': '192.168.1.128/27',
    'url-parser': 'https://user@api.example.com:8443/v1/search?q=dev+tools&page=2&sort=stars#results',
    'http-headers': 'GET /api/v1/users HTTP/1.1\nHost: api.example.com\nAuthorization: Bearer eyJhbGciOi…\nAccept: application/json\nAccept-Encoding: gzip, br\nCache-Control: no-cache\nUser-Agent: curl/8.5.0\nX-Request-Id: 7f3a2c\nX-Custom-Trace: abc123',
    'dns-lookup': 'example.com A',
    'regex-tester': '/(?<user>[\\w.+-]+)@(?<host>[\\w-]+\\.[\\w.-]+)/g\nContact alice@example.com or bob.smith@mail.test.org.\nInvalid: charlie@nope, dora@@double.com',
    'case-converter': 'user profile settings',
    'text-diff': 'server:\n  port: 8080\n  workers: 4\nlogging: info\n---\nserver:\n  port: 9090\n  workers: 4\n  timeout: 30s\nlogging: debug',
    'slug-generator': 'Hello, World! — Dev Toolbox 2.0 (Beta)',
    'docker-linter': 'FROM node\nMAINTAINER someone@example.com\nWORKDIR app\nCOPY . .\nRUN apt-get update && apt-get install curl\nRUN cd /tmp && echo done\nEXPOSE 8080\nCMD npm start',
    'compose-validator': 'services:\n  web:\n    image: nginx:1.27-alpine\n    ports:\n      - "8080:80"\n    depends_on:\n      - api\n    volumes:\n      - site-data:/usr/share/nginx/html\n  api:\n    build: ./api\n    environment:\n      - NODE_ENV=production\n    restart: unless-stopped\nvolumes:\n  site-data:',
    'cron-builder': '*/15 9-17 * * MON-FRI',
    'gitignore-builder': 'node, python, macos, vscode, env',
    'uuid-generator': '5',
    'timestamp-converter': '1721044800',
    'random-string': '32 alnum',
    'qr-generator': 'https://example.com/dev-toolbox'
  };

  const placeholders = {
    'json-formatter': 'Paste JSON to pretty-print and validate…',
    'yaml-converter': 'Paste YAML to get JSON, or JSON to get YAML…',
    'csv-viewer': 'Paste CSV, TSV, or semicolon-separated data…',
    'json-diff': 'First JSON document, a line with only ---, then the second document…',
    'jwt-decoder': 'Paste a JWT: header.payload.signature…',
    'hash-generator': 'Text to hash — or key, a line with only ---, then the message (HMAC)…',
    'csp-builder': 'Optional: one "directive extra-sources" per line to extend the strict baseline…',
    'password-entropy': 'Type a password or passphrase (it never leaves this page)…',
    'cidr-calculator': 'CIDR notation, e.g. 10.0.0.0/16…',
    'url-parser': 'Paste a URL to break into components…',
    'http-headers': 'Paste raw HTTP headers, one per line…',
    'dns-lookup': 'domain.tld, optionally followed by a type: example.com MX…',
    'regex-tester': 'Line 1: /pattern/flags — following lines: text to test…',
    'case-converter': 'A phrase or identifier, e.g. userProfileSettings…',
    'text-diff': 'Original text, a line with only ---, then the changed text…',
    'slug-generator': 'A title to convert into a URL-safe slug…',
    'docker-linter': 'Paste a Dockerfile…',
    'compose-validator': 'Paste a docker-compose.yml…',
    'cron-builder': 'A 5-field cron expression, e.g. 0 3 * * SUN — or a macro like @daily…',
    'gitignore-builder': 'Stacks to combine, e.g. node, python, macos…',
    'uuid-generator': 'How many UUIDs? (1-100, default 1)',
    'timestamp-converter': 'Unix seconds/milliseconds or an ISO date — empty for “now”…',
    'random-string': 'Length and charset, e.g. "48 hex" (alnum, hex, url, ascii, digits)…',
    'qr-generator': 'Text or URL to encode as a QR code…'
  };

  const ToolKit = {
    runners, examples, placeholders, yamlParse, yamlStringify,
    // Shared helpers for the add-on tool packs (tools-encode.js, tools-web.js).
    helpers: { splitTwo, requireInput, alignTable, truncate, pad, humanDuration, relativeTime, parseCSV, detectDelimiter, bytesToHex, decodeBase64Url, SEPARATOR }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = ToolKit;
  else global.ToolKit = ToolKit;
})(typeof window !== 'undefined' ? window : globalThis);
