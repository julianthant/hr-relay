# DCA4 A4 — UI tests and backend test re-review

Independent native `sup_luna`, high reasoning; reviewer `01a052ff-4062-7b32-b0ba-4c6d27bbec85`.
UI target `41e10b89…350` and four file hashes matched before/after; repaired backend routes test
`a456e08d…abdc` also matched. Source inspection only; reviewer closed.

- `tests/unit/dashboard/archive-render.test.ts:376` **medium** — `decode()` resolves immediately,
  and no assertion observes a pending decode. A premature ready-on-load implementation passes;
  rejection and zero dimensions are untested. Fix: deferred decode, no success before settlement,
  rejection/zero-dimension regressions.
- `tests/unit/dashboard/archive-render.test.ts:463` **medium** — stale requests settle before the
  current request. Removing the active guard can survive because identity hides old results until
  current overwrites them. Fix: settle current success first, then old success/rejection and verify
  no state/download replacement; repeat close/reopen.

UI Count: 2 · Worst: medium. Parent checked both test shapes and accepts repair in the UI unit.

Backend prior findings separately: malformed raw result now reaches production, and active MIME
is canonically resealed without schema validation. Both addressed by inspection.
Backend remaining Count: 0 · Worst: none; execution/negative-control evidence remains separate.

## Final frozen UI re-review — closed

Same independent native reviewer confirmed both UI findings resolved. Deferred decode and rejection/
zero-size cases (`archive-render.test.ts:470`) prove no premature success; current-first replacement
then obsolete resolve/reject (`:553`) preserves content/download/readiness across navigation/reopen.
Close/Escape still compare the exact opener DOM node; boolean failure reporting does not weaken
identity. Reviewed fixture seals/index/bytes/isolation, foreign IDs, stale decoders, and 11 prepared
browser cases without additional findings. Final `d62a186b…251` and four A3-repair hashes matched
before/after. No gates/browser; reviewer closed. Remaining Count: 0 · Worst: none · UI findings closed: 2.
Parent separately reran all seven focused files / 151 tests and full typecheck/lint, all exit 0.
