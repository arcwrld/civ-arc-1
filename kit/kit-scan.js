'use strict';
// kit-scan.js - tell code from literals.
//
// The Kit contract has two rules that must look at code rather than at
// text:
//
//   - no dependencies: the module specifier inside require(...) / from '...'
//   - no network: the calls fetch(), XMLHttpRequest, WebSocket, ...
//
// A plain text search gets both wrong, and the checker itself was the
// proof: searching raw text flagged the checker's own pattern table,
// because the text "fetch(" appears there as a pattern to look for. It
// also flags a test fixture holding "require('chalk')" inside a string,
// where no import happens at all.
//
// So this file marks every byte of a source file as CODE or LITERAL,
// handling line comments, block comments, single- and double-quoted
// strings, template literals (including ${...} holes, which really are
// code), and regular expression literals.
//
// A regular expression literal is told from a division by looking at the
// previous significant token: after an operand a slash divides, after an
// operator or an opening bracket it starts a regular expression.
//
// Zero dependencies: Node built-ins only.

const CODE = 1;
const LITERAL = 0;

// Characters after which a slash begins a regular expression, not a division.
const PREV_REGEX = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*',
  '%', '~', '^', '<', '>', '\n',
]);

// Keywords after which a slash begins a regular expression.
const PREV_KEYWORD = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'do', 'else', 'yield', 'await', 'case',
]);

// scan(text) -> { isCode: Uint8Array, length }
// isCode[i] is 1 when byte i is executable code, 0 when it sits inside a
// comment, a string, a template literal or a regular expression.
function scan(text) {
  const n = text.length;
  const isCode = new Uint8Array(n);
  let i = 0;

  const mark = (from, to, value) => {
    for (let k = from; k < to && k < n; k++) isCode[k] = value;
  };

  // The last significant (non-whitespace, non-comment) character seen.
  const lastSignificant = (limit) => {
    for (let k = limit - 1; k >= 0; k--) {
      if (isCode[k] === CODE) return text[k];
    }
    return '';
  };

  // The last significant word seen, for keyword detection.
  const lastWord = (limit) => {
    let k = limit - 1;
    while (k >= 0 && /\s/.test(text[k])) k--;
    const end = k;
    while (k >= 0 && /[A-Za-z0-9_$]/.test(text[k])) k--;
    return text.slice(k + 1, end + 1);
  };

  while (i < n) {
    const c = text[i];

    // ---- line comment
    if (c === '/' && text[i + 1] === '/') {
      let j = i + 2;
      while (j < n && text[j] !== '\n') j++;
      mark(i, j, LITERAL);
      i = j;
      continue;
    }

    // ---- block comment
    if (c === '/' && text[i + 1] === '*') {
      let j = i + 2;
      while (j < n && !(text[j] === '*' && text[j + 1] === '/')) j++;
      j = Math.min(n, j + 2);
      mark(i, j, LITERAL);
      i = j;
      continue;
    }

    // ---- quoted string. A JavaScript string cannot span a newline, so an
    // apostrophe in a comment ends the string at the line break.
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === c) { j++; break; }
        if (text[j] === '\n') break;
        j++;
      }
      mark(i, j, LITERAL);
      i = j;
      continue;
    }

    // ---- template literal
    if (c === '`') {
      let j = i + 1;
      mark(i, j, LITERAL);
      while (j < n) {
        if (text[j] === '\\') { mark(j, j + 2, LITERAL); j += 2; continue; }
        if (text[j] === '`') { mark(j, j + 1, LITERAL); j++; break; }
        if (text[j] === '$' && text[j + 1] === '{') {
          mark(j, j + 2, LITERAL);
          j += 2;
          const holeStart = j;
          let depth = 1;
          while (j < n && depth > 0) {
            const d = text[j];
            if (d === '{') { depth++; j++; continue; }
            if (d === '}') { depth--; j++; continue; }
            if (d === '"' || d === "'" || d === '`') {
              const q = d;
              let k = j + 1;
              while (k < n) {
                if (text[k] === '\\') { k += 2; continue; }
                if (text[k] === q) { k++; break; }
                if (text[k] === '\n') break;
                k++;
              }
              mark(j, k, LITERAL);
              j = k;
              continue;
            }
            if (d === '/' && text[j + 1] === '/') {
              let k = j + 2;
              while (k < n && text[k] !== '\n') k++;
              mark(j, k, LITERAL);
              j = k;
              continue;
            }
            if (d === '/' && text[j + 1] === '*') {
              let k = j + 2;
              while (k < n && !(text[k] === '*' && text[k + 1] === '/')) k++;
              k = Math.min(n, k + 2);
              mark(j, k, LITERAL);
              j = k;
              continue;
            }
            j++;
          }
          mark(holeStart, j, CODE);
          continue;
        }
        mark(j, j + 1, LITERAL);
        j++;
      }
      i = j;
      continue;
    }

    // ---- regular expression literal, or division
    if (c === '/') {
      const prev = lastSignificant(i);
      const word = lastWord(i);
      const startsRegex =
        prev === '' || PREV_REGEX.has(prev) || PREV_KEYWORD.has(word);
      if (startsRegex) {
        let j = i + 1;
        let inClass = false;
        while (j < n) {
          if (text[j] === '\\') { j += 2; continue; }
          if (text[j] === '[') inClass = true;
          else if (text[j] === ']') inClass = false;
          else if (text[j] === '/' && !inClass) { j++; break; }
          else if (text[j] === '\n') break;
          j++;
        }
        while (j < n && /[A-Za-z]/.test(text[j])) j++;
        mark(i, j, LITERAL);
        i = j;
        continue;
      }
      mark(i, i + 1, CODE);
      i++;
      continue;
    }

    mark(i, i + 1, CODE);
    i++;
  }

  // The flags array is the return value. It also carries .isCode pointing
  // at itself, so a caller written against the older {isCode, length}
  // shape keeps working without change.
  isCode.isCode = isCode;
  return isCode;
}

// The flags of a scan, whichever shape the caller is holding. A scan
// returns the flags array itself; an older caller may still be holding
// {isCode, length}.
function flagsOf(map) {
  if (!map) return null;
  if (map.isCode) return map.isCode;
  return map;
}

function isCodeAt(map, i) {
  const flags = flagsOf(map);
  if (!flags || i < 0 || i >= flags.length) return false;
  return flags[i] === CODE;
}

// codeText(text, map) -> the source with every literal byte blanked out.
// The result has the same length and the same offsets as the source, so a
// pattern written against the code text still points at the right place.
function codeText(text, map) {
  const flags = flagsOf(map);
  const out = new Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = flags && flags[i] === CODE ? text[i] : ' ';
  }
  return out.join('');
}

// Every occurrence of a whole word that sits in executable code.
function codeMatches(text, map, needle) {
  const out = [];
  let from = 0;
  for (;;) {
    const idx = text.indexOf(needle, from);
    if (idx === -1) break;
    from = idx + needle.length;
    if (!isCodeAt(map, idx)) continue;
    const before = idx > 0 ? text[idx - 1] : '';
    const after = text[idx + needle.length] || '';
    if (before && /[A-Za-z0-9_$]/.test(before)) continue;
    if (after && /[A-Za-z0-9_$]/.test(after)) continue;
    out.push({ index: idx, text: needle });
  }
  return out;
}

// Reads a quoted string literal starting at index j. Returns
// { value, end } or null when there is no string there.
function readStringLiteral(text, j) {
  const q = text[j];
  if (q !== '"' && q !== "'") return null;
  let k = j + 1;
  let value = '';
  while (k < text.length) {
    if (text[k] === '\\') { value += text[k + 1]; k += 2; continue; }
    if (text[k] === q) { k++; break; }
    if (text[k] === '\n') return null;
    value += text[k];
    k++;
  }
  return { value, end: k };
}

// Calls of the form name( that sit in executable code. When the first
// argument is a string literal, its value is returned as spec.
function codeCalls(text, map, name) {
  const out = [];
  let from = 0;
  for (;;) {
    const idx = text.indexOf(name, from);
    if (idx === -1) break;
    from = idx + name.length;
    if (!isCodeAt(map, idx)) continue;
    const before = idx > 0 ? text[idx - 1] : '';
    if (before && /[A-Za-z0-9_$.]/.test(before)) continue;
    let j = idx + name.length;
    while (j < text.length && /\s/.test(text[j])) j++;
    if (text[j] !== '(') continue;
    j++;
    while (j < text.length && /\s/.test(text[j])) j++;
    const lit = readStringLiteral(text, j);
    out.push({ index: idx, name, spec: lit ? lit.value : null });
  }
  return out;
}

// Every module specifier the source imports, with where it came from.
// Catches: require('x'), import x from 'x', import 'x', import('x'),
// and export ... from 'x'.
function codeImportSpecifiers(text, map) {
  const out = [];

  for (const c of codeCalls(text, map, 'require')) {
    out.push({ index: c.index, kind: 'require', spec: c.spec });
  }

  for (const m of codeMatches(text, map, 'import')) {
    const before = m.index > 0 ? text[m.index - 1] : '';
    if (before === '.') continue;
    let j = m.index + 'import'.length;
    while (j < text.length && /\s/.test(text[j])) j++;
    if (text[j] === '(') {
      j++;
      while (j < text.length && /\s/.test(text[j])) j++;
      const lit = readStringLiteral(text, j);
      if (lit) out.push({ index: m.index, kind: 'import()', spec: lit.value });
      continue;
    }
    if (text[j] === '"' || text[j] === "'") {
      const lit = readStringLiteral(text, j);
      if (lit) out.push({ index: m.index, kind: 'import', spec: lit.value });
    }
    // import x from 'y' is caught by the "from" rule below.
  }

  for (const m of codeMatches(text, map, 'from')) {
    const before = m.index > 0 ? text[m.index - 1] : '';
    if (before === '.') continue;
    let j = m.index + 'from'.length;
    while (j < text.length && /\s/.test(text[j])) j++;
    const lit = readStringLiteral(text, j);
    if (lit) out.push({ index: m.index, kind: 'from', spec: lit.value });
  }

  return out;
}

// The JavaScript inside an HTML file: the bodies of inline <script> blocks
// and the bodies of inline event handler attributes. An external <script>
// is skipped here; the one-file rule is what judges it.
function htmlScripts(html) {
  const out = [];
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = scriptRe.exec(html)) !== null) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    // An HTML comment inside a script is still a comment. A commented
    // out import is not an import.
    out.push(m[2].replace(/<!--[\s\S]*?-->/g, ''));
  }
  const handlerRe = /\bon[a-z]+\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  while ((m = handlerRe.exec(html)) !== null) {
    out.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return out;
}

module.exports = {
  scan,
  flagsOf,
  isCodeAt,
  codeText,
  codeMatches,
  codeCalls,
  codeImportSpecifiers,
  readStringLiteral,
  htmlScripts,
  CODE,
  LITERAL,
};
