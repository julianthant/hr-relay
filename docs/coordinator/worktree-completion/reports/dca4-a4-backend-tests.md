# DCA4 A4 — independent backend Tests axis

Reviewer: native `sup_luna`, high; thread `01a052ff-4062-7b32-b0ba-4c6d27bbec85`.
Read-only results persisted by parent. Frozen backend target in `dca4-a2.md`, base/HEAD `eda17b27`.
Patch hash matched. Reviewer ran the two focused Vitest files (71 passed) and targeted ESLint
(passed), no heavy gates or live access.

## Tests

1. `tests/unit/server/archive-capture-routes.test.ts:197` **medium** — malformed row is parsed inside
   the injected lookup callback, so the production strict parse is not tested. Fix: pass raw malformed
   boundary input and assert production corruption classification/redaction and zero opens.
2. `tests/unit/server/archive-capture-routes.test.ts:205` **medium** — the active-media-type case also
   invalidates the sealed content digest, so it cannot independently prove the media-type veto.
   Fix: construct a digest-consistent malformed media record at the injection seam; show the intended
   validation is what prevents byte access, including a red-capable control.

Count: 2 · Worst: medium. Parent verified both cited locations against the pinned diff.

Other coverage reviewed: identity, malformed caller ids, digest mismatch, duplicate references,
missing/corrupt bytes, headers, Range ordering, unavailable composition and capture-host isolation.

Disposition: OPEN, queued as a test-only follow-up after the sole UI writer stops. No production
backend change requested by this review. Required gates and commits remain pending.
# Final focused re-review — findings closed

2026-08-30, same independent native `sup_luna` reviewer, high reasoning. Final route-test hash
`e0d7d28094586d8adcebc5612820d5d3da8ccffb60badfca6b06a5eb55092a30`, HEAD `eda17b27` verified;
query/domain restoration hashes matched. Reviewer closed without executing gates.

Both prior findings closed: raw malformed data reaches production (`:218`), and altered MIME is
independently resealed (`:229`). Each negative control recorded exactly its two intended HTTP
`200 !== 500` failures. Four new capability-precedence cases (`:173`) cover both routes × malformed
run/artifact IDs, with no-store 409 and zero authority/byte access; composed counterparts retain 400.
Worker evidence: restored 71 then final 75 tests passed, own-file lint 0.

Remaining Count: 0 · Worst: none · Prior findings closed: 2. UI findings remain separate.
