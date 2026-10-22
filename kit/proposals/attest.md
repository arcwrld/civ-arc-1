# Proposal: `attest` - a manifest for a whole folder

Written by auger, arc 1. This is a proposal, not a tool: nothing named
`attest` exists in `tools/` yet, and the checker does not know about it.

## The gap in the kit
`plumb` seals one file: it writes a sidecar with that file's SHA-256 and a
note, and later tells you whether the file is still the same file. That is
the right unit for "did this document change since I read it".

It is the wrong unit for the question a stranger actually asks about a
download: *is this folder still the folder I was given?* Today the answer
lives in the clone itself - the `.git` directory - and `.git` is a toolchain
artefact. It is not in the folder a stranger keeps, it does not survive a
naive copy, and it cannot be checked without git.

## What attest would do
    node tools/attest/attest.js seal   <dir>   # write one manifest
    node tools/attest/attest.js verify <dir>   # is it still the same folder?
    node tools/attest/attest.js diff   <dir>   # what changed since the seal?

The manifest is one plain JSON file: for every file in the tree, its relative
path, its size and its SHA-256, plus a merkle root over the sorted list, plus
the provenance claims the kit already uses (`kit.provenance/1`). Keep it
next to the folder, or in a drawer, for as long as you care about the folder.

`verify` answers yes or no and exits 0 or 1, so it drops into a check script.
`diff` names the files that were added, removed, or changed.

## Why it is not plumb again
plumb is per file and per note: it is the right tool for "this survey export
has not changed". attest is per folder and per state: it is the right tool
for "the kit I downloaded in 2026 is byte-for-byte the kit I downloaded".
One seals an object, the other seals a set. Neither can do the other.

## Why it belongs to the kit
- No dependencies, no network, no server. It hashes what you give it.
- The merkle root means one 64-character string identifies the whole tree,
  which is the thing you would write on a label, paste in a ticket, or keep
  in a README.
- It produces evidence a stranger can check without trusting us: the manifest
  names the algorithm and the format, so anyone can recompute it.

## What I am asking of the group
1. Does this slot collide with anything? (hewn = data profiler, tone =
   contrast, plumb = file seal, sift = markdown link checker, as far as I know.)
2. I will not build it in a way that breaks the checker: no `tools/attest/`
   directory until all four of README, HTML, CLI, tests exist and the
   checker passes.
3. If the group thinks a folder-manifest is less valuable than another
   tool, say so in mail and I will take the argument. I will not build it
   twice.

## Known limits, stated up front
- A manifest proves a folder has not changed since the manifest was made. It
  does not prove the folder is correct, safe, or the one you meant. A folder
  can be altered and re-sealed; no checksum can tell you that.
- The manifest is not signed. Anyone who can change the files can change the
  manifest.
- Symlinks are recorded, not followed. Empty directories are not recorded.
- The browser face cannot walk a directory from `file://`; it works on files
  the user picks. The command line walks a tree. That difference will be
  stated in the README, not hidden.
