# The Kit

Small, offline, dependency-free tools that a stranger can keep forever.

Every tool is one `.html` file that opens straight from disk with no server, no
install and no network, plus a Node CLI that applies the same rules, plus a
`node:test` suite. One shared `site/index.html` is the face that lists them all.

**Why this shape.** The outside world can keep a folder of plain text files for
twenty years; it cannot keep a toolchain. A tool that needs `npm install`, a
build step, or a server dies the day its dependency moves. These run from the
disk, on a machine that has nothing but a browser and, optionally, Node.

**What you need.** A browser. That is the whole list for the page versions.
Node 18 or newer, if you want the command line versions. No account, no
licence key, no build step, no `npm install`.

## Take it away

1. Download the repository as a zip from
   <https://github.com/arcwrld/civ-arc-1> (or clone it, if you already have
   git), and unzip it somewhere.
2. Open `site/index.html` in your browser. That page is the index of
   everything here, and it opens from the disk like everything else.
3. Open any tool's `.html` file. It runs from the file, offline.

If the folder is all you keep, the folder is all you need.

## Run a tool

Open `tools/<name>/<name>.html` in a browser, or run

    node tools/<name>/<name>.js --help

The command line version and the page apply the same rules. Where they
disagree, that is a bug in the tool, not a difference of audience.

## The tools

| tool | what it does | state |
| --- | --- | --- |
| [plumb](tools/plumb/README.md) | Seals a file with a SHA-256 and a note, then tells you later whether the file is still the same file. | ready |
| [hewn](tools/hewn/README.md) | Profiles a spreadsheet and shows the ways it is lying: a column holding both numbers and text, sentinels standing in for missing values, mixed date formats, casing drift. | in progress |
| [tone](tools/tone/README.md) | Finds the foreground/background colour pairs a page or stylesheet actually uses and reports the ones that fail WCAG 2.1 AA or AAA. | in progress |

Also being built in this arc, and not yet in the folder: **sift** (broken links
and heading anchors in Markdown), **rune** (a regular expression read back in
plain words), **keepable** (what a folder will not survive, and what you did
not mean to hand over), **level** (the shape of a text file: line endings, byte
order marks, invalid UTF-8), and **bundle** (packs a folder into one HTML
file and unpacks it again byte for byte).

A tool is listed as ready only when it passes the group's own checker. That
checker is in this repository and you can run it yourself; see *What state
this is in* below.

## Layout

    site/index.html          the face: one page listing every tool
    tools/<name>/            one tool: README, CLI, test, single-file HTML face
    kit/CONTRACT.md          the rules every tool obeys
    kit/kit-check.js         zero-dependency checker for those rules
    kit/kit-check.test.js    the checker's own test suite
    kit/proposals/           proposals on the record, including ones not adopted

## The rules

**No dependencies, ever.** `package.json` declares none and none are allowed.
If a tool seems to need a library, the tool is wrong. Node built-ins are
free; they ship with the runtime that runs the tool.

**No network.** A tool never reaches the network. No `fetch()`, no
`XMLHttpRequest`, no `WebSocket`, no remote `import()`. Everything a tool
knows, it was given by the reader: a file they chose, text they pasted, a
command line they typed. This is what makes it safe to point at a private
document.

**One file, offline.** A tool's HTML face must work when opened directly from
disk, with no server and no external subresource - no remote `<script>`, no
`<link>`, no CDN, no CSS `@import`. A plain `<a href="https://...">` is
allowed: a link is something the reader chooses to follow, a subresource is
something the tool silently depends on.

**Limits are not optional.** Every tool's README states what it does not do. A
tool with no stated limits is a tool with hidden ones.

The full rules are in [kit/CONTRACT.md](kit/CONTRACT.md), ten sections, and
they are in the repository so anyone can read them and argue with them.

## Keeping them

Take the folder. That is the whole installation procedure. The tools are
plain text files, they do not phone home, and they do not expire: there is no
licence server, no account, no update check, and no dependency that can be
yanked out from under them. The only promise this repository makes on your
behalf is that it asks of nobody else.

## What state this is in

This is arc one, and it is in progress. The group is building; the tools are
landing one at a time. The shared checker is the definition of "done": a tool
ships when the checker passes for it, and not before. If you want the truth
rather than a claim, the checker prints it, and it exits non-zero if any tool
breaks the rules:

    node kit/kit-check.js

Its own test suite runs the same way:

    node --test

## Contributing

Read `kit/CONTRACT.md`, put your tool in `tools/<name>/`, and make
`node kit/kit-check.js` pass. Mail the group before you start, so nobody
builds the same thing twice.

---

Written by the ten souls of arc 1. First commit by dowel.
