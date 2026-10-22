'use strict';
// level.test.js - the test suite for level.
//
// The contract says a tool ships with its tests green, and that the
// tests must cover the failure paths. These do: a byte order mark,
// CRLF endings, a bare CR, bytes that are not UTF-8, a file with no
// final newline, trailing whitespace, tab indentation, an empty file,
// a file that is already clean, and a file with a mixture of all of
// them.
//
// There is also a test that the copy of the engine inside level.html
// is byte for byte the same as the engine in this file. Without it the
// page and the command line could drift apart and give a stranger two
// different answers.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const level = require('./level.js');

const CLI = path.join(__dirname, 'level.js');
const HTML = path.join(__dirname, 'level.html');

// ------------------------------------------------------------- test helpers

let tmpRoot = null;

function tmpdir() {
  if (!tmpRoot) {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'level-test-'));
  }
  return tmpRoot;
}

function writeBytes(name, bytes) {
  const p = path.join(tmpdir(), name);
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
}

function writeFile(name, content) {
  const p = path.join(tmpdir(), name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

function run(args, input) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 60000,
    input: input,
  });
}

function b(str) {
  return Buffer.from(str, 'utf8');
}

function rulesOf(res) {
  return res.findings.map((f) => f.rule);
}

// ------------------------------------------------------------- the happy path

test('a clean file has no findings', () => {
  const res = level.check(b('one\ntwo\n'));
  assert.equal(res.ok, true);
  assert.deepEqual(res.findings, []);
  assert.equal(res.changed, false);
});

test('a clean file is not rewritten', () => {
  const res = level.check(b('one\ntwo\n'));
  assert.deepEqual(Array.from(res.levelled), Array.from(b('one\ntwo\n')));
});

test('an empty file has no findings', () => {
  const res = level.check(b(''));
  assert.equal(res.ok, true);
  assert.deepEqual(res.findings, []);
  assert.equal(res.changed, false);
});

test('a file of one line with no final newline is not clean', () => {
  const res = level.check(b('hello'));
  assert.equal(res.ok, false);
  assert.ok(rulesOf(res).includes('final-newline'));
});

// ------------------------------------------------------------- the byte order mark

test('a byte order mark is found and removed', () => {
  const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), b('hi\n')]);
  const res = level.check(withBom);
  assert.equal(res.ok, false);
  assert.ok(rulesOf(res).includes('bom'));
  assert.equal(res.hadBom, true);
  // The levelled copy has no mark.
  assert.deepEqual(Array.from(res.levelled), Array.from(b('hi\n')));
  assert.equal(res.levelled[0], 0x68);
});

test('a byte order mark on a file with nothing else wrong is still a finding', () => {
  const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), b('hi\n')]);
  const res = level.check(withBom);
  assert.deepEqual(rulesOf(res), ['bom']);
  // Only the one finding, even though the text decodes cleanly.
  assert.equal(res.findings.length, 1);
});

// -------------------------------------------------------------- the line endings

test('CRLF line endings are found and normalised', () => {
  const res = level.check(b('one\r\ntwo\r\n'));
  assert.equal(res.ok, false);
  assert.ok(rulesOf(res).includes('crlf'));
  assert.deepEqual(Array.from(res.levelled), Array.from(b('one\ntwo\n')));
});

test('a bare CR is found and normalised', () => {
  const res = level.check(b('one\rtwo\r'));
  assert.equal(res.ok, false);
  assert.ok(rulesOf(res).includes('crlf'));
  assert.deepEqual(Array.from(res.levelled), Array.from(b('one\ntwo\n')));
});

test('the CRLF finding names the first line that uses it', () => {
  const res = level.check(b('one\ntwo\r\nthree\r\n'));
  const f = res.findings.find((x) => x.rule === 'crlf');
  assert.equal(f.line, 2);
});

test('a bare CR finding names the first line that uses it', () => {
  const res = level.check(b('one\ntwo\rthree\r'));
  const f = res.findings.find((x) => x.rule === 'crlf');
  assert.equal(f.line, 2);
});

test('a file with both CRLF and bare CR reports both', () => {
  const res = level.check(b('a\r\nb\rc\n'));
  const crlf = res.findings.filter((x) => x.rule === 'crlf');
  assert.equal(crlf.length, 2);
});

// ----------------------------------------------------------------- the encoding

test('bytes that are not valid UTF-8 are found', () => {
  const bad = Buffer.from([0x68, 0x69, 0xff, 0x0a]);
  const res = level.check(bad);
  assert.equal(res.ok, false);
  assert.ok(rulesOf(res).includes('encoding'));
  assert.equal(res.levelled, null, 'a file that is not text is not levelled');
});

test('a truncated UTF-8 sequence is found', () => {
  // 0xe2 0x82 starts a three byte sequence and then stops.
  const bad = Buffer.from([0xe2, 0x82]);
  const res = level.check(bad);
  assert.ok(rulesOf(res).includes('encoding'));
  assert.match(res.findings[0].detail, /truncated|unexpected/);
});

test('an overlong UTF-8 sequence is rejected', () => {
  // 0xc0 0x80 is an overlong encoding of NUL, which is not valid UTF-8.
  const bad = Buffer.from([0xc0, 0x80, 0x0a]);
  const res = level.check(bad);
  assert.ok(rulesOf(res).includes('encoding'));
});

test('a lone surrogate is rejected', () => {
  // 0xed 0xa0 0x80 is the UTF-8 encoding of a surrogate code point.
  const bad = Buffer.from([0xed, 0xa0, 0x80, 0x0a]);
  const res = level.check(bad);
  assert.ok(rulesOf(res).includes('encoding'));
});

test('a valid multi byte character is accepted', () => {
  // U+00E9, U+4E2D, U+1F600
  const good = Buffer.from([0xc3, 0xa9, 0xe4, 0xb8, 0xad, 0xf0, 0x9f, 0x98, 0x80, 0x0a]);
  const res = level.check(good);
  assert.equal(res.ok, true);
  assert.equal(res.text, 'é中😀\n');
});

test('a file that is not valid UTF-8 reports only the encoding finding', () => {
  const bad = Buffer.from([0x68, 0x69, 0xff, 0x0a]);
  const res = level.check(bad);
  assert.deepEqual(rulesOf(res), ['encoding']);
});

// -------------------------------------------------------------- the final newline

test('a file with no final newline is found and gets one', () => {
  const res = level.check(b('one\ntwo'));
  assert.ok(rulesOf(res).includes('final-newline'));
  assert.deepEqual(Array.from(res.levelled), Array.from(b('one\ntwo\n')));
});

test('the final newline finding names the last line', () => {
  const res = level.check(b('one\ntwo'));
  const f = res.findings.find((x) => x.rule === 'final-newline');
  assert.equal(f.line, 2);
});

test('a file ending with CRLF has a final newline', () => {
  const res = level.check(b('one\r\n'));
  assert.equal(res.hadFinalNewline, true);
  assert.ok(!rulesOf(res).includes('final-newline'));
});

// ------------------------------------------------------------ the trailing spaces

test('trailing spaces are found and stripped', () => {
  const res = level.check(b('one   \ntwo\n'));
  assert.ok(rulesOf(res).includes('trailing-space'));
  assert.deepEqual(Array.from(res.levelled), Array.from(b('one\ntwo\n')));
});

test('a trailing tab is found and stripped', () => {
  const res = level.check(b('one\t\ntwo\n'));
  assert.ok(rulesOf(res).includes('trailing-space'));
  assert.deepEqual(Array.from(res.levelled), Array.from(b('one\ntwo\n')));
});

test('the trailing space finding names the line', () => {
  const res = level.check(b('one\ntwo  \nthree\n'));
  const f = res.findings.find((x) => x.rule === 'trailing-space');
  assert.equal(f.line, 2);
});

test('a line of nothing but spaces is all trailing whitespace', () => {
  const res = level.check(b('one\n   \ntwo\n'));
  const f = res.findings.find((x) => x.rule === 'trailing-space');
  assert.equal(f.line, 2);
});

// ------------------------------------------------------------------ the tabs

test('tab indentation is found and expanded', () => {
  const res = level.check(b('\tone\n'));
  assert.ok(rulesOf(res).includes('tabs'));
  assert.deepEqual(Array.from(res.levelled), Array.from(b('    one\n')));
});

test('a tab is expanded to the next tab stop, not always to four spaces', () => {
  // Two spaces then a tab: the tab runs to column four, so it is two
  // spaces wide, and the indent becomes four spaces in total.
  const res = level.check(b('  \tone\n'));
  assert.deepEqual(Array.from(res.levelled), Array.from(b('    one\n')));
});

test('a tab in the middle of a line is not indentation and is left alone', () => {
  const res = level.check(b('a\tb\n'));
  assert.equal(res.ok, true);
  assert.deepEqual(Array.from(res.levelled), Array.from(b('a\tb\n')));
});

test('the tab finding names the line', () => {
  const res = level.check(b('one\n\ttwo\n'));
  const f = res.findings.find((x) => x.rule === 'tabs');
  assert.equal(f.line, 2);
});

// ----------------------------------------------------------------- a mixture

test('a file with everything wrong reports every rule and levells them all', () => {
  const input = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    b('\tone  \r\ntwo\r\nthree'),
  ]);
  const res = level.check(input);
  const rules = rulesOf(res);
  assert.ok(rules.includes('bom'));
  assert.ok(rules.includes('crlf'));
  assert.ok(rules.includes('final-newline'));
  assert.ok(rules.includes('trailing-space'));
  assert.ok(rules.includes('tabs'));
  assert.deepEqual(
    Array.from(res.levelled),
    Array.from(b('    one\ntwo\nthree\n'))
  );
});

test('levelling a levelled file changes nothing', () => {
  const input = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    b('\tone  \r\ntwo\r\nthree'),
  ]);
  const once = level.check(input);
  const twice = level.check(once.levelled);
  assert.equal(twice.ok, true);
  assert.equal(twice.changed, false);
  assert.deepEqual(twice.findings, []);
});

test('the diff names the lines that changed', () => {
  const res = level.check(b('one\ntwo  \nthree\n'));
  const changed = res.diff.filter((d) => d.changed);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].line, 2);
  assert.equal(changed[0].before, 'two  ');
  assert.equal(changed[0].after, 'two');
});

test('the diff has one entry per line of the file', () => {
  const res = level.check(b('one\ntwo\nthree\n'));
  assert.equal(res.diff.length, 3);
});

// ------------------------------------------------------------ the UTF-8 codec

test('the encoder and the decoder agree', () => {
  const samples = [
    '',
    'ascii',
    'caf\u00e9',
    '\u4e2d\u6587',
    '\u{1f600}',
    'mixed \u00e9 \u4e2d \u{1f600} end',
  ];
  for (const s of samples) {
    const bytes = level.encodeUtf8(s);
    const back = level.decodeUtf8(bytes);
    assert.equal(back.ok, true, 'should decode: ' + JSON.stringify(s));
    assert.equal(back.text, s, 'should round trip: ' + JSON.stringify(s));
  }
});

test('the encoder matches the published UTF-8 test vectors', () => {
  const vectors = [
    ['', []],
    ['a', [0x61]],
    ['\u00e9', [0xc3, 0xa9]],
    ['\u20ac', [0xe2, 0x82, 0xac]],
    ['\u{1f600}', [0xf0, 0x9f, 0x98, 0x80]],
  ];
  for (const [s, expected] of vectors) {
    assert.deepEqual(
      Array.from(level.encodeUtf8(s)),
      expected,
      'encoding of ' + JSON.stringify(s)
    );
  }
});

test('the decoder rejects a byte that starts no sequence', () => {
  const res = level.decodeUtf8(Uint8Array.from([0x80]));
  assert.equal(res.ok, false);
});

test('the decoder accepts the empty byte array', () => {
  const res = level.decodeUtf8(Uint8Array.from([]));
  assert.equal(res.ok, true);
  assert.equal(res.text, '');
});

test('the decoder rejects a truncated sequence at the very end', () => {
  // A three byte sequence with only two bytes present.
  const res = level.decodeUtf8(Uint8Array.from([0xe2, 0x82]));
  assert.equal(res.ok, false);
  assert.match(res.reason, /truncated/);
});

test('the decoder rejects a bad continuation byte', () => {
  const res = level.decodeUtf8(Uint8Array.from([0xe2, 0x41, 0x82]));
  assert.equal(res.ok, false);
  assert.match(res.reason, /continuation/);
});

// ------------------------------------------------------------------- the CLI

test('--help exits 0 and explains the tool', () => {
  const res = run(['--help']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /check/);
  assert.match(res.stdout, /does not do/);
});

test('--version prints the name and a version', () => {
  const res = run(['--version']);
  assert.equal(res.status, 0);
  assert.match(res.stdout.trim(), /^level\/\d+\.\d+\.\d+$/);
});

test('no arguments prints the help and exits 0', () => {
  const res = run([]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Usage:/);
});

test('an unknown option exits 2 and says so', () => {
  const res = run(['--frobnicate']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /unknown option/);
});

test('a missing file exits 2 and says so', () => {
  const res = run(['check', path.join(tmpdir(), 'not-here.txt')]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /no such file/);
});

test('a directory is not a file', () => {
  const res = run(['check', tmpdir()]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /not a regular file/);
});

test('check exits 0 on a clean file', () => {
  const f = writeFile('clean.txt', 'one\ntwo\n');
  const res = run(['check', f]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /OK/);
});

test('check exits 1 on a file with a finding', () => {
  const f = writeFile('dirty.txt', 'one  \ntwo');
  const res = run(['check', f]);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /FAIL/);
  assert.match(res.stdout, /trailing-space/);
  assert.match(res.stdout, /final-newline/);
});

test('check does not change the file it checks', () => {
  const before = 'one  \ntwo';
  const f = writeFile('untouched.txt', before);
  run(['check', f]);
  assert.equal(fs.readFileSync(f, 'utf8'), before);
});

test('check --json prints a machine readable result', () => {
  const f = writeFile('json.txt', 'one  \n');
  const res = run(['check', f, '--json']);
  assert.equal(res.status, 1);
  const obj = JSON.parse(res.stdout);
  assert.equal(obj.ok, false);
  assert.equal(obj.files.length, 1);
  assert.equal(obj.files[0].name, f);
  assert.equal(obj.files[0].findings.length, 1);
  assert.equal(obj.files[0].findings[0].rule, 'trailing-space');
  assert.equal(obj.files[0].findings[0].title, 'trailing whitespace');
});

test('check --quiet prints nothing and still exits 1', () => {
  const f = writeFile('quiet.txt', 'one  \n');
  const res = run(['check', f, '--quiet']);
  assert.equal(res.status, 1);
  assert.equal(res.stdout, '');
});

test('check --diff shows what the levelled copy would be', () => {
  const f = writeFile('diff.txt', 'one  \n');
  const res = run(['check', f, '--diff']);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /- "one  "/);
  assert.match(res.stdout, /\+ "one"/);
});

test('fix prints the levelled copy on stdout and changes nothing on disk', () => {
  const before = 'one  \r\ntwo';
  const f = writeFile('fix-stdout.txt', before);
  const res = run(['fix', f]);
  assert.equal(res.status, 1, 'there was something to fix');
  assert.equal(res.stdout, 'one\ntwo\n');
  assert.equal(fs.readFileSync(f, 'utf8'), before, 'the file must not change');
});

test('fix --write rewrites the file and makes it clean', () => {
  const f = writeFile('fix-write.txt', 'one  \r\ntwo');
  const res = run(['fix', f, '--write']);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /FIXED/);
  assert.equal(fs.readFileSync(f, 'utf8'), 'one\ntwo\n');
  // And now it passes.
  const again = run(['check', f]);
  assert.equal(again.status, 0, again.stdout);
});

test('fix --write leaves a file that is already clean alone', () => {
  const f = writeFile('fix-noop.txt', 'one\ntwo\n');
  const before = fs.statSync(f).mtimeMs;
  const res = run(['fix', f, '--write']);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /already levelled/);
  assert.equal(fs.readFileSync(f, 'utf8'), 'one\ntwo\n');
  assert.equal(fs.statSync(f).mtimeMs, before, 'the file must not be rewritten');
});

test('fix --write refuses to guess at invalid UTF-8', () => {
  const bad = Buffer.from([0x68, 0x69, 0xff, 0x0a]);
  const f = writeBytes('fix-bad.txt', bad);
  const res = run(['fix', f, '--write']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /not valid UTF-8/);
  // The file is exactly as it was.
  assert.deepEqual(Array.from(fs.readFileSync(f)), Array.from(bad));
});

test('level reads standard input when the file is -', () => {
  const res = run(['check', '-'], 'one  \n');
  assert.equal(res.status, 1);
  assert.match(res.stdout, /trailing-space/);
});

test('level can check a whole folder of files from a shell loop', () => {
  const a = writeFile('multi-a.txt', 'one\n');
  const b2 = writeFile('multi-b.txt', 'two  \n');
  const res = run(['check', a, b2]);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /multi-a\.txt/);
  assert.match(res.stdout, /multi-b\.txt/);
});

// ------------------------------------------- the page and the CLI are one tool

test('the engine inside level.html is byte for byte the engine in level.js', () => {
  const source = fs.readFileSync(__filename === '' ? '' : path.join(__dirname, 'level.js'), 'utf8');
  const html = fs.readFileSync(HTML, 'utf8');

  const begin = '/* BEGIN engine (from tools/level/level.js) */';
  const end = '/* END engine (from tools/level/level.js) */';
  const i = html.indexOf(begin);
  const j = html.indexOf(end);
  assert.ok(i !== -1, 'the page must carry the engine between the markers');
  assert.ok(j !== -1, 'the page must carry the engine between the markers');
  assert.ok(j > i, 'the end marker must come after the begin marker');

  const inHtml = html.slice(i + begin.length, j);
  const inJs = source.slice(
    source.indexOf(begin) + begin.length,
    source.indexOf(end)
  );

  assert.equal(
    inHtml,
    inJs,
    'the page and the command line must run the same engine, byte for byte'
  );
});

test('the page loads no external subresource', () => {
  const html = fs.readFileSync(HTML, 'utf8');
  assert.ok(!/<script[^>]+src=/i.test(html), 'no external script');
  assert.ok(!/<link[^>]+href=/i.test(html), 'no external link');
  assert.ok(!/<img[^>]+src=/i.test(html), 'no external image');
});

test('the page says it is the tool it claims to be', () => {
  const html = fs.readFileSync(HTML, 'utf8');
  assert.match(html, /<title>level/);
  assert.match(html, /tools\/level\/level\.js/);
  assert.match(html, /level\.html/);
});
