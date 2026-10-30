# Codebase structure

This map names the current source, test, and documentation owners. Relay runs locally for one operator.

## Repository folders

| Path | Contents |
| --- | --- |
| `AGENTS.md` | Repository instructions. Nearer instructions own backend, registry, system, and dashboard constraints. |
| `.agents/` and `.claude/` | Repository skills and operating references. |
| `config/` | Runtime isolation and test-data configuration. |
| `docs/rebuild/reference/` | Current contracts and this map. |
| `docs/rebuild/guides/` | Workflow authoring guide. |
| `docs/rebuild/guard-inventory.json` | Guard owners and reasons. |
| `docs/roadmap/roadmap.md` | Roadmap content. |
| `docs/roadmap/index.html` | Generated roadmap site. |
| `duo-autopilot/` | Duo signing with a backend-provisioned session credential. |
| `scripts/build/` | Workflow manifest generation and checks. |
| `scripts/dev/` | Dashboard launch and secure environment bootstrap. |
| `scripts/docs/generate-store-catalog.ts` | Store-catalog generation. |
| `scripts/docs/roadmap.ts` | Roadmap parsing and site generation. |
| `scripts/test/` | Test runner, suite measurement, direct-execution detection, suite policy, and artifact policy. |
| `scripts/verify/` | Repository privacy, browser-login and test-target verification. Standalone verification holds the runtime listener; abandoned reservations settle through startup recovery. |
| `scripts/verify-parity-json.ts` | Desktop parity runner. |
| `src/` | Application source. |
| `tests/` | Tests, fixtures, helpers, and process entrypoints. |

`npm run build:manifest` generates `src/workflow-kit/validation/generated-build-manifest.ts`.
`npm run stores:catalog` generates the catalog section in `docs/rebuild/reference/stores.md`.
`npm run roadmap` generates the roadmap site. Each command has a corresponding `:check` command.
`npm run web:build` produces the dashboard bundle in `dist/`.
Briefs, receipts, and task evidence live in the main checkout's gitignored `.work/` folder. Git worktrees live in its gitignored `.worktrees/<branch>/` folder.

`src/models/run/display-name.ts` owns the browser-safe run display-name schema; command and run records share that leaf.

## Source tree

```text
src/
├── backend/{accounts,app,logs,processing,profiles,runs,runtime,storage,systems,transports}/
├── dashboard/{app,assets,client,ds,kit,lib,public,state,surfaces}/
├── models/{artifacts,config,dashboard,events,failures,fields,intake,notifications,ocr,
│           preflight,processing,profiles,providers,run,runtime,sessions,systems,task,trust,
│           ui,validation,workflow,workflows,write-safety}/
├── rules/{commands,identity,intake,kronos,matching,normalization,notifications,
│          preflight,redaction,runs,separations,sessions,time,validation,workflow,write-safety}/
├── workflow-kit/validation/
├── workflows/{person-lookup,separations}/
└── cli.ts
```

### Backend

Paths in this table are relative to `src/backend/`.

| Path | Ownership |
| --- | --- |
| `assistant/` | Finite local intent and opaque-reference tools, bounded generated plain knowledge, private profile-token authorization and once-consumable canonical actions. Profile SQLite owns grants, chats and action records. `context.ts` owns the safe knowledge projection; `scripts/build/generate-assistant-knowledge.ts` writes and checks its artifact. |
| `accounts/` | ChatGPT OAuth, verified account and usage state, and the shared Responses OCR/assistant transport. Account-specific model catalogs and bounded strict namespaced function turns use the same selected-account owner; production functions require their current canonical availability and authorization gates; absent verified model policy refuses inference. Browser-safe account and sign-in lifecycle schemas live in `models/dashboard/chatgpt-account.ts`; HTTP routes own the latest account attempt. |
| `app/` | Bootstrap, configuration, host admission, preflight, rehearsal manifest validation, and application composition. |
| `app/composition/` | Storage, dashboard, and worker dependency assembly. `profile-credential-inventory.ts` composes credential maintenance assessment, including stopped machine-control inventory; `storage/maintenance/profile-inventory.ts` owns canonical copy/resource membership and retained browser-root validation shared with stopped READY-profile upgrade. Its required `ProfileBrowserClosure` port receives native work from composition; storage never imports runtime. `storage/maintenance/upgrade.ts` runs profile SQLite upgrade and the separate stopped machine-control upgrade. `storage/maintenance/existing-data-backup.ts` owns the shared verified SQLite and private coupled-copy writer for the startup flat-store migration and stopped flat native6 CLI backups,. `storage/maintenance/existing-data-backup-files.ts` owns backup manifests and file verification without opening authority databases. `storage/maintenance/cancel-queued-runs.ts` owns digest-bound offline cancellation of never-claimed flat native6 queues, using the finite `AuthorityDatabase.cancelQueuedRunsNative6` transaction and shared run transition/row-update primitives; `storage/maintenance/process-closure.ts` supplies the current startup and offline process/open-file/cwd absence checks. `storage/admission/bootstrap-admission.ts` runs the verified flat-store start-clean migration before profile composition; `installation.ts` owns its durable deletion intent and empty-registry publication. |
| `app/registries/` | Workflow, task, step-proof, and test-target registration. `task-registry.ts` composes system, processing, and workflow task stores. |
| `logs/` | Spans, observed data, artifacts, confirmed actions, declared step results, and diagnostics. `run-log-stream.ts` reads confirmed events through native timeline cursors. `emergency-faults.ts` owns the capped database-unavailable spool and its import. |
| `logs/diagnostics/` | Diagnostic capture and retention. |
| `processing/` | Extraction, normalization, OCR, provider calls, roster processing, and spreadsheets. Task families register beside their implementations. `providers/nominatim-owner.ts` owns the parent serial geocode queue and worker IPC client; `providers/geocode-adapters.ts` owns provider request/response mapping. `providers/chatgpt-ocr-adapter.ts` owns the fixed OCR model and scoped page reader shared by the canonical provider adapter and the fixed Settings diagnostic. |
| `profiles/` | Control-authenticated registry, credential inventory and session authority. `profile-session.ts` owns private draft/session publication, `profile-onboarding.ts` owns issued draft attempts and verified method receipts, and `onboarding-duo.ts` defines the provider capability contract. `onboarding-duo-provider.ts` owns browser enrollment; `profile-errors.ts` owns shared profile refusals. Native verifier publication and its cryptography live in `storage/configuration/verifier-store.ts` and `storage/configuration/synthetic-verifier.ts`. Browser-safe schemas live in `models/profiles/`. |
| `runs/lifecycle/startup-crash-recovery.ts` | Startup process-closure receipts, dead-worker run reconciliation and previous-day pristine queue cancellation before work admission. |
| `runs/` | Commands, start plans, lifecycle, recovery, queries, projections, exports, provenance, notifications, settings, explanation, and trust readers. |
| `runs/commands/command-refusal.ts` | Shared command rejection construction; runtime recovery imports it directly. |
| `runs/trust/` | Canonical run readers and receipt services. |
| `runtime/` | Browser sessions, checkpoints, execution, gates, policies, preflight, scheduling, settings, workers, and writes. `browser/native-profile-probe.ts` owns the shared native launcher, finite credential-free probe child, canonical worker/onboarding profile paths, verified context/page closure, and the real `profileBrowserClosure` port with private-path validation and synchronous/asynchronous retained-profile probing. `browser/browser-session-factory.ts` owns authenticated session acquisition and reuse. |
| `storage/` | Admission, artifacts, configuration, events, maintenance, and SQLite persistence. |
| `storage/configuration/` | Settings and private credential persistence, including opaque committed-replay witnesses. `credential-store.ts` exposes the protected-settings and ChatGPT account records under `<stateRoot>/credentials/`, which also holds the retained active-engine Duo key; `duo-credential-store.ts` owns the per-profile encrypted Duo purpose document under machine control. `credential-key-custody.ts` owns OS keychain entries, non-secret key metadata and startup key migration. Both private records use `credential-safe-file.ts` for file safety and strict physical directory membership. |
| `storage/events/` | Native timeline writers, readers, and emitters. |
| `storage/sqlite/` | Database authority, repositories, migrations, process locks, backup inspection, recovery status, and deletion custody. `database-identity.ts` owns the pure application-ID and normalized-path source digest. `timeline-repository.ts` owns ordered event persistence. `worker-slots.ts` authenticates reservation and retirement lineage for both live custody and isolated maintenance snapshots; `worker-control.ts` owns their authenticated control reads. `readonly-authority-snapshot.ts` owns isolated source snapshots. The pure `storage/source-closure.ts` owns `AuthoritySourceClosureUnprovedError` and private failed-resource retention without authority or resource accessors. |
| `systems/` | Browser-system sessions, drivers, semantic UI registries, and tasks. CRM, Kuali, New Kronos, and UCPath have driver implementations. I-9, Old Kronos, OnBase, ServiceNow, and SharePoint have session declarations and empty task stores with `unwired` drivers. |
| `systems/browser-shared/` | Shared sign-in, authenticated application, action-note, and semantic UI effect behavior. |
| `systems/kronos-shared/` | Shared timecard models. |
| `systems/ui-task-links.ts` | Explorer task attribution from system registries. |
| `transports/cli/` | CLI dispatch and command handling. |
| `transports/http/` | Dashboard HTTP routes, request schemas, and SSE subscriptions. |
| `workbooks/` | Saved workbook library: validated workbook records, versions and history over its SQLite repository. |

### Dashboard and shared packages

| Path | Ownership |
| --- | --- |
| `src/cli.ts` | CLI entrypoint. |
| `src/dashboard/app/` | Renderer composition, navigation, commands, and workflow data-source selection. |
| `src/dashboard/client/` | Shared backend client, queries, commands, and subscriptions. |
| `src/dashboard/ds/` and `src/dashboard/kit/` | Design system and shared UI components. |
| `src/dashboard/state/` and `src/dashboard/lib/` | Renderer state and utilities. `state/queue-wiring-adapter.ts` owns the Queue producer and its typed handlers. `state/activity-wiring-adapter.ts` owns Analytics population projection, snapshot-bound browse/export and exact run-detail admission. `state/spreadsheet-wiring-adapter.ts` owns saved workbook reads, drafts and versioned Save. |
| `src/dashboard/surfaces/` | Product screens and their view models. Workflow mocks live under `workflows/mocks/`. Run-detail Logs presentation lives under `run-detail/logs/`. Notification producers live in `notifications/notifications-preview-model.ts` and `notification-rail-model.ts`; workspace search projection lives in `shell/search/search-wiring-model.ts`. Intake session resources live in `state/intake-wiring-adapter.ts`; command verification lives in `intake/intake-command-model.ts`. |
| `src/dashboard/assets/` and `src/dashboard/public/` | Bundled assets and static public files. The Logs preview lives under `public/logs-preview/`. |
| `src/models/` | Browser-safe schemas, contracts, and API shapes. System and workflow task contracts live under `systems/` and `workflows/`; canonical fields live under `fields/`. `failures/error-catalog.ts` owns task-code normalization for durable failures and their served recovery declarations. |
| `src/models/dashboard/activity-population.ts` | Canonical Analytics population, selected browse, export and AP1 snapshot schemas. `activity-selection.ts` owns the nested AS1 report selection used by summary and XLSX exports. |
| `src/models/config/` | Settings grammar, isolation shape, and immutable configuration snapshots. |
| `src/models/workflow/build-manifest.ts` | Pure build-manifest path, schemas, types and parser shared by generation and runtime validation. `workflow-kit/validation/build-manifest.ts` owns the eagerly validated checked-in manifest and fingerprint resolvers. |
| `src/models/events/` | Timeline, confirmed action, declared step result, and confirmation-proof schemas. |
| `src/models/trust/` | Failure, diagnostic, receipt, and scenario schemas. |
| `src/rules/` | Pure decisions and validation, including identity, clocks, normalization, ledger derivation, redaction, and write safety. |
| `src/workflow-kit/` | Root-level TypeScript modules for task and workflow declaration, flow construction, compilation, sessions, providers, artifacts, and capabilities. |
| `src/workflow-kit/workflow-definition.ts` | `defineWorkflow` and `compileWorkflow`. |
| `src/workflow-kit/validation/` | Workflow roles, source paths, implementation bindings, scenario coverage, and the build manifest. |

### Workflow ownership and imports

`src/workflows/person-lookup/` and `src/workflows/separations/` each contain `workflow.ts`,
`task-registry.ts`, and `tasks/`. The workflow definition is browser-safe. The registry loads
backend task implementations.

Person Lookup has four chunk harnesses at `src/workflows/person-lookup/steps/<step>/step.ts`:
`searching`, `cross-verify`, `active-status`, and `crm-dates`.
Separations has five chunk harnesses at `src/workflows/separations/steps/<role>/step.ts`:
`identity-check`, `kronos-timecard`, `kuali-extraction`, `kuali-finalization`, and `ucpath-transaction`.
`src/workflow-kit/validation/source-layout.ts` derives definition and scenario paths from workflow roles.
A derived scenario path does not imply that a scenario file exists.

Renderer code consumes shared models, rules, workflow-kit modules, and browser-safe workflow definitions.
Workflow definitions and step harnesses do not import backend task implementations.
Backend composition loads workflow definitions and task registries. System and processing task registries
sit beside their owning families. Shared packages and renderer code do not load workflow `tasks/`.

## Tests and evidence

Tests mirror their source modules. Paths under `src/` drop that prefix; script, Duo, and root configuration
paths retain their full path. Unit files use `.test.ts`; integration files use `.integration.test.ts`
beside them. Topic suffixes split larger suites.

```text
tests/
├── architecture/{app,dashboard,logs,models,processing,runs,runtime,storage,support,systems,tooling,workflow-kit}/
├── backend/{app,logs,processing,runs,runtime,storage,systems,transports}/
├── dashboard/{app,client,ds,lib,state,surfaces}/
├── duo-autopilot/src/
├── {models,rules,scripts,workflow-kit,workflows}/
├── parity/
├── perf/
├── support/{fixtures,helpers,processes}/
├── types/
├── cli.integration.test.ts
├── vite.dashboard.config.test.ts
└── vitest.config.integration.test.ts
```

`tests/architecture/test-layout.test.ts` checks canonical filenames and mirrors against existing tracked source.
Architecture, parity, performance, type, and support trees are exempt from source mirroring.
Architecture fixtures and helpers stay beside their owning guard families.
Shared fixtures, fresh-authority builders, and child-process entrypoints live under `tests/support/`.
`tests/support/helpers/dashboard/controls/` owns the UI control preview fixtures, loaded by
fixture name from `tests/parity/app-entry.tsx`.
- `tests/support/duo-ceremony-setup.ts` registers the shared Duo fixture cleanup for every Vitest project; the fixture owner stays process-safe.
Shared composition setup lives in `tests/support/helpers/backend/{capability-wiring-world,write-recovery-world,dashboard-child-world,worker-loop-world}.ts`
and `tests/support/helpers/dashboard/mounted-rerun-world.ts`; each test owns its allocation, hooks, and cleanup.
`tests/support/helpers/backend/runtime-lifetime.ts` owns temporary kernel listeners for tests;
`tests/backend/runs/lifecycle/run-record-service.write-parking.integration.test.ts` owns write-park journal and event atomicity.

| Behavior | Test owner |
| --- | --- |
| Committed write-recovery refusal | `tests/backend/runtime/writes/write-recovery.committed-refusal.integration.test.ts` |
| Dashboard rerun launch | `tests/dashboard/surfaces/run-start/run-launch.rerun.integration.test.ts` |
| Executor snapshot refusal | `tests/backend/runtime/execution/run-executor.snapshot-refusal.integration.test.ts` |

`tests/support/fixtures/ui/<system>/` contains the 16 sanitized selector manifests for CRM, Kuali,
New Kronos, and UCPath. The semantic registries name these fixtures; architecture tests and the UCPath
registry test read or assert their paths.
`tests/architecture/systems/fixtures/selector-evidence-bindings.json` owns selector-binding inputs.
`tests/architecture/dashboard/fixtures/pending-wire-bindings.json` owns dashboard wire exceptions.

`tests/parity/` holds the desktop presentation contract and its references.
`tests/perf/` holds dashboard performance checks. `tests/types/` holds compile-time inputs and their checks.
`tests/scripts/docs/roadmap.test.ts` tests roadmap parsing.
The private `config/test-data.local.json` input is ignored. Runtime state and artifact roots are declared
in `config/runtime-isolation.json`; test fixtures are separate from that operator state.

## Not built yet

- Complete workflow-agnostic dashboard wiring and per-workflow served-data integration follow the approved wiring and workflow briefs.

Person Lookup folds UCPath/CRM identity and employment facts in `rules/matching/person-lookup.ts`.
`rules/matching/ucpath-person.ts` owns shared appointment preference. CRM discovery and exact
selected-record verification live in the CRM driver and their corresponding system tasks.

`storage/admission/admission-identity.ts` owns issued identity membership, validation and the shared profile browser-root and unsupported-relocation refusals; constructor-only registration is enforced by the admission identity guard. `admission/lifetime-lock.ts` owns the dedicated loopback listener, one-shot workspace initialization and IPC handle transfer that retain runtime exclusion through worker shutdown. `admission.ts` owns registered profile setup, runtime, logout settlement and exact pending-logout readonly inventory children, and the stopped maintenance admission used by `storage upgrade --machine-control` and `storage recover-duo-publication`. `installation.ts` publishes registry, pending-operation, and Duo-purpose continuity under its fixed private-file mutation lock, including the stopped machine-control upgrade and post-exit settlement of one already published Duo operation. Its private publication scope supplies validated nonrecovering registry reads inside that same mutation. `configuration/credential-safe-file.ts` supplies exact nonce/inode/bytes file locking for this control and the distinct profile locks in `profiles/registry.ts`. Explicit stopped device-continuity recertification preserves unknown historical volume binding in its exact capture, journal and receipt; ordinary startup never refreshes witnesses.

Rehearsal declarations remain in `models/trust/dry-run-scenario.ts`; verification-only evidence
assertions and graph checks live in `tests/support/helpers/dry-run-scenario-fixtures.ts`.
Workflow execution uses the signed-in dashboard Run and its canonical start-plan, command and worker owners.

### Assistant model preference

`src/models/dashboard/assistant.ts` owns the profile preference record. `src/backend/storage/sqlite/assistant-model-preference.ts` owns its authenticated singleton and command/audit history checks. The existing command kernel and command service own the operator-only asynchronous preparation boundary and compare-and-swap mutation; account/composition preparation is required before that command becomes available.
