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
records names the exact commit that would close it, and each was re-verified against HEAD on
2026-08-20 rather than carried forward on its own say-so.

| Category file | Scope | Records |
| --- | --- | --- |
| [dashboard-projection.md](dashboard-projection.md) | The BFF's span-fold/projection layer: anything where served surfaces disagree with the on-disk streams | **0 open** — both records decided 2026-08-20: the dead `span.patched` detail channel is RETIRED by **D254** (operator ruling: remove, do not build the emitter), and the duplicate task-span entry is FIXED at the fold by **D255** (a close binds to a still-OPEN entry; the first-match rule fabricated a duration spanning two executions). D255's one deferred half — the write sequencer's beat spans carry no execution identity — names its trigger and the shape of its repair |
| [run-commands.md](run-commands.md) | What an operator can DO to a run: retry/cancel/bump/rename, the gate ceremonies, the parked-write resolutions | **0 open** — all closed with their decisions: the gate's two records by D226; the presentation CAS hole by D233; the dead `unhide` verb and `executeBump`'s CAS hole by D234; the bulk band's false refusal copy by D235 (the bulk strip and result vector are built); the parked write's present arm by D245 (the proof contract is served and the form is typed); cancel-over-an-unresolved-fence by D246 (cancel refuses, naming the intent). The file keeps the disposition records |
| [queue-rows.md](queue-rows.md) | Queue-row wire gaps: demo/ref dashboard-surfaces row elements the served wire cannot yet power | 5 records, **4 open against a named producer-trigger, 1 won't-fix** — every claim re-verified at HEAD 2026-08-20 (each of `reviewRunId`, `extractedCount`, `preset`, `memberEid`, `groupNoun`, `rejectedCount` appears in `src/` zero times, or once in a comment explaining its absence). `subtitle` was dispositioned 2026-08-20 as won't-fix-as-stated: D109 retains it as operator-AUTHORED text, so re-purposing the slot would discard somebody's edit; the identifier half it wanted is tracked by the member-identity record's `identifierProjection` trigger. The `QueueBaseFields` batch was served 2026-08-19 (D230/D231) and DRAWN the same day (D232/D233) |
| [archive.md](archive.md) | Archive-surface wire gaps: demo archive/version-bump elements the `/api/v1/archive` wire cannot yet power | **0** — cleared 2026-08-19 by Track B5 (D223): six records landed, two moved to the category files that own them; the file keeps the disposition table |
| [explorer.md](explorer.md) | Workflow-Explorer wire gaps: demo explorer elements the `/api/v1/explorer` projection cannot yet power | **0 open** (5 dispositioned into ref operator-trust §5.7's exclusions/as-built; the field census, the `when`-in-words and the descriptor's prose landed 2026-08-19 as D227/D228/D229 and are deleted) |
| [activity.md](activity.md) | Activity-report wire gaps: demo report elements the `/api/v1/reports/activity` aggregate cannot yet power (distinct people) plus the settled ones kept for their arguments | 5 records, **1 open against an exact trigger, 1 won't-fix, 3 closed** — verified 2026-08-20, no tightening owed. Distinct people is blocked on the commit that puts subject identity on queue rows AND on members; the span chips are won't-fix on D180's own argument. Closed 2026-08-19 by operator ruling: the write ledger under D236's carve-out, the hours-saved tile dropped by D239, the CSV export built by D240 |

**The ledger's standing shape, after the sweep: five open records across two files, zero undecided
ones.** Four queue-row producer gaps and one activity producer gap, plus one deferred HALF of a
closed record (D255's beat-span identity) — each blocked on a commit somebody will write, none on a
question somebody must answer.

This folder is NOT plan SSOT. Nothing here is a ratified decision (ref decisions rules apply).
