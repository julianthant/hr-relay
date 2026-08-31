# DCC4 m3b — one admitted Explorer read view

2026-08-30 · `sup_sol` · Sol/high · sole writer · no nested agents.

## Scope and pinned state

Assigned worktree: `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc4`.
Branch `feature/r-dcc-dcc4-exclusive`; HEAD `49c6206cbc3d3e30e97603628590823787d120d8`;
MERGE_HEAD `13175b13340fec7b5326207fe54f98078d481d7d`.
Verified starting index tree `e7a9c02ddfacd23c0e0115c31abec8c8f03b2b64`, no unstaged tracked edits.
The existing baseline merge stays uncommitted. Only this unit's explicit paths are staged.
No live HR/state, other checkout writes, protocol/schema/marker change, migration edit or push.
All test authority/files are disposable `mkdtemp` fixtures. Legacy path configuration is guard
data only, as specified in the project profile; no legacy runtime was invoked.

Used `codebase-design refactor --diff` and `tdd` with its complete `good-tests` reference at the
already-confirmed public BFF startup/read and override-store seams. The former kept the change
behind the existing composition/query/store boundary; the latter required the real-I/O red and
negative controls below. Inline diff inspection completed; independent review remains supervisor
owned (`review` contract read, no nested dispatch). No TSX or visual change; `/ui` parity remains later.

## Structural change

- The store's public `readAll()` parses and recursively freezes one complete override document.
  Existing single-workflow command reads and every recovery/durability operation remain unchanged.
- BFF request admission reconciles through the existing command-kernel journal adapter, then
  captures `readAll()` **inside the same authority transaction**. Startup keeps its previous
  recovery-only behavior and failure cleanup boundary.
- The query consumes that view once and resolves every workflow from it. Validation receives the
  same snapshot for both its graph and its revision/presentation basis. No request-local value
  survives into another request; the next request re-admits current authority.
- Existing query/service fixture shapes follow the new public read boundary mechanically;
  no existing assertion was deleted or weakened. Root AGENTS, owner §5.4 and the lessons ledger
  document only this read-path invariant.

Unchanged safety: cold-unlink directory proof, exact previous-plus-command derivation, unjournaled
GET/validate refusal with byte-exact command replay still reachable, fatal partial/divergent boot,
and command-kernel-owned journal/audit observation.

## Red / green evidence

All commands below ran in the assigned absolute workdir, one own gate process at a time.

| Check | Observed result |
|---|---|
| Public GET before production edits, session `85726` | **RED**, 1 failed/12 skipped. Actual `{writeAdmissions:7,directorySyncs:7,documentReads:7}` versus required `{1,1,1}`. Real SQLite/FS operations continued through the instrumentation. |
| First repaired focused run, `85675` | **GREEN**, 4 files/67 tests, exit 0. |
| Expanded GET/validate and immutable-view cases, `93646` | **GREEN**, 2 files/40 tests, exit 0. |
| Negative control: move capture after transaction release, `72458` | **RED**, both boundary cases fail: GET leaks `New directory search` instead of `Recovered people search`; validation returns `conflict` instead of `ready-to-apply`. Restored immediately. |
| Negative control: validation alone rereads the live store, `17479` | **RED**, validation returns `conflict` instead of `ready-to-apply`. Restored immediately. |
| Negative control: remove recursive freeze, command result `722cc1` | **RED**, immutable-view case misses the expected TypeError. Restored immediately. |
| Initial broader run, `25373` | 128 tests passed, but four suites could not collect because `HRAUTO_LEGACY_REPO` was omitted. Not a passing gate. |
| Corrected broader run, `45276` | **GREEN**, 11 files/173 tests, exit 0, 13.75s. |
| Initial scoped lint, `38943` | **RED**, one unbound native-method reference in test instrumentation. No production defect or suppression. |
| First harness-only lint repair attempt, `12195` | **RED**, 2 cases: Vitest's default spy has no `getMockImplementation()` value. Removed that assumption. |
| Final native-descriptor instrumentation, `15035` | **GREEN**, 2 files/40 tests, exit 0; captures the native function as unknown, checks it, and invokes with explicit receiver. |
| Final scoped lint, `79214` | **GREEN**, all seven touched TypeScript paths, exit 0, zero warnings; global light-gate lock held. |
| Final focused run after harness correction, `13940` | **GREEN**, 11 files/173 tests, exit 0, 15.03s. |
| `git diff --check` and `git diff --cached --check` | **GREEN**, exit 0. |

Initial red invocation (test was subsequently generalized to GET/validate):

```sh
VITEST_MAX_WORKERS=1 npx vitest run tests/unit/server/compose-real-port.test.ts -t 'one recovery admission' --maxWorkers=1 --reporter=dot
```

Negative controls used that command with `-t 'keeps the admitted'` and then
`-t 'keeps the admitted validate'`; the freeze control used:

```sh
VITEST_MAX_WORKERS=1 npx vitest run tests/unit/server/explorer-override-store.test.ts -t 'immutable whole-document' --maxWorkers=1 --reporter=dot
```

Final focused test command:

```sh
VITEST_MAX_WORKERS=1 HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npx vitest run tests/unit/server/compose-real-port.test.ts tests/unit/server/explorer-override-store.test.ts tests/unit/server/explorer-edit-service.test.ts tests/unit/server/explorer-query.test.ts tests/unit/server/bff-flow.test.ts tests/unit/command-kernel.test.ts tests/unit/architecture/control-command-single-path.test.ts tests/unit/architecture/workflow-editor-compile-integrity.test.ts tests/unit/architecture/strict-boundary-schemas.test.ts tests/unit/architecture/wire-connectivity.test.ts tests/unit/architecture/migration-history-immutability.test.ts --maxWorkers=1 --reporter=dot
```

Scoped lint command (not a substitute for the deferred full lint):

```sh
/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npx eslint src/server/dashboard/compose.ts src/server/dashboard/queries/explorer.ts src/server/dashboard/commands/explorer-override-store.ts tests/unit/server/compose-real-port.test.ts tests/unit/server/explorer-edit-service.test.ts tests/unit/server/explorer-query.test.ts tests/unit/server/explorer-override-store.test.ts --max-warnings 0
```

New regressions: two per-request I/O cases (GET/validate, two consecutive requests each), two
post-admission transition cases (retain old view, refuse next read, exact replay, observe new
revision), and one public-store recursively immutable snapshot case. No mocks of owned methods,
source-string assertions, timing thresholds, sleeps or cached-value fallbacks were added.

## Freeze / next owner

Full typecheck/lint explicitly deferred until m3c completes; coverage/parity await coordinator
allocation. No commit is authorized. Final scoped gate outcomes and index tree are returned with
the freeze; tree id is not embedded recursively in its own report.

M3c remains separate: reject nonempty Explorer audit dependency effects and consolidate the
kernel's inline journal callback through its existing adapter. Neither was changed here. Supervisor's
later doc-only pass owns the stale v15/ten-family timestamp and `UNPROVEN absence` wording findings.
No other report was edited/staged. Original v19 SQL/registry/released digest paths still match HEAD;
historical broad-envelope compatibility and shared migration-lineage integration remain blocked.

Final m3b change inventory: `AGENTS.md`, `docs/rebuild/reference/{operator-trust,lessons}.md`,
`src/server/dashboard/compose.ts`, `src/server/dashboard/queries/explorer.ts`,
`src/server/dashboard/commands/explorer-override-store.ts`,
`tests/unit/server/{compose-real-port,explorer-override-store,explorer-edit-service,explorer-query}.test.ts`,
and this report. No own gate remains running. No unstaged tracked changes remain at freeze;
the twelve supervisor-only untracked reports are preserved outside this unit's staging.
