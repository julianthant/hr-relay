# Current codebase structure

This is the canonical map of the current checked-in implementation homes and dependency direction.
The assigned brief owns acceptance and final test accounting.

## Repository and script folders

| Path | Ownership |
| --- | --- |
| `AGENTS.md` | Root working instructions; nearer `AGENTS.md` files own backend, registry, system and dashboard constraints. There are no `CLAUDE.md` instruction files. |
| `LICENSE` | MIT License, copyright 2026 julianthant. |
| `.agents/`, `.claude/` | Repository-local skills and operating references. |
| `config/` | Active runtime isolation and shared test-data configuration; the example is tracked and private local input remains ignored. |
| `dist/` | Generated dashboard build output. |
| `docs/` | Current entrypoint and reference contracts, sanitized selector evidence, authoring guide and reviewed guard inventory. |
| `duo-autopilot/` | Duo signing with a backend-provisioned session credential; browser verification uses `scripts/verify/browser-login.ts`. |
| `node_modules/` | Local installed dependencies. |
| `scripts/build/` | Workflow manifest generation and checks. |
| `scripts/dev/` | Local dashboard and CLI environment entrypoints. |
| `scripts/docs/` | Store-catalog generator; roadmap generation and its parser/scanner/schema modules are absent. |
| `scripts/test/` | Test runner, scoping and suite policy. |
| `scripts/verify/` | Browser-login and test-target validation. |
| `src/` | Application source (current directory map below). |
| `tests/` | Current unit, integration, architecture, support, performance and type-checking tree. |

Root `generated/` and `evidence/` folders are absent; ignored runner output is disposable. Generated files remain at
their owning paths, such as the workflow manifest and store-catalog reference section. The retired
UI-catalog generator and selector-search CLI are absent. Current commands live in root `AGENTS.md`.
`tests/scenario/` remains retired. `tests/parity/` and `npm run test:parity` retain the desktop
presentation-freeze contract. This map does not establish a gate result.

The roadmap site, planning/history/findings/status/handoff folders and decision log are absent:
`docs/roadmap/`, `docs/rebuild/plans/`, `docs/rebuild/history/`, `docs/rebuild/findings/`,
`docs/status/`, `docs/handoffs/`, `docs/decisions/` and `docs/rebuild/reference/decisions.md`.
`scripts/docs/generate-roadmap.ts`, `scripts/docs/roadmap/`, the `roadmap` / `roadmap:check` package
scripts, the roadmap binding guard and its fixtures, and the generated-site interaction test are
also absent: `tests/architecture/tooling/roadmap-doc-binding.test.ts`,
`tests/architecture/tooling/fixtures/roadmap-binding/` and
`tests/unit/tooling/roadmap/roadmap-ui.test.ts`. Briefs, task receipts and retained worktree evidence live in the gitignored `.work/` folder.

## Source tree and ownership

```text
src/
├── backend/{app,logs,processing,runs,runtime,storage,systems,transports}/
├── dashboard/{app,client,ds,kit,lib,logs-preview,public,state,surfaces}/
├── models/{artifacts,config,dashboard,events,failures,fields,intake,notifications,ocr,preflight,processing,providers,run,runtime,sessions,systems,task,trust,ui,validation,workflow,workflows,write-safety}/
├── rules/{commands,identity,intake,kronos,matching,normalization,notifications,preflight,redaction,runs,separations,sessions,time,validation,workflow,write-safety}/
├── workflow-kit/{artifacts,diagnostics,duo-ceremony-lease,errors,flow,intake-parser,mutation-capability,
│                 providers,session,task-registry,task,workflow-definition,workflow}.ts
├── workflow-kit/validation/
└── workflows/{person-lookup,separations}/
```

The listed workflow-kit modules sit at the package root; `validation/` is its only subdirectory.
Each workflow owns `workflow.ts`, `task-registry.ts` and, where needed, `tasks/`. Separations also
owns `steps/<role>/step.ts` for its five retained chunk harnesses.

| Path | Ownership |
| --- | --- |
| `src/cli.ts` | Thin CLI command entry point. |
| `src/backend/app/` | `bootstrap/`, `composition/`, `config/`, `dry-run/`, `host/`, `preflight/`, `registries/` and `test-data/` compose application entrypoints. `config/runtime-isolation.ts` owns the existing frozen values; `registries/` owns task/workflow/test-target registration and current step-proof modules. |
| `src/backend/logs/` | `diagnostics/` and `trust/` plus span, observed-data, artifact and confirmed-action producers. `debug-events.ts` writes bounded typed diagnostics to the native timeline; `emergency-faults.ts` owns the capped database-unavailable spool and verified import; `run-log-stream.ts` reads confirmed events through native cursors. |
| `src/backend/processing/` | `extraction/`, `normalization/`, `ocr/`, `providers/`, `roster/` and `spreadsheet/`; task families register through `task-registry.ts`. `providers/provider-client.ts` owns strict current invocation, cancellation and deadlines; `geocode-adapters.ts` owns Census and Nominatim parsing, and `nominatim-owner.ts` owns the authenticated local channel and in-memory single-fetch queue. |
| `src/backend/runs/` | `commands/`, `explain/`, `exports/`, `lifecycle/`, `notifications/`, `projections/`, `provenance/`, `queries/`, `recovery/`, `settings/`, `start/` and `trust/`. |
| `src/backend/runtime/` | `browser/`, `checkpoints/`, `execution/`, `gates/`, `policies/`, `preflight/`, `scheduling/`, `settings/`, `workers/` and `writes/` own runtime execution and safety; `browser/browser-diagnostics.ts` owns the secret-safe Page capture collector; `workers/` composes the confirmed-action publisher and geocode owner lifetimes. |
| `src/backend/storage/` | `admission/`, `artifacts/`, `configuration/`, `events/`, `maintenance/` and `sqlite/` own database and persistence adapters. `events/note-timeline-writer.ts` and `timeline-emitter.ts` write directly to `sqlite/timeline-repository.ts`; event JSONL readers, writers and adoption are absent. `configuration/credential-store.ts` reads only the current credential document and authenticates its complete application history; credential-to-test-data conversion is absent. `sqlite/runtime-process-locks.ts` owns immutable `geocode-claims/<generation>.claim.json` claims, exact acquisition release markers and private acquisition-specific channel files; all unreleased claims participate in stopped-system admission and recovery proofs. `sqlite/readonly-authority-snapshot.ts` owns the shared read-only database opener and gives database, backup and doctor inspections a private, unchanged-source snapshot; `sqlite/migrations.ts` owns the single native v1 baseline; `sqlite/native-run-deletion.ts` owns terminal deletion tallies and immutable file-custody receipts. `sqlite/storage-recovery-status.ts` inspects actual native restore remnants under admitted ownership and refuses unowned evidence. Archive database capabilities, provider accounting authority and historical conversion owners are absent. |
| `src/backend/systems/` | Browser-system drivers, semantic registries and task implementations. `ui-task-links.ts` (`buildUiTaskLinks`) derives Explorer task attribution from retained registries; `browser-shared/semantic-ui-effect.ts` adapts registered semantic UI effects and sensitivity. |
| `src/backend/transports/` | CLI and dashboard HTTP/SSE transports and route schemas. |
| `src/dashboard/` | Renderer app, client, state, design system, shared UI kit and product surfaces; `app/navigation/archive-route-model.ts` owns the frozen removal-notice URL state without Archive authority models. It does not import backend task implementations. `logs-preview/` is a frontend preview, not an API. |
| `src/models/` | Shared schemas and model shapes, including task contracts, UI vocabulary, workflow data, runtime/API models and schema-bound validation; `events/confirmed-action.ts` owns the v1 confirmed-event and declared-step-result schemas; `events/retention.ts` owns the retained event-stream lifetime; `events/confirmed-operation.ts` owns complete immutable confirmation publications and authenticated proof reconstruction. `run/transaction-resolution.ts` owns current proof-schema-bound transaction history presentation; `workflows/separations/result.ts` owns the complete current terminal result used by the workflow and derived summaries. `config/define-runtime-isolation.ts` owns the pure isolation shape/type, and `fields/` owns the canonical field inventory and registry. `config/snapshot.ts` owns strictly current immutable snapshots: every current required leaf is present, stored reads apply no live defaults, and stored reads preserve complete snapshot values. `config/schema.ts` owns the current settings grammar; `run/session.ts` owns batches minted by start plans or intake manifests. `trust/` owns current failure, diagnostic, receipt and scenario grammars. There is no `models/logs/` package. |
| `src/rules/` | Reusable pure decisions and validation rules; `write-safety/parked-resolution.ts` authenticates immutable parked resolutions against genuine command/audit authority; `runs/` contains ledger primitives, ledger and summary derivation. |
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
│   ├── fixtures/{dashboard,documents,dry-run,integration,preflight}/
│   ├── helpers/{architecture,backend,dashboard,database-foundation,failure-resolution,integration,storage,trust}/
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
`tests/support/`; helpers build fresh native authority and expose its actual timeline, claim and profile ports. Archive and old-format conversion fixtures are absent. Activity integration and parity share `fixtures/dashboard/fixture-activity.ts`; intake shares `fixtures/dashboard/fixture-intake-authority.ts`. The desktop parity suite remains the screenshot/accessibility
contract; its reference files are not refreshed to make wiring pass. Role-derived path helpers do
not imply current files or coverage. Exact test move counts and retirement dispositions remain with
the owning evidence records.

Selector fixtures and live selector evidence now live under `docs/rebuild/evidence/selectors/`;
retained UCPath, Kuali, CRM and New Kronos semantic registries name the evidence they use.
Architecture tests and the UCPath registry unit test consume or assert those paths, so selector
evidence remains checked in. Current selector binding inputs live beside their architecture reader in
`tests/architecture/systems/fixtures/selector-evidence-bindings.json`; pending wire exceptions live in
`tests/architecture/dashboard/fixtures/pending-wire-bindings.json`. Porting records and frozen source
inventories are outside the repository in task evidence. Provenance-only architecture guards and
phone-capture/obsolete-upgrade retirement guards are absent. Current field-registry, runtime-dependency,
operational-isolation and semantic evidence assertions remain with their existing architecture owners.
Semantic registries keep current selector keys and verified fixture/live evidence bindings. Port commit,
path and blob records belong in task evidence. Runtime environment inventories describe only current
repository readers; production isolation remains in `config/runtime-isolation.json`.
The retained field audit helper is `tests/architecture/models/helpers/canonical-field-registry-audit.ts`.
Receipt composition tests live in `tests/integration/backend/runs/provenance/evidence-receipt/evidence-receipt-composition.test.ts`;
step omission gate proofs live in `tests/integration/backend/runtime/execution/run-executor/step-omission-gates.test.ts`.
Unused earlier receipt-composition snapshots are absent; current receipts derive from complete native evidence.
The ignored `config/test-data.local.json` remains private local test input.

## Deferred work and evidence

Phase 3 added the confirmed action/step v1 API, strict event and result schemas, and a worker-local
bounded publisher in their existing `backend/logs/`, `models/events/` and worker owners. Persisted
ordered worker streaming and its read/replay adapters remain Phase 4. The frontend Logs connection,
step-result presentation and capture association remain Phase 5; the v1 event carries no screenshot
artifact. `config/snapshot.ts` owns strictly current immutable snapshots: every current required leaf is present, stored reads apply no live defaults, and stored reads preserve complete snapshot values. `config/schema.ts` owns the current settings grammar; `run/session.ts` owns batches minted by start plans or intake manifests. `trust/` owns current failure, diagnostic, receipt and scenario grammars. There is no `models/logs/` package. A desktop/Electron shell remains future work and has no
placeholder folder.

Current native store tests cover baseline opening and version refusal (`storage/sqlite/migrations/native-baseline.test.ts`), maintenance custody (`storage/admission/admission/native-maintenance-capability.test.ts`), bounded transaction selection and retained deletion evidence (`storage/sqlite/transaction-history/`), and same-item retries (`runs/queries/item-attempt-history/`).

`src/rules/redaction/redaction.ts` owns classified transforms and diagnostic text sanitization.
