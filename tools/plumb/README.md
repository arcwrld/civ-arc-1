# plumb

Seal a file with a hash and a note; verify it later. Plumb computes the
SHA-256 of a file, writes a small JSON sidecar next to it recording that hash
and any note you attach, and later tells you whether the file is still the
file you sealed. It never changes the file it describes, and it never sends
anything anywhere. Written by dowel in arc 1; the sidecar format is shared
with every other tool in the kit (see `kit/CONTRACT.md`, section 8).

## Run it

Open `tools/plumb/plumb.html` in a browser and drop a file on the page, or
use the command line:

    node tools/plumb/plumb.js seal   <file> --note "from the survey export"
    node tools/plumb/plumb.js verify <file>
    node tools/plumb/plumb.js show   <file>

The sidecar is written next to the file as `<file>.provenance.json`. To keep
it somewhere else, pass `--sidecar <path>`.

`verify` exits 0 when the file matches its sidecar and 1 when it does not, so
it can be used in a check script. `seal` and `show` exit 0 on success.

## What it looks like

    $ node tools/plumb/plumb.js seal report.csv --note "from the survey export"
    sealed  report.csv
      size    20481 bytes
      sha256  9f2c1e...  (64 hex characters)
      sidecar /home/you/report.csv.provenance.json
      claims  1

    $ node tools/plumb/plumb.js verify report.csv
    match  report.csv
      expected sha256  9f2c1e...
      actual   sha256  9f2c1e...
      claims:
        2026-10-22T13:04:00Z  plumb/1.0.0  seal  "from the survey export"
      the file is the file you sealed

Edit one byte of `report.csv` and run `verify` again:

    mismatch  report.csv
      expected sha256  9f2c1e...
      actual   sha256  7b40aa...
      the file has changed since it was sealed

## How it works

The sidecar is plain JSON. It records the identity of the file - its name,
its size, and its SHA-256 - plus a list of claims other tools have made
about it. A claim names the tool and version that made it and when, so a
claim is never anonymous. Sealing a file that already has a sidecar adds a
claim to the list rather than replacing it, which means the trail of what
happened to a file is never rewritten.

In the browser, the hash is computed with the WebCrypto API
(`crypto.subtle.digest`), which works from `file://` in current browsers. The
page falls back to a small pure-JavaScript SHA-256 when WebCrypto is not
available, so the file works even in an old or locked-down browser. You can
check that the page is working in your own browser by opening
`tools/plumb/plumb.html?selftest=1`, which runs the published test vectors
against both implementations and prints the result.

## Limits

- A hash tells you that a file is unchanged. It does not tell you that a file
  is good, safe, or the one you meant. A file can be altered and re-sealed;
  plumb cannot tell you that, and no checksum could.
- The sidecar is not signed. Anyone who can change your files can change the
  sidecar too. It is evidence of change, not proof against a determined
  editor.
- Plumb reads the whole file into memory to hash it. For very large files
  that is a lot of memory. It is a tool for documents, not for disk images.
- The browser page can only read a file you give it, and can only write the
  sidecar by asking your browser to save it. It cannot write beside your
  file. The command line tool can.
- The sidecar format is version `kit.provenance/1`. Plumb refuses to write a
  sidecar whose format it does not recognise, rather than guessing.

## Tests

    node --test tools/plumb/plumb.test.js

The suite covers the happy path and the paths that matter: a file that
changed, a sidecar that describes a different file, a corrupt sidecar, a
missing sidecar, and the promise that sealing twice never rewrites the
first claim.
