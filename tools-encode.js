/*
 * Tool pack: encoding, numbers, text, and shell utilities.
 * Registers into the ToolKit created by tools.js (load after it).
 * Also upgrades two core tools: hash-generator gains MD5 + CRC32,
 * uuid-generator gains v7 generation and UUID inspection.
 */
(function (global) {
  'use strict';

  const ToolKit = typeof module !== 'undefined' && module.exports
    ? require('./tools.js')
    : global.ToolKit;
  const { splitTwo, requireInput, alignTable, truncate, relativeTime, bytesToHex, SEPARATOR } = ToolKit.helpers;

  const encodeUtf8 = text => new TextEncoder().encode(text);
  const decodeUtf8 = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

  // ---------------------------------------------------------------- MD5 (not in WebCrypto)

  function md5Hex(bytes) {
    const K = new Int32Array(64);
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
    const S = [
      7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
      6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
    ];
    const len = bytes.length;
    const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6);
    padded.set(bytes);
    padded[len] = 0x80;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, (len << 3) >>> 0, true);
    dv.setUint32(padded.length - 4, Math.floor(len / 536870912), true);
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const rotl = (x, c) => (x << c) | (x >>> (32 - c));
    for (let off = 0; off < padded.length; off += 64) {
      const M = new Int32Array(16);
      for (let j = 0; j < 16; j++) M[j] = dv.getUint32(off + j * 4, true);
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        F = (F + A + K[i] + M[g]) | 0;
        A = D; D = C; C = B;
        B = (B + rotl(F, S[i])) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    const out = new Uint8Array(16);
    const odv = new DataView(out.buffer);
    odv.setUint32(0, a0 >>> 0, true);
    odv.setUint32(4, b0 >>> 0, true);
    odv.setUint32(8, c0 >>> 0, true);
    odv.setUint32(12, d0 >>> 0, true);
    return bytesToHex(out.buffer);
  }

  // ---------------------------------------------------------------- CRC32

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32Hex(bytes) {
    let c = 0xFFFFFFFF;
    for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
    return ((c ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0');
  }

  // ---------------------------------------------------------------- Punycode (RFC 3492)

  const PUNY = { base: 36, tmin: 1, tmax: 26, skew: 38, damp: 700, initialBias: 72, initialN: 128 };

  function punyAdapt(delta, numPoints, firstTime) {
    delta = firstTime ? Math.floor(delta / PUNY.damp) : delta >> 1;
    delta += Math.floor(delta / numPoints);
    let k = 0;
    while (delta > ((PUNY.base - PUNY.tmin) * PUNY.tmax) >> 1) {
      delta = Math.floor(delta / (PUNY.base - PUNY.tmin));
      k += PUNY.base;
    }
    return k + Math.floor(((PUNY.base - PUNY.tmin + 1) * delta) / (delta + PUNY.skew));
  }

  function punyEncodeLabel(label) {
    const input = [...label].map(c => c.codePointAt(0));
    const digitChar = d => String.fromCharCode(d < 26 ? 97 + d : 22 + d);
    const output = input.filter(cp => cp < 128).map(cp => String.fromCharCode(cp));
    const basicLength = output.length;
    if (basicLength) output.push('-');
    let n = PUNY.initialN, delta = 0, bias = PUNY.initialBias, handled = basicLength;
    while (handled < input.length) {
      let m = Infinity;
      for (const cp of input) if (cp >= n && cp < m) m = cp;
      delta += (m - n) * (handled + 1);
      n = m;
      for (const cp of input) {
        if (cp < n) delta++;
        if (cp === n) {
          let q = delta;
          for (let k = PUNY.base; ; k += PUNY.base) {
            const t = k <= bias ? PUNY.tmin : (k >= bias + PUNY.tmax ? PUNY.tmax : k - bias);
            if (q < t) break;
            output.push(digitChar(t + ((q - t) % (PUNY.base - t))));
            q = Math.floor((q - t) / (PUNY.base - t));
          }
          output.push(digitChar(q));
          bias = punyAdapt(delta, handled + 1, handled === basicLength);
          delta = 0;
          handled++;
        }
      }
      delta++;
      n++;
    }
    return output.join('');
  }

  function punyDecodeLabel(text) {
    const output = [];
    const lastDelim = text.lastIndexOf('-');
    if (lastDelim > 0) {
      for (const c of text.slice(0, lastDelim)) {
        if (c.charCodeAt(0) >= 128) throw new Error('Punycode label contains a non-ASCII basic code point.');
        output.push(c.charCodeAt(0));
      }
    }
    let pos = lastDelim > 0 ? lastDelim + 1 : 0;
    let n = PUNY.initialN, bias = PUNY.initialBias, idx = 0;
    while (pos < text.length) {
      const oldIdx = idx;
      let w = 1;
      for (let k = PUNY.base; ; k += PUNY.base) {
        if (pos >= text.length) throw new Error('Punycode string ended unexpectedly.');
        const c = text.charCodeAt(pos++);
        const digit = c - 48 < 10 ? c - 22 : (c - 65 < 26 ? c - 65 : (c - 97 < 26 ? c - 97 : PUNY.base));
        if (digit >= PUNY.base) throw new Error(`"${text[pos - 1]}" is not a valid punycode digit.`);
        idx += digit * w;
        const t = k <= bias ? PUNY.tmin : (k >= bias + PUNY.tmax ? PUNY.tmax : k - bias);
        if (digit < t) break;
        w *= PUNY.base - t;
      }
      bias = punyAdapt(idx - oldIdx, output.length + 1, oldIdx === 0);
      n += Math.floor(idx / (output.length + 1));
      idx %= output.length + 1;
      output.splice(idx, 0, n);
      idx++;
    }
    return String.fromCodePoint(...output);
  }

  // ---------------------------------------------------------------- tables

  const MORSE = {
    A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..',
    J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.',
    S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
    0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....',
    7: '--...', 8: '---..', 9: '----.',
    '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--', '/': '-..-.',
    '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-',
    '+': '.-.-.', '-': '-....-', '_': '..--.-', '"': '.-..-.', '$': '...-..-', '@': '.--.-.'
  };
  const MORSE_REVERSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

  const NAMED_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®',
    trade: '™', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’',
    ldquo: '“', rdquo: '”', bull: '•', middot: '·', sect: '§', para: '¶',
    dagger: '†', deg: '°', plusmn: '±', times: '×', divide: '÷', frac12: '½', frac14: '¼',
    sup2: '²', sup3: '³', micro: 'µ', laquo: '«', raquo: '»', iexcl: '¡', iquest: '¿',
    szlig: 'ß', agrave: 'à', aacute: 'á', acirc: 'â', auml: 'ä', ccedil: 'ç', egrave: 'è',
    eacute: 'é', ecirc: 'ê', euml: 'ë', iuml: 'ï', ntilde: 'ñ', ouml: 'ö', ocirc: 'ô',
    uuml: 'ü', ugrave: 'ù', larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔',
    euro: '€', pound: '£', yen: '¥', cent: '¢', infin: '∞', ne: '≠', le: '≤', ge: '≥',
    asymp: '≈', radic: '√', sum: '∑', prod: '∏', pi: 'π', alpha: 'α', beta: 'β',
    gamma: 'γ', delta: 'δ', lambda: 'λ', mu: 'μ', sigma: 'σ', omega: 'ω', check: '✓'
  };
  const ENTITY_FOR_CHAR = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  const CONTROL_NAMES = [
    'NUL null', 'SOH start of heading', 'STX start of text', 'ETX end of text', 'EOT end of transmission',
    'ENQ enquiry', 'ACK acknowledge', 'BEL bell', 'BS backspace', 'HT horizontal tab', 'LF line feed',
    'VT vertical tab', 'FF form feed', 'CR carriage return', 'SO shift out', 'SI shift in',
    'DLE data link escape', 'DC1 device control 1 (XON)', 'DC2 device control 2', 'DC3 device control 3 (XOFF)',
    'DC4 device control 4', 'NAK negative acknowledge', 'SYN synchronous idle', 'ETB end of block',
    'CAN cancel', 'EM end of medium', 'SUB substitute', 'ESC escape', 'FS file separator',
    'GS group separator', 'RS record separator', 'US unit separator'
  ];

  const PASSPHRASE_WORDS = ('acid acorn actor alarm album alien alley amber anchor angle ankle apple apron arrow aspen atlas attic autumn axis bacon badge bagel banjo barn basil beach beacon beak bean bear beet bell belt bench berry bike birch bird bison blade blaze bloom blue board boat bolt bone book boot bounce bow bowl box brick bridge brook broom brush bucket bud bugle bulb bull bunny bus cabin cable cactus cake camel camp canal candle canoe cape card cargo carrot cart castle cat cave cedar cello chair chalk cheese cherry chess chief chime cider circle city claim clam clap clay cliff clock cloud clover coal coast cobalt cocoa coin comet cone coral cork corn couch cove crab crane crate creek crew crow crown cube cup curb curl cyan daisy dance dart dawn deer delta denim depot desk dew dice dime dish dock dome donut door dove dragon drift drum duck dune dusk eagle earth easel echo eel elbow elder elk elm ember engine fable falcon fang farm fawn feast fence fern ferry field fig finch fire fjord flag flame flask fleet flint flock flour flute foam fog forge fort fox frame frost fruit gala garden gate gear gecko gem geyser gift ginger glacier glade glass glen globe glove gold goose gorge grain grape grass grove guitar gull gust habit hall harbor hare harp hatch hawk hazel heron hill hive holly honey hood hoof hook horn horse hut ice inlet iris iron island ivory ivy jade jazz jeep jelly jewel judge juice jungle keel kelp kettle key kite kiwi knee knot koala lace lake lamp lance lark latch laurel lava leaf ledge lemon lens level lever lilac lily lime linen lion lodge loft log loom lotus lunar lynx').split(' ');

  // ---------------------------------------------------------------- small helpers

  function looksLikeBase64(text) {
    const compact = text.replace(/\s+/g, '');
    return compact.length >= 4
      && compact.length % 4 === 0
      && /^[A-Za-z0-9+/_-]+={0,2}$/.test(compact);
  }

  function tryDecodeUtf8(bytes) {
    try {
      const text = decodeUtf8(bytes);
      const controls = [...text].filter(c => c.charCodeAt(0) < 32 && !'\n\r\t'.includes(c)).length;
      return controls / Math.max(1, text.length) < 0.05 ? text : null;
    } catch (e) {
      return null;
    }
  }

  function hexDumpText(bytes, cap = 4096) {
    const lines = [];
    const shown = bytes.slice(0, cap);
    for (let off = 0; off < shown.length; off += 16) {
      const chunk = shown.slice(off, off + 16);
      const hexParts = [...chunk].map(b => b.toString(16).padStart(2, '0'));
      const hex = (hexParts.slice(0, 8).join(' ') + '  ' + hexParts.slice(8).join(' ')).trimEnd().padEnd(49);
      const ascii = [...chunk].map(b => (b >= 32 && b < 127 ? String.fromCharCode(b) : '·')).join('');
      lines.push(`${off.toString(16).padStart(8, '0')}  ${hex} |${ascii}|`);
    }
    if (bytes.length > cap) lines.push(`… ${bytes.length - cap} more byte(s) not shown`);
    return lines.join('\n');
  }

  function randomPick(list) {
    const threshold = 65536 - (65536 % list.length);
    for (;;) {
      const [v] = crypto.getRandomValues(new Uint16Array(1));
      if (v < threshold) return list[v % list.length];
    }
  }

  // ---------------------------------------------------------------- runners

  const runners = {

    'base64'(value) {
      const input = requireInput(value, 'Enter text to encode, or base64 to decode.');
      if (looksLikeBase64(input)) {
        const normalized = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
        try {
          const bytes = Uint8Array.from(atob(normalized), c => c.charCodeAt(0));
          const text = tryDecodeUtf8(bytes);
          if (text !== null) {
            return { output: text, status: `Decoded ${bytes.length} byte(s) of base64.` };
          }
          return {
            output: 'Decoded to binary (not UTF-8 text). Hex dump:\n\n' + hexDumpText(bytes),
            status: `Decoded ${bytes.length} byte(s) of binary data.`
          };
        } catch (e) { /* fall through to encoding */ }
      }
      const bytes = encodeUtf8(input);
      let binary = '';
      for (const b of bytes) binary += String.fromCharCode(b);
      return { output: btoa(binary), status: `Encoded ${bytes.length} byte(s) to base64.` };
    },

    'url-encode'(value) {
      const input = requireInput(value, 'Enter text to percent-encode, or an encoded string to decode.');
      if (/%[0-9A-Fa-f]{2}/.test(input) || /\+/.test(input) && !/[ ]/.test(input) && /=/.test(input)) {
        try {
          const decoded = decodeURIComponent(input.replace(/\+/g, '%20'));
          return { output: decoded, status: 'Percent-decoded.' };
        } catch (e) {
          throw new Error('Contains a malformed %-sequence: ' + e.message);
        }
      }
      return {
        output: [
          'encodeURIComponent (query values):',
          encodeURIComponent(input),
          '',
          'encodeURI (whole URLs — keeps :/?#&=):',
          encodeURI(input)
        ].join('\n'),
        status: 'Percent-encoded both ways.'
      };
    },

    'html-entities'(value) {
      const input = requireInput(value, 'Enter text or HTML entities.');
      if (/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,30});/.test(input)) {
        let unknown = 0;
        const decoded = input.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,30});/g, (match, body) => {
          if (body[0] === '#') {
            const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
          }
          if (body.toLowerCase() in NAMED_ENTITIES) return NAMED_ENTITIES[body.toLowerCase()];
          unknown++;
          return match;
        });
        return {
          output: decoded,
          status: unknown ? `Decoded (left ${unknown} unrecognized entit${unknown === 1 ? 'y' : 'ies'} as-is).` : 'Entities decoded.'
        };
      }
      const charToName = Object.fromEntries(Object.entries(NAMED_ENTITIES).map(([k, v]) => [v, k]));
      const encoded = [...input].map(c => {
        if (ENTITY_FOR_CHAR[c]) return ENTITY_FOR_CHAR[c];
        const cp = c.codePointAt(0);
        if (cp < 128) return c;
        if (charToName[c]) return `&${charToName[c]};`;
        return `&#${cp};`;
      }).join('');
      return { output: encoded, status: 'Encoded for safe HTML.' };
    },

    'unicode-escape'(value) {
      const input = requireInput(value, 'Enter text to escape, or a string with \\u escapes to decode.');
      if (/\\u\{?[0-9a-fA-F]/.test(input)) {
        const decoded = input.replace(/\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})/g,
          (match, braced, four, two) => String.fromCodePoint(parseInt(braced ?? four ?? two, 16)));
        return { output: decoded, status: 'Escapes decoded.' };
      }
      let js = '', css = '';
      for (const c of input) {
        const cp = c.codePointAt(0);
        if (cp >= 32 && cp < 127) {
          js += c;
          css += c;
        } else {
          js += cp > 0xFFFF
            ? `\\u{${cp.toString(16)}}`
            : `\\u${cp.toString(16).padStart(4, '0')}`;
          css += `\\${cp.toString(16).toUpperCase()} `;
        }
      }
      return {
        output: `JavaScript:\n${js}\n\nCSS:\n${css.trimEnd()}`,
        status: 'Non-ASCII characters escaped.'
      };
    },

    'hex-text'(value) {
      const input = requireInput(value, 'Enter text to hex-encode, or hex bytes to decode.');
      const compact = input.replace(/(0x|[\s,])/g, '');
      if (/^[0-9a-fA-F]+$/.test(compact) && compact.length % 2 === 0 && compact.length >= 2) {
        const bytes = new Uint8Array(compact.length / 2);
        for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(compact.slice(i * 2, i * 2 + 2), 16);
        const text = tryDecodeUtf8(bytes);
        if (text !== null) return { output: text, status: `Decoded ${bytes.length} byte(s) of hex.` };
        return { output: hexDumpText(bytes), status: 'Decoded to binary (not UTF-8) — showing a dump.' };
      }
      const bytes = encodeUtf8(input);
      return {
        output: bytesToHex(bytes.buffer),
        status: `Encoded ${bytes.length} byte(s) as hex.`
      };
    },

    'binary-text'(value) {
      const input = requireInput(value, 'Enter text, or space-separated binary bytes to decode.');
      const compact = input.replace(/\s+/g, '');
      if (/^[01]+$/.test(compact) && compact.length % 8 === 0) {
        const bytes = new Uint8Array(compact.length / 8);
        for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(compact.slice(i * 8, i * 8 + 8), 2);
        const text = tryDecodeUtf8(bytes);
        if (text !== null) return { output: text, status: `Decoded ${bytes.length} byte(s) of binary.` };
        return { output: hexDumpText(bytes), status: 'Decoded to non-text bytes — showing a dump.' };
      }
      const bytes = encodeUtf8(input);
      return {
        output: [...bytes].map(b => b.toString(2).padStart(8, '0')).join(' '),
        status: `Encoded ${bytes.length} byte(s) as binary.`
      };
    },

    'rot13'(value) {
      const input = requireInput(value, 'Enter text — ROT13 is its own inverse.');
      const output = input.replace(/[a-zA-Z]/g, c => {
        const base = c <= 'Z' ? 65 : 97;
        return String.fromCharCode((c.charCodeAt(0) - base + 13) % 26 + base);
      });
      return { output, status: 'Rotated 13 places (run again to undo).' };
    },

    'morse-code'(value) {
      const input = requireInput(value, 'Enter text, or morse code (dots, dashes, / between words).');
      if (/^[.\-\s/]+$/.test(input)) {
        const words = input.trim().split(/\s*\/\s*|\s{3,}/);
        let unknown = 0;
        const text = words.map(word =>
          word.trim().split(/\s+/).map(code => {
            if (code === '') return '';
            if (MORSE_REVERSE[code]) return MORSE_REVERSE[code];
            unknown++;
            return '�';
          }).join('')
        ).join(' ');
        return {
          output: text,
          status: unknown ? `Decoded with ${unknown} unrecognized group(s).` : 'Morse decoded.'
        };
      }
      let skipped = 0;
      const code = input.toUpperCase().split(/\s+/).map(word =>
        [...word].map(c => {
          if (MORSE[c]) return MORSE[c];
          skipped++;
          return null;
        }).filter(Boolean).join(' ')
      ).filter(Boolean).join(' / ');
      if (!code) throw new Error('None of those characters have morse equivalents.');
      return {
        output: code,
        status: skipped ? `Encoded (skipped ${skipped} unsupported character(s)).` : 'Encoded to morse.'
      };
    },

    'punycode'(value) {
      const domain = requireInput(value, 'Enter a domain name — Unicode or xn-- form.')
        .split('\n')[0].trim().toLowerCase().replace(/\.$/, '');
      if (!domain || /\s/.test(domain)) throw new Error('Enter a single domain name.');
      const labels = domain.split('.');
      const hasPuny = labels.some(l => l.startsWith('xn--'));
      const rows = [];
      let result;
      if (hasPuny) {
        result = labels.map(label => {
          if (!label.startsWith('xn--')) return label;
          const decoded = punyDecodeLabel(label.slice(4));
          rows.push([label, '→', decoded]);
          return decoded;
        }).join('.');
      } else {
        result = labels.map(label => {
          if (!/[^\x00-\x7f]/.test(label)) return label;
          const encoded = 'xn--' + punyEncodeLabel(label);
          rows.push([label, '→', encoded]);
          return encoded;
        }).join('.');
      }
      if (!rows.length) {
        return { output: domain + '\n\nAll labels are plain ASCII — nothing to convert.', status: 'No conversion needed.' };
      }
      return {
        output: [result, '', 'Converted labels:', alignTable(rows)].join('\n'),
        status: hasPuny ? 'Punycode → Unicode.' : 'Unicode → punycode (IDNA, simplified mapping).'
      };
    },

    'quoted-printable'(value) {
      const input = requireInput(value, 'Enter text to encode, or quoted-printable (=XX) to decode.');
      if (/=[0-9A-F]{2}/.test(input) || /=\r?\n/.test(input)) {
        const joined = input.replace(/=\r?\n/g, '');
        const bytes = [];
        for (let i = 0; i < joined.length; i++) {
          if (joined[i] === '=' && /[0-9A-Fa-f]{2}/.test(joined.slice(i + 1, i + 3))) {
            bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
            i += 2;
          } else {
            bytes.push(joined.charCodeAt(i));
          }
        }
        const text = tryDecodeUtf8(new Uint8Array(bytes));
        if (text === null) throw new Error('Decoded bytes are not valid UTF-8 text.');
        return { output: text, status: 'Quoted-printable decoded.' };
      }
      const bytes = encodeUtf8(input);
      let encoded = '';
      for (const b of bytes) {
        const c = String.fromCharCode(b);
        if ((b >= 33 && b <= 126 && b !== 61) || b === 32 || b === 9) encoded += c;
        else if (b === 10) encoded += '\n';
        else encoded += '=' + b.toString(16).toUpperCase().padStart(2, '0');
      }
      const wrapped = encoded.split('\n').map(line => {
        const parts = [];
        while (line.length > 75) {
          parts.push(line.slice(0, 75) + '=');
          line = line.slice(75);
        }
        parts.push(line);
        return parts.join('\n');
      }).join('\n');
      return { output: wrapped, status: 'Encoded as quoted-printable (76-column soft wraps).' };
    },

    'utf8-inspector'(value) {
      if (!value) throw new Error('Enter text to inspect.');
      const chars = [...value].slice(0, 200);
      const rows = [['CHAR', 'CODE POINT', 'DEC', 'UTF-8 BYTES', 'UTF-16 UNITS']];
      for (const c of chars) {
        const cp = c.codePointAt(0);
        const utf8 = [...encodeUtf8(c)].map(b => b.toString(16).padStart(2, '0')).join(' ');
        const utf16 = [...c].length && Array.from({ length: c.length }, (_, i) => c.charCodeAt(i).toString(16).padStart(4, '0')).join(' ');
        const shown = cp < 33 ? `⟨${cp === 10 ? 'LF' : cp === 13 ? 'CR' : cp === 9 ? 'TAB' : cp}⟩` : c;
        rows.push([shown, 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'), cp, utf8, utf16]);
      }
      const total = [...value];
      const summary = `${total.length} code point(s) · ${encodeUtf8(value).length} UTF-8 byte(s) · ${value.length} UTF-16 unit(s)`;
      return {
        output: alignTable(rows) + (total.length > 200 ? `\n… first 200 of ${total.length} code points shown` : '') + '\n\n' + summary,
        status: summary
      };
    },

    'hex-dump'(value) {
      const input = requireInput(value, 'Enter text to dump as hex bytes.');
      const bytes = encodeUtf8(input);
      return { output: hexDumpText(bytes), status: `${bytes.length} byte(s) of UTF-8.` };
    },

    'ascii-table'(value) {
      const query = value.trim().toLowerCase();
      const rows = [['DEC', 'HEX', 'CHAR', 'NAME']];
      for (let code = 0; code < 128; code++) {
        const name = code < 32 ? CONTROL_NAMES[code] : code === 127 ? 'DEL delete' : '';
        const char = code < 33 || code === 127 ? '' : String.fromCharCode(code);
        const hay = `${code} 0x${code.toString(16)} ${char} ${name}`.toLowerCase();
        if (query && !hay.includes(query)) continue;
        rows.push([code, '0x' + code.toString(16).padStart(2, '0'), char, name]);
      }
      if (rows.length === 1) throw new Error(`Nothing in the ASCII table matches "${value.trim()}".`);
      return {
        output: alignTable(rows),
        status: query ? `${rows.length - 1} matching row(s).` : 'ASCII 0–127. Type in the input to filter.'
      };
    },

    'base-converter'(value) {
      const input = requireInput(value, 'Enter a number: 255, 0xff, 0b1010, 0o777, or "zz 36".').split('\n')[0].trim();
      const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
      let digits, base;
      let m;
      if ((m = input.match(/^([+-]?)0x([0-9a-fA-F]+)$/))) { digits = m[2]; base = 16; }
      else if ((m = input.match(/^([+-]?)0b([01]+)$/))) { digits = m[2]; base = 2; }
      else if ((m = input.match(/^([+-]?)0o([0-7]+)$/))) { digits = m[2]; base = 8; }
      else if ((m = input.match(/^([+-]?)(\d+)$/))) { digits = m[2]; base = 10; }
      else if ((m = input.match(/^([+-]?)([0-9a-zA-Z]+)\s+(?:base\s*)?(\d{1,2})$/))) {
        digits = m[2];
        base = Number(m[3]);
        if (base < 2 || base > 36) throw new Error('Base must be between 2 and 36.');
      } else {
        throw new Error('Formats: 255 · 0xff · 0b1010 · 0o777 · "zz 36" (value then base).');
      }
      const negative = m[1] === '-';
      let n = 0n;
      for (const ch of digits.toLowerCase()) {
        const d = DIGITS.indexOf(ch);
        if (d < 0 || d >= base) throw new Error(`"${ch}" is not a digit in base ${base}.`);
        n = n * BigInt(base) + BigInt(d);
      }
      const sign = negative ? '-' : '';
      const group = (s, size) => s.replace(new RegExp(`\\B(?=(.{${size}})+$)`, 'g'), '_');
      const bits = n === 0n ? 1 : n.toString(2).length;
      const rows = [
        ['Decimal', sign + group(n.toString(10), 3)],
        ['Hex', sign + '0x' + group(n.toString(16), 4)],
        ['Octal', sign + '0o' + n.toString(8)],
        ['Binary', sign + '0b' + group(n.toString(2), 4)],
        ['Bits', `${bits}${negative ? ' (magnitude)' : ''} — fits in ${bits <= 8 ? 'int8' : bits <= 16 ? 'int16' : bits <= 32 ? 'int32' : bits <= 64 ? 'int64' : 'a big integer'}`]
      ];
      return { output: alignTable(rows), status: `Parsed as base ${base}.` };
    },

    'roman-numerals'(value) {
      const input = requireInput(value, 'Enter a number 1–3999 or a Roman numeral.').split('\n')[0].trim().toUpperCase();
      const PAIRS = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
        [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
      if (/^\d+$/.test(input)) {
        let n = Number(input);
        if (n < 1 || n > 3999) throw new Error('Roman numerals cover 1–3999.');
        let out = '';
        for (const [v, sym] of PAIRS) while (n >= v) { out += sym; n -= v; }
        return { output: out, status: `${input} in Roman numerals.` };
      }
      if (!/^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(input) || !input) {
        throw new Error(`"${input}" is not a valid Roman numeral (or a plain number).`);
      }
      const VALUES = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
      let total = 0;
      for (let i = 0; i < input.length; i++) {
        const v = VALUES[input[i]];
        total += v < (VALUES[input[i + 1]] || 0) ? -v : v;
      }
      return { output: String(total), status: `${input} as a decimal number.` };
    },

    'text-counter'(value) {
      if (!value) throw new Error('Paste text to count.');
      const lines = value.split('\n');
      const words = value.split(/\s+/).filter(Boolean);
      const chars = [...value];
      const longest = lines.reduce((max, l) => Math.max(max, [...l].length), 0);
      const rows = [
        ['Characters', chars.length.toLocaleString()],
        ['Characters (no spaces)', chars.filter(c => !/\s/.test(c)).length.toLocaleString()],
        ['Words', words.length.toLocaleString()],
        ['Unique words', new Set(words.map(w => w.toLowerCase())).size.toLocaleString()],
        ['Lines', lines.length.toLocaleString()],
        ['Non-empty lines', lines.filter(l => l.trim()).length.toLocaleString()],
        ['UTF-8 bytes', encodeUtf8(value).length.toLocaleString()],
        ['Longest line', longest.toLocaleString() + ' characters']
      ];
      return { output: alignTable(rows), status: `${words.length.toLocaleString()} words, ${chars.length.toLocaleString()} characters.` };
    },

    'line-tools'(value) {
      const allLines = value.split('\n');
      const op = (allLines[0] || '').trim().toLowerCase();
      const OPS = ['sort', 'sort-n', 'unique', 'reverse', 'shuffle', 'number', 'trim'];
      if (!OPS.includes(op)) {
        throw new Error(`First line must be an operation: ${OPS.join(', ')}. The rest is the text to transform.`);
      }
      let lines = allLines.slice(1);
      if (!lines.filter(l => l.trim()).length) throw new Error('Add the lines to transform below the operation.');
      switch (op) {
        case 'sort': lines = [...lines].sort((a, b) => a.localeCompare(b)); break;
        case 'sort-n': lines = [...lines].sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0)); break;
        case 'unique': {
          const seen = new Set();
          lines = lines.filter(l => !seen.has(l) && (seen.add(l), true));
          break;
        }
        case 'reverse': lines = [...lines].reverse(); break;
        case 'shuffle': {
          lines = [...lines];
          for (let i = lines.length - 1; i > 0; i--) {
            const [r] = crypto.getRandomValues(new Uint32Array(1));
            const j = r % (i + 1);
            [lines[i], lines[j]] = [lines[j], lines[i]];
          }
          break;
        }
        case 'number': lines = lines.map((l, i) => `${String(i + 1).padStart(String(lines.length).length)}  ${l}`); break;
        case 'trim': lines = lines.map(l => l.trim()); break;
      }
      return { output: lines.join('\n'), status: `${op}: ${lines.length} line(s).` };
    },

    'lorem-ipsum'(value) {
      const WORDS = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum').split(' ');
      const m = value.trim().toLowerCase().match(/^(\d+)?\s*(word|sentence|paragraph)?s?$/);
      if (!m) throw new Error('Formats: "3 paragraphs", "5 sentences", "50 words" — or empty for 2 paragraphs.');
      const count = Math.min(500, Math.max(1, Number(m[1] ?? 2)));
      const unit = m[2] ?? 'paragraph';
      const word = () => randomPick(WORDS);
      const sentence = () => {
        const n = 8 + (crypto.getRandomValues(new Uint8Array(1))[0] % 7);
        const words = Array.from({ length: n }, word);
        return words[0][0].toUpperCase() + words.join(' ').slice(1) + '.';
      };
      const paragraph = () => Array.from({ length: 4 + (crypto.getRandomValues(new Uint8Array(1))[0] % 3) }, sentence).join(' ');
      let output;
      if (unit === 'word') output = 'Lorem ' + Array.from({ length: count - 1 }, word).join(' ');
      else if (unit === 'sentence') output = Array.from({ length: count }, sentence).join(' ');
      else output = Array.from({ length: count }, paragraph).join('\n\n');
      return { output, status: `${count} ${unit}${count === 1 ? '' : 's'} of filler.` };
    },

    'passphrase-generator'(value) {
      const m = value.trim().match(/^(\d+)?\s*(space|dash|dot)?$/i);
      if (!m) throw new Error('Formats: "6" (word count), optionally with a separator: space, dash, dot.');
      const count = Math.min(16, Math.max(3, Number(m[1] ?? 6)));
      const sep = { space: ' ', dash: '-', dot: '.' }[(m[2] || 'dash').toLowerCase()];
      const words = Array.from({ length: count }, () => randomPick(PASSPHRASE_WORDS));
      const bits = Math.floor(count * Math.log2(PASSPHRASE_WORDS.length));
      return {
        output: [
          words.join(sep),
          '',
          `${count} words from a ${PASSPHRASE_WORDS.length}-word list ≈ ${bits} bits of entropy.`,
          'Each word is chosen with a cryptographically secure generator.'
        ].join('\n'),
        status: `${count} words ≈ ${bits} bits. Run again for a new one.`
      };
    },

    'luhn-check'(value) {
      const input = requireInput(value, 'Enter a card-style number to check, or "generate 3" for test numbers.');
      const gen = input.trim().toLowerCase().match(/^generate\s*(\d+)?$/);
      const luhnSum = digits => digits.split('').reverse().reduce((sum, d, i) => {
        let n = Number(d);
        if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
        return sum + n;
      }, 0);
      if (gen) {
        const count = Math.min(20, Math.max(1, Number(gen[1] ?? 3)));
        const prefixes = ['424242', '555555', '400005', '601111'];
        const numbers = Array.from({ length: count }, () => {
          const prefix = randomPick(prefixes);
          let body = prefix;
          while (body.length < 15) body += crypto.getRandomValues(new Uint8Array(1))[0] % 10;
          const check = (10 - luhnSum(body + '0') % 10) % 10;
          return body + check;
        });
        return {
          output: [
            '# TEST numbers — Luhn-valid but not real accounts.',
            ...numbers.map(n => n.replace(/(.{4})/g, '$1 ').trim())
          ].join('\n'),
          status: `${count} Luhn-valid test number(s).`
        };
      }
      const digits = input.replace(/[\s-]/g, '');
      if (!/^\d{8,19}$/.test(digits)) throw new Error('Card-style numbers are 8–19 digits (spaces and dashes are fine).');
      const valid = luhnSum(digits) % 10 === 0;
      const brand = /^4/.test(digits) ? 'Visa-range prefix'
        : /^(5[1-5]|2[2-7])/.test(digits) ? 'Mastercard-range prefix'
        : /^3[47]/.test(digits) ? 'Amex-range prefix'
        : /^(6011|65)/.test(digits) ? 'Discover-range prefix' : 'Unrecognized prefix';
      const correct = (10 - luhnSum(digits.slice(0, -1) + '0') % 10) % 10;
      return {
        output: alignTable([
          ['Number', digits.replace(/(.{4})/g, '$1 ').trim()],
          ['Luhn check', valid ? '✓ passes' : `✗ fails (last digit should be ${correct})`],
          ['Length', `${digits.length} digits`],
          ['Prefix range', brand]
        ]),
        status: valid ? 'Checksum passes.' : 'Checksum fails.'
      };
    },

    'id-generator'(value) {
      const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
      const NANO_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
      const ulid = () => {
        let t = Date.now();
        let time = '';
        for (let i = 0; i < 10; i++) {
          time = CROCKFORD[t % 32] + time;
          t = Math.floor(t / 32);
        }
        const rnd = crypto.getRandomValues(new Uint8Array(16));
        return time + [...rnd].map(b => CROCKFORD[b % 32]).join('');
      };
      const nanoid = (size) => {
        const rnd = crypto.getRandomValues(new Uint8Array(size));
        return [...rnd].map(b => NANO_ALPHABET[b % 64]).join('');
      };
      const trimmed = value.trim();
      if (/^[0-9A-HJKMNP-TV-Z]{26}$/.test(trimmed)) {
        const ms = trimmed.slice(0, 10).split('').reduce((acc, ch) => acc * 32 + CROCKFORD.indexOf(ch), 0);
        const date = new Date(ms);
        if (Number.isNaN(date.getTime())) throw new Error('That looks like a ULID, but its timestamp is not a valid date.');
        return {
          output: alignTable([
            ['ULID', trimmed],
            ['Timestamp (ms)', String(ms)],
            ['Date (UTC)', date.toISOString()],
            ['Relative', relativeTime(date)],
            ['Randomness', trimmed.slice(10)]
          ]),
          status: `Decoded — created ${relativeTime(date)}.`
        };
      }
      const m = value.trim().toLowerCase().match(/^(\d+)?\s*(ulid|nanoid)?\s*(\d+)?$/);
      if (!m) throw new Error('Formats: "5 ulid" · "5 nanoid" · "3 nanoid 12" (count, kind, size) — or paste a 26-char ULID to decode it.');
      const count = Math.min(100, Math.max(1, Number(m[1] ?? 1)));
      const kind = m[2];
      const size = Math.min(64, Math.max(4, Number(m[3] ?? 21)));
      if (!kind) {
        return {
          output: alignTable([['ULID', ulid()], ['NanoID', nanoid(21)]]) + '\n\nAsk for more: "5 ulid" or "5 nanoid 12".',
          status: 'One of each. ULIDs sort by creation time; NanoIDs are compact and URL-safe.'
        };
      }
      const list = Array.from({ length: count }, () => (kind === 'ulid' ? ulid() : nanoid(size)));
      return {
        output: list.join('\n'),
        status: `${count} ${kind === 'ulid' ? 'ULID' : `NanoID (${size} chars)`}${count === 1 ? '' : 's'}.`
      };
    }
  };

  // ---------------------------------------------------------------- upgraded core tools

  // hash-generator: everything the original did, plus MD5 and CRC32.
  runners['hash-generator'] = async function (value) {
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
    lines.push(`MD5 (legacy — never for security):\n${md5Hex(bytes)}`);
    lines.push(`CRC32:\n${crc32Hex(bytes)}`);
    for (const alg of ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']) {
      lines.push(`${alg}:\n${bytesToHex(await crypto.subtle.digest(alg, bytes))}`);
    }
    lines.push('', 'Tip: to compute an HMAC, enter the key, a line with only ---, then the message.');
    return lines.join('\n');
  };

  // uuid-generator: v4 (default) and v7 generation, plus inspection of a pasted UUID.
  runners['uuid-generator'] = function (value) {
    const input = value.trim();
    const uuidMatch = input.match(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
    if (uuidMatch) {
      const hex = input.replace(/-/g, '').toLowerCase();
      const version = parseInt(hex[12], 16);
      const variantNibble = parseInt(hex[16], 16);
      const variant = variantNibble < 8 ? 'NCS (reserved)' : variantNibble < 12 ? 'RFC 4122/9562' : variantNibble < 14 ? 'Microsoft (reserved)' : 'Future (reserved)';
      const rows = [
        ['UUID', input.toLowerCase()],
        ['Version', `${version} — ${{ 1: 'timestamp + node', 3: 'MD5 name-based', 4: 'random', 5: 'SHA-1 name-based', 6: 'reordered timestamp', 7: 'Unix-time ordered', 8: 'custom' }[version] || 'unknown'}`],
        ['Variant', variant]
      ];
      if (version === 7) {
        const ms = parseInt(hex.slice(0, 12), 16);
        const date = new Date(ms);
        rows.push(['Timestamp', `${date.toISOString()} (${relativeTime(date)})`]);
      }
      if (version === 1) {
        const ts = (BigInt('0x' + hex.slice(13, 16)) << 48n) | (BigInt('0x' + hex.slice(8, 12)) << 32n) | BigInt('0x' + hex.slice(0, 8));
        const ms = Number((ts - 122192928000000000n) / 10000n);
        const date = new Date(ms);
        if (!Number.isNaN(date.getTime())) rows.push(['Timestamp', `${date.toISOString()} (${relativeTime(date)})`]);
      }
      return { output: alignTable(rows), status: `Inspected a version ${version} UUID.` };
    }
    const m = input.toLowerCase().match(/^(\d+)?\s*(v?[47])?$/);
    if (!m) throw new Error('Formats: "5" · "5 v7" · or paste a UUID to inspect it.');
    const count = Math.min(100, Math.max(1, Number(m[1] ?? 1)));
    const version = (m[2] || 'v4').replace('v', '');
    const uuidv7 = () => {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      const ms = BigInt(Date.now());
      for (let i = 0; i < 6; i++) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
      bytes[6] = (bytes[6] & 0x0f) | 0x70;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };
    const list = Array.from({ length: count }, () => (version === '7' ? uuidv7() : crypto.randomUUID()));
    return {
      output: list.join('\n'),
      status: `Generated ${count} UUID v${version} value(s). Also: "5 v7", or paste a UUID to inspect.`
    };
  };

  // ---------------------------------------------------------------- examples & placeholders

  Object.assign(ToolKit.examples, {
    'base64': 'Line up: héllo wörld ✓',
    'url-encode': 'https://example.com/search?q=dev toolbox&lang=en',
    'html-entities': '<a href="/pricing?plan=pro&ref=hn">Fish & Chips — €5 · “quoted”</a>',
    'unicode-escape': 'café — naïve résumé ☕ 日本',
    'hex-text': '48 65 78 20 6f 72 20 74 65 78 74 3f',
    'binary-text': '01100100 01100101 01110110',
    'rot13': 'Uryyb, Jbeyq! Guvf vf EBG13.',
    'morse-code': '... --- ... / -.. . ...- / - --- --- .-.. -... --- -..-',
    'punycode': 'bücher.münchen.example',
    'quoted-printable': 'Grüße aus München — schön, daß du da bist!',
    'utf8-inspector': 'héllo 👋 世界',
    'hex-dump': 'Dev Toolbox: 70 tools on one bench.',
    'ascii-table': 'separator',
    'base-converter': '0xdeadbeef',
    'roman-numerals': '1994',
    'text-counter': 'The bench holds seventy small tools.\nEach one does exactly one job.\nEach one does it locally.',
    'line-tools': 'sort\nbanana\napple\ncherry\napple\ndate',
    'lorem-ipsum': '2 paragraphs',
    'passphrase-generator': '6',
    'luhn-check': '4242 4242 4242 4242',
    'id-generator': '3 ulid'
  });

  Object.assign(ToolKit.placeholders, {
    'base64': 'Text to encode, or base64 to decode — direction is detected…',
    'url-encode': 'Text/URL to encode, or a percent-encoded string to decode…',
    'html-entities': 'Text to encode, or &entities; to decode…',
    'unicode-escape': 'Text to escape, or \\u00e9-style escapes to decode…',
    'hex-text': 'Text to hex-encode, or hex bytes to decode…',
    'binary-text': 'Text to encode, or 8-bit binary groups to decode…',
    'rot13': 'Text — running it twice gets you back where you started…',
    'morse-code': 'Text to encode, or dots and dashes (/ between words) to decode…',
    'punycode': 'A domain: münchen.example or xn--mnchen-3ya.example…',
    'quoted-printable': 'Text to encode, or =C3=BC-style quoted-printable to decode…',
    'utf8-inspector': 'Any text — see each character’s code point and bytes…',
    'hex-dump': 'Text to dump: offsets, hex bytes, ASCII column…',
    'ascii-table': 'Empty shows the whole table — type to filter (e.g. "escape", "0x7f")…',
    'base-converter': '255 · 0xff · 0b1010 · 0o777 · "zz 36"…',
    'roman-numerals': 'A number (1–3999) or a numeral like MCMXCIV…',
    'text-counter': 'Paste text to count words, lines, and bytes…',
    'line-tools': 'First line: sort · sort-n · unique · reverse · shuffle · number · trim…',
    'lorem-ipsum': '"3 paragraphs", "5 sentences", or "50 words"…',
    'passphrase-generator': 'Word count (3–16), optional separator: space, dash, dot…',
    'luhn-check': 'A card-style number to validate, or "generate 3" for test numbers…',
    'id-generator': '"5 ulid" · "5 nanoid" · "3 nanoid 12" — or paste a ULID to decode its timestamp…'
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = ToolKit;
  Object.assign(ToolKit.runners, runners);
})(typeof window !== 'undefined' ? window : globalThis);
