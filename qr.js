/*
 * Minimal dependency-free QR code encoder.
 * Byte mode, error correction level M, versions 1-10 (up to ~210 bytes of UTF-8).
 * Exposes: QR.encodeText(text) -> { modules, size, version, mask }
 *          QR.toHalfBlocks(modules) -> string rendered with Unicode half blocks
 */
(function (global) {
  'use strict';

  // ---- GF(256) arithmetic (primitive polynomial 0x11d) ----
  const GF_EXP = new Uint8Array(512);
  const GF_LOG = new Uint8Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  // Reed-Solomon generator polynomial of the given degree (highest power first, leading 1 dropped).
  function rsDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }

  function rsRemainder(data, divisor) {
    const result = new Array(divisor.length).fill(0);
    for (const b of data) {
      const factor = b ^ result.shift();
      result.push(0);
      for (let i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], factor);
    }
    return result;
  }

  // ---- Version tables, error correction level M ----
  // [ecCodewordsPerBlock, [[blockCount, dataCodewordsPerBlock], ...]]
  const ECC_M = {
    1: [10, [[1, 16]]],
    2: [16, [[1, 28]]],
    3: [26, [[1, 44]]],
    4: [18, [[2, 32]]],
    5: [24, [[2, 43]]],
    6: [16, [[4, 27]]],
    7: [18, [[4, 31]]],
    8: [22, [[2, 38], [2, 39]]],
    9: [22, [[3, 36], [2, 37]]],
    10: [26, [[4, 43], [1, 44]]]
  };

  const ALIGNMENT_POS = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };

  const MAX_VERSION = 10;

  function dataCapacityBytes(version) {
    return ECC_M[version][1].reduce((sum, [count, len]) => sum + count * len, 0);
  }

  function charCountBits(version) {
    return version <= 9 ? 8 : 16; // byte mode
  }

  // ---- Bit buffer ----
  function BitBuffer() {
    this.bits = [];
  }
  BitBuffer.prototype.append = function (value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  };
  BitBuffer.prototype.toBytes = function () {
    const bytes = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((bit, i) => { bytes[i >>> 3] |= bit << (7 - (i & 7)); });
    return bytes;
  };

  function encodeData(bytes, version) {
    const capacityBits = dataCapacityBytes(version) * 8;
    const bb = new BitBuffer();
    bb.append(0b0100, 4); // byte mode
    bb.append(bytes.length, charCountBits(version));
    for (const b of bytes) bb.append(b, 8);
    // Terminator + pad to byte boundary
    bb.append(0, Math.min(4, capacityBits - bb.bits.length));
    bb.append(0, (8 - bb.bits.length % 8) % 8);
    // Pad codewords
    for (let pad = 0xec; bb.bits.length < capacityBits; pad ^= 0xec ^ 0x11) bb.append(pad, 8);
    return bb.toBytes();
  }

  function addEccAndInterleave(data, version) {
    const [ecLen, groups] = ECC_M[version];
    const divisor = rsDivisor(ecLen);
    const blocks = [];
    let offset = 0;
    for (const [count, dataLen] of groups) {
      for (let i = 0; i < count; i++) {
        const block = Array.from(data.slice(offset, offset + dataLen));
        offset += dataLen;
        blocks.push({ data: block, ec: rsRemainder(block, divisor) });
      }
    }
    const result = [];
    const maxDataLen = Math.max(...blocks.map(b => b.data.length));
    for (let i = 0; i < maxDataLen; i++) {
      for (const block of blocks) if (i < block.data.length) result.push(block.data[i]);
    }
    for (let i = 0; i < ecLen; i++) {
      for (const block of blocks) result.push(block.ec[i]);
    }
    return result;
  }

  // ---- Matrix construction ----
  function Matrix(version) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
  }
  Matrix.prototype.set = function (col, row, dark) {
    this.modules[row][col] = dark;
    this.isFunction[row][col] = true;
  };

  function drawFinder(m, cx, cy) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || x >= m.size || y < 0 || y >= m.size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        m.set(x, y, dist !== 2 && dist !== 4);
      }
    }
  }

  function drawAlignment(m, cx, cy) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        m.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  function drawFunctionPatterns(m, version) {
    for (let i = 0; i < m.size; i++) {
      m.set(6, i, i % 2 === 0);
      m.set(i, 6, i % 2 === 0);
    }
    drawFinder(m, 3, 3);
    drawFinder(m, m.size - 4, 3);
    drawFinder(m, 3, m.size - 4);

    const pos = ALIGNMENT_POS[version];
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        const skip = (i === 0 && j === 0)
          || (i === 0 && j === pos.length - 1)
          || (i === pos.length - 1 && j === 0);
        if (!skip) drawAlignment(m, pos[i], pos[j]);
      }
    }

    drawFormatBits(m, 0); // reserve format areas; rewritten after masking
    drawVersionBits(m, version);
  }

  function getBit(value, i) {
    return ((value >>> i) & 1) !== 0;
  }

  function drawFormatBits(m, mask) {
    const eccBits = 0b00; // level M
    const data = (eccBits << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;

    for (let i = 0; i <= 5; i++) m.set(8, i, getBit(bits, i));
    m.set(8, 7, getBit(bits, 6));
    m.set(8, 8, getBit(bits, 7));
    m.set(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) m.set(14 - i, 8, getBit(bits, i));

    for (let i = 0; i < 8; i++) m.set(m.size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) m.set(8, m.size - 15 + i, getBit(bits, i));
    m.set(8, m.size - 8, true); // dark module
  }

  function drawVersionBits(m, version) {
    if (version < 7) return;
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = getBit(bits, i);
      const a = m.size - 11 + i % 3;
      const b = Math.floor(i / 3);
      m.set(a, b, bit);
      m.set(b, a, bit);
    }
  }

  function drawCodewords(m, data) {
    let i = 0;
    for (let right = m.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < m.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? m.size - 1 - vert : vert;
          if (!m.isFunction[y][x] && i < data.length * 8) {
            m.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  function maskBit(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return (x * y) % 2 + (x * y) % 3 === 0;
      case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
      case 7: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
    }
  }

  function applyMask(m, mask) {
    for (let y = 0; y < m.size; y++) {
      for (let x = 0; x < m.size; x++) {
        if (!m.isFunction[y][x]) m.modules[y][x] = m.modules[y][x] !== maskBit(mask, x, y);
      }
    }
  }

  function penaltyScore(m) {
    const size = m.size;
    const mod = m.modules;
    let score = 0;

    // Rule 1: runs of 5+ same-colored modules in rows and columns
    for (let axis = 0; axis < 2; axis++) {
      for (let i = 0; i < size; i++) {
        let runColor = null, runLen = 0;
        for (let j = 0; j < size; j++) {
          const c = axis === 0 ? mod[i][j] : mod[j][i];
          if (c === runColor) {
            runLen++;
            if (runLen === 5) score += 3;
            else if (runLen > 5) score += 1;
          } else {
            runColor = c;
            runLen = 1;
          }
        }
      }
    }

    // Rule 2: 2x2 blocks of same color
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = mod[y][x];
        if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) score += 3;
      }
    }

    // Rule 3: finder-like pattern 10111010000 (either direction) in rows and columns
    const P1 = [true, false, true, true, true, false, true, false, false, false, false];
    const P2 = [...P1].reverse();
    for (let axis = 0; axis < 2; axis++) {
      for (let i = 0; i < size; i++) {
        for (let j = 0; j <= size - 11; j++) {
          let match1 = true, match2 = true;
          for (let k = 0; k < 11; k++) {
            const c = axis === 0 ? mod[i][j + k] : mod[j + k][i];
            if (c !== P1[k]) match1 = false;
            if (c !== P2[k]) match2 = false;
          }
          if (match1) score += 40;
          if (match2) score += 40;
        }
      }
    }

    // Rule 4: deviation of dark-module proportion from 50%
    let dark = 0;
    for (const row of mod) for (const c of row) if (c) dark++;
    const total = size * size;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
  }

  function encodeBytes(bytes, forcedMask) {
    let version = null;
    for (let v = 1; v <= MAX_VERSION; v++) {
      if (4 + charCountBits(v) + bytes.length * 8 <= dataCapacityBytes(v) * 8) {
        version = v;
        break;
      }
    }
    if (version === null) {
      throw new Error(`Input is too long: ${bytes.length} bytes exceeds the ${dataCapacityBytes(MAX_VERSION) - 3}-byte limit of this encoder.`);
    }

    const codewords = addEccAndInterleave(encodeData(bytes, version), version);
    const m = new Matrix(version);
    drawFunctionPatterns(m, version);
    drawCodewords(m, codewords);

    let mask = forcedMask;
    if (mask === undefined) {
      let best = Infinity;
      for (let i = 0; i < 8; i++) {
        applyMask(m, i);
        drawFormatBits(m, i);
        const score = penaltyScore(m);
        if (score < best) {
          best = score;
          mask = i;
        }
        applyMask(m, i); // undo (masking is XOR, self-inverse)
      }
    }
    applyMask(m, mask);
    drawFormatBits(m, mask);

    return { modules: m.modules, size: m.size, version, mask };
  }

  function encodeText(text, forcedMask) {
    return encodeBytes(new TextEncoder().encode(text), forcedMask);
  }

  function toHalfBlocks(modules, quietZone = 4) {
    const size = modules.length;
    const dim = size + quietZone * 2;
    const get = (r, c) => {
      r -= quietZone;
      c -= quietZone;
      return r >= 0 && r < size && c >= 0 && c < size && modules[r][c];
    };
    const rows = [];
    for (let r = 0; r < dim; r += 2) {
      let line = '';
      for (let c = 0; c < dim; c++) {
        const top = get(r, c), bottom = get(r + 1, c);
        line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
      }
      rows.push(line);
    }
    return rows.join('\n');
  }

  const QR = { encodeText, encodeBytes, toHalfBlocks };
  if (typeof module !== 'undefined' && module.exports) module.exports = QR;
  else global.QR = QR;
})(typeof window !== 'undefined' ? window : globalThis);
