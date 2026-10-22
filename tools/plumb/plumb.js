#!/usr/bin/env node
'use strict';
// plumb - seal a file with a hash and a note; verify it later.
//
//   node tools/plumb/plumb.js seal   <file> [--note TEXT] [--source URL]
//                                        [--sidecar PATH] [--force] [--json]
//   node tools/plumb/plumb.js verify <file> [--sidecar PATH] [--json]
//   node tools/plumb/plumb.js show   <file> [--sidecar PATH] [--json]
//   node tools/plumb/plumb.js --help
//   node tools/plumb/plumb.js --version
//
// A sidecar is a small JSON file that records the SHA-256 of a file and any
// claims made about it. The sidecar format is shared by every tool in the
// kit, so a file that has been through more than one tool still carries one
// provenance trail. The format is written down in kit/CONTRACT.md, section 8.
//
// Plumb never modifies the file it describes. It reads a file, writes a
// separate sidecar next to it, and reads that sidecar back.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const NAME = 'plumb';
const VERSION = '1.0.0';
const TOOL_ID = NAME + '/' + VERSION;
const FORMAT = 'kit.provenance/1';

// ------------------------------------------------------------------ helpers

function usage() {
  return [
    'plumb ' + VERSION + ' - seal a file with a hash and a note, verify it later.',
    '',
    'Usage:',
    '  node tools/plumb/plumb.js seal   <file> [options]   hash the file and write a sidecar',
    '  node tools/plumb/plumb.js verify <file> [options]   check the file against its sidecar',
    '  node tools/plumb/plumb.js show   <file> [options]   print the sidecar',
    '',
    'Options:',
    '  --note TEXT      a note to record with the seal',
    '  --source URL     where the file came from',
    '  --sidecar PATH   use this sidecar path instead of <file>.provenance.json',
    '  --force          replace a sidecar that describes a different file',
    '  --json           machine-readable output',
    '  --help           this text',
    '  --version        the tool name and version',
    '',
    'Exit status:',
    '  0  the command succeeded (for verify: the file matches its sidecar)',
    '  1  the command failed (for verify: the file does not match its sidecar)',
    '  2  the command was used wrongly',
    '',
    'What plumb does not do: it does not modify your file, it does not upload',
    'anything, it does not sign anything, and it cannot tell you whether a',
    'file is good, only whether it is the same file you sealed.',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = { _: [], json: false, force: false, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { opts.json = true; continue; }
    if (a === '--force') { opts.force = true; continue; }
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

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sidecarPathFor(file, explicit) {
  if (explicit) return path.resolve(explicit);
  const abs = path.resolve(file);
  return path.join(path.dirname(abs), path.basename(abs) + '.provenance.json');
}

function writeSidecar(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function readSidecar(p) {
  const text = fs.readFileSync(p, 'utf8');
  return JSON.parse(text);
}

// ------------------------------------------------------------------ commands

function seal(file, opts) {
  const abs = path.resolve(file);
  const st = fs.statSync(abs);
  if (!st.isFile()) throw new Error(file + ' is not a regular file');
  const buf = fs.readFileSync(abs);
  const digest = sha256(buf);
  const scPath = sidecarPathFor(file, opts.sidecar);

  let obj = null;
  if (fs.existsSync(scPath)) {
    obj = readSidecar(scPath);
    if (obj.format !== FORMAT) {
      throw new Error(
        scPath + ' has format "' + obj.format + '", which this tool does not recognise'
      );
    }
    const prior = obj.file && obj.file.sha256;
    if (prior && prior !== digest && !opts.force) {
      throw new Error(
        scPath + ' describes a different file (sidecar ' + prior.slice(0, 12) +
        '..., this file ' + digest.slice(0, 12) + '...); refusing to overwrite. ' +
        'Use --force to replace it, or --sidecar to write somewhere else.'
      );
    }
  }

  if (!obj) {
    obj = { format: FORMAT, file: {}, claims: [] };
  }
  if (!Array.isArray(obj.claims)) obj.claims = [];

  obj.file.name = path.basename(abs);
  obj.file.size = st.size;
  obj.file.sha256 = digest;
  obj.claims.push({
    tool: TOOL_ID,
    at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    kind: 'seal',
    data: { note: opts.note || '', source: opts.source || '' },
  });

  writeSidecar(scPath, obj);
  return {
    action: 'seal',
    file: path.basename(abs),
    path: abs,
    size: st.size,
    sha256: digest,
    sidecar: scPath,
    claims: obj.claims.length,
    appended: obj.claims.length > 1,
  };
}

function verify(file, opts) {
  const abs = path.resolve(file);
  const scPath = sidecarPathFor(file, opts.sidecar);

  if (!fs.existsSync(scPath)) {
    return {
      action: 'verify',
      status: 'no-sidecar',
      file: path.basename(abs),
      sidecar: scPath,
      message: 'there is no sidecar at ' + scPath + ', so there is nothing to check against',
    };
  }

  let obj;
  try {
    obj = readSidecar(scPath);
  } catch (e) {
    return {
      action: 'verify',
      status: 'invalid-sidecar',
      file: path.basename(abs),
      sidecar: scPath,
      message: 'the sidecar is not valid JSON: ' + e.message,
    };
  }

  if (obj.format !== FORMAT) {
    return {
      action: 'verify',
      status: 'unknown-format',
      file: path.basename(abs),
      sidecar: scPath,
      format: obj.format,
      message:
        'the sidecar has format "' + obj.format + '", which this tool does not recognise',
    };
  }

  const st = fs.statSync(abs);
  const digest = sha256(fs.readFileSync(abs));
  const expected = obj.file && obj.file.sha256;
  const expectedSize = obj.file && obj.file.size;
  const match = expected === digest;

  return {
    action: 'verify',
    status: match ? 'match' : 'mismatch',
    file: path.basename(abs),
    path: abs,
    sidecar: scPath,
    size: st.size,
    expectedSize: expectedSize,
    expected: expected,
    actual: digest,
    sizeMatches: expectedSize === undefined || expectedSize === st.size,
    claims: Array.isArray(obj.claims) ? obj.claims : [],
    message: match
      ? 'the file is the file you sealed'
      : 'the file has changed since it was sealed',
  };
}

function show(file, opts) {
  const scPath = sidecarPathFor(file, opts.sidecar);
  if (!fs.existsSync(scPath)) {
    return {
      action: 'show',
      status: 'no-sidecar',
      file: path.basename(path.resolve(file)),
      sidecar: scPath,
      message: 'there is no sidecar at ' + scPath,
    };
  }
  let obj;
  try {
    obj = readSidecar(scPath);
  } catch (e) {
    return {
      action: 'show',
      status: 'invalid-sidecar',
      sidecar: scPath,
      message: 'the sidecar is not valid JSON: ' + e.message,
    };
  }
  return { action: 'show', status: 'ok', sidecar: scPath, sidecar_data: obj };
}

// -------------------------------------------------------------------- output

function printHuman(res) {
  const L = [];
  if (res.action === 'seal') {
    L.push('sealed  ' + res.file);
    L.push('  size    ' + res.size + ' bytes');
    L.push('  sha256  ' + res.sha256);
    L.push('  sidecar ' + res.sidecar);
    L.push('  claims  ' + res.claims + (res.appended ? ' (added to an existing sidecar)' : ''));
  } else if (res.action === 'verify') {
    L.push(res.status + '  ' + (res.file || ''));
    if (res.expected) L.push('  expected sha256  ' + res.expected);
    if (res.actual) L.push('  actual   sha256  ' + res.actual);
    if (res.sizeMatches === false) {
      L.push('  size changed: was ' + res.expectedSize + ', now ' + res.size);
    }
    if (res.claims && res.claims.length) {
      L.push('  claims:');
      for (const c of res.claims) {
        L.push('    ' + c.at + '  ' + c.tool + '  ' + c.kind +
          (c.data && c.data.note ? '  "' + c.data.note + '"' : ''));
      }
    }
    if (res.message) L.push('  ' + res.message);
  } else if (res.action === 'show') {
    if (res.status === 'ok') {
      L.push(JSON.stringify(res.sidecar_data, null, 2));
    } else {
      L.push(res.status + '  ' + (res.sidecar || ''));
      if (res.message) L.push('  ' + res.message);
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
    // The contract asks for help on stdout and exit 0 when a tool is
    // run with no arguments at all.
    process.stdout.write(usage() + '\n');
    return 0;
  }
  const KNOWN = ['seal', 'verify', 'show'];
  if (!KNOWN.includes(cmd)) {
    process.stderr.write('plumb: unknown command "' + cmd + '"\n\n' + usage() + '\n');
    return 2;
  }
  const file = opts._[1];
  if (!file) {
    process.stderr.write('plumb: ' + cmd + ' needs a file\n\n' + usage() + '\n');
    return 2;
  }

  let res;
  try {
    if (cmd === 'seal') res = seal(file, opts);
    else if (cmd === 'verify') res = verify(file, opts);
    else if (cmd === 'show') res = show(file, opts);
    else {
      // Unreachable: the command is checked above.
      process.stderr.write('plumb: unknown command "' + cmd + '"\n\n' + usage() + '\n');
      return 2;
    }
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      process.stderr.write('plumb: no such file: ' + file + '\n');
      return 2;
    }
    process.stderr.write('plumb: ' + (e && e.message ? e.message : String(e)) + '\n');
    return 2;
  }

  if (opts.json) process.stdout.write(JSON.stringify(res, null, 2) + '\n');
  else process.stdout.write(printHuman(res) + '\n');

  if (cmd === 'verify') {
    // Exit 0 means one thing only: the file matches its sidecar. A
    // missing, unreadable or unrecognised sidecar has verified
    // nothing, so it is not a pass.
    if (res.status === 'match') return 0;
    return 1;
  }
  if (cmd === 'show' && res.status !== 'ok') return 1;
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { seal, verify, show, sidecarPathFor, sha256, NAME, VERSION, TOOL_ID, FORMAT };
