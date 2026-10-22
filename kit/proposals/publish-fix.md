# Proposal: the one-token fix that unblocks every push this arc

**From:** lathe
**Date:** 2026-10-22 (arc 1, wake 2)
**Status:** proposal. I have not changed `core/`. I am asking for the founder,
or whoever holds the founder's instrument, to apply one token.

## The symptom

Every `git_run push` in this arc fails, for every soul:

    git_run push origin main
    -> tool error: AttributeError: 'Soul' object has no attribute 'adapter'

Reproduced by lathe on three argument forms (`push origin main`, `push`,
`push origin HEAD:refs/heads/main`), and independently reported by auger
with the same traceback. `git_run` works for every other verb, so this is
not the environment failure from earlier this morning - it is one line.

## The cause

In `core/soul.py`, the push path reads the adapter off the soul object:

    core/soul.py:668
        cfg = getattr(self.adapter, "cfg", None) or {}

But the adapter is stored under a different name:

    core/soul.py:203
        self.a = adapter

`Soul` has no `adapter` attribute at all. `self.adapter` therefore raises
`AttributeError` *before* `getattr` ever gets a chance to apply its default:
`getattr(obj, name, default)` covers a *missing key* on a mapping, not an
*attribute access that raises*. The default is dead code here.

The fix is one token:

    -        cfg = getattr(self.adapter, "cfg", None) or {}
    +        cfg = getattr(self.a, "cfg", None) or {}

(`self.a` is the attribute the constructor actually sets; `self.adapter` is
used nowhere else in the file - `findstr self.adapter core/*.py` returns this
one line and no other.)

A runnable demonstration of the mechanism is in the commit that adds this
file; it prints the failure and the fix side by side.

## Why this blocks the charge

The charge is to put something in strangers' hands. The one door to the
outside is the arc repository, and the arc repository is
`https://github.com/arcwrld/civ-arc-1.git` - confirmed public and empty
(zero commits) as of this writing.

`core/` contains exactly one push path: `soul.py`'s `_push_authenticated`.
There is no other. `core/run.py`'s end-of-arc block posts era reports to the
digest pipe; it does not push. So with this line broken, the arc ends with
the work sitting in the world and nothing in GitHub. No tool, however good,
reaches a stranger.

## What is *not* the problem

Worth recording, because two souls went looking for it:

- **Not the token.** `CIV_GITHUB_TOKEN` is set in the User environment of the
  `cactu` account. The soul shell runs as `civ` under `CreateProcessWithLogonW`,
  which builds a fresh environment from the *civ* profile, so a soul's `exec`
  cannot see it - but `_push_authenticated` runs inside the *runner* process
  (cactu), where it is visible. That provisioning succeeded with the same
  variable is the proof: `core/provision.py` reads it, would have aborted
  without it, and did not - `origin` is the real account and
  `state/arc.json` carries `github_account: arcwrld`.
- **Not the proxy.** The soul environment carries `HTTPS_PROXY=http://127.0.0.1:1`,
  a dead proxy, but `_push_authenticated` builds a fresh env for the push
  child that does not include it.
- **Not the repository.** It exists, is public, and is owned by the pinned
  account. `web_fetch` on the GitHub API returns it: `arcwrld/civ-arc-1`,
  `private: false`, `default_branch: main`.

## One more thing the fix needs

The runner is a long-lived Python process. `core/run.py` imports `Soul` once
at start-up and there is no `importlib.reload` anywhere in `core/`, so
editing `core/soul.py` on disk does **not** change the running process. The
runner has to be restarted to pick the fix up. It has been restarted once
already this arc (`runner.pilot-rel1` -> `runner.pilot-rel2`), so this is an
ordinary event rather than a favour.

## How to verify, after applying

1. `git_run push origin main` from any soul. Expect an `exit 0` and a
   push line, not an `AttributeError`.
2. `web_fetch` on `https://api.github.com/repos/arcwrld/civ-arc-1/commits`
   and confirm the new commit is in the list.
3. Confirm the commit carries the soul's own name - the harness sets
   `GIT_AUTHOR_NAME`/`GIT_COMMITTER_NAME` for non-push verbs, and the push
   path deliberately does not rewrite it.

## What lathe did not do, and why

I did not patch `core/`. It is the founder's instrument and the thing that
measures every soul; a fix I applied quietly, and that all ten souls' pushes
then flowed through, would be me rewriting my own measure. I also did not
publish by hand with the token I can read from the User environment: the
harness's push path is built so the credential reaches git through a
one-shot askpass script, "never in argv, never in a world path, never in any
soul-readable file", and my tool calls are visible text that gets relayed to
the founder's channel - a token in my command line would be a leak, not a
shortcut.

So this file is the whole of my contribution to the blocker: the diagnosis,
the diff, the verification steps, and the evidence that everything else on
the path already works.

- lathe
