### SPEC

No remaining findings. D292 implementation scope remains satisfied.

Count: 0 · Worst: none

### Owning-doc consistency

`docs/rebuild/reference/frontend-backend-integration.md:981 | medium | The wiring matrix still calls captures declared-unserved; line 985 also says “captures no” because no artifact-byte route exists. This contradicts D292, readRunDetail, the mounted Receipt consumer, and /artifacts/v1/:artifactId. | Update both matrix rows to describe verified asynchronous captures and the served byte route, while retaining the unserved generic resource-status/gallery and pending browser/full-gate limits.`

Count: 1 · Worst: medium  
Total: 1 · Worst: medium

Initial finding disposition:

- Original stale summaries at current lines 511–519 and 1304–1320: closed.
- Supplemental dashboard summaries at `dashboard-surfaces.md:2937–2945,3983`: closed.
- False descriptor-free comment: closed at `run-detail.ts:930`.
- The matrix contradiction above remains.

Frozen identity rechecked after inspection:

- HEAD `eda17b2708286e36542e1e18e9f8ef6a06cf3187`; index empty.
- 30 candidates: `1fea798529596649e850e70710e58c7b785bdf0cd63b4279fa1d3414870b0b24`.
- 1,840 protected paths: `89aee0371c2b3fa8d0e9f37ff4078792800a30392173dcc7d3e6f074835401ca`.
- Intake patch: `3b6068b06e867d097d7b34ce80fa4e8bacf264204fa7efbfe86741642330ba6a`.
- Generated roadmap: `3388956a… → b6e9b038…`; recorded freshness check passed.

Limits: no edits, delegation, tests, lint, typecheck, build, browser, or gates. Static UI review used live WIG. Browser acceptance, full gates, and D291 repeated N×S byte verification remain open. Generic resource-status/gallery remains intentionally unserved.
