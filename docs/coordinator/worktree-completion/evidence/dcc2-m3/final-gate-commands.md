# DCC2-m3 final gate command / exit ledger

Every command below was run with explicit workdir:
`/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc2`.
All logs are under `docs/coordinator/worktree-completion/evidence/dcc2-m3/`.
Exit codes are collected process outcomes, not inferred from empty/success-looking logs.
Final candidate: `e4ab3837feef579e8462b59e27eb9eb3015d0f65`;
HEAD: `ac40292b8e3e8ff9b66242bbf8f8288554335f40`.

## Focused proof

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npx vitest run tests/unit/preflight-runtime-dependencies.test.ts tests/unit/preflight-dashboard-runners.test.ts tests/unit/server/preflight-runners.test.ts tests/unit/storage-span-authority-reconciliation.test.ts tests/unit/architecture/storage-recovery.test.ts tests/unit/server/bff-flow.test.ts tests/unit/server/bootstrap-storage-arms.test.ts tests/unit/server/bootstrap-start-surface.test.ts tests/unit/server/compose-real-port.test.ts tests/unit/architecture/redaction-surface-scan.test.ts tests/unit/architecture/provider-capability-boundary.test.ts tests/unit/architecture/runtime-environment-coverage.test.ts tests/unit/architecture/strict-boundary-schemas.test.ts tests/unit/server/capture-surface.test.ts tests/unit/server/worker-pool-composition.test.ts tests/unit/server/worker-pool-parallel-proof.test.ts tests/unit/dashboard/preflight-client.test.ts tests/unit/dashboard/settings-status-sections.test.ts tests/unit/storage-summary.test.ts tests/unit/storage-health-notifier.test.ts tests/unit/architecture/wire-connectivity.test.ts tests/unit/architecture/dashboard-wire-boundary.test.ts tests/unit/architecture/descriptor-coverage.test.ts tests/unit/runtime-process-orphans.test.ts tests/unit/storage-diagnostic-redaction.test.ts > docs/coordinator/worktree-completion/evidence/dcc2-m3/focused-final-candidate.log 2>&1
```

Session 63254: **exit 1**, 417 passed / 1 stale intermediate-name expectation failed, 418 total,
25 files. Started 2026-08-30 07:43:29 PDT, duration 67.82s. Production source was already final;
only docs and the exact failed test expectation changed while the run completed.

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npx vitest run tests/unit/architecture/storage-recovery.test.ts > docs/coordinator/worktree-completion/evidence/dcc2-m3/focused-final-followup.log 2>&1
```

Session 78965: **exit 0, 92 passed**, started 07:45:42 PDT, duration 9.64s, on a296aa29.
This reran every storage-recovery case and cleared the sole prior failure.
At that checkpoint: 418 cases / 25 files green by combined proof, including one later-retired
unsupported CLI fixture. Current applicable scope: **417 distinct tests / 25 files green**, with
the final 56-case rerun below; no claim that the first command passed.

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npx vitest run tests/unit/storage-diagnostic-redaction.test.ts > docs/coordinator/worktree-completion/evidence/dcc2-m3/diagnostic-final-green.log 2>&1
```

Session 53117: **exit 0, 57 passed**, 07:43:06 PDT, duration 3.09s. Same final source/tests as
a296aa29 for this file, but its nested-root CLI case was not representable by the public literal
RuntimeIsolation type. It is historical, not final supported CLI proof. Earlier diagnostic-components-green
had 54 tests and is not this proof.
The broad security-standards-green run had **exit 1** despite 89 passing tests (one guard import failed).

## Full checks and resource accounting

```sh
/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run typecheck > docs/coordinator/worktree-completion/evidence/dcc2-m3/typecheck-corrected-final-locked.log 2>&1
```

Session 47589: **exit 0**, started 14:39:23Z, completion collected 14:39:52Z, on 877254ac.
Historical only: later corrections require final-tree typecheck.

```sh
/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run lint > docs/coordinator/worktree-completion/evidence/dcc2-m3/lint-corrected-clean-locked.log 2>&1
```

Session 39534: **exit 75 (QUEUED)** on a85b83f; lock timeout, lint did not run. No spin retry.

```sh
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run lint > docs/coordinator/worktree-completion/evidence/dcc2-m3/lint-final-authorized-locked.log 2>&1
```

Session 70994: **exit 0** on a296aa29, started approximately 14:46:57Z, completion collected
14:47:56Z. This single retry was explicitly authorized after Tests review and focused follow-up
finished. No other own light command overlapped it.

```sh
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run typecheck > docs/coordinator/worktree-completion/evidence/dcc2-m3/typecheck-final-authorized-locked.log 2>&1
```

Session 14850: **exit 2** on a296aa29 (TS2345), started approximately 14:47:57Z, only after lint 0.
Public RuntimeIsolation permits exactly .tracker-rebuild, not the fabricated nested CLI stateRoot.
Test-only repair e4ab3837 uses real literal isolation, retains every valid CLI case and limits nested-root
cases to doctor/browser. No cast or contract widening.

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npx vitest run tests/unit/storage-diagnostic-redaction.test.ts > docs/coordinator/worktree-completion/evidence/dcc2-m3/diagnostic-cli-contract-final.log 2>&1
```

Session 26888: **exit 0, 56/56 passed** on e4ab3837, 07:49:13 PDT, duration 3.72s.
Two supported nested-root cases plus all 18 valid CLI redaction cases. The historical nested-component-red
had 2 supported failures and 1 unsupported CLI fixture failure; no actual supported CLI nested exposure is claimed.

```sh
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run typecheck > docs/coordinator/worktree-completion/evidence/dcc2-m3/typecheck-cli-contract-final-locked.log 2>&1
```

Session 36455: **exit 0** on e4ab3837; completion collected 14:50:07Z. Full current-candidate typecheck.

```sh
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run lint > docs/coordinator/worktree-completion/evidence/dcc2-m3/lint-cli-contract-final-locked.log 2>&1
```

Session 4581: **exit 0** on e4ab3837, started approximately 14:50:18Z, completion collected
14:50:57Z, only after typecheck exited 0. These are normal first attempts on the newly corrected
candidate, as authorized; no queued retry.

Old sessions 75310 (typecheck/PID45909) and 77333 (lint/PID42041): **CANCELED, exit143 each**,
coordinator SIGTERM. They are never counted as successful checks.

## Generated and static checks

Each command ran separately and serially during 14:46:09Z–14:46:13Z on a296aa29:

```sh
npm run build:manifest > docs/coordinator/worktree-completion/evidence/dcc2-m3/final-manifest-generate.log 2>&1
npm run build:manifest:check > docs/coordinator/worktree-completion/evidence/dcc2-m3/final-manifest-check.log 2>&1
npm run roadmap > docs/coordinator/worktree-completion/evidence/dcc2-m3/final-roadmap-generate.log 2>&1
npm run roadmap:check > docs/coordinator/worktree-completion/evidence/dcc2-m3/final-roadmap-check.log 2>&1
git diff --check
git diff --cached --check
```

**Exit 0 for every command.** Generation introduced no unstaged tracked changes; tree stayed a296aa29.

Coverage, parity and browser gates: **not run**, no allocated heavy slot. No commit or push.

## Final current-tree freshness and lane return

```sh
npm run build:manifest:check > docs/coordinator/worktree-completion/evidence/dcc2-m3/manifest-current-candidate-check.log 2>&1
npm run roadmap:check > docs/coordinator/worktree-completion/evidence/dcc2-m3/roadmap-current-candidate-check.log 2>&1
git diff --check
git diff --cached --check
```

Each command **exit 0**, separately/serially, 14:51:15Z–14:51:19Z on e4ab3837.
No generation delta; zero unmerged or unstaged tracked paths. Current-candidate typecheck/lint: exit 0
both. Final diagnostics: 56 passed; valid combined focused/dependent scope: 417 distinct cases / 25 files.
**No owned process remains. Lane returned; source/index frozen.** Heavy gates unrun and unallocated.
