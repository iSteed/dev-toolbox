// Exercise every tool runner in tools.js with real inputs and assert on outputs.
const ToolKit = require('../tools.js');
const { runners, examples, yamlParse, yamlStringify } = ToolKit;

let passed = 0, failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok    ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}: ${e.message}`);
  }
}
async function checkAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok    ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}: ${e.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function out(result) { return typeof result === 'string' ? result : result.output; }
function run(id, input) { return runners[id](input); }

function throws(fn, substr) {
  try { fn(); } catch (e) {
    if (substr && !e.message.includes(substr)) throw new Error(`expected error containing "${substr}", got "${e.message}"`);
    return;
  }
  throw new Error('expected an error but none was thrown');
}

(async () => {

  // ---- YAML parser ----
  check('yaml: nested mapping + sequence + types', () => {
    const doc = yamlParse('name: app\ncount: 3\nratio: 0.5\nok: true\nnothing: null\nlist:\n  - a\n  - 2\nnested:\n  deep:\n    x: 1\n');
    assert(doc.name === 'app' && doc.count === 3 && doc.ratio === 0.5, 'scalars');
    assert(doc.ok === true && doc.nothing === null, 'bool/null');
    assert(JSON.stringify(doc.list) === '["a",2]', 'list: ' + JSON.stringify(doc.list));
    assert(doc.nested.deep.x === 1, 'nesting');
  });
  check('yaml: seq of maps with first key on dash line', () => {
    const doc = yamlParse('services:\n  - name: web\n    image: nginx\n  - name: api\n    image: node:20\n');
    assert(doc.services.length === 2, 'length');
    assert(doc.services[0].name === 'web' && doc.services[0].image === 'nginx', 'item 0');
    assert(doc.services[1].image === 'node:20', 'item 1');
  });
  check('yaml: sequence at same indent as key', () => {
    const doc = yamlParse('items:\n- one\n- two\nafter: yes-string\n');
    assert(JSON.stringify(doc.items) === '["one","two"]', JSON.stringify(doc));
    assert(doc.after === 'yes-string');
  });
  check('yaml: quoted strings, comments, flow collections', () => {
    const doc = yamlParse(`title: "hello: world" # trailing comment\nsingle: 'it''s fine'\nflow: [1, two, {a: 1, b: "x"}]\nempty: {}\nport: "8080"\n`);
    assert(doc.title === 'hello: world', 'double-quoted: ' + doc.title);
    assert(doc.single === "it's fine", 'single-quoted');
    assert(doc.flow[2].b === 'x' && doc.flow[1] === 'two', 'flow');
    assert(JSON.stringify(doc.empty) === '{}', 'empty flow map');
    assert(doc.port === '8080', 'quoted number stays string');
  });
  check('yaml: block scalars literal and folded', () => {
    const doc = yamlParse('lit: |\n  line1\n  line2\nfold: >\n  word1\n  word2\nchomped: |-\n  no newline\n');
    assert(doc.lit === 'line1\nline2\n', JSON.stringify(doc.lit));
    assert(doc.fold === 'word1 word2\n', JSON.stringify(doc.fold));
    assert(doc.chomped === 'no newline', JSON.stringify(doc.chomped));
  });
  check('yaml: errors on anchors and bad indent', () => {
    throws(() => yamlParse('a: &anchor 1\n'), 'anchors');
    throws(() => yamlParse('a: 1\n     b: 2\n'), 'YAML line');
  });
  check('yaml: stringify round-trip', () => {
    const value = {
      name: 'toolbox', version: 2, active: true, missing: null,
      tags: ['a b', 'true', '8080', 'plain'],
      nested: { list: [{ x: 1, y: [1, 2] }], empty: {}, emptyList: [] },
      text: 'line1\nline2\n'
    };
    const yaml = yamlStringify(value);
    const back = yamlParse(yaml);
    assert(JSON.stringify(back) === JSON.stringify(value), 'round-trip mismatch:\n' + yaml + '\n' + JSON.stringify(back));
  });
  check('yaml: compose example parses', () => {
    const doc = yamlParse(examples['compose-validator']);
    assert(doc.services.web.image === 'nginx:1.27-alpine', 'web image');
    assert(doc.services.web.ports[0] === '8080:80', 'ports');
    assert(doc.services.api.environment[0] === 'NODE_ENV=production', 'env');
    assert('site-data' in doc.volumes && doc.volumes['site-data'] === null, 'volumes');
  });

  // ---- converters / formatters ----
  check('json-formatter: formats and errors', () => {
    assert(out(run('json-formatter', '{"a":1}')).includes('"a": 1'));
    throws(() => run('json-formatter', '{bad'), '');
  });
  check('yaml-converter: yaml -> json and json -> yaml', () => {
    const j = JSON.parse(out(run('yaml-converter', examples['yaml-converter'])));
    assert(j.replicas === 3 && j.ports[1] === 8443 && j.features.telemetry === null, 'yaml->json');
    const y = out(run('yaml-converter', '{"a":{"b":[1,2]},"s":"x y"}'));
    const back = yamlParse(y);
    assert(back.a.b[1] === 2 && back.s === 'x y', 'json->yaml round trip:\n' + y);
  });
  check('csv-viewer: quoted commas and alignment', () => {
    const result = run('csv-viewer', examples['csv-viewer']);
    assert(out(result).includes('London, UK'), 'quoted comma survived');
    assert(result.status.includes('3 data row(s) × 4 column(s)'), 'status: ' + result.status);
  });
  check('csv-viewer: detects semicolons and tabs', () => {
    assert(run('csv-viewer', 'a;b;c\n1;2;3').status.includes('semicolon'));
    assert(run('csv-viewer', 'a\tb\n1\t2').status.includes('tab'));
  });
  check('json-diff: reports adds/removes/changes', () => {
    const result = run('json-diff', examples['json-diff']);
    const text = out(result);
    assert(text.includes('~ $.version: "1.2.0" → "1.3.0"'), 'changed version:\n' + text);
    assert(text.includes('- $.deps.zod'), 'removed');
    assert(text.includes('+ $.license'), 'added');
    assert(out(run('json-diff', '{"a":1}\n---\n{"a":1}')).includes('No differences'));
  });
  check('text-diff: LCS line diff', () => {
    const result = run('text-diff', 'a\nb\nc\n---\na\nx\nc');
    assert(out(result).includes('- b') && out(result).includes('+ x'), out(result));
    assert(result.status.includes('+1') && result.status.includes('−1'), result.status);
  });

  // ---- security ----
  check('jwt-decoder: decodes and analyzes expiry', () => {
    const result = run('jwt-decoder', examples['jwt-decoder']);
    const text = out(result);
    assert(text.includes('"name": "Dev Toolbox"'), 'payload');
    assert(text.includes('HS256'), 'alg note');
    assert(text.includes('not expired'), 'expiry check: ' + text);
    assert(text.includes('NOT verified'), 'signature note');
  });
  await checkAsync('hash-generator: known SHA-256 and HMAC vectors', async () => {
    const sha = out(await run('hash-generator', 'abc'));
    assert(sha.includes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'), 'sha256("abc"):\n' + sha);
    const hmac = out(await run('hash-generator', 'key\n---\nThe quick brown fox jumps over the lazy dog'));
    assert(hmac.includes('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8'), 'hmac vector:\n' + hmac);
  });
  check('csp-builder: baseline + merge + warnings', () => {
    const result = run('csp-builder', "script-src https://cdn.example.com 'unsafe-inline'\nbogus-directive foo");
    const text = out(result);
    assert(text.includes("script-src 'self' https://cdn.example.com 'unsafe-inline'"), 'merged: ' + text.split('\n')[1]);
    assert(text.includes("object-src 'none'"), 'baseline kept');
    assert(text.includes('unsafe-inline'), 'warning present');
    assert(text.includes('Unknown directive "bogus-directive"'), 'unknown directive warning');
    assert(out(run('csp-builder', '')).includes('frame-ancestors'), 'empty input yields baseline');
  });
  check('password-entropy: pool detection and rating', () => {
    const weak = run('password-entropy', 'abc');
    assert(weak.status.includes('Very weak'), weak.status);
    const strong = run('password-entropy', 'correct horse battery staple');
    assert(out(strong).includes('lowercase letters, spaces'), out(strong).split('\n')[1]);
    assert(/Strong|Very strong/.test(strong.status), strong.status);
  });

  // ---- network ----
  check('cidr-calculator: /27 math', () => {
    const text = out(run('cidr-calculator', '192.168.1.130/27'));
    assert(text.includes('192.168.1.128') && text.includes('192.168.1.159'), 'network/broadcast:\n' + text);
    assert(text.includes('255.255.255.224'), 'netmask');
    assert(text.includes('30'), 'usable hosts');
    assert(text.includes('Private range'), 'range note');
  });
  check('cidr-calculator: /31, /32, /0 edge cases', () => {
    assert(out(run('cidr-calculator', '10.0.0.0/31')).includes('point-to-point'));
    assert(out(run('cidr-calculator', '8.8.8.8')).includes('Public range'));
    assert(out(run('cidr-calculator', '0.0.0.0/0')).includes('4,294,967,296'));
    throws(() => run('cidr-calculator', '10.0.0.256/24'), 'valid IPv4');
    throws(() => run('cidr-calculator', '10.0.0.0/33'), 'Prefix');
  });
  check('cidr-calculator: builds smallest CIDR from a range', () => {
    const exact = out(run('cidr-calculator', '192.168.1.128 - 192.168.1.159'));
    assert(exact.includes('Smallest CIDR covering 192.168.1.128 - 192.168.1.159: 192.168.1.128/27'), exact);
    assert(exact.includes('192.168.1.159'), 'broadcast shown');
    const uneven = out(run('cidr-calculator', '10.0.0.5 - 10.0.0.9'));
    assert(uneven.includes('10.0.0.0/28'), 'rounds up to smallest containing block: ' + uneven);
    throws(() => run('cidr-calculator', '10.0.0.10 - 10.0.0.5'), 'before start');
    const single = out(run('cidr-calculator', '10.0.0.5 - 10.0.0.5'));
    assert(single.includes('10.0.0.5/32'), 'single IP -> /32: ' + single);
    const whole = out(run('cidr-calculator', '0.0.0.0 - 255.255.255.255'));
    assert(whole.includes('0.0.0.0/0'), 'full space -> /0: ' + whole);
  });
  check('url-parser: decodes into field lines', () => {
    const text = out(run('url-parser', examples['url-parser']));
    assert(text.includes('host: api.example.com'), 'host');
    assert(text.includes('port: 8443'), 'port');
    assert(text.includes('query.q: dev tools'), 'query param decoded');
    assert(text.includes('query.page: 2'), 'query param per line');
    assert(out(run('url-parser', 'example.com/x')).includes('assumed https://'), 'scheme note');
    throws(() => run('url-parser', 'mailto:dev@example.com'), 'no host');
  });
  check('url-parser: builds a URL from field lines', () => {
    const built = out(run('url-parser', 'scheme: https\nhost: api.example.com\nport: 8443\npath: /v1/search\nquery: q=dev+tools&page=2'));
    assert(built === 'https://api.example.com:8443/v1/search?q=dev+tools&page=2', built);
    throws(() => run('url-parser', 'scheme: https\npath: /x'), 'host');
  });
  check('url-parser: validates components and rejects bad fields', () => {
    throws(() => run('url-parser', 'scheme: https\nhost: trusted.example@evil.example'), 'Invalid host');
    throws(() => run('url-parser', 'scheme: ht tps\nhost: example.com'), 'Invalid scheme');
    throws(() => run('url-parser', 'host: example.com\nport: 99999'), 'Invalid port');
    throws(() => run('url-parser', 'host: example.com\nbogus: x'), 'Unknown field');
    throws(() => run('url-parser', 'host: a.com\nhost: b.com'), 'Duplicate');
    assert(out(run('url-parser', 'user: alice\nhost: example.com')).includes('alice@'), 'user alias');
  });
  check('url-parser: query.name lines build query params', () => {
    const built = out(run('url-parser', 'host: example.com\nquery.q: dev tools\nquery.page: 2'));
    assert(built === 'https://example.com/?q=dev+tools&page=2', built);
  });
  check('url-parser: round-trips decode -> edit -> build', () => {
    const decoded = out(run('url-parser', examples['url-parser']));
    const edited = decoded.replace('port: 8443', 'port: 9000');
    const rebuilt = out(run('url-parser', edited));
    assert(rebuilt.includes(':9000'), `expected edited port in ${rebuilt}`);
  });
  check('http-headers: annotates known and custom', () => {
    const result = run('http-headers', examples['http-headers']);
    const text = out(result);
    assert(text.includes('▶ Request line: GET /api/v1/users'), 'request line');
    assert(text.includes('Never log this value'), 'authorization note');
    assert(result.status.includes('recognized'), result.status);
  });
  await checkAsync('dns-lookup: live DoH query (needs network)', async () => {
    const result = await run('dns-lookup', 'example.com A');
    const text = out(result);
    assert(text.includes('NOERROR'), 'status: ' + text.split('\n')[0]);
    assert(/\d+\.\d+\.\d+\.\d+/.test(text), 'no A record in output:\n' + text);
  });
  check('dns-lookup: rejects junk', () => {
    return Promise.all([
      run('dns-lookup', 'not a domain').then(() => { throw new Error('should reject'); }, () => {}),
      run('dns-lookup', 'example.com BOGUS').then(() => { throw new Error('should reject'); }, () => {})
    ]);
  });

  // ---- text tools ----
  check('regex-tester: named groups and marking', () => {
    const result = run('regex-tester', examples['regex-tester']);
    const text = out(result);
    assert(text.includes('<user>: "alice"'), 'named group:\n' + text);
    assert(text.includes('«alice@example.com»'), 'marked text');
    assert(run('regex-tester', '/zzz/\nno match here').status === 'No matches.', 'no-match status');
    throws(() => run('regex-tester', '/[/\ntext'), 'Invalid regular expression');
  });
  check('case-converter: camelCase input to all styles', () => {
    const text = out(run('case-converter', 'userProfileSettings v2'));
    assert(text.includes('user_profile_settings_v2'), 'snake:\n' + text);
    assert(text.includes('UserProfileSettingsV2'), 'pascal');
    assert(text.includes('user-profile-settings-v2'), 'kebab');
    assert(text.includes('USER_PROFILE_SETTINGS_V2'), 'constant');
  });
  check('slug-generator: diacritics and symbols', () => {
    assert(out(run('slug-generator', 'Crème Brûlée & Friends!')) === 'creme-brulee-friends');
    assert(out(run('slug-generator', examples['slug-generator'])) === 'hello-world-dev-toolbox-2-0-beta');
  });

  // ---- devops ----
  check('docker-linter: flags expected issues', () => {
    const result = run('docker-linter', examples['docker-linter']);
    const text = out(result);
    assert(text.includes('no tag'), 'latest tag');
    assert(text.includes('MAINTAINER'), 'maintainer');
    assert(text.includes('rm -rf /var/lib/apt/lists'), 'apt cleanup');
    assert(text.includes('WORKDIR') && text.includes('cd'), 'cd advice');
    assert(text.includes('root'), 'user warning');
    assert(text.includes('exec form'), 'cmd shell form');
  });
  check('docker-linter: clean file passes', () => {
    const clean = 'FROM node:20.11-slim\nWORKDIR /app\nCOPY package.json .\nRUN npm ci\nCOPY . .\nUSER node\nHEALTHCHECK CMD curl -f http://localhost:3000/health\nEXPOSE 3000\nCMD ["node", "server.js"]';
    const result = run('docker-linter', clean);
    assert(out(result).includes('No issues'), out(result));
  });
  check('docker-linter: builds a Dockerfile from field lines', () => {
    const built = out(run('docker-linter', 'image: node:20-alpine\nworkdir: /app\ncopy: . .\nrun: npm ci\nexpose: 8080\nuser: node\ncmd: npm start'));
    assert(built.includes('FROM node:20-alpine'), built);
    assert(built.includes('WORKDIR /app'), built);
    assert(built.includes('CMD ["npm","start"]'), built);
    assert(built.includes('USER node'), built);
    throws(() => run('docker-linter', 'workdir: /app'), 'image');
    const linted = out(run('docker-linter', built));
    assert(!linted.includes('[error]') && !linted.includes('[warn]'), 'built file should have no error/warn lint issues:\n' + linted);
  });
  check('docker-linter: build mode preserves order and validates fields', () => {
    const built = out(run('docker-linter', 'image: alpine:3.20\nrun: pwd\nworkdir: /app\nrun: ls'));
    const lines = built.trim().split('\n');
    assert(lines.join('|') === 'FROM alpine:3.20|RUN pwd|WORKDIR /app|RUN ls', 'input order preserved: ' + built);
    const json = out(run('docker-linter', 'image: alpine:3.20\ncmd: ["node", "-e", "console.log(\'hello world\')"]'));
    assert(json.includes(`CMD ["node","-e","console.log('hello world')"]`), 'JSON array cmd: ' + json);
    throws(() => run('docker-linter', 'image: alpine\ncmd: node -e "console.log(1)"'), 'JSON array');
    throws(() => run('docker-linter', 'image:'), 'needs a value');
    throws(() => run('docker-linter', 'image: a\nimage: b'), 'only be given once');
    throws(() => run('docker-linter', 'image: a\ncmd: x\ncmd: y'), 'only be given once');
  });
  check('compose-validator: valid example passes', () => {
    const result = run('compose-validator', examples['compose-validator']);
    assert(out(result).includes('✓'), out(result));
  });
  check('compose-validator: catches structural problems', () => {
    const bad = 'version: "3.8"\nservices:\n  web:\n    ports:\n      - "bad:port"\n    depends_on:\n      - ghost\n  api:\n    image: node\n    restart: sometimes\n';
    const text = out(run('compose-validator', bad));
    assert(text.includes('needs either "image" or "build"'), 'image/build:\n' + text);
    assert(text.includes('unknown service "ghost"'), 'depends_on');
    assert(text.includes('"bad:port"'), 'ports');
    assert(text.includes('version'), 'version warning');
    assert(text.includes('restart'), 'restart warning');
    assert(text.includes(':latest'), 'untagged image');
  });
  check('compose-validator: builds a Compose file from service blocks', () => {
    const built = out(run('compose-validator', 'service: web\nimage: nginx:1.27-alpine\nports: 8080:80\ndepends_on: api\nvolumes: site-data:/usr/share/nginx/html\n\nservice: api\nimage: node:20-alpine\nenvironment: NODE_ENV=production\nrestart: unless-stopped'));
    assert(built.includes('web:') && built.includes('api:'), built);
    assert(built.includes('site-data'), 'named volume collected: ' + built);
    throws(() => run('compose-validator', 'service: web\nports: 8080:80'), 'image');
    const validated = out(run('compose-validator', built));
    assert(validated.includes('✓'), 'built file should validate clean:\n' + validated);
  });
  check('compose-validator: build mode volume classification and validation', () => {
    const binds = out(run('compose-validator', 'service: app\nimage: alpine:3.20\nvolumes: ${DATA_DIR}:/data, ~/data:/home, C:\\data:/win, ./src:/src'));
    assert(!binds.includes('volumes:\n') || !/^volumes:/m.test(binds), 'no top-level volumes for bind mounts:\n' + binds);
    const named = out(run('compose-validator', 'service: app\nimage: alpine:3.20\nvolumes: cache:/var/cache'));
    assert(/^volumes:/m.test(named) && named.includes('cache'), 'named volume still declared: ' + named);
    throws(() => run('compose-validator', 'service: web\nimage: a:1\n\nservice: web\nimage: b:1'), 'more than once');
    throws(() => run('compose-validator', 'service: web\nimage: a:1\nport: 8080:80'), 'Unknown field');
    throws(() => run('compose-validator', 'service: web\nimage: a:1\nimage: b:1'), 'more than once');
  });
  check('cron-builder: parses and finds next runs', () => {
    const result = run('cron-builder', '*/15 9-17 * * MON-FRI');
    const text = out(result);
    assert(text.includes('MON-FRI'), 'table');
    const dates = text.match(/^  \w{3} \w{3} \d{2} \d{4} \d{2}:\d{2}/gm);
    assert(dates && dates.length === 3, 'expected 3 next runs:\n' + text);
    for (const d of dates) {
      const parsed = new Date(d.trim());
      assert([1, 2, 3, 4, 5].includes(parsed.getDay()), 'weekday only: ' + d);
      assert(parsed.getHours() >= 9 && parsed.getHours() <= 17, 'hour window: ' + d);
      assert(parsed.getMinutes() % 15 === 0, 'quarter hour: ' + d);
    }
  });
  check('cron-builder: macros, Feb 30, and errors', () => {
    assert(out(run('cron-builder', '@daily')).includes('0 0 * * *'), 'macro');
    assert(out(run('cron-builder', '0 0 30 2 *')).includes('no run within'), 'feb 30 never fires');
    throws(() => run('cron-builder', '* * *'), '5 fields');
    throws(() => run('cron-builder', '99 * * * *'), 'out of range');
    throws(() => run('cron-builder', '* * * * FUNDAY'), 'not a number');
  });
  check('cron-builder: builds an expression from field lines', () => {
    const text = out(run('cron-builder', 'minute: */15\nhour: 9-17\nweekday: MON-FRI'));
    assert(text.includes('Built from field lines: */15 9-17 * * MON-FRI'), text);
    assert(text.includes('MON-FRI'), 'table reflects built expression');
    const allStar = out(run('cron-builder', 'hour: 3'));
    assert(allStar.includes('Built from field lines: * 3 * * *'), 'missing fields default to *: ' + allStar);
  });
  check('cron-builder: GUI form spec serializes to valid input', () => {
    const spec = ToolKit.forms['cron-builder'];
    assert(spec && spec.fields.length === 6, 'form spec registered');
    assert(spec.toInput({ preset: '@daily' }) === '@daily', 'preset wins');
    const built = spec.toInput({ preset: '', minute: '0', hour: '9', weekday: 'MON-FRI' });
    assert(built === 'minute: 0\nhour: 9\nweekday: MON-FRI', built);
    assert(out(run('cron-builder', built)).includes('Built from field lines: 0 9 * * MON-FRI'), 'form output runs');
    assert(out(run('cron-builder', spec.toInput({}))).includes('* * * * *') || out(run('cron-builder', spec.toInput({}))).includes('every minute'), 'empty form still runs');
  });
  check('cron-builder: field-line validation', () => {
    throws(() => run('cron-builder', 'minute: 0\nhours: 9'), 'Unknown cron field');
    throws(() => run('cron-builder', 'minute: 0\nmin: 30'), 'more than once');
    throws(() => run('cron-builder', 'minute: 0\nhour:'), 'needs a value');
  });
  check('gitignore-builder: combines and aliases', () => {
    const text = out(run('gitignore-builder', 'node, py, macos'));
    assert(text.includes('node_modules/') && text.includes('__pycache__/') && text.includes('.DS_Store'), text.slice(0, 120));
    throws(() => run('gitignore-builder', 'cobol'), 'Unknown template');
  });

  // ---- generators ----
  check('uuid-generator: count and format', () => {
    const list = out(run('uuid-generator', '5')).split('\n');
    assert(list.length === 5, 'count');
    for (const u of list) assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(u), 'v4 format: ' + u);
    assert(out(run('uuid-generator', '')).split('\n').length === 1, 'default 1');
    assert(out(run('uuid-generator', '9999')).split('\n').length === 100, 'cap 100');
  });
  check('timestamp-converter: seconds, ms, ISO, now', () => {
    const text = out(run('timestamp-converter', '1721044800'));
    assert(text.includes('2024-07-15T12:00:00.000Z'), text);
    assert(out(run('timestamp-converter', '1721044800000')).includes('2024-07-15T12:00:00.000Z'), 'ms');
    assert(out(run('timestamp-converter', '2026-07-15T00:00:00Z')).includes('1784073600'), 'iso -> unix');
    assert(out(run('timestamp-converter', '')).includes('current time'), 'empty = now');
    throws(() => run('timestamp-converter', 'not a date'), 'Unix timestamp');
  });
  check('random-string: length, charset, uniqueness', () => {
    const hex = out(run('random-string', '48 hex'));
    assert(/^[0-9a-f]{48}$/.test(hex), 'hex 48: ' + hex);
    const alnum = out(run('random-string', ''));
    assert(/^[A-Za-z0-9]{32}$/.test(alnum), 'default: ' + alnum);
    assert(out(run('random-string', '32')) !== out(run('random-string', '32')), 'not constant');
    throws(() => run('random-string', '3'), 'between 4 and 256');
    throws(() => run('random-string', '32 klingon'), 'Unknown option');
  });
  await checkAsync('qr-generator: encodes and renders', async () => {
    const result = await run('qr-generator', examples['qr-generator']);
    assert(result.format === 'qr', 'format flag');
    assert(result.output.includes('█') || result.output.includes('▀'), 'blocks rendered');
    assert(result.status.includes('QR version'), result.status);
    await run('qr-generator', 'x'.repeat(999)).then(
      () => { throw new Error('expected an error but none was thrown'); },
      (e) => assert(e.message.includes('too long'), e.message)
    );
  });
  await checkAsync('qr-generator: decode path needs a supporting browser', async () => {
    await run('qr-generator', 'decode-image:data:image/png;base64,iVBORw0KGgo=').then(
      () => { throw new Error('expected an error but none was thrown'); },
      (e) => assert(e.message.includes('BarcodeDetector'), e.message)
    );
  });
  await checkAsync('qr-generator: a literal data:image URL is encoded as text, not decoded', async () => {
    const result = await run('qr-generator', 'data:image/png;base64,iVBORw0KGgo=');
    assert(result.format === 'qr' && result.status.includes('QR version'), 'data URL encoded as QR payload: ' + result.status);
    await run('qr-generator', 'decode-image:not-a-data-url').then(
      () => { throw new Error('expected an error but none was thrown'); },
      (e) => assert(e.message.includes('data:image'), e.message)
    );
  });

  // ---- every tool's example runs without throwing ----
  for (const [id, example] of Object.entries(examples)) {
    await checkAsync(`example runs clean: ${id}`, async () => {
      const result = await run(id, example);
      assert(out(result).length > 0, 'empty output');
    });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
