#!/usr/bin/env node
'use strict';
/* Hewn - a data profiler. See README.md for what it does and does not do.
 *
 * This file is the command line tool. The engine that does the thinking
 * lives between the two marker comments below, and a byte-identical copy
 * of it lives in hewn.html, so the page and this tool cannot drift apart.
 * If they ever do, hewn.test.js fails and tells you to run:
 *
 *     node tools/hewn/hewn.js --sync-html
 */

var fs = require('node:fs');
var path = require('node:path');

/* hewn-engine:begin */
/* Hewn core - a data profiler.
 *
 * Zero dependencies. No DOM, no filesystem, no network. The same module
 * runs under Node (CommonJS) and in a browser (globalThis.Hewn), so the
 * one-file HTML face and the CLI share exactly one implementation.
 *
 * Hewn does not modify data. It reads a table and reports what it finds:
 * the ways a spreadsheet is lying to the person who trusts it.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Hewn = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Rules
   * ------------------------------------------------------------------ */

  var RULES = [
    { id: 'HEWN001', name: 'mixed-type',      severity: 'error', title: 'Column holds both numbers and text' },
    { id: 'HEWN002', name: 'missing-sentinel', severity: 'warn',  title: 'Placeholder strings stand in for missing data' },
    { id: 'HEWN003', name: 'mixed-date-format', severity: 'warn', title: 'One date column, several date layouts' },
    { id: 'HEWN004', name: 'casing-drift',    severity: 'warn',  title: 'One category spelled several ways' },
    { id: 'HEWN005', name: 'edge-whitespace', severity: 'warn',  title: 'Values carry leading or trailing spaces' },
    { id: 'HEWN006', name: 'constant-column', severity: 'warn',  title: 'Column has a single value' },
    { id: 'HEWN007', name: 'duplicate-header', severity: 'error', title: 'Two columns share a name' },
    { id: 'HEWN008', name: 'ragged-row',      severity: 'error', title: 'Row has the wrong number of fields' },
    { id: 'HEWN009', name: 'decimal-conflict', severity: 'error', title: 'Two decimal conventions in one column' },
    { id: 'HEWN010', name: 'empty-column',    severity: 'warn',  title: 'Column has no values at all' },
    { id: 'HEWN011', name: 'duplicate-rows',  severity: 'warn',  title: 'Identical rows repeat' },
    { id: 'HEWN012', name: 'zero-dominated',  severity: 'info',  title: 'Zeros dominate a numeric column' },
    { id: 'HEWN013', name: 'hidden-thousands', severity: 'error', title: 'A thousands separator reads as a decimal point' }
  ];

  var RULE_BY_ID = {};
  RULES.forEach(function (r) { RULE_BY_ID[r.id] = r; });

  var SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };

  /* Conservative list: tokens that are almost always "no value" rather
   * than a value. Deliberately short - a false positive here costs the
   * reader more than a missed one. '0' and 'none' are NOT in the list. */
  var SENTINELS = [
    '', 'na', 'n/a', 'n.a.', 'null', 'nil', 'nan', '-', '--', '---',
    '?', '??', 'undefined', 'missing', '9999', '-9999', '999', '0000',
    '#n/a', '#na'
  ];
  var SENTINEL_SET = new Set(SENTINELS);

  var BOOL_WORDS = new Set(['true', 'false', 'yes', 'no', 'y', 'n', 't', 'f']);

  var MONTHS = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
    nov: 11, november: 11, dec: 12, december: 12
  };

  /* ------------------------------------------------------------------ *
   * Value classification
   * ------------------------------------------------------------------ */

  var PLAIN_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
  var US_THOUSANDS_RE = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/;
  var EU_DECIMAL_RE = /^[+-]?(\d{1,3}(\.\d{3})+|\d+),\d{1,2}$/;
  var EU_THOUSANDS_RE = /^[+-]?\d{1,3}(\.\d{3})+$/;

  function parseNumber(v) {
    if (PLAIN_RE.test(v)) return { style: 'plain', value: Number(v) };
    if (US_THOUSANDS_RE.test(v)) return { style: 'us', value: Number(v.replace(/,/g, '')) };
    if (EU_DECIMAL_RE.test(v)) {
      return { style: 'eu', value: Number(v.replace(/\./g, '').replace(',', '.')) };
    }
    if (EU_THOUSANDS_RE.test(v)) return { style: 'eu-thousands', value: Number(v.replace(/\./g, '')) };
    return null;
  }

  function sepName(ch) {
    if (ch === '/') return 'slash';
    if (ch === '-') return 'dash';
    if (ch === '.') return 'dot';
    return 'sep';
  }

  function detectDate(v) {
    var m;

    m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
    if (m) {
      return { format: 'iso', order: 'ymd', value: Date.UTC(+m[1], +m[2] - 1, +m[3]) };
    }

    m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(v);
    if (m) return { format: 'ymd-slash', order: 'ymd', value: Date.UTC(+m[1], +m[2] - 1, +m[3]) };

    m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/.exec(v);
    if (m) return { format: 'ymd-dot', order: 'ymd', value: Date.UTC(+m[1], +m[2] - 1, +m[3]) };

    m = /^(\d{1,2})([\/\-.])(\d{1,2})\2(\d{2,4})$/.exec(v);
    if (m) {
      var a = +m[1], b = +m[3], y = +m[4];
      if (y < 100) y += (y < 70 ? 2000 : 1900);
      var order = null;
      var ambiguous = false;
      if (a > 12 && b <= 12) order = 'dmy';
      else if (b > 12 && a <= 12) order = 'mdy';
      else ambiguous = true;
      var mm = order === 'mdy' ? a : b;
      var dd = order === 'mdy' ? b : a;
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        return {
          format: (order ? order : 'ambiguous') + '-' + sepName(m[2]),
          order: order,
          ambiguous: ambiguous,
          value: Date.UTC(y, mm - 1, dd)
        };
      }
      return null;
    }

    m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(v);
    if (m) {
      var mo1 = MONTHS[m[1].toLowerCase()];
      if (mo1) return { format: 'mdy-name', order: 'mdy', value: Date.UTC(+m[3], mo1 - 1, +m[2]) };
    }

    m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(v);
    if (m) {
      var mo2 = MONTHS[m[2].toLowerCase()];
      if (mo2) return { format: 'dmy-name', order: 'dmy', value: Date.UTC(+m[3], mo2 - 1, +m[1]) };
    }

    return null;
  }

  function isSentinel(raw) {
    return SENTINEL_SET.has(String(raw).trim().toLowerCase());
  }

  /* kind is one of: empty | missing | number | date | boolean | text */
  function classify(raw) {
    var v = String(raw).trim();
    if (v === '') return { kind: 'empty' };
    if (isSentinel(v)) return { kind: 'missing' };
    var n = parseNumber(v);
    if (n) return { kind: 'number', style: n.style, value: n.value };
    var d = detectDate(v);
    if (d) return { kind: 'date', dateFormat: d.format, order: d.order, ambiguous: d.ambiguous, value: d.value };
    if (BOOL_WORDS.has(v.toLowerCase())) return { kind: 'boolean' };
    return { kind: 'text' };
  }

  /* ------------------------------------------------------------------ *
   * Parsing
   * ------------------------------------------------------------------ */

  function countOutsideQuotes(line, delim) {
    var n = 0, inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (!inQ && ch === delim) n++;
    }
    return n;
  }

  function detectDelimiter(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; }).slice(0, 25);
    var candidates = [',', '\t', ';', '|'];
    var best = ',', bestScore = 0;
    for (var i = 0; i < candidates.length; i++) {
      var d = candidates[i];
      var tally = new Map();
      lines.forEach(function (l) {
        var c = countOutsideQuotes(l, d);
        tally.set(c, (tally.get(c) || 0) + 1);
      });
      var modal = 0, modalN = 0;
      tally.forEach(function (cnt, fields) {
        if (fields > 1 && cnt > modalN) { modalN = cnt; modal = fields; }
      });
      if (modal > 0 && modal * modalN > bestScore) {
        bestScore = modal * modalN;
        best = d;
      }
    }
    return best;
  }

  function parseDelimited(text, delim) {
    var rows = [];
    var row = [];
    var field = '';
    var i = 0;
    var inQuotes = false;
    var n = text.length;

    while (i < n) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"' && field === '') { inQuotes = true; i++; continue; }
      if (ch === delim) { row.push(field); field = ''; i++; continue; }
      if (ch === '\r') {
        if (text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = ''; i++; continue;
      }
      if (ch === '\n') {
        row.push(field); rows.push(row); row = []; field = ''; i++; continue;
      }
      field += ch; i++;
    }
    if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

    while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0].trim() === '') {
      rows.pop();
    }
    return rows;
  }

  function sniffFormat(text) {
    var t = text.trim();
    if (t === '') return 'delimited';
    if (t[0] === '[') return 'json';
    var lines = t.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
    if (lines.length === 0) return 'delimited';
    var jsonish = lines.every(function (l) {
      var s = l.trim();
      return s[0] === '{' && s[s.length - 1] === '}';
    });
    return jsonish ? 'jsonl' : 'delimited';
  }

  function stringifyValue(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return JSON.stringify(v);
  }

  function tableFromObjects(objects) {
    var headers = [];
    var seen = new Set();
    objects.forEach(function (o) {
      Object.keys(o).forEach(function (k) {
        if (!seen.has(k)) { seen.add(k); headers.push(k); }
      });
    });
    var rows = objects.map(function (o) {
      return headers.map(function (h) {
        return Object.prototype.hasOwnProperty.call(o, h) ? stringifyValue(o[h]) : '';
      });
    });
    return { format: 'json', delimiter: ',', headers: headers, rows: rows };
  }

  function parseJsonl(text) {
    var objects = [];
    var bad = [];
    text.split(/\r?\n/).forEach(function (line, idx) {
      var s = line.trim();
      if (s === '') return;
      var obj;
      try { obj = JSON.parse(s); } catch (e) { bad.push(idx + 1); return; }
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        objects.push(obj);
      } else {
        bad.push(idx + 1);
      }
    });
    var t = tableFromObjects(objects);
    t.format = 'jsonl';
    t.badLines = bad;
    return t;
  }

  function parseJsonArray(text) {
    var arr;
    try { arr = JSON.parse(text); } catch (e) { arr = null; }
    if (!Array.isArray(arr)) {
      var t = { format: 'json', delimiter: ',', headers: [], rows: [], badLines: [], error: 'not a JSON array' };
      return t;
    }
    var objects = arr.filter(function (x) { return x && typeof x === 'object' && !Array.isArray(x); });
    var t = tableFromObjects(objects);
    t.format = 'json';
    t.badLines = [];
    return t;
  }

  /* parse(text, opts) -> table
   * opts: { format: 'auto'|'csv'|'tsv'|'jsonl'|'json', delimiter: char|'auto' } */
  function parse(text, opts) {
    opts = opts || {};
    if (typeof text !== 'string') text = '';
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    var format = String(opts.format || 'auto').toLowerCase();
    if (format === 'auto') format = sniffFormat(text);

    if (format === 'jsonl') return parseJsonl(text);
    if (format === 'json') return parseJsonArray(text);

    var delim = opts.delimiter && opts.delimiter !== 'auto' ? opts.delimiter : detectDelimiter(text);
    if (format === 'tsv') delim = '\t';
    if (format === 'csv') delim = ',';

    var rows = parseDelimited(text, delim);
    if (rows.length === 0) {
      return { format: 'delimited', delimiter: delim, headers: [], rows: [] };
    }
    var headers = rows.shift();
    return { format: 'delimited', delimiter: delim, headers: headers, rows: rows };
  }

  /* ------------------------------------------------------------------ *
   * Profiling
   * ------------------------------------------------------------------ */

  function mkIssue(ruleId, fields) {
    var rule = RULE_BY_ID[ruleId];
    var issue = {
      id: ruleId,
      name: rule.name,
      severity: rule.severity,
      title: rule.title,
      column: null,
      columnIndex: null,
      count: 0,
      detail: '',
      evidence: [],
      fix: null
    };
    Object.keys(fields).forEach(function (k) { issue[k] = fields[k]; });
    return issue;
  }

  function median(sorted) {
    if (!sorted.length) return null;
    var mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function quantile(sorted, q) {
    if (!sorted.length) return null;
    var pos = (sorted.length - 1) * q;
    var base = Math.floor(pos);
    var rest = pos - base;
    if (sorted[base + 1] !== undefined) {
      return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    }
    return sorted[base];
  }

  function example(v, max) {
    var s = String(v);
    if (s.length > max) s = s.slice(0, max - 1) + '…';
    return s;
  }

  function profile(table, opts) {
    opts = opts || {};
    var maxDistinct = opts.maxDistinct || 200;
    var maxEvidence = opts.maxEvidence || 5;

    var headers = (table && table.headers) || [];
    var rows = (table && table.rows) || [];
    var nCols = headers.length;
    var nRows = rows.length;

    var issues = [];
    var columns = [];

    /* --- table level --------------------------------------------- */

    var causeDelim = table.delimiter || ',';
    var ragged = [];
    for (var r = 0; r < nRows; r++) {
      if (rows[r].length !== nCols) {
        var entry = { row: r + 1, expected: nCols, actual: rows[r].length };
        if (rows[r].length === nCols + 1) {
          var merged = String(rows[r][rows[r].length - 2]) + causeDelim + String(rows[r][rows[r].length - 1]);
          var mp = parseNumber(merged);
          if (mp && (mp.style === 'eu' || mp.style === 'eu-thousands')) {
            entry.likelyCause = 'the last two fields read as one number (' + merged + ') split by the delimiter';
          }
        }
        ragged.push(entry);
      }
    }
    if (ragged.length) {
      var causes = ragged.filter(function (x) { return x.likelyCause; });
      var ragDetail = ragged.length + ' of ' + nRows + ' rows do not have ' + nCols + ' fields.';
      if (causes.length) {
        ragDetail += ' ' + causes.length + ' of them look like a single value split in two by the delimiter - a decimal comma in a comma-delimited file, for example. Quote the value to keep it in one field.';
      }
      issues.push(mkIssue('HEWN008', {
        column: null,
        count: ragged.length,
        detail: ragDetail,
        evidence: ragged.slice(0, maxEvidence).map(function (x) {
          return 'row ' + x.row + ': ' + x.actual + ' fields, expected ' + x.expected +
                 (x.likelyCause ? ' (' + x.likelyCause + ')' : '');
        })
      }));
    }

    /* duplicate headers */
    var byName = new Map();
    headers.forEach(function (h, i) {
      var key = String(h).trim();
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(i);
    });
    var dupHeaders = [];
    byName.forEach(function (idxs, name) {
      if (idxs.length > 1) dupHeaders.push({ name: name, indexes: idxs });
    });
    dupHeaders.forEach(function (d) {
      issues.push(mkIssue('HEWN007', {
        column: d.name,
        columnIndex: d.indexes[1],
        count: d.indexes.length,
        detail: 'Columns ' + d.indexes.map(function (i) { return i + 1; }).join(', ') +
                ' are all named "' + d.name + '". A reader cannot tell them apart, and a parser may keep only one.',
        evidence: d.indexes.slice(0, maxEvidence).map(function (i) { return 'column ' + (i + 1); })
      }));
    });

    /* duplicate rows */
    var rowGroups = new Map();
    for (var rr = 0; rr < nRows; rr++) {
      var key = rows[rr].map(function (v) { return String(v); }).join(' ');
      if (!rowGroups.has(key)) rowGroups.set(key, []);
      rowGroups.get(key).push(rr + 1);
    }
    var dupGroups = [];
    rowGroups.forEach(function (rowNums, k) {
      if (rowNums.length > 1) dupGroups.push({ rows: rowNums, key: k });
    });
    if (dupGroups.length) {
      var extraRows = dupGroups.reduce(function (s, g) { return s + (g.rows.length - 1); }, 0);
      issues.push(mkIssue('HEWN011', {
        count: extraRows,
        detail: extraRows + ' repeated row' + (extraRows === 1 ? '' : 's') + ' across ' +
                dupGroups.length + ' duplicate group' + (dupGroups.length === 1 ? '' : 's') + '.',
        evidence: dupGroups.slice(0, maxEvidence).map(function (g) {
          var cells = g.key.split(' ');
          return 'rows ' + g.rows.join(', ') + ' are all: ' +
            example(cells.map(function (c) { return '"' + example(c, 30) + '"'; }).join(', '), 120);
        })
      }));
    }

    /* --- per column ---------------------------------------------- */

    for (var c = 0; c < nCols; c++) {
      var name = String(headers[c]);
      var raw = [];
      for (var i = 0; i < nRows; i++) {
        raw.push(c < rows[i].length ? String(rows[i][c]) : '');
      }
      var classes = raw.map(classify);

      var kinds = new Map();
      var kindOrder = ['empty', 'missing', 'number', 'date', 'boolean', 'text'];
      classes.forEach(function (k) {
        kinds.set(k.kind, (kinds.get(k.kind) || 0) + 1);
      });

      var present = kindOrder.filter(function (k) { return kinds.get(k); });
      var dataKinds = present.filter(function (k) { return k !== 'empty' && k !== 'missing'; });

      var type;
      if (dataKinds.length === 0) type = 'empty';
      else if (dataKinds.length === 1) type = dataKinds[0];
      else type = 'mixed';

      var nonEmpty = raw.filter(function (v) { return v.trim() !== ''; });
      var missingCount = kinds.get('missing') || 0;
      var emptyCount = kinds.get('empty') || 0;

      /* distinct values (trimmed, non-empty) */
      var counts = new Map();
      raw.forEach(function (v) {
        var t = v.trim();
        if (t === '') return;
        counts.set(t, (counts.get(t) || 0) + 1);
      });
      var distinct = counts.size;
      var distinctSamples = [];
      var it = counts.entries();
      for (var e = it.next(); !e.done && distinctSamples.length < maxDistinct; e = it.next()) {
        distinctSamples.push({ value: e.value[0], count: e.value[1] });
      }
      distinctSamples.sort(function (a, b) { return b.count - a.count || a.value.localeCompare(b.value); });

      var col = {
        index: c,
        name: name,
        type: type,
        kinds: kinds,
        total: nRows,
        nonEmpty: nonEmpty.length,
        empty: emptyCount,
        missing: missingCount,
        distinct: distinct,
        distinctSamples: distinctSamples,
        stats: null
      };

      /* numeric stats */
      var nums = [];
      classes.forEach(function (k, idx) {
        if (k.kind === 'number') nums.push({ v: k.value, raw: raw[idx], style: k.style });
      });
      if (nums.length) {
        var sorted = nums.map(function (x) { return x.v; }).sort(function (a, b) { return a - b; });
        var sum = nums.reduce(function (s, x) { return s + x.v; }, 0);
        col.stats = {
          kind: 'number',
          count: nums.length,
          min: sorted[0],
          max: sorted[sorted.length - 1],
          mean: sum / nums.length,
          median: median(sorted),
          p25: quantile(sorted, 0.25),
          p75: quantile(sorted, 0.75),
          zeros: nums.filter(function (x) { return x.v === 0; }).length
        };
      } else {
        var dates = [];
        classes.forEach(function (k, idx) {
          if (k.kind === 'date') dates.push({ v: k.value, raw: raw[idx], format: k.dateFormat, order: k.order });
        });
        if (dates.length) {
          var dsorted = dates.map(function (x) { return x.v; }).sort(function (a, b) { return a - b; });
          col.stats = {
            kind: 'date',
            count: dates.length,
            min: new Date(dsorted[0]).toISOString().slice(0, 10),
            max: new Date(dsorted[dsorted.length - 1]).toISOString().slice(0, 10),
            formats: Array.from(new Set(dates.map(function (x) { return x.format; }))).sort()
          };
        }
      }

      columns.push(col);

      /* --- rules that live on a column --------------------------- */

      /* HEWN001 mixed type */
      if (type === 'mixed' && (kinds.get('number') || 0) > 0) {
        var minority = dataKinds.filter(function (k) { return k !== 'number'; });
        var minorCount = 0;
        minority.forEach(function (k) { minorCount += kinds.get(k); });
        var minorExamples = [];
        classes.forEach(function (k, idx) {
          if (k.kind !== 'number' && raw[idx].trim() !== '' && minorExamples.length < maxEvidence) {
            minorExamples.push('"' + example(raw[idx].trim(), 30) + '"');
          }
        });
        issues.push(mkIssue('HEWN001', {
          column: name,
          columnIndex: c,
          count: minorCount,
          detail: minorCount + ' of ' + (nums.length + minorCount) + ' values in "' + name +
                  '" are not numbers. A spreadsheet will read this column as text, and the numbers in it will be unusable for arithmetic.',
          evidence: minorExamples
        }));
      }

      /* HEWN002 missing sentinels */
      if (missingCount > 0) {
        var tokenCounts = new Map();
        raw.forEach(function (v) {
          var t = v.trim();
          if (t === '' || !isSentinel(t)) return;
          tokenCounts.set(t, (tokenCounts.get(t) || 0) + 1);
        });
        var tokens = Array.from(tokenCounts.entries()).sort(function (a, b) { return b[1] - a[1]; });
        issues.push(mkIssue('HEWN002', {
          column: name,
          columnIndex: c,
          count: missingCount,
          detail: missingCount + ' value' + (missingCount === 1 ? '' : 's') + ' in "' + name +
                  '" are placeholders rather than data. Counts taken as numeric will treat them as text or as zero.',
          evidence: tokens.slice(0, maxEvidence).map(function (t) {
            return '"' + t[0] + '" × ' + t[1];
          }),
          fix: { kind: 'sentinel', column: c, replacement: '' }
        }));
      }

      /* HEWN003 mixed date formats */
      if (col.stats && col.stats.kind === 'date') {
        var fmtCounts = new Map();
        classes.forEach(function (k) {
          if (k.kind === 'date') fmtCounts.set(k.dateFormat, (fmtCounts.get(k.dateFormat) || 0) + 1);
        });
        var orders = new Set();
        var ambiguousCount = 0;
        classes.forEach(function (k) {
          if (k.kind !== 'date') return;
          if (k.order) orders.add(k.order);
          if (k.ambiguous) ambiguousCount++;
        });
        var formats = Array.from(fmtCounts.keys());
        var orderConflict = orders.has('dmy') && orders.has('mdy');
        var ambiguityConflict = orders.size > 0 && ambiguousCount > 0;
        if (formats.length > 1 || orderConflict || ambiguityConflict) {
          var ex = [];
          classes.forEach(function (k, idx) {
            if (k.kind === 'date' && ex.length < maxEvidence) {
              ex.push('"' + example(raw[idx].trim(), 24) + '" (' + k.dateFormat + ')');
            }
          });
          var notes = [];
          if (orderConflict) notes.push('it mixes day-first with month-first');
          if (ambiguityConflict) {
            notes.push(ambiguousCount + ' of its dates could be read as either day or month');
          }
          issues.push(mkIssue('HEWN003', {
            column: name,
            columnIndex: c,
            count: col.stats.count,
            detail: '"' + name + '" holds ' + formats.length + ' different date layouts' +
                    (notes.length ? ' - ' + notes.join(' and ') : '') +
                    '. A reader cannot tell which convention each row uses.',
            evidence: ex
          }));
        }
      }

      /* HEWN004 casing drift */
      if (type === 'text' || type === 'boolean') {
        var caseGroups = new Map();
        raw.forEach(function (v) {
          var t = v.trim();
          if (t === '' || isSentinel(t)) return;
          var k = t.toLowerCase();
          if (!caseGroups.has(k)) caseGroups.set(k, new Map());
          var inner = caseGroups.get(k);
          inner.set(t, (inner.get(t) || 0) + 1);
        });
        var drift = [];
        caseGroups.forEach(function (variants, key) {
          if (variants.size > 1) drift.push({ key: key, variants: variants });
        });
        drift.forEach(function (d) {
          var list = Array.from(d.variants.entries()).sort(function (a, b) { return b[1] - a[1]; });
          issues.push(mkIssue('HEWN004', {
            column: name,
            columnIndex: c,
            count: list.reduce(function (s, x) { return s + x[1]; }, 0),
            detail: '"' + name + '" spells the same value ' + list.length + ' ways: ' +
                    list.map(function (x) { return x[0]; }).join(', ') +
                    '. A group-by on this column will produce ' + list.length + ' groups where there is one.',
            evidence: list.slice(0, maxEvidence).map(function (x) { return '"' + x[0] + '" × ' + x[1]; }),
            fix: { kind: 'case', column: c, target: list[0][0] }
          }));
        });
      }

      /* HEWN005 edge whitespace */
      var wsCount = 0;
      var wsExamples = [];
      raw.forEach(function (v) {
        if (v !== v.trim() && v.trim() !== '') {
          wsCount++;
          if (wsExamples.length < maxEvidence) wsExamples.push('"' + example(v, 30) + '"');
        }
      });
      if (wsCount) {
        issues.push(mkIssue('HEWN005', {
          column: name,
          columnIndex: c,
          count: wsCount,
          detail: wsCount + ' value' + (wsCount === 1 ? '' : 's') + ' in "' + name +
                  '" have leading or trailing spaces. Two values that look identical will not match each other.',
          evidence: wsExamples,
          fix: { kind: 'trim', column: c }
        }));
      }

      /* HEWN006 constant column */
      if (nRows >= 2 && distinct === 1 && nonEmpty.length >= 1) {
        var only = distinctSamples[0];
        issues.push(mkIssue('HEWN006', {
          column: name,
          columnIndex: c,
          count: nonEmpty.length,
          detail: 'Every value in "' + name + '" is "' + example(only.value, 30) + '". The column carries no information.',
          evidence: ['"' + example(only.value, 40) + '" × ' + only.count]
        }));
      }

      /* HEWN009 decimal conflict */
      if (col.stats && col.stats.kind === 'number') {
        var styles = new Set(nums.map(function (x) { return x.style; }));
        var hasEU = styles.has('eu') || styles.has('eu-thousands');
        var hasDOT = styles.has('plain') || styles.has('us');
        if (hasEU && hasDOT) {
          var euEx = [], dotEx = [];
          nums.forEach(function (x) {
            if ((x.style === 'eu' || x.style === 'eu-thousands') && euEx.length < 3) euEx.push('"' + x.raw + '"');
            else if ((x.style === 'plain' || x.style === 'us') && dotEx.length < 3) dotEx.push('"' + x.raw + '"');
          });
          issues.push(mkIssue('HEWN009', {
            column: name,
            columnIndex: c,
            count: euEx.length + dotEx.length,
            detail: '"' + name + '" mixes decimal conventions: some values use "," as the decimal mark and some use ".". Read as plain numbers they are wrong by orders of magnitude.',
            evidence: ['comma decimal: ' + euEx.join(', '), 'dot decimal: ' + dotEx.join(', ')],
            fix: { kind: 'decimal', column: c, style: 'plain' }
          }));
        }

        /* HEWN013: "1.234" is a plain decimal to many readers and a
         * thousands separator to a European one. If the column also
         * holds a value of four digits or more, the thousands reading
         * is the only one that fits the column. */
        var grouped = nums.filter(function (x) {
          return /^[+-]?\d{1,3}(\.\d{3})+$/.test(x.raw.trim());
        });
        var bigPlain = nums.filter(function (x) {
          var t = x.raw.trim();
          if (/^[+-]?\d{1,3}(\.\d{3})+$/.test(t)) return false;
          if (x.style === 'eu' || x.style === 'eu-thousands') return false;
          return Math.abs(x.v) >= 1000;
        });
        var commaDecimalPresent = nums.some(function (x) { return x.style === 'eu'; });
        if (grouped.length >= 2 && (bigPlain.length > 0 || commaDecimalPresent)) {
          var gEx = grouped.slice(0, maxEvidence).map(function (x) { return '"' + x.raw.trim() + '"'; });
          issues.push(mkIssue('HEWN013', {
            column: name,
            columnIndex: c,
            count: grouped.length,
            detail: grouped.length + ' values in "' + name + '" are grouped in threes ("' +
                    grouped[0].raw.trim() + '"). Read as plain decimals they are a thousand times too small, ' +
                    'and the column also holds a value of at least four digits, so the thousands reading is the one that fits.',
            evidence: gEx,
            fix: { kind: 'eu-group', column: c }
          }));
        }
      }

      /* HEWN010 empty column */
      if (nRows > 0 && nonEmpty.length === 0) {
        issues.push(mkIssue('HEWN010', {
          column: name,
          columnIndex: c,
          count: nRows,
          detail: '"' + name + '" has no values in any of the ' + nRows + ' rows.',
          evidence: raw.slice(0, maxEvidence).map(function (v, idx) {
            return 'row ' + (idx + 1) + ': ' + (v === '' ? 'empty' : 'whitespace only');
          })
        }));
      }

      /* HEWN012 zero dominated */
      if (col.stats && col.stats.kind === 'number' && col.stats.count >= 5 &&
          col.stats.zeros / col.stats.count >= 0.5 && col.stats.zeros < col.stats.count) {
        issues.push(mkIssue('HEWN012', {
          column: name,
          columnIndex: c,
          count: col.stats.zeros,
          detail: col.stats.zeros + ' of ' + col.stats.count + ' values in "' + name +
                  '" are zero. A zero this common is often a placeholder meaning "not recorded" rather than a measured zero.',
          evidence: ['zero: ' + col.stats.zeros, 'non-zero: ' + (col.stats.count - col.stats.zeros)]
        }));
      }
    }

    /* --- summary -------------------------------------------------- */

    var tally = { error: 0, warn: 0, info: 0, total: 0 };
    issues.forEach(function (i) { tally[i.severity]++; tally.total++; });

    var suggestions = issues.filter(function (i) { return i.fix; });

    return {
      source: {
        format: table.format,
        delimiter: table.delimiter,
        rows: nRows,
        columns: nCols,
        badLines: table.badLines || []
      },
      columns: columns,
      issues: issues,
      suggestions: suggestions,
      summary: {
        rows: nRows,
        columns: nCols,
        cells: nRows * nCols,
        issues: tally
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * Fixes - proposed, never applied unless the reader asks
   * ------------------------------------------------------------------ */

  function applyFixes(table, issues) {
    var rows = table.rows.map(function (r) { return r.slice(); });
    var headers = table.headers.slice();
    var changes = [];

    (issues || []).forEach(function (issue) {
      var fix = issue.fix;
      if (!fix) return;

      if (fix.kind === 'trim') {
        var col = fix.column;
        for (var i = 0; i < rows.length; i++) {
          if (col >= rows[i].length) continue;
          var before = rows[i][col];
          var after = String(before).trim();
          if (before !== after) {
            rows[i][col] = after;
            changes.push({ row: i + 1, column: col, before: before, after: after, rule: issue.id });
          }
        }
      } else if (fix.kind === 'case') {
        var col2 = fix.column;
        for (var j = 0; j < rows.length; j++) {
          if (col2 >= rows[j].length) continue;
          var b2 = rows[j][col2];
          var t2 = String(b2).trim();
          if (t2 === '' || isSentinel(t2)) continue;
          if (t2 === fix.target) continue;
          if (t2.toLowerCase() !== fix.target.toLowerCase()) continue;
          rows[j][col2] = fix.target;
          changes.push({ row: j + 1, column: col2, before: b2, after: fix.target, rule: issue.id });
        }
      } else if (fix.kind === 'sentinel') {
        var col3 = fix.column;
        for (var k = 0; k < rows.length; k++) {
          if (col3 >= rows[k].length) continue;
          var b3 = rows[k][col3];
          if (String(b3).trim() === '' || !isSentinel(b3)) continue;
          rows[k][col3] = fix.replacement;
          changes.push({ row: k + 1, column: col3, before: b3, after: fix.replacement, rule: issue.id });
        }
      } else if (fix.kind === 'decimal') {
        var col4 = fix.column;
        for (var m = 0; m < rows.length; m++) {
          if (col4 >= rows[m].length) continue;
          var b4 = String(rows[m][col4]).trim();
          var num = parseNumber(b4);
          if (!num || num.style !== 'eu' && num.style !== 'eu-thousands') continue;
          var fixed = String(num.value);
          rows[m][col4] = fixed;
          changes.push({ row: m + 1, column: col4, before: b4, after: fixed, rule: issue.id });
        }
      } else if (fix.kind === 'eu-group') {
        var col5 = fix.column;
        for (var n2 = 0; n2 < rows.length; n2++) {
          if (col5 >= rows[n2].length) continue;
          var b5 = String(rows[n2][col5]).trim();
          if (!/^[+-]?\d{1,3}(\.\d{3})+$/.test(b5)) continue;
          var fixed5 = b5.replace(/\./g, '');
          rows[n2][col5] = fixed5;
          changes.push({ row: n2 + 1, column: col5, before: b5, after: fixed5, rule: issue.id });
        }
      } else if (fix.kind === 'rename-header') {
        headers[fix.column] = fix.newName;
      }
    });

    return {
      table: { format: table.format, delimiter: table.delimiter, headers: headers, rows: rows },
      changes: changes
    };
  }

  /* ------------------------------------------------------------------ *
   * Output
   * ------------------------------------------------------------------ */

  function csvEscape(v) {
    var s = String(v === null || v === undefined ? '' : v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toDelimited(table, delimiter) {
    var d = delimiter || table.delimiter || ',';
    var lines = [table.headers.map(csvEscape).join(d)];
    table.rows.forEach(function (r) {
      lines.push(r.map(csvEscape).join(d));
    });
    return lines.join('\n') + '\n';
  }

  function mdEscape(s) {
    return String(s).replace(/\|/g, '\\|');
  }

  function typeLabel(t) {
    return { number: 'number', date: 'date', text: 'text', boolean: 'boolean', mixed: 'mixed', empty: 'empty' }[t] || t;
  }

  function toMarkdown(prof, opts) {
    opts = opts || {};
    var out = [];
    var s = prof.summary;

    out.push('# Data profile' + (opts.title ? ' - ' + opts.title : ''));
    out.push('');
    out.push('**Rows:** ' + s.rows + '  |  **Columns:** ' + s.columns + '  |  **Cells:** ' + s.cells);
    out.push('**Issues:** ' + s.issues.error + ' error, ' + s.issues.warn + ' warning, ' + s.issues.info + ' info');
    out.push('');

    out.push('## Columns');
    out.push('');
    out.push('| # | Name | Type | Distinct | Missing | Example |');
    out.push('|---|------|------|---------:|--------:|---------|');
    prof.columns.forEach(function (c, i) {
      var ex = c.distinctSamples.length ? c.distinctSamples[0].value : '';
      out.push('| ' + (i + 1) + ' | ' + mdEscape(c.name) + ' | ' + typeLabel(c.type) + ' | ' +
              c.distinct + ' | ' + (c.empty + c.missing) + ' | ' + mdEscape(example(ex, 30)) + ' |');
    });
    out.push('');

    if (prof.issues.length) {
      out.push('## Issues');
      out.push('');
      prof.issues.slice().sort(function (a, b) {
        var d = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
        if (d) return d;
        return a.id < b.id ? -1 : 1;
      }).forEach(function (issue) {
        out.push('### ' + issue.id + ' ' + issue.name + ' (' + issue.severity + ')' +
                 (issue.column ? ' - `' + issue.column + '`' : ''));
        out.push('');
        out.push(issue.title + '.');
        out.push('');
        out.push(issue.detail);
        if (issue.evidence.length) {
          out.push('');
          issue.evidence.forEach(function (e) { out.push('- ' + e); });
        }
        out.push('');
      });
    } else {
      out.push('## Issues');
      out.push('');
      out.push('None found. Hewn checked ' + s.rows + ' rows against ' + RULES.length + ' rules.');
      out.push('');
    }

    return out.join('\n');
  }

  return {
    RULES: RULES,
    RULE_BY_ID: RULE_BY_ID,
    SENTINELS: SENTINELS,
    parse: parse,
    profile: profile,
    applyFixes: applyFixes,
    toDelimited: toDelimited,
    toMarkdown: toMarkdown,
    classify: classify,
    detectDelimiter: detectDelimiter,
    sniffFormat: sniffFormat,
    isSentinel: isSentinel
  };
});

/* hewn-engine:end */

/* ------------------------------------------------------------------ *
 * Command line tool
 *
 * The engine above is the whole of Hewn's thinking. This part is only
 * a way of pointing it at a file and showing what comes back.
 * ------------------------------------------------------------------ */

var engine = (typeof module === 'object' && module.exports) ? module.exports : globalThis.Hewn;
var VERSION = '1.0.0';

var USAGE = [
  'Hewn ' + VERSION + ' - a data profiler.',
  '',
  'Hewn reads a CSV, TSV, JSONL or JSON file and reports the ways the data',
  'is lying: a column holding both numbers and text, placeholders standing in',
  'for missing values, mixed date layouts, casing drift, decimal conflicts,',
  'a thousands separator that reads as a decimal point, and more.',
  '',
  'Usage:',
  '  hewn <file> [options]',
  '',
  'Options:',
  '  --format <fmt>     csv | tsv | jsonl | json    (default: auto-detect)',
  '  --delimiter <ch>   field delimiter              (default: auto-detect)',
  '  --markdown <path>  write the full report as Markdown to <path>',
  '  --json             print the profile as JSON on stdout',
  '  --fix              print the data with safe fixes applied (CSV on stdout)',
  '  --quiet            only print the summary line',
  '  --version          print the version and exit',
  '  --help             print this message and exit',
  '',
  'Exit codes:',
  '  0  no error-severity issue was found',
  '  1  at least one error-severity issue was found',
  '  2  the file could not be read or parsed',
  '',
  'What Hewn does NOT do:',
  '  it never modifies your file; it never uses the network; it does not',
  '  know what your data means, only how it is shaped; and it will not guess',
  '  a date convention or a decimal standard for you.',
  '',
  'The same rules run in the browser from hewn.html, the single file next to',
  'this one. Open it from disk; it needs no server and no network.'
].join('\n');

function parseArgs(argv) {
  var opts = {
    file: null,
    format: 'auto',
    delimiter: 'auto',
    markdown: null,
    json: false,
    fix: false,
    quiet: false,
    help: false,
    version: false,
    sync: false
  };
  var positional = [];

  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--help' || a === '-h') { opts.help = true; }
    else if (a === '--version' || a === '-V') { opts.version = true; }
    else if (a === '--sync-html') { opts.sync = true; }
    else if (a === '--json') { opts.json = true; }
    else if (a === '--fix') { opts.fix = true; }
    else if (a === '--quiet' || a === '-q') { opts.quiet = true; }
    else if (a === '--format') { opts.format = argv[++i]; }
    else if (a === '--delimiter') { opts.delimiter = argv[++i]; }
    else if (a === '--markdown') { opts.markdown = argv[++i]; }
    else if (a.indexOf('--') === 0) {
      throw new Error('unknown option: ' + a);
    } else {
      positional.push(a);
    }
  }

  if (positional.length > 1) throw new Error('expected one file, got ' + positional.length);
  opts.file = positional[0] || null;
  return opts;
}

function fmt(n) {
  if (n === null || n === undefined) return '-';
  if (typeof n !== 'number') return String(n);
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1000) / 1000);
}

function pad(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

function textReport(prof) {
  var out = [];
  var s = prof.summary;

  out.push('Hewn - data profile');
  out.push('  source   ' + prof.source.format + ', ' + prof.source.rows + ' rows x ' + prof.source.columns + ' columns');
  out.push('  issues   ' + s.issues.error + ' error, ' + s.issues.warn + ' warning, ' + s.issues.info + ' info');
  out.push('');

  out.push('COLUMNS');
  out.push('  ' + pad('#', 3) + pad('NAME', 24) + pad('TYPE', 9) + pad('DISTINCT', 10) + pad('MISSING', 9) + 'EXAMPLE');
  prof.columns.forEach(function (c, i) {
    var ex = c.distinctSamples.length ? c.distinctSamples[0].value : '';
    if (ex.length > 26) ex = ex.slice(0, 25) + '…';
    out.push('  ' + pad(i + 1, 3) + pad(c.name.length > 22 ? c.name.slice(0, 21) + '…' : c.name, 24) +
             pad(c.type, 9) + pad(c.distinct, 10) + pad(c.empty + c.missing, 9) + ex);
    if (c.stats && c.stats.kind === 'number') {
      out.push('      min ' + fmt(c.stats.min) + '  median ' + fmt(c.stats.median) + '  max ' + fmt(c.stats.max) +
               '  zeros ' + c.stats.zeros + '/' + c.stats.count);
    } else if (c.stats && c.stats.kind === 'date') {
      out.push('      ' + c.stats.min + ' .. ' + c.stats.max + '  formats: ' + c.stats.formats.join(', '));
    }
  });
  out.push('');

  if (prof.issues.length) {
    out.push('ISSUES');
    prof.issues.slice().sort(function (a, b) {
      var order = { error: 0, warn: 1, info: 2 };
      var d = order[a.severity] - order[b.severity];
      if (d) return d;
      return a.id < b.id ? -1 : 1;
    }).forEach(function (issue) {
      out.push('  [' + issue.severity.toUpperCase() + '] ' + issue.id + ' ' + issue.name +
               (issue.column ? '  column: ' + issue.column : ''));
      out.push('      ' + issue.title + '.');
      out.push('      ' + issue.detail);
      issue.evidence.forEach(function (e) { out.push('        - ' + e); });
      out.push('');
    });
  } else {
    out.push('ISSUES');
    out.push('  none. Checked ' + s.rows + ' rows against ' + engine.RULES.length + ' rules.');
    out.push('');
  }

  return out.join('\n');
}

/* ------------------------------------------------------------------ *
 * Keeping the page and the command line on the same rules
 *
 * The engine lives between two marker comments in this file, and a
 * byte-identical copy lives between the same two markers in hewn.html.
 * If the two ever differ, the page is running different rules from the
 * command line, and the test suite fails. --sync-html puts them back in
 * step; the test suite says so when they are out of step.
 * ------------------------------------------------------------------ */

var ENGINE_BEGIN = '/* hewn-engine:begin */';
var ENGINE_END = '/* hewn-engine:end */';

function engineBlock(source) {
  var b = source.indexOf(ENGINE_BEGIN);
  var e = source.indexOf(ENGINE_END);
  if (b === -1 || e === -1 || e < b) return null;
  return source.slice(b + ENGINE_BEGIN.length, e);
}

function syncHtml() {
  var htmlPath = path.join(__dirname, 'hewn.html');
  var html;
  try {
    html = fs.readFileSync(htmlPath, 'utf8');
  } catch (e) {
    process.stderr.write('hewn: cannot read ' + htmlPath + ': ' + e.message + '\n');
    return 2;
  }
  var b = html.indexOf(ENGINE_BEGIN);
  var e = html.indexOf(ENGINE_END);
  if (b === -1 || e === -1 || e < b) {
    process.stderr.write('hewn: ' + htmlPath + ' does not carry the engine markers\n');
    return 2;
  }
  var body = engineBlock(fs.readFileSync(__filename, 'utf8'));
  if (body === null) {
    process.stderr.write('hewn: this file does not carry the engine markers\n');
    return 2;
  }
  var out = html.slice(0, b + ENGINE_BEGIN.length) + body + html.slice(e);
  if (out === html) {
    process.stdout.write('hewn: hewn.html is already in step with hewn.js\n');
    return 0;
  }
  try {
    fs.writeFileSync(htmlPath, out, 'utf8');
  } catch (err) {
    process.stderr.write('hewn: cannot write ' + htmlPath + ': ' + err.message + '\n');
    return 2;
  }
  process.stdout.write('hewn: copied the engine from hewn.js into hewn.html\n');
  return 0;
}

function main(argv) {
  var opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    process.stderr.write('hewn: ' + e.message + '\n\n' + USAGE + '\n');
    return 2;
  }

  if (opts.version) {
    process.stdout.write('hewn/' + VERSION + '\n');
    return 0;
  }

  if (opts.sync) {
    return syncHtml();
  }

  if (opts.help || !opts.file) {
    process.stdout.write(USAGE + '\n');
    return opts.help ? 0 : 2;
  }

  var text;
  try {
    text = fs.readFileSync(opts.file, 'utf8');
  } catch (e) {
    process.stderr.write('hewn: cannot read ' + opts.file + ': ' + e.message + '\n');
    return 2;
  }

  var table;
  try {
    table = engine.parse(text, { format: opts.format, delimiter: opts.delimiter });
  } catch (e) {
    process.stderr.write('hewn: cannot parse ' + opts.file + ': ' + e.message + '\n');
    return 2;
  }

  if (table.error) {
    process.stderr.write('hewn: cannot parse ' + opts.file + ': ' + table.error + '\n');
    return 2;
  }

  if (!table.rows.length) {
    process.stderr.write('hewn: ' + opts.file + ' has no data rows\n');
    return 2;
  }

  var prof = engine.profile(table);

  if (opts.markdown) {
    try {
      fs.writeFileSync(opts.markdown, engine.toMarkdown(prof, { title: path.basename(opts.file) }), 'utf8');
    } catch (e) {
      process.stderr.write('hewn: cannot write ' + opts.markdown + ': ' + e.message + '\n');
      return 2;
    }
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(prof, null, 2) + '\n');
  } else if (opts.fix) {
    var applied = engine.applyFixes(table, prof.suggestions);
    process.stdout.write(engine.toDelimited(applied.table, table.delimiter));
    if (!opts.quiet) {
      process.stderr.write('hewn: applied ' + applied.changes.length + ' safe fix(es); ' +
        prof.issues.length + ' issue(s) remain that Hewn will not change for you.\n');
    }
  } else if (!opts.quiet) {
    process.stdout.write(textReport(prof) + '\n');
  } else {
    var s = prof.summary.issues;
    process.stdout.write(prof.source.rows + ' rows, ' + prof.source.columns + ' columns: ' +
      s.error + ' error, ' + s.warn + ' warning, ' + s.info + ' info\n');
  }

  return prof.summary.issues.error > 0 ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = Object.assign({}, engine, {
  VERSION: VERSION,
  main: main,
  parseArgs: parseArgs,
  textReport: textReport,
  syncHtml: syncHtml,
  engineBlock: engineBlock,
  ENGINE_BEGIN: ENGINE_BEGIN,
  ENGINE_END: ENGINE_END
});
