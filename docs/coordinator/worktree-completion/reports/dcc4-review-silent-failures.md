# DCC4 independent Silent-failures review

Reviewer `sup_terra`, agent `01a0530e-50cc-7083-a69e-e0447bb54646`, high, read-only.
Target tree `c6ee685216ddba8fa604fc145346c05fa5889bb6`; baseline `13175b13`.
Scope: eight store/historical-schema/test paths; startup/core wiring excluded until follow-up.

`src/server/dashboard/commands/explorer-override-store.ts:688` **high** — successful claim unlink
followed by failed directory fsync loses its marker; a new store sees no claim and returns without
retrying/proving durable deletion. Fix: require directory fsync and absence readback before accepting
no-claim recovery, using the existing durability protocol.

`tests/unit/server/explorer-override-store.test.ts:128` **medium** — current regression injects
directory failure before release, not during the unlink's directory fsync. Add a reopen/retry case
that refuses while that barrier fails and succeeds only once it is proved.

Count: 2 · Worst: high. Supervisor verified releaseClaim/removeAndSyncDirectory and no-claim
reconcilePending directly, then assigned this same public-store seam repair. Not yet closed.
No gates, mutation, live DB or browser by reviewer. Other tests were judged failure-capable for
their named cases; no mock-theater finding. Historical v19 digest remained unchanged.

## Independent follow-up — e7a9c02ddfacd23c0e0115c31abec8c8f03b2b64

Same reviewer: original **high CLOSED** and associated **medium test gap CLOSED**.
Count: 0 · Worst: none. Store line321 `proveClaimAbsence()` fsyncs the directory and checks
absence again; finalization and cold reconciliation both call it before success. Test line199
asserts real unlink, then repeated failed absence fsync after a new store instance; it asserts
no restore/marker/write is attempted, so there is no untested restoration failure branch.
Success requires the durability barrier to recover. The appearing-claim case preserves that evidence.

Startup/core/API also independently inspected: only unjournaled replay-eligible pending state is
tolerated at boot; partial/divergent states fail before bind; GET/validation recheck admission;
exact replay reads journal/audit before insertion. Composed tests cover exact/partial/divergent,
foreign result, wrong revision, missing/damaged bytes. Dormant v19 remains pinned without retired
envelope-compatibility claims. No remaining Silent-failure finding. Reviewer ran no gates;
supervisor separately reran 77 tests across five relevant files, all passed, then locked lint passed.

## Independent final follow-up — 202a63983e4c843e426a5db1d8851a0fb2b33bc7

`sup_terra`, agent `01a0532b-18bc-7542-acbd-9c9f6c665e9d`, high/read-only.
Count: 0 · Worst: none. The original unlink/fsync HIGH remains CLOSED on this final delta:
proveClaimAbsence (store324–350) still refuses a failed cold absence barrier. Nonempty recovered
affectedDependencyIds refuses at store723. Composition1025 captures the frozen document within
the authority transaction; later requests re-admit. No cache, marker, alternate protocol or silent
fallback introduced. Reviewer ran no gates and made no edits.
