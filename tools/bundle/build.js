#!/usr/bin/env node
'use strict';
// build.js - keep bundle.html and bundle.js in step.
//
// The rules of a bundle live in one block of source, marked
// BUNDLE-CORE-START / BUNDLE-CORE-END, inside bundle.js. This script
// copies that block into bundle.html. There is one source of truth, so the
// page and the command line cannot drift apart.
//
//   node tools/bundle/build.js          rewrite bundle.html from bundle.js
//   node tools/bundle/build.js --check  fail if bundle.html is out of date
//
// --check is what the test suite runs, and what you run before a commit.

const fs = require('node:fs');
const path = require('node:path');

const START = '/* BUNDLE-CORE-START */';
const END = '/* BUNDLE-CORE-END */';

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

// Pull the marked block out of a file.
function extract(text, what) {
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  if (a === -1 || b === -1 || b < a) {
    throw new Error(what + ' does not contain a marked core block');
  }
  return text.slice(a, b + END.length);
}

// Put a block back into a file, replacing whatever was there.
function splice(text, block) {
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  if (a === -1 || b === -1 || b < a) {
    throw new Error('the file does not contain a marked core block');
  }
  return text.slice(0, a) + block + text.slice(b + END.length);
}

function main(argv) {
  const check = argv.includes('--check');
  const here = __dirname;
  const jsPath = path.join(here, 'bundle.js');
  const htmlPath = path.join(here, 'bundle.html');

  const block = extract(read(jsPath), 'bundle.js');
  const html = read(htmlPath);
  const wanted = splice(html, block);

  if (check) {
    if (wanted !== html) {
      process.stderr.write(
        'bundle.html is out of date with bundle.js.\n' +
        'Run: node tools/bundle/build.js\n'
      );
      return 1;
    }
    process.stdout.write('bundle.html matches bundle.js\n');
    return 0;
  }

  fs.writeFileSync(htmlPath, wanted, 'utf8');
  process.stdout.write('wrote ' + htmlPath + '\n');
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { extract, splice, START, END };
