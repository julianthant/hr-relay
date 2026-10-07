# Current codebase structure

This is the canonical map of the 2026-10-01 candidate tree, amended 2026-10-02. It describes
checked-in implementation homes and dependency direction; phase-plan acceptance and final test
accounting remain with their owners. Older path diagrams and source-pinned excerpts retain their
original revision names.

## Repository and script folders

| Path | Ownership |
| --- | --- |
| `.agents/`, `.claude/` | Repository-local agent instructions and skill references. |
| `config/` | Active runtime isolation and shared test-data configuration; the example is tracked and private local input remains ignored. |
| `dist/` | Generated dashboard build output. |
| `docs/` | Roadmap, plans, references, workflow migrations, sanitized evidence, guides and preserved history. |
| `duo-autopilot/` | Duo Autopilot browser support and operator guide. |
| `node_modules/` | Local installed dependencies. |
| `scripts/build/` | Workflow manifest generation and checks. |
| `scripts/dev/` | Local dashboard and CLI environment entrypoints. |
| `scripts/docs/` | Roadmap and store-catalog generators and their parsers. |
| `scripts/test/` | Test runner, scoping and suite policy. |
| `scripts/verify/` | Browser-login and test-target validation. |
| `src/` | Application source (current directory map below). |
| `tests/` | Current unit, integration, architecture, support, performance and type-checking tree. |

There is no root `generated/`, `evidence/`, or `test-results/` folder. Generated files remain at
their owning paths, such as the workflow manifest and store-catalog reference section. The retired
UI-catalog generator and selector-search CLI are absent. Current commands live in root `AGENTS.md`.
`tests/scenario/` remains retired. The operator reinstated desktop parity on 2026-10-07 as the
presentation-freeze check. Brief 1 retains the named specs and support only; full visual closure
belongs to a later convergence brief and is not established here.

## Source tree and ownership

```text
src/
├── backend/{app,logs,processing,runs,runtime,storage,systems,transports}/
├── dashboard/{app,client,ds,kit,lib,logs-preview,public,state,surfaces}/
├── models/{archive,artifacts,config,dashboard,events,failures,fields,intake,notifications,ocr,preflight,processing,providers,run,runtime,sessions,systems,task,trust,ui,validation,workflow,workflows,write-safety}/
├── rules/{commands,identity,intake,kronos,matching,normalization,notifications,preflight,providers,redaction,runs,separations,sessions,time,validation,workflow,write-safety}/
├── workflow-kit/{artifacts,diagnostics,duo-ceremony-lease,errors,flow,intake-parser,mutation-capability,
│                 provider-accounting,providers,session,task-registry,task,workflow-definition,workflow}.ts
├── workflow-kit/validation/
└── workflows/{person-lookup,separations}/
```

The listed workflow-kit modules sit at the package root; `validation/` is its only subdirectory.
Each workflow owns `workflow.ts`, `task-registry.ts` and, where needed, `tasks/`. Separations also
owns `steps/<role>/step.ts` for its five retained chunk harnesses.

| Path | Ownership |
| --- | --- |
| `src/cli.ts` | Thin CLI command entry point. |
| `src/backend/app/` | `bootstrap/`, `composition/`, `config/`, `dry-run/`, `host/`, `preflight/`, `registries/` and `test-data/` compose application entrypoints. `config/runtime-isolation.ts` owns the existing frozen values; `registries/` owns task/workflow/test-target registration and retained step-proof modules. |
| `src/backend/logs/` | `diagnostics/` and `trust/` plus root modules for span emission, observed data, generated-artifact projection, confirmed action/fact publication and declared step results (`confirmed-actions.ts`, `confirmed-invocation.ts`, `confirmed-action-publisher.ts`, `confirmed-submit.ts`, `declared-step-result.ts`), and post-settlement raw-note draining (`browser-action-drain.ts`). Persisted worker-stream transport remains Phase 4. |
| `src/backend/processing/` | `extraction/`, `normalization/`, `ocr/`, `providers/`, `roster/` and `spreadsheet/`; task families register through `task-registry.ts`. |
| `src/backend/runs/` | `archive/`, `commands/`, `explain/`, `exports/`, `lifecycle/`, `notifications/`, `projections/`, `provenance/`, `queries/`, `recovery/`, `settings/`, `start/` and `trust/`; `activity-person-pseudonym-backfill/` remains a dedicated owner; `lifecycle/archive-terminal-runs.ts` owns manual terminal saved-report archiving. |
| `src/backend/runtime/` | `browser/`, `checkpoints/`, `execution/`, `gates/`, `policies/`, `preflight/`, `scheduling/`, `settings/`, `workers/` and `writes/` own runtime execution and safety; `workers/` composes the confirmed-action publisher lifetime. |
| `src/backend/storage/` | `admission/`, `archive/`, `artifacts/`, `compatibility/`, `configuration/`, `events/`, `maintenance/` and `sqlite/` own database and persistence adapters. |
| `src/backend/systems/` | Browser-system drivers, semantic registries and task implementations. `ui-task-links.ts` (`buildUiTaskLinks`) derives Explorer task attribution from retained registries. |
| `src/backend/transports/` | CLI and dashboard HTTP/SSE transports and route schemas. |
| `src/dashboard/` | Renderer app, client, state, design system, shared UI kit and product surfaces. It does not import backend task implementations. `logs-preview/` is a frontend preview, not an API. |
| `src/models/` | Shared schemas and model shapes, including task contracts, UI vocabulary, workflow data, runtime/API models and schema-bound validation; `events/confirmed-action.ts` owns the v1 confirmed-event and declared-step-result schemas. `config/define-runtime-isolation.ts` owns the pure isolation shape/type, and `fields/` owns the canonical field inventory and registry. There is no `models/logs/` package. |
| `src/rules/` | Reusable pure decisions and validation rules; `runs/` contains the four ledger modules: ledger primitives, ledger projection, ledger and summary derivation. |
| `src/workflow-kit/` | Root-level TypeScript modules provide browser-safe workflow/task authoring, compilation and factories; `validation/` contains validation and path derivation. `compileWorkflow` lives in `workflow-definition.ts`; there is no separate `execution-context/` or `compilation/` folder. `validation/source-layout.ts` derives workflow and potential scenario paths from role. The generated workflow manifest lives at `validation/generated-build-manifest.ts`. |
| `src/workflows/<id>/workflow.ts` | Browser-safe operator workflow definition and composition entry. Its value-import closure must not reach backend implementations. |
| `src/workflows/separations/steps/<role>/step.ts` | Browser-safe chunk-harness definition for its declared timeline step; the five role folders are `identity-check`, `kronos-timecard`, `kuali-extraction`, `kuali-finalization` and `ucpath-transaction`. Each step harness imports its identities from the composition. `source-layout.ts` derives workflow and future scenario locations from role; scenario suites are not present in this tree. |
| `src/workflows/<id>/task-registry.ts` and `tasks/` | Backend-loaded workflow-specific task implementations composed by the backend registry. Renderer and lower-level packages must not import them. |

System and processing implementations register beside their owning family in `task-registry.ts`;
workflow-specific tasks register beside their workflow. `RegisteredTaskStore`, factory behavior,
task IDs, namespace IDs, and execution/write semantics retain their existing contract. The
registration filename `task-registry.ts` replaces the former `store.ts` convention.

The layering rule is directional: renderer code consumes browser-safe models and workflow
definitions; backend composition may load definitions and task registries; the operator composition
and chunk-harness definitions may use shared models/rules/workflow-kit but never implementation
tasks. Renderer and lower-level modules do not import workflow implementations. These source moves
retain runtime workflow IDs and the existing task/store namespace semantics.

## Tests, support and evidence

The reviewed architecture owner map is:

```text
tests/
├── architecture/{app,dashboard,logs,models,processing,runs,runtime,storage,support,systems,tooling,workflow-kit}/
├── integration/
│   ├── backend/{app,logs,processing,runs,runtime,storage,systems,transports}/
│   ├── dashboard/{app,client,state,surfaces}/
│   ├── tooling/{dashboard-launcher,scripts,test-runner,workflow-builder}/
│   └── workflows/separations/
├── parity/
├── perf/
├── support/
│   ├── fixtures/{dashboard,documents,dry-run,integration,migration,preflight}/
│   ├── helpers/{architecture,archive-transfer,backend,dashboard,database-foundation,failure-resolution,integration,storage,trust}/
│   └── processes/
├── types/
└── unit/
    ├── backend/{app,logs,processing,runs,runtime,storage,systems,transports}/
    ├── dashboard/{app,client,ds,lib,state,surfaces}/
    └── {models,rules,tooling,workflow-kit,workflows}/
```

Architecture fixtures/helpers are colocated under dashboard, logs, models, runs, runtime, storage,
support, systems and tooling owners. Unit and integration tests follow the same source-family split
as production code. Shared fixtures, helpers and child-process entrypoints stay under
`tests/support/`. `scenario/` remains retired. `parity/queue-authority.spec.ts` is retained under
the operator's desktop parity reinstatement; Brief 1 retains named specs and support, without
establishing an executable parity suite or visual acceptance. Full visual closure belongs to a later
convergence brief. Role-derived path helpers do not imply current files or coverage. Exact test move
counts and retirement dispositions remain with the final test ledger and its independent audit.

Selector fixtures and live selector evidence now live under `docs/rebuild/evidence/selectors/`;
retained semantic registries name the evidence they use, and verification/proof readers consume
those paths. Legacy migration/provenance inventories now live under
`docs/rebuild/migrations/legacy/`; architecture and migration tests read those checked-in inputs
through their updated paths. Both relocations preserve payload bytes. These are checked-in
verification, configuration and provenance inputs; operator runtime state remains separate. The
ignored `config/test-data.local.json` remains private local test input.

## Deferred work and evidence

Phase 3 added the confirmed action/step v1 API, strict event and result schemas, and a worker-local
bounded publisher in their existing `backend/logs/`, `models/events/` and worker owners. Persisted
ordered worker streaming and its read/replay adapters remain Phase 4. The frontend Logs connection,
step-result presentation and capture association remain Phase 5; the v1 event carries no screenshot
artifact. There is no `models/logs/` package. A desktop/Electron shell remains future work and has no
placeholder folder.

The accepted layout-polish candidate freeze hash is `a65ca56206aa238124e379b44f1ecb941fe17660abdffeaa24be2a6a50ab421f`.
Implementation maps are pinned to entry `7e237bd7c3d0a45952e38c49f6d9be75057d08ef` under
[`implementation/`](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/backend-layout-polish/implementation/).
[`source-map.json`](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/backend-layout-polish/implementation/source-map.json)
records 514 source moves and six retirements (SHA-256
`202bf3401246368988c7a9ba08c53d546869a89cb040f6750a27c1d887b9ccbe`).
[`tooling-map.json`](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/backend-layout-polish/implementation/tooling-map.json)
records 39 moves and seven retirements with pre/post byte proofs. The architecture owner map
[`architecture-owner-delta.json`](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/backend-layout-polish/implementation/architecture-owner-delta.json)
organizes 147 architecture files (86 guards, 16 helpers, 45 fixtures) by owner. [`test-map.json`](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/backend-layout-polish/implementation/test-map.json)
records the test moves. The corrected
[`test-map-final.json`](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/backend-layout-polish/implementation/test-map-final.json)
records 619 current test sources, 5,954 literal callbacks (2,292 unit, 2,928 integration, 734
architecture), and 2,478 expanded unit cases; 5,952 baseline cases are retained or adapted, two are
new, and 408 are retired, including 49 UI-catalog cases. Its
[correction receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/backend-layout-polish/implementation/test-map-final-correction-receipt.json)
records the final ledger corrections. These maps do not claim phase acceptance or visual refreeze;
the owning plan retains those gates. The Explorer's scenario source links remain unresolved, and
changes requiring scenario compile evidence are blocked; absent rehearsal manifests report
unavailable before execution. See the current amendments in
[operator trust](operator-trust.md#scenario-and-parity-test-retirement-amendment--operator-approved-2026-10-02)
and [guards and tests](guards-and-tests.md#scenario-and-parity-suite-retirement--2026-10-02).
