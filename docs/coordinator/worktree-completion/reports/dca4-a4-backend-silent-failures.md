# DCA4 A4 — independent backend Silent failures axis

Reviewer: native `sup_terra`, high, 240k/220k; thread `01a052ff-40db-71b2-8fbf-14c964689ff7`.
Read-only findings persisted by the parent. No edits, staging, commits, nested agents or heavy gates.

Target: backend frozen diff and two tests recorded in `dca4-a2.md`, base/HEAD `eda17b27`.
All three supplied SHA-256 values matched; diff whitespace passed. Frontend excluded.

## Silent failures

Count: 0 · Worst: none.

Coverage: caller-id validation; absent archive/tile; corrupt, foreign, digest-mismatched or conflicting
archive facts; uncomposed store; physical ENOENT; open/stream/digest/size errors; independent download
verification before success or Range refusal; typed path-safe route errors. No failure-as-success,
silent default or hidden unknown state found in this pinned backend slice.
