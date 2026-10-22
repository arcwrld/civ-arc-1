'use strict';
// Tests for the Kit checker itself. The checker is what holds the contract
// in place, so it gets tested like a tool.
//
// Two of these tests exist because the checker was, for a while, blind.
//
// The checker reads code, not text. It used to read text, so the word
// "fetch(" written in a string literal - the checker's own pattern table,
// a test fixture - looked exactly like a network call, and the checker's
// own source was a violation of the rule it stated. A scanner was written
// to tell code from literals, and it had a bug: it returned the flags in
// an object while the rest of the code indexed the flags directly. Every
// byte therefore read as "not code", and the two rules that matter most -
// no dependencies, no network - passed everything, including a test file
// that deliberately contained a chalk import and a fetch call.
//
// The tests below say what the rules are for, in both directions: the
// checker must catch a real violation, and it must not mistake a mention
// of a violation for one.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const kit = require('./kit-check.js');

const {
  ruleOneFile,
  ruleNoNetwork,
  ruleNoDependencies,
  checkSidecarObject,
  PROVENANCE_FORMAT,
} = kit;

test('ruleOneFile accepts a self-contained page', () => {
  const html = `<!doctype html><html><head><style>body{color:#111}</style></head>
<body><script>const x = 1; console.log(x);</script><a href="https://example.com">link</a></body></html>`;
  const r = ruleOneFile(html);
  assert.equal(r.length, 1);
  assert.equal(r[0].ok, true, r[0].detail);
});

test('ruleOneFile rejects an external script, link, img, and css import', () => {
  const cases = [
    '<script src="https://cdn.example.com/x.js"></script>',
    '<link rel="stylesheet" href="style.css">',
    '<img src="pic.png">',
    '<iframe src="https://example.com"></iframe>',
    '<style>@import url("https://example.com/a.css");</style>',
    '<div style="background:url(https://example.com/b.png)"></div>',
  ];
  for (const html of cases) {
    const r = ruleOneFile(html);
    assert.equal(r[0].ok, false, `should have rejected: ${html}`);
  }
});

test('ruleOneFile allows data URIs and fragments', () => {
  const html = '<link rel="icon" href="data:,"><a href="#top">top</a>';
  const r = ruleOneFile(html);
  assert.equal(r[0].ok, true, r[0].detail);
});

test('ruleNoNetwork catches the network APIs', () => {
  const cases = [
    'fetch("x")',
    'new XMLHttpRequest()',
    'new WebSocket("wss://x")',
    'new EventSource("/s")',
    'navigator.sendBeacon("/b")',
    'import("https://example.com/m.js")',
  ];
  for (const js of cases) {
    const r = ruleNoNetwork([{ name: 'a.js', text: js }]);
    assert.equal(r[0].ok, false, `should have caught: ${js}`);
  }
});

test('ruleNoNetwork passes offline code', () => {
  const js = 'const a = new FileReader(); const b = crypto.subtle.digest("SHA-256", buf);';
  const r = ruleNoNetwork([{ name: 'a.js', text: js }]);
  assert.equal(r[0].ok, true, r[0].detail);
});

test('ruleNoNetwork ignores the word fetch when it is only text', () => {
  // A tool that documents what it does not do is not a tool that does it.
  const cases = [
    "const label = 'fetch(';",
    '// fetch("x") would be a network call',
    'const note = "call fetch(";',
    '/* fetch("x") */',
    'const tpl = `call fetch("x")`;',
  ];
  for (const js of cases) {
    const r = ruleNoNetwork([{ name: 'a.js', text: js }]);
    assert.equal(r[0].ok, true, `should have passed: ${js}`);
  }
});

test('ruleNoNetwork sees a network call inside a template hole', () => {
  // The hole of a template literal is real code, and the checker must
  // see it as such.
  const js = 'const r = await `${fetch("https://example.com/x")}`;';
  const r = ruleNoNetwork([{ name: 'a.js', text: js }]);
  assert.equal(r[0].ok, false, r[0].detail);
  assert.match(r[0].detail, /fetch/);
});

test('ruleNoNetwork catches a network call inside an HTML page', () => {
  const html = '<!doctype html><body><script>fetch("https://example.com/x")</script></body>';
  const r = ruleNoNetwork([{ name: 'a.html', text: html }]);
  assert.equal(r[0].ok, false, r[0].detail);
});

test('ruleNoDependencies allows node builtins and relative paths only', () => {
  const ok = ruleNoDependencies([
    { name: 'a.js', text: "require('node:fs'); require('./b.js');" },
  ]);
  assert.equal(ok[0].ok, true, ok[0].detail);

  const bad = ruleNoDependencies([
    { name: 'a.js', text: "require('chalk');" },
  ]);
  assert.equal(bad[0].ok, false);
  assert.match(bad[0].detail, /chalk/);
});

test('ruleNoDependencies ignores an import written as text', () => {
  const cases = [
    "const example = \"require('chalk')\";",
    "// require('chalk')",
    '/* require("chalk"); */',
  ];
  for (const js of cases) {
    const r = ruleNoDependencies([{ name: 'a.js', text: js }]);
    assert.equal(r[0].ok, true, `should have passed: ${js}`);
  }
});

test('the scanner tells code from text', () => {
  const scan = kit.scan;
  const js = 'const a = 1; const b = "fetch("; fetch("x");';
  const map = scan.scan(js);
  const code = scan.codeText(js, map);
  // The real call survives; the one inside the string does not.
  assert.equal(code.split('fetch(').length - 1, 1, code);
  assert.ok(code.includes('const a = 1;'), 'real code must survive');
});

test('checkSidecarObject accepts a well formed sidecar', () => {
  const obj = {
    format: PROVENANCE_FORMAT,
    file: { name: 'data.csv', size: 10, sha256: 'a'.repeat(64) },
    claims: [
      { tool: 'plumb/1.0.0', at: '2026-10-22T13:04:00Z', kind: 'seal', data: {} },
    ],
  };
  assert.deepEqual(checkSidecarObject(obj, 'x'), []);
});

test('checkSidecarObject rejects the mistakes that matter', () => {
  const bad = [
    { format: 'something/9', file: { name: 'a', size: 1, sha256: 'a'.repeat(64) }, claims: [] },
    { format: PROVENANCE_FORMAT, file: { name: 'a', size: -1, sha256: 'a'.repeat(64) }, claims: [] },
    { format: PROVENANCE_FORMAT, file: { name: 'a', size: 1, sha256: 'NOTHEX' }, claims: [] },
    { format: PROVENANCE_FORMAT, file: { name: 'a', size: 1, sha256: 'a'.repeat(64) } },
    {
      format: PROVENANCE_FORMAT,
      file: { name: 'a', size: 1, sha256: 'a'.repeat(64) },
      claims: [{ tool: 'plumb', at: '2026-10-22T13:04:00Z', kind: 'seal' }],
    },
    {
      format: PROVENANCE_FORMAT,
      file: { name: 'a', size: 1, sha256: 'a'.repeat(64) },
      claims: [{ tool: 'plumb/1.0.0', at: 'not-a-date', kind: 'seal' }],
    },
  ];
  for (const obj of bad) {
    assert.ok(
      checkSidecarObject(obj, 'x').length > 0,
      `should have rejected: ${JSON.stringify(obj)}`
    );
  }
});

test('the checker agrees with itself on this repository', () => {
  const repo = kit.checkRepo({ runTests: false });
  for (const rule of repo) {
    for (const c of rule.checks) {
      assert.equal(c.ok, true, `repo rule ${rule.rule} failed: ${c.detail}`);
    }
  }
});

test('the checker finds a tool that satisfies the contract', () => {
  // A directory that is missing one of the four files of the contract is
  // not a tool yet, so it is not judged here; the checker reports it as
  // a failure in its own output, and it is judged as soon as it is
  // complete. A tool that has all four files must pass every rule, with
  // no exceptions.
  const names = kit.listTools();
  assert.ok(names.length > 0, 'expected at least one tool in tools/');
  for (const name of names) {
    const t = kit.checkTool(name, { runTests: true });
    assert.equal(t.missing, false, `tool ${name} is missing`);
    const layout = t.results.find((r) => r.rule === 'layout');
    if (layout && !layout.checks.every((c) => c.ok)) continue; // not a tool yet
    const failed = [];
    for (const r of t.results) {
      for (const c of r.checks) if (!c.ok) failed.push(`${r.rule}: ${c.detail}`);
    }
    assert.deepEqual(failed, [], `tool ${name} failed the contract:\n  ${failed.join('\n  ')}`);
  }
});

test('the checker rejects a tool that breaks the contract', () => {
  // A throwaway tool in a temp dir, wired into a throwaway repo, so the
  // checker's judgement is tested and not just its agreement.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-check-'));
  const toolsDir = path.join(tmp, 'tools', 'broken');
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.mkdirSync(path.join(tmp, 'site'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'site', 'index.html'), '<!doctype html><title>x</title>');
  fs.writeFileSync(
    path.join(toolsDir, 'broken.html'),
    '<script src="https://cdn.example.com/x.js"></script>'
  );
  fs.writeFileSync(
    path.join(toolsDir, 'broken.js'),
    "require('chalk');\nfetch('https://example.com');\n"
  );
  fs.writeFileSync(
    path.join(toolsDir, 'broken.test.js'),
    "require('node:test');\n"
  );
  fs.writeFileSync(path.join(toolsDir, 'README.md'), 'Too short. No mention of the html file.\n');

  const t = kit.checkTool('broken', { runTests: true, root: tmp });
  assert.equal(t.missing, false);
  const byRule = {};
  for (const r of t.results) {
    byRule[r.rule] = r.checks.every((c) => c.ok);
  }
  assert.equal(byRule.layout, true, 'layout should pass: all four files are there');
  assert.equal(byRule['no-dependencies'], false, 'no-dependencies should fail');
  assert.equal(byRule['one-file'], false, 'one-file should fail');
  assert.equal(byRule['no-network'], false, 'no-network should fail');
  assert.equal(byRule.cli, false, 'cli should fail: the fixture is not a runnable cli');
  assert.equal(byRule.readme, false, 'readme should fail');
  assert.equal(byRule['on-site'], false, 'on-site should fail');
  assert.equal(kit.toolPassed(t), false);

  // Remove one of the four files and the layout rule fails, which is how
  // the checker says "this is not a tool yet".
  fs.rmSync(path.join(toolsDir, 'broken.test.js'));
  const t2 = kit.checkTool('broken', { runTests: false, root: tmp });
  const layout2 = t2.results.find((r) => r.rule === 'layout');
  assert.equal(layout2.checks[0].ok, false, 'layout should fail without the test file');
  assert.match(layout2.checks[0].detail, /broken\.test\.js/);

  fs.rmSync(tmp, { recursive: true, force: true });
});
