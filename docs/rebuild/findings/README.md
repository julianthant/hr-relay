# Findings

Non-normative diagnoses, proposals, and disposition records. Scheduled work belongs to the
[roadmap](../../roadmap/roadmap.md) and its phase documents; requirements belong to the
[owning contracts](../../roadmap/roadmap.md#d1-ownership-map--the-quick-index-concept--owning-doc).
Nothing in this folder authorizes implementation or ratifies a decision.

## Categories

| File | Scope |
| --- | --- |
| [dashboard-projection.md](dashboard-projection.md) | Span folding and differences between served surfaces and stored streams |
| [run-commands.md](run-commands.md) | Run actions, gates, command refusals, and parked-write resolution |
| [queue-rows.md](queue-rows.md) | Queue fields and their producing services |
| [archive.md](archive.md) | Archive-surface gaps and their dispositions |
| [explorer.md](explorer.md) | Workflow Explorer fields and projections |
| [activity.md](activity.md) | Activity aggregates, reporting identity, and exports |
| [intake.md](intake.md) | Intake stages, wire fields, and presentation |
| [capture.md](capture.md) | Retired phone-capture provenance; see its D294 disposition |
| [workflow-taxonomy.md](workflow-taxonomy.md) | Workflow, composition, and harness identity and presentation |
| [agent-skills.md](agent-skills.md) | Dated external-source research and personal skill recommendations |

Read the dated status in each record and verify it against the current owner and code before
acting. This index does not maintain another open-count or completion summary. The previous
[B8/Track F sweep index](../history/superseded/2026-08-31-findings-sweep-index.md) preserves its
2026-08-20 through 2026-08-31 chronology and counts as historical evidence.

## Recording and triage

Keep one file per category. Add a dated `## <short title>` record to the matching file, with a
`**Status:**` line, symptom, evidence, diagnosed mechanism when known, and what a fix would involve.
Create a category only when no existing one fits; do not create one file per finding or mix
unrelated kinds. The status progression is `recorded` → `diagnosed` → `triaged`; remove a record
when it lands in the owner, preserving any unique rationale or evidence at that owner. Existing
closed disposition records remain useful where they explain a decision or a deferred part.

The standing frontend-session boundaries recorded 2026-08-14 still apply: diagnose and record
backend problems here rather than fixing them during a frontend session, except for generic,
already-planned dashboard infrastructure the operator approves. Record frontend features absent
from the plan here before implementation. These category files do not authorize agent dispatch.

Triage names the owning phase or contract and the exact producer or condition needed for closure.
Ratified changes follow the [decision pointer index](../reference/decisions.md) and land their
normative text in the owner. Recommendations in research records remain recommendations until
accepted through the applicable workflow.
