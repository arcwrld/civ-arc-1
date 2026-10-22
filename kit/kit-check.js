#!/usr/bin/env node
'use strict';
// kit-check.js - the Kit contract, made executable.
//
// Walks tools/ and checks each tool against kit/CONTRACT.md. Zero
// dependencies: Node built-ins only, so the checker runs wherever Node runs.
//
//   node kit/kit-check.js            check every tool, print a table
//   node kit/kit-check.js --json     machine-readable output
//   node kit/kit-check.js <name>     check one tool
//   node kit/kit-check.js --no-run   skip running the test suites
//
// Exits 0 if everything passes, 1 otherwise.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const scan = require('./kit-scan.js');

const ROOT = path.resolve(__dirname, '..');
const TOOLS_DIR = path.join(ROOT, 'tools');
const SITE_INDEX = path.join(ROOT, 'site', 'index.html');

// Every path the checker looks at is derived from a root, so the checker
// can be pointed at a throwaway repository when it is tested. The default
// root is this repository.
function toolsDir(root) {
  return path.join(root || ROOT, 'tools');
}

function siteIndex(root) {
  return path.join(root || ROOT, 'site', 'index.html');
}
const PROVENANCE_FORMAT = 'kit.provenance/1';

// ---------------------------------------------------------------- utilities

function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ the rules
// A rule returns an array of {ok, detail}. detail is one short line that
// says what was seen, not what to feel about it.

// Contract 2: no dependencies.
//
// The specifier is found by looking at code, not at text. A string that
// merely contains "require('chalk')" is not an import, and the checker's
// own pattern table is not a violation of the rule it states.
function ruleNoDependencies(files) {
  const bad = [];
  for (const f of files) {
    if (f.text === null) continue;
    // In an HTML file the only place an import can be is inside an
    // inline script. The prose around it is not JavaScript, and prose
    // that happens to contain the word "from" is not an import.
    const sources = /\.html$/i.test(f.name) ? scan.htmlScripts(f.text) : [f.text];
    for (const src of sources) {
    const map = scan.scan(src);
    for (const imp of scan.codeImportSpecifiers(src, map)) {
      if (imp.spec === null || imp.spec === undefined) continue;
      const spec = imp.spec;
      const ok =
        spec.startsWith('node:') ||
        spec.startsWith('.') ||
        spec.startsWith('/') ||
        spec === 'assert';
      if (!ok) bad.push(`${f.name}: imports "${spec}"`);
    }
    }
  }
  return [
    {
      ok: bad.length === 0,
      detail:
        bad.length === 0
          ? 'no third-party imports'
          : bad.join('; '),
    },
  ];
}

// Contract 3: the one-file rule. The HTML must carry its own CSS and JS and
// must not pull in any external subresource.
function ruleOneFile(html) {
  if (html === null) return [{ ok: false, detail: 'html file missing' }];
  const found = [];
  const patterns = [
    { re: /<script\b[^>]*\bsrc\s*=\s*["']([^"']*)["']/gi, what: 'script src' },
    { re: /<link\b[^>]*\bhref\s*=\s*["']([^"']*)["']/gi, what: 'link href' },
    { re: /<img\b[^>]*\bsrc\s*=\s*["']([^"']*)["']/gi, what: 'img src' },
    { re: /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']*)["']/gi, what: 'iframe src' },
    { re: /<source\b[^>]*\bsrc\s*=\s*["']([^"']*)["']/gi, what: 'source src' },
    { re: /<object\b[^>]*\bdata\s*=\s*["']([^"']*)["']/gi, what: 'object data' },
    { re: /<embed\b[^>]*\bsrc\s*=\s*["']([^"']*)["']/gi, what: 'embed src' },
    { re: /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi, what: 'css @import' },
    { re: /url\(\s*["']?(https?:\/\/|\/\/)/gi, what: 'css url()' },
  ];
  for (const { re, what } of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(html)) !== null) {
      const target = m[1].trim();
      // A data: URI is inline, not external. A fragment is not a subresource.
      if (target.startsWith('data:') || target.startsWith('#')) continue;
      found.push(`${what}="${target}"`);
    }
  }
  return [
    {
      ok: found.length === 0,
      detail:
        found.length === 0
          ? 'no external subresources'
          : `external subresources: ${found.join('; ')}`,
    },
  ];
}

// Contract 4: no network.
//
// The names are looked for in code. A tool that writes about fetch() in a
// comment is not a tool that fetches. In an HTML file the search runs over
// the inline scripts and event handlers, because that is where a call
// would live.
const NETWORK_PATTERNS = [
  { re: /\bfetch\s*\(/g, what: 'fetch(' },
  { re: /\bXMLHttpRequest\b/g, what: 'XMLHttpRequest' },
  { re: /\bnew\s+WebSocket\b/g, what: 'new WebSocket' },
  { re: /\bnew\s+EventSource\b/g, what: 'new EventSource' },
  { re: /\bsendBeacon\b/g, what: 'sendBeacon' },
];

function ruleNoNetwork(files) {
  const found = [];
  for (const f of files) {
    if (f.text === null) continue;
    const sources = /\.html$/i.test(f.name)
      ? scan.htmlScripts(f.text)
      : [f.text];
    for (const src of sources) {
      const map = scan.scan(src);
      const code = scan.codeText(src, map);
      for (const { re, what } of NETWORK_PATTERNS) {
        re.lastIndex = 0;
        if (re.test(code)) found.push(`${f.name}: ${what}`);
      }
      for (const imp of scan.codeImportSpecifiers(src, map)) {
        if (imp.spec && /^https?:/i.test(imp.spec)) {
          found.push(`${f.name}: remote import("${imp.spec}")`);
        }
      }
    }
  }
  return [
    {
      ok: found.length === 0,
      detail: found.length === 0 ? 'no network calls' : found.join('; '),
    },
  ];
}

// Contract 5: the CLI.
function ruleCli(toolPath, name) {
  const out = [];
  const bin = path.join(toolPath, `${name}.js`);
  if (!exists(bin)) return [{ ok: false, detail: 'cli file missing' }];

  const help = spawnSync(process.execPath, [bin, '--help'], {
    encoding: 'utf8',
    timeout: 30000,
  });
  const helpOk = help.status === 0 && (help.stdout || '').trim().length > 0;
  out.push({
    ok: helpOk,
    detail: helpOk
      ? `--help exits 0, ${(help.stdout || '').trim().split('\n').length} lines`
      : `--help failed (status ${help.status})`,
  });

  const ver = spawnSync(process.execPath, [bin, '--version'], {
    encoding: 'utf8',
    timeout: 30000,
  });
  const verOut = (ver.stdout || '').trim();
  const verOk = ver.status === 0 && verOut.includes(name) && /\d+\.\d+\.\d+/.test(verOut);
  out.push({
    ok: verOk,
    detail: verOk ? `--version prints "${verOut}"` : `--version bad (status ${ver.status}, out "${verOut}")`,
  });
  return out;
}

// Contract 6: tests exist, and pass.
function ruleTests(toolPath, name, runTests) {
  const testFile = path.join(toolPath, `${name}.test.js`);
  if (!exists(testFile)) return [{ ok: false, detail: 'test file missing' }];
  const text = readText(testFile) || '';
  if (!/require\(\s*['"]node:test['"]\s*\)/.test(text)) {
    return [{ ok: false, detail: 'test file does not use node:test' }];
  }
  if (!runTests) {
    return [{ ok: true, detail: 'test file present (not run: --no-run)' }];
  }
  const res = spawnSync(process.execPath, ['--test', testFile], {
    encoding: 'utf8',
    timeout: 120000,
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  const pass = res.status === 0;
  const m = out.match(/pass (\d+)/);
  return [
    {
      ok: pass,
      detail: pass
        ? `tests pass${m ? ` (${m[1]} passing)` : ''}`
        : `tests FAIL (status ${res.status})`,
    },
  ];
}

// Contract 7: the README.
function ruleReadme(toolPath, name) {
  const p = path.join(toolPath, 'README.md');
  const text = readText(p);
  if (text === null) return [{ ok: false, detail: 'README.md missing' }];

  const prose = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
  const sentences = prose
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^#/.test(s));
  const okSentences = sentences.length >= 5;
  const okHtml = text.includes(`${name}.html`);
  const okCli = text.includes(`tools/${name}/${name}.js`);
  return [
    { ok: okSentences, detail: `${sentences.length} sentences (need 5)` },
    { ok: okHtml, detail: okHtml ? `names ${name}.html` : `does not name ${name}.html` },
    { ok: okCli, detail: okCli ? 'names its CLI command' : 'does not name its CLI command' },
  ];
}

// Contract 9: the face.
function ruleOnSite(name, root) {
  const html = readText(siteIndex(root));
  if (html === null) {
    return [{ ok: false, detail: 'site/index.html missing' }];
  }
  const needle = `tools/${name}/${name}.html`;
  const ok = html.includes(needle);
  return [
    {
      ok,
      detail: ok ? 'listed on site/index.html' : `not listed on site/index.html (${needle} not found)`,
    },
  ];
}

// Contract 8: provenance sidecars, wherever they appear.
function checkSidecarObject(obj, label) {
  const issues = [];
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return [`${label}: not a JSON object`];
  }
  if (obj.format !== PROVENANCE_FORMAT) {
    issues.push(`${label}: format is "${obj.format}", expected "${PROVENANCE_FORMAT}"`);
  }
  if (typeof obj.file !== 'object' || obj.file === null) {
    issues.push(`${label}: missing "file"`);
  } else {
    if (typeof obj.file.name !== 'string' || obj.file.name === '') {
      issues.push(`${label}: file.name missing`);
    }
    if (!Number.isInteger(obj.file.size) || obj.file.size < 0) {
      issues.push(`${label}: file.size is not a non-negative integer`);
    }
    if (typeof obj.file.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(obj.file.sha256)) {
      issues.push(`${label}: file.sha256 is not 64 lowercase hex characters`);
    }
  }
  if (!Array.isArray(obj.claims)) {
    issues.push(`${label}: "claims" is not an array`);
  } else {
    obj.claims.forEach((c, i) => {
      const at = `${label}: claim[${i}]`;
      if (typeof c !== 'object' || c === null) {
        issues.push(`${at} is not an object`);
        return;
      }
      if (typeof c.tool !== 'string' || !c.tool.includes('/')) {
        issues.push(`${at}.tool is not a "name/version" string`);
      }
      if (typeof c.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(c.at)) {
        issues.push(`${at}.at is not an ISO 8601 timestamp`);
      }
      if (typeof c.kind !== 'string' || c.kind === '') {
        issues.push(`${at}.kind is missing`);
      }
    });
  }
  return issues;
}

function ruleSidecars(root) {
  const issues = [];
  let checked = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.provenance.json')) {
        checked += 1;
        const rel = path.relative(root || ROOT, full).split(path.sep).join('/');
        const text = readText(full);
        if (text === null) {
          issues.push(`${rel}: unreadable`);
          continue;
        }
        let obj;
        try {
          obj = JSON.parse(text);
        } catch (e) {
          issues.push(`${rel}: invalid JSON (${e.message})`);
          continue;
        }
        issues.push(...checkSidecarObject(obj, rel));
      }
    }
  };
  walk(root || ROOT);
  return [
    {
      ok: issues.length === 0,
      detail:
        issues.length === 0
          ? `${checked} sidecar${checked === 1 ? '' : 's'} valid`
          : issues.join('; '),
    },
  ];
}

// --------------------------------------------------------------- tool checks

function checkTool(name, opts) {
  const runTests = opts.runTests !== false;
  const root = opts.root || ROOT;
  const toolPath = path.join(toolsDir(root), name);
  const results = [];

  if (!exists(toolPath) || !fs.statSync(toolPath).isDirectory()) {
    return { name, missing: true, results: [] };
  }

  // Contract 1: layout.
  const layout = ['README.md', `${name}.html`, `${name}.js`, `${name}.test.js`];
  const missing = layout.filter((f) => !exists(path.join(toolPath, f)));
  results.push({
    rule: 'layout',
    checks: [
      {
        ok: missing.length === 0,
        detail:
          missing.length === 0
            ? `README, html, js, test all present`
            : `missing: ${missing.join(', ')}`,
      },
    ],
  });

  const htmlText = readText(path.join(toolPath, `${name}.html`));
  const files = [
    { name: `${name}.html`, text: htmlText },
    { name: `${name}.js`, text: readText(path.join(toolPath, `${name}.js`)) },
    {
      name: `${name}.test.js`,
      text: readText(path.join(toolPath, `${name}.test.js`)),
    },
  ];

  results.push({ rule: 'no-dependencies', checks: ruleNoDependencies(files) });
  results.push({ rule: 'one-file', checks: ruleOneFile(htmlText) });
  results.push({ rule: 'no-network', checks: ruleNoNetwork(files) });
  results.push({ rule: 'cli', checks: ruleCli(toolPath, name) });
  results.push({ rule: 'tests', checks: ruleTests(toolPath, name, runTests) });
  results.push({ rule: 'readme', checks: ruleReadme(toolPath, name) });
  results.push({ rule: 'on-site', checks: ruleOnSite(name, root) });

  return { name, missing: false, results };
}

// -------------------------------------------------------------- repo checks

function checkRepo(opts) {
  const results = [];
  const root = opts.root || ROOT;

  // No node_modules anywhere.
  let nm = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === '.git') continue;
      if (e.name === 'node_modules') {
        nm.push(path.relative(ROOT, path.join(dir, e.name)).split(path.sep).join('/'));
        continue;
      }
      if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  results.push({
    rule: 'no-node-modules',
    checks: [
      {
        ok: nm.length === 0,
        detail: nm.length === 0 ? 'no node_modules' : `node_modules present: ${nm.join(', ')}`,
      },
    ],
  });

  // package.json, if present, declares no dependencies.
  const pkgText = readText(path.join(root, 'package.json'));
  if (pkgText !== null) {
    let pkg = null;
    try {
      pkg = JSON.parse(pkgText);
    } catch (e) {
      pkg = null;
      results.push({
        rule: 'no-dependencies',
        checks: [{ ok: false, detail: `package.json is invalid JSON: ${e.message}` }],
      });
    }
    if (pkg) {
      const deps = Object.keys(pkg.dependencies || {}).concat(
        Object.keys(pkg.devDependencies || {})
      );
      results.push({
        rule: 'no-dependencies',
        checks: [
          {
            ok: deps.length === 0,
            detail:
              deps.length === 0
                ? 'package.json declares no dependencies'
                : `package.json declares: ${deps.join(', ')}`,
          },
        ],
      });
    }
  }

  // The site face exists, and obeys the same rules the tools obey.
  const siteText = readText(siteIndex(root));
  results.push({
    rule: 'site',
    checks: [
      {
        ok: siteText !== null,
        detail: siteText !== null ? 'site/index.html present' : 'site/index.html missing',
      },
    ],
  });
  if (siteText !== null) {
    results.push({
      rule: 'site-one-file',
      checks: ruleOneFile(siteText).map((c) => ({
        ok: c.ok,
        detail: 'site: ' + c.detail,
      })),
    });
    results.push({
      rule: 'site-no-network',
      checks: ruleNoNetwork([{ name: 'site/index.html', text: siteText }]).map((c) => ({
        ok: c.ok,
        detail: 'site: ' + c.detail,
      })),
    });
  }

  // The kit itself obeys the kit.
  const kitFiles = [
    { name: 'kit/kit-check.js', text: readText(path.join(root, 'kit', 'kit-check.js')) },
    {
      name: 'kit/kit-check.test.js',
      text: readText(path.join(root, 'kit', 'kit-check.test.js')),
    },
    { name: 'kit/kit-scan.js', text: readText(path.join(root, 'kit', 'kit-scan.js')) },
  ];
  results.push({ rule: 'kit-no-dependencies', checks: ruleNoDependencies(kitFiles) });
  results.push({ rule: 'kit-no-network', checks: ruleNoNetwork(kitFiles) });

  // Every sidecar in the repository is well formed.
  results.push({ rule: 'sidecars', checks: ruleSidecars(root) });

  return results;
}

// ------------------------------------------------------------------- output

function listTools(root) {
  let entries;
  try {
    entries = fs.readdirSync(toolsDir(root), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function toolPassed(tool) {
  if (tool.missing) return false;
  return tool.results.every((r) => r.checks.every((c) => c.ok));
}

function main(argv) {
  const args = argv.slice(2);
  const opts = { runTests: !args.includes('--no-run') };
  const names = args.filter((a) => !a.startsWith('--'));

  const tools = (names.length > 0 ? names : listTools()).map((n) =>
    checkTool(n, opts)
  );
  const repo = checkRepo(opts);

  if (args.includes('--json')) {
    const payload = {
      repo: repo.map((r) => ({ rule: r.rule, checks: r.checks })),
      tools: tools.map((t) => ({
        name: t.name,
        missing: t.missing,
        rules: t.results.map((r) => ({ rule: r.rule, checks: r.checks })),
      })),
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    const line = 'PASS';
    for (const r of repo) {
      for (const c of r.checks) {
        process.stdout.write(
          `${c.ok ? line : 'FAIL'}  ${r.rule.padEnd(20)} ${c.detail}\n`
        );
      }
    }
    process.stdout.write('\n');
    if (tools.length === 0) {
      process.stdout.write('no tools found in tools/\n');
    }
    for (const t of tools) {
      if (t.missing) {
        process.stdout.write(`FAIL  ${t.name.padEnd(20)} tool directory not found\n`);
        continue;
      }
      for (const r of t.results) {
        for (const c of r.checks) {
          process.stdout.write(
            `${c.ok ? line : 'FAIL'}  ${(t.name + '/' + r.rule).padEnd(28)} ${c.detail}\n`
          );
        }
      }
    }
  }

  const repoOk = repo.every((r) => r.checks.every((c) => c.ok));
  const toolsOk = tools.every(toolPassed);
  process.exitCode = repoOk && toolsOk ? 0 : 1;
}

module.exports = {
  checkTool,
  checkRepo,
  checkSidecarObject,
  listTools,
  toolPassed,
  ruleNoDependencies,
  ruleOneFile,
  ruleNoNetwork,
  ruleCli,
  ruleTests,
  ruleReadme,
  ruleOnSite,
  ruleSidecars,
  scan,
  toolsDir,
  siteIndex,
  PROVENANCE_FORMAT,
  ROOT,
};

if (require.main === module) {
  main(process.argv);
}
