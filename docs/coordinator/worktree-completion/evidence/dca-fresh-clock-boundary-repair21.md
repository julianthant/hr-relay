# Repair21 — parity wrapper clock boundary

Date: 2026-08-31  
Checkout: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`  
Branch/HEAD: `feature/dca4-archive-evidence` / `eda17b2708286e36542e1e18e9f8ef6a06cf3187`

## Finding

The final Repository Standards review found that the new parity JSON wrapper read `Date.now()`
directly. That bypassed the repository-wide `src/domain/clock.ts` boundary even though the value was
used only to prove that the JSON report was fresh for the current run.

## Smallest repair

`scripts/verify-parity-json.ts` now imports `systemClock` and records the freshness boundary with
`systemClock.nowMs()`. No reporter schema, report lifecycle, lock behavior, parity reference, browser
behavior, or product code changed. The existing `clock-single-source` architecture guard is the
regression arm for direct wall-clock reads outside `src/domain/clock.ts`.

## Proof

- Initial narrow invocation, chunk `a5c0d7`, exited `1` before collection because the preserved
  worktree has no default sibling legacy checkout. The failure explicitly required the documented
  `HRAUTO_LEGACY_REPO` override; it is not accepted as code evidence.
- Corrected narrow invocation with
  `HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation`, chunk `a66788`, passed 3 files / 49
  tests, including `clock-single-source`, the wrapper unit suite, and D132's parity authority suite.
- Required lint from the same command completed in chunk `315006`, exit `0`.
- Four-path `git diff --check`: exit `0`.

Final SHA-256 values before re-review:

- verifier: `aff98ac073cd8d9c07b3b6563d715b0686a1a382fa6f160e42cf80ce36c54780`
- verifier test: `e836ab231f4e9083b4be698725a27a765f182648dec92a1a65c0647ef67fdd14`
- AST inventory test: `1283841264e5bd085d0e96b0c2f469037eeda0280226dd2e22715466cc9dfc8a`
- D132 lesson: `d7e94dbf1028b7a202b1a3bb62c3ce7973190b8590001bed28586f68dc9db8d9`

Status: implementation and narrow proof complete; final Repository Standards re-review is required
before browser allocation.
