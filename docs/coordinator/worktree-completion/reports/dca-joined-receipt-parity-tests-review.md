# Joined DCA Receipt parity — Tests review

- Native role: `sup_analyst_receipt_parity_tests_review`
- Agent: `01a05891-b6e8-7931-8e3d-446f7bd1f264`
- Mode: read-only, high reasoning
- Reviewed checkout: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`
- Reviewed base: `eda17b2708286e36542e1e18e9f8ef6a06cf3187`

## Findings and closure

The first review found three medium false-green risks and one low tautology: the expected download
bytes shared the fixture server's helper; coarse geometry measured only painted rectangles; the
absence test asserted before React's passive-effect path was quiescent; and one assertion restated
the fixture's own `section` literal.

The parent replaced the shared byte oracle with independently pinned byte lengths and SHA-256
digests for PNG, JPEG and data; removed the fixture-literal assertion; installed an exact refusal
route before absence navigation and crossed two animation frames plus a microtask; and strengthened
coarse geometry to require actual `width >= 44` and `height >= 44`, dense 44px hit ownership,
inactive hit-expanding pseudos and no overlap with any visible document button/link.

The final native return was `STATUS: PASS`: the last 44px-boundary finding was closed at the exact
dimension assertions. The reviewer also confirmed page-local route/deferred-promise isolation and
unique test-output attachment paths. Screenshot files remain direct-review evidence rather than
golden assertions, exactly as the implementation brief requires; semantic/style/geometry assertions
are the red-capable browser gates.

## Limits

No browser or heavy command was run by the reviewer. This return certifies test construction, not
rendered behavior or full-suite acceptance.
