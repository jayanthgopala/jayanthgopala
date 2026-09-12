import { deflateSync } from 'node:zlib';

// Pure-JS PNG encoder using node:zlib
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Adaptive filtering per row
function filterRows(pixels, width, height, channels) {
  const stride = width * channels;
  const out = Buffer.alloc((stride + 1) * height);
  const line = Buffer.alloc(stride);
  const best = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    const prev = row - stride;
    let bestType = 0;
    let bestScore = Infinity;

    for (let type = 0; type < 5; type += 1) {
      let score = 0;
      for (let i = 0; i < stride; i += 1) {
        const raw = pixels[row + i];
        const a = i >= channels ? pixels[row + i - channels] : 0;
        const b = y > 0 ? pixels[prev + i] : 0;
        const c = y > 0 && i >= channels ? pixels[prev + i - channels] : 0;

        let v;
        if (type === 0) v = raw;
        else if (type === 1) v = raw - a;
        else if (type === 2) v = raw - b;
        else if (type === 3) v = raw - ((a + b) >> 1);
        else {
          /* Paeth: whichever of the three neighbours the gradient predicts. */
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = raw - pred;
        }

        v &= 0xff;
        line[i] = v;
        // Signed magnitude heuristic
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = type;
        line.copy(best);
      }
    }

    out[y * (stride + 1)] = bestType;
    best.copy(out, y * (stride + 1) + 1);
  }
  return out;
}

// Encodes tightly packed pixels (row-major) to PNG
export function encodePng(pixels, width, height, channels) {
  const colorType = channels === 1 ? 0 : channels === 3 ? 2 : 6;

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const idat = deflateSync(filterRows(pixels, width, height, channels), { level: 9 });

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
