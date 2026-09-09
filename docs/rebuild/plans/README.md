# Rebuild phase plans

This folder mirrors the roadmap: one folder per Phase 0–6, one folder per subphase, and a
`README.md` overview at each level. The [roadmap](../../roadmap/roadmap.md) owns sequencing;
these folders own execution plans, tasks, evidence and exit criteria. Requirements remain in
[`reference/`](../reference/); workflow migration records remain in [`migrations/`](../migrations/).

## Find or write a plan

For `/phase-plan`, follow the assigned roadmap node's `doc:` binding. Read the subphase overview
for shared scope, dependencies, decisions and gates, then the owning task file when one exists.
Persist the complete approved assignment and its evidence at that one owner. Do not duplicate
an assignment in both the overview and a task file or create a separate competing plan.

Every subphase has a folder named `<roadmap-label>-<descriptive-slug>/`. Small subphases keep their
whole plan in `README.md`. Split a large subphase at existing task boundaries into
`task-<number>-<descriptive-slug>.md`; retain parallel labels such as `task-2-1-…`. Existing unnumbered
work or supporting evidence may use descriptive topic filenames without inventing task numbers.
The overview links the extracted files and retains shared context and exit criteria. Split by
coherent responsibility, not a fixed line count. Section references in split plans may name a
sibling file; use the overview's links and roadmap binding to find the owner.

```text
phase-1/
├── README.md
├── 1.1-guardrails-and-strict-domain/
│   └── README.md
└── 1.6-implement-canonical-run-and-settings-authorities/
    ├── README.md
    ├── task-1-land-the-schema-floor.md
    ├── task-2-1-implement-the-canonical-run-record-service.md
    └── …
```

A bare phase binding such as `doc: 1` names the phase overview. `doc: 1.6` names the subphase
README; `doc: 1.6/task-1-land-the-schema-floor` names its task file. A `§` heading selector still
names a section inside that exact file. After extraction, update affected bindings and links,
keep every roadmap tag/status block and journal at its original content owner, and regenerate
the roadmap. New subphases require roadmap admission; Phase 4's verification and approval boundary
is unchanged. Node IDs, task labels, recorded statuses and append-only evidence survive moves.

| Phase | Subphases |
| --- | --- |
| [Phase 0](phase-0/README.md) | 0.1–0.3 |
| [Phase 1](phase-1/README.md) | 1.1–1.6 |
| [Phase 2](phase-2/README.md) | 2.1–2.6 |
| [Phase 3](phase-3/README.md) | 3.1–3.5 |
| [Phase 4](phase-4/README.md) | 4.1 Background Check |
| [Phase 5](phase-5/README.md) | 5A–5B |
| [Phase 6](phase-6/README.md) | 6A–6F |

## Earlier paths

The flat phase files were split on 2026-09-06. Frozen history, source comments, pinned commit/path
citations and append-only evidence retain their original text. Resolve those earlier paths through
this table, then find the named section within that phase's subphase folders. When inspecting a pinned
commit, use the path as it existed at that commit.

| Former file under `docs/rebuild/` | Current home |
| --- | --- |
| `00-design-the-foundation.md` | [phase-0](phase-0) |
| `01-build-the-spine.md` | [phase-1](phase-1) |
| `02-prove-writes-build-the-tails.md` | [phase-2](phase-2) |
| `03.2-finish-workflow-authoring.md` | [phase-3/3.2-finish-workflow-authoring/](phase-3/3.2-finish-workflow-authoring/README.md) |
| `03.1-finish-the-dashboard.md` | [phase-3/3.1-finish-the-dashboard/](phase-3/3.1-finish-the-dashboard/README.md) |
| `03.4-co-operate-with-claude.md` | [phase-3/3.5-co-operate-with-claude/](phase-3/3.5-co-operate-with-claude/README.md) |
| `03.3-accept-person-lookup-and-separations.md` | [phase-3/3.3-accept-person-lookup-and-separations/](phase-3/3.3-accept-person-lookup-and-separations/README.md) |
| `04-close-the-deferrals.md` | [phase-5/5A-close-cutover-readiness-gaps/](phase-5/5A-close-cutover-readiness-gaps/README.md) |
| `05-cut-over.md` | [phase-5/5B-switch-production-authority/](phase-5/5B-switch-production-authority/README.md) |
| `06-ship-the-desktop-app.md` | [phase-6](phase-6) |

`04-close-the-deferrals.md` now belongs to 5A; its controlled-desktop-updates section belongs to [6A](phase-6/6A-controlled-desktop-updates/README.md).

The intermediate `plans/phase-N/<subphase>.md` paths now resolve to
`plans/phase-N/<subphase>/README.md`. For an extracted section, follow the overview link to its
task/topic file. This mapping also applies to frozen and commit-pinned text; inspect a pinned
commit using its original path.

D342 (2026-09-07) moves `phase-3/3.4-co-operate-with-claude/README.md` to
`phase-3/3.5-co-operate-with-claude/README.md`; historical 03.4 cooperation citations resolve there.
Phase 3.4 now owns optional document tools, with distinct node IDs.

## Parallel prerequisite tasks and finalization children (D344)

`3.P.N` names an actual standalone task or prerequisite; `3.P.N.1`, `3.P.N.2`, etc. name
independent parallel children unlocked by the completed parent. Each Phase 3 and future parallel
group places a sequential **Finalization** node as the last numbered child of its prerequisite: focused worker tests and quick checks, then
full gates and repairs on the combined result under
[D344](../../roadmap/roadmap.md#parallel-finalizer-cadence). Sequential consumers get separate
numbers and require accepted finalizer output. The [3.1 identity map](phase-3/3.1-finish-the-dashboard/README.md#current-task-identities)
and [3.2 plan](phase-3/3.2-finish-workflow-authoring/README.md) own current assignments.
Existing execution files and stable anchors remain citation targets. Former organizational group
files redirect to the 3.1 map; they no longer create non-executable roadmap tasks.

New parallel plans use the [parent/child shape](../../roadmap/roadmap.md#parallel-group-shape-for-future-plans-2026-09-09):
`P.N` prerequisite → independent `P.N.1`, `P.N.2`, … → last child `P.N.K · Finalization`.
The last child requires every worker; implementation workers never depend on one another. Next
prerequisites require that finalization release. Preserve already admitted/in-flight identities;
apply the exact gate cadence in the owning plan, including the database batch's final-test exception.
