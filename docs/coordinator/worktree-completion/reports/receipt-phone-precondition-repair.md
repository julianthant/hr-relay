# Receipt phone precondition repair — completion receipt

Status: complete. Writer/light ownership is relinquished on return. No stage, commit, merge,
cleanup, live access, push, browser, parity, build, coverage, or full test gate was run by this
task.

## Scope

Only `tests/parity/run-captures.spec.ts` changed in the approved seam:

- Both coarse-phone Receipt cases now press product `Escape` immediately after `openReceipt` and
  assert exact `Workflow Panel` dialog count `0`.
- Both tile geometry calls now run `tile.scrollIntoViewIfNeeded()` followed by
  `await expect(tile).toBeInViewport()`.
- Existing geometry, contrast, origin, byte, focus, refusal, fixture, URL, timing, viewport,
  reference, screenshot, and case assertions are retained. No `AGENTS.md` update was required:
  this is test-only precondition repair, not a feature/module change.

## Exact identities

| Artifact | SHA-256 |
| --- | --- |
| Source before (permanent baseline) | `fc38171240cce9e478a06e5d65b2011f4f457b71114921d46e9c81078312ea1f` |
| Source after | `02ed46960af6d08f56877b60e0b48d3bef18b0f8550f5e8d84721dd991267526` |
| Isolated patch [`receipt-phone-precondition-repair.patch`](../evidence/receipt-phone-precondition-repair.patch) | `3263cd0409a5d06e6c2c8b34f1a13625803de3428cf643cb550d67cb2182d8a1` |
| Preserved diagnostic-05 red log | `79f072beadd3c22d95b0133f5768a505c892a43dfd97dd984a334847c13e9f0c` |
| Preserved diagnostic-06 manifest | `5a9bd96336ca13cf4ba9f5f88bd1712213be5ad060ac78ceb2ad7626d2014b19` |
| Preserved diagnostic-06 tree | `6fbc15fdd91b7acb8817de348cdd059686ede5ab7c3256385823be78e05b58da` |

Source Git blob identities were `906044ffaa89780c1344d6dca6656fd9293882b9` before and
`3160a9c135b8757cad8fab6c44822eacb1b82fa0` after.

## Red provenance

Preserved evidence: `evidence/dca-joined-receipt-phone-diagnostic-05.log`, terminal exit `1`,
from `/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE npm run test:parity -- tests/parity/run-captures.spec.ts --grep 'coarse phone Receipt'`.
Both coarse-phone cases failed at the pre-existing `expectTargetGeometry` viewport-inside
assertion (`inside: false`). Diagnostic-06 retained the associated 16 copied artifacts; its
manifest records byte-identical source/destination copies.

## Gates

| Command | Exit / result |
| --- | --- |
| `npm run test -- tests/unit/dashboard/run-captures-app.test.ts tests/unit/dashboard/run-captures-lifecycle.test.ts` | `0`; 2 files, 42 tests passed |
| `/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run typecheck` | `0` |
| `/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run lint` | `0` |

## Git receipt

- HEAD unchanged: `eda17b2708286e36542e1e18e9f8ef6a06cf3187`.
- Index unchanged: `git diff --cached --quiet` exit `0`.
- Isolated `git diff --no-index --check` against the reconstructed before source: exit `1`
  because the intended source differs; output was empty (no whitespace diagnostics).
- Current non-coordination status identity: 89 lines, SHA-256
  `a462c47b93feb14b9f0a772ea959f90c07793dd30b4cffe0ea24d29bb805b12f`.
- No unrelated dirty path was staged or reverted; diagnostic-05/06 evidence remains byte-identical.

## Parent verification addendum

The supervisor independently re-ran the affected lane with the profile's mandatory focused-worker
cap and retained direct raw logs:

- `VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dashboard/run-captures-app.test.ts tests/unit/dashboard/run-captures-lifecycle.test.ts`
  — 2 files / 42 tests, exit `0`; `evidence/receipt-phone-precondition-parent-focused.log`.
- Separately globally locked full typecheck — exit `0`;
  `evidence/receipt-phone-precondition-parent-typecheck.log`.
- Separately globally locked full lint — exit `0`;
  `evidence/receipt-phone-precondition-parent-lint.log`.

The parent canonical non-coordination identity recipe (locale-sorted changed path, NUL, file
SHA-256; LF-joined rows; SHA-256 of the aggregate) is 89 paths and
`8ea4aa259a09668bd34309202f2f0327fd5cd5d711c3c23b1bbf376137b72cfb`.
The earlier `a462c47b…` value is the worker's status-line receipt recipe, not this canonical
content-map recipe; the difference is not source drift.

Independent read-only reviews all returned PASS on the exact `02ed4696…` source and `3263cd04…`
patch: Tests `01a058e9-4b25-7323-ab97-272f1a379e83`, UI
`01a058e9-4be6-71a1-83ce-26abed62b4e0`, and Silent failures
`01a058e9-4d02-79a1-9ded-02e66bcd330b`. Each retained the limitation that browser behavior remains
unproved until a newly allocated scoped parity rerun.
