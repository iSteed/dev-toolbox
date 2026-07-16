# Dev Toolbox  

70 developer utilities on one bench. Static and dependency-free — no build
step, no packages, no accounts. Everything runs in your browser.

## Run

Open `index.html` directly, or serve the folder locally:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## The bench

The whole page is one workspace: input on the left, output on the right,
and the **run key** on the pipe between them. Most tools run live as you
type — the `auto` mark under the run key tells you when that's on. Three
tools wait for the key instead: DNS Lookup (it goes to the network) and the
UUID / Random String generators (so results don't churn while you type).

- **⇄ To input** moves the current output into the input — chain tools
  like shell pipes (decode a JWT, then diff the payloads, then slugify…).
- **Pin** tools with the ★ button; pinned tools stay at the top of the rail.
- Tools that take two inputs (JSON Diff, Text Diff, HMAC) separate them
  with a line containing only `---`. Every tool has an example built in.

Keyboard: `/` focuses search, `↑`/`↓` walk the rail, `Enter` opens,
`Ctrl+Enter` runs, `Esc` clears/closes.

## Tools

| Category | Tools |
| --- | --- |
| Data | JSON Formatter · JSON Transform (minify/pretty/sort) · JSON Merge · JSON ⇄ CSV · JSON Schema · JSONPath · YAML ⇄ JSON · CSV Viewer · JSON Diff · XML Formatter |
| Encode & Convert | Base64 · URL Encode · HTML Entities · Unicode Escape · Hex ⇄ Text · Binary ⇄ Text · Quoted-Printable · Punycode/IDNA · ROT13 · Morse · UTF-8 Inspector · Hex Dump · ASCII Table · Base Converter · Roman Numerals |
| Web & Format | HTML Formatter · HTML ⇄ Markdown · Markdown TOC · SQL Formatter · CSV → SQL INSERT · Color Converter · Contrast Checker |
| Security | JWT Decoder · JWT Generator · Hash Generator (MD5/CRC32/SHA/HMAC) · CSP Builder · Password Entropy |
| Network | CIDR Calculator · IP Calculator · URL Parser · HTTP Header Inspector · HTTP Status Codes · DNS Lookup · Reverse DNS · Port Lookup · MIME Lookup · Cookie Parser · Query String · curl Builder · File Signature |
| Text | Regex Tester · Case Converter · Text Diff · Text Counter · Line Tools · Slug Generator |
| DevOps | Dockerfile Linter · Compose Validator · Cron Builder · .gitignore Builder |
| Generators | UUID (v4/v7) · ULID/NanoID · Timestamp Converter · Random String · Passphrase · Lorem Ipsum · Luhn/Test Cards · QR Generator |

Direction is auto-detected on the reversible tools (Base64, Hex, Morse,
Punycode…): paste either form and it does the right thing.

## Notes

- Everything computes locally, with two deliberate exceptions: **DNS Lookup**
  and **Reverse DNS** query Cloudflare DNS-over-HTTPS (a lookup inherently
  needs the network). Every other tool is pure client-side computation.
- The Hash Generator uses Web Crypto, which requires a secure context —
  `http://localhost` and `file://` both qualify.
- The QR encoder (`qr.js`) is a from-scratch implementation (byte mode,
  ECC level M, versions 1–10) rendered with Unicode half blocks.
- The YAML converter uses a purpose-built subset parser: block/flow
  mappings and sequences, quoted scalars, and literal/folded block scalars.
  Anchors, aliases, tags, and multi-document streams are rejected clearly.
- Pinned tools, theme, and the last open tool persist in `localStorage`.
  Theme follows your OS preference until you toggle it.

## Files

- `index.html` — page structure
- `styles.css` — theme and layout (dark/light, responsive)
- `app.js` — UI state: rail, search, pins, live runs, the bench
- `tools.js` — core tool implementations + shared helpers
- `tools-encode.js` — encoding, numbers, text, and generator tools
- `tools-web.js` — web formats, colors, and networking tools
- `qr.js` — standalone QR code encoder
- `tests/` — Node-based test suites (no packages needed)

Each `tools-*.js` pack registers into the `ToolKit` that `tools.js` creates,
so adding a category of tools is a self-contained file plus a few rail entries
in `app.js` — nothing else needs to change.

## Tests

```bash
node tests/tools.test.js   # exercises the core tool implementations
node tests/packs.test.js   # exercises the encode + web tool packs
node tests/qr.test.js      # compares qr.js against the python "qrcode"
                           # library bit-for-bit (skips if not installed)
```
