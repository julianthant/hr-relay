Tests axis — Count: 0 | Worst: none

Initial findings disposition:

- `tests/unit/dashboard/run-captures-app.test.ts:208` — closed. The test starts a deferred decoder, confirms it remains pending, injects an error on the same mounted image, then resolves decoding and verifies refusal persists. The invalidation-removal mutant failed.
- `tests/unit/dashboard/run-captures-app.test.ts:333` — closed. Tile and preview assertions now compare exact independently authored `(originKind, bundleId)` rows. The origin-rotation mutant failed both cases.

Additional tests are meaningful:

- `tests/unit/dashboard/run-captures-fixture.test.ts:161` exercises the real fixture HTTP routes across two runs, pins exact memberships, rejects cross-run bundle ownership, and permits same-run sharing.
- `tests/unit/server/run-detail-captures.test.ts:164` uses real SQLite and the public query seam to require all 12 ordered origin pairs. The overwrite mutant failed both this and the existing two-origin case.

Frozen identity verified: HEAD `eda17b2708286e36542e1e18e9f8ef6a06cf3187`; empty index; 30-path digest `1fea798529596649e850e70710e58c7b785bdf0cd63b4279fa1d3414870b0b24`; protected-1840 digest `89aee0371c2b3fa8d0e9f37ff4078792800a30392173dcc7d3e6f074835401ca`; intake patch SHA `3b6068b06e867d097d7b34ce80fa4e8bacf264204fa7efbfe86741642330ba6a`; roadmap `3388956a…→b6e9b038…`.

Limits: static read-only review; supplied mutant/restoration receipts assessed but not rerun. DOM/unit closure is not browser acceptance. Browser proof and shared D291 N×S remain open limitations.
