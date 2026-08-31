# sup_sol_dcc1_f2_recovery — prepared Settings authority recovery

Date: 2026-08-30. STATUS: complete for the assigned F2 seam; no merge/commit claim.
ROLE: sup_sol execution, sequential. MODEL: gpt-5.6-sol (assigned). REASONING: high.
SCOUTS: none. COMMITS: none, per dispatch; four explicit owned paths staged for the parent.

## Scope and authorities

Every command ran in `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1`; every edit stayed
there. Used the complete supervise dispatch rules, debug, hr-debug plus the worktree's internal
wrapper, and TDD/good-tests at the explicitly assigned composition/recovery seam. Read root
AGENTS (the nearest applicable file), the exact root project profile and `briefs/dcc1.md`, and
the Settings owner in `reference/clock-config-secrets` §3. Remained an execution unit: no nested
dispatch, new worktree, board edit, live authority/HR operation, migration change, or D75 change.

## Exact state

| Identity | Value |
| --- | --- |
| Branch | `feature/r-dcc-dcc1-exclusive` |
| HEAD, unchanged | `0c115123a738f62cbe01c9b45f53b7289284479c` |
| MERGE_HEAD, unchanged | `13175b13340fec7b5326207fe54f98078d481d7d` |
| Intake staged tree, verified | `1a4eba98436b7321b9055a7da8a6cfb226ab6a50` |
| F2 source/tests/AGENTS staged tree, before adding this report | `4989b602a92f395ae75bfed211704202a11806a0` |
| Parent unstaged patch blob hash (`git diff --binary \| git hash-object --stdin`) | `5d8101de620ff1a36d2c2085aa56ad4c99062e7d` |

The final returned tree adds only this report to the source tree above; its self-referential hash
is intentionally reported in the return message. Gates ran on the **working tree**, including the
parent's unstaged patch, not on the staged tree alone. In particular the parent's unused
`CommandIdSchema` import removal in `src/core/command-kernel.ts` remains unstaged and matters to
lint. This report does not certify a commit made without that parent change.

| Owned file | Final source blob / change |
| --- | --- |
| `src/server/settings-runtime.ts` | `a6748a08a210385049574c46cc9d9424a39cdea6` — classify audit-only evidence as requiring exact committed proof |
| `tests/unit/server/compose-real-port.test.ts` | `e5cf338f17b9588412026ca80075e120f998fc10` — six mixed-presence cases and public runtime revision readback |
| `AGENTS.md` | `7474548f0004a23b4f5f138bf501a8cec72decac` — add prepared-recovery invariant to the dated Settings lesson |
| `docs/coordinator/worktree-completion/reports/dcc1-f2.md` | This unique proof report |

The source tree delta from intake is exactly three files, 124 insertions / 4 deletions. No
descriptor closure changed. No manifest regeneration, heavy coverage, or parity was attempted.

## Red → green and cause

Baseline command (exit 1, 17 passed / 1 failed):

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/server/compose-real-port.test.ts
```

Failure: `keeps an applied revision restart-required until a dashboard restart activates it` →
`Error: no such column: singleton_id` at `readRuntimeSettingsRevision`. Replaced its guessed SQL
with `AuthorityDatabase.open(...).authority.runtimeConfig.get()` and a mandatory active-row
assertion. The original revision-1-before-restart / revision-2-after-restart assertions remain.

Recovery red command, before the production fix (exit 1, 1 failed / 1 passed / 17 skipped):

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/server/compose-real-port.test.ts -t 'only its audit|restart-required until'
```

Failure: `retains exact prepared settings evidence when only its audit is present` →
`AssertionError: Missing expected exception.` The helper repair passed in the same run.
The hypotheses were audit presence ignored, audit lookup unable to see the injected row, or
reconciliation swallowing the refusal. Public audit readback proved the row visible; adding only
audit presence to the branch made the same two tests pass (exit 0, 2 passed / 17 skipped).

Cause: `resolvePreparedSettings` selected rollback from command/current absence without observing
the command's audit. The fix reads that audit by exact command id and treats **any** next-command
evidence as requiring `requireJournaledSettings(prepared.next, repositories)` before settlement.
That existing full command/hash/audit/current validator is unchanged. With no next-command
evidence, the prior record must still pass the same validator before rollback. Duplicate
read-snapshot optimization is intentionally untouched.

## Complete presence matrix

All six mixed rows use the real public `readJournaledSettings` entry used by dashboard/worker
composition, real SQLite repositories, and the real filesystem prepare/recovery implementation.
The fixture SIGKILLs its own settings writer just after the live rename, then injects missing
rows in its temporary, already-open DB. This is deliberate: a fresh DB open rejects dangling
foreign keys before reaching the recovery bug. Only this test-owned connection disables FK
enforcement; no schema, trigger, migration, or live database is changed. Normal success arms
remain tested through full `composeDashboardRuntime` boot, not a stubbed resolver.

| Command | Audit | Current for prepared command | Expected / observed |
| --- | --- | --- | --- |
| absent | absent | absent | Existing `rolls back a prepared settings rename whose command transaction never committed`: rollback, live settings and prepare absent |
| absent | absent | present | Missing named command journal; exact evidence retained |
| absent | present | absent | Missing named command journal; exact evidence retained (original bug) |
| absent | present | present | Missing named command journal; exact evidence retained |
| present | absent | absent | Missing named durable audit; exact evidence retained |
| present | absent | present | Missing named durable audit; exact evidence retained |
| present | present | absent | Not the exact canonical current settings result; exact evidence retained |
| present | present | present | Existing `keeps exact prepared settings only after their command, audit, and current result committed`: exact next bytes retained, prepare removed |

Every mixed row checks the fixture's actual presence vector before recovery, then performs two
recovery attempts. Each must fail with the specific missing-fact message and retain byte-exact
settings, prepare and initialization files, identical command/audit/current records and authority
metadata, and no rollback artifact. Existing full-envelope/audit corruption cases remain green.

## Mutation proofs

Both mutations ran this exact command:

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/server/compose-real-port.test.ts -t 'retains exact prepared settings evidence'
```

| Deliberate mutation | Result |
| --- | --- |
| Remove pre-settlement `requireJournaledSettings(prepared.next, repositories)` while retaining final readback validation | Exit 1: **6 failed / 18 skipped**. Each refusal occurred too late; retained-prepare read failed with `ENOENT ... settings.json.prepare.json`. Thus merely throwing after evidence deletion cannot satisfy the tests. |
| Restore the exact original production blob `67d23bc2ef8de5c27954e87e85281caf015f3814` (verified by `git hash-object`) | Exit 1: **1 failed / 5 passed / 18 skipped**. Audit-only case again reports `Missing expected exception`. |

Both mutations were removed. `rg` found no `[DEBUG-dcc1-f2]` instrumentation in the owned code/tests.

## Acceptance gate evidence

Final composition-file run: exit 0, **24 passed (24)**, 6.63 s.
After restoring both mutations, the full requested focused command was:

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/config.test.ts tests/unit/command-kernel.test.ts tests/unit/settings-file-service.test.ts tests/unit/worker-composition.test.ts tests/unit/server/bff-flow.test.ts tests/unit/server/compose-real-port.test.ts tests/unit/sqlite-authority-database.test.ts tests/unit/run-authority.test.ts
```

```text
Test Files  8 passed (8)
     Tests  236 passed (236)
Start at  07:43:13
Duration  23.87s
exit 0
```

| Final command | Evidence |
| --- | --- |
| `/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run typecheck` | Waited for admission, then `tsc --noEmit`; exit 0, no diagnostics |
| `/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run lint` | `eslint src tests scripts --max-warnings 0`; exit 0, no diagnostics |
| `git diff --check` | Exit 0 |
| `git diff --cached --check` | Exit 0 |
| `git ls-files --unmerged` | Empty |

One gate process at a time; all tracked gate sessions exited. Crash children were synchronous,
their SIGKILL outcomes asserted, and temporary DB/file resources cleaned by the suite. No task
process remains running. No heavy gate was allocated or run.

## Preservation / review handback

Preserved the parent's unstaged six docs (`01`, `02`, `03c`, `03d-co-operate-with-claude`, `04`,
`reference/operator-trust`) and `src/core/command-kernel.ts`. The latter's worktree blob is
`0c1f88bac2391f417e91570920d05360f36d531f`. All seven stayed unstaged. Preserved all pre-existing
staged merge content and untracked reports (`dcc1-m1`, `dcc1-m2`, `dcc1-migrations`,
`dcc1-review-candidate`, `dcc1-review-security-original`, `dcc1-review-tests-original`) plus the
parent-created `dcc1.md` in-progress ledger. No blanket stage, reset, clean, commit, or push.

REVIEW-HINT: review the three-source presence gate and the fact that validation must precede
file settlement. The temporary corruption harness intentionally bypasses only FK admission so
the real recovery seam, not an earlier DB-integrity check, is falsified. Parent retains independent
review, full merge gates, commit authority, and all open migration/D75 decisions.
