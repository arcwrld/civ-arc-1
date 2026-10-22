'use strict';
// bundle.test.js - the tests for bundle.
//
// They cover the happy path and the paths that matter: a file that was
// changed, a bundle that is not a bundle, a path that tries to climb out of
// the folder, an empty folder, and the promise that the page and the
// command line use the same rules.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const B = require('./bundle.js');
const CORE = B.CORE;
const CLI = path.join(__dirname, 'bundle.js');
const HTML = path.join(__dirname, 'bundle.html');
const BUILD = path.join(__dirname, 'build.js');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-test-'));
}

function run(args, cwd) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: 'utf8',
    cwd: cwd,
  });
}

// ------------------------------------------------------------------- the core

test('the core sha256 agrees with node crypto', () => {
  const cases = [
    Buffer.alloc(0),
    Buffer.from('a'),
    Buffer.from('abc'),
    Buffer.from('The quick brown fox jumps over the lazy dog'),
    Buffer.from('x'.repeat(1000)),
    Buffer.from('cafe - 日本語'),
    crypto.randomBytes(5000),
  ];
  for (const c of cases) {
    const mine = CORE.sha256Hex(new Uint8Array(c));
    const theirs = crypto.createHash('sha256').update(c).digest('hex');
    assert.equal(mine, theirs, 'mismatch on ' + c.length + ' bytes');
  }
});

test('the core sha256 knows the empty-string digest', () => {
  assert.equal(
    CORE.sha256Hex(new Uint8Array(0)),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
});

test('base64 round trips at every length near a group boundary', () => {
  // The three-byte group is where an encoder goes wrong. Lengths 0..8 and
  // a few large ones cover every remainder.
  for (let n = 0; n <= 8; n++) {
    const bytes = crypto.randomBytes(n);
    const enc = CORE.bytesToBase64(new Uint8Array(bytes));
    const dec = CORE.base64ToBytes(enc);
    assert.equal(Buffer.compare(Buffer.from(dec), bytes), 0, 'round trip failed at ' + n);
  }
  for (const n of [255, 256, 1000, 4096]) {
    const bytes = crypto.randomBytes(n);
    const enc = CORE.bytesToBase64(new Uint8Array(bytes));
    const dec = CORE.base64ToBytes(enc);
    assert.equal(Buffer.compare(Buffer.from(dec), bytes), 0, 'round trip failed at ' + n);
  }
});

test('base64 matches node own encoder', () => {
  const bytes = crypto.randomBytes(300);
  const mine = CORE.bytesToBase64(new Uint8Array(bytes));
  const theirs = Buffer.from(bytes).toString('base64');
  assert.equal(mine, theirs);
});

test('crc32 matches zlib', () => {
  const zlib = require('node:zlib');
  for (const n of [0, 1, 17, 1000]) {
    const bytes = crypto.randomBytes(n);
    assert.equal(CORE.crc32(new Uint8Array(bytes)) >>> 0, zlib.crc32(bytes) >>> 0);
  }
});

test('safePath refuses a path that climbs out', () => {
  assert.equal(CORE.safePath('a/b.txt'), 'a/b.txt');
  assert.equal(CORE.safePath('./a.txt'), 'a.txt');
  assert.equal(CORE.safePath('a//b.txt'), 'a/b.txt');
  assert.equal(CORE.safePath('../escape.txt'), null);
  assert.equal(CORE.safePath('a/../../escape.txt'), null);
  assert.equal(CORE.safePath('/abs.txt'), null);
  assert.equal(CORE.safePath('C:/win.txt'), null);
  assert.equal(CORE.safePath(''), null);
  assert.equal(CORE.safePath('.'), null);
});

test('the page and the command line use the same core', () => {
  const build = require('./build.js');
  const js = build.extract(fs.readFileSync(CLI, 'utf8'), 'bundle.js');
  const html = build.extract(fs.readFileSync(HTML, 'utf8'), 'bundle.html');
  assert.equal(js, html, 'bundle.html has drifted from bundle.js');
});

test('the build script reports the page is in step', () => {
  const res = spawnSync(process.execPath, [BUILD, '--check'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
});

// --------------------------------------------------------------- the commands

test('pack then unpack gives back exactly what went in', () => {
  const dir = tmpdir();
  const src = path.join(dir, 'stuff');
  fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(src, 'hello.txt'), 'hello world\n');
  fs.writeFileSync(path.join(src, 'sub', 'nested.txt'), 'nested\n');
  fs.writeFileSync(path.join(src, 'empty.txt'), '');

  const out = path.join(dir, 'out.html');
  const packed = run(['pack', src, '--out', out]);
  assert.equal(packed.status, 0, packed.stderr);
  assert.ok(fs.existsSync(out));

  const back = path.join(dir, 'back');
  const unpacked = run(['unpack', out, '--out', back]);
  assert.equal(unpacked.status, 0, unpacked.stderr);

  assert.equal(fs.readFileSync(path.join(back, 'hello.txt'), 'utf8'), 'hello world\n');
  assert.equal(fs.readFileSync(path.join(back, 'sub', 'nested.txt'), 'utf8'), 'nested\n');
  assert.equal(fs.readFileSync(path.join(back, 'empty.txt'), 'utf8'), '');
});

test('a binary file survives the round trip byte for byte', () => {
  const dir = tmpdir();
  const src = path.join(dir, 'stuff');
  fs.mkdirSync(src, { recursive: true });
  const bytes = crypto.randomBytes(2000);
  fs.writeFileSync(path.join(src, 'blob.bin'), bytes);

  const out = path.join(dir, 'out.html');
  assert.equal(run(['pack', src, '--out', out]).status, 0);

  const back = path.join(dir, 'back');
  assert.equal(run(['unpack', out, '--out', back]).status, 0);

  const got = fs.readFileSync(path.join(back, 'blob.bin'));
  assert.equal(Buffer.compare(got, bytes), 0, 'the binary file came back different');
});

test('a file that is not utf-8 is stored as base64, and says so', () => {
  const dir = tmpdir();
  const src = path.join(dir, 'stuff');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'blob.bin'), crypto.randomBytes(500));

  const out = path.join(dir, 'out.html');
  assert.equal(run(['pack', src, '--out', out]).status, 0);

  const html = fs.readFileSync(out, 'utf8');
  const payload = CORE.payloadFromHtml(html);
  const entry = payload.files.find((f) => f.path === 'blob.bin');
  assert.ok(entry);
  assert.equal(entry.encoding, 'base64');
  assert.equal(entry.size, 500);
});

test('the packed file is one html file with the payload inside it', () => {
  const dir = tmpdir();
  const src = path.join(dir, 'stuff');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'a.txt'), 'a');

  const out = path.join(dir, 'out.html');
  assert.equal(run(['pack', src, '--out', out]).status, 0);

  const html = fs.readFileSync(out, 'utf8');
  const payload = CORE.payloadFromHtml(html);
  assert.ok(payload, 'no payload found in the packed file');
  assert.equal(payload.format, 'kit.bundle/1');
  assert.equal(payload.files.length, 1);
  assert.equal(payload.files[0].content, 'a');
});

test('the payload cannot close the script tag it lives in', () => {
  const dir = tmpdir();
  const src = path.join(dir, 'stuff');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'evil.txt'), '</script><script>alert(1)</script>');

  const out = path.join(dir, 'out.html');
  assert.equal(run(['pack', src, '--out', out]).status, 0);

  const html = fs.readFileSync(out, 'utf8');
  const payload = CORE.payloadFromHtml(html);
  assert.ok(payload, 'the payload could not be read back');
  assert.equal(payload.files[0].content, '</script><script>alert(1)</script>');
  // The raw text must not contain a closing tag outside the payload marker.
  const body = html.split('id="bundle-payload">')[1].split('</scr' + 'ipt>')[0];
  assert.equal(body.indexOf('</scr' + 'ipt>'), -1, 'a raw closing tag leaked into the payload');
});

test('verify passes on a bundle nobody has touched', () => {
  const dir = tmpdir();
  const src = path.join(dir, 'stuff');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'a.txt'), 'a');

  const out = path.join(dir, 'out.html');
  assert.equal(run(['pack', src, '--out', out]).status, 0);

  const res = run(['verify', out]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /match/);
});

test('verify fails when a file inside the bundle has been changed', () => {
  const dir = tmpdir();
  const src = path.join(dir, 'stuff');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'a.txt'), 'a');

  const out = path.join(dir, 'out.html');
  assert.equal(run(['pack', src, '--out', out]).status, 0);

  // Change the file inside the packed bundle, in place.
  const html = fs.readFileSync(out, 'utf8');
  const changed = html.replace('"content":"a"', '"content":"b"');
  fs.writeFileSync(out, changed, 'utf8');

  const res = run(['verify', out]);
  assert.equal(res.status, 1, 'verify should have failed');
  assert.match(res.stdout, /mismatch/);
  assert.match(res.stdout, /a\.txt/);
});

test('a file that is not a bundle is refused, not guessed at', () => {
  const dir = tmpdir();
  const notABundle = path.join(dir, 'plain.html');
  fs.writeFileSync(notABundle, '<!doctype html><title>not a bundle</title>');

  const res = run(['list', notABundle]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /bundle payload/);
});

test('a bundle with a broken payload is refused', () => {
  const dir = tmpdir();
  const broken = path.join(dir, 'broken.html');
  fs.writeFileSync(
    broken,
    '<script type="application/json" id="bundle-payload">{"format":"kit.bundle/99","files":[]}</script>'
  );
  const res = run(['list', broken]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /not a valid bundle/);
});

test('a bundle whose file has a path that climbs out is refused', () => {
  const dir = tmpdir();
  const evil = path.join(dir, 'evil.html');
  fs.writeFileSync(
    evil,
    '<script type="application/json" id="bundle-payload">' +
      JSON.stringify({
        format: 'kit.bundle/1',
        tool: 'bundle/1.0.0',
        root: 'x',
        title: 'x',
        created: '2026-10-22T00:00:00Z',
        files: [{
          path: '../escape.txt',
          size: 1,
          sha256: 'a'.repeat(64),
          encoding: 'utf8',
          content: 'x',
        }],
      }) +
      '</script>'
  );
  const res = run(['unpack', evil, '--out', path.join(dir, 'out')]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /unusable path/);
  assert.equal(fs.existsSync(path.join(dir, 'escape.txt')), false, 'it wrote outside the folder');
});

test('an empty folder packs to a bundle with nothing in it, and unpacks', () => {
  const dir = tmpdir();
  const src = path.join(dir, 'nothing');
  fs.mkdirSync(src);

  const out = path.join(dir, 'out.html');
  const packed = run(['pack', src, '--out', out]);
  assert.equal(packed.status, 0, packed.stderr);

  const back = path.join(dir, 'back');
  const unpacked = run(['unpack', out, '--out', back]);
  assert.equal(unpacked.status, 0, unpacked.stderr);
  assert.deepEqual(fs.readdirSync(back), []);
});

test('packing a folder that does not exist fails cleanly', () => {
  const dir = tmpdir();
  const res = run(['pack', path.join(dir, 'nope')]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /no such folder/);
});

test('packing a file instead of a folder fails cleanly', () => {
  const dir = tmpdir();
  const f = path.join(dir, 'file.txt');
  fs.writeFileSync(f, 'x');
  const res = run(['pack', f]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /not a folder/);
});

test('the bundle does not pack itself', () => {
  const dir = tmpdir();
  const src = path.join(dir, 'stuff');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'a.txt'), 'a');

  // The default output lands inside the folder being packed.
  const res = run(['pack', src], src);
  assert.equal(res.status, 0, res.stderr);
  const html = fs.readFileSync(path.join(src, 'stuff.bundle.html'), 'utf8');
  const payload = CORE.payloadFromHtml(html);
  assert.equal(payload.files.length, 1);
  assert.equal(payload.files[0].path, 'a.txt');
});

test('the packed file carries the title it was given', () => {
  const dir = tmpdir();
  const src = path.join(dir, 'stuff');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'a.txt'), 'a');

  const out = path.join(dir, 'out.html');
  assert.equal(run(['pack', src, '--out', out, '--title', 'My Notes']).status, 0);
  const payload = CORE.payloadFromHtml(fs.readFileSync(out, 'utf8'));
  assert.equal(payload.title, 'My Notes');
  assert.match(fs.readFileSync(out, 'utf8'), /<title>My Notes<\/title>/);
});

test('a title with html in it is escaped, not injected', () => {
  const dir = tmpdir();
  const src = path.join(dir, 'stuff');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'a.txt'), 'a');

  const out = path.join(dir, 'out.html');
  assert.equal(run(['pack', src, '--out', out, '--title', '<script>x</script>']).status, 0);
  const html = fs.readFileSync(out, 'utf8');
  assert.ok(html.indexOf('<script>x</script>') === -1, 'the title was injected raw');
});

test('the list command shows what is inside', () => {
  const dir = tmpdir();
  const src = path.join(dir, 'stuff');
  fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(src, 'a.txt'), 'a');
  fs.writeFileSync(path.join(src, 'sub', 'b.txt'), 'b');

  const out = path.join(dir, 'out.html');
  assert.equal(run(['pack', src, '--out', out]).status, 0);

  const res = run(['list', out]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /a\.txt/);
  assert.match(res.stdout, /sub\/b\.txt/);
});

test('the json output is machine readable', () => {
  const dir = tmpdir();
  const src = path.join(dir, 'stuff');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'a.txt'), 'a');

  const out = path.join(dir, 'out.html');
  assert.equal(run(['pack', src, '--out', out]).status, 0);

  const res = run(['list', out, '--json']);
  assert.equal(res.status, 0, res.stderr);
  const obj = JSON.parse(res.stdout);
  assert.equal(obj.count, 1);
  assert.equal(obj.files[0].path, 'a.txt');
});

// ------------------------------------------------------------ the command line

test('--help exits zero and says what the tool does', () => {
  const res = run(['--help']);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /bundle/);
  assert.match(res.stdout, /pack/);
  assert.match(res.stdout, /unpack/);
});

test('--version prints the name and a version', () => {
  const res = run(['--version']);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /^bundle\/\d+\.\d+\.\d+/);
});

test('no arguments prints the help and does not crash', () => {
  const res = run([]);
  assert.equal(res.status, 2);
  assert.ok(res.stdout.length > 0 || res.stderr.length > 0);
});

test('an unknown command is refused', () => {
  const res = run(['frobnicate']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /unknown command/);
});
