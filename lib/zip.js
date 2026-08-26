// Hand-rolled ZIP writer — no archiver/jszip (unavailable to install; see
// plugin/README.md for the same network constraint). Built on Node's
// built-in `zlib.deflateRawSync`, which is the real DEFLATE algorithm ZIP
// itself uses, so this isn't a lesser stand-in the way lib/pdf.js is —
// it's a standard, spec-correct ZIP file, just assembled by hand instead
// of through a library. Verified against `unzip -t` locally (see
// scripts/local-smoke-test.mjs).

const zlib = require("node:zlib");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time =
    ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f);
  const day =
    (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
  return { time, day };
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n & 0xffff, 0);
  return b;
}
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

/**
 * @param {Array<{name: string, data: Buffer}>} entries
 * @returns {Buffer}
 */
function makeZip(entries) {
  const now = new Date();
  const { time, day } = dosDateTime(now);
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const deflated = zlib.deflateRawSync(entry.data);
    const useDeflate = deflated.length < entry.data.length;
    const method = useDeflate ? 8 : 0;
    const storedData = useDeflate ? deflated : entry.data;

    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20), // version needed
      u16(0), // general purpose flag
      u16(method),
      u16(time),
      u16(day),
      u32(crc),
      u32(storedData.length),
      u32(entry.data.length),
      u16(nameBuf.length),
      u16(0), // extra field length
      nameBuf,
    ]);

    const localOffset = offset;
    localChunks.push(localHeader, storedData);
    offset += localHeader.length + storedData.length;

    const centralHeader = Buffer.concat([
      u32(0x02014b50),
      u16(20), // version made by
      u16(20), // version needed
      u16(0), // flag
      u16(method),
      u16(time),
      u16(day),
      u32(crc),
      u32(storedData.length),
      u32(entry.data.length),
      u16(nameBuf.length),
      u16(0), // extra length
      u16(0), // comment length
      u16(0), // disk number
      u16(0), // internal attrs
      u32(0), // external attrs
      u32(localOffset),
      nameBuf,
    ]);
    centralChunks.push(centralHeader);
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const centralDirOffset = offset;

  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0), // disk number
    u16(0), // disk with central dir
    u16(entries.length), // entries on this disk
    u16(entries.length), // total entries
    u32(centralDirectory.length),
    u32(centralDirOffset),
    u16(0), // comment length
  ]);

  return Buffer.concat([...localChunks, centralDirectory, eocd]);
}

module.exports = { makeZip, crc32 };
