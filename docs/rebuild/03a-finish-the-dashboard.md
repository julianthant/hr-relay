# 03a · Phase 3a — finish the dashboard

Phase 3 migrates the legacy workflows one at a time, and nothing could be wired into a dashboard
that did not exist yet. **Phase 3a is that dashboard**: the generic surfaces EVERY workflow
inherits, built once, plus the hardening the first real connection to a running workflow exposed.
Phase 3 is four docs — **3a** is this one (tree node `{#dash-defaults}` and everything under it),
**3b** finishes separations (`03b-finish-separations.md`, which also carries phase 3's own node
`{#phase-3}`), **3c** migrates the remaining workflows
(`03c-migrate-the-remaining-workflows.md`), and **3d** puts Claude on the same dashboard as a second
actor (`03d-co-operate-with-claude.md`, `{#claude-operator}`). Contracts this phase built or amended live in
`reference/`; this doc holds the work, its state, and its exit.

## Phase summary
<!-- roadmap: dash-defaults -->

<!-- roadmap-status: dash-defaults -->
- [x] every surface the wiring matrix names is served and drawn — top bar, workflow panel, queue rows, run detail + timeline, Context rail, gate ceremony, parked write, receipt/failure, run modal, archive, activity, explorer, settings + storage doctor, intake, the phone capture page, session panel (Track B, D222–D259)
- [x] the notification inbox has production producers — backup health (D222) and the gate park (D262), both wired in `src/server/dashboard/compose.ts`
- [x] the connection is proved end to end: the REAL dashboard drove a REAL composed separations dry run, every UI claim paired against authority (Track C, `docs/migrations/separations.md` §9.22)
- [x] the reference corpus asserts green over the corrected surfaces — 139 references re-frozen, 151 assert-mode cases green (`81287bb1`)
- [ ] Track D's D1–D5 — D1 LANDED as **D268** (`81bfed73`), D2 the hygiene commit and D3 the settlement fold LANDED (`f39b2e95`…`6d44bb1e`, `1b13115f`), D5 the bounded read scans LANDED (`d6d6c758`/`c1fa129b`/`c74efcca`/`c547f65a`); patch-splice + `memo` and the bounded read scans are still unlanded (ratified D264)
- [ ] the three nodes drawn under this one on 2026-08-20 — the Duo ceremony lease, the worker pool and sessions, observed logs
- [ ] `ref frontend-backend-integration` §7.4's performance budgets — the instrument and its BEFORE baseline landed 2026-08-21 and **D5's AFTER numbers are recorded**; D4 still owes its half, and the recorded numbers become the non-regression gates
- [ ] the run-detail panel's **Review** and **People** bodies — `availableSections` cannot return either section, so both tabs are structurally unreachable; the projections behind them land with the OCR and group migrations in 03c, not here
- [!] demo fidelity — every region exact or ruled; ~150 OPEN questions outstanding across the three 2026-08-21 ledgers (Track F, §Demo fidelity — every detail, region by region)
> 2026-08-20 | docs-cohesion 03a | verified against src/dashboard/** and src/server/dashboard/**; every Track D finding still reproduces at HEAD (no exported deriveRunStatus, two TASK_OUTCOME vocabularies, two panelKindOf copies, zero React.memo, WORKFLOW_DESCRIPTORS imported at dashboard-app.tsx:25); left: D1–D5, the lease, the pool, observed logs, the §7.4 numbers
> 2026-08-21 | docs-cohesion 03a fidelity fold | the demo-fidelity re-audit (1,956 elements/rows, 756 exact) is folded in as Track F; Track B's "frontend done" stands as the findings-ledger bar it was defined by, and demo fidelity is the stricter bar above it; left: the operator's ~150 rulings, then the FE / BE / PROOF lines Track F carries
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
5. Track D's D1–D5 and D11 have landed, so one fact has one derivation, the read scans are
   bounded, and the descriptor registry has left the browser bundle (D264 ratified D11 as planned;
   D6–D10 stay `proposed` and are outside this gate).
6. `ref frontend-backend-integration` §7.4's budgets carry MEASURED numbers, which then become the
   non-regression gate every later workflow is held to.
7. The Duo ceremony lease exists, so a second workflow's worker cold-starting beside the first
   cannot burn the shared credential's counter.
8. Every region of the dashboard is demo-exact or ruled — Track F's bar, above Track B's: Track B's
   definition of done was the findings ledger; demo fidelity is the stricter bar, and ~150 OPEN
   questions stand against it at HEAD (§Demo fidelity — every detail, region by region).

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
| Receipt · failure · captures | receipt and failure built; captures schema'd and declared-unserved | `surfaces/receipt.tsx`; `config/pending-wire-bindings.json` lists `RunDetailSectionResponseSchema#captures` as `declared-unserved` (D184) — nothing serves it until the artifact-bytes route lands |
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

**Demo fidelity per surface family, from the 2026-08-21 re-audit** (exact / elements, OPEN — the
three ledgers' own counts; the per-region table and every question are in §Demo fidelity below):
shell 131/178 (74 %), 10 OPEN · queue 118/196, 13 · run start 48/115 (42 %), 14 · run identity
23/49, 7 questions · log panel 48/114, 11 · Context rail 31/76, 9 · receipt 9/39, 12 · failure
record 7/34, 13 · park + ceremonies 6/36, 2 · archive 96/250, 71 marks · activity 57/117, 8 ·
explorer 54/182, 31 · UI catalog 0/69 (not the same surface as the demo's), 6 · Settings + doctor
2/72, 10 questions · intake 10/155, 57 marks · phone capture 1/62 (the demo's DESKTOP view has no
counterpart), 6 · version-bump dialog 2/53, ~20 questions · DS primitives 119/159 (copied with
provenance; zero tokens missing), 18. "Built" in the table above and "exact" here are different
claims: every row above is served and drawn; 756 of 1,956 elements are drawn exactly as the demo
draws them.

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
  reads as though they were. Captures likewise: the section is schema'd and declared-unserved
  (D184) — `config/pending-wire-bindings.json` lists `RunDetailSectionResponseSchema#captures` as
  `declared-unserved` and `availableSections` cannot return it, so nothing serves it until the
  artifact-bytes route lands — and `context-evidence` is deliberately withheld from the rail
  (evidence QUALIFIES an outcome rather than feeding the live stream) pending its re-home into
  Receipt.

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
- [x] the four defects the pass found (§9.22 item 3) plus the archive unblock (§9.22 item 6), all fixed the same day — the ticking served clock (D256), the panel that follows its run (D257), the always-on shape hazard, the `replayed` timeline arm (D259), the archive unblocked (D258)
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

**What it found is the argument for doing it.** Four defects (§9.22 item 3) plus the archive
unblock (§9.22 item 6, D258), none visible to any gate, all fixed the same day. A REPLAYED node
was indistinguishable from a node that never ran on every surface that folds spans, so a finished run's pipeline reported eight steps `pending` — including the identity
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
- [x] D1 one status/outcome derivation — `deriveRunStatus`, `taskStateOf` and `panelKindOf` are one implementation each in `src/server/dashboard/run-status.ts`, read by the queue projector AND the run-detail query; the detail panel can no longer disagree with the queue row (**D268**, `81bfed73`)
- [x] D2 the hygiene commit — the HTTP status is the error's KIND (`src/server/failures.ts` + `routes/failure-status.ts`, `f39b2e95`), the phone-host gate is WIRED from `capture.ingress: "forwarded"` with a producer guard (`47eeb44e`), the two dead hooks and ten dead exports are gone (`69102aaf`), and `testInstanceSystems`/`pluralize`/`shortHash` are one each (`6d44bb1e`); the D253-sentence half landed with D3 (`1b13115f`)
- [x] D3 every command settlement folds through `settleCommandResult` — all NINE command-issuing surfaces fold (`1b13115f`); the guard's second arm requires any module calling `.executeCommand(` to import it (`5c36a82d`)
- [x] D4 patch-splice without re-parsing the whole day, `memo` on `QueuePanel`/`TopBar`/`LogPanel`, `viewState` and `nav` memoized; MEASURED against the seeded 1,240-row / 108-member fixture — one SSE row patch `22.30 → 0.02 ms` and `dayWireSchemaParses 1 → 0`, with the four untouched rows held as the control (`345475bf` splice + tests, `bb406615` `memo` + stable props + the `dashboard-memo-prop-stability` guard); recorded in ref frontend-backend-integration §7.4
- [x] D5 bound the read scans — the member preview slices ids before joining and a row reads its receipt once (`d6d6c758`), the notes reader opens only its run's own `(workflow, date)` partitions (`c1fa129b`; the margin corrected to zero-below / one-day-above in `c547f65a`), the archive freeze scans once per page walk (`c74efcca`), all four pinned by their BOUND rather than a duration (`4d3247d8`) and MEASURED — day wire 6,718 → 5,568 SQLite statements, member-preview delta 216 → 6, logs scope 4 → 2 partitions (`ref frontend-backend-integration` §7.4's AFTER table)
- [?] D6 `useResource` in `state/` over `async-resource.ts` — the nine hand-copied fetch effects migrate
- [?] D7 split `LoadedApp` along its own seams — the three hooks into `app/*-model.ts`, the five takeover layouts into `app/takeovers.tsx`
- [?] D8 models for intake / archive / log-panel, the versioning half of `archive.tsx` split out, ONE `foldTaskExecutions(row)`
- [?] D9 a virtualized list primitive in `ds/`, adopted by queue / logs / archive, then re-measured
- [?] D10 one CAS transport — `expectedVersion` in the body everywhere, the `intake.prepare` double-parse dropped
- [x] D11 the descriptor registry LEAVES the bundle — bootstrap serves the three start-surface fields the modal reads on `WorkflowStartWireSchema`, `dashboard-app.tsx` drops its `WORKFLOW_DESCRIPTORS` import, and `dashboard-wire-boundary` arm (15) holds the closure (amends D251; `149bc5f8`, `0911becd`; bundle 1,114,214 → 753,197 bytes)
> 2026-08-20 | docs-cohesion 03a | every row re-verified unlanded at HEAD against src/server/dashboard and src/dashboard; D6–D10 stay proposed behind the named trigger, which has not fired
> 2026-08-21 | track-d D11 | D11 LANDED (`149bc5f8` the wire block + server projection + a test driving `buildBootstrap` over the whole registry, `0911becd` the frontend drop + `dashboard-wire-boundary` arm 15, proved to bite). `ref frontend-backend-integration` §4's one named divergence is closed and its §7.4 exit-criterion 2 is MET. Bundle 1,114,214 → 753,197 bytes; `run-start.tsx` needed no edit — the composed `RunStartWorkflow` is identical field for field. Left in this track: D2–D5
> 2026-08-21 | track-d D1 | D1 LANDED as **D268** (`81bfed73`) — one `deriveRunStatus`, one task-outcome vocabulary (`cancelled` wins on D123's rule; `PipelineStepWireSchema.state` gains the arm), one `panelKindOf`, in a sibling module because the archive read path may not reach the projector's registry import; left: D2–D5 and D11
> 2026-08-21 | track-d D2 | D2 LANDED — four commits by category. The status mapper stopped reading its own error MESSAGES (`f39b2e95`): three declared kinds, every reachable producer converted, and a test that a plain `Error` wearing each retired phrase is a 500 rather than the 404 the substring table gave it. The phone-host gate is WIRED rather than deleted (`47eeb44e`) — `capture.ingress: "forwarded"` is a mode an operator can set today, so the scope check now has a producer instead of waiting for the byte-path slice that would open the door in the same commit; the guard gains §2b so it cannot lose that producer in silence. `GET /api/v1/dashboard` was KEPT against the audit's reading: two tests drive it, one of them the only proof a really-composed BFF serves a day. `INTAKE_UPLOAD_MEDIA_TYPES` was kept exported for its named open wire task. One operator-visible change: the receipt's TEST banner no longer uppercases its system names
> 2026-08-21 | track-d3 | D3 LANDED (`1b13115f`, guard `5c36a82d`) — the seven hand-enumerating sites now read `settleCommandResult`, which gained the server's own per-arm facts beside the composed sentence so a surface drawing a refusal in its own components need not re-take the union apart; ZERO operator text moved, deliberately, because the parity corpus photographs identity-approve's conflict alert
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

**The instrument exists, and the BEFORE numbers are recorded (2026-08-21).** D4 and D5 owe MEASURED
numbers, and a measurement needs an instrument that predates the fix — otherwise the first number is
taken by the change it is supposed to judge. `npm run perf:dashboard` (`tests/perf/`) seeds the
1,240-row / 108-member fixture this track has always named — real authority, real writers, real
projection, deterministic — and times the five audit paths in-process through the production
functions the BFF calls. The baseline table, taken at `407d373f` before any Track D row landed, is
in `ref frontend-backend-integration` §7.4 with the exact command and the machine it ran on; three
of its counts (216 statements for a 108-member preview, 5.42 per row for the day wire, one whole-day
parse per single-row patch) confirm what the audit predicted from reading. D4 and D5 re-run that
command against the same seed and record the delta beneath it. The instrument touches nothing under
`src/` — it measures the tree, it does not fix it.

**D5's AFTER numbers are recorded (2026-08-21, `c547f65a`).** Same command, same seed, same eleven
iterations, in §7.4's AFTER table: the day wire drops **6,718 → 5,568** SQLite statements (5.42 →
4.49 per row, decomposing exactly into 940 saved receipt reads and 210 saved preview joins), the
member-preview delta drops **216 → 6** and stops scaling with the member count at all, and a logs
GET may now open **2 of the corpus's 4 partitions** instead of all of them. Two honest readings
travel with the table. The logs row moves only 15 % in LINES because 78 % of this fixture's corpus
sits on the measured run's own day — what changed is that the read stopped growing with the corpus,
which is the bound audit P3 is actually about. And the archive freeze's own fix does not appear at
all, because at 13 notes per run the freeze walks one page; its bound is pinned in the unit lane
instead. D4 still owes its half.

**The eleven rows, and their state at HEAD.** D1 landed 2026-08-21 (**D268**); the other ten are
unlanded. Each was re-verified against the code for the 2026-08-20 rewrite rather than carried
forward on the audit's say-so.

| Row | What it closes | Verified at HEAD (2026-08-20) |
|---|---|---|
| D1 | detail-panel status diverges from queue status; two task-outcome vocabularies; `panelKindOf` byte-identical twice | **LANDED 2026-08-21 as D268** (`81bfed73`) — `src/server/dashboard/run-status.ts` exports `deriveRunStatus` / `taskStateOf` / `panelKindOf`; both vocabularies are one and `cancelled` is the word (D123); pinned by `tests/unit/server/run-status-derivation.test.ts` |
| D2 | HTTP status sniffed from an error message; the inert capture phone-host gate; dead hooks and exports; small duplications | ~~`useDashboardDaySnapshot` and `useRunSection` have no importers; `deps.capturePhoneHost` is read at `routes/api.ts:142` and supplied nowhere~~ **CLOSED 2026-08-21** (`f39b2e95`, `47eeb44e`, `69102aaf`, `6d44bb1e`) — three declared refusal kinds in `src/server/failures.ts` map to status by `instanceof`; the gate is wired from `capture.ingress: "forwarded"` and `capture-durability-and-scope` §2b refuses a composition root that stops supplying it; the dead pair is deleted and ten exports un-exported; the TEST-instance hazard, `plural` and `shortHash` are one each |
| D3 | seven command-issuing sites enumerate both refusal arms by hand | ~~`settleCommandResult` is imported by exactly two surfaces, `top-bar.tsx` and `context-rail.tsx`~~ **CLOSED 2026-08-21 (`1b13115f`)** — all nine import it; the guard now refuses a module that posts through `executeCommand` without it |
| D4 | whole-day zod re-parse and whole-tree re-render per SSE patch | ~~zero `React.memo` anywhere under `src/dashboard`~~ **CLOSED 2026-08-21** (`345475bf`, `bb406615`) — `applyDashboardDayPatch` splices (one patch: `22.30 → 0.02 ms`, `dayWireSchemaParses 1 → 0`, ref frontend-backend-integration §7.4's D4 AFTER table); the three hot panels are `memo`'d with every prop stabilized at the parent, held by `dashboard-memo-prop-stability`. The D256 live clock is a prop of all three and ticks 1 Hz, so `memo` buys the re-renders BETWEEN ticks and the browser render count is left to D9 |
| D5 | member preview, duplicate receipt reads, whole-notes-corpus reads, the archive freeze loop | ~~unchanged in `run-queue-projection.ts` / `run-detail.ts` / `archive.ts`~~ **CLOSED 2026-08-21** (`d6d6c758`, `c1fa129b`, `c74efcca`, `c547f65a`) — all four bounded, behaviour byte-identical over the §7.4 fixture, measured and recorded |
| D6–D10 | the maintainability slice | proposed; the trigger has not fired |
| D11 | `WORKFLOW_DESCRIPTORS` in the browser bundle | ~~still imported at `dashboard-app.tsx:25`, used at `:516`~~ **CLOSED 2026-08-21 (`149bc5f8`, `0911becd`)** — the three fields ride `WorkflowStartWireSchema`, the import is gone, and `dashboard-wire-boundary` arm (15) refuses any dashboard entry whose closure reaches `src/workflows/**` or `src/control/**`; bundle 1,114,214 → 753,197 bytes |

**D4 and D5 are also the first measurement `ref frontend-backend-integration` §7.4 ever gets.** That
section's budgets have never carried a measured number — it says so itself ("Not one of these is
measured or asserted anywhere in this repository"), and the Person Lookup vertical slice shipped
without recording one. The numbers D4/D5 record on the local production build against a seeded
1,240-row / 108-member fixture (legacy's real volume: 2,093 runs over 11 active days, busiest day 1,240, largest operation 108 members) BECOME
the non-regression gates every later workflow is held to. That is why the budgets appear in this
phase's exit criteria and not only in the cutover's.

**D6–D10 carry one named trigger** — they start before the second migration's `Dashboard · wire`
task does, and until then they stay `proposed`. Once D1–D5 land they can be dispatched as
independent worktree units.

**D11 answered the audit's one open question, and LANDED 2026-08-21.** `WORKFLOW_DESCRIPTORS`
dragged 49 modules into the browser bundle to supply three plain fields. D251 had ruled that the
bundle already carries them, so serving them over bootstrap would be a second source; the operator
ruled the other way — the registry LEAVES the bundle, bootstrap serves `summary`, `enqueue` and
`surfaces.inputRun`, and the frontend drops the import. Bytes were called irrelevant locally and the
principle — the frontend renders finished read models — was the whole argument; the bytes turned out
to be the larger half anyway. **Measured at the change: 1,114,214 → 753,197, a 32 % production
bundle.** The as-built lives in `ref frontend-backend-integration` §4.

Two things the build is worth remembering for. **The rule is held by a CLOSURE arm, not a lint on
import lines** (`dashboard-wire-boundary` (15)): one shared helper re-exporting a descriptor would
put the whole tuple back with nothing in the diff that reads like a registry import, and the arm was
proved to bite by re-adding the deleted import. And **serving a fact does not change where its bytes
came from**: the redaction audit demanded an origin for seven new free-text leaves — the summary,
the placeholder, the delimiters, D250's worked examples — and every one is a descriptor constant a
developer typed into this repository, so every one is `repository-authored`. A guard asking that
question at the moment a field crosses onto a wire is the guard working.

## Demo fidelity — every detail, region by region
<!-- roadmap: track-f -->

<!-- roadmap-status: track-f -->
- [!] the operator rules the 37 shell · queue · run-start OPEN questions — ledger 1, `docs/plans/2026-08-21-03a-fidelity-1-shell-queue-start.md` §Roll-up (28 numbered questions over 37 rows)
- [!] the operator rules the 54 run-detail OPEN questions — ledger 2, `docs/plans/2026-08-21-03a-fidelity-2-run-detail.md` §Roll-up (8 served-and-dropped · 7 structural · 24 words-and-glyphs · 8 rebuild-only · 2 stale claims, plus the B45 tension)
- [!] the operator rules the ~60 standing-surface OPEN questions, the twelve structural ones first — ledger 3, `docs/plans/2026-08-21-03a-fidelity-3-standing-surfaces.md` §Roll-up (260 marks collapsing to ~60 questions)
- [ ] the remaining served-and-dropped facts drawn — intake's 9 are complete (IN8/IN9/IN53/IN82/IN106/IN121/IN126/IN127/IN131; F2 a–c), leaving 8 run-detail plus the archive, bump, activity, explorer and shell facts (§Served-and-dropped below)
- [ ] the structural run-detail ports — the failure record's disclosure and write-state block, the focusable timeline segment, the step group's Well + band + dividers, one owner for `dataExpanded`, the grouped log stream
- [x] the stale claims in code and docs corrected (§Stale and false claims below) — `5cb9a307`, `33e140f9`, `06041db1`, `5b13ec0e`, `155b1048`
- [ ] the vocabulary sweep — every word and glyph off the demo across the three ledgers reverted, or recorded with its ruling
- [ ] the parity corpus re-frozen ONCE over every change, with the three scenes it has never photographed — Settings, the version-bump dialog, a DS specimen page
- [ ] wire: a diagnostic bundle is READABLE — `capturedAt`, size, the contents index, the redaction list and the route the `BundleDialog` opens (ledger 2 E29; D137 writes all of it durably)
- [ ] wire: the receipt's action entry carries what proved the write — target, system, the written values, the confirmation number and the read-back verdict beside the write it proves (ledger 2 D16–D22)
- [ ] wire: the intake MANIFEST stage and the rerun diff — plan id, source sha, artifact id, the three fingerprints, the totals line, the per-source-row disposition table, the added/removed item lists (ledger 3 IN15/IN16, IN123–IN143)
- [ ] wire: the OPERATOR half of phone capture — session state, pages received, the unreadable-page alert, the contact sheet (ledger 3 CP2–CP21)
> 2026-08-21 | docs-cohesion 03a fidelity fold | folded from the three 2026-08-21 ledgers — 1,956 elements/rows audited (489 + 348 + 1,119), 756 exact, ~150 distinct OPEN questions (37 + 54 + ~60; 260 marks in ledger 3); nothing is ticked because nothing here is a ruling yet; left: every line above, in the order the operator rules them
> 2026-08-21 | track-f | the 14 rows in §Stale and false claims resolved — 12 record fixes (comments/docs, no behaviour change) plus 2 book-a-gap rows (`intake.md`/`capture.md` created, `explorer.md` reopened with 3 real gaps, `queue-rows.md` corrected); one light-code exception permitted by the unit's brief was not needed — every row resolved as a docs/comments fix. Commits: `5cb9a307` (5 surface header comments), `33e140f9` (DESIGN.md), `06041db1` (queue-rows.md), `5b13ec0e` (intake.md + capture.md + explorer.md + README.md), `155b1048` (operator-trust.md, dashboard-surfaces.md x2, data-intake-and-edit-data.md)
<!-- /roadmap-status -->

**The standard, in the operator's words.** *"Finish the dashboard, dive deeper, looking back at the
demo and making sure it got every single detail down and every single feature exactly copied. The
only reason it may dismiss anything or modify is after discussion with me or that we are dropping or
modifying a feature."* The dashboard is a **1:1 detail replica** of the legacy rebuild-demo
(`hr-automation/src/dashboard/components/dev/rebuild-demo/`), reviewed glyph by glyph. Two earlier
"it matches the demo" claims were rejected on sight, so a claim is worth nothing here and only an
enumeration is: every element is **exact**, or a divergence **ruled** by a D-number / a plan decision /
a dated operator call, or **unserved** by a NAMED missing producer (which is a `builds:` line, never a
reason to drop the detail), or **OPEN** — the tree diverges and nothing in the repository says why.
Track B's definition of "frontend done" was the findings ledger; **Track F is this stricter bar**, and
it is `status: you` because an OPEN question is the operator's to answer, not this phase's to dismiss.

### The three ledgers, region by region

Audited 2026-08-21 at HEAD, demo source against rebuild source plus the parity references read as
images. "Cited" is the ledger's own `ruled:` + `unserved:` count where it split them, and
`elements − exact − OPEN` where it did not; OPEN is counted in the ledger's own unit (rows in ledger
1, rows-and-questions in ledger 2, marks in ledger 3 — a single decision drags many rows behind it).

| Region | Elements | Exact | Ruled | Unserved | OPEN | Ledger · region |
|---|---:|---:|---:|---:|---:|---|
| Shell — top bar, search, date nav, bell, workflow panel, status band, session footer, keys | 178 | 131 | 34 | 3 | 10 | ledger 1 §Region A |
| Queue — bands, row card, member well, redirects/facts, drill-in, action bar, bulk, action vocabulary | 196 | 118 | 40 | 25 | 13 | ledger 1 §Region B |
| Run start — picker, input, shape, plan, result, aside, footer | 115 | 48 | 39 | 15 | 13 | ledger 1 §Region C |
| Run identity — provenance bar, run selector, rename | 49 | 23 | 16 (cited) | — | 10 rows / 7 questions | ledger 2 §R-A |
| Log panel — region, head, outcome bar, tabs, timeline, stream, inline records | 114 | 48 | 54 (cited) | — | 12 rows / 11 questions | ledger 2 §R-B |
| Context rail — Data / Edit Data, provenance, freshness, the dock, attempts | 76 | 31 | 36 (cited) | — | 9 | ledger 2 §R-C |
| Receipt — verdict band, banners, sections, fingerprints | 39 | 9 | 19 (cited) | — | 12 (4 served-and-dropped — CLOSED `cf2ee74a`) | ledger 2 §R-D |
| Failure record — head, write-state, remediation, disclosure, classification, bundle | 34 | 7 | 14 (cited) | — | 13 (4 served-and-dropped — CLOSED `df5ea509`) | ledger 2 §R-E |
| Park / ceremonies — the parked write, the park dialog, the D226 gate ceremony | 36 | 6 | 28 (cited) | — | 2 | ledger 2 §R-F |
| Archive — ledger, sweeps, detail tabs, relaunch, Versions view | 250 | 96 | 83 (cited) | — | 71 marks | ledger 3 §1 |
| Activity report | 117 | 57 | 52 (cited) | — | 8 | ledger 3 §2 |
| Explorer | 182 | 54 | 97 (cited) | — | 31 | ledger 3 §3 |
| UI catalog — the demo's row-and-panel catalog vs the selector catalog (not the same surface) | 69 | 0 | 63 (cited) | — | 6 | ledger 3 §4 |
| Settings + storage doctor | 72 | 2 | 55 (cited) | — | 15 marks / 10 questions | ledger 3 §5 |
| Intake | 155 | 4 | 85 (cited) | — | 66 marks | ledger 3 §6 |
| Phone capture — the demo's DESKTOP view vs the rebuild's phone | 62 | 1 | 55 (cited) | — | 6 | ledger 3 §7 |
| Version-bump dialog | 53 | 2 | 12 (cited) | — | 39 marks / ~20 questions | ledger 3 §8 |
| DS primitives — tokens, barrel, the specimen page | 159 | 119 | 22 (cited) | — | 18 | ledger 3 §9 |
| **Total** | **1,956** | **756** | | | **~150 distinct questions** | |

Two readings worth having before the list. The design system is 75 % exact because it was COPIED
with provenance rather than re-implemented (231 demo tokens, zero missing, zero values divergent);
the run start is the furthest from the demo among the shell surfaces (42 %) because it is where the
most decisions were made and the most reasons ended up in a tooltip instead of on the page. And
three run-detail regions — identity, receipt, failure record — had never been audited at all
before 2026-08-21 and hold 32 of ledger 2's 54 questions between them.

### The OPEN questions — what the operator must rule

Each line is ONE question, with the ledger rows it settles and the demo / rebuild `file:line` the
ruling is about. An element seen by two ledgers is listed once. A `D###`, a plan decision or a dated
operator call turns a line into a ruled divergence or a port; nothing below is dismissed by this doc.

**Structural and behavioural — one decision decides many rows**

1. **Archive — virtualise the ledger, or retire the claim.** `@tanstack/react-virtual` is not a dependency; the row/section pixel constants, `overscan`, the spacer `<tr>`s and the one flat item list are absent and each sweep gets its own `<TBody>`, while `archive.tsx:12-19` still argues the demo's 800-row case (`DemoArchive.tsx:440-474, 535-568` vs `archive.tsx:698-715`). → AR32–AR35, AR51
2. **Version bump — do the MAJOR / MINOR arms BEHAVE, or does the field stop claiming they do?** Nothing in `src/domain/archive/`, the archive query or the command kernel branches on `VersionBumpChangeRecordSchema.kind` (`change-record.ts:30`), so a `minor` bump archives every prior-version run and can be refused by a non-terminal one — the two things the demo says a minor bump never does (`DemoVersionBump.tsx:48-59`, `demo-archive-wire.ts:144-149`). → VB1, and behind it VB13, VB22, VB23, VB26, VB30, VB31, VB33, VB45
3. **A DS specimen page — build it, or record the deferral with a trigger.** `DemoUiKit.tsx` (1,189 lines, seven sections), `kit.html`, `kit-entry.tsx` have no counterpart; `DESIGN.md` is binding and still tells the reader to open them. → UK146–UK157
4. **The row-and-panel VOCABULARY as a product surface.** The demo's catalog names 8 row variants, 3 containment kinds, the rollup chain and 4 panel kinds (`DemoCatalogView.tsx:113-384`, `demo-catalog.ts`); only `panelKind` reaches the wire. D184 retires the demo SHELL as a port target and does not answer this. → CA1, CA16, CA23, CA36; also the ⓘ's row-variant naming layer on the queue row (B43–B48, B51 — `DemoQueue.tsx:548-569` vs `queue.tsx:463-477`)
5. **Settings — a full-page takeover behind a 220 px nav, or the `Dialog` it is?** `ref dashboard-surfaces` §9.8 rules the section list and is silent on the container (`DemoShell.tsx:623`, `DemoSettings.tsx:1074-1083, 1164-1188` vs `settings.tsx:313, 337`). → A65, SE1–SE4, SE8
6. **The keyboard legend is reachable from nowhere.** The demo made one change in two halves — delete the top bar's glyph (*"we already have help in settings"*) AND add Settings → Help → Keyboard; the rebuild ported the deletion only: `ShortcutsPopover` (`top-bar.tsx:912`) has zero callers and `app/global-keys.ts` binds no `?` (`DemoSettings.tsx:990-1015, 1029-1030`). → SE7, SE43, SE44
7. **Two Settings status sections need no new authority.** System hosts reads `systemInstances`, already on the bootstrap; Workflow capabilities is descriptor-derived from the same descriptors the Explorer reads; both are absent because `settingsSections` lists only `storage` (`bootstrap.ts:122`; `DemoSettings.tsx:682-857`). → SE40–SE42
8. **The OPERATOR half of phone capture does not exist.** `DemoCapture.tsx` is the DESKTOP view of a phone session (`:201-430`); the rebuild built the phone, and after the QR is scanned nothing on the desktop shows the phase, pages received, the expiry, an unreadable page or a contact sheet (`capture-start.tsx`). D175 rules the phone; nothing rules the operator half's absence. → CP3–CP5, CP17, CP18, CP59 (the wire behind it: CP2, CP6–CP16, CP21, CP45)
9. **Intake stages 5 and 6 have no surface.** The Manifest stage renders nowhere — the enqueued banner shows one bare `manifest <uuid>` (`intake.tsx:1221`) — and the rerun diff's added / removed lists are unserved (`DemoIntake.tsx:946-1091`). D173 ratifies the dialog → workspace reshaping at length and says nothing about where these went. → IN15, IN16, IN123, IN124, IN126, IN127, IN131, IN137, IN139, IN144
10. **The intake review gate is gone.** `Run` goes live the moment validation returns, beside unresolved rejections (`intake.tsx:999`, `intake-review--paper-ink--1280x720.a11y.yml` `button "Run 3 rows"`); `ref data-intake-and-edit-data` §2.2 step 4 and §7 vector 4 both say it is disabled until the reject list is reviewed, and the courtesy blocker list never names `unresolved-rejections` (`intake.tsx:935`; `DemoIntake.tsx:260, 908`). → IN118–IN120
11. **No archived capture can be opened.** The tile is inert — no `Open` / `What it was` action, no lightbox, no purged note; a "what it was" viewer needs no bytes, so D179's pointers-only rule does not decide it (`DemoArchive.tsx:1285-1293, 1373-1375` vs `archive.tsx:1813-1846`). → AR188–AR190, AR249
12. **The reviewed bump plan reports a COUNT, never the runs.** The demo lists every archivable run by name in a scrolling `Well` (`DemoVersionBump.tsx:226-254` vs `archive.tsx:2416`). → VB24, VB25
13. **The failure record has no disclosure, and the write-state sentence has no frame.** The demo hides the progress ledger, classification, cause chain and bundle behind `Show the diagnostic record` — *"always-expanding a 400px diagnostic dump into a log stream buries the lines after it"* — and frames `What this run left behind` with its three tones; the rebuild renders every section unconditionally and the sentence bold in the flow (`DemoFailure.tsx:190-205, 266-284` vs `log-panel.tsx:696-777`, `trust.tsx:108-111`; `run-failed` reference confirms the shape). → E15, E8, E9
14. **The timeline segment is a non-focusable `<span>`**, so the member disclosure's `group-focus-within:block` can never fire and the hover tint and focus ring are gone with the button (`DemoLogPanel.tsx:574-619` vs `log-panel.tsx:348-358, 470-480, 385`). → B41
15. **The log stream is FLAT; the demo groups it by step under a sticky heading** — and the rebuild publishes `--ds-panel-head-h` whose stated purpose is those headings (`DemoLogPanel.tsx:1060-1085` vs `log-panel.tsx:1101, 1586-1601`). → B65
16. **`dataExpanded` has two owners** — collapse an expanded rail and re-open it: the column is wide while the header reads `Run data` and offers `Widen` (`DemoContextRail.tsx:181-191` vs `log-panel.tsx` + `context-rail.tsx`). → C4
17. **The step group lost the `Well`, the recessed band and the row dividers** R6 f.1 named beside the levels D252 delivered (`DemoContextRail.tsx:762-803` vs `context-rail.tsx:658-667`). → C51
18. **A refused save is one uncoded red span, and nothing says the operator's edits survived it.** The demo's `Refusal` prints the code and two toasts state how many edits are still held (`DemoContextRail.tsx:684-697, 548-562` vs `context-rail.tsx:742-746, 586`). → C55, C57
19. **The orphan-gate trailing segment** — the demo keeps it so a wait can never vanish because the shape did not line up, *"the one thing this timeline may not do"* (`DemoLogPanel.tsx:687-705`; rebuild none). → B57 (ledger 2)
20. **The toast floor and the nesting that makes it possible.** The shell never sets `--ds-toast-inset-bottom` (`RebuildDemo.tsx:601-619`; `ds/primitives-overlay.tsx:1052` falls back) and the theme root is INSIDE both providers (`dashboard-app.tsx:173-203` vs `RebuildDemo.tsx:591-597`), so every toast sits over the Session bar — the demo's own documented gotcha, unported. → A168, A169
21. **The run modal hides the typed box and the shape block at the Plan stage**, and a shared-setting change after a result leaves the result standing (`DemoRunStart.tsx:709-795, 882-893` vs `run-start.tsx:845-887, 981-1017`). The two-step COMMAND is ruled (D251); hiding the input is not. → C107, C108, C109
22. **Group 02 always draws with a disabled `Dry run`, and Destination is a fixed `03`.** The demo's rule is "a workflow that declares none shows none" and the numbering travels with it (`DemoRunStart.tsx:900-927`, `DESIGN.md:305` vs `run-start.tsx:990-1012`). → C83, C84
23. **The plan is a `Table`, not the demo's list of `Card`s** — the missing columns are a wire gap; card-vs-table is a presentation choice nothing records (`DemoRunStartKit.tsx:263-269` vs `run-start-kit.tsx:264-289`). → C57
24. **`CommandResultFeed` and the applied-result toast are absent**, deferred at `actions.tsx:16-21` until "the app's real `CommandResult` wiring" — a reason D253 has spent (`DemoActions.tsx:508-636`). → B195, B196, A175
25. **The bulk result band — the whole vector, the closing sentences, the skipped-row shape, the heading.** Only non-zero buckets print (a clean batch reads `2 applied`, the reading D235's own headline forbids), both closing sentences are gone, the `<details>` disclosure became one comma-joined sentence, and the heading is the wire's lowercase verb (`DemoBulkBar.tsx:291-389` vs `queue-toolbar.tsx:419-440, 519-526`). → B165, B173, B174, B172, B164
26. **The conflict banner names a state with no exit** — the demo's one cure is `Reload the form`; D253 says re-sending the same envelope is refused identically (`DemoRunStartKit.tsx:364` vs `run-start-kit.tsx:358-367`). → C69
27. **A reason that exists but is not on screen** — a locked sub-selection's reason and the enqueue policy's reason survive only as a `LockedValue` tooltip, invisible to touch and keyboard, confirmed in the 1440×900 reference; `DESIGN.md:305` and D251 both say "read-only WITH its reason" (`DemoRunStartKit.tsx:175-183` vs `run-start-kit.tsx:186-193`, `run-start.tsx:971-972`). → C48, C81
28. **The operator's "checked" mark at its three sites** — row glyph + `sr-only`, the well tally `✓ 3/12`, the drill-in check (`DemoQueue.tsx:487-491, 1605-1617`). The demo holds it as client state, so it is portable today; the question is whether a check survives a reload — durable and per-actor, or not. → B57, B80 (ledger 1)
29. **`Import spreadsheet` in the toolbar's left group** (`dashboard-app.tsx:1157-1183`; no demo counterpart) — a real reason stands in code (the demo reaches intake from inside the Run Modal and this tree serves no such handoff) and no ruling cites it. → A174, B141
30. **The bulk strip leads with the destructive verb** (`Cancel` then `Retry`); the demo puts the irreversible one last and the product's own rule sits one file over (`actions.tsx:378`; `DemoBulkBar.tsx:47-50` vs `bulk-dispatch.ts:41`). → B155
31. **The fact chip forks the ds `Chip` primitive** it could call (`ds/primitives-core.tsx:393`; `DemoQueue.tsx:168-206` vs `queue.tsx:1113-1130`) — the exact fork the demo's own comment records fixing; visible deltas in height, padding and label ink. → B112
32. **The app root drops `min-w-0` and `overflow-hidden` and adds `min-h-0`** (`RebuildDemo.tsx:620` vs `dashboard-app.tsx:957`), and two unrecorded rail-entry spacing changes (`DemoShell.tsx:930-977` vs `shell.tsx:260-262, 273-305`). → A170, A81, A82
33. **The version-bump authoring step — what shape is it?** Mounted inside `VersionsView`'s body rather than at the page root, `lg` rather than `xl`, a `Select` for the kind rather than a described `RadioGroup`, opens on `minor` rather than `major`, a fixed title and description, four stacked fields rather than a two-up grid, a disabled primary where the demo argued a never-disabled one (*"a greyed-out button hides the one rule this flow exists to enforce"*), no applied banner and no `Open the archive` (`DemoVersionBump.tsx:98-297` vs `archive.tsx:1912-2015, 2003`). → VB4–VB12, VB14–VB17, VB27–VB29, VB32, VB34, VB36–VB38, VB40, VB41, VB43, VB44, VB47, VB50; AR239, AR241
34. **Intake's reshaped shapes** — the rejection list became cards per source row, the fix and exclude editors collapsed into always-present inline inputs, the exclusions `Well` became a chip section, the enqueue-result banner family changed arms (`DemoIntake.tsx:816-935`, `DemoRunStartKit.tsx:336-400` vs `intake.tsx:216-233, 700-848, 1221-1225`). → IN21–IN24, IN30, IN32, IN34, IN46, IN47, IN55, IN56, IN61, IN70, IN75, IN97–IN100, IN102, IN103, IN107–IN109, IN111–IN114, IN117, IN122
35. **The Explorer's pencil moved out of the field cell** into two `FactRow`s below the table, reversing the demo's argument that *"editability is a property of a FIELD"* (`DemoExplorer.tsx:839-844` vs `explorer.tsx:1108-1117, 1134-1139`), and the rebuild prints a second name per row plus `contracts` and `re-runs on every attempt` lines §5.2 does not list (`explorer.tsx:526-530, 548-555, 1100-1124, 1173-1187, 1374-1376`). → EX114, EX125, EX66, EX87, EX88, EX127, EX133, EX165
36. **Four cross-region conventions to rule ONCE.** Every takeover wraps the demo's bare `div` in a `Panel` with an enter transition (`activity.tsx:1095`, `archive.tsx:2684-2692`, `explorer.tsx:1467-1477`; AC12, AR9); tables get `overflow-x-auto` wrappers the demo leaves bare (AC62, AC77, AR225); `Skeleton` / `Refusal` async panes the demo never needed (AR244, AR245); and raw wire enums where the demo prints a label — the archive filter and rows, the bump blocker table, the Activity caveats print `awaiting-approval` / `blocked` / `partial`, and `status-model.ts:73` maps `blocked → parked`, so the caveat contradicts every pill on its own page (AC24, AR27, VB19).

**Words and glyphs — each is a revert or a ruling**

37. Shell and queue: `"1 worker need attention"` at a count of one (`shell.tsx:1029`; A122) · `app 0.1.0` under a tooltip that explains only MAJOR.MINOR (`shell.tsx:1052-1057` vs `DemoShell.tsx:1919-1924`; A126) · the bulk result heading (B164, in 25 above).
38. Run start: `Dismiss` on every result arm where the demo says `Close` on applied (`run-start-kit.tsx:341-345` vs `DemoRunStartKit.tsx:341, 379-383`; C72) · a raw ISO `expires` on the plan-provenance line (`run-start-kit.tsx:291-294`; C61).

**Resolved 2026-08-25 — C96.** Bootstrap now requires and projects the descriptor's single
positive-integer `version`; the Run Modal footer renders `{label} v{n}` through shared
`versionTag`. The synthetic bootstrap producer emits `v7` in the focused start-run parity
corpus, while the server test also projects a synthetic version 7 descriptor, so neither
producer nor client can hardcode or guess `v1`. The demo's minor half has no rebuild field,
so `.0` is not fabricated.

**Resolved 2026-08-25 — B31.** The queue row now consumes
`queueRowAccessibleName(surface, nowIso)`, which passes its one shared served gate-age fold to
`statusAccessibleName`; the mutation-pinned test proves an awaiting-approval row reads
`{title} — review · 18m 0s` rather than dropping the age that distinguishes its urgency.

39. Run identity: the `wf ` noun before a bare fingerprint (`run-identity.tsx:129`; A3) · the `·` separator in the provenance `Workflow` row (`:173` vs `DemoRunIdentity.tsx:141`; A13) · the rename placeholder and `subject` fallbacks (`:363, 396` vs `:394, 433`; A38, A41) · the floor bar's live/idle dot (`DemoLogPanel.tsx:1183`; A49 = B87).
40. Log panel: `opacity-70` on an untimed segment (`DemoLogPanel.tsx:617`; B44) · the hover card's `Status` row (`:644-647`; B50) · the axis prints the first→last SPAN where the demo prints the WORKING sum and `· {age} waiting on you` (`log-panel.tsx:440` vs `:714-716`; B60, B61) · the search control's DS swap, clear affordance and width (`log-panel.tsx:1178-1185` vs `:1148-1157`; B83) · `open {age}` beside `since {clock}` on the decision card (`log-panel.tsx:572-580` vs `:396-398`; B91) — and one recorded TENSION, not an OPEN: D225's `since <clock>` under a blocked segment against the demo's own argument that the AGE is the comparable number (B45).
41. Context rail: the Data section's accessible name (`context-rail.tsx:611` vs `DemoContextRail.tsx:590`; C16) · the ⓘ bullet that now UNDERSTATES the surface — "grouped by the workflow step that produced it" was dropped when grouping was unserved and D252 made it true again (`:468` vs `:627`; C21) · `written` vs `write` in the `sr-only` direction word (`:312` vs `:260`; C32).
42. Receipt: the confidence Chip and `CONFIDENCE_COPY`'s three sentences beside the verdict word (`trust.tsx:286` vs `DemoReceipt.tsx:82-86, 220-222`; D8) · the receipt identity line scattered over three places (`receipt.tsx:84, 130`, `trust.tsx:284-292` vs `:224-232`; D9) · the dry-run Banner (`:248-252`; D13 — `dryRun` is served and `ReceiptView` is not passed it) · the commit/prepare Badge (`:110`; D17) · the criterion icon (`trust.tsx:239-253` vs `:332-368`; D24) · the uncertainty icon and its two full sentences (`trust.tsx:270-282` vs `:455-473`; D29) · the `receiptInvariant` Banner (`:235-239`; D11 — the schema may already make the pair unrepresentable; nobody wrote that down).
43. Failure record: the head says a category (`This run failed`) where the demo says the run's own `summary` (`log-panel.tsx:730-732` vs `DemoFailure.tsx:181`; E4) · the `code` Chip (`trust.tsx:114` vs `:182-184`; E5) · the missing `permanent` arm — the reading that tells the operator NOT to press retry (`trust.tsx:115` vs `:185-187`; E6) · `What is safe to retry` vs `What to do` (`trust.tsx:143` vs `:234-235`; E11) · the observed-subject danger tone (`trust.tsx:122-131` vs `:322-325`; E22) · the `First time this fingerprint has been seen.` arm (`trust.tsx:118` vs `:365-376`; E30).
44. Archive copy: the back-button label, the table label, both empty-state arms, the test-instance `aria-label`, the sweep name / trace / title / popover strings, the detail header title and subtitle, the export toast, the relaunch banner's title and body, the summary `MetaLine`, the ledger well and table labels, the log-line and data-point shapes, the People tab, the capture tile geometry and badge tones, the relaunch preview's badge and cautions, the Versions view's four banner sentences (`DemoArchive.tsx` vs `archive.tsx`, row by row in ledger 3 §1). → AR4, AR27, AR37, AR39, AR54, AR56, AR59, AR68, AR80, AR82–AR84, AR90, AR94, AR97, AR102, AR103, AR105, AR106, AR124, AR127, AR128, AR133, AR141, AR142, AR148, AR150, AR152–AR154, AR162, AR163, AR169, AR172, AR174, AR177, AR178, AR182, AR184, AR187, AR207, AR211, AR212, AR218, AR220, AR221, AR223, AR229
45. Intake naming: 18 renamed labels and sentences — title, subtitle, Cancel → Close, the invisible `Source file` heading, the `sha` length, row-count wording, the mapping table's name and two column heads, the unbound option, the duplicate-header suffix, the rejections empty state, the six reject labels, the exclude placeholder and button, the fix button, `Start N runs` → `Run N rows` (`DemoIntake.tsx` vs `intake.tsx`). → IN2, IN3, IN7, IN27, IN44, IN45, IN64, IN66, IN69, IN72–IN74, IN95, IN101, IN110, IN115, IN116, IN138
46. Explorer copy and geometry: the list header meta, four graph-less arms that are structurally unreachable, the connector's `no edge between them` sentence, three kind words and their tones (`Fan-out`/`Parallel`, `Write`/`Transaction`, the missing `Output`), the `system`-vs-`store` fact chip, the empty-contract sentence, the `colgroup` split, two posture notes, the delegation paragraph's capitalisation, the pencil paragraph's voice, the empty-state block and its new action (`DemoExplorer.tsx` vs `explorer.tsx`). → EX8, EX13, EX18, EX20, EX23, EX26, EX55, EX65, EX72–EX75, EX96, EX101, EX103, EX155, EX156, EX166, EX168, EX171, EX172
47. Activity: the date pair carries no `role="group"` / `aria-label` where the chip group did, two spacing tokens drift, a `shrink-0` the demo does not have (`activity.tsx:1118, 1147, 367` vs `DemoActivityReport.tsx:99, 116, 421`). → AC10, AC11, AC19, AC90
48. Settings storage: the section header (`PanelHeader` + subtitle + meta vs a bare `SectionLabel`), the health banner vs two `HealthLine`s, the band's container and icon (`DemoSettings.tsx:869-879, 1209-1211` vs `settings.tsx:104-105, 268-270`). → SE45, SE46, SE63, SE64
49. DS: `TR`'s `interactive` arm gains an `active:` state and `dsMotion.fast` (`primitives-data.tsx:79`; UK141) · `DsStep` gains a `trailing` duration column that reflows `TimelineSteps` (`:270, 375-390`; UK144) · the catalog row counts verification scenarios where §5.8's thesis is naming them (`ui-catalog.tsx:143-150`; CA59).

**Rebuild-only additions with no citation — keep with a stated argument, or remove**

50. Shell / run start: first `Escape` clears a non-empty search query (`day-search.tsx:236-243`; A16) · a `"No workflow"` title arm for an empty catalogue (`run-start.tsx:832-834`; C28) · a zero-system Well (`run-start-kit.tsx:84-90`; C94) · the plan-provenance line itself (`run-start-kit.tsx:291-294`; C61).
51. Run detail: the provenance `Config` and `Attempt` rows (`run-identity.tsx:198-199`; A18, A19 — R5 f.2 DELETED the header attempt badge on the demo's own argument) · the rename error affordance (`:354, 360-362, 408`; A35, A37, A47) · `record {failureId}` on the failure head (`log-panel.tsx:733-737`; E7) · the empty-stream state and `More lines follow.` (`log-panel.tsx:1107-1111, 1156-1165`; B79, B80) · the duplicated blocked-reason sentence under the dock and `Saving…` (`context-rail.tsx:887-891, 872`; C70, C71) · the park footer's meta slot (`park-resolve.tsx:756`; F22) · two near-identical `RefusedNotice`s (`identity-approve.tsx:399-425` vs `park-resolve.tsx:425-463`; F35).
52. Standing surfaces: `data-demo-row-id`, the detail header icon, the detail panel `aria-label`, the empty-steps sentence, the decision `MetaLine`, the member `runId`, the People-tab footer (AR59, AR97, AR103, AR142, AR150, AR177, AR178) · the Explorer's list `aria-label`, record-column wrapper and empty-state action (EX26, EX8, EX172) · intake's column count, `uploaded` clock, blank-header option, the validated clock and review preamble, the separator rule (IN46, IN47, IN75, IN97, IN98, IN117) · the bump dialog's character counters and enter transition (VB36, VB50).

### Served-and-dropped — the wire already carries the bytes and no pixel shows them

Pure FE work; no ruling is needed because these are divergences with no argument — the facts are on
the wire (or in the bundle) and simply not drawn.

- ~~**Receipt (ledger 2 D25, D27, D31, D32):** the observation's `taskId` and `observedAt` · the `inputFingerprint` · the `trace` / `descriptor` / `config` fingerprint footer · the receipt's own `failure` id.~~ **LANDED `cf2ee74a`** — `evidenceSourceMeta` (a new `trust-model.ts`, pinned arm by arm) replaces the bare `source.kind` on every fact; `ReceiptFingerprints` draws the demo's footer last, under a subtle rule, with the two hashes cut through `shortHash` and whole on the chip's `title`; the `failure` id joins the receipt's identity `MetaLine`.
- ~~**Failure record (ledger 2 E19, E20, E24, E25):** `occurredAt` · `traceId` + `attempt` · `page.urlRedacted` (and `page.titleRedacted`) · `action.elementId`.~~ **LANDED `df5ea509`** — all four in the demo's `Classification` order, in this tree's `MetaLine` idiom. `occurred {clock}` now prints BESIDE the run's `failed {clock}`, each named for what it dates, which is the whole of E19's point.
- **Intake (ledger 3 IN8, IN9, IN53, IN82, IN106, IN121, IN126, IN127, IN131):** the footer's header-row and fingerprint echo · per-candidate `confidence` (`ServedHeaderCandidateSchema.confidence`) · suggestion `score` (`SuggestionSchema.score`) · the reject `code` (only its label is shown) · the whole corrections list (`IntakeSessionWire.corrections`, read only for the discard count) · the manifest's source sha, `artifact` id and `createdAt`.
- **Archive (ledger 3 AR95, AR96, AR121, AR123; AR77, AR78, AR91, AR129; AR105, AR212):** the detail draws `displayName`, `subtitle`, `priority` and the `dry run` chip off `detail.row` (`projection.ts:172, 179, 309, 313`) · the sweep head, its `sr-only` summary, the popover description and the Archived-by card print the bump KIND — `changeRecord.value.kind` has ridden `ArchiveSweepWire` since D223 · the relaunch banner names the workflow and the version it has in hand · the relaunch cautions derive from `detail.row.dryRun` / `row.resolvedInstances`. (The LIST row's `△ N` and `dry run` chips — AR62, AR67 — need the index entry to carry `warnings` / `dryRun`, a WIRE half.)
- **Elsewhere:** the Explorer's `Version registry` action (EX5 — the recorded reason for dropping it is false, `archive.tsx:2350` renders the registry) · every closed-enum status through its ds label (AC24, AR27, VB19 — `DS_STATUS[dsStatusOf(s)].label` is one import away).

### Stale and false claims in code and docs — fix the record or fix the code

**Resolved 2026-08-21 (Track F).** Every row below was re-verified against HEAD before being
corrected — one row (archive.tsx:386-388) was found to already be the SAME false claim it always
was rather than newly stale, and the DESIGN.md guard row (:209/:546/:548-549) had its exact line
citations shift under later edits, corrected to the current locations ("Size, radius, elevation,
focus, motion" ~:253 and "Motion rules → Mechanics" ~:590-592) while keeping the finding. All
twelve code/comment rows plus the two book-a-gap rows are RECORD fixes;
none required a behaviour change.

| Where | What it says | What is true at HEAD | Resolved |
|---|---|---|---|
| `src/dashboard/surfaces/receipt.tsx:5-11` | "the 1i Receipt PLACEHOLDER"; the full body "lands with the trust surfaces in 2g" | 2g landed; `ReceiptEvidenceBody` (`trust.tsx:207-295`) renders input / observations / decisions / actions / verification / output / reuse / warnings. The same false-deferral shape D251 found on the picker (ledger 2 D39) | `5cb9a307` |
| `src/dashboard/surfaces/archive.tsx:386-388` | "the demo's `major`/`minor` word has no counterpart on this wire" | false since D223 — `ArchiveSweepWire.changeRecord.value.kind` exists; the sweep badge, its summary, the popover and the card print the SCOPE on a dead premise (ledger 3 AR77, AR78, AR91, AR129) | `5cb9a307` |
| `src/dashboard/surfaces/archive.tsx:12-19` | argues the demo's 800-row virtualisation case | the table is not virtualised (question 1); Track D D9 names the deferral | `5cb9a307` |
| `docs/findings/queue-rows.md:221` | "`dryRun` LANDED on `QueueBaseFields` … and the archived detail draws it" | it does not — `dryRun`, `priority`, `warnings`, `displayName`, `subtitle` are served on `detail.row` and read by nothing in `archive.tsx` (ledger 3 AR62, AR67, AR95, AR96, AR121, AR123) | `06041db1` |
| `ref operator-trust` §5.7 | the Explorer's `Version registry` action is absent "because no version-registry surface exists in this tree" | `archive.tsx:2350` renders `<Table label="Workflow version registry">` inside Archive's `Versions & bumps` view; only the Explorer's own door to it is absent (ledger 3 EX5) | `155b1048` |
| `src/dashboard/surfaces/explorer.tsx:8-10` | `skippedAboveBoundary` and `laneOf`'s connector rule were ported | `explorer-model.ts` exports neither; no early-skip mark is drawn and the `Connector` is emitted between every consecutive pair (ledger 3 EX180, EX181) | `5cb9a307` |
| `src/dashboard/DESIGN.md:112, 690, 691, 696-697` | skim `DemoUiKit.tsx`; open `kit.html` on port 3943 | neither artifact exists in this tree; corrected in the top adaptation-notes block rather than the verbatim body (ledger 3 UK158) | `33e140f9` |
| `src/dashboard/DESIGN.md:13-22`, `:18` | the porting header names two adaptations; the barrel is `ui.ts` | the missing specimen page is a third adaptation, undisclosed; the barrel is `ui.tsx` (UK66, UK67) | `33e140f9` |
| `src/dashboard/DESIGN.md:209, 546, 548-549` | reduced-motion coverage and the z-index scale are "guard enforced" (current body locations: "Size, radius, elevation, focus, motion" ~:253, "Motion rules → Mechanics" ~:590-592) | true today, narrowly — `5cc035b9` (2026-08-12) restored the 3 of legacy's 4 checks this port had dropped; the top note now states the exact scope each check covers (`ratchet-arms.ts`'s `frontend-tailwind-compliance` arm; UK69) | `33e140f9` |
| `ref dashboard-surfaces` §9.5.3 | catalog entry is "two `ghost` buttons in the panel's action bar beside `Import spreadsheet`" | no such button in `queue-toolbar.tsx`, `shell.tsx` or `dashboard-app.tsx`; the catalog is reachable only by typing `?catalog=` (`top-bar.tsx:1121-1125` records the glyph's removal; CA41) | `155b1048` |
| `ref data-intake-and-edit-data` (D173's text) | "CONSTANTS RENDER READ-ONLY" | `intake.tsx:938` reads `session.constants.length` inside a blocker computation and nothing renders one (IN155); the normative text lives at `ref dashboard-surfaces` §9.7.1, corrected there | `155b1048` |
| `src/dashboard/surfaces/actions.tsx:16-21` | `CommandResultFeed` lands "with the app's real `CommandResult` wiring" | both refusal arms are served and folded by `settleCommandResult` (D253); the reason is spent (B195, B196) | `5cb9a307` |
| `src/dashboard/surfaces/shortcuts.tsx` header | "a binding that is not here is unreachable from Help" | the whole legend is unreachable — `ShortcutsPopover` has zero callers (question 6) | `5cb9a307` |
| `docs/findings/explorer.md`, and the absence of `intake.md` / `capture.md` | zero open explorer records; nothing books 22 intake and 5 capture gaps | booked: `explorer.md` gained 3 open records (skippedInDryRun, per-field `when`, no minor version); `intake.md` and `capture.md` created, 3 and 5 open records respectively (ledger 3 §3) | `5b13ec0e` |
| `src/dashboard/surfaces/receipt.tsx` / the owning doc | (nothing) | answered: the demo's `receiptInvariant` Banner is structurally unnecessary here — BOTH `CHECK (result <> 'verified-done' OR confidence = 'verified')` (`migrations.ts:167`) and `RunEvidenceReceiptSchema`'s superRefine (`evidence.ts:162`) make the pair unrepresentable; recorded at `ref operator-trust` §2.3.8 (ledger 2 D11) | `155b1048` |

What the fold did NOT do: no surface, token or wire moved, and nothing in the three ledgers was
re-audited — every count above is the ledger's own, and the ledger stays the row-level record this
section points into. The demo pixels were not re-photographed by ledgers 1 and 2; ledger 3 ran the
demo live. Ledger 1 also lists the 20 unserved-wire `builds:` lines it derived (two shell, ten queue,
eight run-start); they sit on `{#dash-defaults}`, because `{#track-b}` is done and may not reopen.

## Duo ceremony lease — one login at a time per credential
<!-- roadmap: duo-lease -->

<!-- roadmap-status: duo-lease -->
- [x] BE `duo_ceremony_leases` in authority, plus the lease token `defineVerifiedLoginRecipe` requires (`bfc7d318`, `cb7f17f8`)
- [x] BE bounded waiters and the fresh-profile-once recovery, both failing by name (`cb7f17f8`)
- [x] BE the guard — no login path without the lease, with a violating fixture (`37e747f0`)
- [x] PROOF two workers' cold starts serialize — unit (`1c244a40`) plus the LIVE two-worker cold start, 2026-08-21 (`live-a` / `live-b` on one credential, ceremonies serialized at lease generations 3 → 4 with no overlap and zero waiter refusals; ref execution-and-sessions §10 §Live proof carries the numbers)
- [x] DOCS the decision in `reference/execution-and-sessions.md` and `reference/decisions.md` (D267)
> 2026-08-20 | docs-cohesion 03a | nothing named duo_ceremony_leases or a ceremony lease exists anywhere in src/; defineVerifiedLoginRecipe (src/infra/browser/authenticated-application.ts:159) takes system + verify + flow and no lease token
> 2026-08-21 | duo-lease E1 | built (D267): store+token+leaf bfc7d318 · gate+wiring+recovery cb7f17f8 · guard 37e747f0 · unit proof 1c244a40; left: the live two-worker cold start
> 2026-08-21 | duo-lease E2 | the live two-worker cold start RAN — both `logged-in` (23.2 s holder, 37.2 s waiter), the waiter's ceremony began 228 ms after the holder released; the record is ref execution-and-sessions §10 §Live proof
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
- [x] BE the projection serves a worker-POOL version — `worker_pools` (schema v17) is the CAS basis `spawn-worker`/`plan-worker-count` cite (0 for an unplanned workflow); the kernel refuses a stale one by name before the runtime seam; the day wire serves `workerPools[]` (`93b7b18e` · `b4f30ea0` · `24b04dfa`, D269)
- [x] BE a durable session record and its grouping — `run_sessions` (insert-only, member-less), written by every fan-out before its first member; membership is `tasks.session_id` / `runs.listBySession`; a retry inherits; the queue row serves `session` (`93b7b18e` · `57f2bb9c` · `24b04dfa`, D269)
- [ ] FE the session view — worker cards show membership and what each worker is doing, read from authority
- [ ] PROOF two separations dry-run scenarios in parallel, recorded
> 2026-08-20 | docs-cohesion 03a | the kernel command arms exist and are validated (src/core/command-kernel.ts:95) while createDashboardWorkerSupervisor refuses spawn by name (src/server/dashboard/compose.ts:322) and the FE has no Add-workers control for the CAS reason quoted in src/dashboard/surfaces/shell.tsx:1036
> 2026-08-21 | parallel-runs P12 | the authority half landed (D269) — ref execution-and-sessions §11 points 1 and 5 carry the as-built; left: the pool process (spawn + pool-indexed ids), the FE session view, the parallel proof
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

**What is already true, and what the seam actually needs.** _(D269, 2026-08-21: the CAS basis and
the session record this paragraph asks for are BUILT — `worker_pools` and `run_sessions`, schema
v17; ref execution-and-sessions §11 points 1 and 5 are the as-built. The paragraph below is kept as
the record of why.)_ The command arms are real and composed:
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
| 90 | 2026-08-21 | D268 | **Track D row D1** — ONE `deriveRunStatus`, ONE task-outcome vocabulary, ONE `panelKindOf`; the detail panel can no longer disagree with the queue row |

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
task is entitled to assume. Four of ten hold at HEAD. Row 1 is not rewritten by the fidelity
re-audit: Track B's definition of done was the findings ledger, and it met it; demo fidelity is the
stricter bar Track F carries (row 10).

| # | Criterion | State at HEAD | Evidence / what is left |
|---|---|---|---|
| 1 | **Track B met** — every generic surface built, each as one vertical slice | **MET** | B1–B8 landed 2026-08-19 → 20 (D222–D255); every surface verified present in the table above |
| 2 | **The findings ledger is zero-or-decided** | **MET** | `docs/findings/README.md`, B8 sweep 2026-08-20: five open records across two files, each naming the commit that closes it; zero undecided |
| 3 | **Track C met** — the real dashboard drove a real composed run, every claim paired to authority | **MET** | `docs/migrations/separations.md` §9.22 items 1–8; three runs; four defects plus the archive unblock (D258), all fixed same-day; §9.24's live `sp-105225-1e0b` |
| 4 | **The reference corpus asserts over the corrected surfaces** | **MET** | `81287bb1` — 139 references re-frozen after the fixes, 151 assert-mode cases green, every drift attributed to a ratified decision |
| 5 | **Track D's D1–D5 + D11 landed** — one fact, one derivation; the read scans bounded; the registry out of the browser bundle | **open** | D1 LANDED 2026-08-21 (**D268**, `81bfed73`) — one fact, one derivation, held by a test that asserts the row and the panel against each other. D11 LANDED 2026-08-21 (`149bc5f8`, `0911becd`) — the registry is out of the browser bundle (1,114,214 → 753,197 bytes), held by `dashboard-wire-boundary` arm (15). D2–D5 remain unlanded (see the Track D table); D6–D10 stay `proposed` behind their named trigger and are outside this gate |
| 6 | **`ref frontend-backend-integration` §7.4's budgets measured and recorded** | **open** | the instrument and its BEFORE baseline landed 2026-08-21 (`407d373f`), and **D5's AFTER numbers are recorded** against the same seeded 1,240-row / 108-member fixture (`c547f65a`); D4 still owes its half, and the recorded numbers become the non-regression gate |
| 7 | **The Duo ceremony lease landed** | **met (D267, bfc7d318…1c244a40)** | `duo_ceremony_leases` is schema v16; `defineVerifiedLoginRecipe` runs its `ceremony` half only under the lease token; the live two-worker cold start is still to be recorded |
| 8 | **Parallel runs proved** — the pool, the durable session record, two separations dry runs in parallel | **open** | the kernel arms exist; the supervisor refuses spawn by name and the projection serves no pool version |
| 9 | **Observed logs landed** — the log quotes the recorded observations | **open** | recorded points reach no durable channel today |
| 10 | **Demo fidelity: every region exact or ruled** — ~150 OPEN questions outstanding | **open** | the three 2026-08-21 ledgers: 1,956 elements/rows, 756 exact; 37 + 54 + ~60 distinct questions await the operator (§Demo fidelity — every detail, region by region); the served-and-dropped facts, the structural ports, the vocabulary sweep and the re-freeze follow the rulings |

**Deliberately outside this phase, each with an owner.** The Review and People panel bodies (their
projections belong to the OCR and group migrations in doc 03c); editable settings, the explorer's
EDIT half, the production byte path for the phone page, and search / screenshots / export (doc 04's
`{#def-settings}`, `{#def-explorer-edit}`, `{#def-byte-path}`, `{#def-search-export}`). None is a
waiver: each names its trigger where its node lives.

**Above this phase.** The program-wide surface criteria in `05-cut-over.md` §Exit criteria — in
particular `ref frontend-backend-integration` §10's eleven items — must all pass before the cutover.
Criterion 6 above is the one this phase supplies to that list: §10 item 9's reference route matrix
and §7.4's thresholds are the same gate seen from two sides.
