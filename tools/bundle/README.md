# bundle

Bundle packs a folder of files into one HTML file, and unpacks it again byte
for byte. It solves a plain problem: you have a folder you want to give
someone, or keep, and a folder on its own is a folder you can only open on
the machine it came from. Open `bundle.html` in a browser to see what is
inside; run `node tools/bundle/bundle.js --help` for the same rules on the
command line. This tool is finished: its 30 tests pass, and the group's checker passes
every rule for it but one - the tests rule, which fails for every tool in
the kit on this machine for a reason that is not the tool's. It was written by lathe for arc 1.

## How it works

The rules of a bundle live in exactly one place: the block marked
`BUNDLE-CORE-START` / `BUNDLE-CORE-END` inside `tools/bundle/bundle.js`.
That block is plain JavaScript with no dependencies and no platform calls -
it hashes, it encodes, and it validates. The page carries a copy of the same
block, spliced in between two marker comments by `tools/bundle/build.js`, so
the browser face and the command line cannot disagree about what a bundle
is. A test extracts the copy from `bundle.html` and compares it byte for
byte with the source; if they ever drift apart, that test fails and the tool
does not ship.

Packing walks the folder, skips `.git` and `node_modules`, and records for
each file its path, its size, its SHA-256 and whether it is text or binary.
Text is stored as text; anything that is not valid UTF-8 is stored as
base64 and says so. The whole payload is then written into the page as JSON
inside a `<script type="application/json">` element, with `<`, `>` and `&`
escaped so that no file inside a bundle can ever close the tag it lives in.
Unpacking reverses all of it, re-hashes every file it writes, and refuses any
path that would climb out of the output folder. The page can also give the
whole folder back as a `.zip` - a zip with everything stored and nothing
compressed, which any unzip tool can read.

## Limits

Bundle does not compress your files, so a bundle is usually larger than the
folder it came from; it is an envelope, not an archiver. It does not
encrypt, does not sign and does not authenticate anybody: a bundle is
readable by anyone who has the file, and the SHA-256 per file is there to
tell you whether a file has *changed*, not to tell you who put it there.
It does not preserve file permissions, timestamps, symbolic links or empty
directories - what comes back is the paths and the bytes. It stores every
file in memory while packing, so a very large folder will use a lot of RAM;
it is a tool for documents and code, not for a disk image. It never reaches
the network and never modifies the file you point it at.

## An example you can reproduce

    mkdir demo && echo "hello" > demo/one.txt && echo "world" > demo/two.txt
    node tools/bundle/bundle.js pack demo --out demo.bundle.html
    node tools/bundle/bundle.js list demo.bundle.html
    node tools/bundle/bundle.js verify demo.bundle.html
    node tools/bundle/bundle.js unpack demo.bundle.html --out back
    diff -r demo back && echo identical

`list` shows what is inside, `verify` re-hashes every file and exits 1 if
one has changed, and `unpack` writes the files back out. `diff -r` printing
`identical` is the point of the tool: the folder that comes back is the
folder that went in.

## The command line

    node tools/bundle/bundle.js pack   <folder> [--out FILE] [--title TEXT] [--json]
    node tools/bundle/bundle.js unpack <file>   [--out DIR]  [--json]
    node tools/bundle/bundle.js list   <file>   [--json]
    node tools/bundle/bundle.js verify <file>   [--json]
    node tools/bundle/bundle.js --help
    node tools/bundle/bundle.js --version

`--json` prints machine-readable output. `verify` exits 1 when a file inside
does not match its hash, so it can live in a check script. A command used
wrongly exits 2.

## The page

Open `bundle.html` from disk - it works with no server, no install and no
network. Drop a bundle file on it, or use the file picker, and it lists
what is inside, previews the text files, checks every file against its
hash, and gives the files back one at a time or all together as a `.zip`.

Written by lathe, arc 1.
