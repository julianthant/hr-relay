# Phase 3.1 · Finish the dashboard

Read the [phase overview](../README.md) for shared context, decisions and phase-wide exit criteria.

Phase 3 proves the reusable dashboard/workflow platform with Person Lookup and Separations, and
nothing could be wired into a dashboard that did not exist yet. **Phase 3.1 is that dashboard**: the
generic surfaces every admitted workflow inherits, built once, plus the hardening the first real
connection to a running workflow exposed. D326/D329 make it the first of four coordinator-owned parts:
**3.1 Shared dashboard**, then **3.2 workflow authoring and candidate freeze**, **3.3 controlled acceptance**, and
**3.4 Codex and Claude cooperation**. This file owns `{#dash-defaults}` and its numbered supervisor
tasks. [3.2](../3.2-finish-workflow-authoring/README.md), [3.3](../3.3-accept-person-lookup-and-separations/README.md), and
[3.4](../3.4-co-operate-with-claude/README.md) own the following parts. D319 leaves every other workflow
unnumbered until the operator verifies and approves its admission packet. Contracts this phase built
or amended live in `reference/`; this doc holds the work, its state, and its exit.

## Phase summary
<!-- roadmap: dash-defaults -->

<!-- roadmap-status: dash-defaults -->
- [x] every retained surface the wiring matrix names is served and drawn — top bar, workflow panel, queue rows, run detail + timeline, Context rail, gate ceremony, parked write, receipt/failure, run modal, archive, activity, explorer, settings + storage doctor, and intake (Track B, D222–D259; mobile Capture Mode retired by D294)
- [x] the notification inbox has production producers — backup health (D222) and the gate park (D262), both wired in `src/server/dashboard/compose.ts`
- [x] the connection is proved end to end: the REAL dashboard drove a REAL composed separations dry run, every UI claim paired against authority (Track C, `docs/rebuild/migrations/separations.md` §9.22)
- [x] the reference corpus asserts green over the corrected surfaces — after Track C it was 139 references re-frozen / 151 assert-mode cases (`81287bb1`); after Track F's ports it is TWO attributed deliberate re-freezes — 2026-08-26 (`730c0b58` · `114285e3` · `81a4a9f4`: 145 changed, 23 minted) and the 2026-08-27 V1 addendum (`bbe578c1`: the six ruled-copy scenes, 64 files) — **every reference attributed by name** in `9993ab39^:docs/plans/2026-08-26-p1-refreeze-attribution.md`, assert mode `218 passed`
- [x] Track D's D1–D5 + D11 — one status derivation, typed failures, one settlement fold, patch-splice + stable `memo` props, bounded reads and the descriptor registry outside the browser bundle; D6–D10 remain proposed outside the exit gate (D264/D268)
- [x] the Duo ceremony lease — authority, token, bounded waiters, recovery, guard, docs and the live two-worker cold-start proof all landed (D267)
- [x] the worker pool / sessions node — pool-indexed identity, durable pool/session authority, the FE session view, the real dashboard supervisor with its panel controls (W3/W4), and the two-scenario parallel proof recorded live 2026-08-26 (`docs/rebuild/migrations/separations.md` §9.27)
- [x] observed logs — the real dashboard/composed separations dry run served 13 observed rows (sequences 0..12), no notes and zero run-scoped write evidence (`docs/rebuild/migrations/separations.md` §9.25)
- [x] `ref frontend-backend-integration` §7.4's performance budgets — the instrument, BEFORE baseline and both D4/D5 AFTER measurements are recorded against the same 1,240-row / 108-member fixture; the recorded bounds are the later-workflow non-regression gates
- [ ] the run-detail panel's **Review** and **People** bodies — `availableSections` cannot return either section, so both tabs are structurally unreachable; the projections behind them land with their admitted Phase 4 workflow consumers, not here
- [x] demo fidelity — CLOSED BY DISPOSITION 2026-08-27 (D279); D294 subsequently retires the phone-capture portion of its historical residue. The remaining historical audit counts remain evidence, not active product work (Track F, §Demo fidelity — every detail, region by region; `docs/decisions/dashboard.md` §D271–D276)
- [x] historical Tasks 1–7 retain their evidence
- [ ] D326 reopens Task 8, parallel waves 9–13, and serial Tasks 14–18 after 2.6 to finish every generic operator journey; 3.2 cannot resume until the unchanged Task-8 acceptance matrix is green
> 2026-09-05 | D334 operator correction | Task 10-4 now owns intake only. Task 11-2 owns ordinary Run plus the shared source-bound Rerun modal over 2.6 Task 1-2's completed-value/provenance read; the source run is immutable and the former `edit-checkpoint` surface does not return
> 2026-09-04 | D328 parallel task identities | each parallel wave now shares one ordinal and uses numeric members (`9-1`, `9-2`, ...); serial tasks keep plain ordinals. The hyphen names a peer supervisor task, not a checklist subtask, and each member's exact branch/worktree appears in the binding table below
> 2026-09-03 | D326/D327 dashboard reset | operator review found broken/incomplete run-modal, date, queue-delete, settings/setup, session, notification, log, archive, Explorer, intake, trust, realtime, and production journeys. Historical closure is superseded; no workflow-specific policy moves into 3.1
> 2026-09-03 | 3.1 parallel execution plan | coordination `C21194e18` groups the remaining implementation into five dependency-gated parallel waves capped at four dedicated worktrees, with Task 8 and the final five tasks as serial gates. `master` is integration-only, every supervisor receives the exact `feature/phase-3-1-dashboard-c21194e18-rNN-*` branch and sibling worktree recorded below, and the coordinator alone verifies, merges and closes each row
> 2026-08-20 | docs-cohesion 03a | verified against src/dashboard/** and src/server/dashboard/**; every Track D finding still reproduces at HEAD (no exported deriveRunStatus, two TASK_OUTCOME vocabularies, two panelKindOf copies, zero React.memo, WORKFLOW_DESCRIPTORS imported at dashboard-app.tsx:25); left: D1–D5, the lease, the pool, observed logs, the §7.4 numbers
> 2026-08-21 | docs-cohesion 03a fidelity fold | the demo-fidelity re-audit (1,956 elements/rows, 756 exact) is folded in as Track F; Track B's "frontend done" stands as the findings-ledger bar it was defined by, and demo fidelity is the stricter bar above it; left: the operator's ~150 rulings, then the FE / BE / PROOF lines Track F carries
> 2026-08-25 | track-f archive UI + Activity AC24 + Explorer EX5 | `3d461962` served list warning/rehearsal facts and `d1f87916` drew them with the archive's already-served identity, priority, bump-kind, relaunch and enum facts through total folds; `4da19fd7` closes Activity's raw `blocked` caveat with the shared status vocabulary; `4e09fb49` carries Explorer's `Version registry` door through dashboard route state to Archive's actual `Versions & bumps` view. A mechanical recount of ledger 3's 1,119 rows gives 353 exact and 238 OPEN marks; left in this unit: every other non-archive served-and-dropped fact
> 2026-08-25 | observed-logs live proof | document 4502 planned as `479f9f1e-83b3-4157-915b-2794bcf61ab0` ran `25d90c9d-72bf-4fa4-bcea-116665f22790` / `sp-143516-25d9` to `parked-gate` v52: 13 observed rows (0..12), zero notes and 0 / 0 / 0 run-scoped write evidence. The service origin at `separations-2026-08-25.jsonl:12` correctly carries no browser system; `17468e60` changed the false 500 invariant to a 200 response and the UI omits that claim. §9.25 is the full record; the notes emitter and fidelity extras remain open.
> 2026-08-27 | final-recon 03a | V1 (`f6099923`) swept all three ledgers' word rows and the receipt wire landed reviewed (`d4b3cfb8`..`63fb6504`); a second attributed deliberate re-freeze covered V1's six ruled-copy scenes (`bbe578c1`, addendum in `9993ab39^:docs/plans/2026-08-26-p1-refreeze-attribution.md`); the corpus line, sweep line, wire line and exit row 10 above are re-stated from that evidence. Row 10 stays open on the ledgers' structural residue alone. Final gates at this HEAD: 310 files / 3,392 tests, parity assert `218 passed`, roadmap fresh, binding 14/14
> 2026-08-27 | close-out 03a | the five close-out decisions are summarized in `docs/decisions/phase-governance.md` §Phase 3a close: `integration/03a-final` merges into master `--no-ff`; D277 (jsdom per file), D278 (the then-live capture layout) and D279 (row 10's residue carried to Phase 4 by disposition) are minted in reconciliation round 96. D294 later retires Capture Mode and supersedes D278's implementation obligation. Exit table: 10/10, row 10 MET by disposition. Phase 3b's run R1 (the 2026-08-28 T1b canary) is the next plan item
> 2026-08-26 | close-recon 03a | reconciled against the phase-3a final integration line (`8b7ec21e` — 28 unit merges over `26b4617a`) from landed evidence only. The corpus line is re-stated on P1's own numbers (168 of 168 attributed, assert mode `218 passed`). Demo fidelity moves from "every port open" to TWO named open lines: the cross-ledger vocabulary sweep (ledger 2 carries no disposition edit at all and ledger 3 still holds 164 OPEN marks against 252 at the baseline) and the receipt action entry's WIRE (`ActionEvidenceSchema`, `src/domain/trust/evidence.ts:68`, is still `{id, taskId, kind, writeState, proofRef?, artifactId?, occurredAt}` — no target, no system, no written values, no confirmation number, no read-back verdict). Every other Track F line is ticked below against its commit. Exit table: nine of ten rows MET, row 10 open
<!-- /roadmap-status -->

### What this phase is, and what it is not

**It is the surfaces a migration only WIRES.** The run modal, queue rows, run detail + timeline, the
gate ceremonies, notifications, archive, activity, the explorer, settings + the storage doctor,
intake, and the Rerun Run modal. Each is built against the wire, not against a workflow: a later migration's
`Dashboard · wire` task supplies a descriptor DECLARATION (`surfaces.inputRun`, the `timeline`
categories, `nodePurposes`, `subjectProjection`) and a proof, never a new surface.

**It is not any workflow's own wiring.** Separations acceptance is owned by docs 03.2 and 03.3;
every later workflow receives its own admitted Phase 4 part under `ref workflow-model` §1.6.2. They read this node as their
prerequisite, which is exactly why "done" here has to mean something checkable.

**It is not the deferrals its surfaces name.** Editable settings, the explorer's EDIT half, the
production byte path for the built dashboard and the search/export surface each have a node with a
trigger in doc 04 — they are named absences on a built surface, not unfinished work in this phase.

### The order of work

The first seven roadmap tasks preserve the historical delivery order while replacing historical track names as
execution labels: **Task 1** built the shared surfaces, **Task 2** proved the real dashboard-to-run
connection, **Task 3** hardened shared status, commands, and read budgets, **Task 4** closed fidelity
and parity, **Task 5** serialized Duo ceremonies, **Task 6** built worker pools and run sessions,
and **Task 7** recorded observed page facts. Reopened Task 8, waves 9–13, and Tasks 14–18 are the current execution plan.
Every card is one supervisor-session outcome under the 3.1 coordinator. Historical Track B/C/D/F
names remain in logs and decision records only.

### Parallel execution and worktree contract

The remaining work is grouped by **workstream**, not by HR workflow. The stable coordination
identity is `phase-3-1-dashboard` / `21194e18-9e1e-4c51-af5e-5d2f1c8b04bf`
(`C21194e18`). The 3.1 coordinator records its live board and run plan under
`docs/coordinator/phase-3-1-dashboard-c21194e18/` when execution begins. The portable plan here
fixes the task, wave, branch and integration order. Record the exact worktree path before any
supervisor is dispatched.

**`master` is the integration checkout only.** No remaining 3.1 supervisor implements in the primary
checkout or commits directly to `master`. Each task starts from the coordinator-verified
post-previous-wave `master` SHA in its recorded dedicated worktree, commits only to its recorded
`feature/` branch, and returns a clean worktree. The coordinator verifies the task gate, merges
`--no-ff` in ascending task order inside the wave, runs the integrated gate after every merge, then
removes the registered and physical worktree, deletes the local feature branch and archives the
exact supervisor task. The next wave starts only after every prior-wave row is integrated and
closed.

The repository-wide allowance is four auxiliary worktrees. A four-task wave therefore gives each
supervisor an allowance of one: its run worktree. It may use read-only agents or sequence writable
support inside that worktree, but it may not create another writable worktree. Existing unrelated
worktrees reduce the admitted wave size; the coordinator sequences the excess rather than raising
the allowance. Task 8 must freeze non-overlapping file and artifact ownership for every wave. If its
code inventory finds that two proposed peers share a mutable seam, those rows become sequential in
the live coordinator run plan; they never edit the same file concurrently.

| Workstream | Type of work | Tasks | Ordering inside the stream |
|---|---|---|---|
| Baseline | truth inventory and immutable acceptance contract | 8 | serial prerequisite for all implementation |
| Frame and control plane | shell/date, settings/setup/storage/sessions, production runtime | 9-1, 9-2, 9-3, 10-1, 10-2, 11-1, 12-4 | 9-1 → 10-1; 9-2 + 9-3 → 10-2 → 11-1; 11-1 + 10-2 → 12-4 |
| Run operations | start, Rerun modal, queue commands, notifications | 10-3, 11-2, 12-1 | 10-2 → 11-2 → 12-1; 10-3 is independent after Task 8 |
| Run evidence and trust | detail, Context/Data, logs, receipts/failures, gates | 12-2, 13-1–13-4 | 12-2 freezes section seams; 13-1–13-4 then run in parallel |
| Standing surfaces | Archive, Activity/export, Explorer, Intake, Review/People | 9-4, 10-4, 11-3, 12-3, 14 | 11-3 → 12-3; 9-4 and 10-4 are independent; 14 waits for the run-detail section seams |
| Cross-cutting closure | realtime, performance, proof infrastructure, acceptance | 15–18 | 15 → 16 → 17 → 18; these are serial because each measures or proves the integrated tree |

Worktrees follow root `AGENTS.md` / `CLAUDE.md`: create each directly under
`/Users/julianhein/Projects/` as `hr-worktree-<task>`, with one or two lowercase, hyphen-separated
task words (for example, `hr-worktree-shell` or `hr-worktree-run-detail`). Record each exact path
before work begins and choose an unoccupied name. Directory names are independent of the branch
suffixes below; prepend `feature/` to each suffix for the branch name.

| Group | Task | Branch suffix | Needs first | Integration order |
|---|---:|---|---|---:|
| Serial gate 0 | 8 | `phase-3-1-dashboard-c21194e18-r08-truth-reset` | 2.6 closed | 1 |
| Parallel wave 1 | 9-1 | `phase-3-1-dashboard-c21194e18-r09-1-shell` | Task 8 | 2 |
| Parallel wave 1 | 9-2 | `phase-3-1-dashboard-c21194e18-r09-2-settings` | Task 8 | 3 |
| Parallel wave 1 | 9-3 | `phase-3-1-dashboard-c21194e18-r09-3-storage` | Task 8 | 4 |
| Parallel wave 1 | 9-4 | `phase-3-1-dashboard-c21194e18-r09-4-explorer` | Task 8 | 5 |
| Parallel wave 2 | 10-1 | `phase-3-1-dashboard-c21194e18-r10-1-date-navigation` | Tasks 8, 9-1 | 6 |
| Parallel wave 2 | 10-2 | `phase-3-1-dashboard-c21194e18-r10-2-sessions` | Tasks 8, 9-2, 9-3 | 7 |
| Parallel wave 2 | 10-3 | `phase-3-1-dashboard-c21194e18-r10-3-notifications` | Task 8 | 8 |
| Parallel wave 2 | 10-4 | `phase-3-1-dashboard-c21194e18-r10-4-intake` | Task 8 | 9 |
| Parallel wave 3 | 11-1 | `phase-3-1-dashboard-c21194e18-r11-1-setup` | Tasks 9-2, 9-3, 10-2 | 10 |
| Parallel wave 3 | 11-2 | `phase-3-1-dashboard-c21194e18-r11-2-run-start` | Tasks 8, 10-2 | 11 |
| Parallel wave 3 | 11-3 | `phase-3-1-dashboard-c21194e18-r11-3-archive` | Task 8 | 12 |
| Parallel wave 4 | 12-1 | `phase-3-1-dashboard-c21194e18-r12-1-queue` | Task 11-2 | 13 |
| Parallel wave 4 | 12-2 | `phase-3-1-dashboard-c21194e18-r12-2-run-detail` | Task 11-2 | 14 |
| Parallel wave 4 | 12-3 | `phase-3-1-dashboard-c21194e18-r12-3-activity` | Task 11-3 | 15 |
| Parallel wave 4 | 12-4 | `phase-3-1-dashboard-c21194e18-r12-4-production-runtime` | Tasks 11-1, 9-3, 10-2 | 16 |
| Parallel wave 5 | 13-1 | `phase-3-1-dashboard-c21194e18-r13-1-context-data` | Tasks 12-1, 12-2 | 17 |
| Parallel wave 5 | 13-2 | `phase-3-1-dashboard-c21194e18-r13-2-logs` | Tasks 12-1, 12-2 | 18 |
| Parallel wave 5 | 13-3 | `phase-3-1-dashboard-c21194e18-r13-3-receipts-failures` | Tasks 12-1, 12-2 | 19 |
| Parallel wave 5 | 13-4 | `phase-3-1-dashboard-c21194e18-r13-4-gates` | Tasks 12-1, 12-2 | 20 |
| Serial gate 6 | 14 | `phase-3-1-dashboard-c21194e18-r14-review-people` | Tasks 12-2 and 13-1–13-4 | 21 |
| Serial gate 7 | 15 | `phase-3-1-dashboard-c21194e18-r15-realtime` | Waves 9–13 and Task 14 | 22 |
| Serial gate 8 | 16 | `phase-3-1-dashboard-c21194e18-r16-performance` | Task 15 | 23 |
| Serial gate 9 | 17 | `phase-3-1-dashboard-c21194e18-r17-proof-infrastructure` | Waves 9–13 and Tasks 14–16 | 24 |
| Serial gate 10 | 18 | `phase-3-1-dashboard-c21194e18-r18-acceptance` | Task 17 and every earlier row closed | 25 |

The branch name is fixed by this table. Record the short worktree path, base SHA, returned
task/host ids and state in the supervising session's working record. A supervisor's canonical run number is the Phase 3.1 task identity (`R08`,
`R09-1` through `R13-4`, then `R14` through `R18`), so the task, branch, worktree, report and cleanup ledger join without title or
recency guesses.

### What "done" means for this phase

A later migration's `Dashboard · wire` task may read `{#dash-defaults}` as met when all of these
hold. The original eight criteria are 7/8 met; demo fidelity remains open. The expanded ten-row exit
table is 10/10 met — row 10's two named LINES landed (V1 sweep, receipt wire) and its remaining structural residue is carried to Phase 4 by disposition (D279, 2026-08-27); until that ruling the row stayed open only on the ledgers' remaining structural residue: parallel runs is proved live (`docs/rebuild/migrations/separations.md` §9.27) and
observed logs met.

1. Every row of the wiring matrix (`ref frontend-backend-integration` §5) has an implementation and
   a test, and every surface landed as ONE vertical slice (see §Integration execution rule).
2. The generic surfaces answer for a workflow they were not written for — proved once, against a
   real composed run, with each claim paired to authority (Track C).
3. The reference corpus photographs the surfaces as corrected, and asserts rather than rewrites
   (D132).
4. The findings ledger is zero-or-decided: no record whose status is merely `recorded`
   (`docs/rebuild/findings/README.md`, B8).
5. Track D's D1–D5 and D11 have landed, so one fact has one derivation, the read scans are
   bounded, and the descriptor registry has left the browser bundle (D264 ratified D11 as planned;
   D6–D10 stay `proposed` and are outside this gate).
6. `ref frontend-backend-integration` §7.4's budgets carry MEASURED numbers, which then become the
   non-regression gate every later workflow is held to.
7. The Duo ceremony lease exists, so a second workflow's worker cold-starting beside the first
   cannot burn the shared credential's counter.
8. Every region of the dashboard is demo-exact or ruled — Track F's bar, above Track B's: Track B's
   definition of done was the findings ledger; demo fidelity is the stricter bar. D271–D276 ratify
   all 49 sheet answers and most of their ports have landed; two lines remain open at `8b7ec21e` —
   the cross-ledger vocabulary sweep and the receipt action entry's wire (§Demo fidelity — every
   detail, region by region).

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
| Mobile Capture Mode | **retired by D294**; its former phone and operator surfaces are deliberately absent | historical only; diagnostic screenshots, Receipt Capture tiles, and Archive evidence remain |
| Session panel + worker cards | built, WITH the D271 pool controls — plan / spawn / replacement spawn / stop, live-proved | `surfaces/shell.tsx` over the W3 supervisor's real spawn (`server/dashboard/compose.ts`); `docs/rebuild/migrations/separations.md` §9.27 |
| Settings + doctor/storage | built — bounded resolver-owned edit/readback, retained preflight rerun, and read-only doctor | `surfaces/settings.tsx` over the server-listed editable inventory; one revision/schema/patch-bound `settings`/`apply-settings` command applies only owned leaves, environment-owned leaves stay locked, and broader legacy settings remain in doc 04 `{#def-settings}` |
| Archive + version bump | built — frozen sections, five tabs, Export; frozen list/detail/bump facts drawn | `surfaces/archive.tsx`, `queries/archive.ts` (D223; `3d461962`, `d1f87916`) |
| Explorer | built: read-only graph plus closed presentation edit/review | `surfaces/explorer.tsx`, `queries/explorer.ts`, `client/queries.ts` (D227–D229, DCC4/5); only label/icon/category hot-apply after exact validate/command/readback |
| Activity | built, with the served CSV export | `surfaces/activity.tsx`, `queries/activity-export.ts` (D236/D239/D240) |
| Group People | the tab exists; the body says it is not served | `log-panel.tsx:1965` renders `UnservedTab`; unreachable today because nothing advertises the section |
| OCR Review | the tab exists; the body says it is not served | same; the projection lands with its admitted Phase 4 workflow |

**Demo fidelity per surface family, from the 2026-08-21 re-audit** (exact / elements, OPEN — the
three ledgers' own counts; the per-region table and every question are in §Demo fidelity below):
shell 132/178 (74 %), 10 OPEN · queue 118/196, 13 · run start 48/115 (42 %), 14 · run identity
23/49, 7 questions · log panel 48/114, 11 · Context rail 31/76, 9 · receipt 9/39, 12 · failure
record 7/34, 13 · park + ceremonies 6/36, 2 · archive 106/250, 61 marks · activity 57/117, 7 ·
explorer 55/182, 30 · UI catalog 0/69 (not the same surface as the demo's), 6 · Settings + doctor
2/72, 10 questions · intake 10/155, 57 marks · phone capture 1/62 (the demo's DESKTOP view has no
counterpart), 6 · version-bump dialog 3/53, 38 marks across three decision groups · DS primitives 119/159 (copied with
provenance; zero tokens missing), 18. "Built" in the table above and "exact" here are different
claims: every row above is served and drawn; 775 of 1,956 elements are drawn exactly as the demo
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

- [Task 1 · Build the shared dashboard surfaces](task-1-build-the-shared-dashboard-surfaces.md)

- [Task 2 · Prove the dashboard against a real run](task-2-prove-the-dashboard-against-a-real-run.md)

- [Task 3 · Harden shared status, commands, and read budgets](task-3-harden-shared-status-commands-and-read-budgets.md)

- [Task 4 · Close demo fidelity and parity](task-4-close-demo-fidelity-and-parity.md)

- [Task 5 · Serialize Duo login ceremonies](task-5-serialize-duo-login-ceremonies.md)

- [Task 6 · Manage worker pools and run sessions](task-6-manage-worker-pools-and-run-sessions.md)

- [Task 7 · Record observed page facts](task-7-record-observed-page-facts.md)

## Reopened completion tasks

**D339 release scope (2026-09-06).** Complete the admitted workflows' actual operator journeys.
Generic People/Review pages and new advanced storage-recovery interfaces are deferred unless a
current workflow requires them; Task 14 is not a Phase-3.1 completion dependency. Task 9-3 retains
basic health/status and access to the supported recovery commands. Task 8 names required and deferred
surfaces, and Tasks 15–18 accept that scope. Ref frontend-backend-integration §10 owns the exact rule.


**D340 desktop-only scope (operator-approved amendment, 2026-09-06).** The dashboard is for desktop
and laptop use; mobile layouts/navigation and touch-specific proof are outside release scope.
The operator subsequently moved mobile/coarse-pointer cleanup to immediate execution before 1.6.6.
This phase consumes that desktop-only baseline; it does not defer or repeat the cleanup. Desktop
resizing, smaller laptop windows, zoom and accessibility remain required. Ref frontend-backend-integration
§10 owns the exact retirement/replacement mapping and the fixed 1024×720 CSS-pixel canvas floor.
The queue stays beside detail; smaller browser windows scroll that canvas. Task 8 binds desktop/zoom
journeys to this floor; Tasks 9-1/17/18 implement and accept desktop journeys. No dedicated Task-8 execution plan is
approved by this scope amendment.

Task 8, parallel waves 9–13, and serial Tasks 14–18 begin only after 2.6 hands over stable authority
contracts and fixtures. They are ordered by operator journey; each task is one supervisor session
with its own red-capable gate. Task 18 is
an acceptance audit, not a place to absorb repairs.

- [Task 8 · Re-baseline dashboard truth and acceptance](task-8-re-baseline-dashboard-truth-and-acceptance.md)

- [Task 9-1 · Finish the shell, navigation, and accessibility baseline](task-9-1-finish-the-shell-navigation-and-accessibility-baseline.md)

- [Task 9-2 · Finish Settings over the canonical settings authority](task-9-2-finish-settings-over-the-canonical-settings-authority.md)

- [Task 9-3 · Finish basic storage health and recovery access](task-9-3-finish-basic-storage-health-and-recovery-access.md)

- [Task 9-4 · Finish Workflow Explorer and catalog editing](task-9-4-finish-workflow-explorer-and-catalog-editing.md)

- [Task 10-1 · Repair date navigation and the date picker](task-10-1-repair-date-navigation-and-the-date-picker.md)

- [Task 10-2 · Finish sessions, worker pools, and browser lifecycle](task-10-2-finish-sessions-worker-pools-and-browser-lifecycle.md)

- [Task 10-3 · Finish notifications and delivery behavior](task-10-3-finish-notifications-and-delivery-behavior.md)

- [Task 10-4 · Finish Intake surfaces](task-10-4-finish-intake-surfaces.md)

- [Task 11-1 · Finish Setup and preflight](task-11-1-finish-setup-and-preflight.md)

- [Task 11-2 · Make Run and Rerun enqueue real work](task-11-2-make-run-and-rerun-enqueue-real-work.md)

- [Task 11-3 · Finish Archive, versions, relaunch, and deletion](task-11-3-finish-archive-versions-relaunch-and-deletion.md)

- [Task 12-1 · Finish queue rows, commands, and deletion](task-12-1-finish-queue-rows-commands-and-deletion.md)

- [Task 12-2 · Finish run detail and the live timeline](task-12-2-finish-run-detail-and-the-live-timeline.md)

- [Task 12-3 · Finish Activity, search, and export](task-12-3-finish-activity-search-and-export.md)

- [Task 12-4 · Finish production startup, serving, and shutdown](task-12-4-finish-production-startup-serving-and-shutdown.md)

- [Task 13-1 · Finish Context, Data, Attempts, and provenance readback](task-13-1-finish-context-data-attempts-and-provenance-readback.md)

- [Task 13-2 · Finish logs, observations, and captures](task-13-2-finish-logs-observations-and-captures.md)

- [Task 13-3 · Finish receipts and failure records](task-13-3-finish-receipts-and-failure-records.md)

- [Task 13-4 · Finish gates and parked-write resolution](task-13-4-finish-gates-and-parked-write-resolution.md)

- [Task 14 · Generic Review and People pages — deferred until needed](task-14-generic-review-and-people-pages-deferred-until-needed.md)

- [Task 15 · Prove realtime convergence and reconnect](task-15-prove-realtime-convergence-and-reconnect.md)

- [Task 16 · Meet large-data and responsiveness budgets](task-16-meet-large-data-and-responsiveness-budgets.md)

- [Task 17 · Build the complete dashboard proof infrastructure](task-17-build-the-complete-dashboard-proof-infrastructure.md)

- [Task 18 · Execute integrated dashboard acceptance and close 3.1](task-18-execute-integrated-dashboard-acceptance-and-close-3-1.md)

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

Checked against `reference/decisions.md`'s `_phase: 3a_` markers on 2026-08-26. The ratification act
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
| 95 | 2026-08-26 | D271–D276 | **Phase 3a's 49 recommendations are ratified** — worker-pool process semantics plus shell/start, run-detail, standing-product, standing-convention and standing-copy requirements; resulting implementations/proofs remain open |

**Ratified elsewhere, load-bearing here.** Four rounds the ledger assigns to phase 3b are what
Track B and Track C were built on, and nothing about their phase is re-litigated by saying so:
**D226** (round 66) is B1's three ceremonies; **D245/D246** (round 77) are the parked-write surface's
way in and way out; **D260/D261** (rounds 84–85) are the start door Track C's §9.22 could not close
and §9.24 closed; **D262** (round 86) is the gate-park notification producer — the inbox's second
production producer and a dashboard default, which also filled the former `{#sep-dash}` wire square
now carried into `{#separations-compiled-acceptance}`.

**Platform-wide, not this phase's.** Rounds 46 (D191 the per-commit gate, D192 the advisory tools'
dispositions), 74 (D243/D244 the Duo signCount — the hazard `{#duo-lease}` exists to serialize), 75
(D247 the runtime's own name) and 88 (D263 the plan's machine-readable form) carry `_phase:
platform_` in the ledger. They are listed here only because no phase owns them.

## Exit criteria

07 recorded no exit block for the dashboard-defaults half of phase 3 — it predates Tracks B, C and
D. What binds instead is the checklist below, which is what a later migration's `Dashboard · wire`
task is entitled to assume. **Nine of ten hold at HEAD** (re-counted 2026-08-26 against `8b7ec21e`:
rows 1–9 MET, row 10 open). Row 1 is not rewritten by the fidelity
re-audit: Track B's definition of done was the findings ledger, and it met it; demo fidelity is the
stricter bar Track F carries (row 10).

| # | Criterion | State at HEAD | Evidence / what is left |
|---|---|---|---|
| 1 | **Track B met** — every generic surface built, each as one vertical slice | **MET** | B1–B8 landed 2026-08-19 → 20 (D222–D255); every surface verified present in the table above |
| 2 | **The findings ledger is zero-or-decided** | **MET** | `docs/rebuild/findings/README.md`, B8 sweep 2026-08-20 (five open records, each naming the commit that closes it), re-counted 2026-08-26 after Track F: **thirteen open, zero undecided** — Track F's audit reopened records the sweep never saw, and the units since closed four (two intake 2026-08-25, two capture by D274 item 7) and booked one new one. The criterion is "decided", not "empty" |
| 3 | **Track C met** — the real dashboard drove a real composed run, every claim paired to authority | **MET** | `docs/rebuild/migrations/separations.md` §9.22 items 1–8; three runs; four defects plus the archive unblock (D258), all fixed same-day; §9.24's live `sp-105225-1e0b` |
| 4 | **The reference corpus asserts over the corrected surfaces** | **MET** | `81287bb1` — 139 references re-frozen after Track C's fixes, 151 assert-mode cases green. Re-established after Track F's ports by the ONE deliberate re-freeze (`730c0b58`): 145 changed + 23 minted = **168 references, 168 attributed by name, 0 unattributed** (`9993ab39^:docs/plans/2026-08-26-p1-refreeze-attribution.md`), assert mode `218 passed` |
| 5 | **Track D's D1–D5 + D11 landed** — one fact, one derivation; the read scans bounded; the registry out of the browser bundle | **MET** | D1–D5 and D11 all landed and are test/guard held: D268's shared status fold; typed failure mapping; the one settlement fold; D4's splice + stable-prop `memo`; D5's bounded scans; D11's bundle-closure guard and 1,114,214 → 753,197-byte result. D6–D10 remain `proposed` outside this gate. |
| 6 | **`ref frontend-backend-integration` §7.4's budgets measured and recorded** | **MET** | the BEFORE instrument (`407d373f`) and both AFTER rows use the same seeded 1,240-row / 108-member fixture: D4 row patch 22.30 → 0.02 ms / parses 1 → 0; D5 day wire 6,718 → 5,568 statements, preview delta 216 → 6 and logs scope 4 → 2 partitions. |
| 7 | **The Duo ceremony lease landed** | **MET** | D267 authority/token/waiters/recovery/guard/docs landed (`bfc7d318`…`1c244a40`); the live two-worker cold start then serialized lease generations 3 → 4 with no overlap and zero waiter refusals (ref execution-and-sessions §10 §Live proof). |
| 8 | **Parallel runs proved** — the pool, the durable session record, two separations dry runs in parallel | **MET** | `docs/rebuild/migrations/separations.md` §9.27 (2026-08-26): pool planned, spawned and stopped from the Session Panel; docs 4502 and 4495 concurrently `running` for 29.7 s on `separations-worker-1`/`-2` under session `79476d81…`; the gate approved through the ceremony and resumed by the other member; ceremonies lease-serialized g1…g8; 0/0/0 write rows |
| 9 | **Observed logs landed** — the log quotes the recorded observations | **MET** | §9.25's real dashboard/composed separations dry run: document 4502, 13 observed rows (0..12), zero notes and 0 / 0 / 0 run-scoped write evidence. Its service-origin row proves a browser system is optional by declaration; `17468e60` changed the false API-500 invariant to a 200 response and the UI omits the absent claim. The node stays active for its notes emitter and fidelity extras. |
| 10 | **Demo fidelity: every region exact or ruled** — decisions ratified, every port landed, structural residue carried to Phase 4 | **MET by disposition (D279, 2026-08-27).** D294 later retires the phone-capture subset, including D278's intake-column implementation and the associated metadata/retake findings. | D271–D276 record all 49 A answers from the six 2026-08-25 sheets. The historical audit remains evidence; mobile Capture Mode is no longer a surface or future obligation. |

**Deliberately outside this phase, each with an owner.** The Review and People panel bodies (their
projections belong to their admitted Phase 4 workflow parts); editable settings, the explorer's
EDIT half, the production byte path for the built dashboard, and search / screenshots / export (doc 04's
`{#def-settings}`, `{#def-explorer-edit}`, `{#def-byte-path}`, `{#def-search-export}`). None is a
waiver: each names its trigger where its node lives.

**Above this phase.** The program-wide surface criteria in `05-cut-over.md` §Exit criteria — in
particular `ref frontend-backend-integration` §10's eleven items — must all pass before the cutover.
Criterion 6 above is the one this phase supplies to that list: §10 item 9's reference route matrix
and §7.4's thresholds are the same gate seen from two sides.
