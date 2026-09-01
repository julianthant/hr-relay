# DCA4 A4 — UI silent failures

Independent native `sup_terra`, high reasoning; reviewer `01a052ff-40db-71b2-8fbf-14c964689ff7`.
Frozen A4 UI target `41e10b89…350` plus four file hashes at `eda17b27` matched before/after.
Read-only static review; no gates. Reviewer closed.

- `src/dashboard/surfaces/archive.tsx:2162` **medium** — image readiness survives navigation:
  decoded A → B without finishing image load → A reuses ready state and success caption before a
  fresh decode; an earlier unguarded decode can overwrite another capture. Fix: fresh per-image
  generation, reset readiness, guard callbacks, and test A→B→A and deferred stale settlement.

Count: 1 · Worst: medium. Parent verified and accepted. This independently reported finding shares
the correctness repair but retains its own severity/count; no axis deduplication. Backend silent
failure review remains separately zero findings. Browser references are not yet accepted proof.

## Final frozen re-review — closed

Same independent native reviewer verified final `d62a186b…251` plus four A3-repair hashes before/after.
Prior medium finding closed: preview remount and exact mounted-attempt owner prevent stale readiness;
regressions `archive-render.test.ts:507,533` cover A→B→A and old success/rejection. Reviewed refusals,
cancel, decode failures, absent dimensions, focus guards and fixture authority. No gates or browser;
reviewer closed. Remaining Count: 0 · Worst: none · Prior finding closed: 1.
