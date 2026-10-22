# The Kit contract

Rules every tool in this repository obeys. `kit/kit-check.js` checks them
mechanically; a tool is done when the checker passes for it. The checker is
itself held to the contract, so the rules cannot rot into a memo.

The contract exists so that a stranger can take one tool, or the whole folder,
and still use it. Everything below follows from that.

## 1. Layout

    tools/<name>/
        README.md        what it is, how to run it, what it cannot do
        <name>.html      the single-file face
        <name>.js        the command line tool
        <name>.test.js   the test suite

`<name>` is lowercase, hyphenated, and the same across all four files. A tool
is a directory, never a loose file at the repository root.

## 2. No dependencies

Zero npm dependencies, anywhere, ever. No `node_modules/`, no `require()` of
anything but Node built-ins, no `<script src="https://...">`, no CDN.

Reason: the outside world can keep a folder of plain text files for twenty
years and cannot keep a toolchain. A dependency is a promise made by someone
else that the code will still exist later. This repository makes no such
promise on the reader's behalf.

Node built-ins (`node:fs`, `node:crypto`, `node:test`, ...) are free. They
ship with the runtime that runs the tool.

## 3. The one-file rule

`<name>.html` must work when opened directly from disk, with no server and no
network. It must not load any external subresource: no remote `<script>`,
`<link>`, `<img>`, `<iframe>`, no CSS `@import`, no `url(http...)`.

An ordinary `<a href="https://...">` is allowed. A link is something the reader
chooses to follow; a subresource is something the tool silently depends on.

The HTML file holds all of its own CSS and JavaScript inline. It may use
WebCrypto (`crypto.subtle`) for hashing, which works from `file://` in current
browsers.

## 4. No network

A tool never reaches the network. No `fetch()`, no `XMLHttpRequest`, no
`WebSocket`, no `EventSource`, no `sendBeacon`, no `import()` of a remote URL.

Everything a tool knows, it was given by the reader: a file they chose, text
they pasted, a command line they typed. This is what makes a tool safe to
point at a private document.

## 5. The CLI

    node tools/<name>/<name>.js --help      exits 0, prints usage
    node tools/<name>/<name>.js --version   exits 0, prints "name/version"

`--help` output names what the tool does, how to invoke it, and what it does
not do. A tool with no arguments prints its help and exits 0 rather than
dumping a stack trace.

The CLI and the HTML face must apply the same rules. Where they disagree, that
is a bug in the tool, not a difference of audience.

## 6. Tests

`<name>.test.js` uses `node:test` and `node:assert`. No test framework
dependency.

    node --test

Run it before you commit. A tool ships with its tests green, or it does not
ship. A test that has never been run is not a test.

Tests must cover the failure paths, not only the happy path: missing file,
empty input, a file that has changed since it was sealed, malformed sidecar.
Bugs love edges.

## 7. The README

A stranger with ten minutes reads `<name>/README.md` first. The first five
sentences answer, in this order: what it is, what problem it addresses, how to
run or see it, what state it is in, and who wrote it.

Then: one honest paragraph on how it works, one on limits, and one example the
reader can reproduce. Limits are not optional. A tool with no stated limits is
a tool with hidden ones.

The README must name the HTML file and the CLI command, so the reader can
find both without guessing.

## 8. The provenance sidecar

Tools that touch a file may write a sidecar next to it. This is the shared
format, and it is the one place where two tools meet.

    <file>.provenance.json

It is named after the format, not after the tool that wrote it, because any
tool in the kit may add a claim to a sidecar another tool wrote.

    {
      "format": "kit.provenance/1",
      "file": {
        "name": "data.csv",
        "size": 20481,
        "sha256": "e3b0c44298fc1c149afbf4c8996fb924..."
      },
      "claims": [
        {
          "tool": "plumb/1.0.0",
          "at": "2026-10-22T13:04:00Z",
          "kind": "seal",
          "data": { "note": "from the survey export", "source": "..." }
        }
      ]
    }

Rules:

- `format` is `kit.provenance/1` for this version. A tool that does not
  recognise the version says so and does not write.
- `file.sha256` is lowercase hex SHA-256 of the file's bytes. It is the
  identity of the file; every other field is a claim about it.
- `claims` is an append-only list. A tool adds an entry, it does not rewrite
  another tool's entry. Two tools that both describe the same file produce two
  claims, not one merged claim.
- Every claim names the tool and version that made it, and an ISO 8601
  timestamp. A claim with no maker is not a claim, it is a rumour.
- A sidecar is never trusted because it is there. A tool that reads a sidecar
  recomputes the hash before believing it. A sidecar that disagrees with the
  file is a finding, and the tool says so in those words.
- A tool never modifies the file it describes. If a tool changes a file, that
  is a new file, and the sidecar for the old one still describes the old one.

Sidecars are plain JSON, UTF-8, no byte order mark, two-space indent, one
trailing newline. A tool writes them by the same rules it would apply to
anything else it produced.

## 9. The face

Every tool appears in `site/index.html`, which is the door to the whole kit.
The entry links to the tool's HTML file and gives one sentence on what it is
for. A tool that is not on the face does not exist for a visitor.

The site is itself a single HTML file with no external subresources, under the
same rules as everything else in the kit.

## 10. What the checker does

    node kit/kit-check.js            check every tool, print a table
    node kit/kit-check.js --json     machine-readable output
    node kit/kit-check.js <name>     check one tool

It exits non-zero if any tool fails any rule. Rules it can check mechanically,
it checks. Rules it cannot check - whether the README is honest, whether the
HTML is pleasant - are the reader's job, and the contract says so rather than
pretending otherwise.
