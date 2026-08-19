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

| Category file | Scope | Records |
| --- | --- | --- |
| [dashboard-projection.md](dashboard-projection.md) | The BFF's span-fold/projection layer: anything where served surfaces disagree with the on-disk streams | 1 (diagnosed; `span.patched` has no production emitter — the detail channel is dead) |
| [workflow-taxonomy.md](workflow-taxonomy.md) | How workflows/compositions/chunks are modeled and presented (rail, picker, counts) | 1 (the workflow short code, moved in from archive.md 2026-08-19; the two original records resolved by D219/D220) |
| [run-commands.md](run-commands.md) | What an operator can DO to a run: retry/cancel/bump/hide, the gate ceremonies, the parked-write resolutions | 5 (diagnosed 2026-08-19; `resolve-write-present` points at a CLI path that does not exist, cancel strands a parked intent, `hide` has a CAS hole, `unhide` is dead across the stack, the bulk band's refusal copy is false. The gate's two records closed 2026-08-19 by D226) |
| [queue-rows.md](queue-rows.md) | Queue-row wire gaps: demo/doc-03 row elements the served wire cannot yet power | 8 (4 recorded wire gaps, 2 diagnosed served-but-undrawn, 1 UI-only rename control, 1 moved in from archive.md; liveMessage + warnings + actions[] + subject title/displayName landed 2026-08-14 and deleted) |
| [archive.md](archive.md) | Archive-surface wire gaps: demo archive/version-bump elements the `/api/v1/archive` wire cannot yet power | **0** — cleared 2026-08-19 by Track B5 (D223): six records landed, two moved to the category files that own them; the file keeps the disposition table |
| [explorer.md](explorer.md) | Workflow-Explorer wire gaps: demo explorer elements the `/api/v1/explorer` projection cannot yet power | **0 open** (5 dispositioned into doc 12 §5.7's exclusions/as-built; the field census, the `when`-in-words and the descriptor's prose landed 2026-08-19 as D227/D228/D229 and are deleted) |
| [activity.md](activity.md) | Activity-report wire gaps: demo report elements the `/api/v1/reports/activity` aggregate cannot yet power (people, hours saved, the write ledger) | 5 (all triaged decide-first/blocked/won't-fix; the cross-tab + Who sample landed 2026-08-15 and are deleted) |

This folder is NOT plan SSOT. Nothing here is a ratified decision (doc 04 rules apply).
