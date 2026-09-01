# Repair20 — AST-owned static a11y inventory

Date: 2026-08-31  
Checkout: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`  
Branch/HEAD: `feature/dca4-archive-evidence` / `eda17b2708286e36542e1e18e9f8ef6a06cf3187`

## Finding and red gate

Repair19's lexical `requiredA11yEvidence(...)` scanner could ignore a real call when a comment or
whitespace separated the identifier and opening parenthesis. A new producer could retain every expected
declaration and add an unexpected comment-separated requirement while the architecture inventory stayed
green.

- The first replacement-shaped control (`72c44e`) was rejected because it also hid an expected name;
  it was not accepted as the target repro.
- The minimized additive control appends a valid test registration containing
  `requiredA11yEvidence /* rationale */ ("unexpected.a11y.yml")` while leaving all expected calls
  unchanged. Chunk `9af9f1` exited `1` with `Missing expected exception`, proving the inventory missed
  the runtime call.

## Smallest repair

- Parse each producer source with TypeScript's own parser.
- Walk actual `CallExpression` nodes whose callee is the exact `requiredA11yEvidence` identifier.
- Require every argument to be a direct `.a11y.yml` string literal.
- Preserve per-name exactly-once checks and compare the complete sorted declaration inventory in both
  directions.
- Extend D132's lesson to name the syntax-tree and comment-separated boundary.

No production runtime, producer declaration, reporter, verifier schema, lock, reference byte, threshold,
browser behavior, or product code changed.

## Green proof

- Minimized AST control, chunk `ca96ca`, exit `0`: selected D132 test passed.
- Complete verifier + D132 gate, chunk `201e82`, exit `0`: 2 files / 46 tests passed.
- Four-path `git diff --check`: exit `0`.

Final SHA-256 values before final re-review:

- verifier: `d08157f683ba1ac2b22300f2fceabc24fe8d988f574b14e00780af89dad57b20`
- verifier test: `e836ab231f4e9083b4be698725a27a765f182648dec92a1a65c0647ef67fdd14`
- AST inventory test: `1283841264e5bd085d0e96b0c2f469037eeda0280226dd2e22715466cc9dfc8a`
- D132 lesson: `d7e94dbf1028b7a202b1a3bb62c3ce7973190b8590001bed28586f68dc9db8d9`

Status: implementation and focused proof complete; final independent Tests/Standards/Correctness review
is required before browser allocation.
