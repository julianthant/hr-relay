# Dashboard inventory at the approved baseline

Evidence companion to [3.1.8](task-8-re-baseline-dashboard-truth-and-acceptance.md); the approved task remains the sole execution owner.
Source: `e182022edfa0cd05a46a74358cd3296bcade6e79`. Product: accepted 2.6 at `d4c599edece5bd53a61fa13f85708ab6bfb0935a`, integrated by `81bd3e3841005edc57b7d4820d41e529f73e88ac` and recorded by `3549973552377f50b2bb690f0de0bcee981dd159`.

## Reading the inventory

W = working within the expressly cited accepted backend proof; P = implemented but insufficiently proven for the full journey; F = incomplete/defective; D = deliberately deferred. Superseded historical requirements are mapped separately below. W does not close its future task or claim new browser/live acceptance. Every I row maps to its same-numbered A row in the [acceptance matrix](task-8-acceptance-matrix.md). All listed tests exist at this source; unless called out in the task gate record, they were inspected/reused, not rerun.

All runtime mutations still enter the loopback ingress guard and registered command kernel, with admitted actor, strict body, revision/digest and canonical service authority. A display projection, fixture response, browser cache or successful HTTP transport is not mutation authority. Route registration is `src/server/dashboard/routes/api.ts` (`createDashboardApp`), with `operator.ts`, `data.ts` and `trust.ts`; production dependency wiring is `src/server/dashboard/compose.ts`. The command and source census below preserves exact locations rather than relying on comments describing older storage.

## Current inventory

### I01 · Navigate the dashboard

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.9.1 / **P** |
| Controls and fields | Dashboard/Archive/Explorer/Activity, Back/Forward, Settings, start, intake; day/run/section/archiveView/catalog/catalogView coordinates. |
| Source / authority trace | [src/dashboard/app/url-state.ts](../../../../../src/dashboard/app/url-state.ts); [src/dashboard/app/dashboard-app.tsx](../../../../../src/dashboard/app/dashboard-app.tsx); [src/dashboard/surfaces/top-bar.tsx](../../../../../src/dashboard/surfaces/top-bar.tsx) |
| Actual behavior and limit | Production takeovers share LoadedApp; selection and view are URL-owned. Archive filter drafts are local. Fixture navigation inspected. |
| Existing proof inputs | [tests/parity/dashboard-reference.spec.ts](../../../../../tests/parity/dashboard-reference.spec.ts) |
| Remaining acceptance | [A01](task-8-acceptance-matrix.md#a01) — No hidden competing takeover or stale run selection; full navigation race/dirty-draft matrix remains owner proof. |

### I02 · Resize, theme and keyboard

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.9.1 / **P** |
| Controls and fields | Theme, workflow panel modes, workflow selection, status filters, shortcuts, focus and toast reachability. |
| Source / authority trace | [src/dashboard/app/global-keys.ts](../../../../../src/dashboard/app/global-keys.ts); [src/dashboard/surfaces/shell.tsx](../../../../../src/dashboard/surfaces/shell.tsx); [src/dashboard/surfaces/top-bar.tsx](../../../../../src/dashboard/surfaces/top-bar.tsx); [src/dashboard/app/index.css](../../../../../src/dashboard/app/index.css) |
| Actual behavior and limit | 1280×720 Settings and 1024×768 seeded detail inspected. At 900×600 the document measured 1024×720. Browser zoom was not tested. |
| Existing proof inputs | [tests/parity/shell-toast-floor.spec.ts](../../../../../tests/parity/shell-toast-floor.spec.ts); [tests/parity/toolbar-desktop-target.spec.ts](../../../../../tests/parity/toolbar-desktop-target.spec.ts) |
| Remaining acceptance | [A02](task-8-acceptance-matrix.md#a02) — No mobile/coarse-pointer return; no CSS zoom claimed as browser zoom. D01–D05 below remain required. |

### I03 · Edit ordinary Settings

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.9.2 / **F** |
| Controls and fields | actor.label; display.screenWidth/screenHeight; ocr.pageConcurrency/maxValidationRetries; timeouts.duoApprovalSeconds; concurrency.defaultWorkers; paths.reportsDir; Save, Reset, Discard, exit guard, errors and Saved/Default badges. |
| Source / authority trace | [src/server/dashboard/queries/settings-editor.ts](../../../../../src/server/dashboard/queries/settings-editor.ts); [src/dashboard/surfaces/settings.tsx](../../../../../src/dashboard/surfaces/settings.tsx); [src/dashboard/surfaces/settings-model.ts](../../../../../src/dashboard/surfaces/settings-model.ts) |
| Actual behavior and limit | Eight leaves in EDITABLE_LEAVES. Reset restores the loaded effective value; it does not clear a persisted override. Full catalog/set-clear UI is missing. |
| Existing proof inputs | [tests/unit/dashboard/settings-editor-surface.test.ts](../../../../../tests/unit/dashboard/settings-editor-surface.test.ts); [tests/unit/dashboard/settings-editor-client.test.ts](../../../../../tests/unit/dashboard/settings-editor-client.test.ts) |
| Remaining acceptance | [A03](task-8-acceptance-matrix.md#a03) — No fabricated default, silent conflict success or blanket restart requirement. P40/A8 editor expansion and deliberate reviewed refreeze remain here. |

### I04 · Manage independent credentials and display facts

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.9.2 / **F** |
| Controls and fields | Full 86-row application catalog, editability/source/presence/revision, provider environment families, observed host display beside saved override. |
| Source / authority trace | [src/domain/config/catalog.ts](../../../../../src/domain/config/catalog.ts); [src/domain/dashboard/settings-editor.ts](../../../../../src/domain/dashboard/settings-editor.ts); [src/server/dashboard/queries/settings.ts](../../../../../src/server/dashboard/queries/settings.ts); [src/dashboard/surfaces/settings.tsx](../../../../../src/dashboard/surfaces/settings.tsx) |
| Actual behavior and limit | Bounded editor cannot present all catalog or protected operations. Host-derived defaults exist at the producer; full readback presentation is unproven. |
| Existing proof inputs | [tests/unit/config-host-display.test.ts](../../../../../tests/unit/config-host-display.test.ts); [tests/unit/server/settings-runtime-reader.test.ts](../../../../../tests/unit/server/settings-runtime-reader.test.ts) |
| Remaining acceptance | [A04](task-8-acceptance-matrix.md#a04) — No credential value/digest in DOM, logs or snapshot; no test subjects/canaries/fixture paths as settings. Test missing/present/conflicting protected revisions. |

### I05 · Save settings and create new work

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.11.2 / **W** |
| Controls and fields | Ordinary settings revision, selected snapshot, start-plan review and accepted-command replay. |
| Source / authority trace | [src/server/settings-runtime.ts](../../../../../src/server/settings-runtime.ts); [src/server/dashboard/commands/settings-service.ts](../../../../../src/server/dashboard/commands/settings-service.ts); [src/server/dashboard/commands/start-plan-service.ts](../../../../../src/server/dashboard/commands/start-plan-service.ts) |
| Actual behavior and limit | Accepted 2.6 S/F07 tests prove atomic save/new-run selection, existing snapshots and stale-plan refusal. This is backend credit, not completed modal acceptance. |
| Existing proof inputs | [tests/unit/settings-activation/save-create.test.ts](../../../../../tests/unit/settings-activation/save-create.test.ts); [tests/unit/settings-activation/stale-plan.test.ts](../../../../../tests/unit/settings-activation/stale-plan.test.ts); [tests/unit/settings-activation/mixed-execution.test.ts](../../../../../tests/unit/settings-activation/mixed-execution.test.ts) |
| Remaining acceptance | [A05](task-8-acceptance-matrix.md#a05) — No partial snapshot, quota reset, silently accepted stale preview, or new run during review. Browser save-to-start crossover still required. |

### I06 · Read storage health and recovery instructions

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.9.3 / **P** |
| Controls and fields | Storage health, doctor, backup age/generation, integrity findings, explicit backup/restore/upgrade instructions. |
| Source / authority trace | [src/dashboard/surfaces/settings.tsx](../../../../../src/dashboard/surfaces/settings.tsx); [src/server/dashboard/queries/storage.ts](../../../../../src/server/dashboard/queries/storage.ts); [src/server/dashboard/routes/operator.ts](../../../../../src/server/dashboard/routes/operator.ts) |
| Actual behavior and limit | Fixture doctor control inspected. Accepted schema 50/floor 46 recovery tests exist; current operator state was not opened. |
| Existing proof inputs | [tests/unit/storage-restore-drill.test.ts](../../../../../tests/unit/storage-restore-drill.test.ts); [tests/unit/storage-upgrade-admission.test.ts](../../../../../tests/unit/storage-upgrade-admission.test.ts) |
| Remaining acceptance | [A06](task-8-acceptance-matrix.md#a06) — No automatic backup, restore or upgrade, below-floor conversion, fake healthy default or available-looking unsupported repair button. |

### I07 · Setup and preflight

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.11.1 / **F** |
| Controls and fields | Retained check names, severity, availability, timestamps; Rerun preflight; settings/storage/ports/orphan and workflow prerequisites. |
| Source / authority trace | [src/dashboard/surfaces/settings.tsx](../../../../../src/dashboard/surfaces/settings.tsx); [src/server/preflight/dashboard-runners.ts](../../../../../src/server/preflight/dashboard-runners.ts); [src/domain/trust/preflight-scenarios.ts](../../../../../src/domain/trust/preflight-scenarios.ts); [src/server/dashboard/routes/api.ts](../../../../../src/server/dashboard/routes/api.ts) |
| Actual behavior and limit | Six dashboard runners are composed. The declared wider fault corpus is not an executed acceptance lane; fixture explicitly says no retained report. |
| Existing proof inputs | [tests/unit/preflight-dashboard-runners.test.ts](../../../../../tests/unit/preflight-dashboard-runners.test.ts); [tests/unit/dashboard/preflight-client.test.ts](../../../../../tests/unit/dashboard/preflight-client.test.ts) |
| Remaining acceptance | [A07](task-8-acceptance-matrix.md#a07) — No inferred healthy prerequisites, leaked secret values, automatic repair side effect or browser launch for blocked workflow. Full fault-corpus executor belongs here. |

### I08 · Read workflow structure

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.9.4 / **P** |
| Controls and fields | Workflow list, proving-harness labels, node selection, graph/when, contracts, origins, editable fields, UI links and Version registry. |
| Source / authority trace | [src/dashboard/surfaces/explorer.tsx](../../../../../src/dashboard/surfaces/explorer.tsx); [src/server/dashboard/queries/explorer.ts](../../../../../src/server/dashboard/queries/explorer.ts) |
| Actual behavior and limit | Fixture graph and version door inspected; production query uses registered descriptor facts. |
| Existing proof inputs | [tests/parity/dashboard-reference.spec.ts](../../../../../tests/parity/dashboard-reference.spec.ts) |
| Remaining acceptance | [A08](task-8-acceptance-matrix.md#a08) — No invented graph node, editable structural promise or current descriptor interpretation of an archived report. Cyclic/manifest-drift proofs stay required. |

### I09 · Review and apply Explorer edits

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.9.4 / **F** |
| Controls and fields | Label/icon/category edit, validation, preview/diff, apply/readback; source-change briefs for structural policy. |
| Source / authority trace | [src/server/dashboard/commands/explorer-edit-service.ts](../../../../../src/server/dashboard/commands/explorer-edit-service.ts); [src/server/dashboard/commands/explorer-override-store.ts](../../../../../src/server/dashboard/commands/explorer-override-store.ts); [src/dashboard/surfaces/explorer-model.ts](../../../../../src/dashboard/surfaces/explorer-model.ts) |
| Actual behavior and limit | Closed presentation editor exists. explorer-override-store.ts still uses a file-backed prepared-claim/finalize protocol; the approved D337 single-SQLite transaction remains missing. |
| Existing proof inputs | [tests/parity/dashboard-reference.spec.ts](../../../../../tests/parity/dashboard-reference.spec.ts) |
| Remaining acceptance | [A09](task-8-acceptance-matrix.md#a09) — No stale/cyclic/schema/selector/graph hot-apply or lost override after restart. Owner must trace current persistence before proposing a migration. |

### I10 · Inspect UI catalog and help

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.9.4 / **P** |
| Controls and fields | Settings UI catalog term/view, selector facts, row/panel vocabulary, Keyboard help and specimen. |
| Source / authority trace | [src/dashboard/surfaces/ui-catalog.tsx](../../../../../src/dashboard/surfaces/ui-catalog.tsx); [src/dashboard/surfaces/row-catalog.tsx](../../../../../src/dashboard/surfaces/row-catalog.tsx); [src/server/dashboard/queries/ui-catalog.ts](../../../../../src/server/dashboard/queries/ui-catalog.ts); [src/dashboard/surfaces/shortcuts.tsx](../../../../../src/dashboard/surfaces/shortcuts.tsx) |
| Actual behavior and limit | Catalog is subordinate to Settings; selector and row vocabulary are separate views. Full catalog cross-links not browser exercised here. |
| Existing proof inputs | [tests/parity/kit-reference.spec.ts](../../../../../tests/parity/kit-reference.spec.ts) |
| Remaining acceptance | [A10](task-8-acceptance-matrix.md#a10) — No new test-only Settings catalog, bare catalog takeover or claim that a declared verification scenario ran. |

### I11 · Use the notification inbox

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.9.5 / **P** |
| Controls and fields | Bell counts, read/unread, snooze/dismiss, linked run/failure, delivery setting and retained state. |
| Source / authority trace | [src/dashboard/surfaces/top-bar.tsx](../../../../../src/dashboard/surfaces/top-bar.tsx); [src/dashboard/surfaces/top-bar-model.ts](../../../../../src/dashboard/surfaces/top-bar-model.ts); [src/services/notifications/inbox.ts](../../../../../src/services/notifications/inbox.ts) |
| Actual behavior and limit | Durable inbox and shared settlement exist; fixture bell/count is visible. Full command/navigation journey unexecuted here. |
| Existing proof inputs | [tests/unit/notification-inbox.test.ts](../../../../../tests/unit/notification-inbox.test.ts); [tests/unit/dashboard/notification-inbox-model.test.ts](../../../../../tests/unit/dashboard/notification-inbox-model.test.ts) |
| Remaining acceptance | [A11](task-8-acceptance-matrix.md#a11) — No delivery-success inference from row existence, lost state after restart or secret/free-text notification payload. |

### I12 · Publish notification triggers

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.9.5 / **F** |
| Controls and fields | run-failed, subject-mismatch, gate-opened, write-parked, repeating-failure, storage-degraded, verified-done, backfill-gap; storage concern arms. |
| Source / authority trace | [src/domain/notification-triggers.ts](../../../../../src/domain/notification-triggers.ts); [src/server/dashboard/compose/trust.ts](../../../../../src/server/dashboard/compose/trust.ts); [src/services/notifications/storage-health.ts](../../../../../src/services/notifications/storage-health.ts); [src/server/dashboard/compose.ts](../../../../../src/server/dashboard/compose.ts) |
| Actual behavior and limit | Production gate, backup-health and backfill-gap composition is traced. Closed event types alone do not prove every other producer; full trigger coverage is missing. |
| Existing proof inputs | [tests/unit/notification-gate-park.test.ts](../../../../../tests/unit/notification-gate-park.test.ts); [tests/unit/notification-backfill-gap.test.ts](../../../../../tests/unit/notification-backfill-gap.test.ts); [tests/unit/architecture/notification-durability.test.ts](../../../../../tests/unit/architecture/notification-durability.test.ts) |
| Remaining acceptance | [A12](task-8-acceptance-matrix.md#a12) — No fake producer deletion to make enumeration green. Record precise missing callers before implementation; retired outbox tables cannot be recreated for a label. |

### I13 · Upload and map intake

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.9.6 / **P** |
| Controls and fields | Run-modal file handoff, session URL, source hash/name/rows, worksheet/header detection, field mapping, constants, required fields and cancel/close. |
| Source / authority trace | [src/dashboard/surfaces/intake.tsx](../../../../../src/dashboard/surfaces/intake.tsx); [src/dashboard/surfaces/intake-model.ts](../../../../../src/dashboard/surfaces/intake-model.ts); [src/server/dashboard/commands/intake-service.ts](../../../../../src/server/dashboard/commands/intake-service.ts) |
| Actual behavior and limit | Production file route and imported-artifact service exist; source mapping inspected, not a fresh upload acceptance run. |
| Existing proof inputs | [tests/unit/intake-header-discovery.test.ts](../../../../../tests/unit/intake-header-discovery.test.ts); [tests/unit/intake-mapping.test.ts](../../../../../tests/unit/intake-mapping.test.ts); [tests/unit/server/intake-surface.test.ts](../../../../../tests/unit/server/intake-surface.test.ts) |
| Remaining acceptance | [A13](task-8-acceptance-matrix.md#a13) — No merge of same-byte independent imports, raw secret exposure or synthetic session before upload. Run/Rerun internals remain 3.1.11.2. |

### I14 · Review intake and hand off work

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.9.6 / **P** |
| Controls and fields | Fix/exclude rejection rows, review acknowledgement, prepare, immutable manifest/member counts, Run rows, result vector, compare and rerun diff. |
| Source / authority trace | [src/dashboard/surfaces/intake.tsx](../../../../../src/dashboard/surfaces/intake.tsx); [src/server/dashboard/commands/intake-service.ts](../../../../../src/server/dashboard/commands/intake-service.ts); [src/domain/intake/manifest.ts](../../../../../src/domain/intake/manifest.ts) |
| Actual behavior and limit | Imported artifacts replace intake_sessions/intake_manifests and preserve their identities. Full reject-review and handoff journey remains proof work. |
| Existing proof inputs | [tests/unit/intake-validation.test.ts](../../../../../tests/unit/intake-validation.test.ts); [tests/unit/intake-command-arms.test.ts](../../../../../tests/unit/intake-command-arms.test.ts) |
| Remaining acceptance | [A14](task-8-acceptance-matrix.md#a14) — No mutable old manifest, unnoticed skipped rows, duplicate enqueue, artifact outbox restoration or archived-source execution door. |

### I15 · Find saved reports

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.9.7 / **P** |
| Controls and fields | Workflow/title/version/outcome, completed/captured UTC ranges; clear/first/next/refresh/select; URL archive and archiveView. |
| Source / authority trace | [src/dashboard/surfaces/archive-report.tsx](../../../../../src/dashboard/surfaces/archive-report.tsx); [src/dashboard/surfaces/archive-report-model.ts](../../../../../src/dashboard/surfaces/archive-report-model.ts); [src/server/dashboard/queries/archive-reports.ts](../../../../../src/server/dashboard/queries/archive-reports.ts) |
| Actual behavior and limit | Indexed saved-report list and filters shipped in H. Fixture selection works; local filter state does not survive reload. Full history/filter acceptance remains open. |
| Existing proof inputs | [tests/unit/archive-report-ui/render.test.ts](../../../../../tests/unit/archive-report-ui/render.test.ts); [tests/parity/archive-report.spec.ts](../../../../../tests/parity/archive-report.spec.ts) |
| Remaining acceptance | [A15](task-8-acceptance-matrix.md#a15) — No live-run enumeration for historical report viewing or unsupported all-time Activity population. Reconcile filter/history behavior explicitly in leaf proof. |

### I16 · Read and download frozen evidence

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.9.7 / **W** |
| Controls and fields | Saved title/workflow/version/outcome/time, labelled values/tables/text/unavailable sections, version record and attachment names/downloads. |
| Source / authority trace | [src/dashboard/surfaces/archive-report.tsx](../../../../../src/dashboard/surfaces/archive-report.tsx); [src/server/dashboard/queries/archive-reports.ts](../../../../../src/server/dashboard/queries/archive-reports.ts); [src/server/dashboard/routes/operator.ts](../../../../../src/server/dashboard/routes/operator.ts) |
| Actual behavior and limit | Accepted A/H proofs cover descriptor-independent reports and safe bytes. Fixture report renders synthetic retired workflow. No whole-report Export control is exposed by SavedArchiveReport. |
| Existing proof inputs | [tests/unit/archive-report-ui/no-live-schema.test.ts](../../../../../tests/unit/archive-report-ui/no-live-schema.test.ts); [tests/unit/archive-report-ui/download.test.ts](../../../../../tests/unit/archive-report-ui/download.test.ts); [tests/unit/archive-transfer/frozen-claims.test.ts](../../../../../tests/unit/archive-transfer/frozen-claims.test.ts) |
| Remaining acceptance | [A16](task-8-acceptance-matrix.md#a16) — No invented verification tooltip from a generic done outcome (current list reuses StatusPill); no unbound digest, traversal or privileged bytes. Owner must resolve tooltip/export gaps. |

### I17 · Review a version change

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.9.7 / **P** |
| Controls and fields | Application/workflow scope, major/minor, what/why, Create review, reviewed membership/blockers, Apply/resume, progress and Open archive. |
| Source / authority trace | [src/dashboard/surfaces/archive-report.tsx](../../../../../src/dashboard/surfaces/archive-report.tsx); [src/server/dashboard/commands/version-review-binding.ts](../../../../../src/server/dashboard/commands/version-review-binding.ts); [src/domain/dashboard/archive.ts](../../../../../src/domain/dashboard/archive.ts) |
| Actual behavior and limit | Version form is reachable. Backend uses version_changes and recoverable transfer, not version_plans/archive_relaunches. |
| Existing proof inputs | [tests/parity/archive-report.spec.ts](../../../../../tests/parity/archive-report.spec.ts); [tests/unit/archive-transfer/recovery.test.ts](../../../../../tests/unit/archive-transfer/recovery.test.ts) |
| Remaining acceptance | [A17](task-8-acceptance-matrix.md#a17) — No active-source transfer, second application, relaunch or invented fresh version after refusal. Browser membership, replay and recovery proof remains required. |

### I18 · Delete a live or saved run

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.9.7 / **W** |
| Controls and fields | Saved report Delete/Keep/Confirm, exact report fingerprint, tally and idempotency-key warning; live deletion counterpart in I27. |
| Source / authority trace | [src/dashboard/surfaces/archive-report.tsx](../../../../../src/dashboard/surfaces/archive-report.tsx); [src/server/dashboard/queries/archive-reports.ts](../../../../../src/server/dashboard/queries/archive-reports.ts); [src/core/run-record-service.ts](../../../../../src/core/run-record-service.ts) |
| Actual behavior and limit | A/H accepted reference-aware deletion and replay; report confirmation warns that keys may be released. No deletion executed during this inventory. |
| Existing proof inputs | [tests/unit/archive-transfer/deletion.test.ts](../../../../../tests/unit/archive-transfer/deletion.test.ts); [tests/unit/archive-transfer/unrelated-file-deletion.test.ts](../../../../../tests/unit/archive-transfer/unrelated-file-deletion.test.ts) |
| Remaining acceptance | [A18](task-8-acceptance-matrix.md#a18) — No active deletion, resurrection, wrong-report close after selection switch, hidden partial deletion or changed replay. Live UI commands belong 3.1.13; paired convergence at 3.1.16. |

### I19 · Select a calendar day

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.10 / **P** |
| Controls and fields | Previous/next/today, picker month/year/day, date count, timezone, selection and browser history. |
| Source / authority trace | [src/dashboard/surfaces/top-bar.tsx](../../../../../src/dashboard/surfaces/top-bar.tsx); [src/dashboard/surfaces/top-bar-model.ts](../../../../../src/dashboard/surfaces/top-bar-model.ts); [src/dashboard/app/url-state.ts](../../../../../src/dashboard/app/url-state.ts); [src/dashboard/state/use-dashboard-day.ts](../../../../../src/dashboard/state/use-dashboard-day.ts) |
| Actual behavior and limit | Controls render against served today/day. Complete DST/race/focus state machine is not newly proven. |
| Existing proof inputs | [tests/parity/dashboard-reference.spec.ts](../../../../../tests/parity/dashboard-reference.spec.ts) |
| Remaining acceptance | [A19](task-8-acceptance-matrix.md#a19) — No future-day advance beyond served today, guessed browser timezone or obsolete snapshot under a new date. |

### I20 · Search and export selected runs

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.12 / **P** |
| Controls and fields | Search term/scope/status/workflow/date filters, next cursor, result open, cancel/clear/Escape and XLSX export identity/name/type/length/hash. |
| Source / authority trace | [src/dashboard/surfaces/day-search.tsx](../../../../../src/dashboard/surfaces/day-search.tsx); [src/server/dashboard/queries/search.ts](../../../../../src/server/dashboard/queries/search.ts); [src/server/dashboard/exports/operator-xlsx-export-service.ts](../../../../../src/server/dashboard/exports/operator-xlsx-export-service.ts); [src/dashboard/client/commands.ts](../../../../../src/dashboard/client/commands.ts) |
| Actual behavior and limit | Cross-date route and digest-checked XLSX client exist; historical implementation is not proof of all remaining filter/large-history cases. |
| Existing proof inputs | [tests/parity/cross-date-search.spec.ts](../../../../../tests/parity/cross-date-search.spec.ts) |
| Remaining acceptance | [A20](task-8-acceptance-matrix.md#a20) — No stale query export, formula/secret injection, missing-header download success or whole-corpus scan hidden by pagination. |

### I21 · Read Activity and transaction totals

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.12 / **W** |
| Controls and fields | From/to, how-counted disclosures, run/status/workflow/day counts, distinct people availability, durations/failures/samples, transaction section and CSV Export. |
| Source / authority trace | [src/dashboard/surfaces/activity.tsx](../../../../../src/dashboard/surfaces/activity.tsx); [src/server/dashboard/queries/run-summaries.ts](../../../../../src/server/dashboard/queries/run-summaries.ts); [src/server/dashboard/queries/activity-export.ts](../../../../../src/server/dashboard/queries/activity-export.ts); [src/infra/sqlite/transaction-history.ts](../../../../../src/infra/sqlite/transaction-history.ts) |
| Actual behavior and limit | Accepted U connects summary-backed Activity. Run counts and separately confirmed transaction history have distinct eligibility; fixture report inspected. |
| Existing proof inputs | [tests/unit/summary-surfaces/activity.test.ts](../../../../../tests/unit/summary-surfaces/activity.test.ts); [tests/unit/dashboard/activity-render.test.ts](../../../../../tests/unit/dashboard/activity-render.test.ts) |
| Remaining acceptance | [A21](task-8-acceptance-matrix.md#a21) — No person IDs/digests, summed daily distincts, averaged medians, generic archive run counts or interpreting dry-run/unknown as confirmed writes. |

### I22 · Control workers and browsers

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.11 / **P** |
| Controls and fields | Session strip/cards, Add workers, planned count, spawn/replacement/stop, worker/browser identity, attention and app version. |
| Source / authority trace | [src/dashboard/surfaces/shell.tsx](../../../../../src/dashboard/surfaces/shell.tsx); [src/dashboard/app/command-dispatch.ts](../../../../../src/dashboard/app/command-dispatch.ts); [src/server/dashboard/worker-supervisor.ts](../../../../../src/server/dashboard/worker-supervisor.ts) |
| Actual behavior and limit | Real supervisor commands exist; seeded footer has zero workers. No real browser workers launched for inventory. |
| Existing proof inputs | [tests/unit/cli-dashboard-lifecycle.test.ts](../../../../../tests/unit/cli-dashboard-lifecycle.test.ts); [tests/parity/pool-control-desktop-target.spec.ts](../../../../../tests/parity/pool-control-desktop-target.spec.ts) |
| Remaining acceptance | [A22](task-8-acceptance-matrix.md#a22) — No stale claim execution, inferred child death, unowned browser closure or control success without a real supervisor effect. |

### I23 · Start ordinary work

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.11.2 / **P** |
| Controls and fields | Workflow/method picker, text/spreadsheet input, options/priority/dryRun/browser/capture, custom Steps/Values, preview/Confirm, final submit and result identity. |
| Source / authority trace | [src/dashboard/surfaces/run-start.tsx](../../../../../src/dashboard/surfaces/run-start.tsx); [src/dashboard/surfaces/run-start-model.ts](../../../../../src/dashboard/surfaces/run-start-model.ts); [src/server/dashboard/commands/start-plan-service.ts](../../../../../src/server/dashboard/commands/start-plan-service.ts) |
| Actual behavior and limit | Ordinary modal and server plan exist; initial fixture dialog inspected. Full single/batch/worker/reload journey remains open. |
| Existing proof inputs | [tests/unit/start-plan.test.ts](../../../../../tests/unit/start-plan.test.ts); [tests/unit/server/start-plan-omissions.test.ts](../../../../../tests/unit/server/start-plan-omissions.test.ts) |
| Remaining acceptance | [A23](task-8-acceptance-matrix.md#a23) — No browser/transaction before admission, made-up run ID, duplicate enqueue or future workflow admission from an available catalog entry. |

### I24 · Rerun from an immutable source

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.11.2 / **F** |
| Controls and fields | One Rerun entry for failed/interrupted/successful source; source coordinates and optional copied/changed/cleared completed values. |
| Source / authority trace | [src/dashboard/app/dashboard-app.tsx](../../../../../src/dashboard/app/dashboard-app.tsx); [src/dashboard/app/command-dispatch.ts](../../../../../src/dashboard/app/command-dispatch.ts); [src/server/dashboard/projectors/queue-row-actions.ts](../../../../../src/server/dashboard/projectors/queue-row-actions.ts); [src/server/dashboard/queries/data.ts](../../../../../src/server/dashboard/queries/data.ts) |
| Actual behavior and limit | Backend prior-run read exists. Current UI still serves Resume from checkpoints and Restart generic commands; seeded failed row visibly confirms this gap. |
| Existing proof inputs | [tests/unit/rerun-values.test.ts](../../../../../tests/unit/rerun-values.test.ts); [tests/unit/rerun-source-eligibility.test.ts](../../../../../tests/unit/rerun-source-eligibility.test.ts); [tests/unit/rerun-protected-identity.test.ts](../../../../../tests/unit/rerun-protected-identity.test.ts) |
| Remaining acceptance | [A24](task-8-acceptance-matrix.md#a24) — No direct retry/restart UI, archived/deleted source launch, stale/malformed/cross-attempt prefill or UNKNOWN retry. Full UI integration is required. |

### I25 · Acknowledge repeated transaction warnings

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.11.2 / **F** |
| Controls and fields | Steps selection, previous submission warning set, Cancel/Confirm acknowledgement, Values editing and final acceptance. |
| Source / authority trace | [src/dashboard/surfaces/run-start.tsx](../../../../../src/dashboard/surfaces/run-start.tsx); [src/domain/dashboard/start-plan.ts](../../../../../src/domain/dashboard/start-plan.ts); [src/server/dashboard/commands/start-plan-service.ts](../../../../../src/server/dashboard/commands/start-plan-service.ts) |
| Actual behavior and limit | D335 backend protocol is prior work; current modal has no source-bound warning flow. This inventory grants no warning-UI PASS. |
| Existing proof inputs | [tests/unit/start-plan.test.ts](../../../../../tests/unit/start-plan.test.ts); [tests/unit/rerun-source-eligibility.test.ts](../../../../../tests/unit/rerun-source-eligibility.test.ts) |
| Remaining acceptance | [A25](task-8-acceptance-matrix.md#a25) — No plan consumption, run/trace mint, publication or transaction before final submit; no reused receipt represented as a fresh write; exact final replay is singular. |

### I26 · Read queue rows and batches

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.13 / **W** |
| Controls and fields | Title/status/time/duration/attempt/trace/version/system/shape/hazard/facts/warnings, parent/member wells, attention bands, sorting, checked mark and batch grouping. |
| Source / authority trace | [src/dashboard/surfaces/queue.tsx](../../../../../src/dashboard/surfaces/queue.tsx); [src/dashboard/surfaces/workflow-batch.tsx](../../../../../src/dashboard/surfaces/workflow-batch.tsx); [src/server/dashboard/queries/run-summaries.ts](../../../../../src/server/dashboard/queries/run-summaries.ts); [src/server/dashboard/projectors/run-queue-projection.ts](../../../../../src/server/dashboard/projectors/run-queue-projection.ts) |
| Actual behavior and limit | Accepted U uses summaries enriched with canonical action facts. Seeded rows and grouping render; local checked state is not durable authority. |
| Existing proof inputs | [tests/unit/summary-surfaces/queue.test.ts](../../../../../tests/unit/summary-surfaces/queue.test.ts); [tests/parity/workflow-batches.spec.ts](../../../../../tests/parity/workflow-batches.spec.ts) |
| Remaining acceptance | [A26](task-8-acceptance-matrix.md#a26) — No stale/corrupt generation as plausible rows, heartbeat summary rewrite, incorrect aggregate, fabricated progress message or display cache authorizing mutation. |

### I27 · Issue single and bulk queue commands

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.13 / **P** |
| Controls and fields | Select/all/clear, rename, bump, cancel, delete, confirmation, per-row result/conflict/refresh/dismiss and Rerun launcher. |
| Source / authority trace | [src/dashboard/surfaces/queue-toolbar.tsx](../../../../../src/dashboard/surfaces/queue-toolbar.tsx); [src/dashboard/app/bulk-dispatch.ts](../../../../../src/dashboard/app/bulk-dispatch.ts); [src/dashboard/app/command-dispatch.ts](../../../../../src/dashboard/app/command-dispatch.ts); [src/server/dashboard/commands/command-service.ts](../../../../../src/server/dashboard/commands/command-service.ts) |
| Actual behavior and limit | Shared composers and kernel path exist. Direct Resume/Restart still need I24 replacement; other command journeys are not re-executed. |
| Existing proof inputs | [tests/unit/summary-surfaces/queue.test.ts](../../../../../tests/unit/summary-surfaces/queue.test.ts) |
| Remaining acceptance | [A27](task-8-acceptance-matrix.md#a27) — No aggregate success masking refusals, stale CAS effect, active delete or direct Rerun mutation; shared launch handoff is completed by 3.1.11 first. |

### I28 · Remove transferred/deleted queue state

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.13 / **F** |
| Controls and fields | upsert/remove/tombstone operations, selected run invalidation, batches/summary freshness and reconnect. |
| Source / authority trace | [src/domain/dashboard/subscription.ts](../../../../../src/domain/dashboard/subscription.ts); [src/server/dashboard/projectors/run-queue-projection.ts](../../../../../src/server/dashboard/projectors/run-queue-projection.ts); [src/server/dashboard/subscriptions/dashboard-stream.ts](../../../../../src/server/dashboard/subscriptions/dashboard-stream.ts); [src/dashboard/client/day-state.ts](../../../../../src/dashboard/client/day-state.ts) |
| Actual behavior and limit | remove-queue-surface/tombstone-queue-surface are declared but no named server producers were found. Current projection uses generation refresh; no full convergence PASS inferred. |
| Existing proof inputs | [tests/unit/dashboard/day-state-splice.test.ts](../../../../../tests/unit/dashboard/day-state-splice.test.ts); [tests/unit/summary-surfaces/queue.test.ts](../../../../../tests/unit/summary-surfaces/queue.test.ts) |
| Remaining acceptance | [A28](task-8-acceptance-matrix.md#a28) — Do not retain an obsolete producer claim or silently delete required outcomes. Run-span skipped is explicitly refused today; old two-enum defect statement is superseded. |

### I29 · Follow detail and timeline

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.14.1 / **P** |
| Controls and fields | Identity/provenance disclosure, attempt select/rename, categorical step bars, conditional/skipped/replayed segments, duration/working/waiting, status and served tabs. |
| Source / authority trace | [src/dashboard/surfaces/log-panel.tsx](../../../../../src/dashboard/surfaces/log-panel.tsx); [src/dashboard/surfaces/log-panel-model.ts](../../../../../src/dashboard/surfaces/log-panel-model.ts); [src/server/dashboard/queries/run-detail.ts](../../../../../src/server/dashboard/queries/run-detail.ts); [src/server/dashboard/run-status.ts](../../../../../src/server/dashboard/run-status.ts) |
| Actual behavior and limit | Seeded running/failed/gate detail inspected. Current query shares status derivation and lazy sections; full ordering/patch proof remains open. |
| Existing proof inputs | [tests/unit/server/run-detail-timeline-categories.test.ts](../../../../../tests/unit/server/run-detail-timeline-categories.test.ts); [tests/unit/server/run-detail-timeline-duration.test.ts](../../../../../tests/unit/server/run-detail-timeline-duration.test.ts); [tests/unit/dashboard/run-detail-follow.test.ts](../../../../../tests/unit/dashboard/run-detail-follow.test.ts) |
| Remaining acceptance | [A29](task-8-acceptance-matrix.md#a29) — No span-derived lifecycle override, fabricated completed step, compared attempts or route/body mismatch. |

### I30 · Read Context/Data/Attempts

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.14.2 / **P** |
| Controls and fields | Data dock/expand, field value/classification, producer step/task/direction, provenance/freshness, attempt coordinates and eligible Rerun link. |
| Source / authority trace | [src/dashboard/surfaces/context-rail.tsx](../../../../../src/dashboard/surfaces/context-rail.tsx); [src/dashboard/surfaces/context-rail-model.ts](../../../../../src/dashboard/surfaces/context-rail-model.ts); [src/server/dashboard/queries/data.ts](../../../../../src/server/dashboard/queries/data.ts); [src/server/dashboard/queries/run-sections.ts](../../../../../src/server/dashboard/queries/run-sections.ts) |
| Actual behavior and limit | Read-only checkpoint ledger and prior-run value projection exist; seeded empty Data state inspected. |
| Existing proof inputs | [tests/unit/server/rerun-values.test.ts](../../../../../tests/unit/server/rerun-values.test.ts); [tests/unit/rerun-value-mappings.test.ts](../../../../../tests/unit/rerun-value-mappings.test.ts) |
| Remaining acceptance | [A30](task-8-acceptance-matrix.md#a30) — No edit-checkpoint writer, source mutation, wrong-attempt value, made-up origin or permissive stale prefill. |

### I31 · Read observations and notes

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.14.3 / **P** |
| Controls and fields | Log search/clear, continuation, task/attempt/system, observed read/write leaves, authority fence and note lines. |
| Source / authority trace | [src/dashboard/surfaces/log-panel.tsx](../../../../../src/dashboard/surfaces/log-panel.tsx); [src/server/dashboard/queries/run-logs.ts](../../../../../src/server/dashboard/queries/run-logs.ts); [src/infra/events/note-jsonl-writer.ts](../../../../../src/infra/events/note-jsonl-writer.ts); [src/core/observed-data.ts](../../../../../src/core/observed-data.ts) |
| Actual behavior and limit | Observation/fence producers and note writer exist; seeded production machinery emitted visible notes. Ordinary workflow note call sites require separate census; do not claim the writer is absent. |
| Existing proof inputs | [tests/parity/observed-log-ui.spec.ts](../../../../../tests/parity/observed-log-ui.spec.ts) |
| Remaining acceptance | [A31](task-8-acceptance-matrix.md#a31) — No restored SQL spans/notes, invented page fact from a fence, cross-run continuation or eager whole-stream load. Missing ordinary note producers stay owner work. |

### I32 · View diagnostic captures

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.14.3 / **W** |
| Controls and fields | Lazy capture section, all verified origins, image/metadata/open/download, missing/purged/corrupt states and focus return. |
| Source / authority trace | [src/dashboard/surfaces/run-captures.tsx](../../../../../src/dashboard/surfaces/run-captures.tsx); [src/dashboard/surfaces/diagnostic-screenshot.tsx](../../../../../src/dashboard/surfaces/diagnostic-screenshot.tsx); [src/server/dashboard/queries/run-captures.ts](../../../../../src/server/dashboard/queries/run-captures.ts); [src/server/dashboard/queries/artifact-bytes.ts](../../../../../src/server/dashboard/queries/artifact-bytes.ts) |
| Actual behavior and limit | DCA3/D292 capture producer exists; seeded adapter explicitly lacks diagnostic authority. Old declared-unserved captures claim is superseded. |
| Existing proof inputs | [tests/parity/run-captures.spec.ts](../../../../../tests/parity/run-captures.spec.ts); [tests/unit/server/run-detail-captures.test.ts](../../../../../tests/unit/server/run-detail-captures.test.ts) |
| Remaining acceptance | [A32](task-8-acceptance-matrix.md#a32) — No new phone Capture Mode, synthetic screenshot, deadline-inferred purge, cross-run artifact or hidden second-authority fallback. |

### I33 · Understand receipts and failures

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.14.4 / **P** |
| Controls and fields | Receipt verdict/confidence/criteria/evidence/dry-run banner; failure summary/code/remediation/diagnostic disclosure; Mark resolved/Reopen. |
| Source / authority trace | [src/dashboard/surfaces/receipt.tsx](../../../../../src/dashboard/surfaces/receipt.tsx); [src/dashboard/surfaces/trust.tsx](../../../../../src/dashboard/surfaces/trust.tsx); [src/server/dashboard/queries/run-trust.ts](../../../../../src/server/dashboard/queries/run-trust.ts); [src/server/trust/receipt-service.ts](../../../../../src/server/trust/receipt-service.ts) |
| Actual behavior and limit | Accepted diagnostics/annotation path exists; seeded failure detail inspected. Archive uses frozen generic sections and cannot edit live annotations. |
| Existing proof inputs | [tests/parity/failure-resolution.spec.ts](../../../../../tests/parity/failure-resolution.spec.ts); [tests/unit/failure-resolution/commands.test.ts](../../../../../tests/unit/failure-resolution/commands.test.ts) |
| Remaining acceptance | [A33](task-8-acceptance-matrix.md#a33) — No retry for UNKNOWN, fake verified-done dry run, hidden unavailable evidence, mutable archive annotation or resolution inferred from a dismissed panel. |

### I34 · Inspect diagnostic bundles and advice

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.14.4 / **P** |
| Controls and fields | Bundle manifest/attachments, failure context/explanation, screenshot preview and advisory unavailable/invalid states. |
| Source / authority trace | [src/dashboard/surfaces/trust.tsx](../../../../../src/dashboard/surfaces/trust.tsx); [src/dashboard/surfaces/advisory.tsx](../../../../../src/dashboard/surfaces/advisory.tsx); [src/server/dashboard/queries/diagnostic-bundle.ts](../../../../../src/server/dashboard/queries/diagnostic-bundle.ts); [src/server/dashboard/queries/advisory.ts](../../../../../src/server/dashboard/queries/advisory.ts) |
| Actual behavior and limit | Diagnostic snapshots/files and advisory routes exist; complete production/privacy/tamper interaction not rerun. |
| Existing proof inputs | [tests/parity/diagnostic-bundle-dialog.spec.ts](../../../../../tests/parity/diagnostic-bundle-dialog.spec.ts); [tests/unit/failure-resolution/capture.test.ts](../../../../../tests/unit/failure-resolution/capture.test.ts) |
| Remaining acceptance | [A34](task-8-acceptance-matrix.md#a34) — No live knowledge_records/fix_records authority restoration, raw protected egress, wrong-run bundle or advisory-driven write. |

### I35 · Answer a checkpoint gate

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.14.5 / **P** |
| Controls and fields | Served approval shape, evidence packet, choice/acknowledgement, approve/reject, settled actor/time and refusal. |
| Source / authority trace | [src/dashboard/surfaces/identity-approve.tsx](../../../../../src/dashboard/surfaces/identity-approve.tsx); [src/dashboard/app/identity-ceremony.ts](../../../../../src/dashboard/app/identity-ceremony.ts); [src/server/dashboard/queries/run-trust.ts](../../../../../src/server/dashboard/queries/run-trust.ts) |
| Actual behavior and limit | Checkpoint-backed gate service and three ceremonies exist; seeded gate display inspected, no decision sent. |
| Existing proof inputs | [tests/unit/server/run-detail-gate-outcome.test.ts](../../../../../tests/unit/server/run-detail-gate-outcome.test.ts); [tests/unit/gate-resume-always-rerun.test.ts](../../../../../tests/unit/gate-resume-always-rerun.test.ts) |
| Remaining acceptance | [A35](task-8-acceptance-matrix.md#a35) — No unknown-shape one-click approval, SQL gates/ocr_approvals restoration, missing evidence acceptance or synthetic operator answer. |

### I36 · Resolve an unknown write

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.14.5 / **P** |
| Controls and fields | Confirmed-present/absent proof contract, note/evidence fields, review/submit/cancel and named refusal. |
| Source / authority trace | [src/dashboard/surfaces/park-resolve.tsx](../../../../../src/dashboard/surfaces/park-resolve.tsx); [src/dashboard/surfaces/park-resolve-model.ts](../../../../../src/dashboard/surfaces/park-resolve-model.ts); [src/dashboard/app/command-dispatch.ts](../../../../../src/dashboard/app/command-dispatch.ts) |
| Actual behavior and limit | Existing parked-write surface uses canonical operation evidence; final current authority/archived/expiry matrix not re-executed. |
| Existing proof inputs | [tests/parity/dashboard-reference.spec.ts](../../../../../tests/parity/dashboard-reference.spec.ts) |
| Remaining acceptance | [A36](task-8-acceptance-matrix.md#a36) — Never retry UNKNOWN, infer absence from a timeout, skip proof fields or expose an archive execution action. |

### I37 · Start and stop production dashboard

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.15 / **P** |
| Controls and fields | Build/readiness, loopback static/API route, startup errors, duplicate owner, signal drain, second signal and crash/orphan state. |
| Source / authority trace | [src/server/dashboard/static-bundle.ts](../../../../../src/server/dashboard/static-bundle.ts); [src/server/dashboard/http-server.ts](../../../../../src/server/dashboard/http-server.ts); [src/server/dashboard/compose.ts](../../../../../src/server/dashboard/compose.ts); [scripts/dev-dashboard.ts](../../../../../scripts/dev-dashboard.ts) |
| Actual behavior and limit | Source-bound web:build succeeded here; fixture static serving is not production boot acceptance. Existing lifecycle tests retained. |
| Existing proof inputs | [tests/unit/server/static-bundle.test.ts](../../../../../tests/unit/server/static-bundle.test.ts); [tests/unit/cli-dashboard-lifecycle.test.ts](../../../../../tests/unit/cli-dashboard-lifecycle.test.ts) |
| Remaining acceptance | [A37](task-8-acceptance-matrix.md#a37) — No stale assets, path escape, startup implicit upgrade/backup, unowned cleanup or successful shutdown while an owned child remains. |

### I38 · Recover realtime and reconnect

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.16 / **P** |
| Controls and fields | hello/snapshot/patch/reset-required/health/error; cursor/generation, offline/retry, topic/selection/settings/worker invalidation. |
| Source / authority trace | [src/server/dashboard/subscriptions/dashboard-stream.ts](../../../../../src/server/dashboard/subscriptions/dashboard-stream.ts); [src/dashboard/client/subscription.ts](../../../../../src/dashboard/client/subscription.ts); [src/dashboard/client/day-state.ts](../../../../../src/dashboard/client/day-state.ts); [src/dashboard/state/use-run-detail.ts](../../../../../src/dashboard/state/use-run-detail.ts) |
| Actual behavior and limit | One bounded SSE queue and splice client exist; schema vocabulary alone does not prove every declared topic's producer. Representative page showed Live only. |
| Existing proof inputs | [tests/parity/backfill-gap.spec.ts](../../../../../tests/parity/backfill-gap.spec.ts); [tests/unit/dashboard/day-state-splice.test.ts](../../../../../tests/unit/dashboard/day-state-splice.test.ts) |
| Remaining acceptance | [A38](task-8-acceptance-matrix.md#a38) — No stale detail under new selection, unbounded socket queue, dead topic silently retained or summary cache used to authorize actions. |

### I39 · Bound large-data work

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.17 / **W** |
| Controls and fields | Selected day/history/member/log populations, statements/reads/serialization/render/memory, pagination and virtualization triggers. |
| Source / authority trace | [tests/perf/dashboard-benchmark.ts](../../../../../tests/perf/dashboard-benchmark.ts); [src/server/dashboard/queries/run-summaries.ts](../../../../../src/server/dashboard/queries/run-summaries.ts); [src/dashboard/client/day-state.ts](../../../../../src/dashboard/client/day-state.ts) |
| Actual behavior and limit | F07 accepted measurements: day 1135 statements, archive 12; summary 21 for both outside populations, heartbeat zero summary writes/update one. Timings remain observations. |
| Existing proof inputs | [tests/unit/summary-surfaces/queue.test.ts](../../../../../tests/unit/summary-surfaces/queue.test.ts); [tests/unit/summary-surfaces/activity.test.ts](../../../../../tests/unit/summary-surfaces/activity.test.ts) |
| Remaining acceptance | [A39](task-8-acceptance-matrix.md#a39) — No fixture shrinking, observed timing promoted to a new threshold, counted SQLite rows-visited claim when unavailable or floor reduction. |

### I40 · Execute complete dashboard proof

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.18 / **F** |
| Controls and fields | Source-bound fixture/seeded/production-browser/live lanes, desktop scenes, both themes, a11y and immutable reference identities. |
| Source / authority trace | [tests/parity/helpers/fixture-bff.ts](../../../../../tests/parity/helpers/fixture-bff.ts); [tests/parity/helpers/seeded-bff.ts](../../../../../tests/parity/helpers/seeded-bff.ts); [tests/parity/helpers/bundle.ts](../../../../../tests/parity/helpers/bundle.ts); [playwright.parity.config.ts](../../../../../playwright.parity.config.ts) |
| Actual behavior and limit | Accepted 274-case 2.6 parity corpus is prior evidence. Inventory inspected representative scenes only; seeded coverage gaps remain explicit. |
| Existing proof inputs | [tests/parity/dual-adapter.spec.ts](../../../../../tests/parity/dual-adapter.spec.ts) |
| Remaining acceptance | [A40](task-8-acceptance-matrix.md#a40) — No new full-lane PASS inferred from inventory; no automatic screenshot refreeze; no skipped acceptance row to fit a green subset. |

### I41 · Verify deferred controls stay absent

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.22 / **D** |
| Controls and fields | Generic People/Review page/tab, advanced restore/migration/repair UI, retired mobile Capture Mode. |
| Source / authority trace | [src/server/dashboard/queries/run-trust.ts](../../../../../src/server/dashboard/queries/run-trust.ts); [src/dashboard/surfaces/log-panel-model.ts](../../../../../src/dashboard/surfaces/log-panel-model.ts); [src/dashboard/app/url-state.ts](../../../../../src/dashboard/app/url-state.ts) |
| Actual behavior and limit | D339 defers generic interfaces, D294 retires mobile capture; checkpoint review and necessary workflow-specific evidence remain required. |
| Existing proof inputs | [tests/parity/dashboard-reference.spec.ts](../../../../../tests/parity/dashboard-reference.spec.ts) |
| Remaining acceptance | [A41](task-8-acceptance-matrix.md#a41) — No deferral of a necessary workflow screen, core recovery command, durable OCR requirement or live safety proof. Advanced recovery absence belongs 3.1.9.3. |

### I42 · Preserve released storage and custody

| Inventory | Current evidence |
| --- | --- |
| Owner / class | 3.1.9.3 / **W** |
| Controls and fields | Schema 50, floor 46, 37 main/2 archive tables, 51 obsolete names absent; pending/published capture ownership and paired restore. |
| Source / authority trace | [src/infra/sqlite/migrations.ts](../../../../../src/infra/sqlite/migrations.ts); [src/server/dashboard/queries/archive-reports.ts](../../../../../src/server/dashboard/queries/archive-reports.ts) |
| Actual behavior and limit | 22 handover assets rehashed; accepted inventory/restore evidence retained. No operator database access/conversion performed. |
| Existing proof inputs | [tests/unit/database-table-retirement.test.ts](../../../../../tests/unit/database-table-retirement.test.ts); [tests/unit/archive-transfer/custody-recovery.test.ts](../../../../../tests/unit/archive-transfer/custody-recovery.test.ts); [tests/unit/storage-restore-drill.test.ts](../../../../../tests/unit/storage-restore-drill.test.ts) |
| Remaining acceptance | [A42](task-8-acceptance-matrix.md#a42) — No below-floor admission, changed migration 1–49, orphaned capture deletion, lone-half restore, retired settings import or obsolete relaunch/outbox table return. |

## Source and browser census

The retained evidence root is `/Users/julianhein/Projects/hr-dashboard-baseline-evidence-20260912/`.
`source-census.json` records source SHA-256, exact line, JSX tag/attributes, schema field declaration,
route/method and named functions for every dashboard app/surface/state/client/domain-wire/server
module plus the additional I-row authority inputs. `census.cjs` is the exact TypeScript-AST recipe.
The census is an intentionally overinclusive index: wrapper callbacks, repeated field declarations,
compatibility routes and static server routes are counted, not treated as independently working
visible controls. Dynamic catalog/row/section fields inherit their I-row requirement and privacy
rules. Merely appearing in this index grants no W classification; unexecuted paths remain P/F.

The census covers **199 files, 877 control/component declarations, 2449 field declarations and 65 route registrations**, SHA-256 `9d70751537d2b5dc385bf739126313c7eeb8c3c38c7b1bedf57ec2e787e674f2`. All entries have I-row references. Exact source locations are retained in the index; selected production entrypoints below make route ownership reviewable without reading fixture routes as production.

| Production registration | Current route operations | Inventory |
| --- | --- | --- |
| `src/server/dashboard/routes/api.ts:212` | `GET /api/v1/bootstrap` | I01/I22/I26/I38 |
| `src/server/dashboard/routes/api.ts:214` | `POST /api/v1/preflight/rerun` | I07 |
| `src/server/dashboard/routes/api.ts:282` | `GET /api/v1/search` | I20 |
| `src/server/dashboard/routes/api.ts:290` | `POST /api/v1/exports/xlsx` | I20 |
| `src/server/dashboard/routes/api.ts:309` | `GET /api/v1/explorer` | I08–I10 |
| `src/server/dashboard/routes/api.ts:310` | `POST /api/v1/explorer/validate` | I08–I10 |
| `src/server/dashboard/routes/api.ts:320` | `GET /api/v1/ui-catalog` | I08–I10 |
| `src/server/dashboard/routes/api.ts:329` | `POST /api/v1/runs/:runId/advisory` | I34 |
| `src/server/dashboard/routes/api.ts:338` | `POST /api/v1/start-plans` | I23–I25 |
| `src/server/dashboard/routes/api.ts:353` | `POST /api/v1/intake/files` | I13/I14 |
| `src/server/dashboard/routes/api.ts:369` | `GET /api/v1/intake/:sessionId` | I13/I14 |
| `src/server/dashboard/routes/api.ts:371` | `POST /api/v1/commands` | I05/I09/I11/I14/I17/I18/I22–I27/I33/I35/I36 |
| `src/server/dashboard/routes/api.ts:399` | `POST /api/v1/commands/bulk` | I05/I09/I11/I14/I17/I18/I22–I27/I33/I35/I36 |
| `src/server/dashboard/routes/api.ts:410` | `GET /events/v1` | I38 |
| `src/server/dashboard/routes/operator.ts:30` | `GET /api/v1/storage/doctor` | I03/I04/I06 |
| `src/server/dashboard/routes/operator.ts:39` | `GET /api/v1/settings/facts` | I03/I04/I06 |
| `src/server/dashboard/routes/operator.ts:42` | `GET /api/v1/settings/editable` | I03/I04/I06 |
| `src/server/dashboard/routes/operator.ts:45` | `GET /api/v1/archive/reports/:runId/files/:digest` | I15–I18 |
| `src/server/dashboard/routes/operator.ts:46` | `GET /artifacts/v1/archive/:runId/files/:digest` | I15–I18 |
| `src/server/dashboard/routes/operator.ts:50` | `GET /api/v1/archive/versions` | I15–I18 |
| `src/server/dashboard/routes/operator.ts:51` | `GET /api/v1/archive/reports` | I15–I18 |
| `src/server/dashboard/routes/operator.ts:58` | `GET /api/v1/archive/reports/:runId` | I15–I18 |
| `src/server/dashboard/routes/operator.ts:59` | `GET /api/v1/archive` | I15–I18 |
| `src/server/dashboard/routes/operator.ts:62` | `GET /api/v1/archive/:runId/captures/:artifactId/resource` | I15–I18 |
| `src/server/dashboard/routes/operator.ts:76` | `GET /api/v1/archive/:runId` | I15–I18 |
| `src/server/dashboard/routes/operator.ts:79` | `GET /artifacts/v1/archive/:runId/:artifactId` | I15–I18 |
| `src/server/dashboard/routes/operator.ts:102` | `GET /api/v1/reports/activity` | I21 |
| `src/server/dashboard/routes/operator.ts:119` | `GET /api/v1/reports/activity.csv` | I21 |
| `src/server/dashboard/routes/operator.ts:136` | `GET /api/v1/dashboard` | I01/I22/I26/I38 |
| `src/server/dashboard/routes/operator.ts:141` | `GET /api/v1/runs/:runId` | I29–I36 |
| `src/server/dashboard/routes/data.ts:11` | `GET /api/v1/runs/:runId/rerun-values` | I23–I25 |
| `src/server/dashboard/routes/data.ts:23` | `GET /api/v1/runs/:runId/:section` | I29–I36 |
| `src/server/dashboard/routes/trust.ts:29` | `GET /api/v1/diagnostic-bundles/:bundleId` | I34 |
| `src/server/dashboard/routes/trust.ts:42` | `GET /api/v1/diagnostic-bundles/:bundleId/manifest` | I34 |
| `src/server/dashboard/routes/trust.ts:63` | `GET /api/v1/diagnostic-bundles/:bundleId/attachments/:artifactId` | I34 |
| `src/server/dashboard/routes/trust.ts:83` | `GET /artifacts/v1/:artifactId` | I32/I34 |
| `src/server/dashboard/routes/trust.ts:114` | `GET /api/v1/runs/:runId/:section` | I29–I36 |

Browser recipe: `launcher.mts` imports `ensureParityBundle`, `startFixtureServer` and
`startSeededServer` from the assigned checkout, builds the current bundle and starts both on
`127.0.0.1` port 0. Command: `node_modules/.bin/tsx /Users/julianhein/Projects/hr-dashboard-baseline-evidence-20260912/launcher.mts`.
`browser-inputs.json` binds the bundle input/output digests, URLs, process ID, synthetic identities
and six declared seeded-coverage gaps. `browser-server.log` is the exit/build log; `browser-closed.json`
records both servers closing, launcher exit 0. Only owned session `dashboard-baseline` was used and
closed through Playwright CLI. No credentials or operator state were copied. The dependency link
points to the unchanged installed primary node_modules; no package/lock/config file was changed.

| Fresh inventory observation | Evidence and precise limit |
| --- | --- |
| Fixture shell → Settings → Archive saved report → Versions | `browser-fixture-{shell,settings,archive,report,versions}.txt`; Settings/Archive PNGs. Navigation, eight leaves, generic frozen report, attachment link and version form visible. No save/version/delete command sent. |
| Ordinary Run, Explorer, Activity and Storage/doctor | `browser-fixture-{run,explorer,activity,storage,doctor}.txt`; current production React bundle against schema fixtures. Only the read-only fixture doctor button invoked. No upload or final submit performed. |
| Seeded running/failure/gate detail at 1024×768 | `browser-seeded-{detail,failure,gate}.txt`, `seeded-detail-1024.png`. Real seeded projection/commands stack; visible notes and Resume from checkpoints; explicit absence of diagnostic capture authority. No gate/resolution command sent. |
| Below-floor geometry | `browser-below-floor-geometry.txt`, `seeded-below-floor.png`: 900×600 viewport, 1024×720 document. This is resize evidence, not 125%/200% browser zoom or full keyboard proof. |
| Console | Fixture and seeded navigation reported only a missing favicon 404. This adapter/static asset observation is not a product-runtime acceptance failure; 3.1.15 owns production asset completeness. No application exception was observed in these snapshots. |

Fresh inventory does not claim broad parity, accessibility certification, full T2/T3/T4 journeys or
production startup. Those remain A/D rows. Old 2.6 typecheck/coverage/parity/measurement results are
reused only under the task's unchanged-input receipt; historical green tests do not establish a new
acceptance requirement.

## Historical unchecked obligations and explicit dispositions

Historical Tasks 1–7 and their dated ledgers retain their original claims and names. The current
README marks their surface and exit tables as historical. D326 reopened required operator journeys;
D339 alone permits the specified generic interfaces to defer. A prior “built” or D279 disposition
cannot waive a newly required current journey. The following mapping assigns every unchecked or
proposed obligation to current work or an explicit superseding decision.

| Historical obligation | Current disposition and accountable proof |
| --- | --- |
| Track D D6, repeated fetch effects | Current prerequisite 3.1.9 owns common resource/registration seams (A01/A38); its focused plan inventories remaining duplicates and preserves error/abort semantics. Trigger remains before the second workflow migration; no fictitious completed useResource API. |
| Track D D7, LoadedApp split | 3.1.9 owns surface/history/command composition separation; 3.1.11 owns session/launch boundary; 3.1.14 owns detail separation. These are real prerequisites, A01/A22/A29. |
| Track D D8, model and versioning splits / one task-execution fold | 3.1.9 owns surface models and Archive boundaries; 3.1.14 owns shared detail/timeline models (A15–A17/A29–A34). Existing model files are credit only, not proof all extraction is done. |
| Track D D9, shared virtualized list | 3.1.17 (A39) retains the performance trigger and §7.4 fixture/bounds. An exact 200-row page does not prove a shared queue/log/archive primitive. |
| Track D D10, common CAS transport / intake double parse | 3.1.9 owns common transport/command boundary and 3.1.9.6 its isolated intake consumer; A14/A27 require exact revisions, refusals and replay. Existing current implementations must be inspected before a redundant refactor. |
| README optional Review/People and old unserved-captures claims | D339: A41 proves absent generic doors while keeping required workflow evidence. Captures are now served by DCA3/D292 (A32); the 2026-08-20 unserved claim is superseded. |
| Old editable Settings, Explorer EDIT, production bytes, search/export “doc 04 deferrals” | Superseded as current deferrals by D326/D339: A03/A04/A09/A20/A37 are required 3.1 work. No rewrite of historical exit evidence. |
| Old notes-emitter/observations residue | A31 owns caller census and missing real producers; the current writer and observation/fence path are present. SQL spans/notes retirement does not retire logs. |
| Archive relaunch, archived_runs and archive_relaunches | Superseded by C0 and accepted 2.6.9 retirement; A15–A18 prove saved reports/version changes/export/deletion and absence of execution doors. |
| Settings-file/restart/old import and lone-authority restore language | Current C0 settings activation, D336 independent credentials and F07 schema/floor/custody apply (A03–A07/A42). No automatic restart for ordinary new-run activation; authenticated database/archive/file recovery remains. |
| Generic advanced restore/migrate/repair UI | D339 deferral only; A06/A42 retain health, core recovery, explicit instructions and negative proof. |
| Mobile/touch/Capture Mode and former narrow portrait tests | D340 desktop replacement D01–D05; D294 retirement. No restoration of phone UI or coarse-pointer tests; safety/attachment/keyboard cases remain. |
| Original proposed worktree waves/coordinator-only automatic merges | D344 current IDs and 3.1.23/24/25 finalizers supersede old scheduling; matrix owns shared extraction and admission checks. Original logs remain history. |
| Optional 3.1.20 early inventory | Its tail-revalidation window has elapsed; B01/B02 now perform the authoritative inventory after accepted 2.6. No duplicate prerequisite or retroactive task completion. |
| Optional 3.1.21 extraction proposals | No new task topology admitted. Current whole-task dependencies remain; any later split needs focused approval/either-order proof. |

The Task 4 question-shaped audit has 49 ratified questions and three additional grouped additions,
not 52 new operator decisions. All remain historical D271–D279 evidence. The exhaustive numbered
mapping below keeps surviving behavior at current owners; retired relaunch/phone/in-place editing
subclauses are superseded by C0/D294/D334 respectively. No historical unchecked row is silently green.

| Historical Task 4 row(s) | Current acceptance / disposition |
| --- | --- |
| 1 | A39 performance trigger; A15 indexed archive browsing. |
| 2, 12, 33 | A17 version changes; reviewed membership and major/minor behavior remain. |
| 3, 4, 49 | A02/A10 design-system specimen and catalog; D274 completed subfeatures retain proof. |
| 5, 6, 7, 48 | A03/A04/A06/A10 Settings/help/doctor. |
| 8 | D294 phone Capture retirement; A41 absence. |
| 9, 10, 29, 34, 45 | A13/A14 intake and its Run-modal handoff, A23 for the upload door. |
| 11 | A16/A32 retained archive/capture metadata and safe bytes. |
| 13, 17, 42, 43 | A33/A34 receipt/failure/diagnostics; frozen archive annotations stay read-only. |
| 14, 18, 19, 23, 24, 39, 40 | A29 timeline/identity/follow; A31 logs; A30 attempt/provenance. |
| 15, 25, 28, 30, 31, 37 | A26/A27 queue semantics, commands, checked client state and bulk outcomes; A22 session copy. |
| 16, 20, 21, 41 | A30 read-only Data/provenance; D334 supersedes in-place Edit Data; A24/A25 own new modal values. |
| 22, 26, 27, 38 | A23–A25 ordinary Run/Rerun controls, omission and warnings. |
| 32, 36 | A01/A02 shared layout/focus/async/labels; A15/A21 for table/error rendering. |
| 35, 46 | A08/A09 Explorer. |
| 44 | A15–A18 frozen Archive; relaunch text is retired, remaining evidence/copy obligations remain. |
| 47 | A21 Activity semantics/accessibility. |
| 50 | A01/A20 search Escape; A23 empty workflow/zero-system/start-plan provenance. |
| 51 | A29–A36 detail/provenance/refusal/diagnostic/park behavior; D334 supersedes source editing. |
| 52 | A08/A13–A17 standing surfaces and versioning; generic People body D339 only. |

All current task/roadmap checklists retain their complete remaining scope, mapped by stable execution
node in `obligation-census.json`. It records each original unchecked/proposed line, source/line and
assigned I rows or historical disposition. Duplicate history and repeated active checklist wording
are not counted as new product requirements. Leaf launch still requires a complete approved brief.
