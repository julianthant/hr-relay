# Frontend/backend findings ledger (non-normative)

Session-recorded mismatches between the dashboard frontend, the served wire, and the plan
docs — kept here so a FUTURE session can triage each into its owning doc (`docs/rebuild/*`)
and design the fix. Standing operator rules recorded 2026-08-14:

- **Backend problems are diagnosed and recorded here, never fixed in a frontend session**
  (exception: generic, already-planned dashboard infrastructure the operator green-lights).
- **A frontend feature not listed in the plans is not built** — it gets a record here instead.
- Every record names the symptom, the evidence, the mechanism (when diagnosed), and what a
  fix would involve, so the next session starts from the diagnosis, not from scratch.

## Organization — one file per CATEGORY, dispatched as a unit

Each markdown groups every record of one kind, so one agent can be dispatched per file.
Do NOT create one file per finding and do NOT mix kinds in one file. Add new records as
`## <short title>` sections inside the right category file (create a new category file only
when no existing one fits), each stamped with a date and a `**Status:**` line
(`recorded` → `diagnosed` → `triaged` → delete when landed in the owning doc).

**Swept to zero-or-decided, 2026-08-20 (B8).** Every record in every file below now carries a DATED
decision: landed, closed by a named decision, won't-fix with its argument, or open against a named
producer-trigger. A record whose status is merely `recorded` is the state this sweep exists to
remove — an open item nobody can act on and nobody is waiting on. Each of the six remaining open
records at that sweep named the exact commit that would close it, and each was re-verified against
HEAD on 2026-08-20 rather than carried forward on its own say-so.

**Reopened, 2026-08-21 (Track F).** The 03a fidelity audit (ledger 3) found real gaps three files
had reported as zero-open: `explorer.md` had three, and 22 intake + 5 capture gaps had never been
booked anywhere at all — two category files (`intake.md`, `capture.md`) did not exist. All were
verified against HEAD and booked below in the same `open` / named-producer-trigger shape B8
established; none were fixed in this docs pass, per the standing rule above.

| Category file | Scope | Records |
| --- | --- | --- |
| [dashboard-projection.md](dashboard-projection.md) | The BFF's span-fold/projection layer: anything where served surfaces disagree with the on-disk streams | **0 open** — both records decided 2026-08-20: the dead `span.patched` detail channel is RETIRED by **D254** (operator ruling: remove, do not build the emitter), and the duplicate task-span entry is FIXED at the fold by **D255** (a close binds to a still-OPEN entry; the first-match rule fabricated a duration spanning two executions). D255's one deferred half — the write sequencer's beat spans carry no execution identity — names its trigger and the shape of its repair |
| [run-commands.md](run-commands.md) | What an operator can DO to a run: retry/cancel/bump/rename, the gate ceremonies, the parked-write resolutions | **0 open** — all closed with their decisions: the gate's two records by D226; the presentation CAS hole by D233; the dead `unhide` verb and `executeBump`'s CAS hole by D234; the bulk band's false refusal copy by D235 (the bulk strip and result vector are built); the parked write's present arm by D245 (the proof contract is served and the form is typed); cancel-over-an-unresolved-fence by D246 (cancel refuses, naming the intent). The file keeps the disposition records |
| [queue-rows.md](queue-rows.md) | Queue-row wire gaps: demo/ref dashboard-surfaces row elements the served wire cannot yet power | 5 records, **4 open against a named producer-trigger, 1 won't-fix** — every claim re-verified at HEAD 2026-08-20 (each of `reviewRunId`, `extractedCount`, `preset`, `memberEid`, `groupNoun`, `rejectedCount` appears in `src/` zero times, or once in a comment explaining its absence). `subtitle` was dispositioned 2026-08-20 as won't-fix-as-stated: D109 retains it as operator-AUTHORED text, so re-purposing the slot would discard somebody's edit; the identifier half it wanted is tracked by the member-identity record's `identifierProjection` trigger. The `QueueBaseFields` batch was served 2026-08-19 (D230/D231) and DRAWN the same day (D232/D233) |
| [archive.md](archive.md) | Archive-surface wire gaps: demo archive/version-bump elements the `/api/v1/archive` wire cannot yet power | **0** — cleared 2026-08-19 by Track B5 (D223): six records landed, two moved to the category files that own them; the file keeps the disposition table |
| [explorer.md](explorer.md) | Workflow-Explorer wire gaps: demo explorer elements the `/api/v1/explorer` projection cannot yet power | **3 open, reopened 2026-08-21** — the 2026-08-19 "0 open" state was real for the five records swept then (D227/D228/D229 and ref operator-trust §5.7's exclusions), but ledger 3's live re-audit found three the sweep never saw: no per-node `skippedInDryRun`, no per-field `when`, and no minor/presentation version anywhere in the tree |
| [activity.md](activity.md) | Activity-report wire gaps: demo report elements the `/api/v1/reports/activity` aggregate cannot yet power (distinct people) plus the settled ones kept for their arguments | 5 records, **1 open against an exact trigger, 1 won't-fix, 3 closed** — verified 2026-08-20, no tightening owed. Distinct people is blocked on the commit that puts subject identity on queue rows AND on members; the span chips are won't-fix on D180's own argument. Closed 2026-08-19 by operator ruling: the write ledger under D236's carve-out, the hours-saved tile dropped by D239, the CSV export built by D240 |
| [intake.md](intake.md) | Intake-surface wire/UI gaps: demo intake elements (`DemoIntake.tsx`) with no rebuild counterpart | 3 records, **1 open** — the Manifest/Rerun-diff STAGES (10 ledger rows) and the terminal wire fields they need (11 ledger rows) were both RESOLVED 2026-08-25 and carry their resolutions in the file; the Run-verb wording (1 row, presentation only) stays open — D274/D276 ratified the verb and its implementation has not landed |
| [capture.md](capture.md) | Phone-capture wire/UI gaps: the demo's OPERATOR-side desktop view (`DemoCapture.tsx`) | 6 records, **4 open** — verified at HEAD 2026-08-26 against the D274 item 7 units (F12 the producer, F13 the desktop surface). CLOSED: the session LIST (`GET /api/v1/capture/sessions` + the picker that consumes it) and the single-session READ (the operator projection plus `useCaptureSession` → `surfaces/capture-session.tsx`). Half-closed with their open halves NAMED: the unreadable signal is served per page and `focusScore` has no producer; pixel dimensions are served and filename + arrival instant are deliberately absent, not optional (D276). Still open: `replacePhoto` has a server route and no client method; and NEW 2026-08-26 (unit F13) the intake column gives its whole height to the `Dropzone`, so a live capture panel opens roughly half below the fold — a ruling on the column, not a missing fact |

**The ledger's standing shape after Track F: thirteen open records across five files, zero
undecided ones** (re-counted 2026-08-26 against the phase-3a final integration line `8b7ec21e`;
it was sixteen at the 2026-08-21 reopening). Four queue-row producer gaps, one activity producer
gap, three explorer gaps, one intake gap and four capture gaps, plus one deferred HALF of a closed
record (D255's beat-span identity) — each blocked on a commit somebody will write, none on a
question somebody must answer. Three records left the open count and each says so in its own file:
two intake records resolved 2026-08-25, and two capture records closed 2026-08-26 by D274 item 7 —
against which one NEW capture record was booked by the unit that closed them (the intake column's
dropzone height), which is the shape this ledger is for.

This folder is NOT plan SSOT. Nothing here is a ratified decision (ref decisions rules apply).
