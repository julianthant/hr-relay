# Task 3.1.9.5 · Finish notifications and delivery behavior
<!-- roadmap: dash-notifications -->

**Current delivery: complete — 2026-09-17.** Accepted candidate
`387836885d426db81dac63126adc28aea9f71ddd` is incorporated into local master through
`ac8c620b72ec47d9788909a4a52941a4c741f42a`. Required focused child/group gates, integration
and owned cleanup are complete; see the [finalizer closure](task-9-8-finalization-dashboard-surfaces.md#accepted-integration-and-group-closure--2026-09-17).
Full acceptance remains 3.1.19. Earlier dated plan/freeze receipts below retain their historical state.

**Current assignment: 3.1.9.5.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

Consume the [3.1.9 B ownership and working-interface record](task-9-establish-independent-dashboard-boundaries.md#b-implementation-and-child-release-contract--2026-09-13) at its accepted integration, together with the [approved Notifications ownership amendment](task-9-establish-independent-dashboard-boundaries.md#notifications-child-ownership-amendment--2026-09-14). The complete execution brief below is approved. N1–N5 focused candidate evidence is recorded below; group integration is accepted in the closure above; full acceptance remains 3.1.19.

- [x] Publish every declared trigger and prove durable row-before-delivery, dedupe, restart,
  reconnect-gap, permission-denied, lifecycle controls, and target navigation.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.

## Approved execution brief — 2026-09-14

The operator answered `yes` to the proposed decision recommendations, then explicitly answered
`approve` to the complete execution proposal. This record preserves that approval for **3.1.9.5
only**. It authorizes the bounded ownership and contract amendments below. It does not mark a
product outcome, implementation gate, integration or cleanup complete.

### Outcome, allocation and boundaries

Deliver the frozen matrix's **A11 durable actionable inbox and A12 complete production triggers**,
including D01–D03 desktop accessibility and resizing expectations. Use one **GPT-6 Astra medium
supervisor**, implementing locally with `/ui` Components and browser verification. This is one
coupled persistence → producer → wire → navigation → delivery pipeline with consequential crash,
archive and schema behavior; splitting it would create unfinished shared interfaces. There are
**zero implementation workers and zero independent reviewers**. Phase 3.1's approved no-review
cadence applies to this task and its finalization; do not substitute an analyst review.

Complete N1–N5 in order, using the earliest stable boundary for each regression. Routine coding
choices and repairs stay with the supervisor. Group related changes into logical commits. Full
repository acceptance belongs to **3.1.19**; the seven-child integration and focused release belong
to **3.1.9.8**. A focused candidate is not a completed group or completed Phase 3.1.

Excluded: changes to Settings bodies/configuration, Storage doctor or recovery behavior, Explorer,
workflows, shared transport/SSE protocol, command semantics, existing reference image families,
automatic backups, legacy runtime state, HR execution, operator database conversion, push, merge
or sibling/next-task dispatch. Notification-specific registration and persistence are the bounded
exceptions to shared-file reservations, not ownership of their hosts.

### Verified base and launch binding

| Item | Binding and verification |
| --- | --- |
| Repository and integration target | `/Users/julianhein/Projects/hr-automation-rebuild`, local `master`; operator-directed 3.1.9.8 owns integration, combined generated output and subsequent candidate cleanup. |
| Discovery base | `9f9dfe3566084e165bd508ae8b66dc3ebe325010`; primary checkout clean when inspected on 2026-09-14. |
| Frozen acceptance prerequisite | 3.1.8 integration `e182022edfa0cd05a46a74358cd3296bcade6e79`; require ancestor of the execution base. |
| Parent release prerequisite | 3.1.9 B integration `3d4d8c0c64cf2e96096b193966a66741861d6f1c`, containing A integration `c990662e91604cfd38baa53e12bfb6e7c60610eb`; require both ancestors. |
| Already integrated Shell input | `251d471b27dcdb0d32027fc5dd9acffffe3c6449` is in the discovery base. This is observed navigation context, not a new sibling dependency or merge-order requirement. |
| Planning custody | Branch `codex/plan-3.1.9.5`, checkout `/Users/julianhein/Projects/hr-worktree-notify-plan`, based on the discovery SHA. Commit this approved documentation, verify `git show` of its complete owner, then remove this owned checkout while retaining the branch. |
| Implementation checkout | **Create**, do not reuse, branch `codex/3.1.9.5-notifications` at `/Users/julianhein/Projects/hr-worktree-notifications` **from the full verified plan commit returned in the planning handoff**. Resolve `codex/plan-3.1.9.5` to that exact SHA before creation; the commit itself is the implementation base. |
| Plan delivery and merge condition | The named plan ref carries committed authority directly into the implementation checkout. Master documentation integration is not a launch prerequisite and is not authorized here. 3.1.9.8 consumes the frozen implementation SHA, including this planning ancestry, only under the operator's integration instruction and after assigned focused checks. No self-merge or push. |
| Capacity at planning | Three other auxiliary worktrees existed: Explorer, Settings and Storage. Preserve all three and their refs. Four auxiliary worktrees is the ceiling; remove the fourth, planning checkout before creating the implementation checkout. Recount at launch. |

Before the first implementation edit, verify exact plan SHA, clean owned branch/path, worktree/ref
availability, prerequisite ancestry, nearest module instructions, accepted parent interfaces and
current ownership. An absent planned execution branch/path is expected. An occupied resource,
changed prerequisite or incompatible shared-seam change is a blocker to resolve, not permission to
overwrite another task. Record the actual base and resources in this owner.

No operator database, credential, browser identity or live HR target is part of this assignment.
Upgrade/restore proofs use isolated synthetic authorities built under the real supported conversion
and recovery code. They establish feature behavior, not compatibility of an uninspected operator
database. Any request to convert actual state requires fresh target identity, stopped-system,
backup and compatibility checks under the owning recovery contract.

### Feasibility and current behavior

Inspected against the discovery base; these are implementation gaps, not assumed completed work.

| Boundary | Evidence and consequence |
| --- | --- |
| Durable inbox | `src/services/notifications/inbox.ts` commits create/fold before its optional delivery call. Ordinary repeated calls still fold and reset unread state. `gate-park.ts` remembers sources only in process memory, so restart is not replay-safe. Production construction in `src/server/dashboard/compose/notifications.ts` supplies no OS channel. |
| Trigger callers | The event union has eight arms. Only the gate watch and server-proven backfill gap have production callers. `storage-health.ts` remains present but D322 retired its caller. The other five arms have no production producer. Historical two/three-publisher claims in the contracts are superseded by the dated amendments, not new proof. |
| Wire and UI | `NotificationWireSchema`/`notificationWireOf` in `src/domain/dashboard/projection.ts` omit actual channel, count and publication identity. The bell model's optional delivery extras cannot make Ping/Inbox filters truthful. The top-bar callback opens only a run, and `dashboard-app.tsx` uses the selected day, losing exact failure and cross-date intent. |
| Lifecycle evidence | The canonical run-record service and `queries/canonical-runs.ts` distinguish live, archived and deleted. `lifecycle-storage.ts` verifies saved report ownership/digests. Transfer removes live failures/receipts but preserves inbox rows. Frozen authority-source sections can establish historical facts privately; public scrubbed sections cannot substitute for canonical receipt evidence. |
| Persistence and recovery | `migrations.ts` is schema 51 with recovery floor 46. Strict table registration, upgrade target admission and canonical delete accounting must include new notification metadata. Released migrations stay immutable; the next migration is 52 at this base. |
| Browser feasibility | The [Notifications Standard](https://notifications.spec.whatwg.org/), [Notification API](https://developer.mozilla.org/en-US/docs/Web/API/Notification), and [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) support permission-based desktop delivery and one same-origin tab owner. Secure-context/browser capability and permission failures must remain explicit. API acceptance cannot prove the operator saw a toast. |

Highest-risk assumptions are correct identity across restart/transfer, source adoption without
historical replay, receipt eligibility from verified archives, and preservation through stopped
upgrade/restore. N1/N2's negative controls must disprove incorrect shortcuts before browser polish.
Unsupported historical evidence is a named diagnostic, never fabricated eligibility. If available
canonical evidence cannot support the approved behavior, report the concrete gap and its owner;
do not silently relax acceptance or recreate retired storage structures.

### Approved product and authority decisions

The normative owners are [dashboard-surfaces](../../../reference/dashboard-surfaces.md#notifications-publication-amendment-2026-09-14),
[operator-trust](../../../reference/operator-trust.md#notifications-behavior-amendment-2026-09-14),
[frontend-backend-integration](../../../reference/frontend-backend-integration.md#notifications-wire-amendment-2026-09-14)
and the [decision-index amendment](../../../reference/decisions.md#notifications-amendment-2026-09-14).

1. Publication identities and health-observation state are notification-owned SQLite authority.
   Record a source identity and create/fold its inbox row atomically in one transaction. Replaying
   that identity does not change count, read state, snooze, version or publication identity. A
   genuinely new occurrence folds once. Processing metadata is not OS delivery history, and the
   inbox row remains authority for the operator's state.
2. Produce all eight existing event kinds from canonical durable facts through dashboard
   notification composition: `run-failed`, `subject-mismatch`, `gate-opened`, `write-parked`,
   `repeating-failure`, `storage-degraded`, `verified-done`, `backfill-gap`. Backfill remains exclusively
   server-proven by the unreplayable SSE cursor boundary. Observations are serialized, failed
   publication stays retryable and exposed, and shutdown awaits owned work before authority closes.
3. Repeating failure first publishes on the **third distinct retained failure** matching workflow,
   step and error class, including verified archived evidence. Later distinct failures fold one
   repeating alert. There is **no time window**. Polls, restart, replay and live-to-archive transfer
   do not count as new failures. Ordinary failures and threshold alerts remain distinct events.
4. Verified-done requires the canonical verified receipt. Dry runs, warnings, partial results,
   incompatible evidence and missing historical receipts cannot become verified-done. Never
   reconstruct a historical success from a label, public report prose or current descriptor alone.
5. Storage alerts cover applicable verified failure evidence: free space **below 1 GiB**; WAL
   **at least 256 MiB and growing across three one-minute observations**; integrity failures;
   actual failed/corrupt backup evidence; and expired ownership under the existing **60-second**
   lease rule. Health clearances update observation state without inventing a recovered trigger.
   Missing, old or generation-stale unrequested backups are not failures. D322's explicit-only
   backup writer stays unchanged. Retired `outbox-stalled` is explicitly inapplicable; do not
   recreate an outbox or substitute an unrelated pending write.
6. Read/unread and snooze are independent. Existing actor/CAS/exact command replay protections stay.
   Dismiss closes the drawer or desktop toast without deleting durable state. Pinned backfill rows
   stay permanently retained, immutable and visible under every ordinary filter. No new lifecycle
   command or unsnooze semantics are implied.
7. Resolve notification destinations against current authority when opened: live run on its own
   date, exact failure, verified saved report, Storage, or explicit missing/deleted refusal. Respect
   Settings' existing dirty-draft guard, including cancellation. Transfer preserves inbox/publication
   metadata; canonical delete removes linked notification-owned metadata. Frozen snapshots remain
   immutable; stale navigation races are explicit.
8. Serve actual Ping/Inbox channel, count and publication identity with validated IDs/closed codes
   needed for delivery and navigation. Publication identity changes only for new events, never
   read/snooze commands. Allow only safe composed notification text; private archive JSON, arbitrary
   diagnostic strings, captured fields and secrets never reach wire or OS payloads.
9. Enable desktop delivery by an explicit gesture in the drawer. Pings are silent and delivered
   only while the dashboard is open, after durable commit; Inbox-only events never toast. Use the
   Notifications API plus one same-origin Web Locks owner across tabs. Initial baseline, reload,
   reconnect, duplicate snapshots, state commands and tab handover do not replay old toasts.
   Denied permission, unsupported capability, synchronous throws and asynchronous errors are
   explicit. Delivery failure never mutates the durable inbox or adds per-attempt OS state.

### Steps and completion proof

| Step | Required change and result | Earliest proof / forbidden shortcut |
| --- | --- | --- |
| **N1 — Durable publication** | Add notification-owned source identities and health state, atomic inbox create/fold/adoption, migration 52 and strict registration. Preserve floor 46, released migrations 1–51, supported stopped conversion and backup/restore. | Same-source concurrency changes once; distinct occurrences fold once; rollback/crash before and after commit; restart; historical adoption without read/snooze reset. Fresh/stopped upgrade, interrupted recovery and restored metadata use the real authority boundary. No OS-attempt ledger. |
| **N2 — Complete producers** | Wire all eight event kinds through notification composition; read canonical live and verified frozen archive sources, serialize observation, retain and expose failures, await shutdown. | Every declared arm has an actual production caller. Distinct identity and third-failure crossing survive transfer/restart; dry-run/missing/incompatible receipt cannot notify verified-done. Health transitions, clearances and retired outbox applicability are proved. No private archive payload egress or invented backup failure. |
| **N3 — Actionable inbox** | Extend notification wire/client narrowly; truthful channel/count/filtering and independent publication identity. Add current-authority destination query and notification-only top-bar/app forwarding. | Wrong actor, stale version, exact/divergent command replay, pinned refusals, cross-date/exact-failure/archive/Storage links, delete race and dirty-Settings cancellation. Shared command/transport behavior stays accepted. |
| **N4 — Browser delivery** | Explicit permission UI, silent post-commit Pings, same-origin tab ownership and explicit unavailable/failure states. Preserve keyboard, theme, bounded scrolling, resizing and zoom. | Grant/deny/unsupported/throw/async error, two tabs, owner closure, reload/reconnect, snooze, no Inbox toast and pins under every filter. A successful API call is not evidence the person saw it. Inspect screenshots in both themes. |
| **N5 — Candidate and evidence** | Repair focused failures, commit exact paths by logical category, record candidate SHA, exact commands/exits, proof artifacts and deferred work. Freeze for 3.1.9.8 intake. | No missing/empty new suites accepted as green, no silent reference refreeze, no failed lint deferred. Keep integration, implementation-worktree cleanup and 3.1.19 acceptance pending until their owners complete them. |

### Exact ownership and shared-seam amendment

The parent [Notifications amendment](task-9-establish-independent-dashboard-boundaries.md#notifications-child-ownership-amendment--2026-09-14)
is the group authority. Within this isolated branch, the supervisor is the single writer for the
following notification changes; it may create notification-specific modules in the listed directories.

| Owned seam | Allowed paths and bounds |
| --- | --- |
| Notification domain/services | `src/domain/notifications.ts`, `src/domain/notification-triggers.ts`, `src/services/notifications/**`, `src/server/dashboard/compose/notifications.ts`. |
| Persistence/registration | Notification-only repository interfaces, transactions, table registration and lifecycle deletion in `src/infra/sqlite/authority-database.ts`, `src/domain/authority.ts`, `src/infra/sqlite/storage-records.ts`; next migration and version admission in `src/infra/sqlite/migrations.ts`; new notification-specific SQLite modules. Notification schema admission only in `src/server/storage/upgrade.ts` and `src/infra/sqlite/offline-restore.ts` if required by the new registered version. No general recovery redesign. |
| BFF composition/target | New notification-specific `src/server/dashboard/queries/notifications.ts` and route module as needed; only notification route/service registration, lifecycle start/stop and exposed publication failures in `src/server/dashboard/compose.ts`, `src/server/dashboard/routes/api.ts` and `api-types.ts`. Canonical run/archive readers are consumed, not replaced. |
| Wire/client | Notification fields only in `src/domain/dashboard/projection.ts` and `src/server/dashboard/projectors/run-queue-projection.ts`; `src/dashboard/state/notification-client.ts`, new `src/dashboard/client/notification-queries.ts`, and notification-only aggregate/provider typing in `src/dashboard/client/queries.ts` and `index.ts`. No shared transport or SSE protocol changes. |
| UI/navigation | `src/dashboard/surfaces/notification-bell.tsx`, `notification-bell-model.ts`, new notification delivery modules under `src/dashboard/state/`; notification-only callback forwarding in `src/dashboard/surfaces/top-bar.tsx` and `src/dashboard/app/dashboard-app.tsx`, using existing navigation and dirty-Settings APIs. Search callbacks and Settings bodies retain their owners. |
| Proof/registration | `tests/parity/helpers/fixture-notifications.ts`, `tests/parity/backfill-gap.spec.ts`, new `tests/parity/notifications.spec.ts`; the focused notification suites below. Directly affected strict notification literals in `tests/unit/dashboard-wire.test.ts` and `tests/unit/dashboard/notification-inbox-model.test.ts`; notification-specific projector, stream, architecture, supported-conversion and backup/restore regressions. Only notification registration/strict compatibility hunks may enter shared fixtures/guards. Record exact expanded touched paths in candidate evidence. |
| Generated and plan evidence | `npm run build:manifest` owns affected manifest output; do not hand-edit it. `docs/rebuild/guard-inventory.json` changes only if a guard is added/retired, with deciding evidence. This task owner records execution/proofs. This planning commit owns its targeted parent/contract/decision/roadmap amendments and generated roadmap output. |

Protected siblings include Settings configuration/editors; Storage's `storage-doctor.ts`,
`recovery-contracts.ts` and storage recovery presentation; Explorer/Catalog; Archive surfaces and
report formats; workflow/descriptor semantics; command union/kernel; shared transport/subscription;
default scene membership and every existing PNG reference. Reading their stable APIs does not
transfer ownership. Direct notification compatibility is bounded; unrelated shared-interface changes
return for amendment. Existing in-flight peers keep their ownership, gates and merge order. This
child adds no peer dependency; 3.1.9.8 can combine it in either order with those peers, resolving
bounded registration/plan-text conflicts from the approved owners and regenerating combined output.

### Proof matrix

| Boundary | Required positive, negative and race cases |
| --- | --- |
| Publication transaction | Concurrent identical source; distinct repeated sources; transaction failure; crash before commit; crash after commit before delivery; restart; pre-existing row/source adoption preserving count/read/snooze. No partial publication identity and no replay fold. |
| Source observation | Every production event arm; stable source identity; threshold third occurrence and later fold; live/archive transfer during observation; missing/invalid archive receipt; dry run; corrupt evidence; recoverable publication error; health clear/re-enter; inapplicable retired outbox. |
| Commands/targets | Wrong actor; stale row version; exact replay; divergent replay; pinned refusal; cross-date live run; exact failure; verified archived report; Storage; deleted/missing target and lookup-to-open race; dirty Settings navigation cancelled and accepted. |
| Delivery/desktop | Permission grant/denial/default and unsupported APIs; synchronous constructor failure/asynchronous error; two tabs/leader closure; baseline/reload/reconnect/duplicate snapshots; read/snooze changes without new publication; snooze suppression; Inbox never toasted; pins visible in every filter; dismissal keeps row. |
| Recovery | Fresh schema; every currently supported stopped conversion path; interruption/recovery; old inbox and new publication metadata preserved; exact backup/restore round trip; unchanged recovery floor and immutable released migration history. |
| Privacy/UI | Closed fields/composed strings only, malformed identifiers rejected, no archive source or diagnostic leakage; both themes, keyboard/focus, bounded scrolling, desktop 1024×720 and larger, resizing and zoom; no mobile/coarse-pointer variants. |

### Gates, resources and evidence schedule

At iteration, run the earliest meaningful regression and scoped lint on changed code/tests; capture
red then green at the behavior boundary. Related changes form logical candidate commits, not one
broad gate per micro-cycle. At N5, all named new suites must exist and actually execute. Run:

```sh
npm run typecheck
npm run test -- \
 tests/unit/notification-inbox.test.ts \
 tests/unit/notification-gate-park.test.ts \
 tests/unit/notification-backfill-gap.test.ts \
 tests/unit/storage-health-notifier.test.ts \
 tests/unit/notification-publication.test.ts \
 tests/unit/notification-upgrade.test.ts \
 tests/unit/server/notification-producers.test.ts \
 tests/unit/server/notification-target.test.ts \
 tests/unit/dashboard/notification-inbox-model.test.ts \
 tests/unit/dashboard/notification-delivery.test.ts \
 tests/unit/dashboard-wire.test.ts \
 tests/unit/server/run-queue-projection.test.ts \
 tests/unit/server/dashboard-stream.test.ts \
 tests/unit/architecture/notification-durability.test.ts \
 tests/unit/architecture/operator-mutation-admission.test.ts \
 tests/unit/architecture/redaction-surface-scan.test.ts \
 tests/unit/storage-supported-conversion.test.ts
npm run test:parity -- tests/parity/backfill-gap.spec.ts tests/parity/notifications.spec.ts --workers=4
npm run build:manifest
npm run build:manifest:check
git diff --check
```

Run scoped ESLint with `npx eslint <expanded changed code/test paths> --max-warnings 0`; record the
actual expanded argv, not a placeholder. Add the directly affected backup/restore and registration
regressions, recording their exact command. Existing entry points include
`tests/unit/storage-backup.test.ts`, `tests/unit/storage-restore-drill.test.ts`,
`tests/unit/architecture/migration-history-immutability.test.ts`, and
`tests/unit/architecture/dashboard-wire-boundary.test.ts`; select affected cases from the actual
diff, preserving all existing assertions and membership. The new notification-upgrade suite must
prove metadata restoration even where a generic test needs no edit.

Use the worktree's own `dist`, parity outputs and test-runner temporary roots. Bind test servers to
ephemeral ports, never rebuild operator ports 3938/5174. At most four file workers. Do not overlap
commands writing the same generated/build/test outputs; generation precedes freshness checking.
Parity runs the authoritative global setup; use its real config, no reduced substitute. Inspect
desktop screenshot artifacts in both themes, including keyboard, resizing and zoom cases. New
notification scenarios use owned profiles. No existing reference image refreeze is approved.
Read the platform playwright-cli reference before interactive browser verification and close only
owned sessions/resources.

Fix test and lint failures locally, then rerun invalidated checks and the necessary neighboring
combination. Preserve timeouts, assertions, membership, coverage floors and isolation. Reuse only
with recorded command/result, tested tree, current candidate and verified unchanged inputs; a SHA
change alone does not invalidate unchanged inputs. A changed wire, schema, producer or behavior
invalidates its relevant consumers/proofs. Never label an unrun or empty selector passed.

Planning and recording-only changes use D191 documentation checks: roadmap binding, touched links,
existing instruction-twin equality and instruction-chain cap, affected generated output and diff
whitespace. They do not establish new runtime behavior. No prior code-gate success is claimed for
these new requirements. 3.1.9.8 combines exact candidates and runs typecheck, focused integration
regressions, scoped lint and affected generated/build checks. **Full coverage, broad parity,
performance and full live acceptance remain deferred to 3.1.19**, which repairs final failures.

### Delivery and stop conditions

The supervisor records Done / Now / Remaining at start/resume and after each verified completion,
before the next tool call. Keep all unfinished steps, gates, integration and cleanup visible.
Record code/proof identity and command exits in a compact table; no canary or secret values.
Complete N1–N5, commit and freeze the focused candidate for operator-directed 3.1.9.8. No independent
review is required under the Phase 3.1 exception. Leave this task's product checklist open until
assigned checks, integration and cleanup satisfy the parent completion rule.

Pause only for changed prerequisites, occupied/unsafe resources, material ownership or contract
expansion, incompatible canonical evidence, or an actual blocker. Do not re-ask approved decisions.
If interrupted with unique unfinished state, use `/handoff`; ordinary successful stage transfer uses
this record. Retain the named planning ref until finalizer consumption is verified. Never push,
self-merge, convert operator state or dispatch another task under this assignment.

### Planning verification — 2026-09-14

Implementation is pending. Planning validation and committed-content custody are recorded here
before handoff; the final full plan SHA is resolved from the commit containing this section and
supplied in the supervisor prompt, avoiding a self-referential commit identifier.


Planning changes are confined to eight documentation/generated-document paths: this owner, its
parent ownership amendment, the three notification contracts, their decision index, the roadmap
source and generated `docs/roadmap/index.html`. No runtime source, tests, dependencies, configuration,
released migration, instruction file or product checkbox changed. Substantive assessment is recorded
in the feasibility, approved-decision and proof rows above; these requirements still need implementation.

| Planning check | Result and evidence |
| --- | --- |
| `npm run test -- tests/unit/architecture/roadmap-doc-binding.test.ts` | Exit 0; one suite, 24 tests passed. Re-run on the final recorded document tree before commit. |
| `npx eslint tests/unit/architecture/roadmap-doc-binding.test.ts scripts/generate-roadmap.ts scripts/roadmap/parse-plan.ts scripts/roadmap/scan-docs.ts scripts/roadmap/schema.ts --max-warnings 0` | Exit 0. Recording changes only documentation; these lint inputs and their dependencies remain byte-identical, so that result is reused for recording. |
| `npm run roadmap` and `npm run roadmap:check` | Exit 0; generated output is fresh. The corrected notification contract binding now points to operator-trust §6. Check again after recording. |
| `python3 /Users/julianhein/Projects/hr-notifications-plan-evidence-20260914-29fw66q4/check-plan.py` | Exit 0; exact eight-path documentation scope, 22 added/changed local links, 9 existing instruction pairs equal, largest complete project chain 18,376 bytes, 50 explicit approval controls and four prerequisite ancestors. Recheck the recorded tree. |
| `git diff --check` | Exit 0 before recording; required again before commit. |
| Runtime acceptance | Not run or reused for this documentation-only candidate. New publication, migration, producer, wire and delivery behavior remain pending N1–N5. |

Logs, the validation script and exact checked document blob identities are retained outside the
owned checkout at `/Users/julianhein/Projects/hr-notifications-plan-evidence-20260914-29fw66q4/`.
The planner must verify the full committed owner with `git show`, compare it to this approved
assignment, check named-ref reachability/prerequisite ancestry and available execution resources,
then remove only `/Users/julianhein/Projects/hr-worktree-notify-plan` while retaining
`codex/plan-3.1.9.5`. The returned full commit SHA binds the supervisor's execution base. The primary
checkout stays at the inspected base; local master integration remains operator-directed 3.1.9.8 work.

### Focused candidate — 2026-09-14

**N1–N5 are complete for focused intake.** Product completion remains open for operator-directed
3.1.9.8 integration and branch/worktree cleanup; full acceptance belongs to 3.1.19. No independent
review was performed under the Phase 3.1 exception. No worker, reviewer or sibling task was dispatched.

| Custody | Verified identity |
| --- | --- |
| Base / retained plan | `897b3a2b232621db14955c0071928babf36b9e18`; `codex/plan-3.1.9.5` remains at that exact SHA. |
| Persistence commit | `de29e3f7c79fb6517db0bcdf7196dfcd7678d962` — 15 exact paths. |
| Implementation candidate | `f77ba90f6183761c964eac334b3b9cc08f3cb827` — 34 additional exact paths; includes persistence and approved planning ancestry. |
| Frozen intake ref | `codex/3.1.9.5-notifications`; its final documentation-only recording commit is returned in the supervisor's completion message and external `frozen-candidate.json`. Integrate that full tip. |
| Checkout | `/Users/julianhein/Projects/hr-worktree-notifications`. Created from the exact plan commit after free branch/path, four-worktree capacity, ownership and module-instruction checks. |
| Prerequisites | 3.1.8 `e182022edfa0cd05a46a74358cd3296bcade6e79`, B `3d4d8c0c64cf2e96096b193966a66741861d6f1c`, A `c990662e91604cfd38baa53e12bfb6e7c60610eb` and Shell `251d471b27dcdb0d32027fc5dd9acffffe3c6449` remain ancestors. |
| Preserved resources | Primary master `9f9dfe3566084e165bd508ae8b66dc3ebe325010`; Explorer, Settings and Storage worktrees/refs preserved. Four auxiliary worktrees remain. No operator-state conversion, merge or push. |

**Operator-approved registration amendments.** The operator answered `approve` to the exact
registration patch in `src/infra/compat/backup-inspection.ts` (two notification table names and
historical schema 51 admission) and `src/domain/run/deleted-run.ts` (notification publication deletion
accounting). A subsequent real restore/upgrade rerun exposed the companion manifest bound in protected
`src/infra/sqlite/recovery-contracts.ts`; the operator explicitly approved changing its historical
upper bound from `50` to `51`. Those literal corrections are applied. The recovery floor remains
**46**, released migrations **1–51** remain immutable, and migration 52's pinned digest is
`360f6b9bb5725cc9df6e48202cb2900dd9870270c332782d3377453445b81bb5`.
No general recovery behavior changed.

| Step / proof boundary | Implemented result and executed proof |
| --- | --- |
| N1 — publication | Atomic source identity plus inbox create/fold/adoption; replay preserves count, read/snooze and version. `notification-publication.test.ts` proves concurrent replay, distinct sources, rollback, real process exit before/after commit, restart, historical adoption and failed delivery. No OS attempt ledger. |
| N1 — recovery | `notification-upgrade.test.ts` exercises fresh schema 52, supported stopped conversions 46–51, interrupted recovery and exact metadata backup/restore. Supported-conversion, backup, restore-drill, migration immutability and table-generation suites also pass. Synthetic isolated authority only. |
| N2 — production callers | Canonical observer produces run-failed, subject-mismatch, gate-opened, write-parked, repeating-failure and verified-done; health observer produces storage-degraded; existing server-resume boundary remains the sole backfill-gap producer. Failed observed facts remain pending across subsequent polls, publication failures are exposed through closed status codes, reads serialize and shutdown drains. |
| N2 — identity / archive | Producer suite proves distinct retained failure counts, third-failure threshold including real frozen archives, publication of a live observation after transfer, restart without replay, canonical deletion of owned metadata, dry-run/warning/missing/mismatched/corrupt archive evidence and publication retry. |
| N2 — health | Real read-only integrity inspection, actual backup manifest verification without a backup writer, generation-stale backup acceptance, actual worker lease boundary at 60 seconds, disk/WAL thresholds, clear/re-enter and inapplicable outbox are exercised. |
| N3 — wire / commands | Actual channel, count and stable publication identity served for ordinary and pinned rows; safe text composed from closed triggers. Inbox/kernel regressions preserve actor/CAS, exact/divergent replay, pinned refusals and independent read/snooze state, including expired snooze. Projector/stream and privacy guards pass. |
| N3 — destinations | Current authority resolves own-date live run, exact current failure, verified saved report and Storage; actor, malformed identity, deleted/missing target and changed lookup refusal are explicit. Model proof and browser navigation prove dirty-Settings cancellation preserves the draft and accepted navigation rechecks the destination. |
| N4 — desktop | Explicit enable gesture, silent Ping delivery, real same-origin Web Locks owner and fresh owner baseline. Unit/browser cases cover grant/default/denial, unsupported capability, constructor/async failure, two tabs and owner closure, replay/reload/reconnect, read/snooze, Inbox suppression and newly committed pins. API acceptance does not prove a person saw a toast. |
| N4 — UI | `/ui` Components executed locally using existing primitives; specimen inspected with playwright-cli. Authoritative filtered parity passes both Paper Ink and Graphite Warm, 1024×720 and 1440×900 at 125% zoom, keyboard opening/Escape focus restoration, bounded scrolling and pins under every filter. Four final PNGs inspected/retained; existing reference images unchanged. |
| N5 — candidate | Implementation split into the two exact-path commits above; this evidence-only record preserves focused outcomes and deferred ownership. No required focused failure is deferred. |

Evidence root: `/Users/julianhein/Projects/hr-notifications-evidence-20260914/`. Full logs, expanded
argv, final non-documentation SHA-256 input map (`final-inputs.json`) and retained browser artifacts
are outside the checkout. Source/test/build/config/dependency inputs match the implementation
candidate; the final commit changes only this owner. No code-gate result is attributed to unrun
broad acceptance. The consumed N1 handoff's facts and approvals now live here and its exact file was
removed after verification.

| Gate | Exact command / result / artifact |
| --- | --- |
| Typecheck | `npm run typecheck` — exit 0 on final implementation inputs; `n5-typecheck-freeze.log`. |
| Approved focused set | The exact 17-suite `npm run test -- …` command in the approved schedule above — exit 0, **17 files / 271 tests**; expanded argv `n5-focused-green-argv.json`, log `n5-focused-green.log`, exit receipt `n5-focused-green-exit.json`. All named new suites executed. |
| Recovery / registration neighbors | `npm run test -- tests/unit/storage-backup.test.ts tests/unit/storage-restore-drill.test.ts tests/unit/architecture/migration-history-immutability.test.ts tests/unit/architecture/dashboard-wire-boundary.test.ts tests/unit/sqlite-authority-database.test.ts` — exit 0, **5 files / 167 tests**; `n5-recovery-final.log` and matching argv/exit JSON. |
| Scoped lint | Expanded command below — exit 0 over **49 paths**, `n5-lint-final.log` / `n5-lint-argv.json`. The later strict pinned expectation change was separately rechecked with `npx eslint tests/unit/notification-inbox.test.ts --max-warnings 0`, exit 0, `n5-lint-pinned-expectation.log`. |
| Browser / build | `npm run test:parity -- tests/parity/backfill-gap.spec.ts tests/parity/notifications.spec.ts --workers=4` — exit 0, **8 scenarios**, authoritative global build/setup and signed a11y evidence; `n5-parity-final.log`, `browser-final/`. No reference refreeze. |
| Manifest | `npm run build:manifest` then `npm run build:manifest:check` — both exit 0; `n5-manifest.log`, `n5-manifest-check.log`; no generated source diff. |
| Documentation | `npm run test -- tests/unit/architecture/roadmap-doc-binding.test.ts` — exit 0, **1 file / 24 tests**; `npx eslint tests/unit/architecture/roadmap-doc-binding.test.ts --max-warnings 0` and `npm run roadmap:check` — exit 0. `python3 /Users/julianhein/Projects/hr-notifications-evidence-20260914/check-candidate.py` and `git diff --check` — exit 0: 13 owner links valid, nine instruction pairs equal, largest chain 18,376 bytes, four prerequisite ancestors, approved brief unchanged, 2,366 non-documentation inputs identical to the implementation commit. Logs: `n5-roadmap-binding.log`, `n5-doc-lint.log`, `n5-roadmap-check.log`; receipt: `candidate-validation.json`. |
| Deferred | Full coverage, broad parity, performance and live acceptance were not run or claimed. 3.1.9.8 runs its focused combined integration schedule; 3.1.19 owns full acceptance and repairs. |

Expanded lint argv also enumerates the exact 49 implementation/proof paths. The only additional
candidate path is this task owner:

```sh
npx eslint src/dashboard/app/dashboard-app.tsx src/dashboard/client/index.ts src/dashboard/client/notification-queries.ts src/dashboard/client/queries.ts src/dashboard/state/notification-client.ts src/dashboard/state/notification-delivery.ts src/dashboard/state/notification-navigation.ts src/dashboard/state/use-notification-delivery.ts src/dashboard/surfaces/notification-bell-model.ts src/dashboard/surfaces/notification-bell.tsx src/dashboard/surfaces/top-bar.tsx src/domain/authority.ts src/domain/dashboard/projection.ts src/domain/notifications.ts src/domain/run/deleted-run.ts src/infra/compat/backup-inspection.ts src/infra/sqlite/authority-database.ts src/infra/sqlite/migrations.ts src/infra/sqlite/notification-publications.ts src/infra/sqlite/recovery-contracts.ts src/infra/sqlite/storage-records.ts src/server/dashboard/compose.ts src/server/dashboard/compose/notification-health.ts src/server/dashboard/compose/notification-sources.ts src/server/dashboard/compose/notifications.ts src/server/dashboard/queries/notifications.ts src/server/dashboard/routes/api-types.ts src/server/dashboard/routes/api.ts src/server/dashboard/routes/notifications.ts src/services/notifications/inbox.ts src/services/notifications/observation.ts src/services/notifications/storage-health.ts tests/parity/backfill-gap.spec.ts tests/parity/helpers/fixture-notifications.ts tests/parity/notifications.spec.ts tests/unit/architecture/migration-history-immutability.test.ts tests/unit/architecture/notification-durability.test.ts tests/unit/dashboard-wire.test.ts tests/unit/dashboard/notification-delivery.test.ts tests/unit/dashboard/notification-inbox-model.test.ts tests/unit/notification-gate-park.test.ts tests/unit/notification-inbox.test.ts tests/unit/notification-publication.test.ts tests/unit/notification-upgrade.test.ts tests/unit/server/notification-producers.test.ts tests/unit/server/notification-target.test.ts tests/unit/server/run-queue-projection.test.ts tests/unit/sqlite-authority-database.test.ts tests/unit/storage-health-notifier.test.ts --max-warnings 0
```

**Expectation decisions and delivery assessment.** Two planning omissions required operator-approved
registration amendments: backup/delete registration, then the historical manifest admission bound.
Checking the complete migration-to-backup-to-delete registration path during planning would have
avoided those pauses. These amendments complete the approved behavior; they do not broaden recovery.

Implementation repairs caught by focused proofs included retained expired snoozes, strict wire
fixtures, archive fixture/source shapes, retry retention, pinned desktop delivery and accessibility
attachment/theme setup. The first N5 run had two old-contract expectations: Storage now has its
approved destination, and the retired backup helper's identical event cannot invent a new source.
Those expectations changed under approved decisions 1/5/7; exact replay equality and private
fingerprint exclusion were added, while the production observer separately proves health re-entry.
The three old durability fold assertions now use distinct failure IDs and retain their original
fold/unread/snooze outcomes. The projector ordering assertion uses exact IDs because public titles
are now safely composed. Strict pinned assertions add delivery fields while preserving refusal of
revision, link, mutable state, Inbox channel and count changes.

The pre-existing `sqlite-authority-database.test.ts` generation-membership assertion failed on the
unchanged primary base because its Explorer case was absent (`preexisting-explorer-registration.log`).
Its existing supported Explorer fixture now supplies the missing registration case; production
Explorer code and membership assertions are unchanged. New notification table cases are included.
No guard was added or retired, so guard inventory remains unchanged. Historical repair telemetry is
partial; no total repair count or elapsed-time savings is inferred. The interrupted N1 state was
consumed, approvals verified and required gates rerun; no assignment resizing or extra agents occurred.

Owned verification browser `notifications-3195` is closed; the ephemeral specimen port 57791 has no
listener. Parity fixtures closed their owned servers/contexts. The ignored dependency symlink and
build/evidence outputs remain within the implementation checkout for finalizer cleanup. Operator
ports 3938/5174, runtime authority, credentials and legacy state were not used. Retain this branch,
worktree and planning ref until operator-directed 3.1.9.8 consumption and cleanup. No self-integration.
