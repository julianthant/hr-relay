# 03a · Phase 3a — finish the dashboard

Phase 3 migrates the legacy workflows one at a time, and nothing could be wired into a dashboard
that did not exist yet. **Phase 3a is that dashboard**: the generic surfaces EVERY workflow
inherits, built once, plus the hardening the first real connection to a running workflow exposed.
Phase 3 is three docs — **3a** is this one (tree node `{#dash-defaults}` and everything under it),
**3b** finishes separations (`03b-finish-separations.md`, which also carries phase 3's own node
`{#phase-3}`), **3c** migrates the remaining workflows
(`03c-migrate-the-remaining-workflows.md`). Contracts this phase built or amended live in
`reference/`; this doc holds the work, its state, and its exit.

## Phase summary
<!-- roadmap: dash-defaults -->

<!-- roadmap-status: dash-defaults -->
- [x] every surface the wiring matrix names is served and drawn — top bar, workflow panel, queue rows, run detail + timeline, Context rail, gate ceremony, parked write, receipt/failure, run modal, archive, activity, explorer, settings + storage doctor, intake, the phone capture page, session panel (Track B, D222–D259)
- [x] the notification inbox has production producers — backup health (D222) and the gate park (D262), both wired in `src/server/dashboard/compose.ts`
- [x] the connection is proved end to end: the REAL dashboard drove a REAL composed separations dry run, every UI claim paired against authority (Track C, `docs/migrations/separations.md` §9.22)
- [x] the reference corpus asserts green over the corrected surfaces — 139 references re-frozen, 151 assert-mode cases green (`81287bb1`)
- [ ] Track D's D1–D5 — one status/outcome derivation, the hygiene commit, the settlement fold, patch-splice + `memo`, bounded read scans (ratified D264; every row still unlanded at HEAD)
- [ ] the three nodes drawn under this one on 2026-08-20 — the Duo ceremony lease, the worker pool and sessions, observed logs
- [ ] `ref frontend-backend-integration` §7.4's performance budgets have never been measured; Track D's D4/D5 are the first numbers and become the non-regression gates
- [ ] the run-detail panel's **Review** and **People** bodies — `availableSections` cannot return either section, so both tabs are structurally unreachable; the projections behind them land with the OCR and group migrations in 03c, not here
> 2026-08-20 | docs-cohesion 03a | verified against src/dashboard/** and src/server/dashboard/**; every Track D finding still reproduces at HEAD (no exported deriveRunStatus, two TASK_OUTCOME vocabularies, two panelKindOf copies, zero React.memo, WORKFLOW_DESCRIPTORS imported at dashboard-app.tsx:25); left: D1–D5, the lease, the pool, observed logs, the §7.4 numbers
<!-- /roadmap-status -->

### What this phase is, and what it is not

**It is the surfaces a migration only WIRES.** The run modal, queue rows, run detail + timeline, the
gate ceremonies, notifications, archive, activity, the explorer, settings + the storage doctor, and
intake / Edit Data. Each is built against the wire, not against a workflow: a later migration's
`Dashboard · wire` task supplies a descriptor DECLARATION (`surfaces.inputRun`, the `timeline`
categories, `nodePurposes`, `subjectProjection`) and a proof, never a new surface.

**It is not any workflow's own wiring.** Separations' nine wire squares are `{#sep-dash}` in doc 03b;
every later workflow's are the `order-N-dash` nodes in doc 03c. They read this node as their
prerequisite, which is exactly why "done" here has to mean something checkable.

**It is not the deferrals its surfaces name.** Editable settings, the explorer's EDIT half, the
production byte path for the phone page and the search/export surface each have a node with a
trigger in doc 04 — they are named absences on a built surface, not unfinished work in this phase.

### The order of work

**Track B** finished the surfaces with separations as the forcing function (2026-08-19 → 20, B1–B8
all landed). **Track C** then proved the connection — one pass where the real dashboard drove a real
composed dry run and every UI claim was paired with a direct authority read (2026-08-20). **Track D**
was ratified out of the same day's architecture audit (D264): eleven ordered moves, none a rewrite,
sequenced AFTER Track C on purpose, so the proof ran against the tree the operator had been using
rather than a freshly refactored one. The **three planned nodes** follow: the Duo ceremony lease
first (it is a hazard that exists today), then the worker pool and sessions on top of it, and
observed logs beside them.

### What "done" means for this phase

A later migration's `Dashboard · wire` task may read `{#dash-defaults}` as met when all of these
hold. Only the first four hold at HEAD.

1. Every row of the wiring matrix (`ref frontend-backend-integration` §5) has an implementation and
   a test, and every surface landed as ONE vertical slice (see §Integration execution rule).
2. The generic surfaces answer for a workflow they were not written for — proved once, against a
   real composed run, with each claim paired to authority (Track C).
3. The reference corpus photographs the surfaces as corrected, and asserts rather than rewrites
   (D132).
4. The findings ledger is zero-or-decided: no record whose status is merely `recorded`
   (`docs/findings/README.md`, B8).
5. Track D's D1–D5 have landed, so one fact has one derivation and the read scans are bounded.
6. `ref frontend-backend-integration` §7.4's budgets carry MEASURED numbers, which then become the
   non-regression gate every later workflow is held to.
7. The Duo ceremony lease exists, so a second workflow's worker cold-starting beside the first
   cannot burn the shared credential's counter.

### The honest state at HEAD, surface by surface

Verified against the code on 2026-08-20, not against the earlier prose (D252's rule). Where the two
disagreed, the code won and the row says so.

| Surface (`ref frontend-backend-integration` §5 row) | State at HEAD | Evidence |
|---|---|---|
| Top Bar + app shell | built | `src/dashboard/surfaces/top-bar.tsx`, `shell.tsx`; `GET /api/v1/bootstrap` |
| Notification bell + durable inbox | built, and BOTH production producers wired | `services/notifications/storage-health.ts` (D222) + `gate-park.ts` (D262), composed in `src/server/dashboard/compose.ts` |
| Workflow panel + status bar | built | `surfaces/status.tsx`, `shell.tsx` over `DashboardDayWire` |
| Queue panel + rows | built | `surfaces/queue.tsx` + `queue-toolbar.tsx` over `projectors/run-queue-projection.ts` (D230–D235) |
| Run detail + timeline | built; two tab BODIES deliberately unserved | `surfaces/log-panel.tsx`; `availableSections` (`queries/run-detail.ts:369`) returns no `review`, `people` or `captures` |
| Context rail — Data · Attempts | built | `surfaces/context-rail.tsx` (D252, D253); `context-evidence` re-homes to Receipt and has no placement yet |
| Gate ceremony | built — all three shapes, rejection, and a named refusal for a shape this build does not know | `app/identity-ceremony.ts`, `surfaces/identity-approve.tsx` (D226) |
| Parked-write resolution | built | `surfaces/park-resolve.tsx` (D245/D246) |
| Receipt · failure · captures | receipt and failure built; captures unplaced | `surfaces/receipt.tsx`; the `captures` wire section has no panel placement (`app/use-panel-sections.ts`) |
| Start Run modal | built — four rows, and a typed door for separations | `surfaces/run-start.tsx`, `run-start-kit.tsx` (D250/D251, D261) |
| Spreadsheet intake | built | `surfaces/intake.tsx`, `commands/intake-service.ts` |
| Mobile capture | the page is built; the production byte path is NOT | `phone/**`, `surfaces/capture-start.tsx`; D189 → doc 04 `{#def-byte-path}` |
| Session panel + worker cards | built as a VIEW; no spawn/stop control | `surfaces/shell.tsx:914`; `createDashboardWorkerSupervisor` refuses by name (`server/dashboard/compose.ts:322`) — the pool is `{#parallel-runs}` |
| Settings + doctor/storage | built READ-ONLY | `surfaces/settings.tsx:9` — editable settings are the deferred `apply-settings` family, doc 04 `{#def-settings}` |
| Archive + version bump | built — frozen sections, five tabs, Export | `surfaces/archive.tsx`, `queries/archive.ts` (D223) |
| Explorer | built read-only | `surfaces/explorer.tsx`, `queries/explorer.ts` (D227–D229); the EDIT half is doc 04 `{#def-explorer-edit}` (D186) |
| Activity | built, with the served CSV export | `surfaces/activity.tsx`, `queries/activity-export.ts` (D236/D239/D240) |
| Group People | the tab exists; the body says it is not served | `log-panel.tsx:1965` renders `UnservedTab`; unreachable today because nothing advertises the section |
| OCR Review | the tab exists; the body says it is not served | same; the projection lands with 03c `{#order-3-dash}` |

**The one place the prose was contradicted.** The skeleton carried 07 §7.1's approved target verbatim
— *"panel-kind tabs: run/member `Logs · Receipt`, review `Review · Logs · Receipt`, group
`People · Logs · Receipt`; Data is in the permanent Context rail and captures are inside
Receipt/Review"*. The shell is as described and the compatibility rule is enforced at the wire
(`sectionsCompatible`, `domain/dashboard/run-detail.ts:309`), but two details are not what the
sentence implies, and both matter to whoever wires the next workflow:

- **The tab set is SERVED, never fixed per kind.** `tabsFor` filters one declared order
  (`review · people · logs · receipt`) by the run's own `availableSections`
  (`surfaces/log-panel-model.ts:28`). A panel kind constrains which sections are LEGAL; it does not
  supply them.
- **Review, People and captures have no producer today.** `availableSections`'s return type
  excludes all three, so the Review and People tabs cannot appear and `UnservedTab` is unreachable
  — an honest, typed deferral rather than a hole, but the surfaces are NOT built, and the sentence
  reads as though they were. Captures likewise: the section is served by the BFF and placed by no
  panel, and `context-evidence` is deliberately withheld from the rail (evidence QUALIFIES an
  outcome rather than feeding the live stream) pending its re-home into Receipt.

### Track B · dashboard completion
<!-- roadmap: track-b -->

<!-- roadmap-status: track-b -->
- [x] B1 the three identity-approval ceremonies and rejection, against the SERVER's `approvalShape`; an unknown shape refuses by name (D226) — `src/dashboard/app/identity-ceremony.ts`
- [x] B2 a settled gate's decision on the panel, and a rehearsal that can never wear `verified-done` (D237/D238) — the forbidden pair is unrepresentable in `RunDetailWire`
- [x] B3 the run modal's four rows — three already in the bundle, the fourth drawn as a read-only fact (D250/D251)
- [x] B4 queue rows — `QueueBaseFields` served and drawn, rename, the bulk strip and result vector, runs vs archived runs (D230–D235)
- [x] B5 archive — frozen sections, five tabs, Export, ledger read-through (D223)
- [x] B6 explorer — the field census, the declared `when` in words, the descriptor's own prose (D227–D229)
- [x] B7 worker cards and the session footer; the rail names step, direction and bound; a CAS `conflict` is a refusal, not a success (D252/D253)
- [x] B8 the findings ledger swept to zero-or-decided; `span.patched` RETIRED; a span close binds to an OPEN entry (D254/D255)
> 2026-08-20 | docs-cohesion 03a | all eight verified present in src/dashboard and src/server/dashboard; the findings README records five open records across two files and zero undecided ones
<!-- /roadmap-status -->

Track B is the "frontend done" definition, and separations was the forcing function: each item is a
surface a migration would otherwise have had to build for itself. Two of its eight are worth reading
as rules rather than as features.

**A ceremony is the SERVER's choice, and an unknown one refuses.** `approvalShape` is computed
server-side precisely so a frontend cannot quietly turn every gate into one click, which is
`ref write-safety` §14.6's rubber-stamping risk manufactured by accident. Adding an arm to
`IdentityApprovalShapeSchema` without adding its control here is a compile error, and a shape this
build cannot describe draws a named refusal instead of an Approve button.

**Two of the eight are honesty corrections, not additions.** D237's `resolved` gate arm was keyed on
a `resolutionKey` the command service never emits, so every settled gated run's panel reported the
gate ABSENT while `resolvedBy` sat in authority; D238's `done → verified-done` mapping was
mechanical, so a dry run that wrote nothing wore the label reserved for an independently verified
real completion. Both now read the derivation that already existed rather than deriving a second
opinion beside it.

**The ledger is the completion test.** B8's sweep is what makes "done" checkable:
`docs/findings/README.md` now carries a dated disposition on every record — landed, closed by a
named decision, won't-fix with its argument, or open against a named producer-trigger — and five
open records remain, each blocked on a commit somebody will write rather than on a question somebody
must answer.

### Track C · connection proof
<!-- roadmap: track-c -->

<!-- roadmap-status: track-c -->
- [x] one pass end to end — plan, start, gate park, approve through the B1 ceremony, resume, preview terminal (`docs/migrations/separations.md` §9.22, items 1–8)
- [x] every UI assertion paired against a direct authority read or the served wire — thirteen paired rows, all MET
- [x] zero writes proved from authority, not from logs — `write_intents` 2 / `write_attempts` 3 / `durable_outbox` 2, byte-for-byte the 2026-08-04 controlled commit's counts
- [x] the five defects the pass found, all fixed the same day — the ticking served clock (D256), the panel that follows its run (D257), the always-on shape hazard, the `replayed` timeline arm (D259), the archive unblocked (D258)
- [x] D261 the start door — `resolve-action` derives the action id from a typed document number; live run `sp-105225-1e0b`, 13 checkpoints, gate open, zero writes
- [x] the ONE deliberate parity re-freeze — 139 references re-frozen, every drift attributed to a wave-2 decision, 151 assert-mode cases green (`81287bb1`)
> 2026-08-20 | docs-cohesion 03a | verified against separations §9.22 and §9.24 and against the re-freeze commit; the commit's own message is the source for 139 references and 151 assert-mode cases
<!-- /roadmap-status -->

Wave 2's dashboard work had been proved by unit, architecture and scenario gates and by nothing that
connected the two halves. Track C is that connection, and it is the reason this phase can claim more
than "the tests pass".

**What the pass was.** A fresh BFF and vite booted from the working tree — deliberately, because a
stale singleton serving a superseded descriptor fingerprint is a failure mode this program has hit
before and `GET /api/v1/explorer` answers it in one request. A composed `separations` DRY run planned
and started through the real ingress; the identity gate approved through the dashboard's own
ceremony; every surface claim paired with an independent read of `sqlite3 .tracker-rebuild/state.db`
or of the wire the BFF actually served. Three runs, item `c9837287`, attempts 7 · 8 · 9, the third
reaching the preview terminal in 8 m 20 s including six minutes parked.

**What it found is the argument for doing it.** Four defects, none visible to any gate, all fixed
the same day. A REPLAYED node was indistinguishable from a node that never ran on every surface that
folds spans, so a finished run's pipeline reported eight steps `pending` — including the identity
category whose gate the operator had personally approved a minute earlier. Every live elapsed on the
screen was frozen at page load, because `boot.serverClock.now` is the instant one bootstrap fetch
happened at. The `wf <hash>` shape hazard compared a run's one-workflow fingerprint against the
bootstrap's whole-SET hash — two kinds of value that can never be equal, so the warning was
structurally always on. And the open run-detail panel never followed its run, because `detailNonce`
moved only on a dispatched command.

**Then the door.** §9.22's one connection gap was that `separations` had no start surface at all —
it sat in the modal's "not startable" list. D260 ruled correctly that a typed-text start surface
carries exactly ONE varying value per run; the operator chose the document number; D261 made the
action id a graph OUTPUT read off the Action-List row's `href`, and the whole thing was live-proved
the same day off one typed `4502`.

**The re-freeze closes it.** One deliberate `PARITY_UPDATE=1` pass after the fixes landed, so the
corpus photographs the corrected surfaces rather than the defective ones, with every content drift
attributed to a ratified wave-2 decision before the operator approved it.

### Track D · dashboard hardening, pre-cutover budgets
<!-- roadmap: track-d -->

<!-- roadmap-status: track-d -->
- [ ] D1 one status/outcome derivation — exported `deriveRunStatus`, ONE `TASK_OUTCOME` vocabulary, ONE `panelKindOf`; the detail panel stops disagreeing with the queue row
- [ ] D2 the hygiene commit — dead hooks and exports deleted, a typed not-found error instead of message-sniffing, the inert phone-host gate wired or deleted with its D189 note, `testSystemsOf`/`plural`/`shortHash` unified, the D253 sentence corrected
- [ ] D3 every command settlement folds through `settleCommandResult` — 7 of 9 sites still enumerate both refusal arms by hand
- [ ] D4 patch-splice without re-parsing the whole day, `memo` on `QueuePanel`/`TopBar`/`LogPanel`, `viewState` and `nav` memoized; then MEASURED against a seeded 1,240-row / 108-member fixture
- [ ] D5 bound the read scans — the member preview slices ids before joining, one receipt read per row, the notes reader scoped by workflow and day range, the archive freeze reads the corpus once; measured and recorded
- [?] D6 `useResource` in `state/` over `async-resource.ts` — the nine hand-copied fetch effects migrate
- [?] D7 split `LoadedApp` along its own seams — the three hooks into `app/*-model.ts`, the five takeover layouts into `app/takeovers.tsx`
- [?] D8 models for intake / archive / log-panel, the versioning half of `archive.tsx` split out, ONE `foldTaskExecutions(row)`
- [?] D9 a virtualized list primitive in `ds/`, adopted by queue / logs / archive, then re-measured
- [?] D10 one CAS transport — `expectedVersion` in the body everywhere, the `intake.prepare` double-parse dropped
- [ ] D11 the descriptor registry LEAVES the bundle — bootstrap serves the three start-surface fields the modal reads and `dashboard-app.tsx` drops its `WORKFLOW_DESCRIPTORS` import (amends D251)
> 2026-08-20 | docs-cohesion 03a | every row re-verified unlanded at HEAD against src/server/dashboard and src/dashboard; D6–D10 stay proposed behind the named trigger, which has not fired
<!-- /roadmap-status -->

**Ratified 2026-08-20 as D264**, out of the same-day architecture audit
(`docs/plans/2026-08-20-dashboard-architecture-audit.md`), whose one-paragraph verdict is that the
stack and the shape are right and nothing is swapped: in-process Hono BFF, server-side projections
over SQLite authority plus JSONL spans, REST snapshots with ONE resumable SSE stream and ONE command
route, zod wire schemas as the single source of truth, React 19 + Vite + Tailwind v4. Four
independent read-only mappers found zero layer violations. What is not optimal is one level down,
and every item is a targeted move rather than a rewrite.

**Why here, and why now.** The audit is timely and not urgent: this was the first moment since
1i-spine that nothing in the dashboard was mid-flight, so a hardening pass cannot collide with a
feature slice. The operator's ruling placed the track under the dashboard defaults, after Track C
(which is done, so the fold-into-Track-C alternative expired) and before the next workflow leans on
the dashboard in anger.

**The eleven rows, and their state at HEAD.** All eleven are unlanded; each was re-verified against
the code for this rewrite rather than carried forward on the audit's say-so.

| Row | What it closes | Verified at HEAD (2026-08-20) |
|---|---|---|
| D1 | detail-panel status diverges from queue status; two task-outcome vocabularies; `panelKindOf` byte-identical twice | no exported `deriveRunStatus`; `TASK_OUTCOME_PIPELINE` (`run-queue-projection.ts:342`) and `TASK_OUTCOME_STEP` (`run-detail.ts:437`) both present; `panelKindOf` at `run-queue-projection.ts:261` AND `run-detail.ts:250` |
| D2 | HTTP status sniffed from an error message; the inert capture phone-host gate; dead hooks and exports; small duplications | `useDashboardDaySnapshot` (`use-dashboard-day.ts:54`) and `useRunSection` (`use-run-detail.ts:158`) have no importers; `deps.capturePhoneHost` is read at `routes/api.ts:142` and supplied nowhere |
| D3 | seven command-issuing sites enumerate both refusal arms by hand | `settleCommandResult` is imported by exactly two surfaces, `top-bar.tsx` and `context-rail.tsx` |
| D4 | whole-day zod re-parse and whole-tree re-render per SSE patch | zero `React.memo` anywhere under `src/dashboard` |
| D5 | member preview, duplicate receipt reads, whole-notes-corpus reads, the archive freeze loop | unchanged in `run-queue-projection.ts` / `run-detail.ts` / `archive.ts` |
| D6–D10 | the maintainability slice | proposed; the trigger has not fired |
| D11 | `WORKFLOW_DESCRIPTORS` in the browser bundle | still imported at `dashboard-app.tsx:25`, used at `:516` |

**D4 and D5 are also the first measurement `ref frontend-backend-integration` §7.4 ever gets.** That
section has always said its thresholds are "recorded from the first Person Lookup vertical slice
rather than invented in planning" — and that slice shipped and nothing measured it. The numbers
D4/D5 record on the local production build against a seeded 1,240-row / 108-member fixture (legacy's
real volume: 2,093 runs over 11 active days, busiest day 1,240, largest operation 108 members) BECOME
the non-regression gates every later workflow is held to. That is why the budgets appear in this
phase's exit criteria and not only in the cutover's.

**D6–D10 carry one named trigger** — they start before the second migration's `Dashboard · wire`
task does, and until then they stay `proposed`. Once D1–D5 land they can be dispatched as
independent worktree units.

**D11 answers the audit's one open question.** `WORKFLOW_DESCRIPTORS` drags 49 modules into the
browser bundle to supply three plain fields. D251 had ruled that the bundle already carries them, so
serving them over bootstrap would be a second source; the operator ruled the other way — the
registry LEAVES the bundle, bootstrap serves `summary`, `enqueue` and `surfaces.inputRun`, and the
frontend drops the import. Bytes are irrelevant locally; the principle is that the frontend renders
finished read models.

## Duo ceremony lease — one login at a time per credential
<!-- roadmap: duo-lease -->

<!-- roadmap-status: duo-lease -->
- [ ] BE `duo_ceremony_leases` in authority, plus the lease token `defineVerifiedLoginRecipe` requires
- [ ] BE bounded waiters and the fresh-profile-once recovery, both failing by name
- [ ] BE the guard — no login path without the lease, with a violating fixture
- [ ] PROOF two workers' cold starts serialize (unit) plus a live two-worker cold start
- [ ] DOCS the decision in `reference/execution-and-sessions.md` and `reference/decisions.md`
> 2026-08-20 | docs-cohesion 03a | nothing named duo_ceremony_leases or a ceremony lease exists anywhere in src/; defineVerifiedLoginRecipe (src/infra/browser/authenticated-application.ts:159) takes system + verify + flow and no lease token
<!-- /roadmap-status -->

**The hazard is present today, which is why this is platform hardening and not a parallel-runs
feature.** D243 root-caused the "browser-profile wedge": Duo's WebAuthn signature counter is per
CREDENTIAL, one credential covers every UCSD system, and Duo Autopilot's copy of it lives in
`chrome.storage.local` — which is per BROWSER PROFILE, while `ref execution-and-sessions` §1
partitions profiles per `(worker, system, instance, configFingerprint)`. So N writers share one
server-side counter and none can see another's copy. The arithmetic fix (`max(stored + 1, nowSec)`)
landed; the SERIALIZATION did not. Two workflows' workers cold-starting together against the one
credential is enough to reach it, and that configuration exists the moment a second workflow gets a
worker — before any pool is built.

**Why the failure must be prevented rather than recovered from.** Once Duo sees one cloned-key
signal it BURNS the profile: D243 recorded a profile that stayed refused across three further logins
presenting counters more than a thousand ahead, and only a freshly created profile recovered. That is
why "delete the directory" was the only remediation anybody ever found, and why the lease has to
stop the first refusal instead of healing after it.

**The design, as ruled (R12).** A durable per-credential lease in authority
(`duo_ceremony_leases`) serializes EVERY Duo ceremony across every worker and every system, from
"navigate to SSO" until the content verifier proves the session — the same content-level proof
`ref execution-and-sessions` §4.1 already requires, because a URL is never the conclusion. TTL is
`timeouts.sessionAcquireMs` plus grace. Waiters are bounded and refuse loud NAMING the holder, so a
stuck ceremony reads as a stuck ceremony rather than as a slow login. D243's counter arithmetic is
unchanged and a warm profile skips the ceremony entirely, so the lease costs nothing on the common
path. On a refused assertion the worker poison-closes, recreates a FRESH profile under the SAME
lease and retries ONCE, then fails naming the profile. `defineVerifiedLoginRecipe` takes a lease
token only the lease store mints, pinned by a guard with a violating fixture — the same shape the
mutation capability uses, for the same reason: a rule that can be satisfied by a caller's claim is
not a rule.

**Done looks like** two cold starts serialized in a unit test, one live two-worker cold start
recorded, a guard that fails any login path reaching SSO without a token, and the decision ratified
in `reference/execution-and-sessions.md` in the commit that builds it. It lands BEFORE the worker
pool, because the pool multiplies the hazard it removes.

## Parallel runs — sessions and the worker pool
<!-- roadmap: parallel-runs -->

<!-- roadmap-status: parallel-runs -->
- [ ] BE the worker pool — N workers per workflow, spawned and stopped from the dashboard
- [ ] BE the projection serves a worker-POOL version — `spawn-worker` and `plan-worker-count` target `{workflowId, expectedVersion}` and `WorkerCardWire.revision` is ONE worker's row, so no honest CAS basis exists for the control today
- [ ] BE a durable session record and its grouping (B4's bulk dispatch is the seed)
- [ ] FE the session view — worker cards show membership and what each worker is doing, read from authority
- [ ] PROOF two separations dry-run scenarios in parallel, recorded
> 2026-08-20 | docs-cohesion 03a | the kernel command arms exist and are validated (src/core/command-kernel.ts:95) while createDashboardWorkerSupervisor refuses spawn by name (src/server/dashboard/compose.ts:322) and the FE has no Add-workers control for the CAS reason quoted in src/dashboard/surfaces/shell.tsx:1036
<!-- /roadmap-status -->

**A session is a dashboard-started group of N runs.** Every workflow follows the same
browser-profile recipe, and every worker owns its own profile INSTANCE — Chromium locks a profile
directory, and `ref execution-and-sessions` §1's `(worker, system, instance, configFingerprint)`
partition is what keeps them apart. N workers per workflow, spawned and stopped from the dashboard;
today the runtime starts one process per workflow, so the pool is the build.

**Coordination is through AUTHORITY only, never peer messaging.** Workers know what the others are
doing through run claims, session leases, write fences and the concurrency matrix
(`ref execution-and-sessions` §7.1). Sessions never share information with each other. This is not a
style preference: a claim is the one statement a process may make about ITSELF that another process
can trust, which is the same argument D200 used when it made a won lease — not a heartbeat age —
the evidence that a stale claim is orphaned.

**What is already true, and what the seam actually needs.** The command arms are real and composed:
`plan-worker-count`, `spawn-worker`, `stop-worker`, `pause-worker`, `resume-worker` all carry
schemas, authority validation, the journal and typed refusals (`src/core/command-kernel.ts:95`). Two
things are missing and only one of them is obvious. The dashboard's `WorkerProcessSupervisor` throws
by name — *"the dashboard process does not launch browser workers; start worker X with
`npm run cli worker <workflowId>`"* — which is a correct refusal rather than a stub, so no
acknowledgement can claim an effect that did not happen. Less obvious: **the projection serves no
POOL version.** `spawn-worker` and `plan-worker-count` target `{workflowId, expectedVersion}`, and
`WorkerCardWire.revision` is one worker's row, not the pool's — so the frontend has no `+ Add
workers` control today, deliberately, because a button that guessed an `expectedVersion` would be
inventing the exact fact the CAS exists to check. The pool version is a prerequisite of the control,
not a detail of it.

**Done looks like** a pool that spawns and stops from the dashboard against a real CAS basis, a
durable session record the worker cards read their membership from, and TWO separations dry-run
scenarios running in parallel and recorded — which is also the end-to-end tier's first exercise and
what `{#test-tiers}` reads as its parallel case. It needs the Duo lease first.

## Observed logs — the log carries what the page said
<!-- roadmap: observed-logs -->

<!-- roadmap-status: observed-logs -->
- [ ] BE provenance points emitted on the span at record time, redacted by declaration — an unclassified leaf fails loud
- [ ] BE a transaction node's beats stream their observations (probe → stage → fence → click → read-back)
- [ ] FE the log panel renders observed rows per step, in the Context rail's vocabulary
- [ ] PROOF a separations dry run reads as a ledger of page facts
> 2026-08-20 | docs-cohesion 03a | recorded points exist in memory at record time and reach no durable channel — finalizeRead validates them and the executor stores only provenance plus the parsed output (src/core/task-provenance.ts:264, src/core/run-executor.ts:1052)
<!-- /roadmap-status -->

**The log should quote what the page said.** Every task already records its observations through
`ctx.recordData` — the D115 collector — as strict `{direction, field, value}` points that the
executor stamps with the run/node/task identity and a Clock instant. Those points are what the run
actually READ or WROTE, in the system's own words, and the operator currently never sees them: they
are used to VALIDATE the output and then discarded. `finalizeRead` returns points AND provenance,
and only `provenance` plus the parsed `output` reach the checkpoint row. The log stream beside them
carries prose messages, which is a description of a step rather than the step's evidence.

**So the build is an emission, not a second scrape.** A point is emitted on the span at record time,
redacted by the DECLARED evidence classification (`reference/operator-trust.md` §2.3) — an
unclassified leaf fails loud, because dropping it silently would make a log look complete while
hiding what the run read. Nothing re-reads the page: a second scrape would be a second observation
of a moving system, and two observations of one fact is exactly how a surface starts disagreeing
with authority.

**A transaction node streams its beats.** `ref write-safety` §5's sequence — probe → stage → fence →
click → read-back — is the one place the operator most needs to watch the page rather than a
spinner, and each beat already has an observation to publish.

**Two constraints the code imposes on the design, both worth stating before anyone builds it.**
`DataPoint` carries `direction` natively (`read` or `write`), which the Context rail has to DERIVE
from the producing node's declared task-contract `effect` because the checkpoint row carries no such
field (D252) — so an observed log is strictly better placed than the rail to say what the run did to
the world, and must not re-derive what it already holds. But `DataPoint` carries **no system**: the
system is declared by the STORE implementing the task and reaches the wire through
`RunDetailDescriptorView.dataOrigins`, composed at the root because a descriptor may not reach a
store (D106). The observed log resolves the system the same way the rail does; inventing a `system`
field on the point would be a second authority over a fact the declaration already owns.

**Scope may widen** when the operator reviews phase 3a — the ruling that created this node
(2026-08-20) also said the log EMISSION path and the log STRUCTURE are rebuilt around recorded
observations rather than around messages, and how far that goes is theirs to settle. Owning specs:
`reference/dashboard-surfaces.md` for the stream and the panel, `reference/operator-trust.md` for
the redaction declaration.

## Integration execution rule

_The rule 07 §7.3 carried, moved here on 2026-08-20 and re-verified against the tree: every Track B
surface landed as a slice with a parity reference, which is what makes the corpus a completeness
check rather than a screenshot folder._

Every surface lands as ONE vertical slice: strict schema → server query/projector → subscription
invalidation/patch → command path (when interactive) → production component → schema fixture →
Playwright a11y/screenshot proof. Building the whole React tree against mocks and wiring it later,
or building backend routes with no production surface consumer, does not satisfy a work item.

The demo remains the visual oracle but never becomes runtime infrastructure. It lives in the legacy
repo (`src/dashboard/components/dev/rebuild-demo/**`) and is unreachable from rebuild production
code by construction (D93); approved design-system and surface code is copy-ported with provenance
into this repo's `src/dashboard/`, while strict schema-valid fixture adapters remain test-only.

## Decisions this phase ratified

Checked against `reference/decisions.md`'s `_phase: 3a_` markers on 2026-08-20. The ratification act
and the normative pointer stay in the ledger; this is the phase index.

| Rounds | Dates | D-range | What they settled |
|---|---|---|---|
| 48 (D195 only) | 2026-08-12 | D195 | the panel region is a grid; the two side panels share one 376px token; nothing-selected is a state |
| 63 (×2) · 64 · 65 | 2026-08-18 | D222–D225 | the backup hazard moves to the inbox (D222), the archived detail is the demo's (D223), the action bar is an island (D224), the timeline is categorical (D225) |
| 67–73 | 2026-08-19 | D227–D236 · D239–D242 | the explorer says what the descriptor says (D227–D229), the queue row says what it is and what it made (D230–D233), runs vs archived runs (D234), a batch answers run by run (D235), the report's second authority, dropped tile and export (D236/D239/D240), short workflow names (D241/D242) |
| 76 | 2026-08-19 | D237–D238 | the two honesty gaps on the run panel — the unreachable `resolved` arm, and `done → verified-done` |
| 78–83 | 2026-08-20 | D248–D259 | the Session Panel stops guessing (D248/D249), the run modal (D250/D251), the Data ledger and the unhandled `conflict` arm (D252/D253), the dead channel and the findings ledger (D254/D255), the dashboard's clock (D256/D257), the projection stops claiming history it cannot see (D258/D259) |
| 87 | 2026-08-20 | D264 | **Track D is ratified** — dashboard hardening before the second migration, and the descriptor registry leaves the bundle |

**Ratified elsewhere, load-bearing here.** Four rounds the ledger assigns to phase 3b are what
Track B and Track C were built on, and nothing about their phase is re-litigated by saying so:
**D226** (round 66) is B1's three ceremonies; **D245/D246** (round 77) are the parked-write surface's
way in and way out; **D260/D261** (rounds 84–85) are the start door Track C's §9.22 could not close
and §9.24 closed; **D262** (round 86) is the gate-park notification producer — the inbox's second
production producer and a dashboard default, which also filled `{#sep-dash}`'s last wire square.

**Platform-wide, not this phase's.** Rounds 46 (D191 the per-commit gate, D192 the advisory tools'
dispositions), 74 (D243/D244 the Duo signCount — the hazard `{#duo-lease}` exists to serialize), 75
(D247 the runtime's own name) and 88 (D263 the plan's machine-readable form) carry `_phase:
platform_` in the ledger. They are listed here only because no phase owns them.

## Exit criteria

07 recorded no exit block for the dashboard-defaults half of phase 3 — it predates Tracks B, C and
D. What binds instead is the checklist below, which is what a later migration's `Dashboard · wire`
task is entitled to assume. Four of eight hold at HEAD.

| # | Criterion | State at HEAD | Evidence / what is left |
|---|---|---|---|
| 1 | **Track B met** — every generic surface built, each as one vertical slice | **MET** | B1–B8 landed 2026-08-19 → 20 (D222–D255); every surface verified present in the table above |
| 2 | **The findings ledger is zero-or-decided** | **MET** | `docs/findings/README.md`, B8 sweep 2026-08-20: five open records across two files, each naming the commit that closes it; zero undecided |
| 3 | **Track C met** — the real dashboard drove a real composed run, every claim paired to authority | **MET** | `docs/migrations/separations.md` §9.22 items 1–8; three runs; five defects found and fixed same-day; §9.24's live `sp-105225-1e0b` |
| 4 | **The reference corpus asserts over the corrected surfaces** | **MET** | `81287bb1` — 139 references re-frozen after the fixes, 151 assert-mode cases green, every drift attributed to a ratified decision |
| 5 | **Track D's D1–D5 landed** — one fact, one derivation; the read scans bounded | **open** | all five re-verified unlanded at HEAD (see the Track D table); D6–D10 stay `proposed` behind their named trigger |
| 6 | **`ref frontend-backend-integration` §7.4's budgets measured and recorded** | **open** | never measured; D4/D5 supply the first numbers against a seeded 1,240-row / 108-member fixture, and those numbers become the non-regression gate |
| 7 | **The Duo ceremony lease landed** | **open** | nothing named `duo_ceremony_leases` exists in `src/`; `defineVerifiedLoginRecipe` takes no lease token |
| 8 | **Parallel runs proved** — the pool, the durable session record, two separations dry runs in parallel | **open** | the kernel arms exist; the supervisor refuses spawn by name and the projection serves no pool version |
| 9 | **Observed logs landed** — the log quotes the recorded observations | **open** | recorded points reach no durable channel today |

**Deliberately outside this phase, each with an owner.** The Review and People panel bodies (their
projections belong to the OCR and group migrations in doc 03c); editable settings, the explorer's
EDIT half, the production byte path for the phone page, and search / screenshots / export (doc 04's
`{#def-settings}`, `{#def-explorer-edit}`, `{#def-byte-path}`, `{#def-search-export}`). None is a
waiver: each names its trigger where its node lives.

**Above this phase.** The program-wide surface criteria in `05-cut-over.md` §Exit criteria — in
particular `ref frontend-backend-integration` §10's eleven items — must all pass before the cutover.
Criterion 6 above is the one this phase supplies to that list: §10 item 9's reference route matrix
and §7.4's thresholds are the same gate seen from two sides.
