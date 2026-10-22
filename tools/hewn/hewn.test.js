'use strict';
/* Hewn test suite. Run with: node --test tools/hewn/hewn.test.js
 *
 * Three kinds of test live here:
 *   - the engine: does it parse, does it find the defect it claims to find
 *   - the fixtures: one deliberately broken file per rule, so a rule that
 *     stops firing fails the suite instead of quietly reporting nothing
 *   - the faces: does hewn.html carry the same engine hewn.js runs
 */

var test = require('node:test');
var assert = require('node:assert');
var fs = require('node:fs');
var path = require('node:path');
var { spawnSync } = require('node:child_process');
var hewn = require('./hewn.js');

var HERE = __dirname;
var FIXTURES = path.join(HERE, 'fixtures');
var CLI = path.join(HERE, 'hewn.js');
var FACE = path.join(HERE, 'hewn.html');

var BEGIN = '/* hewn-engine:begin */';
var END = '/* hewn-engine:end */';

function ids(prof) {
  return prof.issues.map(function (i) { return i.id; });
}

function find(prof, id) {
  return prof.issues.filter(function (i) { return i.id === id; })[0];
}

function prof(text, opts) {
  return hewn.profile(hewn.parse(text, opts || {}));
}

/* --- parsing ------------------------------------------------------ */

test('parses a simple CSV with a header row', function () {
  var t = hewn.parse('a,b\n1,2\n3,4\n');
  assert.deepStrictEqual(t.headers, ['a', 'b']);
  assert.strictEqual(t.rows.length, 2);
  assert.strictEqual(t.delimiter, ',');
});

test('detects a tab delimiter', function () {
  var t = hewn.parse('a\tb\tc\n1\t2\t3\n');
  assert.strictEqual(t.delimiter, '\t');
  assert.deepStrictEqual(t.headers, ['a', 'b', 'c']);
});

test('detects a semicolon delimiter', function () {
  var t = hewn.parse('a;b;c\n1;2;3\n4;5;6\n');
  assert.strictEqual(t.delimiter, ';');
});

test('honours an explicit delimiter over detection', function () {
  var t = hewn.parse('a;b\n1;2\n', { delimiter: ';' });
  assert.strictEqual(t.delimiter, ';');
  assert.deepStrictEqual(t.headers, ['a', 'b']);
});

test('keeps commas inside quoted fields', function () {
  var t = hewn.parse('name,note\n"Doe, Jane","said ""hi"""\n');
  assert.deepStrictEqual(t.headers, ['name', 'note']);
  assert.deepStrictEqual(t.rows[0], ['Doe, Jane', 'said "hi"']);
});

test('handles CRLF line endings', function () {
  var t = hewn.parse('a,b\r\n1,2\r\n');
  assert.deepStrictEqual(t.headers, ['a', 'b']);
  assert.deepStrictEqual(t.rows[0], ['1', '2']);
});

test('strips a UTF-8 byte order mark', function () {
  var t = hewn.parse('\uFEFFa,b\n1,2\n');
  assert.deepStrictEqual(t.headers, ['a', 'b']);
});

test('parses JSONL into a table', function () {
  var t = hewn.parse('{"a":1,"b":"x"}\n{"a":2,"b":"y"}\n', { format: 'jsonl' });
  assert.deepStrictEqual(t.headers, ['a', 'b']);
  assert.strictEqual(t.rows.length, 2);
});

test('parses a JSON array of objects', function () {
  var t = hewn.parse('[{"a":1},{"a":2,"b":3}]', { format: 'json' });
  assert.deepStrictEqual(t.headers, ['a', 'b']);
  assert.strictEqual(t.rows.length, 2);
});

test('reports the line numbers of unparseable JSONL', function () {
  var t = hewn.parse('{"a":1}\nnot json\n{"a":2}\n', { format: 'jsonl' });
  assert.deepStrictEqual(t.badLines, [2]);
  assert.strictEqual(t.rows.length, 2);
});

test('an empty input yields an empty table, not a crash', function () {
  var t = hewn.parse('');
  assert.strictEqual(t.rows.length, 0);
  assert.strictEqual(t.headers.length, 0);
});

test('a file with only a header yields no rows, not a crash', function () {
  var t = hewn.parse('a,b\n');
  assert.strictEqual(t.rows.length, 0);
});

/* --- rules --------------------------------------------------------- */

test('HEWN001 flags a column holding numbers and text', function () {
  var p = prof('n\n1\n2\nthree\n');
  var i = find(p, 'HEWN001');
  assert.ok(i, 'expected HEWN001');
  assert.strictEqual(i.severity, 'error');
  assert.strictEqual(i.column, 'n');
  assert.ok(i.detail.indexOf('not numbers') !== -1);
});

test('HEWN001 does not fire on a clean numeric column', function () {
  var p = prof('n\n1\n2\n3\n');
  assert.ok(!find(p, 'HEWN001'));
});

test('HEWN002 flags placeholder sentinels', function () {
  var p = prof('n\n1\nNA\n2\n-\n');
  var i = find(p, 'HEWN002');
  assert.ok(i, 'expected HEWN002');
  assert.strictEqual(i.severity, 'warn');
  assert.strictEqual(i.count, 2);
  assert.ok(i.evidence.some(function (e) { return e.indexOf('NA') !== -1; }));
});

test('HEWN002 does not treat 0 or none as missing', function () {
  var p = prof('n\n0\n1\nnone\n');
  assert.ok(!find(p, 'HEWN002'));
});

test('HEWN002 does not fire on an empty string (that is HEWN010 territory)', function () {
  var p = prof('n\n1\n\n2\n');
  assert.ok(!find(p, 'HEWN002'));
});

test('HEWN003 flags two date layouts in one column', function () {
  var p = prof('d\n2024-01-05\n05/06/2024\n');
  var i = find(p, 'HEWN003');
  assert.ok(i, 'expected HEWN003');
  assert.ok(i.detail.indexOf('date layouts') !== -1);
});

test('HEWN003 flags day-first mixed with month-first', function () {
  var p = prof('d\n13/01/2024\n01/13/2024\n');
  var i = find(p, 'HEWN003');
  assert.ok(i, 'expected HEWN003');
  assert.ok(i.detail.indexOf('day-first') !== -1);
});

test('HEWN003 flags an ambiguous date sitting beside a day-first date', function () {
  var p = prof('d\n13/01/2024\n01/02/2024\n');
  var i = find(p, 'HEWN003');
  assert.ok(i, 'expected HEWN003');
  assert.ok(i.detail.indexOf('either day or month') !== -1);
});

test('HEWN003 does not fire on a single consistent date format', function () {
  var p = prof('d\n2024-01-05\n2024-02-06\n');
  assert.ok(!find(p, 'HEWN003'));
});

test('HEWN003 does not fire when every numeric date is equally ambiguous', function () {
  /* All rows are ambiguous, so no row contradicts another. */
  var p = prof('d\n01/02/2024\n03/04/2024\n');
  assert.ok(!find(p, 'HEWN003'));
});

test('HEWN004 flags casing drift in one category', function () {
  var p = prof('c\nApple\napple\nAPPLE\n');
  var i = find(p, 'HEWN004');
  assert.ok(i, 'expected HEWN004');
  assert.ok(i.detail.indexOf('3 ways') !== -1);
});

test('HEWN004 does not fire when spellings genuinely differ', function () {
  var p = prof('c\nApple\nPear\n');
  assert.ok(!find(p, 'HEWN004'));
});

test('HEWN005 flags leading and trailing spaces', function () {
  var p = prof('c\nhello \n world\n');
  var i = find(p, 'HEWN005');
  assert.ok(i, 'expected HEWN005');
  assert.strictEqual(i.count, 2);
});

test('HEWN006 flags a constant column', function () {
  var p = prof('c\nsame\nsame\nsame\n');
  var i = find(p, 'HEWN006');
  assert.ok(i, 'expected HEWN006');
});

test('HEWN007 flags duplicate column names', function () {
  var p = prof('a,a\n1,2\n');
  var i = find(p, 'HEWN007');
  assert.ok(i, 'expected HEWN007');
  assert.strictEqual(i.severity, 'error');
});

test('HEWN008 flags a ragged row', function () {
  var p = prof('a,b\n1,2\n3\n');
  var i = find(p, 'HEWN008');
  assert.ok(i, 'expected HEWN008');
  assert.strictEqual(i.severity, 'error');
});

test('HEWN008 names the likely cause when a decimal comma split a row', function () {
  var p = prof('a,b\n1,2\n3,2,5\n');
  var i = find(p, 'HEWN008');
  assert.ok(i, 'expected HEWN008');
  assert.ok(i.detail.indexOf('split in two') !== -1, 'detail was: ' + i.detail);
});

test('HEWN009 flags two decimal conventions', function () {
  var p = prof('n\n1.5\n"2,5"\n');
  var i = find(p, 'HEWN009');
  assert.ok(i, 'expected HEWN009');
  assert.strictEqual(i.severity, 'error');
});

test('HEWN009 does not fire on thousands separators used consistently', function () {
  var p = prof('n\n1,500\n2,500\n');
  assert.ok(!find(p, 'HEWN009'));
});

test('HEWN010 flags a column with no values', function () {
  var p = prof('a,b\n1,\n2,\n');
  var i = find(p, 'HEWN010');
  assert.ok(i, 'expected HEWN010');
});

test('HEWN011 flags repeated rows', function () {
  var p = prof('a,b\n1,2\n1,2\n3,4\n');
  var i = find(p, 'HEWN011');
  assert.ok(i, 'expected HEWN011');
  assert.strictEqual(i.count, 1);
});

test('HEWN012 flags a zero-dominated numeric column', function () {
  var p = prof('n\n0\n0\n0\n5\n7\n');
  var i = find(p, 'HEWN012');
  assert.ok(i, 'expected HEWN012');
  assert.strictEqual(i.severity, 'info');
});

test('HEWN012 does not fire when every value is zero', function () {
  var p = prof('n\n0\n0\n0\n0\n0\n');
  assert.ok(!find(p, 'HEWN012'));
});

test('HEWN013 flags values grouped in threes beside a four-digit value', function () {
  var p = prof('n\n1.234\n2.345\n5678\n');
  var i = find(p, 'HEWN013');
  assert.ok(i, 'expected HEWN013');
  assert.strictEqual(i.severity, 'error');
  assert.strictEqual(i.count, 2);
});

test('HEWN013 does not fire without a corroborating four-digit value', function () {
  var p = prof('n\n1.234\n2.345\n');
  assert.ok(!find(p, 'HEWN013'));
});

test('HEWN013 does not fire on a column of plain small decimals', function () {
  var p = prof('n\n1.5\n2.5\n3.5\n');
  assert.ok(!find(p, 'HEWN013'));
});

/* --- one fixture per rule ------------------------------------------ */
/* A rule that cannot demonstrate it finds a real defect is a rule that
 * might be doing nothing at all. Each rule below has a file next to this
 * suite, broken in exactly that way, and the rule must fire on it. */

var FIXTURE_RULES = [
  ['HEWN001', 'HEWN001-mixed-type.csv'],
  ['HEWN002', 'HEWN002-missing-sentinel.csv'],
  ['HEWN003', 'HEWN003-mixed-date-format.csv'],
  ['HEWN004', 'HEWN004-casing-drift.csv'],
  ['HEWN005', 'HEWN005-edge-whitespace.csv'],
  ['HEWN006', 'HEWN006-constant-column.csv'],
  ['HEWN007', 'HEWN007-duplicate-header.csv'],
  ['HEWN008', 'HEWN008-ragged-row.csv'],
  ['HEWN009', 'HEWN009-decimal-conflict.csv'],
  ['HEWN010', 'HEWN010-empty-column.csv'],
  ['HEWN011', 'HEWN011-duplicate-rows.csv'],
  ['HEWN012', 'HEWN012-zero-dominated.csv'],
  ['HEWN013', 'HEWN013-hidden-thousands.csv']
];

FIXTURE_RULES.forEach(function (pair) {
  var id = pair[0];
  var file = pair[1];
  test(id + ' fires on its own fixture file', function () {
    var p = path.join(FIXTURES, file);
    assert.ok(fs.existsSync(p), 'missing fixture ' + file);
    var text = fs.readFileSync(p, 'utf8');
    var prof = hewn.profile(hewn.parse(text));
    var issue = find(prof, id);
    assert.ok(issue, id + ' did not fire on ' + file +
      '; it found instead: ' + JSON.stringify(ids(prof)));
    assert.ok(issue.evidence.length > 0, id + ' fired on ' + file + ' with no evidence');
    assert.ok(issue.detail.length > 0, id + ' fired on ' + file + ' with no explanation');
  });
});

test('every rule Hewn declares has a fixture', function () {
  var declared = hewn.RULES.map(function (r) { return r.id; });
  var covered = FIXTURE_RULES.map(function (p) { return p[0]; });
  declared.forEach(function (id) {
    assert.ok(covered.indexOf(id) !== -1, id + ' has no fixture');
  });
  covered.forEach(function (id) {
    assert.ok(declared.indexOf(id) !== -1, id + ' has a fixture but no rule');
  });
  assert.strictEqual(declared.length, 13);
});

/* --- classification ------------------------------------------------ */

test('classifies values into kinds', function () {
  assert.strictEqual(hewn.classify('').kind, 'empty');
  assert.strictEqual(hewn.classify('NA').kind, 'missing');
  assert.strictEqual(hewn.classify('12').kind, 'number');
  assert.strictEqual(hewn.classify('-3.5').kind, 'number');
  assert.strictEqual(hewn.classify('2024-01-05').kind, 'date');
  assert.strictEqual(hewn.classify('true').kind, 'boolean');
  assert.strictEqual(hewn.classify('hello').kind, 'text');
});

test('reads European decimal commas as numbers', function () {
  var c = hewn.classify('2,5');
  assert.strictEqual(c.kind, 'number');
  assert.strictEqual(c.value, 2.5);
  assert.strictEqual(c.style, 'eu');
});

test('an ambiguous numeric date is marked ambiguous', function () {
  var c = hewn.classify('01/02/2024');
  assert.strictEqual(c.kind, 'date');
  assert.strictEqual(c.ambiguous, true);
  assert.strictEqual(c.order, null);
});

test('a day-first numeric date is settled, not ambiguous', function () {
  var c = hewn.classify('13/02/2024');
  assert.strictEqual(c.kind, 'date');
  assert.strictEqual(c.order, 'dmy');
  assert.strictEqual(c.ambiguous, false);
});

/* --- fixes --------------------------------------------------------- */

test('applyFixes trims whitespace and reports each change', function () {
  var t = hewn.parse('c\nhello \n world\n');
  var p = hewn.profile(t);
  var res = hewn.applyFixes(t, p.suggestions);
  assert.deepStrictEqual(res.table.rows[0], ['hello']);
  assert.deepStrictEqual(res.table.rows[1], ['world']);
  assert.strictEqual(res.changes.length, 2);
});

test('applyFixes normalises casing to the most common spelling', function () {
  var t = hewn.parse('c\nApple\napple\n');
  var p = hewn.profile(t);
  var res = hewn.applyFixes(t, p.suggestions);
  assert.deepStrictEqual(res.table.rows[1], ['Apple']);
});

test('applyFixes blanks out sentinels', function () {
  var t = hewn.parse('n\n1\nNA\n');
  var p = hewn.profile(t);
  var res = hewn.applyFixes(t, p.suggestions);
  assert.deepStrictEqual(res.table.rows[1], ['']);
});

test('applyFixes rewrites European decimals as plain numbers', function () {
  var t = hewn.parse('n\n1.5\n"2,5"\n');
  var p = hewn.profile(t);
  var res = hewn.applyFixes(t, p.suggestions);
  assert.deepStrictEqual(res.table.rows[1], ['2.5']);
});

test('applyFixes rewrites grouped thousands as plain integers', function () {
  var t = hewn.parse('n\n1.234\n2.345\n5678\n');
  var p = hewn.profile(t);
  var res = hewn.applyFixes(t, p.suggestions);
  assert.deepStrictEqual(res.table.rows[0], ['1234']);
  assert.deepStrictEqual(res.table.rows[1], ['2345']);
  assert.deepStrictEqual(res.table.rows[2], ['5678']);
});

test('applyFixes never touches the input table', function () {
  var t = hewn.parse('c\nhello \n');
  var p = hewn.profile(t);
  hewn.applyFixes(t, p.suggestions);
  assert.deepStrictEqual(t.rows[0], ['hello ']);
});

test('the input file is never modified by profiling', function () {
  var t = hewn.parse('c\nhello \n');
  var before = JSON.stringify(t.rows);
  hewn.profile(t);
  assert.strictEqual(JSON.stringify(t.rows), before);
});

test('applyFixes on a table with no suggestions changes nothing', function () {
  var t = hewn.parse('a,b\n1,2\n3,4\n');
  var p = hewn.profile(t);
  var res = hewn.applyFixes(t, p.suggestions);
  assert.deepStrictEqual(res.table.rows, t.rows);
  assert.strictEqual(res.changes.length, 0);
});

/* --- output -------------------------------------------------------- */

test('toMarkdown produces a report naming the column and the rule', function () {
  var p = prof('n\n1\ntwo\n');
  var md = hewn.toMarkdown(p, { title: 'demo.csv' });
  assert.ok(md.indexOf('# Data profile - demo.csv') !== -1);
  assert.ok(md.indexOf('HEWN001') !== -1);
  assert.ok(md.indexOf('| # | Name | Type') !== -1);
});

test('toMarkdown says so plainly when there are no issues', function () {
  var p = prof('n\n1\n2\n3\n');
  var md = hewn.toMarkdown(p);
  assert.ok(md.indexOf('None found') !== -1);
});

test('toDelimited round-trips through the parser', function () {
  var t = hewn.parse('a,b\n"x,1",2\n');
  var out = hewn.toDelimited(t);
  var t2 = hewn.parse(out);
  assert.deepStrictEqual(t2.headers, ['a', 'b']);
  assert.deepStrictEqual(t2.rows[0], ['x,1', '2']);
});

/* --- profile shape -------------------------------------------------- */

test('a profile reports row, column and cell counts', function () {
  var p = prof('a,b\n1,2\n3,4\n5,6\n');
  assert.strictEqual(p.summary.rows, 3);
  assert.strictEqual(p.summary.columns, 2);
  assert.strictEqual(p.summary.cells, 6);
});

test('a clean table produces no issues at all', function () {
  var p = prof('id,name,score\n1,Ada,10\n2,Grace,12\n3,Linus,11\n');
  assert.deepStrictEqual(ids(p), []);
});

test('every issue carries a known rule id and a severity', function () {
  var p = prof('a,a\n1,2\n3\n');
  p.issues.forEach(function (i) {
    assert.ok(hewn.RULE_BY_ID[i.id], 'unknown rule id ' + i.id);
    assert.ok(['error', 'warn', 'info'].indexOf(i.severity) !== -1);
    assert.ok(typeof i.detail === 'string' && i.detail.length > 0);
  });
});

test('column names are preserved exactly in the profile', function () {
  var p = prof('Total Amount (USD)\n1\n');
  assert.strictEqual(p.columns[0].name, 'Total Amount (USD)');
});

/* --- the two faces carry the same engine ---------------------------- */
/* The page and the command line must never disagree about what is wrong
 * with a file. The proof is mechanical: the engine block in hewn.js and
 * the engine block in hewn.html have to be byte for byte the same. */

function engineBlock(text) {
  var b = text.indexOf(BEGIN);
  var e = text.indexOf(END);
  assert.ok(b !== -1, 'the engine markers are missing');
  assert.ok(e > b, 'the engine markers are in the wrong order');
  return text.slice(b + BEGIN.length, e);
}

test('hewn.html carries the same engine hewn.js runs', function () {
  var js = fs.readFileSync(CLI, 'utf8');
  var html = fs.readFileSync(FACE, 'utf8');
  assert.strictEqual(
    engineBlock(html),
    engineBlock(js),
    'hewn.html and hewn.js have drifted apart; run: node tools/hewn/hewn.js --sync-html'
  );
});

test('hewn.html loads no external subresource', function () {
  var html = fs.readFileSync(FACE, 'utf8');
  var external = [
    { re: /<script\b[^>]*\bsrc\s*=\s*["']([^"']*)["']/gi, what: 'script src' },
    { re: /<link\b[^>]*\bhref\s*=\s*["']([^"']*)["']/gi, what: 'link href' },
    { re: /<img\b[^>]*\bsrc\s*=\s*["']([^"']*)["']/gi, what: 'img src' },
    { re: /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']*)["']/gi, what: 'iframe src' }
  ];
  var found = [];
  external.forEach(function (p) {
    var m;
    p.re.lastIndex = 0;
    while ((m = p.re.exec(html)) !== null) {
      if (m[1].trim().charAt(0) !== '#') found.push(p.what + '="' + m[1] + '"');
    }
  });
  assert.deepStrictEqual(found, [], 'the page must work from disk with nothing else');
});

test('hewn.html and hewn.js both mention every rule id', function () {
  var html = fs.readFileSync(FACE, 'utf8');
  var js = fs.readFileSync(CLI, 'utf8');
  hewn.RULES.forEach(function (r) {
    assert.ok(html.indexOf(r.id) !== -1, r.id + ' is missing from hewn.html');
    assert.ok(js.indexOf(r.id) !== -1, r.id + ' is missing from hewn.js');
  });
});

/* --- the command line ------------------------------------------------ */

function run(args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: 'utf8',
    timeout: 30000
  });
}

test('--help exits 0 and says what the tool does and does not do', function () {
  var r = run(['--help']);
  assert.strictEqual(r.status, 0);
  assert.ok(r.stdout.indexOf('Usage:') !== -1);
  assert.ok(r.stdout.indexOf('does not') !== -1 || r.stdout.indexOf('NOT') !== -1);
});

test('--version prints the name and a version number', function () {
  var r = run(['--version']);
  assert.strictEqual(r.status, 0);
  assert.ok(r.stdout.indexOf('hewn') !== -1);
  assert.ok(/\d+\.\d+\.\d+/.test(r.stdout), 'no version number in: ' + r.stdout);
});

test('no arguments prints the help and exits non-zero', function () {
  var r = run([]);
  assert.notStrictEqual(r.status, 0);
  assert.ok(r.stdout.indexOf('Usage:') !== -1);
});

test('a missing file exits 2 and says so', function () {
  var r = run([path.join(HERE, 'no-such-file.csv')]);
  assert.strictEqual(r.status, 2);
  assert.ok(r.stderr.indexOf('cannot read') !== -1);
});

test('an empty file exits 2 rather than crashing', function () {
  var empty = path.join(HERE, 'fixtures', 'empty.csv');
  fs.writeFileSync(empty, '', 'utf8');
  try {
    var r = run([empty]);
    assert.strictEqual(r.status, 2);
    assert.ok(r.stderr.indexOf('no data rows') !== -1);
  } finally {
    fs.unlinkSync(empty);
  }
});

test('a file with error-severity issues exits 1', function () {
  var r = run([path.join(FIXTURES, 'HEWN001-mixed-type.csv')]);
  assert.strictEqual(r.status, 1);
  assert.ok(r.stdout.indexOf('HEWN001') !== -1);
});

test('a clean file exits 0', function () {
  var r = run([path.join(FIXTURES, 'HEWN012-zero-dominated.csv')]);
  assert.strictEqual(r.status, 0);
});

test('--fix writes the repaired data to stdout and leaves the file alone', function () {
  var fixture = path.join(FIXTURES, 'HEWN005-edge-whitespace.csv');
  var before = fs.readFileSync(fixture, 'utf8');
  var r = run([fixture, '--fix']);
  assert.strictEqual(r.status, 0);
  assert.ok(r.stdout.indexOf('hello') !== -1);
  assert.ok(r.stdout.indexOf(' hello') === -1, 'the space was not trimmed');
  assert.strictEqual(fs.readFileSync(fixture, 'utf8'), before,
    'the CLI must never write to the file it was given');
});

test('--json prints the profile as JSON', function () {
  var r = run([path.join(FIXTURES, 'HEWN011-duplicate-rows.csv'), '--json']);
  assert.strictEqual(r.status, 0);
  var parsed = JSON.parse(r.stdout);
  assert.ok(Array.isArray(parsed.issues));
  assert.ok(parsed.issues.some(function (i) { return i.id === 'HEWN011'; }));
});

test('an unknown option is refused, not ignored', function () {
  var r = run(['--nonsense']);
  assert.strictEqual(r.status, 2);
  assert.ok(r.stderr.indexOf('unknown option') !== -1);
});
