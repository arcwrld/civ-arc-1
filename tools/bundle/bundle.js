#!/usr/bin/env node
'use strict';
// bundle - pack a folder of files into one HTML file, and unpack it again.
//
//   node tools/bundle/bundle.js pack   <folder> [--out FILE] [--title TEXT] [--json]
//   node tools/bundle/bundle.js unpack <file>   [--out DIR]  [--json]
//   node tools/bundle/bundle.js list   <file>   [--json]
//   node tools/bundle/bundle.js verify <file>   [--json]
//   node tools/bundle/bundle.js --help
//   node tools/bundle/bundle.js --version
//
// A bundle is one .html file that carries a folder inside it. You can open
// it on a machine with nothing installed, read what is in it, and take the
// files back out. Nothing in it reaches a network.
//
// The rules of a bundle live in the block marked BUNDLE-CORE below. That
// same block is spliced into bundle.html by tools/bundle/build.js, so the
// page and the command line cannot disagree about what a bundle is. The
// test suite fails if the two ever drift apart.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const NAME = 'bundle';
const VERSION = '1.0.0';
const TOOL_ID = NAME + '/' + VERSION;

/* BUNDLE-CORE-START */
(function (root) {
  'use strict';

  // The rules of a bundle, in one place. The page and the command line both
  // use this block, so the two cannot disagree about what a bundle is.

  var FORMAT = 'kit.bundle/1';

  // ----------------------------------------------------------------- sha256
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

  function sha256Hex(bytes) {
    var H = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ]);
    var len = bytes.length;
    var bitLen = len * 8;
    var total = ((len + 9 + 63) >> 6) << 6;
    var buf = new Uint8Array(total);
    buf.set(bytes);
    buf[len] = 0x80;
    var dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000), false);
    dv.setUint32(total - 4, bitLen >>> 0, false);

    var w = new Uint32Array(64);
    var i, b, a, bb, c, d, e, f, g, h, s0, s1, t1, t2;

    for (b = 0; b < total; b += 64) {
      for (i = 0; i < 16; i++) w[i] = dv.getUint32(b + i * 4, false);
      for (i = 16; i < 64; i++) {
        s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      a = H[0]; bb = H[1]; c = H[2]; d = H[3]; e = H[4]; f = H[5]; g = H[6]; h = H[7];
      for (i = 0; i < 64; i++) {
        s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        t1 = (h + s1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        t2 = (s0 + ((a & bb) ^ (a & c) ^ (bb & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + bb) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }

    var out = '';
    for (i = 0; i < 8; i++) out += ('00000000' + H[i].toString(16)).slice(-8);
    return out;
  }

  // ----------------------------------------------------------------- base64
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function bytesToBase64(bytes) {
    var out = '', i, n;
    for (i = 0; i + 2 < bytes.length; i += 3) {
      n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    var rem = bytes.length - i;
    if (rem === 1) {
      n = bytes[i] << 16;
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
    } else if (rem === 2) {
      n = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
    }
    return out;
  }

  function base64ToBytes(s) {
    s = String(s).replace(/[^A-Za-z0-9+/]/g, '');
    var out = [], i, n;
    for (i = 0; i + 3 < s.length; i += 4) {
      n = (B64.indexOf(s[i]) << 18) | (B64.indexOf(s[i + 1]) << 12) |
          (B64.indexOf(s[i + 2]) << 6) | B64.indexOf(s[i + 3]);
      out.push((n >> 16) & 255, (n >> 8) & 255, n & 255);
    }
    var rem = s.length - i;
    if (rem === 2) {
      n = (B64.indexOf(s[i]) << 18) | (B64.indexOf(s[i + 1]) << 12);
      out.push((n >> 16) & 255);
    } else if (rem === 3) {
      n = (B64.indexOf(s[i]) << 18) | (B64.indexOf(s[i + 1]) << 12) | (B64.indexOf(s[i + 2]) << 6);
      out.push((n >> 16) & 255, (n >> 8) & 255);
    }
    return new Uint8Array(out);
  }

  // -------------------------------------------------------------------- crc32
  var CRCTABLE = null;
  function crcTable() {
    if (CRCTABLE) return CRCTABLE;
    var t = new Uint32Array(256), c, n, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    CRCTABLE = t;
    return t;
  }

  function crc32(bytes) {
    var t = crcTable(), crc = 0xFFFFFFFF, i, c;
    for (i = 0; i < bytes.length; i++) {
      c = (crc ^ bytes[i]) & 0xFF;
      crc = (crc >>> 8) ^ t[c];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // ---------------------------------------------------------------------- zip
  // A .zip with everything stored and nothing compressed. Any unzip tool
  // reads it, and it needs no library to write.
  function buildZip(files, when) {
    var enc = new TextEncoder();
    var d = when || new Date();
    var dosTime = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
    var dosDate = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;

    var parts = [], central = [], offset = 0, i, j;

    for (i = 0; i < files.length; i++) {
      var nameBytes = enc.encode(files[i].name);
      var data = files[i].bytes;
      var crc = crc32(data);
      var size = data.length;

      var local = new Uint8Array(30 + nameBytes.length);
      var lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);
      lv.setUint32(22, size, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      var cd = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      cd.set(nameBytes, 46);

      parts.push(local, data);
      central.push(cd);
      offset += local.length + size;
    }

    var cdSize = 0;
    for (j = 0; j < central.length; j++) cdSize += central[j].length;

    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, central.length, true);
    ev.setUint16(10, central.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    var all = parts.concat(central, [eocd]);
    var total = 0;
    for (j = 0; j < all.length; j++) total += all[j].length;
    var out = new Uint8Array(total);
    var p = 0;
    for (j = 0; j < all.length; j++) { out.set(all[j], p); p += all[j].length; }
    return out;
  }

  // -------------------------------------------------------------------- paths
  // A path may only go down. Anything that could climb out of the folder it
  // belongs in is refused.
  function safePath(p) {
    if (typeof p !== 'string' || p === '') return null;
    var s = p.replace(/\\/g, '/');
    if (s.charAt(0) === '/') return null;
    if (/^[A-Za-z]:/.test(s)) return null;
    if (/[ -]/.test(s)) return null;
    var parts = [], segs = s.split('/'), i, seg;
    for (i = 0; i < segs.length; i++) {
      seg = segs[i];
      if (seg === '' || seg === '.') continue;
      if (seg === '..') return null;
      parts.push(seg);
    }
    if (!parts.length) return null;
    return parts.join('/');
  }

  // --------------------------------------------------------------------- text
  function isTextBytes(bytes) {
    var i;
    if (!bytes.length) return true;
    for (i = 0; i < bytes.length; i++) if (bytes[i] === 0) return false;
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      return false;
    }
    return true;
  }

  function textToBytes(s) {
    return new TextEncoder().encode(s == null ? '' : String(s));
  }

  function bytesToText(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
  }

  function decodeEntry(entry) {
    if (!entry) return new Uint8Array(0);
    if (entry.encoding === 'base64') return base64ToBytes(entry.content || '');
    return textToBytes(entry.content == null ? '' : entry.content);
  }

  function encodeEntry(bytes) {
    if (isTextBytes(bytes)) {
      return { encoding: 'utf8', content: bytesToText(bytes) };
    }
    return { encoding: 'base64', content: bytesToBase64(bytes) };
  }

  // ------------------------------------------------------------------ payload
  function payloadFromHtml(html) {
    var m = /<script type="application\/json" id="bundle-payload">([\s\S]*?)<\/script>/.exec(String(html));
    if (!m) return null;
    try {
      return JSON.parse(m[1]);
    } catch (e) {
      return null;
    }
  }

  function validatePayload(p) {
    var errors = [];
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      return { ok: false, errors: ['the payload is not an object'] };
    }
    if (p.format !== FORMAT) {
      errors.push('format is "' + p.format + '", expected "' + FORMAT + '"');
    }
    if (!Array.isArray(p.files)) {
      errors.push('"files" is not an array');
    } else {
      p.files.forEach(function (f, i) {
        if (!f || typeof f !== 'object') {
          errors.push('file ' + i + ' is not an object');
          return;
        }
        if (!safePath(f.path)) {
          errors.push('file ' + i + ' has an unusable path: "' + f.path + '"');
        }
        if (typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256)) {
          errors.push('file ' + i + ' has no usable sha256');
        }
        if (f.encoding !== 'utf8' && f.encoding !== 'base64') {
          errors.push('file ' + i + ' has an unknown encoding: "' + f.encoding + '"');
        }
      });
    }
    return { ok: errors.length === 0, errors: errors };
  }

  function totalSize(files) {
    var n = 0, i;
    for (i = 0; i < files.length; i++) {
      if (files[i] && typeof files[i].size === 'number') n += files[i].size;
    }
    return n;
  }

  function formatSize(n) {
    if (typeof n !== 'number' || !isFinite(n) || n < 0) return '?';
    if (n < 1024) return n + ' B';
    var units = ['KB', 'MB', 'GB', 'TB'], v = n / 1024, i = 0;
    while (v >= 1024 && i < units.length - 1) { v = v / 1024; i++; }
    return (v < 10 ? v.toFixed(1) : String(Math.round(v))) + ' ' + units[i];
  }

  // JSON that is safe to sit inside a <script> element: a "<" can never
  // appear, so the payload can never close the tag it lives in.
  function payloadToJson(p) {
    return JSON.stringify(p)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026');
  }

  root.BUNDLE_CORE = {
    FORMAT: FORMAT,
    sha256Hex: sha256Hex,
    bytesToBase64: bytesToBase64,
    base64ToBytes: base64ToBytes,
    crc32: crc32,
    buildZip: buildZip,
    safePath: safePath,
    isTextBytes: isTextBytes,
    textToBytes: textToBytes,
    bytesToText: bytesToText,
    decodeEntry: decodeEntry,
    encodeEntry: encodeEntry,
    payloadFromHtml: payloadFromHtml,
    payloadToJson: payloadToJson,
    validatePayload: validatePayload,
    totalSize: totalSize,
    formatSize: formatSize
  };
})(typeof module !== 'undefined' && module.exports ? module.exports :
   (typeof globalThis !== 'undefined' ? globalThis : this));
/* BUNDLE-CORE-END */

const CORE = module.exports.BUNDLE_CORE;

// ------------------------------------------------------------------ helpers

function usage() {
  return [
    'bundle ' + VERSION + ' - pack a folder into one HTML file, and unpack it again.',
    '',
    'Usage:',
    '  node tools/bundle/bundle.js pack   <folder> [options]  make one file that holds the folder',
    '  node tools/bundle/bundle.js unpack <file>   [options]  write the files back out again',
    '  node tools/bundle/bundle.js list   <file>   [options]  show what is inside',
    '  node tools/bundle/bundle.js verify <file>   [options]  check every file against its hash',
    '',
    'Options:',
    '  --out FILE    where to write (pack: the bundle file; unpack: the folder)',
    '  --title TEXT  the name shown inside the bundle',
    '  --json        machine-readable output',
    '  --help        this text',
    '  --version     the tool name and version',
    '',
    'Exit status:',
    '  0  the command succeeded (for verify: every file matches its hash)',
    '  1  the command failed (for verify: a file does not match its hash)',
    '  2  the command was used wrongly',
    '',
    'What bundle does not do: it does not compress your files, it does not',
    'encrypt them, it does not sign them, and it does not send anything',
    'anywhere. A bundle is readable by anyone who has the file.',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = { _: [], json: false, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { opts.json = true; continue; }
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    if (a === '--version' || a === '-v') { opts.version = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) opts[key] = true;
      else { opts[key] = next; i++; }
      continue;
    }
    opts._.push(a);
  }
  return opts;
}

function nowStamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// The page this tool packs into. It lives beside the tool so that a bundle
// carries the same face the reader already knows.
function templatePath() {
  return path.join(__dirname, 'bundle.html');
}

function readTemplate() {
  const p = templatePath();
  if (!fs.existsSync(p)) {
    throw new Error('the page template is missing: ' + p);
  }
  return fs.readFileSync(p, 'utf8');
}

// Put a payload into the page, and set its title.
function renderPage(html, payload) {
  const json = CORE.payloadToJson(payload);
  const re = /(<script type="application\/json" id="bundle-payload">)[\s\S]*?(<\/script>)/;
  if (!re.test(html)) {
    throw new Error('the page has no bundle payload element to fill');
  }
  let out = html.replace(re, (m, a, b) => a + json + b);
  const title = escapeHtml(String(payload.title || payload.root || 'bundle'));
  out = out.replace(/<title>[\s\S]*?<\/title>/, '<title>' + title + '</title>');
  return out;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ------------------------------------------------------------------ commands

function collectFiles(root, skip) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      throw new Error('cannot read ' + dir + ': ' + e.message);
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (skip && skip.has(path.resolve(full))) continue;
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) found.push({ abs: full, rel: rel });
    }
  };
  walk(root);
  return found;
}

function pack(folder, opts) {
  const abs = path.resolve(folder);
  let st;
  try {
    st = fs.statSync(abs);
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('no such folder: ' + folder);
    throw e;
  }
  if (!st.isDirectory()) {
    throw new Error(folder + ' is not a folder');
  }

  const rootName = path.basename(abs) || 'bundle';
  const outPath = opts.out
    ? path.resolve(opts.out)
    : path.resolve(rootName + '.bundle.html');
  const skip = new Set([path.resolve(outPath)]);

  const files = collectFiles(abs, skip);
  const entries = files.map((f) => {
    const bytes = fs.readFileSync(f.abs);
    const enc = CORE.encodeEntry(new Uint8Array(bytes));
    return {
      path: f.rel,
      size: bytes.length,
      sha256: CORE.sha256Hex(new Uint8Array(bytes)),
      encoding: enc.encoding,
      content: enc.content,
    };
  });

  const payload = {
    format: CORE.FORMAT,
    tool: TOOL_ID,
    root: rootName,
    title: opts.title || rootName,
    created: nowStamp(),
    files: entries,
  };

  const html = renderPage(readTemplate(), payload);
  fs.writeFileSync(outPath, html, 'utf8');

  return {
    action: 'pack',
    folder: abs,
    out: outPath,
    title: payload.title,
    created: payload.created,
    files: entries.length,
    bytes: fs.statSync(outPath).size,
    contents: entries.length,
  };
}

function loadPayload(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error('no such file: ' + file);
  const html = fs.readFileSync(abs, 'utf8');
  const payload = CORE.payloadFromHtml(html);
  if (!payload) {
    throw new Error(file + ' does not contain a bundle payload');
  }
  const check = CORE.validatePayload(payload);
  if (!check.ok) {
    throw new Error(file + ' is not a valid bundle: ' + check.errors.join('; '));
  }
  return { path: abs, payload: payload };
}

function list(file) {
  const loaded = loadPayload(file);
  const p = loaded.payload;
  return {
    action: 'list',
    file: path.basename(loaded.path),
    path: loaded.path,
    format: p.format,
    title: p.title || p.root,
    created: p.created,
    tool: p.tool,
    files: p.files.map((f) => ({
      path: f.path,
      size: f.size,
      sha256: f.sha256,
      encoding: f.encoding,
    })),
    count: p.files.length,
    bytes: CORE.totalSize(p.files),
  };
}

function verify(file) {
  const loaded = loadPayload(file);
  const p = loaded.payload;
  const bad = [];
  const results = p.files.map((f) => {
    const bytes = CORE.decodeEntry(f);
    const actual = CORE.sha256Hex(bytes);
    const ok = actual === f.sha256;
    if (!ok) bad.push(f.path);
    return { path: f.path, ok: ok, expected: f.sha256, actual: actual };
  });
  return {
    action: 'verify',
    file: path.basename(loaded.path),
    path: loaded.path,
    count: p.files.length,
    bad: bad,
    ok: bad.length === 0,
    results: results,
    message: bad.length === 0
      ? 'every file matches the hash it was packed with'
      : bad.length + ' file(s) do not match',
  };
}

function unpack(file, opts) {
  const loaded = loadPayload(file);
  const p = loaded.payload;
  const outDir = path.resolve(opts.out || (p.root || 'bundle') + '.unpacked');
  // The directory is made even when the bundle holds no files: an
  // empty folder must unpack to an empty folder that EXISTS, or the
  // reader cannot tell 'nothing was inside' from 'nothing was written'.
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  const bad = [];

  for (const f of p.files) {
    const safe = CORE.safePath(f.path);
    if (!safe) {
      throw new Error('refusing to write a file with an unusable path: ' + f.path);
    }
    const bytes = Buffer.from(CORE.decodeEntry(f));
    const actual = CORE.sha256Hex(new Uint8Array(bytes));
    if (actual !== f.sha256) {
      bad.push(f.path);
    }
    const dest = path.join(outDir, safe.split('/').join(path.sep));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bytes);
    written.push(safe);
  }

  return {
    action: 'unpack',
    file: path.basename(loaded.path),
    path: loaded.path,
    out: outDir,
    files: written.length,
    bytes: CORE.totalSize(p.files),
    bad: bad,
    written: written,
  };
}

// -------------------------------------------------------------------- output

function printHuman(res) {
  const L = [];
  if (res.action === 'pack') {
    L.push('packed  ' + res.folder);
    L.push('  title   ' + res.title);
    L.push('  files   ' + res.files);
    L.push('  bundle  ' + res.out + '  (' + res.bytes + ' bytes)');
  } else if (res.action === 'unpack') {
    L.push('unpacked  ' + res.file);
    L.push('  files   ' + res.files);
    L.push('  folder  ' + res.out);
    if (res.bad.length) {
      L.push('  WARNING  ' + res.bad.length + ' file(s) did not match their hash: ' + res.bad.join(', '));
    }
  } else if (res.action === 'list') {
    L.push(res.title + '  (' + res.file + ')');
    L.push('  format  ' + res.format);
    L.push('  made    ' + res.created + '  by ' + res.tool);
    L.push('  files   ' + res.count + ',  ' + res.bytes + ' bytes');
    L.push('');
    for (const f of res.files) {
      L.push('  ' + String(f.size).padStart(9) + '  ' + f.path);
    }
  } else if (res.action === 'verify') {
    L.push((res.ok ? 'match     ' : 'mismatch  ') + res.file);
    L.push('  files   ' + res.count);
    if (res.ok) {
      L.push('  ' + res.message);
    } else {
      for (const r of res.results) {
        if (!r.ok) {
          L.push('  ' + r.path);
          L.push('    expected sha256  ' + r.expected);
          L.push('    actual   sha256  ' + r.actual);
        }
      }
    }
  }
  return L.join('\n');
}

// ---------------------------------------------------------------------- main

function main(argv) {
  const opts = parseArgs(argv);

  if (opts.help) {
    process.stdout.write(usage() + '\n');
    return 0;
  }
  if (opts.version) {
    process.stdout.write(TOOL_ID + '\n');
    return 0;
  }

  const cmd = opts._[0];
  if (!cmd) {
    process.stdout.write(usage() + '\n');
    return 2;
  }
  if (['pack', 'unpack', 'list', 'verify'].indexOf(cmd) === -1) {
    process.stderr.write('bundle: unknown command "' + cmd + '"\n\n' +
      usage() + '\n');
    return 2;
  }
  const arg = opts._[1];
  if (!arg) {
    process.stderr.write('bundle: ' + cmd + ' needs ' +
      (cmd === 'pack' ? 'a folder' : 'a file') + '\n\n' + usage() + '\n');
    return 2;
  }

  let res;
  try {
    if (cmd === 'pack') res = pack(arg, opts);
    else if (cmd === 'unpack') res = unpack(arg, opts);
    else if (cmd === 'list') res = list(arg);
    else if (cmd === 'verify') res = verify(arg);
    else {
      process.stderr.write('bundle: unknown command "' + cmd + '"\n\n' + usage() + '\n');
      return 2;
    }
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      process.stderr.write('bundle: no such file: ' + arg + '\n');
      return 2;
    }
    process.stderr.write('bundle: ' + (e && e.message ? e.message : String(e)) + '\n');
    return 2;
  }

  if (opts.json) process.stdout.write(JSON.stringify(res, null, 2) + '\n');
  else process.stdout.write(printHuman(res) + '\n');

  if (cmd === 'verify') return res.ok ? 0 : 1;
  if (cmd === 'unpack' && res.bad.length) return 1;
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  CORE,
  pack,
  unpack,
  list,
  verify,
  renderPage,
  readTemplate,
  usage,
  sha256,
  NAME,
  VERSION,
  TOOL_ID,
  FORMAT: CORE.FORMAT,
};
