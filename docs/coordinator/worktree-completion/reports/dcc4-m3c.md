# DCC4 m3c — exact recovered audit effects

2026-08-30 · `sup_sol` · Sol/high · sequential sole writer · no nested agents.

## Scope / pinned state

Workdir: `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc4`.
Branch `feature/r-dcc-dcc4-exclusive`; HEAD `49c6206cbc3d3e30e97603628590823787d120d8`;
MERGE_HEAD `13175b13340fec7b5326207fe54f98078d481d7d`.
Verified incoming index `5cc07099f7b5fe2e18900f27c86fa6b58feea96d` and no unstaged tracked edits.
Inputs: local `dcc4-review-correctness.md`, `dcc4-review-standards.md`, owner
`docs/rebuild/reference/operator-trust.md` §5.4 and applicable root AGENTS.

Used `/tdd` with `good-tests` at the confirmed public store seam: red before production edits,
then minimum correction and full focused store green. Used `codebase-design refactor --diff`
for the subsequent same-owner callback consolidation under existing kernel/BFF tests. No mocks
of owned methods or private/source-string tests added. No new authority choice or interface.

## Changes

1. `explorer-override-store.ts` refuses a recovered audit whose `affectedDependencyIds` is not
   exactly empty. Its existing strict audit schema already requires the field; there is no default
   for missing/invalid data. Refusal is `ExplorerOverrideStateUncertainError`, naming the audit id
   and `nonempty affectedDependencyIds`, before any claim release or override operation.
2. `command-kernel.ts` ordinary Explorer reconciliation now passes
   `createExplorerCommandJournal(repositories).findOutcome` instead of repeating the two reads.
   Startup/read and ordinary command recovery use the same existing, permitted owner. No new
   journal access path, write, persisted format or protocol arm.
3. The new public-store regression supplies an otherwise exact applied audit with one foreign
   dependency UUID. It asserts the named refusal and byte-identical retained claim and override.
   The existing legitimate multi-edit/empty-vector recovery and durability cases remain unchanged.
4. Root AGENTS and owner §5.4 document only exact dependency effects and the shared reader.
   The supervisor's three stale-doc corrections remain untouched.

## Gate evidence

Every command used the assigned absolute workdir. Focused Vitest always used one worker; no
parallel own gate or long full gate was started.

| Gate | Result |
|---|---|
| New public-store regression before code, command result `5935db` | **RED**, exit 1: `AssertionError: Missing expected exception`; 1 failed, 24 skipped. |
| Complete public-store suite after the five-line refusal, session `14071` | **GREEN**, exit 0: 25 passed, 1 file, 1.20s. Existing legitimate empty-vector recovery passed. |
| Final focused regression/ownership/history gate after callback consolidation, `95307` | **GREEN**, exit 0: 104 passed, 6 files, 9.59s. |
| `git diff --check` | **GREEN**, exit 0. |

```sh
VITEST_MAX_WORKERS=1 npx vitest run tests/unit/server/explorer-override-store.test.ts -t 'recovered audit dependency effects' --maxWorkers=1 --reporter=dot
VITEST_MAX_WORKERS=1 npx vitest run tests/unit/server/explorer-override-store.test.ts --maxWorkers=1 --reporter=dot
VITEST_MAX_WORKERS=1 HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npx vitest run tests/unit/server/explorer-override-store.test.ts tests/unit/command-kernel.test.ts tests/unit/server/compose-real-port.test.ts tests/unit/server/explorer-edit-service.test.ts tests/unit/architecture/control-command-single-path.test.ts tests/unit/architecture/migration-history-immutability.test.ts --maxWorkers=1 --reporter=dot
```

The legacy path supplies guard data only; no legacy runtime or live authority was accessed. Store,
kernel and BFF runtime tests use disposable temporary files/databases.

## Freeze / next owner

Only six paths are staged by this unit: `AGENTS.md`, `docs/rebuild/reference/operator-trust.md`,
`src/core/command-kernel.ts`, `src/server/dashboard/commands/explorer-override-store.ts`,
`tests/unit/server/explorer-override-store.test.ts`, and this report. Final index tree is returned
with the freeze rather than embedded recursively in this artifact. No commit or push.

M3b's compose/query/BFF tests and immutable `readAll()` path remain unchanged; its admission,
snapshot, fresh-next-request and exact replay regressions passed in the final suite. No original
v19 SQL, table/record registry or released digest changes; checked paths still match HEAD.
No previous report edited/staged, no unresolved merge entries or unstaged tracked changes at
freeze, and no own gate remains running.

**Full typecheck/lint and heavy gates were intentionally not run:** the supervisor explicitly owns
those after this freeze. Focused green is not full-gate or integration readiness. Independent
Correctness/Standards verification, the separate doc-only corrections and shared migration-history
disposition remain supervisor/coordinator work; historical broad-envelope compatibility stays blocked.
