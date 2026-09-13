# Frozen dashboard acceptance matrix

Companion to [3.1.8](task-8-re-baseline-dashboard-truth-and-acceptance.md), version **baseline-1**, based on `e182022edfa0cd05a46a74358cd3296bcade6e79`. All 42 A rows are required outcomes or explicit absence checks; they are not a declaration of passing implementation. Their I counterparts contain exact current source/test pointers and classified gaps. 3.1.19 (historical Task 18) executes this entire matrix unchanged unless explicitly amended at this owner. It fixes nothing: defects return to their named implementation owner and affected focused checks and final acceptance gates renew before acceptance under the [current execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13); no independent review step is required. 3.2 cannot consume a smaller green subset.

## Rules applying to every row

Each row requires positive and relevant failure/stale/empty/unavailable proof. Existing tests named in the I row are starting evidence, not a substitute for its missing scenarios. The implementation owner supplies focused unit/component/served command tests and its fixture scene; its group finalizer executes combined full gates and broad desktop parity. 3.1.18 supplies any still-missing integrated T2/T3/T4 harness and proves it detects the forbidden result. 3.1.19 runs the final production browser/authority comparison and retains exact fixture/source/command/artifact hashes. Generic fixture adapters prove rendering only. A server-seeded test must name every fake or unwired dependency. Current volatile live prerequisites must be verified at execution; a historical dry run does not establish current access or correctness.

Each A row also includes the surviving ratified subclauses assigned to it in the inventory's numbered historical disposition table and `obligation-census-r3.json`. Those exact original texts remain inspectable. The short journey summary does not waive a mapped control, wording, provenance or failure case; explicit superseding decisions determine retired behavior.

All mutation cases bind actor, command identity, expected version/revision/digest, and exact selected run/source. Exercise refusal with zero effects, exact replay with one effect, divergent replay refusal, and cancellation/transport uncertainty without invented success. Privacy cases inspect DOM, HTTP/SSE/export/diagnostic and notification egress. Retained run settings, original receipt/failure/completion identity and shared artifact ownership cannot be rewritten for display convenience. Missing proof remains red until its owner supplies it; no row is waived by a screenshot.

## Journey rows

<a id="a01"></a>

### A01 · Navigate the dashboard

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I01](task-8-dashboard-inventory.md#i01--navigate-the-dashboard) · D272/D295; frontend/backend integration §4 |
| Source of truth / owner | `src/dashboard/app/url-state.ts`; `src/dashboard/app/dashboard-app.tsx`; `src/dashboard/surfaces/top-bar.tsx` · **3.1.9.1** |
| Expected outcome | Each reachable door, deep link, reload and history transition selects one truthful surface and restores focus; unknown sections report absence. |
| Forbidden result / missing proof | No hidden competing takeover or stale run selection; full navigation race/dirty-draft matrix remains owner proof. |
| Proof and browser/live need | Existing test/fixture pointers are in I01. D01/D02 (desktop reference and resize). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.9 → leaf focused gates → 3.1.23 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a02"></a>

### A02 · Resize, theme and keyboard

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I02](task-8-dashboard-inventory.md#i02--resize-theme-and-keyboard) · D340; frontend/backend integration §10 |
| Source of truth / owner | `src/dashboard/app/global-keys.ts`; `src/dashboard/surfaces/shell.tsx`; `src/dashboard/surfaces/top-bar.tsx`; `src/dashboard/app/index.css` · **3.1.9.1** |
| Expected outcome | Keep side-by-side queue/detail, floor scrolling, both themes, focus order, keyboard, reduced motion and desktop hit ownership. |
| Forbidden result / missing proof | No mobile/coarse-pointer return; no CSS zoom claimed as browser zoom. D01–D05 below remain required. |
| Proof and browser/live need | Existing test/fixture pointers are in I02. D01/D02 (desktop reference and resize). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.9 → leaf focused gates → 3.1.23 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a03"></a>

### A03 · Edit ordinary Settings

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I03](task-8-dashboard-inventory.md#i03--edit-ordinary-settings) · D331.10/D336/D341; settings activation amendment |
| Source of truth / owner | `src/server/dashboard/queries/settings-editor.ts`; `src/dashboard/surfaces/settings.tsx`; `src/dashboard/surfaces/settings-model.ts` · **3.1.9.2** |
| Expected outcome | Render all served applicable catalog leaves; distinguish draft reset, discard and persisted clear. Invalid/empty numeric input stays invalid; conflicts retain draft and show current revision. |
| Forbidden result / missing proof | No fabricated default, silent conflict success or blanket restart requirement. P40/A8 editor expansion and deliberate reviewed refreeze remain here. |
| Proof and browser/live need | Existing test/fixture pointers are in I03. D04 (real browser zoom and keyboard). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.9 → leaf focused gates → 3.1.23 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a04"></a>

### A04 · Manage independent credentials and display facts

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I04](task-8-dashboard-inventory.md#i04--manage-independent-credentials-and-display-facts) · D331.5/.6/.10/D336/D341 |
| Source of truth / owner | `src/domain/config/catalog.ts`; `src/domain/dashboard/settings-editor.ts`; `src/server/dashboard/queries/settings.ts`; `src/dashboard/surfaces/settings.tsx` · **3.1.9.2** |
| Expected outcome | Use the served catalog and independent protected operation; write-only values read back as presence/revision. Clear override reveals observed host default. |
| Forbidden result / missing proof | No credential value/digest in DOM, logs or snapshot; no test subjects/canaries/fixture paths as settings. Test missing/present/conflicting protected revisions. |
| Proof and browser/live need | Existing test/fixture pointers are in I04. D04 (real browser zoom and keyboard). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.9 → leaf focused gates → 3.1.23 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a05"></a>

### A05 · Save settings and create new work

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I05](task-8-dashboard-inventory.md#i05--save-settings-and-create-new-work) · C0 settings activation and recovery; D334/D335 |
| Source of truth / owner | `src/server/settings-runtime.ts`; `src/server/dashboard/commands/settings-service.ts`; `src/server/dashboard/commands/start-plan-service.ts` · **3.1.11.2** |
| Expected outcome | New run/new child selects current committed settings; existing queued/running/resumed run keeps its snapshot. Already accepted replay returns the same identity after a save. |
| Forbidden result / missing proof | No partial snapshot, quota reset, silently accepted stale preview, or new run during review. Browser save-to-start crossover still required. |
| Proof and browser/live need | Existing test/fixture pointers are in I05. D01/D02 (desktop reference and resize). Current production/live dry-run correlation is required where the journey depends on workers, browser observations, gate or external state; 3.1.18 provides harness, 3.1.19 executes. Transaction-bearing flows use dryRun=true and record zero external writes. |
| Prerequisite / release | 3.1.23 → 3.1.11 → leaf focused gates → 3.1.24 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a06"></a>

### A06 · Read storage health and recovery instructions

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I06](task-8-dashboard-inventory.md#i06--read-storage-health-and-recovery-instructions) · D322/D332/D339; accepted F07 recovery |
| Source of truth / owner | `src/dashboard/surfaces/settings.tsx`; `src/server/dashboard/queries/storage.ts`; `src/server/dashboard/routes/operator.ts` · **3.1.9.3** |
| Expected outcome | Show corruption, interrupted/pending recovery, stale backup and stopped-system remedies from real health. Supported 46–49 conversion remains explicit and stopped. |
| Forbidden result / missing proof | No automatic backup, restore or upgrade, below-floor conversion, fake healthy default or available-looking unsupported repair button. |
| Proof and browser/live need | Existing test/fixture pointers are in I06. D01/D02 (desktop reference and resize). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.9 → leaf focused gates → 3.1.23 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a07"></a>

### A07 · Setup and preflight

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I07](task-8-dashboard-inventory.md#i07--setup-and-preflight) · D331.10/.11; operator trust §3; preflight-coverage |
| Source of truth / owner | `src/dashboard/surfaces/settings.tsx`; `src/server/preflight/dashboard-runners.ts`; `src/domain/trust/preflight-scenarios.ts`; `src/server/dashboard/routes/api.ts` · **3.1.11.1** |
| Expected outcome | Same served checks drive Setup, doctor and enqueue readiness; rerun is bounded/idempotent and exposes unavailable, stale and failed checks. |
| Forbidden result / missing proof | No inferred healthy prerequisites, leaked secret values, automatic repair side effect or browser launch for blocked workflow. Full fault-corpus executor belongs here. |
| Proof and browser/live need | Existing test/fixture pointers are in I07. D04 (real browser zoom and keyboard). Current production/live dry-run correlation is required where the journey depends on workers, browser observations, gate or external state; 3.1.18 provides harness, 3.1.19 executes. Transaction-bearing flows use dryRun=true and record zero external writes. |
| Prerequisite / release | 3.1.23 → 3.1.11 → leaf focused gates → 3.1.24 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a08"></a>

### A08 · Read workflow structure

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I08](task-8-dashboard-inventory.md#i08--read-workflow-structure) · D176/D177/D227–D229 |
| Source of truth / owner | `src/dashboard/surfaces/explorer.tsx`; `src/server/dashboard/queries/explorer.ts` · **3.1.9.4** |
| Expected outcome | Every displayed graph, omission/dry-run/when condition, source and catalog link matches its registered workflow, including empty and unregistered cases. |
| Forbidden result / missing proof | No invented graph node, editable structural promise or current descriptor interpretation of an archived report. Cyclic/manifest-drift proofs stay required. |
| Proof and browser/live need | Existing test/fixture pointers are in I08. D01/D02 (desktop reference and resize). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.9 → leaf focused gates → 3.1.23 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a09"></a>

### A09 · Review and apply Explorer edits

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I09](task-8-dashboard-inventory.md#i09--review-and-apply-explorer-edits) · D337; Explorer closed presentation contract |
| Source of truth / owner | `src/server/dashboard/commands/explorer-edit-service.ts`; `src/server/dashboard/commands/explorer-override-store.ts`; `src/dashboard/surfaces/explorer-model.ts` · **3.1.9.4** |
| Expected outcome | Presentation changes validate against exact descriptor/manifest identity and apply atomically with command/audit; source-only changes yield a reviewed code brief. |
| Forbidden result / missing proof | No stale/cyclic/schema/selector/graph hot-apply or lost override after restart. Owner must trace current persistence before proposing a migration. |
| Proof and browser/live need | Existing test/fixture pointers are in I09. D01/D02 (desktop reference and resize). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.9 → leaf focused gates → 3.1.23 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a10"></a>

### A10 · Inspect UI catalog and help

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I10](task-8-dashboard-inventory.md#i10--inspect-ui-catalog-and-help) · D295/D274; frontend/backend integration §4 |
| Source of truth / owner | `src/dashboard/surfaces/ui-catalog.tsx`; `src/dashboard/surfaces/row-catalog.tsx`; `src/server/dashboard/queries/ui-catalog.ts`; `src/dashboard/surfaces/shortcuts.tsx` · **3.1.9.4** |
| Expected outcome | Generated catalog describes current selectors/contracts/proof; both views and keyboard help remain reachable with truthful unavailable links. |
| Forbidden result / missing proof | No new test-only Settings catalog, bare catalog takeover or claim that a declared verification scenario ran. |
| Proof and browser/live need | Existing test/fixture pointers are in I10. D01/D02 (desktop reference and resize). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.9 → leaf focused gates → 3.1.23 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a11"></a>

### A11 · Use the notification inbox

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I11](task-8-dashboard-inventory.md#i11--use-the-notification-inbox) · D79b/D222/D262; operator trust §6 |
| Source of truth / owner | `src/dashboard/surfaces/top-bar.tsx`; `src/dashboard/surfaces/top-bar-model.ts`; `src/services/notifications/inbox.ts` · **3.1.9.5** |
| Expected outcome | Persist row before delivery; dedupe repeated events and retain unread critical item on denied/failed OS delivery. Navigate transferred target to its report; deleted target is explicit. |
| Forbidden result / missing proof | No delivery-success inference from row existence, lost state after restart or secret/free-text notification payload. |
| Proof and browser/live need | Existing test/fixture pointers are in I11. D01/D02 (desktop reference and resize). Current production/live dry-run correlation is required where the journey depends on workers, browser observations, gate or external state; 3.1.18 provides harness, 3.1.19 executes. Transaction-bearing flows use dryRun=true and record zero external writes. |
| Prerequisite / release | 3.1.9 → leaf focused gates → 3.1.23 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a12"></a>

### A12 · Publish notification triggers

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I12](task-8-dashboard-inventory.md#i12--publish-notification-triggers) · D79b/D86; closed notification trigger contract |
| Source of truth / owner | `src/domain/notification-triggers.ts`; `src/server/dashboard/compose/trust.ts`; `src/services/notifications/storage-health.ts`; `src/server/dashboard/compose.ts` · **3.1.9.5** |
| Expected outcome | Each declared trigger has an actual production caller and durable event-to-inbox proof, including disk/WAL/integrity and stalled ownership concerns where applicable. |
| Forbidden result / missing proof | No fake producer deletion to make enumeration green. Record precise missing callers before implementation; retired outbox tables cannot be recreated for a label. |
| Proof and browser/live need | Existing test/fixture pointers are in I12. D01/D02 (desktop reference and resize). Current production/live dry-run correlation is required where the journey depends on workers, browser observations, gate or external state; 3.1.18 provides harness, 3.1.19 executes. Transaction-bearing flows use dryRun=true and record zero external writes. |
| Prerequisite / release | 3.1.9 → leaf focused gates → 3.1.23 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a13"></a>

### A13 · Upload and map intake

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I13](task-8-dashboard-inventory.md#i13--upload-and-map-intake) · D173/D298; intake §2 |
| Source of truth / owner | `src/dashboard/surfaces/intake.tsx`; `src/dashboard/surfaces/intake-model.ts`; `src/server/dashboard/commands/intake-service.ts` · **3.1.9.6** |
| Expected outcome | Malformed files, duplicate/blank headers, partial/cancelled uploads and reload retain exact import identity and explicit progress; mapping names workflow fields. |
| Forbidden result / missing proof | Retrying the same digest/workflow upload joins its open session and preserves mapping; it must not fork duplicate work. Separately submitted import records/run origins remain independent under C0. Do not confuse upload retry deduplication with merging those durable imports. No raw secret exposure or synthetic session before upload. Run/Rerun internals remain 3.1.11.2. |
| Proof and browser/live need | Existing test/fixture pointers are in I13. D04 (real browser zoom and keyboard). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.9 → leaf focused gates → 3.1.23 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a14"></a>

### A14 · Review intake and hand off work

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I14](task-8-dashboard-inventory.md#i14--review-intake-and-hand-off-work) · Intake §2/§7; artifact consolidation amendment |
| Source of truth / owner | `src/dashboard/surfaces/intake.tsx`; `src/server/dashboard/commands/intake-service.ts`; `src/domain/intake/manifest.ts` · **3.1.9.6** |
| Expected outcome | Unresolved rejections block handoff; explicit exclusions/counts/provenance reconcile. Changed file/mapping/schema requires visible new-plan diff and confirmation. |
| Forbidden result / missing proof | No mutable old manifest, unnoticed skipped rows, duplicate enqueue, artifact outbox restoration or archived-source execution door. |
| Proof and browser/live need | Existing test/fixture pointers are in I14. D04 (real browser zoom and keyboard). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.9 → leaf focused gates → 3.1.23 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a15"></a>

### A15 · Find saved reports

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I15](task-8-dashboard-inventory.md#i15--find-saved-reports) · C0 archive, summary and surface contract |
| Source of truth / owner | `src/dashboard/surfaces/archive-report.tsx`; `src/dashboard/surfaces/archive-report-model.ts`; `src/server/dashboard/queries/archive-reports.ts` · **3.1.9.7** |
| Expected outcome | Bounded cursor browsing with stable order; new filter resets cursor/selection; stale response cannot replace current query; exact selection remains addressable. |
| Forbidden result / missing proof | No live-run enumeration for historical report viewing or unsupported all-time Activity population. Reconcile filter/history behavior explicitly in leaf proof. |
| Proof and browser/live need | Existing test/fixture pointers are in I15. D03 (narrow desktop, both themes and keyboard). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.9 → leaf focused gates → 3.1.23 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a16"></a>

### A16 · Read and download frozen evidence

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I16](task-8-dashboard-inventory.md#i16--read-and-download-frozen-evidence) · D80/D223/D292; C0 archive and privacy |
| Source of truth / owner | `src/dashboard/surfaces/archive-report.tsx`; `src/server/dashboard/queries/archive-reports.ts`; `src/server/dashboard/routes/operator.ts` · **3.1.9.7** |
| Expected outcome | Render frozen values without current descriptors/failure parsers; explicit missing/corrupt/unsafe attachment result. Retain required report export as remaining UI/proof scope. |
| Forbidden result / missing proof | No invented verification tooltip from a generic done outcome (current list reuses StatusPill); no unbound digest, traversal or privileged bytes. Owner must resolve tooltip/export gaps. |
| Proof and browser/live need | Existing test/fixture pointers are in I16. D03 (narrow desktop, both themes and keyboard). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.9 → leaf focused gates → 3.1.23 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a17"></a>

### A17 · Review a version change

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I17](task-8-dashboard-inventory.md#i17--review-a-version-change) · C0 version_changes; D274 major/minor |
| Source of truth / owner | `src/dashboard/surfaces/archive-report.tsx`; `src/server/dashboard/commands/version-review-binding.ts`; `src/domain/dashboard/archive.ts` · **3.1.9.7** |
| Expected outcome | Major archives reviewed terminal prior-version membership; minor archives none. Changed membership/identity requires renewed review; interrupted apply resumes exact request. |
| Forbidden result / missing proof | No active-source transfer, second application, relaunch or invented fresh version after refusal. Browser membership, replay and recovery proof remains required. |
| Proof and browser/live need | Existing test/fixture pointers are in I17. D03 (narrow desktop, both themes and keyboard). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.9 → leaf focused gates → 3.1.23 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a18"></a>

### A18 · Delete a live or saved run

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I18](task-8-dashboard-inventory.md#i18--delete-a-live-or-saved-run) · D308/D330.8; C0 archive deletion |
| Source of truth / owner | `src/dashboard/surfaces/archive-report.tsx`; `src/server/dashboard/queries/archive-reports.ts`; `src/core/run-record-service.ts` · **3.1.9.7** |
| Expected outcome | Terminal live delete or exact archive delete records canonical disposition, removes only owned bytes, preserves shared files and updates notifications/history/selection. |
| Forbidden result / missing proof | No active deletion, resurrection, wrong-report close after selection switch, hidden partial deletion or changed replay. Live UI commands belong 3.1.13; paired convergence at 3.1.16. |
| Proof and browser/live need | Existing test/fixture pointers are in I18. D03 (narrow desktop, both themes and keyboard). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.9 → leaf focused gates → 3.1.23 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a19"></a>

### A19 · Select a calendar day

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I19](task-8-dashboard-inventory.md#i19--select-a-calendar-day) · D256; clock §1; dashboard date navigation |
| Source of truth / owner | `src/dashboard/surfaces/top-bar.tsx`; `src/dashboard/surfaces/top-bar-model.ts`; `src/dashboard/app/url-state.ts`; `src/dashboard/state/use-dashboard-day.ts` · **3.1.10** |
| Expected outcome | Route, selected day, loaded snapshot, server timezone and picker agree across DST, history, out-of-order responses and reload. |
| Forbidden result / missing proof | No future-day advance beyond served today, guessed browser timezone or obsolete snapshot under a new date. |
| Proof and browser/live need | Existing test/fixture pointers are in I19. D01/D02 (desktop reference and resize). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.23 → 3.1.10; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a20"></a>

### A20 · Search and export selected runs

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I20](task-8-dashboard-inventory.md#i20--search-and-export-selected-runs) · D339 search/export; frontend/backend integration §5 |
| Source of truth / owner | `src/dashboard/surfaces/day-search.tsx`; `src/server/dashboard/queries/search.ts`; `src/server/dashboard/exports/operator-xlsx-export-service.ts`; `src/dashboard/client/commands.ts` · **3.1.12** |
| Expected outcome | Bounded stable query; open result selects its exact day/run. Export rows match reviewed selection, cancellation/stale query isolation and privacy rules. |
| Forbidden result / missing proof | No stale query export, formula/secret injection, missing-header download success or whole-corpus scan hidden by pagination. |
| Proof and browser/live need | Existing test/fixture pointers are in I20. D01/D02 (desktop reference and resize). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.23 → 3.1.12; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a21"></a>

### A21 · Read Activity and transaction totals

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I21](task-8-dashboard-inventory.md#i21--read-activity-and-transaction-totals) · D81/D236; C0 summaries and Activity privacy |
| Source of truth / owner | `src/dashboard/surfaces/activity.tsx`; `src/server/dashboard/queries/run-summaries.ts`; `src/server/dashboard/queries/activity-export.ts`; `src/infra/sqlite/transaction-history.ts` · **3.1.12** |
| Expected outcome | Exact range/group semantics and redacted aggregates; unavailable people remains unavailable. Archived confirmed transaction totals persist until explicit deletion. |
| Forbidden result / missing proof | No person IDs/digests, summed daily distincts, averaged medians, generic archive run counts or interpreting dry-run/unknown as confirmed writes. |
| Proof and browser/live need | Existing test/fixture pointers are in I21. D01/D02 (desktop reference and resize). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.23 → 3.1.12; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a22"></a>

### A22 · Control workers and browsers

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I22](task-8-dashboard-inventory.md#i22--control-workers-and-browsers) · D267/D271/D305; execution and sessions |
| Source of truth / owner | `src/dashboard/surfaces/shell.tsx`; `src/dashboard/app/command-dispatch.ts`; `src/server/dashboard/worker-supervisor.ts` · **3.1.11** |
| Expected outcome | Plan count and spawn change durable pool membership with CAS and observed child birth; pause/resume control the selected owned worker and preserve claims; Stop proves its directive/escalation/exit state. Refresh/reopen act on the exact selected owned browser session through a real cross-process channel and report observed outcomes. Cold parallel start, configured resources, crash/restart and owned orphan cleanup agree with UI. |
| Forbidden result / missing proof | No stale claim execution, inferred child death, unowned browser closure or control success without a real supervisor effect. Required proof names all seven operations separately: plan, spawn, pause, resume, stop, refresh, reopen. For each, test stale identity/version, unavailable/dead/unowned target and uncertain acknowledgement; refused/uncertain outcomes cannot display success. Current refresh/reopen refusal and missing pause/resume UI are implementation gaps owned by 3.1.11, not accepted deferrals. |
| Proof and browser/live need | Existing test/fixture pointers are in I22. D01/D02 (desktop reference and resize). Current production/live dry-run correlation is required where the journey depends on workers, browser observations, gate or external state; 3.1.18 provides harness, 3.1.19 executes. Transaction-bearing flows use dryRun=true and record zero external writes. |
| Prerequisite / release | 3.1.23 → 3.1.11; then 3.1.24 consumes children; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a23"></a>

### A23 · Start ordinary work

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I23](task-8-dashboard-inventory.md#i23--start-ordinary-work) · D307/D330/D334/D335 |
| Source of truth / owner | `src/dashboard/surfaces/run-start.tsx`; `src/dashboard/surfaces/run-start-model.ts`; `src/server/dashboard/commands/start-plan-service.ts` · **3.1.11.2** |
| Expected outcome | Create only at final submit; result names committed run/batch. For `supersede-active`, preview names the affected active generations and final submit performs the same policy atomically; conflicts require new review. Invalid/partial inputs, no/delayed worker, expiry and exact replay are explicit. |
| Forbidden result / missing proof | No browser/transaction before admission, made-up run ID, duplicate enqueue or future workflow admission from an available catalog entry. |
| Proof and browser/live need | Existing test/fixture pointers are in I23. D04 (real browser zoom and keyboard). Current production/live dry-run correlation is required where the journey depends on workers, browser observations, gate or external state; 3.1.18 provides harness, 3.1.19 executes. Transaction-bearing flows use dryRun=true and record zero external writes. |
| Prerequisite / release | 3.1.23 → 3.1.11 → leaf focused gates → 3.1.24 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a24"></a>

### A24 · Rerun from an immutable source

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I24](task-8-dashboard-inventory.md#i24--rerun-from-an-immutable-source) · D334; intake §6; prior-run read contract |
| Source of truth / owner | `src/dashboard/app/dashboard-app.tsx`; `src/dashboard/app/command-dispatch.ts`; `src/server/dashboard/projectors/queue-row-actions.ts`; `src/server/dashboard/queries/data.ts` · **3.1.11.2** |
| Expected outcome | One source-bound modal: failed/unfinished defaults for failures, all eligible steps including omissions for success; defaults never restrict selection; source bytes unchanged. |
| Forbidden result / missing proof | No direct retry/restart UI, archived/deleted source launch, stale/malformed/cross-attempt prefill or UNKNOWN retry. Full UI integration is required. |
| Proof and browser/live need | Existing test/fixture pointers are in I24. D04 (real browser zoom and keyboard). Current production/live dry-run correlation is required where the journey depends on workers, browser observations, gate or external state; 3.1.18 provides harness, 3.1.19 executes. Transaction-bearing flows use dryRun=true and record zero external writes. |
| Prerequisite / release | 3.1.23 → 3.1.11 → leaf focused gates → 3.1.24 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a25"></a>

### A25 · Acknowledge repeated transaction warnings

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I25](task-8-dashboard-inventory.md#i25--acknowledge-repeated-transaction-warnings) · D335 final-submit protocol |
| Source of truth / owner | `src/dashboard/surfaces/run-start.tsx`; `src/domain/dashboard/start-plan.ts`; `src/server/dashboard/commands/start-plan-service.ts` · **3.1.11.2** |
| Expected outcome | Cancel returns to Steps; Confirm advances only to Values. Keep acknowledgement only while selection/business keys/source/evidence are identical; renew on change. |
| Forbidden result / missing proof | No plan consumption, run/trace mint, publication or transaction before final submit; no reused receipt represented as a fresh write; exact final replay is singular. |
| Proof and browser/live need | Existing test/fixture pointers are in I25. D04 (real browser zoom and keyboard). Current production/live dry-run correlation is required where the journey depends on workers, browser observations, gate or external state; 3.1.18 provides harness, 3.1.19 executes. Transaction-bearing flows use dryRun=true and record zero external writes. |
| Prerequisite / release | 3.1.23 → 3.1.11 → leaf focused gates → 3.1.24 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a26"></a>

### A26 · Read queue rows and batches

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I26](task-8-dashboard-inventory.md#i26--read-queue-rows-and-batches) · D230–D235/D268; C0 summaries |
| Source of truth / owner | `src/dashboard/surfaces/queue.tsx`; `src/dashboard/surfaces/workflow-batch.tsx`; `src/server/dashboard/queries/run-summaries.ts`; `src/server/dashboard/projectors/run-queue-projection.ts` · **3.1.13** |
| Expected outcome | Queue/detail status agree, members/parents remain exact, batch group toggle is versioned, and summary freshness failure is visible. |
| Forbidden result / missing proof | No stale/corrupt generation as plausible rows, heartbeat summary rewrite, incorrect aggregate, fabricated progress message or display cache authorizing mutation. |
| Proof and browser/live need | Existing test/fixture pointers are in I26. D01/D02 (desktop reference and resize). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.24 → 3.1.13; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a27"></a>

### A27 · Issue single and bulk queue commands

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I27](task-8-dashboard-inventory.md#i27--issue-single-and-bulk-queue-commands) · D235/D253/D308/D330; D334 |
| Source of truth / owner | `src/dashboard/surfaces/queue-toolbar.tsx`; `src/dashboard/app/bulk-dispatch.ts`; `src/dashboard/app/command-dispatch.ts`; `src/server/dashboard/commands/command-service.ts` · **3.1.13** |
| Expected outcome | Version-bound canonical commands give one result per target and converge after reload; cancel claimed work is a request; delete names released keys. |
| Forbidden result / missing proof | No aggregate success masking refusals, stale CAS effect, active delete or direct Rerun mutation; shared launch handoff is completed by 3.1.11 first. |
| Proof and browser/live need | Existing test/fixture pointers are in I27. D01/D02 (desktop reference and resize). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.24 → 3.1.13; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a28"></a>

### A28 · Remove transferred/deleted queue state

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I28](task-8-dashboard-inventory.md#i28--remove-transferreddeleted-queue-state) · D308; C0 summary publication and transfer |
| Source of truth / owner | `src/domain/dashboard/subscription.ts`; `src/server/dashboard/projectors/run-queue-projection.ts`; `src/server/dashboard/subscriptions/dashboard-stream.ts`; `src/dashboard/client/day-state.ts` · **3.1.13** |
| Expected outcome | Prove create/update/archive/delete convergence including selection and grouping. Either produce required operations or explicitly prove an equivalent current protocol under contract review. |
| Forbidden result / missing proof | Do not retain an obsolete producer claim or silently delete required outcomes. Run-span skipped is explicitly refused today; old two-enum defect statement is superseded. |
| Proof and browser/live need | Existing test/fixture pointers are in I28. D01/D02 (desktop reference and resize). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.24 → 3.1.13; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a29"></a>

### A29 · Follow detail and timeline

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I29](task-8-dashboard-inventory.md#i29--follow-detail-and-timeline) · D225/D257/D259/D268/D289 |
| Source of truth / owner | `src/dashboard/surfaces/log-panel.tsx`; `src/dashboard/surfaces/log-panel-model.ts`; `src/server/dashboard/queries/run-detail.ts`; `src/server/dashboard/run-status.ts` · **3.1.14.1** |
| Expected outcome | Exact run/attempt authority, stable selected state, every lifecycle/outcome/category, accessible timeline and live follow across archive/reconnect/out-of-order delivery. |
| Forbidden result / missing proof | No span-derived lifecycle override, fabricated completed step, compared attempts or route/body mismatch. |
| Proof and browser/live need | Existing test/fixture pointers are in I29. D03 (narrow desktop, both themes and keyboard). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.24 + 3.1.13 → 3.1.14 → leaf focused gates → 3.1.25 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a30"></a>

### A30 · Read Context/Data/Attempts

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I30](task-8-dashboard-inventory.md#i30--read-contextdataattempts) · D252/D253/D334; intake §6 |
| Source of truth / owner | `src/dashboard/surfaces/context-rail.tsx`; `src/dashboard/surfaces/context-rail-model.ts`; `src/server/dashboard/queries/data.ts`; `src/server/dashboard/queries/run-sections.ts` · **3.1.14.2** |
| Expected outcome | Exact checkpoint/provenance coordinates, explicit empty/redacted/malformed/archive states and source immutability; link to accepted modal only. |
| Forbidden result / missing proof | No edit-checkpoint writer, source mutation, wrong-attempt value, made-up origin or permissive stale prefill. |
| Proof and browser/live need | Existing test/fixture pointers are in I30. D03 (narrow desktop, both themes and keyboard). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.24 + 3.1.13 → 3.1.14 → leaf focused gates → 3.1.25 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a31"></a>

### A31 · Read observations and notes

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I31](task-8-dashboard-inventory.md#i31--read-observations-and-notes) · D270; operator trust redaction; append-day retention |
| Source of truth / owner | `src/dashboard/surfaces/log-panel.tsx`; `src/server/dashboard/queries/run-logs.ts`; `src/infra/events/note-jsonl-writer.ts`; `src/core/observed-data.ts` · **3.1.14.3** |
| Expected outcome | Immutable bounded cursor pages; append/refresh/read-forward, redaction, exact origin and late-response isolation; every expected production message has a real caller. |
| Forbidden result / missing proof | No restored SQL spans/notes, invented page fact from a fence, cross-run continuation or eager whole-stream load. Missing ordinary note producers stay owner work. |
| Proof and browser/live need | Existing test/fixture pointers are in I31. D03 (narrow desktop, both themes and keyboard). Current production/live dry-run correlation is required where the journey depends on workers, browser observations, gate or external state; 3.1.18 provides harness, 3.1.19 executes. Transaction-bearing flows use dryRun=true and record zero external writes. |
| Prerequisite / release | 3.1.24 + 3.1.13 → 3.1.14 → leaf focused gates → 3.1.25 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a32"></a>

### A32 · View diagnostic captures

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I32](task-8-dashboard-inventory.md#i32--view-diagnostic-captures) · D292/D340; diagnostic capture contract |
| Source of truth / owner | `src/dashboard/surfaces/run-captures.tsx`; `src/dashboard/surfaces/diagnostic-screenshot.tsx`; `src/server/dashboard/queries/run-captures.ts`; `src/server/dashboard/queries/artifact-bytes.ts` · **3.1.14.3** |
| Expected outcome | Serve only exact run/digest/origin bytes, lazy load, safe headers and keyboard image navigation at narrow desktop; protected bytes remain unavailable. |
| Forbidden result / missing proof | No new phone Capture Mode, synthetic screenshot, deadline-inferred purge, cross-run artifact or hidden second-authority fallback. |
| Proof and browser/live need | Existing test/fixture pointers are in I32. D03 (narrow desktop, both themes and keyboard). Current production/live dry-run correlation is required where the journey depends on workers, browser observations, gate or external state; 3.1.18 provides harness, 3.1.19 executes. Transaction-bearing flows use dryRun=true and record zero external writes. |
| Prerequisite / release | 3.1.24 + 3.1.13 → 3.1.14 → leaf focused gates → 3.1.25 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a33"></a>

### A33 · Understand receipts and failures

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I33](task-8-dashboard-inventory.md#i33--understand-receipts-and-failures) · D237/D238; operator trust; failure resolution amendment |
| Source of truth / owner | `src/dashboard/surfaces/receipt.tsx`; `src/dashboard/surfaces/trust.tsx`; `src/server/dashboard/queries/run-trust.ts`; `src/server/trust/receipt-service.ts` · **3.1.14.4** |
| Expected outcome | Success/no-op/refusal/failure/UNKNOWN are distinct; actor/version-bound annotation leaves immutable failure/receipt/completion intact. Eligible Rerun opens modal. |
| Forbidden result / missing proof | No retry for UNKNOWN, fake verified-done dry run, hidden unavailable evidence, mutable archive annotation or resolution inferred from a dismissed panel. |
| Proof and browser/live need | Existing test/fixture pointers are in I33. D03 (narrow desktop, both themes and keyboard). Current production/live dry-run correlation is required where the journey depends on workers, browser observations, gate or external state; 3.1.18 provides harness, 3.1.19 executes. Transaction-bearing flows use dryRun=true and record zero external writes. |
| Prerequisite / release | 3.1.24 + 3.1.13 → 3.1.14 → leaf focused gates → 3.1.25 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a34"></a>

### A34 · Inspect diagnostic bundles and advice

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I34](task-8-dashboard-inventory.md#i34--inspect-diagnostic-bundles-and-advice) · Operator trust §2/§5 and diagnostic storage amendments |
| Source of truth / owner | `src/dashboard/surfaces/trust.tsx`; `src/dashboard/surfaces/advisory.tsx`; `src/server/dashboard/queries/diagnostic-bundle.ts`; `src/server/dashboard/queries/advisory.ts` · **3.1.14.4** |
| Expected outcome | Exact bound manifest/files; capture availability and historical resolution shown separately. Advice never authorizes commands or changes evidence. |
| Forbidden result / missing proof | No live knowledge_records/fix_records authority restoration, raw protected egress, wrong-run bundle or advisory-driven write. |
| Proof and browser/live need | Existing test/fixture pointers are in I34. D03 (narrow desktop, both themes and keyboard). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.24 + 3.1.13 → 3.1.14 → leaf focused gates → 3.1.25 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a35"></a>

### A35 · Answer a checkpoint gate

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I35](task-8-dashboard-inventory.md#i35--answer-a-checkpoint-gate) · D226/D237; checkpoint-backed gate contract |
| Source of truth / owner | `src/dashboard/surfaces/identity-approve.tsx`; `src/dashboard/app/identity-ceremony.ts`; `src/server/dashboard/queries/run-trust.ts` · **3.1.14.5** |
| Expected outcome | Evidence-complete revision-bound human answer for operator gates; changed/expired/skipped/unauthorized gate refuses; settled decision survives resume/reload. Declared children-terminal/external subscriptions have a real source-bound consumer and settle from the correct durable evidence with replay/isolation proof; no fake operator decision or silent permanent park. |
| Forbidden result / missing proof | No unknown-shape one-click approval, SQL gates/ocr_approvals restoration, missing evidence acceptance or synthetic operator answer. |
| Proof and browser/live need | Existing test/fixture pointers are in I35. D04 (real browser zoom and keyboard). Current production/live dry-run correlation is required where the journey depends on workers, browser observations, gate or external state; 3.1.18 provides harness, 3.1.19 executes. Transaction-bearing flows use dryRun=true and record zero external writes. |
| Prerequisite / release | 3.1.24 + 3.1.13 → 3.1.14 → leaf focused gates → 3.1.25 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a36"></a>

### A36 · Resolve an unknown write

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I36](task-8-dashboard-inventory.md#i36--resolve-an-unknown-write) · D20/D245/D246; write safety UNKNOWN boundary |
| Source of truth / owner | `src/dashboard/surfaces/park-resolve.tsx`; `src/dashboard/surfaces/park-resolve-model.ts`; `src/dashboard/app/command-dispatch.ts` · **3.1.14.5** |
| Expected outcome | Only evidence-backed resolution under exact operation/run/version; stale/unauthorized or malformed proof fails; cancellation makes no assertion. |
| Forbidden result / missing proof | Never retry UNKNOWN, infer absence from a timeout, skip proof fields or expose an archive execution action. |
| Proof and browser/live need | Existing test/fixture pointers are in I36. D04 (real browser zoom and keyboard). Current production/live dry-run correlation is required where the journey depends on workers, browser observations, gate or external state; 3.1.18 provides harness, 3.1.19 executes. Transaction-bearing flows use dryRun=true and record zero external writes. |
| Prerequisite / release | 3.1.24 + 3.1.13 → 3.1.14 → leaf focused gates → 3.1.25 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a37"></a>

### A37 · Start and stop production dashboard

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I37](task-8-dashboard-inventory.md#i37--start-and-stop-production-dashboard) · D321/D322/D332; server startup/static/drain contract |
| Source of truth / owner | `src/server/dashboard/static-bundle.ts`; `src/server/dashboard/http-server.ts`; `src/server/dashboard/compose.ts`; `scripts/dev-dashboard.ts` · **3.1.15** |
| Expected outcome | Validate bundle before authority/locks/listen; named incompatible/missing state; ordered stop closes owned children/sockets/lock and reports failed drain. |
| Forbidden result / missing proof | No stale assets, path escape, startup implicit upgrade/backup, unowned cleanup or successful shutdown while an owned child remains. |
| Proof and browser/live need | Existing test/fixture pointers are in I37. D01/D02 (desktop reference and resize). Current production/live dry-run correlation is required where the journey depends on workers, browser observations, gate or external state; 3.1.18 provides harness, 3.1.19 executes. Transaction-bearing flows use dryRun=true and record zero external writes. |
| Prerequisite / release | 3.1.24 → 3.1.15; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a38"></a>

### A38 · Recover realtime and reconnect

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I38](task-8-dashboard-inventory.md#i38--recover-realtime-and-reconnect) · D254/D256; frontend/backend integration §3/§7 |
| Source of truth / owner | `src/server/dashboard/subscriptions/dashboard-stream.ts`; `src/dashboard/client/subscription.ts`; `src/dashboard/client/day-state.ts`; `src/dashboard/state/use-run-detail.ts` · **3.1.16** |
| Expected outcome | Ordered duplicate/missed/restarted stream converges to fresh canonical selection; overflow sends reset-required; backfill gap durably notifies. |
| Forbidden result / missing proof | No stale detail under new selection, unbounded socket queue, dead topic silently retained or summary cache used to authorize actions. |
| Proof and browser/live need | Existing test/fixture pointers are in I38. D01/D02 (desktop reference and resize). Current production/live dry-run correlation is required where the journey depends on workers, browser observations, gate or external state; 3.1.18 provides harness, 3.1.19 executes. Transaction-bearing flows use dryRun=true and record zero external writes. |
| Prerequisite / release | all named producers + 3.1.25 → 3.1.16; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a39"></a>

### A39 · Bound large-data work

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I39](task-8-dashboard-inventory.md#i39--bound-large-data-work) · Frontend/backend integration §7.4; C0 summaries cost |
| Source of truth / owner | `tests/perf/dashboard-benchmark.ts`; `src/server/dashboard/queries/run-summaries.ts`; `src/dashboard/client/day-state.ts` · **3.1.17** |
| Expected outcome | Retain §7.4 structural fixture and numerical budgets; measure current query/write cost and rendering, avoid whole-day reparsing; add virtualization only at its trigger. |
| Forbidden result / missing proof | No fixture shrinking, observed timing promoted to a new threshold, counted SQLite rows-visited claim when unavailable or floor reduction. |
| Proof and browser/live need | Existing test/fixture pointers are in I39. D01/D02 (desktop reference and resize). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.16 and all named inputs → 3.1.17; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a40"></a>

### A40 · Execute complete dashboard proof

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I40](task-8-dashboard-inventory.md#i40--execute-complete-dashboard-proof) · D132/D191/D340; frontend/backend integration §7 |
| Source of truth / owner | `tests/parity/helpers/fixture-bff.ts`; `tests/parity/helpers/seeded-bff.ts`; `tests/parity/helpers/bundle.ts`; `playwright.parity.config.ts` · **3.1.18** |
| Expected outcome | Build all missing T2/T3/T4 journey fixtures and negative controls; distinguish contract rendering, real production authority and current dry-run external facts. |
| Forbidden result / missing proof | No new full-lane PASS inferred from inventory; no automatic screenshot refreeze; no skipped acceptance row to fit a green subset. |
| Proof and browser/live need | Existing test/fixture pointers are in I40. D01/D02 (desktop reference and resize). Current production/live dry-run correlation is required where the journey depends on workers, browser observations, gate or external state; 3.1.18 provides harness, 3.1.19 executes. Transaction-bearing flows use dryRun=true and record zero external writes. |
| Prerequisite / release | 3.1.17 and all named inputs → 3.1.18; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a41"></a>

### A41 · Verify deferred controls stay absent

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I41](task-8-dashboard-inventory.md#i41--verify-deferred-controls-stay-absent) · D339/D294; frontend/backend integration §10 |
| Source of truth / owner | `src/server/dashboard/queries/run-trust.ts`; `src/dashboard/surfaces/log-panel-model.ts`; `src/dashboard/app/url-state.ts` · **3.1.22** |
| Expected outcome | 3.1.19 proves absence of misleading doors. Required Person Lookup/Separations journeys retain gate, data, receipt and capture evidence; admit generic page only at concrete need. |
| Forbidden result / missing proof | No deferral of a necessary workflow screen, core recovery command, durable OCR requirement or live safety proof. Advanced recovery absence belongs 3.1.9.3. |
| Proof and browser/live need | Existing test/fixture pointers are in I41. D03 (narrow desktop, both themes and keyboard). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.19 verifies absence; 3.1.22 only on separate admission; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

<a id="a42"></a>

### A42 · Preserve released storage and custody

| Acceptance | Frozen requirement |
| --- | --- |
| Inventory / requirement | [I42](task-8-dashboard-inventory.md#i42--preserve-released-storage-and-custody) · Accepted 2.6.9 F07; schema 50/floor 46 custody |
| Source of truth / owner | `src/infra/sqlite/migrations.ts`; `src/server/dashboard/queries/archive-reports.ts` · **3.1.9.3** |
| Expected outcome | Fresh and supported 46–49 fixtures preserve canonical facts; exact authenticated database/archive/file set recovers; incomplete/corrupt pair retains marker; corrected replay succeeds. |
| Forbidden result / missing proof | No below-floor admission, changed migration 1–49, orphaned capture deletion, lone-half restore, retired settings import or obsolete relaunch/outbox table return. |
| Proof and browser/live need | Existing test/fixture pointers are in I42. D01/D02 (desktop reference and resize). Isolated production services plus real browser are required; no external HR action is needed for this row. |
| Prerequisite / release | 3.1.9 → leaf focused gates → 3.1.23 full group release; then 3.1.16–3.1.19 as required by the unchanged roadmap. Final acceptance owner: 3.1.19. |

## Desktop evidence allocation

These are consequential cases, not a Cartesian product. All reference scenes retain their existing theme/viewport identities; this selection adds journey proof rather than deleting old cases. 3.1.18 owns integration automation, 3.1.19 executes every D row.

| ID | Required canvas / environment | Journeys and implementing proof owner |
| --- | --- | --- |
| D01 | 1280×720 and 1440×900 at real browser 100%, Graphite Warm and Paper Ink | All visible journeys; each leaf's current desktop parity scenes, combined by 3.1.23/24/25. Runtime/reconnect/performance owners supply their scenes. |
| D02 | 1024×768 at 100%; resize down to exact 1024×720 and back while a run and detail remain selected | 3.1.9.1 shell/date/status/notifications/session reachability; 3.1.13 queue grouping; 3.1.14.1 timeline/detail. No reordering into a mobile layout or forced native-window resize. |
| D03 | Narrow 1024×768, both themes, keyboard-only and reduced-motion preference | 3.1.9.7 archive files/lightbox/download; 3.1.14.3 receipt PNG origins and portrait diagnostic images, log continuation; 3.1.9.5 pinned notification; 3.1.14.4 diagnostics. Retain exact desktop hit-ownership cases for toolbar/member/pool/search. |
| D04 | 1280×720 at actual 125% browser zoom; 1440×900 at actual 200% browser zoom; record effective CSS viewport, zoom mechanism and browser version | 3.1.9.2 Settings Save/Discard/conflict; 3.1.11.1 Setup/preflight; 3.1.11.2 Steps/warning/Values/final submit; 3.1.9.6 rejection/mapping; 3.1.14.5 gate/park proof. Scroll and Tab must reach all decisions and restore focus. CSS zoom, device scale factor and merely resizing are not equivalent evidence. |
| D05 | Deliberately below floor at 900×600 CSS pixels, then return to 1440×900; each theme at least once across journeys | 3.1.9.1 proves document scrolling exposes the same 1024×720 layout, including toast/status/footer; detail and forms retain container adaptation. Test keyboard reachability and focused offscreen control. 3.1.8 observed geometry only, not full keyboard or zoom acceptance. |

D340's completed immediate dispositions remain: no coarse-pointer variants; no duplicate mobile observed-log case; former phone receipt/image/archive/pinned-notification checks move to narrow desktop. The Archive Paper Ink narrow reference replaces the former phone triple. D294 contact phone-number validation and retired-Capture absence guards remain. No reference image is changed by 3.1.8.

## Shared ownership and admission boundaries

These allocations identify current coupled files and the operations that must be extracted or completed. They do not claim that new APIs already exist. A later focused plan must name the actual accepted prerequisite commit, resulting exports/paths, exact focused commands, fixture/output roots and either-order merge proof. A child may not edit the reserved shared file because it finds a missing hook. Resolve that requirement in its prerequisite before launch. No unfinished sibling dependency is permitted.

| Shared seam now | Sole prerequisite owner and required operation | Independent consumers after acceptance |
| --- | --- | --- |
| `src/dashboard/app/dashboard-app.tsx`, `url-state.ts`, `nav-history.ts`, shared shell `surfaces/top-bar.tsx` and `shell.tsx` | 3.1.9 extracts route/open/close/history/focus and registration operations plus notification and session slots. Preserve dirty Settings guard. Shared file changes are complete before the first surface child. | 3.1.9.1 shell; 3.1.9.5 inbox; 3.1.10 date consumes dedicated date state; 3.1.11 takes the completed session slot. |
| `src/dashboard/surfaces/settings.tsx`, `settings-model.ts`, `src/domain/dashboard/settings-editor.ts`, `src/server/dashboard/queries/bootstrap.ts` | 3.1.9 separates Settings host, ordinary/protected editor, storage/doctor/preflight slot and catalog registration. Bind read catalog, edit/set/clear, independent protected write/read-presence and explicit runtime-status operations; no promise of full editor implementation here. | 3.1.9.2 editor; 3.1.9.3 storage; 3.1.9.4 catalog. Later Setup consumes the accepted preflight slot through 3.1.11. |
| `src/server/dashboard/compose.ts`, `compose/operator.ts`, `compose/trust.ts`, `routes/api.ts`, `routes/operator.ts`, `routes/data.ts`, `routes/trust.ts`, `routes/api-types.ts`; `src/dashboard/client/queries.ts`, `commands.ts` | 3.1.9 completes per-surface registration/transport ports and ingress coverage. Operations include query/read/subscribe plus execute/replay/refuse, upload/prepare, archive file/download and version/deletion commands, notification delivery and doctor. | Surface children own separated modules only; no peers editing a giant route switch, shared client interface or composition object. Later groups transfer the accepted relevant ports explicitly. |
| `src/server/dashboard/queries/run-summaries.ts`, shared summary/query types and `src/server/dashboard/projectors/run-queue-projection.ts` | 3.1.9 isolates Activity range/CSV and Queue day/member/action source boundaries; retain transaction-history query and privacy, freshness and bounded costs. | 3.1.12 Activity and 3.1.13 Queue may not both write the current combined summary module. |
| `src/infra/sqlite/migrations.ts`, shared authority adapters, command union/kernel registration; D337 Explorer persistence | 3.1.9 owns shared schema/registration and the required transactional override read/replace/audit/replay port before children. Released migrations 1–49 immutable; schema-50 input and table custody preserved. Parent brief binds any new migration and conversion proof needed for already-approved D337. | 3.1.9.4 owns its closed presentation editor/service over that accepted port; no sibling receives a competing migration writer. No schema change is implemented by 3.1.8. |
| `tests/parity/helpers/fixture-day.ts`, `fixture-bff.ts`, `seeded-bff.ts`; `tests/parity/dashboard-reference.spec.ts`; common unit fixtures | 3.1.9 separates per-surface profiles, scenario registration and seeded services. Each scene has one owner, real schemas and a source-bound bundle; common builders are frozen before leaves. | Each surface owns its dedicated fixture/spec/reference filenames. 3.1.23 alone combines broad reference membership/generated roadmap; only 3.1.9.2 may propose P40/A8 image changes, explicitly attributed and verified under the current cadence. |
| `src/dashboard/app/command-dispatch.ts`, `bulk-dispatch.ts`, `surfaces/run-start.tsx`, session/footer registration and worker/start-plan transport | 3.1.11 completes session/control and launch APIs before Setup/Run children: pool read/plan/spawn; worker pause/resume/stop; exact-session browser refresh/reopen with their currently missing cross-process channel; readiness/rerun; source-bound open/prefill/preview/acknowledge/final-submit/replay. Each operation needs real effect/refusal proof. Remove cross-child shared entrypoint writes by extraction. | 3.1.11.1 Setup/preflight modules; 3.1.11.2 Run/Rerun modules. 3.1.24 combines broad proofs. 3.1.13 consumes the accepted launch API later. |
| `src/dashboard/surfaces/log-panel.tsx`, `log-panel-model.ts`, `trust.tsx`; `src/dashboard/app/use-panel-sections.ts`; `src/server/dashboard/queries/run-detail.ts`, `run-detail-types.ts`, `run-trust.ts`, `run-sections.ts`, `data.ts`; `src/domain/dashboard/run-detail.ts` | 3.1.14 completes timeline/section dispatch and disjoint read/refresh/subscribe/provenance/capture/receipt/annotation/gate/park operations. Separate live failure commands from shared read-only display and isolate Context readback from previously accepted Rerun-values producer. | 3.1.14.1 timeline, .2 Context, .3 logs/captures, .4 receipts/failures/diagnostics, .5 gates/park. No two children edit the current shared trust/log/detail switches. |
| `tests/parity/helpers/fixture-gate.ts`, `fixture-failure-resolution.ts`, capture fixtures and common detail seeds/reference registrations | 3.1.14 freezes disjoint timeline/Data/log/receipt/gate scenario imports and artifact ownership before children. | Child .3 owns capture bytes/viewer scenes; .4 owns failure/bundle scenes; .5 gate/park scenes. 3.1.25 alone combines membership and broad reference assertions. |
| `src/core/run-executor.ts`, `src/base/flow.ts`, shared gate source/result registration | 3.1.14 owns the currently missing non-operator subscription dispatch/settlement seam and its shared registration before children. Publish source identity, durable result/replay, failure and refresh operations; do not claim the declared `subscribes` type is an available consumer. | 3.1.14.5 owns isolated gate resolver/evidence tests and presentation over the accepted seam; no sibling writes the shared executor. Workflow-specific activation still requires its own admitted task. |

## Leaf file and artifact ownership

Paths below are existing seams to retain or separate; a shared file reserved above is excluded from a leaf until its prerequisite publishes the replacement. New names are deliberately not invented here. No child is launch-ready from this baseline alone. Artifact roots are disjoint task labels beneath each future worktree's own evidence root; bound absolute paths at leaf admission. They cannot share operator state, screenshot names, compiler output, or a mutable Git index.

| Owner | Exclusive existing feature seams after shared extraction | Focused evidence namespace / combined release |
| --- | --- | --- |
| 3.1.9.1 | shell/layout/keys and `ds/` primitives; excludes notification/session and Settings bodies | `3.1.9.1/`; 3.1.23 |
| 3.1.9.2 | `queries/settings-editor.ts`, `commands/settings-service.ts`, isolated editor; catalog is read-only input | `3.1.9.2/`, P40/A8 scene list frozen at admission; 3.1.23 |
| 3.1.9.3 | `queries/storage.ts`, isolated doctor/recovery presentation; accepted recovery tests, no advanced UI | `3.1.9.3/`; 3.1.23 |
| 3.1.9.4 | `surfaces/explorer*.ts*`, `ui-catalog*.ts*`, `row-catalog*.ts*`, `queries/explorer.ts`, `ui-catalog.ts`, `commands/explorer-edit-service.ts`, `explorer-override-store.ts` over prerequisite storage port | `3.1.9.4/`; 3.1.23 |
| 3.1.9.5 | isolated inbox from top-bar; `services/notifications/`, `domain/notification-triggers.ts` | `3.1.9.5/`; 3.1.23 |
| 3.1.9.6 | `surfaces/intake*.ts*`, `commands/intake-service.ts`, `domain/intake/`; no Run modal or prior-run readback writer | `3.1.9.6/`; 3.1.23 |
| 3.1.9.7 | `surfaces/archive*.ts*`, `queries/archive-reports.ts`, `archive.ts`, `commands/version-review-binding.ts`; existing archive tests/fixtures | `3.1.9.7/`; 3.1.23 |
| 3.1.10 | isolated date picker/state/history integration tests | `3.1.10/`; focused checks; broad gates at 3.1.19 |
| 3.1.11 | `worker-supervisor.ts`, isolated session control plus shared child APIs | `3.1.11/`; focused prerequisite checks; broad gates at 3.1.24 |
| 3.1.11.1 | `server/preflight/`, `domain/trust/preflight-scenarios.ts`, isolated Setup presentation | `3.1.11.1/`; 3.1.24 |
| 3.1.11.2 | `surfaces/run-start*.ts*`, `commands/start-plan-service.ts`, separated prior-run value transport and modal; settings runtime is accepted input | `3.1.11.2/`; 3.1.24 |
| 3.1.12 | `surfaces/activity*.ts*`, `day-search*.ts*`, `queries/activity-export.ts`, `search.ts`, `exports/`; extracted Activity summaries | `3.1.12/`; focused checks; broad gates at 3.1.19 |
| 3.1.13 | `surfaces/queue*.ts*`, `workflow-batch.tsx`, extracted Queue summaries/actions/bulk; accepted Rerun launcher only | `3.1.13/`; focused checks; broad gates at 3.1.19 |
| 3.1.14.1 | extracted timeline/identity and follow-state implementation/tests | `3.1.14.1/`; 3.1.25 |
| 3.1.14.2 | `surfaces/context-rail*.ts*`, separated Data/Attempts readback and tests | `3.1.14.2/`; 3.1.25 |
| 3.1.14.3 | `queries/run-logs.ts`, `run-captures.ts`, capture/screenshot surfaces and extracted log body; event producers only where traced missing | `3.1.14.3/`; 3.1.25 |
| 3.1.14.4 | `surfaces/receipt*.ts*`, `advisory*.ts*`, extracted trust/failure/bundle; `commands/failure-resolution.ts`, `queries/failure-resolution.ts`, `diagnostic-bundle.ts` | `3.1.14.4/`; 3.1.25 |
| 3.1.14.5 | `surfaces/identity-approve*.ts*`, `park-resolve*.ts*`, `app/identity-ceremony.ts`, extracted gate/park service and tests | `3.1.14.5/`; 3.1.25 |
| 3.1.15–3.1.19 | runtime; stream/client convergence; perf instruments; integration proof infrastructure; final audit, respectively | Exact task-number namespaces; serial existing dependency/release gates. 3.1.19 fixes nothing. |

Each leaf owns focused tests beside its isolated seam. `src/domain/**` shared unions, root configs, generated manifest/catalog/roadmap and combined parity membership remain the prerequisite/finalizer's exclusive files. The 3.1.23/24/25 finalizers are the admitted D344 identities, not new detached finalizers. Preserve the four-auxiliary-worktree ceiling and existing D191 focused-worker/full-finalizer cadence. Phase 2.6's single-finalization exception does not extend to these groups. Optional 3.1.20/21/22 never block acceptance except a newly admitted required workflow need under D339.
