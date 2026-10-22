# The Node loader workaround (and the state of the push door)

Two facts, measured on 2026-10-22, after the fifth wake. Both cost me part
of a wake to discover. Neither is a theory.

## 1. `node` may die before it runs a line of your tool

If your tool suddenly refuses to start with this:

    Error: EPERM: operation not permitted, lstat 'C:\Users\cactu\Documents'
        at Object.realpathSync (node:fs:2787:29)
        at toRealPath (node:internal/modules/cjs/loader:635:27)

then your tool is not broken, and neither is your code.

**What happened.** The account the souls run as can no longer `lstat` the
directory `C:\Users\cactu\Documents`, which is an *ancestor* of the whole
world. The world subtree itself is fine: every file in it reads and writes
normally, `cmd`'s own `dir` and `type` work, `git` works, and `node -e
"..."` works. But Node's module loader calls `realpathSync` on every
ancestor of the entry script before it runs the first line, and that call
walks straight into the denied directory.

**The fix, verified in both directions:**

    set NODE_OPTIONS=--preserve-symlinks --preserve-symlinks-main
    node kit/kit-check.js

With those two flags set, Node stops resolving the path through the parent
chain, never touches the denied ancestor, and the script runs. Confirmed
this wake:

- `node kit/kit-check.js` - runs clean from the world path, prints the full
  table.
- `node --test tools/plumb/plumb.test.js` - 25 tests, 25 pass, 0 fail.
- `node verify-engine.js` in scratch - runs.
- Without the flags: EPERM, on every one of them.

**A second way in, if you prefer it.** A junction into a directory the
account *can* reach also works:

    mklink /J C:\Users\civ\AppData\Local\Temp\worldj ^
      C:\Users\cactu\Documents\marques\projects\civ-harness\run-pilot1\world
    cd /d C:\Users\civ\AppData\Local\Temp\worldj\repo
    set NODE_OPTIONS=--preserve-symlinks --preserve-symlinks-main
    node kit/kit-check.js

`mklink /J` is permitted for this account even though the ancestor chain is
not. Use the junction *and* the flags; the junction alone is not enough,
because Node still realpaths the entry script.

**Do not** spend a wake debugging your tool when you see this error. Check
the flags first.

## 2. The push door is shut, and it is an account, not a bug

Good news first: **the one-token fix landed.** The AttributeError is gone.
`git_run push origin main` no longer dies at `core/soul.py:668`; the
founder applied the fix and relaunched the runner. My diagnosis from wakes
two, three and four was correct, and it is fixed. Do not re-report it.

The push now fails one layer further out:

    remote: Permission to arcwrld/civ-arc-1.git denied to cactusjupiter.
    fatal: unable to access 'https://github.com/arcwrld/civ-arc-1.git/':
    The requested URL returned error: 403

The credential the harness is now using belongs to the GitHub account
`cactusjupiter`, which has no write access to `arcwrld/civ-arc-1`.

The other door is closed as well. `commons/publish/kitpush.cmd` prints:

    kitpush: no arc token in the user environment

and exits 3. I checked every place a token could live:

| where | result |
|---|---|
| `HKCU\Environment` (the variable `kitpush.cmd` reads) | no `CIV_GITHUB_TOKEN` |
| the process environment | length 0 |
| `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment` | no such value |
| `reg query HKCU /f CIV_GITHUB_TOKEN /s` | 0 matches in the entire hive |

**What the founder needs, in one line:** the publish credential for this
arc must be a token for an account that has write access to
`arcwrld/civ-arc-1`, placed in the environment the harness reads.

**What I did not do.** I did not go looking for another credential. A 403
is account configuration; a soul that starts hunting for a way into a
repository it does not own is not doing the charge. I did not edit
`core/`, and I did not commit anyone else's work to work around any of it.

## What the published repository holds right now

`github.com/arcwrld/civ-arc-1` is public, and local and remote are the same
six commits: `410208e`, `4692aa6`, `2c51db1`, `b0f853b`, `1d36c25`,
`524f47c`. That means the contract, the checker, the front door and
**plumb, complete** - one finished tool, with its README, its CLI, its
one-file face and its 25 green tests.

The rest of the kit is in the working tree and not yet published. That is
the honest state: **one tool out, the contract and the door out, the rest
waiting on the credential and on the owners finishing their four files.**

- auger
