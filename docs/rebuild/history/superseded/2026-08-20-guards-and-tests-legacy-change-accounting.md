# `legacy-change-accounting` — what the retired guard did (from `reference/guards-and-tests.md` §3.13)

_Superseded 2026-08-05 by **D150**, and folded out of `docs/rebuild/reference/guards-and-tests.md` on 2026-08-20 by the
docs-cohesion rewrite (unit `ref guards-and-tests`). The two repositories now touch each other in
neither direction: the invariant this guard carried — a ported selector or page-state fact going
stale after legacy fixed it — moved to **live re-verification at each workflow's migration**, which
`03c-migrate-the-remaining-workflows.md` makes mandatory and which is strictly stronger than a diff
against legacy's copy. `legacy-selector-port-provenance` is untouched: it reads a FIXED commit's
blobs. `config/legacy-change-accounting.json` remains in the tree as a frozen historical record and
is never extended. This file is the record of what the guard enforced while it existed._

**`legacy-change-accounting` survived D93 and became the program's only drift detector (D94).** The
guard lane resolves `HRAUTO_LEGACY_REPO`, defaulting to sibling `../hr-automation`, and fails loud
if it is absent or not a Git checkout (ratified F1). Mixed-root inventories qualify legacy paths
with `legacy:` while single-root legacy manifests remain unprefixed (F2; ref clock-config-secrets §6). The explicit
Phase-0 commit is verified as an ancestor of legacy `HEAD`; its file/history authority is read
directly from `git ls-tree -r <baselineCommit> -- src tests` rather than resurrecting the retired
preservation cache (F3).

Schema v2 is **commit-centred**: enumerate `baseline..HEAD` in `git rev-list --reverse` order for
legacy `src/` and `tests/`, and require exactly one record for every `(commit,path)` pair. Each
record pins the named commit's first parent, change kind, SHA-256 of the parent blob (null only for
add), SHA-256 of the commit blob (null only for delete), affected capability ids, non-empty impact
rationale, and ids from a closed rebuild-recheck/evidence catalog. Repeated edits and reverts are
therefore visible even when the final tree diff cancels them. Unknown/missing commits, paths,
stale hashes, open/unknown evidence, and duplicate records fail.

A reviewed exact/prefix impact map is an independent minimum: each record's capability ids must
be a superset, with justified extras allowed (F4). Shared daemon runtime/docs/tests affect
`legacy-cli-daemon` plus every workflow registered through the daemon; OCR provider/environment
changes affect `legacy-service-ocr`, the OCR hub and all OCR-backed consumers/delegates. The
legacy `src/`/`tests/` worktree must be clean, including staged and untracked state: **commit the
legacy change first, then account that named commit**. Dirty work intentionally makes rebuild
guards red; in particular, a staged deletion cannot disappear from a working-tree file walk.
Deletion is modeled (`afterSha256: null`) so it is detected, then rejected through initial
cutover. The legacy diagnostic ratchet still rejects new/replaced test-lint fingerprints; rebuild
source/tests retain their zero-debt gates.
