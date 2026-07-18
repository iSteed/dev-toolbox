// Exercise the add-on tool packs (tools-encode.js, tools-web.js).
// Load order matters: tools.js first (creates ToolKit + helpers), then packs.
const nodeCrypto = require('crypto');
if (typeof globalThis.crypto === 'undefined') globalThis.crypto = nodeCrypto.webcrypto;

const ToolKit = require('../tools.js');
require('../tools-encode.js');
require('../tools-web.js');
const { runners } = ToolKit;
const examples = ToolKit.examples;

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`ok    ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}: ${e.message}`); }
}
async function checkAsync(name, fn) {
  try { await fn(); passed++; console.log(`ok    ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}: ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function out(r) { return typeof r === 'string' ? r : r.output; }
function run(id, input) { return runners[id](input); }
function throws(fn, substr) {
  try { fn(); } catch (e) {
    if (substr && !e.message.includes(substr)) throw new Error(`expected "${substr}", got "${e.message}"`);
    return;
  }
  throw new Error('expected an error');
}

(async () => {

  // ---------- encoding: round-trips ----------
  const roundTrips = [
    ['base64', 'Héllo, wörld! ✓'],
    ['url-encode', 'a b&c=d/e?f#g'],
    ['html-entities', '<div class="x">a & b</div>'],
    ['hex-text', 'Round trip 123'],
    ['binary-text', 'bits!'],
    ['quoted-printable', 'Grüße café'],
    ['rot13', 'Whatever Rotates']
  ];
  for (const [id, text] of roundTrips) {
    check(`${id}: round-trips`, () => {
      const encoded = out(run(id, text));
      const decoded = out(run(id, encoded));
      // For dual outputs (url-encode shows two forms) decode the first line.
      const backText = id === 'url-encode' ? out(run(id, encoded.split('\n')[1])) : decoded;
      assert(backText === text || decoded === text, `got "${decoded}" from "${encoded}"`);
    });
  }

  check('base64: decodes to text and detects direction', () => {
    assert(out(run('base64', 'aGVsbG8=')) === 'hello', 'decode');
    assert(out(run('base64', 'hello')) === 'aGVsbG8=', 'encode');
  });

  check('rot13: known value', () => {
    assert(out(run('rot13', 'Hello')) === 'Uryyb');
  });

  check('morse-code: encode + decode SOS', () => {
    assert(out(run('morse-code', 'SOS')) === '... --- ...', out(run('morse-code', 'SOS')));
    assert(out(run('morse-code', '... --- ...')) === 'SOS');
    assert(out(run('morse-code', '.... . .-.. .-.. ---')) === 'HELLO');
  });

  check('unicode-escape: escape and decode', () => {
    assert(out(run('unicode-escape', 'café')).includes('\\u00e9'), 'escapes é');
    assert(out(run('unicode-escape', 'caf\\u00e9') ) === 'café', 'decodes');
  });

  check('punycode: RFC 3492 / IDN vectors', () => {
    // münchen -> xn--mnchen-3ya ; bücher -> xn--bcher-kva
    assert(out(run('punycode', 'münchen.de')).startsWith('xn--mnchen-3ya.de'), out(run('punycode', 'münchen.de')));
    assert(out(run('punycode', 'xn--bcher-kva.example')).startsWith('bücher.example'), 'decode bücher');
    // round trip
    const enc = out(run('punycode', 'faß.example')).split('\n')[0];
    assert(out(run('punycode', enc)).split('\n')[0] === 'faß.example', 'round trip: ' + enc);
  });

  check('utf8-inspector: counts multibyte', () => {
    const r = run('utf8-inspector', 'A€😀');
    assert(r.status.includes('3 code point'), r.status);
    assert(r.status.includes('8 UTF-8 byte'), r.status); // A=1, €=3, 😀=4 = 8 bytes
  });

  // ---------- numbers ----------
  check('base-converter: hex/bin/oct/dec + custom base', () => {
    assert(out(run('base-converter', '255')).includes('0xff'), 'dec->hex');
    assert(out(run('base-converter', '0xff')).includes('255'), 'hex->dec');
    assert(out(run('base-converter', '0b1010')).includes('10'), 'bin');
    assert(out(run('base-converter', 'zz 36')).includes('1_295'), 'base36: ' + out(run('base-converter', 'zz 36')));
    throws(() => run('base-converter', '0xZZ'), '');
  });

  check('roman-numerals: both directions', () => {
    assert(out(run('roman-numerals', '1994')) === 'MCMXCIV');
    assert(out(run('roman-numerals', 'MCMXCIV')) === '1994');
    assert(out(run('roman-numerals', '4')) === 'IV');
    throws(() => run('roman-numerals', '4000'), '1–3999');
    throws(() => run('roman-numerals', 'IIII'), 'not a valid');
  });

  // ---------- text ----------
  check('text-counter: words, lines, bytes', () => {
    const r = run('text-counter', 'one two three\nfour');
    assert(out(r).includes('Words') && r.status.includes('4 words'), r.status);
  });

  check('line-tools: sort, unique, reverse, number', () => {
    assert(out(run('line-tools', 'sort\nc\na\nb')) === 'a\nb\nc');
    assert(out(run('line-tools', 'unique\na\na\nb')) === 'a\nb');
    assert(out(run('line-tools', 'reverse\n1\n2\n3')) === '3\n2\n1');
    assert(out(run('line-tools', 'sort-n\n10\n2\n1')) === '1\n2\n10');
    throws(() => run('line-tools', 'bogus\na\nb'), 'operation');
  });

  check('luhn-check: validate + generate', () => {
    assert(out(run('luhn-check', '4242 4242 4242 4242')).includes('✓ passes'), 'valid card');
    assert(out(run('luhn-check', '4242 4242 4242 4241')).includes('✗ fails'), 'invalid card');
    const gen = out(run('luhn-check', 'generate 2')).split('\n').filter(l => /^\d/.test(l));
    for (const line of gen) {
      const digits = line.replace(/\s/g, '');
      const sum = digits.split('').reverse().reduce((s, d, i) => {
        let n = +d; if (i % 2) { n *= 2; if (n > 9) n -= 9; } return s + n;
      }, 0);
      assert(sum % 10 === 0, 'generated Luhn-valid: ' + line);
    }
  });

  check('id-generator: ULID + NanoID shapes', () => {
    const ulids = out(run('id-generator', '3 ulid')).split('\n');
    assert(ulids.length === 3 && ulids.every(u => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(u)), 'ulids: ' + ulids[0]);
    const nanos = out(run('id-generator', '2 nanoid 12')).split('\n');
    assert(nanos.every(n => n.length === 12), 'nano length');
  });

  check('id-generator: decodes a ULID timestamp', () => {
    const before = Date.now();
    const ulid = out(run('id-generator', '1 ulid')).trim();
    const decoded = out(run('id-generator', ulid));
    assert(decoded.includes(ulid), decoded);
    const msLine = decoded.split('\n').find(l => l.startsWith('Timestamp'));
    const ms = Number(msLine.split(/\s+/).pop());
    assert(Math.abs(ms - before) < 5000, 'decoded timestamp near generation time: ' + decoded);
  });

  check('id-generator: ULID timestamp range and case handling', () => {
    const maxValid = out(run('id-generator', '7ZZZZZZZZZ' + 'A'.repeat(16)));
    assert(maxValid.includes('Timestamp'), 'largest 48-bit prefix decodes: ' + maxValid);
    throws(() => run('id-generator', '8ZZZZZZZZZ' + 'A'.repeat(16)), '48-bit');
    const lower = out(run('id-generator', ('01ARZ3NDEKTSV4RRFFQ69G5FAV').toLowerCase()));
    assert(lower.includes('01ARZ3NDEKTSV4RRFFQ69G5FAV'), 'lowercase normalized: ' + lower);
  });

  check('passphrase + lorem produce output', () => {
    assert(out(run('passphrase-generator', '5')).split('\n')[0].split('-').length === 5, 'five words');
    assert(out(run('lorem-ipsum', '2 sentences')).length > 20, 'lorem');
    assert(out(run('lorem-ipsum', '10 words')).toLowerCase().startsWith('lorem'), 'starts lorem');
  });

  // ---------- upgraded core ----------
  await checkAsync('hash-generator: now includes MD5 + CRC32', async () => {
    const text = out(await run('hash-generator', 'abc'));
    assert(text.includes('900150983cd24fb0d6963f7d28e17f72'), 'md5(abc): ' + text.split('\n').find(l => /^[0-9a-f]{32}$/.test(l)));
    assert(text.includes('352441c2'), 'crc32(abc)'); // crc32("abc") = 352441c2
    assert(text.includes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'), 'sha256 kept');
  });

  check('uuid-generator: v4, v7, and inspect', () => {
    const v4 = out(run('uuid-generator', '2')).split('\n');
    assert(v4.length === 2 && /-4[0-9a-f]{3}-/.test(v4[0]), 'v4: ' + v4[0]);
    const v7 = out(run('uuid-generator', '1 v7')).trim();
    assert(/-7[0-9a-f]{3}-/.test(v7), 'v7: ' + v7);
    const inspected = out(run('uuid-generator', v7));
    assert(inspected.includes('Version') && inspected.includes('7'), 'inspect version');
    assert(inspected.includes('Timestamp'), 'v7 timestamp decoded');
  });

  // ---------- JSON family ----------
  check('json-transform: minify, pretty, sort', () => {
    assert(out(run('json-transform', 'minify\n{"a": 1, "b": 2}')) === '{"a":1,"b":2}');
    assert(out(run('json-transform', 'sort\n{"b":1,"a":2}')).indexOf('"a"') < out(run('json-transform', 'sort\n{"b":1,"a":2}')).indexOf('"b"'), 'sorted');
  });

  check('json-merge: deep merge, later wins', () => {
    const r = JSON.parse(out(run('json-merge', '{"a":{"x":1},"t":[1]}\n---\n{"a":{"y":2},"t":[2]}')));
    assert(r.a.x === 1 && r.a.y === 2, 'deep merge objects');
    assert(JSON.stringify(r.t) === '[2]', 'arrays replaced');
  });

  check('json <-> csv round trip', () => {
    const csv = out(run('json-to-csv', '[{"id":1,"name":"Ada"},{"id":2,"name":"Grace"}]'));
    assert(csv.split('\n')[0] === 'id,name', 'header');
    const back = JSON.parse(out(run('csv-to-json', csv)));
    assert(back[0].id === 1 && back[1].name === 'Grace', 'round trip: ' + JSON.stringify(back));
  });

  check('json-schema: infers types', () => {
    const schema = JSON.parse(out(run('json-schema', '{"n":1,"s":"x","arr":[1,2],"nested":{"b":true}}')));
    assert(schema.properties.n.type === 'integer', 'int');
    assert(schema.properties.s.type === 'string', 'string');
    assert(schema.properties.arr.type === 'array', 'array');
    assert(schema.properties.nested.properties.b.type === 'boolean', 'nested bool');
  });

  check('jsonpath: wildcards and recursion', () => {
    const doc = '{"tools":[{"name":"a"},{"name":"b"}],"meta":{"name":"root"}}';
    assert(out(run('jsonpath', '$.tools[*].name\n' + doc)).includes('"a"'), 'wildcard');
    assert(JSON.parse(out(run('jsonpath', '$.tools[0].name\n' + doc))) === 'a', 'index');
    const recurse = out(run('jsonpath', '$..name\n' + doc));
    assert(recurse.includes('root') && recurse.includes('"a"'), 'recursive: ' + recurse);
  });

  // ---------- XML / HTML / MD ----------
  check('xml-formatter: indents and converts to JSON', () => {
    const r = out(run('xml-formatter', '<a><b id="1">hi</b><b>yo</b></a>'));
    assert(r.includes('as JSON'), 'has json section');
    const json = JSON.parse(r.split('--- as JSON ---')[1]);
    assert(Array.isArray(json.a.b) && json.a.b.length === 2, 'repeated tags become array: ' + JSON.stringify(json));
    assert(json.a.b[0]['@id'] === '1', 'attribute captured');
  });

  check('html-formatter: nests block elements', () => {
    const r = out(run('html-formatter', '<div><p>hi</p></div>'));
    assert(/<div>\n\s+<p>/.test(r), 'indented: ' + JSON.stringify(r));
  });

  check('html <-> markdown', () => {
    const md = out(run('html-to-markdown', '<h1>Title</h1><p><strong>bold</strong> and <a href="/x">link</a></p>'));
    assert(md.includes('# Title') && md.includes('**bold**') && md.includes('[link](/x)'), md);
    const html = out(run('markdown-to-html', '# Title\n\n**bold** text\n\n- item'));
    assert(html.includes('<h1>Title</h1>') && html.includes('<strong>bold</strong>') && html.includes('<li>'), html);
  });

  check('markdown-toc: builds anchors', () => {
    const toc = out(run('markdown-toc', '# T\n## First Section\n### Sub\n## Second'));
    assert(toc.includes('- [First Section](#first-section)'), toc);
    assert(toc.includes('  - [Sub](#sub)'), 'nested indent');
  });

  // ---------- SQL ----------
  check('sql-formatter: breaks clauses', () => {
    const r = out(run('sql-formatter', 'select a, b from t where a = 1 order by b'));
    assert(/^SELECT/m.test(r) && /^FROM/m.test(r) && /^WHERE/m.test(r) && /^ORDER BY/m.test(r), r);
  });

  check('csv-to-insert: generates statements', () => {
    const r = out(run('csv-to-insert', 'table: users\nid,name\n1,Ada\n2,Grace'));
    assert(r.includes("INSERT INTO users (id, name) VALUES (1, 'Ada');"), r);
    assert(r.split('\n').length === 2, 'two rows');
  });

  // ---------- colors ----------
  check('color-converter: hex/rgb/hsl', () => {
    const r = out(run('color-converter', '#3a7bd5'));
    assert(r.includes('rgb(58, 123, 213)'), 'rgb: ' + r);
    assert(r.includes('hsl('), 'hsl present');
    assert(out(run('color-converter', 'rgb(255,0,0)')).includes('#ff0000'), 'rgb->hex');
    assert(out(run('color-converter', 'hsl(0,100%,50%)')).includes('#ff0000'), 'hsl->hex');
  });

  check('contrast-checker: WCAG ratios', () => {
    const bw = out(run('contrast-checker', '#000000\n#ffffff'));
    assert(bw.includes('21.00:1'), 'black/white is 21: ' + bw);
    assert(bw.includes('✓ pass'), 'passes');
    const fail = run('contrast-checker', '#777777\n#888888');
    assert(fail.status.includes('fails'), fail.status);
  });

  // ---------- networking ----------
  check('ip-calculator: int/hex/binary', () => {
    const r = out(run('ip-calculator', '192.168.1.1'));
    assert(r.includes('3232235777'), 'integer: ' + r);
    assert(r.includes('0xc0a80101'), 'hex');
    assert(r.includes('11000000.10101000'), 'binary');
    throws(() => run('ip-calculator', '999.1.1.1'), '0–255');
  });

  check('port-lookup: number and keyword', () => {
    assert(out(run('port-lookup', '5432')).includes('PostgreSQL'), 'postgres');
    assert(out(run('port-lookup', '443')).includes('HTTPS'), 'https');
    assert(out(run('port-lookup', 'redis')).includes('6379'), 'keyword');
    throws(() => run('port-lookup', '99999'), '0 to 65535');
  });

  check('mime-lookup: ext and type', () => {
    assert(out(run('mime-lookup', 'svg')).includes('image/svg+xml'), 'ext');
    assert(out(run('mime-lookup', 'logo.woff2')).includes('font/woff2'), 'filename');
    assert(out(run('mime-lookup', 'text/css')).includes('.css'), 'reverse');
  });

  check('status-code: number and keyword', () => {
    assert(out(run('status-code', '404')).includes('Not Found'), '404');
    assert(out(run('status-code', '418')).includes('teapot'), 'teapot');
    assert(out(run('status-code', 'gateway')).includes('502'), 'keyword');
  });

  check('file-signature: PNG and JPEG magic', () => {
    assert(out(run('file-signature', '89 50 4E 47 0D 0A 1A 0A')).includes('PNG'), 'png');
    assert(out(run('file-signature', 'ff d8 ff e0')).includes('JPEG'), 'jpeg');
    assert(out(run('file-signature', '50 4B 03 04')).includes('ZIP'), 'zip');
  });
  check('file-signature: reverse lookup by type name', () => {
    const png = out(run('file-signature', 'png'));
    assert(png.includes('89 50 4E 47') && png.includes('PNG image'), png);
    const zip = out(run('file-signature', 'zip'));
    assert(zip.includes('50 4B 03 04'), zip);
    throws(() => run('file-signature', 'not-a-real-format'), 'No known file type');
  });
  check('file-signature: direction ambiguity and dotted extensions', () => {
    const deb = out(run('file-signature', 'deb'));
    assert(deb.includes('Debian'), 'odd-length hex-like "deb" does reverse lookup: ' + deb);
    throws(() => run('file-signature', 'abc'), 'odd number of digits');
    const dotted = out(run('file-signature', '.png'));
    assert(dotted.includes('PNG image'), '.png normalized: ' + dotted);
  });

  check('cookie-parser: Set-Cookie flags + security notes', () => {
    const r = out(run('cookie-parser', 'Set-Cookie: id=abc; Path=/; Secure; HttpOnly; SameSite=Strict'));
    assert(r.includes('HttpOnly') && r.includes('Secure'), 'flags');
    const insecure = out(run('cookie-parser', 'Set-Cookie: id=abc; Path=/'));
    assert(insecure.includes('No HttpOnly') && insecure.includes('No Secure'), 'warnings: ' + insecure);
    const plain = out(run('cookie-parser', 'a=1; b=2; c=3'));
    assert(plain.includes('a') && plain.includes('b'), 'plain cookie header');
  });
  check('cookie-parser: builds a Set-Cookie header from field lines', () => {
    const built = out(run('cookie-parser', 'name: session\nvalue: abc123\npath: /\nmax-age: 3600\nhttponly: true\nsamesite: Lax'));
    assert(built === 'session=abc123; Path=/; Max-Age=3600; SameSite=Lax; HttpOnly', built);
    throws(() => run('cookie-parser', 'value: abc123'), 'name');
    const roundTrip = out(run('cookie-parser', built));
    assert(roundTrip.includes('session') && roundTrip.includes('No Secure'), 'round-trip through decode: ' + roundTrip);
  });
  check('cookie-parser: build mode rejects injection and invalid fields', () => {
    throws(() => run('cookie-parser', 'name: session\nvalue: abc; Secure\nsecure: false'), 'semicolons');
    throws(() => run('cookie-parser', 'name: se;ssion\nvalue: x'), 'invalid characters');
    throws(() => run('cookie-parser', 'name: s\npath: /; Secure'), 'semicolons');
    throws(() => run('cookie-parser', 'name: s\nunknown-field: x'), 'Unknown cookie field');
    throws(() => run('cookie-parser', 'name: s\nvalue: 1\nvalue: 2'), 'more than once');
    throws(() => run('cookie-parser', 'name: s\nsecure: flase'), 'must be true or false');
    throws(() => run('cookie-parser', 'name: s\nsamesite: Sometimes'), 'Strict, Lax, or None');
    throws(() => run('cookie-parser', 'name: s\nmax-age: tomorrow'), 'integer');
  });

  check('query-string: decode and build', () => {
    assert(out(run('query-string', 'https://x.com/?a=1&b=two')).includes('two'), 'decode');
    assert(out(run('query-string', 'q=dev toolbox\npage=2')).includes('q=dev+toolbox'), 'build: ' + out(run('query-string', 'q=dev toolbox\npage=2')));
  });

  check('data-generator: json, csv, sql shapes', () => {
    const json = JSON.parse(out(run('data-generator', 'rows: 3\nformat: json\nfields: id, name, email, bool')));
    assert(json.length === 3 && json[0].id === 1 && json[2].id === 3, 'ids sequential');
    assert(/@example\.com$/.test(json[0].email), 'email shape: ' + json[0].email);
    assert(typeof json[0].bool === 'boolean', 'bool type');
    const csv = out(run('data-generator', 'rows: 2\nformat: csv\nfields: id, uuid, date'));
    const lines = csv.split('\n');
    assert(lines[0] === 'id,uuid,date' && lines.length === 3, 'csv header + 2 rows');
    assert(/^2,[0-9a-f-]{36},\d{4}-\d{2}-\d{2}$/.test(lines[2]), 'csv row shape: ' + lines[2]);
    const sql = out(run('data-generator', 'rows: 2\nformat: sql\ntable: users\nfields: id, name'));
    assert(sql.split('\n').every(l => l.startsWith('INSERT INTO users (id, name) VALUES (')), sql);
    const short = JSON.parse(out(run('data-generator', '4 json')));
    assert(short.length === 4 && 'email' in short[0], 'shorthand with default fields');
  });
  check('data-generator: escapes a quote-containing field name in the CSV header', () => {
    const csv = out(run('data-generator', 'rows: 1\nformat: csv\nfields: id", name'));
    const lines = csv.split('\n');
    assert(lines[0] === '"id""",name', 'header escaped: ' + lines[0]);
    assert(lines.length === 2, 'one data row: ' + csv);
  });
  check('data-generator: escapes single quotes in SQL string values', () => {
    const sql = out(run('data-generator', 'rows: 20\nformat: sql\ntable: t\nfields: name'));
    assert(sql.split('\n').every(l => (l.match(/'/g) || []).length % 2 === 0), 'balanced quotes: ' + sql);
  });
  check('data-generator: rejects bad options', () => {
    throws(() => run('data-generator', 'rows: 0'), '1 to 1000');
    throws(() => run('data-generator', 'rows: 2\nfields: id, wizard'), 'Unknown field type');
    throws(() => run('data-generator', 'format: yaml'), 'json, csv, or sql');
    throws(() => run('data-generator', 'speed: fast'), 'Unknown option');
    throws(() => run('data-generator', 'rows: 2\nformat: sql\ntable: users; drop'), 'plain identifier');
    throws(() => run('data-generator', 'rows: 1\nformat: sql\nfields: id", name'), 'plain identifier');
  });
  check('curl-builder: assembles command', () => {
    const r = out(run('curl-builder', 'POST https://api.x.com/v1\nContent-Type: application/json\nbody: {"a":1}'));
    assert(r.includes("curl -X POST 'https://api.x.com/v1'"), 'method+url');
    assert(r.includes("-H 'Content-Type: application/json'"), 'header');
    assert(r.includes(`-d '{"a":1}'`), 'body');
  });
  check('curl-builder: reverse-parses a curl command', () => {
    const parsed = out(run('curl-builder', `curl -X POST 'https://api.x.com/v1' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"a":1}'`));
    assert(parsed === 'POST https://api.x.com/v1\nContent-Type: application/json\nbody: {"a":1}', parsed);
    const noMethod = out(run('curl-builder', "curl https://example.com -H 'X-Test: 1'"));
    assert(noMethod.startsWith('GET https://example.com'), 'defaults to GET: ' + noMethod);
    const impliedPost = out(run('curl-builder', "curl https://example.com -d 'x=1'"));
    assert(impliedPost.startsWith('POST https://example.com'), 'defaults to POST with a body: ' + impliedPost);
  });
  check('curl-builder: parse handles arity, quoting, =values, repeated data', () => {
    throws(() => run('curl-builder', 'curl -u alice:secret https://example.com'), 'Unsupported curl option');
    const literalBackslash = out(run('curl-builder', "curl https://example.com -d 'a\\b'"));
    assert(literalBackslash.includes('body: a\\b'), 'single-quoted backslash stays literal: ' + literalBackslash);
    const eqForm = out(run('curl-builder', 'curl --request=PUT --data=x=1 https://example.com'));
    assert(eqForm.startsWith('PUT https://example.com') && eqForm.includes('body: x=1'), '--option=value: ' + eqForm);
    const multiData = out(run('curl-builder', "curl https://example.com -d a=1 -d b=2"));
    assert(multiData.includes('body: a=1&b=2'), 'repeated --data joined with &: ' + multiData);
    throws(() => run('curl-builder', 'curl -X'), 'missing its argument');
    throws(() => run('curl-builder', "curl https://a.com https://b.com"), 'two possible URLs');
  });
  check('curl-builder: round-trips build -> parse -> build', () => {
    const built = out(run('curl-builder', 'POST https://api.x.com/v1\nContent-Type: application/json\nbody: {"a":1}'));
    const parsed = out(run('curl-builder', built));
    assert(parsed === 'POST https://api.x.com/v1\nContent-Type: application/json\nbody: {"a":1}', parsed);
  });

  check('jwt-generate: builds decodable unsigned token', () => {
    const token = out(run('jwt-generate', '{"sub":"42","name":"Test"}')).split('\n')[0];
    assert(token.split('.').length === 3 && token.endsWith('.'), 'three segments, empty sig: ' + token);
    const decoded = out(run('jwt-decoder', token));
    assert(decoded.includes('"name": "Test"'), 'decodes back: ' + decoded);
  });

  // ---------- every new example runs clean ----------
  const NEW_IDS = ['base64','url-encode','html-entities','unicode-escape','hex-text','binary-text','quoted-printable','punycode','rot13','morse-code','utf8-inspector','hex-dump','ascii-table','base-converter','roman-numerals','text-counter','line-tools','lorem-ipsum','passphrase-generator','luhn-check','id-generator','json-transform','json-merge','json-to-csv','csv-to-json','json-schema','jsonpath','xml-formatter','html-formatter','html-to-markdown','markdown-to-html','markdown-toc','sql-formatter','csv-to-insert','color-converter','contrast-checker','ip-calculator','port-lookup','mime-lookup','status-code','file-signature','cookie-parser','query-string','curl-builder','jwt-generate','data-generator'];
  for (const id of NEW_IDS) {
    await checkAsync(`example runs clean: ${id}`, async () => {
      assert(examples[id] !== undefined, 'missing example');
      const r = await run(id, examples[id]);
      assert(out(r).length > 0, 'empty output');
    });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
