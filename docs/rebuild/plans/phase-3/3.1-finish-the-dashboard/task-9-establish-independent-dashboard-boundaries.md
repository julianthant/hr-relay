# Task 3.1.9 · Establish independent dashboard boundaries
<!-- roadmap: dash-boundary-foundation -->

**Current assignment: 3.1.9.** Standalone prerequisite or individual task; follow its explicit dependencies.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.

Read [the shared phase plan](README.md#parallel-execution-and-worktree-contract) and
[current task identities](README.md#current-task-identities) before a focused assignment.

Complete the shared changes discovered by the acceptance inventory before independent surface writers start. Preserve existing behavior and real production consumers; no mock-only foundation.

- [ ] isolate shared shell/navigation, query/route/composition registration and fixture entry points required by the selected surface assignments
- [ ] verify unchanged production paths, strict contracts, redaction and behavioral negative controls; pass focused checks and the assigned integration checks
- [ ] publish exact owned paths, exports, generated-artifact ownership, independent gate resources and either-order integration evidence for each admitted task

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.

## Approved execution brief — 2026-09-13

The operator approved this complete proposal in the planning task on 2026-09-13. Before approval,
the operator explicitly assigned the complete Explorer JSON-to-SQLite conversion to **3.1.9**,
leaving editor work in **3.1.9.4**, and selected **GPT-6 Astra ultra** for planning, both supervisor
sessions and any authorized subagents. That effort selection overrides lower defaults in personal
skills and repository guidance for these assignments. A and B below are sequential sessions within
the existing **3.1.9** node, not new roadmap tasks or independently launchable parallel children.

### Current state and prerequisites

| Binding | Verified planning state / execution requirement |
| --- | --- |
| Repository | `/Users/julianhein/Projects/hr-automation-rebuild` |
| Discovery base | `ecd2d84e25a2622b4faf689289e598d89455f6b3`, clean local `master`; only the primary worktree and `master` ref existed at approval. |
| Required baseline | 3.1.8 accepted candidate `baeed585dcefb3883deffac0e6b725dfb1381b80`; local integration `45df7f7de4bf54c7cee952b3b3909778f74b8b85`; closure recorded by `7d096ecde`. These are ancestors of the discovery base. Read the [accepted baseline record](task-8-re-baseline-dashboard-truth-and-acceptance.md), not its superseded initial review claims. |
| Plan availability | The planning handoff names the full committed SHA containing this section. A uses that verified plan commit as its implementation base. A prerequisite SHA without this complete section is not the approved plan. |
| Product state | A1–A3 and B1–B3 are unstarted. Planning inspected source/tests and contracts; no new runtime, browser, migration or live acceptance is claimed. |
| Readiness | A can start after committed-plan and documentation-gate verification. B waits for A's accepted integration. The seven surface children wait for complete 3.1.9 integration and their own approved execution briefs. |

### Allocation, checkout and integration

| Session | Model / allocation | Proposed branch and absolute worktree | Base and merge condition |
| --- | --- | --- | --- |
| A · Authority and backend | GPT-6 Astra ultra; supervisor implements A1–A3. Zero worker agents. | `codex/3.1.9-boundary-data`; `/Users/julianhein/Projects/hr-worktree-boundary-data` | Create from the verified approved-plan commit containing the discovery base. Commit the working candidate and focused evidence. Integrate into local `master` only under the operator's explicit candidate integration direction, after focused checks pass and target drift is resolved. |
| B · UI, fixtures and release | GPT-6 Astra ultra; supervisor implements B1–B3 after A. Zero worker agents. | `codex/3.1.9-boundary-ui`; `/Users/julianhein/Projects/hr-worktree-boundary-ui` | Resolve A's actual accepted integration SHA from this record and `master` ancestry; verify the approved plan is included. Create from that SHA. Focused candidate, operator-directed local `master` integration and owned cleanup complete 3.1.9. |

Two sessions separate the consequential migration/recovery and BFF changes from the coupled
UI/history/fixture extraction. B consumes A's accepted interfaces; they must not run concurrently.
One implementation worktree is active at a time, within the four-auxiliary-worktree ceiling. Names
are proposals until the supervisor checks refs, worktree registrations, physical paths and current
ownership. Never reset a colliding ref, implement on `master`, share a mutable Git index, copy the
operator state root, or remove another session's resources.

The operator opens each supervisor session and directs candidate integration. Approval of this
plan does not itself authorize automatic implementation merges, push, sibling dispatch or task
creation. The active supervisor owns its candidate, focused verification, integration preparation,
and any subsequently authorized integration/cleanup. A's completion alone does not complete 3.1.9.
If integration permission is pending, retain the candidate and evidence, report that exact blocker,
and do not release the dependent session. Remove only owned resources after verified integration;
never remove the active supervisor worktree from within itself. Retained resources remain explicit.

### Ordered steps and permitted owners

All source paths in this section are relative to the assigned worktree. New extraction filenames
are routine implementation choices within the named directories; record their actual exports and
exclusive downstream ownership before release. A directory allocation is not authority to redesign
unrelated modules within it. B may consume A's interfaces but may not reopen its migration or kernel
contract without resolving the changed prerequisite first.

| Step | Required outcome | Permitted production/test owners and exclusions |
| --- | --- | --- |
| A1 · Explorer authority | Commit override values, revision and successful command/audit records in one SQLite transaction. Pass the transaction-owned repository into the executor; remove runtime file writes and after-commit file finalization. Keep validation, preview, conflicts, exact replay, revisioned appearance restore and hot readback. | `src/domain/authority.ts`, `src/domain/dashboard/explorer.ts`, `src/core/command-kernel.ts`, `src/infra/sqlite/authority-database.ts`, new isolated SQLite Explorer repository in `src/infra/sqlite/`, `src/server/dashboard/commands/explorer-edit-service.ts`, `explorer-override-store.ts`, and their composition/fixtures/tests. Keep source-authored workflows and the label/icon/category subset. |
| A2 · Historical conversion | Append proposed migration 51 after rechecking the current tip. Preserve migrations 1–50 and recovery floor 46. Import valid existing overrides once through stopped upgrade, with durable source identity and receipt. Current-schema reads/writes ignore old files. | `src/infra/sqlite/migrations.ts`, `authority-database.ts`, `stopped-database-conversion.ts`, `recovery-admission.ts`, `recovery-contracts.ts`, `backup-service.ts`, relevant lifecycle backup/read-forward adapters in `src/infra/sqlite/lifecycle-storage.ts` and `src/infra/compat/backup-inspection.ts`, `src/server/storage/upgrade.ts`, and narrowly required schemas/fixtures/tests. Do not change archive custody, credential authority or below-floor policy. |
| A3 · Backend boundaries | Separate surface route, dependency-type and composition modules; split Activity range/CSV from Queue day/member/action summaries. Publish real query/read/subscribe, execute/replay/refuse, upload/prepare, archive file/download/version/deletion, notification and doctor ports. | `src/server/dashboard/compose.ts`, `compose/operator.ts`, `compose/trust.ts`, new surface-specific composition modules; `routes/api.ts`, `operator.ts`, `data.ts`, `trust.ts`, `api-types.ts` and extracted route modules; `queries/bootstrap.ts`, `run-summaries.ts`, dedicated summary modules, `projectors/run-queue-projection.ts`; necessary dedicated domain wire types and existing service adapters. Shared registration is complete before child writers. Later session-control and detail behavior remains with 3.1.11/3.1.14. |
| B1 · UI boundaries | Separate navigation/history/focus and takeover registration, date/notification/session slots, Settings host/editor/storage/catalog/preflight modules, and matching client ports. Preserve rendered values, reference identities, DOM, labels, styles, accessibility and interactions. | `src/dashboard/app/dashboard-app.tsx`, `url-state.ts`, `nav-history.ts` and extracted app modules; `src/dashboard/surfaces/top-bar.tsx`, `shell.tsx`, `settings.tsx`, `settings-model.ts` and extracted surface/model modules; `src/dashboard/client/queries.ts`, `commands.ts`, per-surface client modules and `src/dashboard/state/client-context.tsx`; necessary wiring at existing surface consumers. Full Settings catalog editor expansion and P40/A8 reference changes remain 3.1.9.2. |
| B2 · Resource and fixture boundaries | Extract genuinely repeated resource behavior with real consumers. Separate surface fixture profiles, seeded services and reference registration without changing accepted scenes. | `src/dashboard/state/async-resource.ts`, relevant existing resource hooks and production consumers in Settings/Explorer/Archive/Activity/Intake; `tests/parity/helpers/fixture-day.ts`, `fixture-bff.ts`, `seeded-bff.ts`, dedicated fixture helpers, `tests/parity/dashboard-reference.spec.ts`, extracted surface specs, and affected unit fixtures/tests. Preserve established first-load, refresh, error, cancellation and stale-result semantics. Do not generalize distinct behavior merely because effects look similar. |
| B3 · Release contract | Publish actual exports, child-owned paths, generated ownership, fixture/spec/reference names, independent gate resources and admission/merge obligations for 3.1.9.1–3.1.9.7. | This task record and its [shared/leaf ownership map](task-8-acceptance-matrix.md#shared-ownership-and-admission-boundaries); relevant child ownership pointers; roadmap source and generated output. Shared registration, schema/kernel, common fixtures, root configuration and combined membership remain reserved; the surface finalizer is 3.1.9.8. |

A owns necessary compatibility updates to existing contract consumers and fixtures so its candidate
works before B starts. B subsequently owns their extraction. Neither session may leave mock-only
ports or an interface whose real implementation is deferred to a sibling. Existing editor, protected
write/read-presence, storage and preflight operations must remain usable through their isolated ports;
their future feature expansion is not implied. Where a dedicated wire file has only one child owner,
record that transfer explicitly instead of creating a shared union every child must edit.

### Feasibility and acceptance evidence

These are source-inspected mechanisms and assigned proofs, not results of new acceptance runs.
The [frozen matrix](task-8-acceptance-matrix.md) and owning contracts retain product outcomes.

| Boundary / evidence | Required change and proof | Forbidden outcome |
| --- | --- | --- |
| Explorer transaction: `src/core/command-kernel.ts` `executeSync` and `executeExplorerEdit`; `src/server/dashboard/commands/explorer-edit-service.ts`; `src/infra/sqlite/authority-database.ts` `withAuthorityTransaction` | A1 passes the same transaction repository through apply and audit. Positive apply advances one override revision and records one command/audit; injected audit failure rolls all of them back. Test a competing stale revision and a valid subsequent command after rollback. | File effects before SQL settlement, partial success, a second authority transaction, or plausible success after an unknown failure. |
| Historical source: `src/server/dashboard/commands/explorer-override-store.ts` `reconcilePending`/`replace`; `src/server/storage/upgrade.ts`; `src/infra/sqlite/stopped-database-conversion.ts` | A2 admits valid source schemas and command/audit identity, records a durable source receipt and rechecks source identity before effects. Exercise fresh initialization, supported 46–50 upgrades, malformed/conflicting sources, source changes after preflight, rollback before commit and replay after commit. Pending Explorer claims refuse conversion and name recovery through the compatible release; never guess a committed edit. | Silent data loss, importing half-settled file state, rewriting released DDL, bypassing stopped/backup admission, or accepting below-floor input. |
| Current readback and recovery: `src/server/dashboard/compose.ts` boot/read/validate bindings; existing backup and authority inspection | A1/A2 test exact same-command replay after restart, divergent envelopes, stale descriptor/version/revision, hot readback, and backup/restore of committed overrides. After conversion, alter old JSON/claim files and prove no change in SQLite-backed appearance or command outcome. | Old files remain a runtime authority, restore creates a second override owner, or historical replay manufactures current descriptor evidence. |
| Ingress and transport: `src/server/dashboard/routes/api.ts`; `tests/unit/architecture/operator-mutation-admission.test.ts` | A3 classifies every extracted registration and retains identity/Host/Origin/content-type checks before body reads or effects. Cover hostile ingress plus malformed body together, valid ingress plus invalid body, and valid commands. Preserve typed conflict/refusal responses, upload bounds and existing download headers/identity checks. | Uncovered route modules, guard-after-handler registration, body effects before refusal, secret projection or fake success. |
| Activity/Queue: `queries/run-summaries.ts`, `compose.ts`, `projectors/run-queue-projection.ts` | A3 proves real production summary consumers after extraction, bounded pagination, member/container counting, explicit range refusal, privacy, unknown historical registration and the independent confirmed-transaction-history block. | Duplicate authority/folds, archive reconstruction from current descriptors, guessed missing facts or unbounded replacement reads. |
| Settings/history: `src/dashboard/app/dashboard-app.tsx` `leaveSettings`/popstate handling; `src/dashboard/surfaces/settings.tsx` draft/exit guard | B1 uses mounted interaction tests for dirty draft + shell navigation, Keep/Discard, native Back/Forward, catalog subroutes and takeover focus. Move the page-owned guard and route coordinator coherently. | Unmount loses an unconfirmed draft, browser URL and mounted page diverge, unknown sections silently redirect, or focus disappears. |
| Resources: current hooks plus Settings/Explorer/Archive/Activity/Intake effects; dashboard lessons on refresh preserving visible results | B2 proves initial loading, successful refresh, failed refresh, request identity changes, cancellation and late completion after a newer request. Preserve each consumer's currently required value/reference and error semantics. | Unrelated responses replace the current resource, refresh erases required success feedback, or a common helper swallows faults. |
| Fixture/reference ownership: `fixture-day.ts`, `fixture-bff.ts`, `seeded-bff.ts`, `dashboard-reference.spec.ts`, `parity-reference-authority.test.ts` | B2/B3 preserve the complete before/after scene membership and reference-file identities, establish dedicated surface builders/specs, test real schema-backed HTTP/SSE fixtures and seeded services, then run affected desktop scenes. | Dropped or duplicated scenes, changed reference images to hide wiring drift, mock-only production proof, or two children editing common builders. |

The implementation's migration target is a disposable test authority, not the operator's `.tracker`.
No active-database deployment/conversion or external HR-system proof is assigned here. Preflight each
isolated conversion target for version, source/backup identity, stopped admission and relevant file
custody; recheck volatile identity/locks at the existing pre-effect boundary. Ordinary startup must
refuse older schemas. Current operator state, credentials, browser sessions and legacy live state are
excluded. Existing override files may remain inert recovery evidence; runtime file writers and the
prepared-claim protocol retire. The user-visible upgrade remains explicit and stopped.

### Focused gate schedule and resource ownership

Run commands from the assigned absolute worktree. Use at most four test file workers and the
repository runner; verify effective runner configuration if adjusting concurrency. Tests, schema
fixtures, build output and parity output use that worktree or task-owned temporary roots. Evidence
roots are `/Users/julianhein/Projects/hr-boundary-data-evidence-20260913/` for A and
`/Users/julianhein/Projects/hr-boundary-ui-evidence-20260913/` for B. Record actual run subdirectories,
commands, exit results, candidate SHA, tested inputs and process cleanup in this task's current record.
Preserve existing evidence if either root already exists; do not reuse it as fresh proof.

| Boundary | Required checks / reuse |
| --- | --- |
| First stable seam | Run the meaningful focused positive and negative tests for that step. Fix failures in the same session. No full suite for each small edit. |
| Logical code candidate | Run the applicable A or B set below, the new focused regressions, scoped ESLint on every changed code/test path with `--max-warnings 0`, affected build/generated checks and `git diff --check`. Record exact resolved paths and commands. |
| A release | Working production bindings, conversion/replay proof and focused backend tests must pass before candidate integration or B's start. No UI acceptance claim from backend-only tests. |
| B release | Run affected desktop parity below, verify full reference membership/unchanged reference bytes, prove the production/fixture ownership map and complete candidate checks. No independent review. |
| Operator-directed integration | Recheck target/base/approved-plan ancestry and dirty-path ownership. Inspect the combined diff; rerun invalidated focused tests/lint/build/generated/parity checks. Exact unchanged-input evidence may be reused under D191. Conflicts changing behavior need regression proof. |
| Documentation-only recording | Links/fragments, existing instruction-pair equality and chain cap, roadmap binding, roadmap generation/freshness and `git diff --check`. Lint any executed test/generator code as required by repository rules. Record code-input equality; do not claim deferred product gates passed. |

A's named existing test set:

```sh
npm run test -- \
  tests/unit/server/explorer-edit-service.test.ts \
  tests/unit/server/explorer-override-store.test.ts \
  tests/unit/commands-authority.test.ts \
  tests/unit/storage-supported-conversion.test.ts \
  tests/unit/storage-upgrade-admission.test.ts \
  tests/unit/server/bff-flow.test.ts \
  tests/unit/run-summaries/queries.test.ts \
  tests/unit/run-summaries/privacy.test.ts \
  tests/unit/architecture/migration-history-immutability.test.ts \
  tests/unit/architecture/operator-mutation-admission.test.ts \
  tests/unit/architecture/workflow-editor-compile-integrity.test.ts
```

Add meaningful SQLite conversion/atomicity and composed surface-boundary regressions beside these
suites and record their exact commands. Replace obsolete file-protocol assertions with the same
required SQLite/recovery outcomes, including negative controls. Update
`docs/rebuild/guard-inventory.json` for guard additions/retirements with deciding evidence. If a named
test file is deliberately split or retired, preserve and document its replacement membership/proof;
never turn a missing test into an empty successful selection.

B's named existing test set:

```sh
npm run test -- \
  tests/unit/dashboard/settings-takeover.test.ts \
  tests/unit/dashboard/settings-editor-surface.test.ts \
  tests/unit/dashboard/settings-storage-doctor.test.ts \
  tests/unit/dashboard/takeover-frame-focus.test.ts \
  tests/unit/dashboard/session-panel-pool-press.test.ts \
  tests/unit/dashboard/client-transport.test.ts \
  tests/unit/dashboard/parity-fixtures.test.ts \
  tests/unit/dashboard/seeded-bff.test.ts \
  tests/unit/architecture/dashboard-wire-boundary.test.ts \
  tests/unit/architecture/parity-reference-authority.test.ts

npm run test:parity -- \
  --grep 'settings|storage|explorer|catalog-search|archive|intake|queue-day|access variants|desktop canvas'
```

Add mounted navigation/resource and fixture-ownership regressions, with exact commands recorded.
Preserve scene names so the approved selector remains valid; verify selected membership after any
spec extraction. The parity wrapper owns JSON verification and output; retain its schema, a11y and
reference provenance checks. `npm run web:build` is the affected dashboard build check; reuse the
same-input build performed by parity only with its recorded receipt. Do not run concurrent builds
or parity writers into the same worktree output. Both themes and the existing desktop viewport
identities remain; no mobile variants or reference refreeze is authorized. Manual browser diagnosis,
if needed, follows `/ui` and the platform Playwright CLI reference.

For scoped ESLint, enumerate changed `.ts`, `.tsx`, `.js` and `.mjs` paths from the candidate's named
base with a NUL-delimited Git diff, retain existing files, and pass the resulting array directly to
`npx eslint` plus `--max-warnings 0` without shell string interpolation. Include new untracked files
before their first commit. Record the exact expanded argv as gate evidence. The plan does not permit
filtering out changed tests, generated consumers or inconvenient lint failures.

Run generation before its freshness check: `npm run roadmap` / `npm run roadmap:check` for plan
records; `npm run build:manifest` / `npm run build:manifest:check` only when descriptor import-closure
inputs change; `npm run stores:catalog` / `npm run stores:catalog:check` only for affected catalog
inputs. Do not hand-edit generated output or change source-authored workflows to obtain a green gate.

The [Phase 3.1 cadence](README.md#execution-cadence--operator-amendment-2026-09-13) controls these
sessions: **no independent review**. Full coverage, whole-repository lint/architecture, broad parity,
combined production/performance/recovery/live proof and A01–A42/D01–D05 execution remain **3.1.19**.
These assignments still supply their specific migration, production-binding and affected browser
proofs. No deferred check is marked passed. Group finalizer 3.1.9.8 retains its focused integration
and typecheck obligations; this plan does not move full gates back to it.

### Child release and exclusions

B3 records one exclusive owner for each actual extracted module/export, each fixture/spec/reference
name and each shared generated input. Cover Shell, Settings, Storage, Explorer, Notifications, Intake
and Archive, plus the completed date/session and Activity/Queue ports transferred to their later
owners. Each child must have every needed production operation without editing a sibling module,
root composition switch, shared command union, schema migration or common fixture builder.

Record structural independence and the permitted either-order combination, with concrete import,
path and resource evidence. Future child plans bind exact branches/bases, isolated proof commands and
the 3.1.9.8 finalizer intake. Actual child-candidate merge-order tests belong to those future accepted
candidates/finalizer; do not claim unimplemented candidates were merged or tested here. This parent
does not silently admit or dispatch the seven child implementation briefs.

Excluded: surface redesign; full Settings editor/catalog expansion and P40/A8 reference changes;
new session-control behavior; detail-foundation implementation; workflow changes; operator-state
conversion; automatic backup/restore/upgrade; legacy runtime access; live external writes; push or
cutover. Preserve settings/credential separation, saved-report authority, artifact identity, strict
ingress, fail-loud behavior and all frozen acceptance outcomes.

Stop dependent work for a changed prerequisite/ownership/base, conflicting migration allocation,
unexplained historical authority, missing required production operation, or a required visual or
contract change outside this brief. Resolve the concrete conflict before continuing; routine coding
choices and regression fixes stay with the supervisor. Do not hide an unresolved operation behind
future child discovery. A new scope decision returns to the operator with the conflicting evidence.

### Execution record and handoff

At start/resume and after each verified A1–A3/B1–B3 completion, send **Done / Now / Remaining** in
chat before the next tool call. Keep current checkout/base/head, candidate and tested inputs,
accepted focused evidence, pending integration/cleanup, deferred broad proofs and next action in
this section. Use normal prose in persisted evidence. Use `/handoff` only for interrupted unique
state; ordinary A-to-B transfer uses the committed task record.

| Session | Candidate / accepted integration | Focused evidence | Remaining |
| --- | --- | --- | --- |
| A | Implementation `1bdc41406a7725d900a2bfa48af4ff48a23dc432`; recorded candidate `98c8f32ec9d1745bd3b7bf0dae5450b23ce800e8`; accepted local integration `c990662e91604cfd38baa53e12bfb6e7c60610eb` | PASS: 40 suites / 768 tests; final production-boundary recheck 6 suites / 218 tests; final fixture/record recheck 2 suites / 92 tests; scoped compiler, 80-path lint, build, generation/freshness and document checks. Integration tree equals the checked candidate. | A complete; owned cleanup verified; B may start under operator direction |
| B | Accepted prerequisite base `c990662e91604cfd38baa53e12bfb6e7c60610eb`; not started | A prerequisite evidence accepted; no B implementation evidence | Operator-launched B1–B3, focused tests/parity, candidate checks, operator-directed integration, owned cleanup |

### A implementation and backend ownership — 2026-09-13

A1–A3 were implemented in the assigned worktree and are accepted on local `master`. The override row now belongs to SQLite migration
51, and the command kernel verifies the executor's readback against the same transaction repository
before recording success. Commit validates the applied audit; injected audit failure and fabricated
executor success both roll back. Stopped conversion admits schemas 46–50, proves the complete
presentation history against command/audit records, and writes a source/database/backup receipt.
Pending claims require the original compatible release. Fresh startup refuses orphan file evidence;
current-schema reads and replay ignore obsolete files. Released migration statements 1–50 and
recovery floor 46 are unchanged. All conversion and restore runs used disposable synthetic fixtures.

The following are actual production bindings for B's release record. Paths are repository-relative.
The downstream column names the exclusive intended surface owner after complete 3.1.9 admission;
this record does not launch or admit a child. B owns its assigned UI/client/fixture extraction and
must preserve these backend interfaces. Existing command families remain available through the
shared strict command ingress and command kernel; no surface needs a new root dispatch switch to
invoke its existing operations.

| Downstream owner | Exclusive backend paths / exports | Production operations |
| --- | --- | --- |
| 3.1.9.1 · Shell | `src/server/dashboard/routes/shell.ts` (`registerShellRoutes`), `shell-types.ts` (`ShellRouteDeps`); `src/server/dashboard/compose/shell.ts` (`composeShell`); `queries/bootstrap.ts` (`BootstrapQueryDeps`, `buildBootstrap`) | Bootstrap, signed cross-date search, evidenced XLSX export, bounded resumable SSE subscription. Production binds real authority, search, export service and stream hub. |
| 3.1.9.2 · Settings | `routes/settings.ts`, `settings-types.ts` (`registerSettingsRoutes`, `SettingsRouteDeps`); `routes/settings-preflight.ts`, `settings-preflight-types.ts` (`registerSettingsPreflightRoutes`, `SettingsPreflightRouteDeps`); `compose/settings.ts` (`composeSettings`) | Facts, editable inventory, ordinary/protected settings executor and preflight rerun. SQLite settings and independent credential authority remain separate; existing settings wire modules remain their owners. |
| 3.1.9.3 · Storage | `routes/storage.ts`, `storage-types.ts` (`registerStorageRoutes`, `StorageRouteDeps`); `compose/storage.ts` (`composeStorage`) | Real storage doctor with explicit state-root trust anchor, authority path, backup directory and service state. |
| 3.1.9.4 · Explorer/Catalog | `routes/explorer.ts`, `explorer-types.ts` (`registerExplorerRoutes`, `ExplorerRouteDeps`); `compose/explorer.ts` (`composeExplorer`); `commands/explorer-edit-service.ts`; `queries/explorer.ts`, `queries/ui-catalog.ts`; `src/domain/dashboard/explorer.ts` | One-snapshot graph/validation, committed UI catalog read, preview/code-change brief, command apply/conflict/refusal/replay through the accepted SQLite repository. Catalog routing/composition belongs here, not to Settings. |
| 3.1.9.5 · Notifications | `compose/notifications.ts` (`createTrustNotifications`, `readGateParks`); existing `src/services/notifications/` and `src/domain/notifications.ts`, `notification-triggers.ts` | Durable inbox publication/read, gate-park/backfill notifications; existing notification command family and day/SSE wire provide read/unread/snooze and readback. |
| 3.1.9.6 · Intake | `routes/intake.ts`, `intake-types.ts` (`registerIntakeRoutes`, `IntakeRouteDeps`); `compose/intake.ts` (`composeIntake`); existing `commands/intake-service.ts`, `src/domain/intake/` | Bounded upload, session read, verified attachment preparation, all existing intake commands through shared ingress; preparation still precedes execution. |
| 3.1.9.7 · Archive | `routes/archive.ts`, `archive-types.ts` (`registerArchiveRoutes`, `ArchiveRouteDeps`); `compose/archive.ts` (`createOperatorArchive`); existing archive query/service and dedicated domain modules | Saved indexes, report/file/capture read and exact download leases, version read, existing version/relaunch/delete command families and typed refusals. Saved-report authority and download headers/identity checks are unchanged. |
| Later Queue / Activity owners | `routes/queue.ts`, `queue-types.ts`, `compose/queue.ts`, `compose/queue-summaries.ts`, `queries/queue-summaries.ts`; separately `routes/activity.ts`, `activity-types.ts`, `compose/activity.ts`, `queries/activity-summaries.ts` | Queue day/member/action summaries and stable bounded paging remain one projection; Activity named-range JSON/CSV reads the real indexed summary query and independent confirmed-transaction history. `queryQueueSummaries` and `queryActivitySummaries` have separate implementations. |
| Later Run Detail owner | `routes/run-detail.ts`, `run-detail-types.ts`, `compose/run-detail.ts`; existing `routes/data.ts`, `compose/data.ts` | Run detail, section/advisory and data queries keep their real service adapters. Existing trust resource routes/types/composition remain dedicated supporting boundaries. No new detail/session behavior is included. |

Within the table, unqualified `routes/`, `compose/`, `queries/` and `commands/` paths are beneath
`src/server/dashboard/`. Each route type lives beside its route, not in a shared interface every
surface must edit. `DashboardAppDeps` remains an aggregate compatibility entry point for existing
fixtures. Its optional Activity adapter preserves those fixtures; production always supplies
`composeActivity`. `compose/operator.ts` and `queries/run-summaries.ts` contain compatibility exports,
not duplicate implementations. New callers should use the dedicated modules.

Reserved shared owners remain `routes/api.ts` / `api-types.ts` (registration and request identity),
`routes/commands.ts` / `commands-types.ts` (strict acceptance, execute/bulk, exact replay and Intake
prepare), `routes/loopback.ts`, the command union/kernel, SQLite schemas/recovery, runtime lifetime and
preflight composition, the stream protocol, generated export registration, the common status fold
`queries/run-summary-status.ts`, root configuration and combined scene membership. Existing
`src/domain/dashboard/` wire files keep their matching surface owners; the new
`src/domain/dashboard/explorer-override.ts` and `src/infra/sqlite/explorer-*` files are accepted
prerequisite authority, reserved against sibling storage redesign.

The shared `tests/unit/server/bff-flow.test.ts` and `compose-real-port.test.ts` remain integration
proofs pending B's assigned fixture extraction. `tests/fixtures/explorer-authority.ts` and
`tests/unit/server/explorer-sqlite-authority.test.ts` provide Explorer-specific disposable authority
fixtures/proofs; `explorer-override-store.test.ts` now owns stopped-source conversion rather than the
retired runtime file protocol. `surface-boundaries.test.ts` proves real independent Activity/Queue
ports and remains shared integration evidence. Tests use the repository runner's private temporary
roots and no operator state. Future sibling gates must retain separate worktrees and their runner
resources; B owns the final fixture/spec/reference allocation and either-order release evidence.

No generated input ownership is transferred to a sibling: the workflow manifest
`src/domain/workflow/generated-build-manifest.ts`, UI catalog generation and
`docs/roadmap/index.html` remain their generator/finalizer's responsibility. A regenerated the
workflow manifest without changing its bytes; no source-authored workflow, catalog input, frontend
component, parity fixture or reference image changed. B and both downstream finalizers retain their
assigned broader acceptance obligations. Full repository gates remain 3.1.19.

### A verification receipt

Implementation candidate: `1bdc41406a7725d900a2bfa48af4ff48a23dc432`; approved base:
`367a2a51848153a63b1c4219bea2b66d07a93671`. This evidence update changes only the owning task record;
the implementation, contract, test, dependency and configuration inputs remain those of that commit.
The accepted A integration keeps 3.1.9 open for B and B's subsequent directed integration/cleanup.

Evidence root: `/Users/julianhein/Projects/hr-boundary-data-evidence-20260913/run-103137/`.

| Check | Accepted result and exact receipt |
| --- | --- |
| Complete A focused set plus affected consumers/guards | PASS: 40 files / 768 tests, exit 0; `focused-tests-final.log`, exact argv in `focused-tests-final-argv.json`. Includes all eleven named A suites, atomic/conversion tests, real backend boundaries and recovery/privacy/ingress regressions. |
| Final Shell/Catalog extraction | PASS: 6 files / 218 tests, exit 0; `a3-production-final.log`. Exact command: `npm run test -- tests/unit/server/compose-real-port.test.ts tests/unit/server/bff-flow.test.ts tests/unit/server/surface-boundaries.test.ts tests/unit/architecture/operator-mutation-admission.test.ts tests/unit/architecture/workflow-editor-compile-integrity.test.ts tests/unit/architecture/dashboard-wire-boundary.test.ts`. |
| Final strict fixture/record recheck | PASS: 2 files / 92 tests, exit 0; `record-tests.log`. `npm run test -- tests/unit/command-kernel.test.ts tests/unit/architecture/roadmap-doc-binding.test.ts`. |
| Scoped compiler | PASS, exit 0; `npx tsc --project /Users/julianhein/Projects/hr-boundary-data-evidence-20260913/run-103137/tsconfig.focused.json`; exact changed roots plus their imported closure, repository compiler options, no suppressed diagnostics. This is not the deferred whole-repository typecheck. |
| Scoped lint | PASS, exit 0; `lint.log` and exact 80-path `lint-argv.json`. NUL-delimited changed/untracked selection from the approved base, direct argv, `--max-warnings 0`. |
| Production dashboard build | PASS, exit 0; `npm run web:build`, `web-build.log`. Vite reported its non-failing 500 kB chunk warning; no threshold was changed. |
| Generated artifacts | PASS, exit 0; `npm run build:manifest` then `npm run build:manifest:check`; `npm run roadmap` then `npm run roadmap:check`. Commands/results in `final-checks.json`; generated bytes are unchanged. Catalog inputs are unchanged. |
| Registration and document audit | PASS: exact multiset of 48 route/middleware registrations preserved (`route-inventory.mts` / `.json`); hostile-ingress order covered by the architecture and HTTP tests. `audit-candidate.py` / `candidate-audit.json` verifies scope, links/fragments, unchanged protected inputs/parent checkboxes, nine identical instruction pairs and a maximum 18,376-byte chain below 32,768. |
| Commit whitespace | PASS: `git diff --cached --check`; five new files lost trailing blank lines only before commit. `eof-whitespace-equality.json` binds before/after digests and proves no other bytes changed, supporting reuse of their already-passed behavior/compiler checks. `implementation-diff.patch` retains the exact committed candidate. |

All successful runner receipts report exit 0 and removal of their private scratch. Earlier failed
iteration logs remain evidence of repaired defects and are not acceptance results. No independent
review, whole-repository lint/coverage, broad parity, operator-state conversion or live external-system
acceptance is claimed. Full repository gates remain 3.1.19; B retains its assigned UI/parity proofs.

### A accepted integration and cleanup — 2026-09-13

A's accepted integration SHA for B is **`c990662e91604cfd38baa53e12bfb6e7c60610eb`**.
The operator's `ok` authorized the explicit candidate-merge request. Local `master` accepted recorded
candidate `98c8f32ec9d1745bd3b7bf0dae5450b23ce800e8` with a conflict-free `--no-ff` merge from
approved base `367a2a51848153a63b1c4219bea2b66d07a93671`. Both merge parents are retained, and
merge tree `9230577392d5f33dd5e003b209211914d3900f46` exactly equals the checked candidate tree.
Pre-integration verification matched all 2,460 recorded non-owner file hashes and all 32 evidence
hashes. The focused results above are reused on those identical inputs; no broad gate is claimed.
`integration-merge.log` and `integration-accepted.json` record the operation and equality proof.

Owned cleanup is complete: the worktree registration and physical path
`/Users/julianhein/Projects/hr-worktree-boundary-data` are absent, and
`codex/3.1.9-boundary-data` was deleted with `git branch -d` after ancestry verification.
Only the owned dashboard build and dependency symlink accompanied ordinary `git worktree remove`;
shared dependencies remain intact. The six failed-iteration scratch roots listed in
`integration-preparation.json` were removed only after matching their exact owner receipts and
verifying absent process groups. `cleanup-pre-removal.json` preserves the build-file hashes;
`cleanup-complete.json` records removal and retained evidence. The calling task remains visible;
there is no separately assigned task to archive.

This closure changes only the owning task record. Roadmap generation/freshness, document
links/fragments, unchanged parent checkboxes, instruction twins and whitespace were checked;
`closure-checks.json` and `closure-audit.json` contain exact results. No production, test,
dependency, configuration or generated bytes changed after accepted integration.

B must verify the named accepted SHA and approved-plan ancestry before creating its assigned
branch/worktree. This later evidence-only closure does not replace B's named implementation base.
A is complete. B, all seven surface children and the overall 3.1.9 checklist remain unstarted/open;
no task was launched and nothing was pushed. Full repository gates remain at 3.1.19.

### A delivery assessment

No scope amendment, worker dispatch or independent review occurred. Development repairs covered
backup table-order registration, stale schema-version fixtures, source moved beneath architecture
allowlists, strict operational-interface/redaction registrations, and complete transaction readback.
These were implementation/proof compatibility repairs within A1–A3, not new operator scope. The
failed and passing focused logs are retained beside the final evidence. One context compaction
required resumed-state verification. No elapsed-time or planning-efficiency estimate is claimed.
Checking each moved source against its exact guard/egress registry before the first combined run
would have reduced these repair reruns. The approved sequential A/B allocation and 3.1.19 gate
cadence remain unchanged.

Planning persistence is documentation-only in the clean primary checkout. At persistence preflight,
the app's task inventory showed this planning task as the only active task in the repository; other
listed tasks were idle or not loaded. Recheck Git before committing and preserve unrelated changes.
The planning handoff supplies the verified full plan SHA, documentation check results, A's resolved
creation prompt and B's explicit predecessor-resolution condition. No product implementation starts
in the planning session, and no implementation checklist is completed by planning approval.

### Planning validation — 2026-09-13

The approved plan and allocation amendment affect eight documentation/generated paths only. Source,
tests, scripts, runtime configuration, dependencies and parity reference bytes are unchanged from
`ecd2d84e25a2622b4faf689289e598d89455f6b3`. No prior product gate is presented as fresh acceptance of
this planned implementation. Required product checks remain assigned to A/B and the later finalizers.

| Check | Result / evidence |
| --- | --- |
| `npm run test -- tests/unit/architecture/roadmap-doc-binding.test.ts` | PASS: 24 tests, exit 0. |
| `npx eslint tests/unit/architecture/roadmap-doc-binding.test.ts scripts/generate-roadmap.ts scripts/roadmap --max-warnings 0` | PASS, exit 0. |
| `npm run roadmap` and `npm run roadmap:check` | PASS, exit 0; generated output is produced by the repository generator. |
| `python3 /Users/julianhein/Projects/hr-boundary-plan-evidence-20260913/audit.py` | PASS: all eight changed paths admitted; 13 owner/introduced links and fragments; nine instruction pairs identical; maximum instruction chain 18,376 bytes, below 32,768; approved control presence, named existing test paths and prerequisite ancestry checked. Expected outcomes, acceptance identities, roadmap node identities/statuses/dependencies and product inputs remain unchanged. |
| `git diff --check` | PASS. |

Evidence root: `/Users/julianhein/Projects/hr-boundary-plan-evidence-20260913/`. The audit recipe and
JSON record bind scope and content; `roadmap-binding.log`, `lint.log` and `roadmap-check.log` retain
the command results. Recording this receipt adds no product input or roadmap binding change; the
passed binding/lint results are reused on that inspected basis. Regenerate/check the final roadmap
and rerun the document audit/whitespace check before committing. The final planning handoff verifies
the committed owner bytes against this checked file, plan reachability, prerequisites and Git state.
