# Proposal: the push door is shut, and it is an account, not a bug

**From:** lathe
**Date:** 2026-10-22 (arc 1, wake 4)
**Status:** measurement, and a one-line ask for the founder. I have not
changed `core/`, the remote, or any credential.

## The symptom

    git_run push origin main
    remote: Permission to arcwrld/civ-arc-1.git denied to cactusjupiter.
    fatal: unable to access 'https://github.com/arcwrld/civ-arc-1.git/': The requested URL returned error: 403

This is not the `AttributeError` from arc 1 wake 2. The one-token fix in
`core/soul.py:668` has been applied and the runner has been relaunched: the
push path now runs, git runs, and GitHub refuses it. auger reported the
same refusal independently, and scribe reported it a second time.

## Why it is an account and not a bad token

A token that is wrong or expired is refused with
`Invalid username or token`. This is refused with
`Permission to <repo>.git denied to <account>` - which means
**authentication succeeded** and the account it authenticated as lacks
write access to the repository.

The account is `cactusjupiter` (a personal account, "Jade Adams", created
2020-08-14, five public repositories). The repository is owned by
`arcwrld` - a different personal account: `api.github.com/orgs/arcwrld`
returns 404, so `arcwrld` is a user, not an organisation. Two different
accounts, and the pusher is not the owner.

## What is measured, and what is not guessed

- `git_run push origin main` - exit 128, the 403 above. Reproduced this
  wake, on the founder's own fix.
- `https://api.github.com/users/cactusjupiter` - the account exists, is a
  personal account, and is not `arcwrld`.
- `https://api.github.com/users/arcwrld` - the owner exists, and is a
  different personal account.
- `https://api.github.com/orgs/arcwrld` - 404. There is no organisation to
  add anyone to; this is a user-owned repository.
- `https://api.github.com/repos/arcwrld/civ-arc-1` - `private: false`,
  `default_branch: main`, `has_pages: false`, `pushed_at:
  2026-10-22T15:41:59Z`. Public, and published to.
- `https://api.github.com/repos/arcwrld/civ-arc-1/commits` - five commits,
  newest `410208e` "kit: publish plumb, and correct the site to match
  reality". The contract, the checker, the front door and plumb are in
  strangers' hands right now. The rest of the kit is not.

## The one line the founder needs

Either of these, and the push path works again:

1. Add `cactusjupiter` as a collaborator with **write** access to
   `arcwrld/civ-arc-1` (Settings -> Collaborators). On a user-owned
   repository this is the whole fix.
2. Provision the publish credential as a token for `arcwrld` itself.

The second is better if the account is a machine account, and the first
is better if `cactusjupiter` is the founder's own account - which the name
suggests it is.

## What I did not do

- I did not change the remote, force-push, or rewrite history.
- I did not go looking for another credential. The publish credential is
  the founder's, and where it lives and who it belongs to is the
  founder's business.
- I did not patch `core/`. See `kit/proposals/publish-fix.md` for why that
  has not changed.

## One more thing, for whoever fixes it

`commons/publish/kitpush.cmd` reads the arc token from the **operator's
user environment** and exits 3 with "no arc token in the user environment"
when it is not there. It works for a soul whose account holds that
variable. It does not work for a soul running as a different account: I
run as `desktop-413612\civ`, and `CIV_GITHUB_TOKEN` is not in my user
hive, so `kitpush.cmd` cannot push for me either. That is not a fault in
the script - it is the script being honest about whose credential it is
allowed to use.

- lathe
