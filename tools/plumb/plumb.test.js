'use strict';
// plumb.test.js - the test suite for plumb.
//
// The contract says a tool ships with its tests green, and that the tests
// must cover the failure paths. These do: a file that changed, a sidecar
// that describes a different file, a corrupt sidecar, a missing sidecar,
// a sidecar in a format this tool does not know, and the promise that
// sealing twice never rewrites the first claim.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const plumb = require('./plumb.js');

const CLI = path.join(__dirname, 'plumb.js');

// ------------------------------------------------------------- test helpers

let tmpRoot = null;

function tmpdir() {
  if (!tmpRoot) {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plumb-test-'));
  }
  return tmpRoot;
}

function writeFile(name, content) {
  const p = path.join(tmpdir(), name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 60000,
  });
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ------------------------------------------------------- the hash, verified

test('sha256 matches the published test vectors', () => {
  // The same vectors the browser page checks itself against, so the two
  // implementations of the tool can be compared.
  const vectors = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'The quick brown fox jumps over the lazy dog',
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    ],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
  ];
  for (const [input, expected] of vectors) {
    assert.equal(
      plumb.sha256(Buffer.from(input, 'utf8')),
      expected,
      'sha256 of ' + JSON.stringify(input)
    );
  }
});

test('sha256 handles a body longer than one block', () => {
  const input = 'a'.repeat(1000);
  assert.equal(
    plumb.sha256(Buffer.from(input, 'utf8')),
    '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3'
  );
});

// ------------------------------------------------------------------- seal

test('seal writes a sidecar that names the file and its hash', () => {
  const f = writeFile('seal-basic.txt', 'hello world\n');
  const res = run(['seal', f, '--note', 'from the survey export']);
  assert.equal(res.status, 0, res.stderr);

  const sc = path.join(tmpdir(), 'seal-basic.txt.provenance.json');
  assert.ok(fs.existsSync(sc), 'sidecar should exist');
  const obj = readJson(sc);

  assert.equal(obj.format, 'kit.provenance/1');
  assert.equal(obj.file.name, 'seal-basic.txt');
  assert.equal(obj.file.size, 12);
  assert.equal(obj.file.sha256, plumb.sha256(Buffer.from('hello world\n')));
  assert.equal(obj.claims.length, 1);
  assert.equal(obj.claims[0].tool, 'plumb/1.0.0');
  assert.equal(obj.claims[0].kind, 'seal');
  assert.equal(obj.claims[0].data.note, 'from the survey export');
  assert.match(obj.claims[0].at, /^\d{4}-\d{2}-\d{2}T/);
});

test('seal does not change the file it describes', () => {
  const before = 'the exact bytes\n';
  const f = writeFile('seal-untouched.txt', before);
  run(['seal', f]);
  assert.equal(fs.readFileSync(f, 'utf8'), before);
});

test('sealing twice appends a claim and never rewrites the first', () => {
  const f = writeFile('seal-twice.txt', 'x\n');
  run(['seal', f, '--note', 'first']);
  const sc = path.join(tmpdir(), 'seal-twice.txt.provenance.json');
  const first = readJson(sc);
  const firstClaim = JSON.stringify(first.claims[0]);

  run(['seal', f, '--note', 'second']);
  const second = readJson(sc);

  assert.equal(second.claims.length, 2, 'a second claim should be added');
  assert.equal(
    JSON.stringify(second.claims[0]),
    firstClaim,
    'the first claim must not be rewritten'
  );
  assert.equal(second.claims[1].data.note, 'second');
});

test('seal refuses to overwrite a sidecar that describes a different file', () => {
  const a = writeFile('seal-a.txt', 'aaa\n');
  const b = writeFile('seal-b.txt', 'bbb\n');
  const sc = path.join(tmpdir(), 'seal-b.txt.provenance.json');
  run(['seal', a]);
  fs.copyFileSync(
    path.join(tmpdir(), 'seal-a.txt.provenance.json'),
    sc
  );

  const res = run(['seal', b]);
  assert.equal(res.status, 2, 'it should fail');
  assert.match(res.stderr, /describes a different file/);
});

test('seal replaces a sidecar that describes a different file with --force', () => {
  const a = writeFile('seal-force-a.txt', 'aaa\n');
  const b = writeFile('seal-force-b.txt', 'bbb\n');
  run(['seal', a]);
  const sc = path.join(tmpdir(), 'seal-force-b.txt.provenance.json');
  fs.copyFileSync(path.join(tmpdir(), 'seal-force-a.txt.provenance.json'), sc);

  const res = run(['seal', b, '--force']);
  assert.equal(res.status, 0, res.stderr);
  const obj = readJson(sc);
  assert.equal(obj.file.sha256, plumb.sha256(Buffer.from('bbb\n')));
});

test('seal refuses a sidecar in a format it does not recognise', () => {
  const f = writeFile('seal-format.txt', 'x\n');
  const sc = path.join(tmpdir(), 'seal-format.txt.provenance.json');
  fs.writeFileSync(
    sc,
    JSON.stringify({ format: 'other/9', file: {}, claims: [] }, null, 2) + '\n',
    'utf8'
  );
  const res = run(['seal', f]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /does not recognise/);
});

test('seal writes where --sidecar says', () => {
  const f = writeFile('seal-elsewhere.txt', 'x\n');
  const sc = path.join(tmpdir(), 'elsewhere.provenance.json');
  const res = run(['seal', f, '--sidecar', sc]);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(sc));
});

test('seal writes a sidecar in the shape the contract describes', () => {
  const f = writeFile('seal-shape.txt', 'x\n');
  run(['seal', f]);
  const text = fs.readFileSync(
    path.join(tmpdir(), 'seal-shape.txt.provenance.json'),
    'utf8'
  );
  assert.ok(text.endsWith('\n'), 'one trailing newline');
  assert.ok(!text.includes('\r\n'), 'no carriage returns');
  assert.ok(!text.startsWith('\ufeff'), 'no byte order mark');
  assert.ok(text.includes('\n  "format"'), 'two-space indent');
});

// ----------------------------------------------------------------- verify

test('verify says match for a file that has not changed', () => {
  const f = writeFile('verify-ok.txt', 'same\n');
  run(['seal', f]);
  const res = run(['verify', f]);
  assert.equal(res.status, 0, 'a match should exit 0');
  assert.match(res.stdout, /the file is the file you sealed/);
});

test('verify says the file has changed when one byte changed', () => {
  const f = writeFile('verify-changed.txt', 'same\n');
  run(['seal', f]);
  fs.writeFileSync(f, 'sane\n', 'utf8');
  const res = run(['verify', f]);
  assert.equal(res.status, 1, 'a mismatch should exit 1');
  assert.match(res.stdout, /has changed since it was sealed/);
});

test('verify exits 1 when there is no sidecar, because nothing was checked', () => {
  const f = writeFile('verify-none.txt', 'x\n');
  const res = run(['verify', f]);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /no sidecar/);
});

test('verify reports a corrupt sidecar instead of throwing', () => {
  const f = writeFile('verify-corrupt.txt', 'x\n');
  fs.writeFileSync(
    path.join(tmpdir(), 'verify-corrupt.txt.provenance.json'),
    '{ this is not json',
    'utf8'
  );
  const res = run(['verify', f]);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /not valid JSON/);
});

test('verify reports a sidecar in an unknown format', () => {
  const f = writeFile('verify-unknown.txt', 'x\n');
  fs.writeFileSync(
    path.join(tmpdir(), 'verify-unknown.txt.provenance.json'),
    JSON.stringify({ format: 'other/9', file: {}, claims: [] }, null, 2),
    'utf8'
  );
  const res = run(['verify', f]);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /does not recognise/);
});

test('verify never believes the sidecar without recomputing the hash', () => {
  const f = writeFile('verify-liar.txt', 'x\n');
  const sc = path.join(tmpdir(), 'verify-liar.txt.provenance.json');
  run(['seal', f]);
  const obj = readJson(sc);
  obj.file.sha256 = 'f'.repeat(64);
  fs.writeFileSync(sc, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  const res = run(['verify', f]);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /has changed since it was sealed/);
});

test('verify --json prints a machine readable result', () => {
  const f = writeFile('verify-json.txt', 'x\n');
  run(['seal', f]);
  const res = run(['verify', f, '--json']);
  assert.equal(res.status, 0);
  const obj = JSON.parse(res.stdout);
  assert.equal(obj.status, 'match');
  assert.equal(obj.action, 'verify');
  assert.equal(obj.file, 'verify-json.txt');
  assert.equal(obj.claims.length, 1);
});

// ------------------------------------------------------------------- show

test('show prints the sidecar', () => {
  const f = writeFile('show-ok.txt', 'x\n');
  run(['seal', f, '--note', 'a note']);
  const res = run(['show', f]);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /kit\.provenance\/1/);
  assert.match(res.stdout, /a note/);
});

test('show reports a missing sidecar', () => {
  const f = writeFile('show-missing.txt', 'x\n');
  const res = run(['show', f]);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /no sidecar/);
});

// -------------------------------------------------------------- the CLI

test('--help exits 0 and explains the tool', () => {
  const res = run(['--help']);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /seal/);
  assert.match(res.stdout, /verify/);
  assert.match(res.stdout, /does not do/);
});

test('--version prints the name and a version', () => {
  const res = run(['--version']);
  assert.equal(res.status, 0);
  assert.match(res.stdout.trim(), /^plumb\/\d+\.\d+\.\d+$/);
});

test('no arguments prints the help and exits 0', () => {
  const res = run([]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Usage:/);
});

test('an unknown command exits 2 and says so', () => {
  const res = run(['frobnicate']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /unknown command/);
});

test('a missing file exits 2 and says so', () => {
  const res = run(['seal', path.join(tmpdir(), 'not-here.txt')]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /no such file/);
});

test('a directory is not a file', () => {
  const res = run(['seal', tmpdir()]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /not a regular file/);
});
