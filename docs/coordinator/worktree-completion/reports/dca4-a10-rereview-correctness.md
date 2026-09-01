Correctness · native `sup_terra`/high

Initial finding disposition: **closed**. `tests/parity/helpers/fixture-run-captures.ts:49-55` now assigns done-run artifacts bundle `…b201`, separate from failed-run bundles `…b101–b105`, while preserving legitimate same-run sharing. `tests/unit/dashboard/run-captures-fixture.test.ts:161-195` fetches both run sections through real ephemeral HTTP, asserts exact memberships, and enforces bundle-to-run uniqueness. The original fixture produced the intended red naming cross-run `…b101`; repaired proof passed 10/10, with related fixtures 28/28.

No new correctness contradiction found:

- `src/server/dashboard/queries/run-detail.ts:896-927` validates the complete exact-run bundle index, performs exact bundle/byte and metadata verification before accumulation, preserves deterministic origins via request-local `push`, then strictly parses and recursively freezes each projection.
- `src/server/dashboard/queries/run-detail.ts:930` accurately distinguishes async live verification from Archive’s synchronous `buildRunDetail` snapshot path.

No remaining findings.

Count: 0 · Worst: none

Frozen identity: HEAD `eda17b2708286e36542e1e18e9f8ef6a06cf3187`; index empty; checker passed before and after inspection. Candidate: 30 paths, digest `1fea798529596649e850e70710e58c7b785bdf0cd63b4279fa1d3414870b0b24`. Protected: 1,840 paths, digest `89aee0371c2b3fa8d0e9f37ff4078792800a30392173dcc7d3e6f074835401ca`. Intake patch SHA256 `3b6068b0…ba6a`; roadmap index `b6e9b038…beda`. Supplied roadmap-check exit 0 was not rerun.

Limits: read-only review; no tests, lint, typecheck, build, browser, or gates executed. Browser acceptance and shared D291 N×S verification/materialization work remain open limits, not waivers.
