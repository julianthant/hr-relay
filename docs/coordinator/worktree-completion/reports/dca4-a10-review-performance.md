# A10 native Performance return (verbatim)

Native task01a052ff-414f-79b3-bc5d-fa871c2457dd; submission01a0555f-4178-7411-aaa5-3aed839606f0; terminal return, closed. Targetd6069d06/candidate25975726. Static structural cost findings, not measured latency.

A10 performance — sup_terra/high. Count: 2. Worst: medium.

- [src/server/dashboard/queries/run-detail.ts:891](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/src/server/dashboard/queries/run-detail.ts:891) | medium | Shared artifacts are deduplicated only after each bundle’s readback reopens and hashes their bytes. For N bundles sharing an S-byte artifact, each initial-detail or lazy-captures request verifies N×S bytes despite returning one artifact. Run bundle count is unbounded. | Preserve every bundle/index/metadata verification, but verify each distinct exact artifact-byte identity once per request. Do not introduce cross-request freshness caching.

- [src/server/dashboard/queries/run-detail.ts:908](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/src/server/dashboard/queries/run-detail.ts:908) | medium | Appending each membership copies all previously collected origins. A legitimate artifact shared by N bundles therefore causes quadratic reference copying and allocation, repeated during both initial availability and lazy reads. | Append into a request-local mutable accumulator, then validate/freeze the completed collection once; retain all origins and metadata-conflict refusal.

Coverage: changed authority I/O and collections, client cancellation, rendering, image ownership, and fixture/collector cleanup. No additional actionable resource-lifetime finding established.

Identity: all 29 candidate hashes matched before/after; HEAD, freeze and complete-delta hashes matched.

Limits: static inspection only; no tests, gates, browser or performance measurements executed. No rendered acceptance claimed. The unchanged D291 materializer finding remains central and is not counted.
