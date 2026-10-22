#!/usr/bin/env node
/* BEGIN engine (from tools/level/level.js) */
'use strict';
// level - the engine.
//
// Checks the shape of a text file, and produces the levelled copy.
//
// The rules are objective, not stylistic. Every one of them can be
// settled by looking at bytes, and none of them is an opinion about
// what the file should contain:
//
//   crlf           the file uses CRLF (Windows) or bare CR (classic Mac)
//                 line endings
//   bom            the file starts with a UTF-8 byte order mark
//   encoding       the file is not valid UTF-8
//   final-newline  the file does not end with a newline
//   trailing-space a line ends in spaces or tabs
//   tabs           a line is indented with a tab character
//
// The engine takes bytes in and returns plain data out. It has no
// filesystem, no DOM, no clock and no randomness, so the command line
// and the browser page can both call it and cannot disagree about what
// "levelled" means.
//
// The page carries a copy of this file inline, between two marker
// comments. A test lifts that copy out of the page and compares it
// with this file, byte for byte, so the two cannot drift apart
// silently.
//
// Zero dependencies: nothing here but plain JavaScript.

const LEVEL_VERSION = '1.0.0';
const LEVEL_ID = 'level/' + LEVEL_VERSION;

// The width of a tab stop, in columns, used when a tab in an indent is
// expanded. Four is the width most editors use by default now.
const TAB_WIDTH = 4;

// The rules, in the order they are reported. A rule is
// { id, title, detail, fixable }.
const RULES = [
  {
    id: 'crlf',
    title: 'CRLF line endings',
    detail:
      'The file uses Windows line endings (CR LF), or a bare CR. Use LF ' +
      'instead: one byte per line ending, and the same file on every ' +
      'platform.',
    fixable: true,
  },
  {
    id: 'bom',
    title: 'UTF-8 byte order mark',
    detail:
      'The file starts with a UTF-8 byte order mark. Remove it: it is ' +
      'invisible, it is not part of the text, and it breaks tools that ' +
      'compare the first line.',
    fixable: true,
  },
  {
    id: 'encoding',
    title: 'not valid UTF-8',
    detail:
      'The file contains bytes that are not valid UTF-8. Level cannot fix ' +
      'this one, because guessing what the bytes were meant to be is a ' +
      'guess. Convert the file deliberately and check it again.',
    fixable: false,
  },
  {
    id: 'final-newline',
    title: 'no final newline',
    detail:
      'The file does not end with a newline. Add one, so that the last ' +
      'line is a line like any other and concatenation behaves.',
    fixable: true,
  },
  {
    id: 'trailing-space',
    title: 'trailing whitespace',
    detail:
      'A line ends in spaces or tabs. Strip them: they are invisible in ' +
      'most editors and they show up in diffs as changed lines.',
    fixable: true,
  },
  {
    id: 'tabs',
    title: 'tab indentation',
    detail:
      'A line is indented with a tab character. Replace the leading tabs ' +
      'with spaces: the width of a tab depends on the editor, and the ' +
      'width of a space does not.',
    fixable: true,
  },
];

const RULE_IDS = RULES.map((r) => r.id);

// ---------------------------------------------------------------- helpers

// Is this byte a UTF-8 continuation byte (10xxxxxx)?
function isContinuation(b) {
  return (b & 0xc0) === 0x80;
}

// Decode bytes as UTF-8, strictly. Returns { ok, text, reason }.
//
// Strict means overlong forms, lone surrogates and out-of-range code
// points are all rejected: a file that claims to be UTF-8 and is not
// is exactly the rot this tool exists to find.
function decodeUtf8(bytes) {
  let out = '';
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i++;
      continue;
    }
    let need = 0;
    let cp = 0;
    let min = 0;
    if (b >= 0xc2 && b <= 0xdf) {
      need = 1; cp = b & 0x1f; min = 0x80;
    } else if (b >= 0xe0 && b <= 0xef) {
      need = 2; cp = b & 0x0f; min = 0x800;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3; cp = b & 0x07; min = 0x10000;
    } else {
      return {
        ok: false,
        text: '',
        reason:
          'invalid UTF-8: unexpected byte 0x' + b.toString(16).padStart(2, '0') +
          ' at offset ' + i,
      };
    }
    // The last byte of the sequence must exist, so the sequence is
    // truncated when i + need is not less than n.
    if (i + need >= n) {
      return {
        ok: false,
        text: '',
        reason: 'invalid UTF-8: truncated sequence at offset ' + i,
      };
    }
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (!isContinuation(c)) {
        return {
          ok: false,
          text: '',
          reason:
            'invalid UTF-8: bad continuation byte at offset ' + (i + k),
        };
      }
      cp = (cp << 6) | (c & 0x3f);
    }
    if (cp < min) {
      return {
        ok: false,
        text: '',
        reason: 'invalid UTF-8: overlong sequence at offset ' + i,
      };
    }
    if (cp >= 0xd800 && cp <= 0xdfff) {
      return {
        ok: false,
        text: '',
        reason: 'invalid UTF-8: lone surrogate at offset ' + i,
      };
    }
    if (cp > 0x10ffff) {
      return {
        ok: false,
        text: '',
        reason: 'invalid UTF-8: code point out of range at offset ' + i,
      };
    }
    out += String.fromCodePoint(cp);
    i += need + 1;
  }
  return { ok: true, text: out, reason: null };
}

// The bytes of a string, as UTF-8. Written out rather than using
// TextEncoder, so the engine depends on no host API that might be
// missing in some browser.
//
// A lone surrogate in the string has no UTF-8 encoding, so it becomes
// U+FFFD, the replacement character. That is what a decoder is
// expected to produce for it, and it keeps this function total.
function encodeUtf8(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let cp = str.codePointAt(i);
    if (cp > 0xffff) i++; // the low surrogate is consumed
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
    }
  }
  return Uint8Array.from(out);
}

// Split text into lines, keeping the exact terminator that followed
// each one. A line is { text, ending }.
//
// All three terminators are understood - LF, CRLF and a bare CR - so a
// classic Mac file is counted the same way as a Unix one, and a line
// number means the same thing in every file.
//
// The last entry is the marker after the final newline. Its text is
// empty and its ending is empty. It is not a line of the file.
function splitLines(text) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') {
      lines.push({ text: text.slice(start, i), ending: '\n' });
      start = i + 1;
    } else if (c === '\r') {
      // A CRLF terminator is two bytes, but the line's text stops
      // before the CR. The end is remembered before the LF is
      // consumed, or the carriage return would end up inside the
      // line and be read as trailing whitespace.
      const end = i;
      let ending = '\r';
      if (text[i + 1] === '\n') {
        ending = '\r\n';
        i++;
      }
      lines.push({ text: text.slice(start, end), ending: ending });
      start = i + 1;
    }
  }
  lines.push({ text: text.slice(start), ending: '' });
  return lines;
}

// The lines of a text, as plain strings, with the terminators
// removed. A trailing newline does not make an extra line.
function realLines(text) {
  const lines = splitLines(text);
  const last = lines[lines.length - 1];
  if (lines.length > 0 && last.text === '' && last.ending === '') {
    lines.pop();
  }
  return lines.map((l) => l.text);
}

// The leading whitespace of a line, and the rest of it.
function splitIndent(line) {
  const m = /^[ \t]*/.exec(line);
  const indent = m[0];
  return { indent, rest: line.slice(indent.length) };
}

// Expand the tabs in an indent to spaces, stopping at the next tab
// stop. This is what a tab character means to an editor, so it is the
// honest expansion rather than a guess.
function expandIndent(indent) {
  let col = 0;
  let out = '';
  for (let i = 0; i < indent.length; i++) {
    const ch = indent[i];
    if (ch === '\t') {
      const width = TAB_WIDTH - (col % TAB_WIDTH);
      out += ' '.repeat(width);
      col += width;
    } else {
      out += ch;
      col += 1;
    }
  }
  return out;
}

// The first line number that uses CRLF.
function firstLineWithCrlf(text) {
  const lines = splitLines(text);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].ending === '\r\n') return i + 1;
  }
  return 1;
}

// The first line number that uses a bare CR.
function firstLineWithBareCr(text) {
  const lines = splitLines(text);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].ending === '\r') return i + 1;
  }
  return 1;
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ----------------------------------------------------------------- check

// check(bytes) -> the findings, and the levelled copy.
//
// This is the whole of the tool. The command line and the browser page
// both call this, so they cannot disagree about what level means.
function check(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);

  const findings = [];
  const notes = [];

  // --- the byte order mark
  let body = buf;
  const hasBom =
    buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  if (hasBom) {
    findings.push({
      rule: 'bom',
      line: 1,
      detail: 'the file starts with a UTF-8 byte order mark',
    });
    body = buf.subarray(3);
  }

  // --- the encoding
  const decoded = decodeUtf8(body);
  if (!decoded.ok) {
    findings.push({
      rule: 'encoding',
      line: null,
      detail: decoded.reason,
    });
    // The rest of the rules need text. With bytes that are not text
    // there is no honest answer about line endings or indentation, so
    // the other rules are not run and the file is not levelled.
    return {
      ok: false,
      findings: findings,
      notes: notes,
      levelled: null,
      changed: false,
      text: null,
      diff: null,
      size: buf.length,
      levelledSize: null,
      hadBom: hasBom,
      hadFinalNewline: null,
    };
  }

  const text = decoded.text;
  notes.push(
    'decoded as UTF-8' + (hasBom ? ' after removing the byte order mark' : '')
  );

  // --- the line endings
  const lines = splitLines(text);
  let crlfLine = 0;
  let crLine = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].ending === '\r\n' && crlfLine === 0) crlfLine = i + 1;
    if (lines[i].ending === '\r' && crLine === 0) crLine = i + 1;
  }
  if (crlfLine !== 0) {
    findings.push({
      rule: 'crlf',
      line: crlfLine,
      detail: 'the file uses CRLF (Windows) line endings',
    });
  }
  if (crLine !== 0) {
    findings.push({
      rule: 'crlf',
      line: crLine,
      detail: 'the file uses a bare CR (classic Mac) line ending',
    });
  }

  // The marker after the final newline is not a line of the file.
  const last = lines[lines.length - 1];
  const hasMarker = lines.length > 0 && last.text === '' && last.ending === '';

  // --- the final newline
  const endsWithNewline =
    text.length > 0 && (text.endsWith('\n') || text.endsWith('\r'));
  if (text.length > 0 && !endsWithNewline) {
    findings.push({
      rule: 'final-newline',
      line: realLines(text).length,
      detail: 'the file does not end with a newline',
    });
  }

  // --- trailing whitespace and tab indentation, line by line
  for (let i = 0; i < lines.length; i++) {
    if (hasMarker && i === lines.length - 1) continue;
    const line = lines[i].text;
    const trimmed = line.replace(/[ \t]+$/, '');
    if (trimmed !== line) {
      const tail = line.slice(trimmed.length);
      const word = tail === '\t' ? 'tab' : 'space';
      findings.push({
        rule: 'trailing-space',
        line: i + 1,
        detail:
          'line ' + (i + 1) + ' ends in ' + tail.length + ' trailing ' +
          word + (tail.length === 1 ? '' : 's'),
      });
    }
    const indent = splitIndent(line).indent;
    if (indent.indexOf('\t') !== -1) {
      findings.push({
        rule: 'tabs',
        line: i + 1,
        detail:
          'line ' + (i + 1) + ' is indented with a tab character' +
          (indent.indexOf(' ') !== -1 ? ', among other whitespace' : ''),
      });
    }
  }

  // --- the levelled copy
  //
  // The rules are applied in a fixed order, and each one is applied to
  // the result of the last. The order matters: the line endings are
  // normalised first, because everything else is defined in terms of
  // lines, and the byte order mark is already gone by now.
  let out = text;
  if (crlfLine !== 0 || crLine !== 0) {
    out = out.replace(/\r\n/g, '\n').replace(/\r(?!\n)/g, '\n');
  }
  out = out.replace(/[ \t]+$/gm, '');
  out = out.replace(/^[ \t]+/gm, (indent) => expandIndent(indent));
  if (out.length > 0 && !out.endsWith('\n')) {
    out += '\n';
  }

  // The levelled copy has no byte order mark: that is one of the
  // things levelling removes, so the copy is simply the text, encoded.
  const levelled = encodeUtf8(out);

  // A file that was already fine is not rewritten: the levelled copy
  // is byte-identical to the original.
  const changed = !sameBytes(buf, levelled);

  // --- the line by line difference
  //
  // Levelling never adds or removes a line: it only changes what is
  // inside one and terminates the last one. So the two lists of lines
  // are the same length and can be compared side by side.
  const before = realLines(text);
  const after = realLines(out);
  const diff = [];
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    const b = before[i] === undefined ? '' : before[i];
    const a = after[i] === undefined ? '' : after[i];
    diff.push({ line: i + 1, before: b, after: a, changed: b !== a });
  }

  return {
    ok: findings.length === 0,
    findings: findings,
    notes: notes,
    levelled: levelled,
    changed: changed,
    text: text,
    diff: diff,
    size: buf.length,
    levelledSize: levelled.length,
    hadBom: hasBom,
    hadFinalNewline: endsWithNewline,
  };
}

/* END engine (from tools/level/level.js) */

// ------------------------------------------------------------------- CLI

const fs = require('node:fs');
const path = require('node:path');

const NAME = 'level';
const COMMANDS = ['check', 'fix'];

function usage() {
  return [
    'level ' + LEVEL_VERSION + ' - check the shape of a text file.',
    '',
    'Usage:',
    '  node tools/level/level.js check <file>...         report what is wrong with the shape',
    '  node tools/level/level.js fix   <file>...         print the levelled copy on stdout',
    '  node tools/level/level.js fix   <file>... --write rewrite the file in place',
    '',
    'Options:',
    '  --write        rewrite the file (only with fix)',
    '  --diff         show the levelled copy line by line (only with check)',
    '  --json         machine-readable output',
    '  --quiet        print nothing; use the exit status',
    '  --help         this text',
    '  --version      the tool name and version',
    '',
    'A file named - is read from standard input.',
    '',
    'Exit status:',
    '  0  the file(s) are the shape they should be',
    '  1  something is wrong with the shape of at least one file',
    '  2  the command was used wrongly, or a file could not be read',
    '',
    'What level checks:',
    '  crlf           the file uses CRLF or bare CR line endings',
    '  bom            the file starts with a UTF-8 byte order mark',
    '  encoding       the file is not valid UTF-8',
    '  final-newline  the file does not end with a newline',
    '  trailing-space a line ends in spaces or tabs',
    '  tabs           a line is indented with a tab character',
    '',
    'What level does not do: it does not reformat your file unless you',
    'ask it to with "fix --write"; it does not guess what invalid bytes',
    'were meant to be; it has no opinion about line length, quote style,',
    'indentation width, naming, or anything else that is a matter of taste.',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = {
    _: [],
    json: false,
    write: false,
    diff: false,
    quiet: false,
    help: false,
    version: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { opts.json = true; continue; }
    if (a === '--write') { opts.write = true; continue; }
    if (a === '--diff') { opts.diff = true; continue; }
    if (a === '--quiet') { opts.quiet = true; continue; }
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    if (a === '--version' || a === '-v') { opts.version = true; continue; }
    if (a === '--') { opts._.push.apply(opts._, argv.slice(i + 1)); break; }
    if (a.startsWith('-') && a !== '-') {
      process.stderr.write('level: unknown option ' + a + '\n');
      process.stderr.write(usage() + '\n');
      process.exit(2);
    }
    opts._.push(a);
  }
  return opts;
}

function readInput(p) {
  if (p === '-') {
    return {
      name: '(standard input)',
      path: null,
      bytes: fs.readFileSync(0),
    };
  }
  const abs = path.resolve(p);
  const st = fs.statSync(abs);
  if (!st.isFile()) throw new Error(p + ' is not a regular file');
  return { name: p, path: abs, bytes: fs.readFileSync(abs) };
}

function ruleTitle(id) {
  for (const r of RULES) if (r.id === id) return r.title;
  return id;
}

function printFindings(res) {
  const L = [];
  for (const f of res.findings) {
    const where = f.line === null ? '-' : String(f.line);
    L.push(
      '  line ' + where.padStart(4) + '  ' + f.rule.padEnd(15) + f.detail
    );
  }
  return L.join('\n');
}

function printDiff(res) {
  const L = [];
  for (const d of res.diff || []) {
    if (!d.changed) continue;
    L.push('  line ' + d.line);
    L.push('  - ' + JSON.stringify(d.before));
    L.push('  + ' + JSON.stringify(d.after));
  }
  return L.join('\n');
}

function summarise(res) {
  const n = res.findings.length;
  if (n === 0) return 'no findings';
  const rules = [];
  for (const f of res.findings) if (!rules.includes(f.rule)) rules.push(f.rule);
  return (
    n + (n === 1 ? ' finding' : ' findings') + ' (' + rules.join(', ') + ')'
  );
}

function main(argv) {
  const opts = parseArgs(argv);

  if (opts.help) {
    process.stdout.write(usage() + '\n');
    return 0;
  }
  if (opts.version) {
    process.stdout.write(LEVEL_ID + '\n');
    return 0;
  }

  let cmd = 'check';
  const files = opts._.slice();
  if (files.length > 0 && COMMANDS.includes(files[0])) {
    cmd = files.shift();
  }

  if (files.length === 0) {
    // The contract asks for help on stdout and exit 0 when a tool is
    // run with no arguments at all.
    process.stdout.write(usage() + '\n');
    return 0;
  }

  if (cmd === 'fix' && opts.write === false && opts.json) {
    // Printing the levelled copy as JSON would be surprising; the
    // JSON mode is about reporting, not about content.
    process.stderr.write('level: --json with fix needs --write\n');
    return 2;
  }

  const results = [];
  let anyFinding = false;
  let anyFailure = false;

  for (const f of files) {
    let input;
    try {
      input = readInput(f);
    } catch (e) {
      if (e && e.code === 'ENOENT') {
        process.stderr.write('level: no such file: ' + f + '\n');
        process.stderr.write('level: known commands: ' + COMMANDS.join(', ') + '\n');
        return 2;
      }
      process.stderr.write(
        'level: ' + (e && e.message ? e.message : String(e)) + '\n'
      );
      return 2;
    }

    const res = check(input.bytes);
    res.name = input.name;
    res.path = input.path;
    results.push(res);
    if (!res.ok) anyFinding = true;

    if (cmd === 'fix') {
      if (res.levelled === null) {
        // The file is not valid UTF-8. Level will not guess what the
        // bytes were meant to be, so it leaves the file alone.
        anyFailure = true;
        if (!opts.quiet && !opts.json) {
          process.stderr.write(
            'level: ' + input.name + ': not valid UTF-8, so it was not rewritten (' +
              res.findings[0].detail + ')\n'
          );
        }
        continue;
      }
      if (!opts.write) {
        // The levelled copy goes to stdout and nothing else does, so
        // the command can be used in a pipeline.
        process.stdout.write(Buffer.from(res.levelled));
        continue;
      }
      if (input.path === null) {
        process.stderr.write('level: cannot rewrite standard input\n');
        return 2;
      }
      if (!res.changed) {
        if (!opts.quiet && !opts.json) {
          process.stdout.write('OK    ' + input.name + ' (already levelled)\n');
        }
        continue;
      }
      try {
        fs.writeFileSync(input.path, res.levelled);
      } catch (e) {
        process.stderr.write(
          'level: could not write ' + input.name + ': ' +
            (e && e.message ? e.message : String(e)) + '\n'
        );
        return 2;
      }
      if (!opts.quiet && !opts.json) {
        process.stdout.write('FIXED ' + input.name + '\n');
        process.stdout.write(printFindings(res) + '\n');
        process.stdout.write('  ' + summarise(res) + ', all fixed\n');
      }
      continue;
    }

    // check
    if (!opts.quiet && !opts.json) {
      process.stdout.write((res.ok ? 'OK    ' : 'FAIL  ') + input.name + '\n');
      if (!res.ok) {
        process.stdout.write(printFindings(res) + '\n');
        process.stdout.write('  ' + summarise(res) + '\n');
      }
      if (opts.diff && res.diff) {
        const d = printDiff(res);
        if (d) process.stdout.write(d + '\n');
      }
    }
  }

  if (opts.json) {
    const payload = {
      ok: !anyFinding && !anyFailure,
      files: results.map((r) => ({
        name: r.name,
        ok: r.ok,
        changed: r.changed,
        size: r.size,
        levelled_size: r.levelledSize,
        findings: r.findings.map((f) => ({
          rule: f.rule,
          title: ruleTitle(f.rule),
          line: f.line,
          detail: f.detail,
        })),
        notes: r.notes,
        diff: r.diff,
      })),
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  }

  if (anyFailure) return 1;
  if (anyFinding) return 1;
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  check: check,
  decodeUtf8: decodeUtf8,
  encodeUtf8: encodeUtf8,
  splitLines: splitLines,
  realLines: realLines,
  splitIndent: splitIndent,
  expandIndent: expandIndent,
  firstLineWithCrlf: firstLineWithCrlf,
  firstLineWithBareCr: firstLineWithBareCr,
  sameBytes: sameBytes,
  RULES: RULES,
  RULE_IDS: RULE_IDS,
  LEVEL_ID: LEVEL_ID,
  LEVEL_VERSION: LEVEL_VERSION,
  TAB_WIDTH: TAB_WIDTH,
};
