// Compare qr.js output against the python qrcode library for all 8 masks
// and a range of payload sizes covering versions 1-10.
const { execFileSync } = require('child_process');
const QR = require('../qr.js');

try {
  execFileSync('python3', ['-c', 'import qrcode'], { stdio: 'ignore' });
} catch (e) {
  console.log('SKIP: reference comparison needs the python "qrcode" package (pip install qrcode).');
  process.exit(0);
}

const cases = [
  'A',                                    // v1
  'https://example.com',                  // v1-2
  'Dev Toolbox prototype QR test 12345',  // v2-3
  'x'.repeat(60),                         // ~v4
  'x'.repeat(100),                        // ~v5-6
  'The quick brown fox jumps over the lazy dog. '.repeat(3), // ~v7-8
  'x'.repeat(180),                        // v9
  'x'.repeat(210),                        // v10 (16-bit char count path)
  'UTF-8 check: héllo wörld ✓ 日本語',     // multibyte
];

let failures = 0;
for (const text of cases) {
  for (let mask = 0; mask < 8; mask++) {
    const mine = QR.encodeText(text, mask);
    const ref = execFileSync('python3', [__dirname + '/qr_ref.py', text, String(mask)], { encoding: 'utf8' })
      .trim().split('\n');
    const refVersion = parseInt(ref[0], 10);
    const refRows = ref.slice(1);
    const myRows = mine.modules.map(row => row.map(c => (c ? '1' : '0')).join(''));
    if (refVersion !== mine.version) {
      console.log(`VERSION MISMATCH "${text.slice(0, 30)}" mask ${mask}: mine v${mine.version}, ref v${refVersion}`);
      failures++;
      continue;
    }
    if (myRows.join('\n') !== refRows.join('\n')) {
      console.log(`MATRIX MISMATCH "${text.slice(0, 30)}" mask ${mask} (v${mine.version})`);
      failures++;
    }
  }
  const auto = QR.encodeText(text);
  console.log(`ok: "${text.slice(0, 40)}" -> v${auto.version}, auto mask ${auto.mask}`);
}

// Oversize input must throw
try {
  QR.encodeText('x'.repeat(300));
  console.log('FAIL: oversize input did not throw');
  failures++;
} catch (e) {
  console.log('ok: oversize throws:', e.message);
}

console.log(failures === 0 ? '\nALL QR TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
