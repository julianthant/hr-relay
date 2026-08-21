# Cross-repo change accounting (D90/D94) — as written, before D150 retired it

_Superseded by `docs/rebuild/05-cut-over.md` §Phase summary → "The mechanics of the switch, as
designed (D88–D94)", which states what is true now: the accounting is **retired by D150**
(2026-08-05) and the invariant it protected moved to **mandatory live re-verification at each
workflow's migration**. `config/legacy-change-accounting.json` stays in the tree as a frozen
historical record read by nothing. Kept verbatim; never cite as normative._

This was `07-master-plan.md` §4's obligation, carried into `05-cut-over.md` by the 2026-08-20 shelf
split (step 3b) and folded out by the step-5 rewrite on 2026-08-21.

---

**Legacy maintenance continues, accounted cross-repo (D90/D94).** Production fixes and their
matching legacy tests stay allowed. The sequence is mandatory: commit the legacy `src/`/`tests/`
change first, then add schema-v2 records in the rebuild repo for every changed path under that exact
legacy commit. Records bind first-parent/commit blob hashes, affected capability ids (at least the
independent reviewed exact/prefix impact floor), non-empty impact rationale, and closed rebuild
recheck/evidence ids. The guard enumerates the complete commit/path history since the Phase-0
baseline in order and rejects omissions, extras, stale hashes, bad ancestry, or any dirty legacy
`src/`/`tests/` state—including staged and untracked changes. This intentional red interval is the
fail-closed handoff between the two commits, not permission to account an uncommitted tree. The
legacy root `CLAUDE.md` carries the same duty. Verified knowledge is ported by **copy with
provenance** (legacy commit hash + source path), never linked at runtime. Legacy source and tests
cannot be deleted during the rebuild or initial cutover; deletion is representable so the guard
can diagnose it, then always fails.

---

## Why it was retired

**D150 (2026-08-05).** D94's guard required legacy's `src`/`tests` worktree to be **clean**, which
made an unrelated in-flight edit in the PRODUCTION repo a red gate in the rebuild — the wrong
coupling, because the rebuild must never block on what production is doing today. Every workflow is
rebuilt here anyway, so there is no ongoing ledger to reconcile.

**Where the invariant went.** The risk was a ported selector or page-state fact going stale after
legacy fixed it. That moves to **live re-verification at each workflow's migration** — already
mandatory and pre-authorized, and strictly stronger, since a selector checked against the live
system beats one diffed against legacy's copy of it. `legacy-selector-port-provenance` is unaffected:
it pins its keys to a FIXED legacy commit's blobs, so legacy moving on cannot invalidate it.

**What did NOT change.** Copy-with-provenance porting; the ban on importing, invoking, proxying or
reading legacy's live state from `src/`; and the rule that nothing in the legacy repo may be deleted
during the rebuild or the initial cutover.
