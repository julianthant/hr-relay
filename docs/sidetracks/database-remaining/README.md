# Remaining database tables — planning discussion

## Scope and working agreement

On 2026-09-08 the operator asked to continue the existing table-by-table design discussion in the
current task and collect all resulting changes in one folder, like `database-parallel`. No separate
planning task or implementation worktree is needed. This folder is the single owner for the new batch.
The [earlier database batch](../database-parallel/README.md) remains unchanged.

This is a planning worklist, not an approved execution plan. Explain concrete workflows, propose
names/designs, obtain the operator's decisions and record the approved changes here. Do not infer
that every table needs a rename, consolidate tables solely to reduce their count, or implement an
undecided design. Use clear vocabulary consistent with the decisions already made in the earlier batch.

## Remaining discussion

| Group | Current tables / relationship | Decision |
| --- | --- | --- |
| Approvals | `gates`, `ocr_approvals` | Open |
| Settings and version changes | `settings_current`, `runtime_config`, `version_plans`, `version_bump_applications` | Open |
| Relaunch and deletion | `archive_relaunches`, `deleted_runs` | Open |
| Messages and notes | `notifications`, `notes` | Open |
| Testing and activity privacy | `dry_run_scenario_results`, `activity_person_pseudonyms`, `activity_person_pseudonym_generations` | Open |
| Database maintenance | `authority_meta`, `authority_upgrades` | Open |
| Run/operation relationships | Historical `run_operation_attempts` links to `workflow_runs` across retry, re-fencing, archive and deletion | Open; use the [existing deferred finding](../operation-names/README.md#inspected-feasibility-and-separate-relationship-finding) |

For each group, explain which action creates or updates a row, its readers and linked rows, a
concrete example, and whether it is durable evidence, current state or a rebuildable read model.
Distinguish implemented behavior from reserved storage and planned functionality.

## Agreed execution cadence for this future batch

The operator explicitly requested reviews last, focused tests during parallel implementation, and
heavy tests plus remaining fixes in one new final session. Carry this scoped exception into the
approved execution briefs and the owning gate/governance references when those briefs are admitted:

1. Finish shared prerequisites first, with real working interfaces and meaningful focused proof.
2. Parallel tasks implement their complete scopes, fix discovered in-scope issues, run focused tests,
   lint and affected freshness checks, then return exact committed candidates. No peer reviews or
   repeated full coverage/parity runs at this stage.
3. A new final-validation session combines the candidates, owns all remaining repairs, runs the
   complete required heavy gates, and obtains fresh independent read-only review. It fixes findings
   and reruns affected checks there; no repair handbacks to completed peers or idle observer loops.
4. Master integration and final completion require passing full gates and independent review.
   A focused-tested prerequisite/peer commit is a development candidate, not final acceptance.

Keep Astra/high, strict proof/coverage/assertion requirements, isolated implementation branches,
one final integration/repair owner and evidenced test-resource allocation. Determine the actual
parallel split after examining shared schemas, callers, fixtures and the earlier batch's ownership.
Do not claim that independent planning means independent implementation. Preserve already running
assignments and the earlier batch's admitted schedule; create no additional task in this discussion.

After product decisions are approved, keep the complete prerequisite, peer, final-validation plans
and exact prompts together in this folder. No executable launch prompt is ready yet.

## Initial inspection: approvals

Read-only source inspection at master `cd47a750e4157f42fb1ca7268f1c19bbb4574006` found:

- `gates` is registered as a projection table. The real operator gate-result record is stored by
  `authority.gateResults` in `checkpoint_payloads`, not in the physical `gates` table.
- The gate command records run/gate/command identity, actor/time, expected version and the typed
  result, then transitions the run back to queued. The executor reads that durable result to resume.
- `ocr_approvals` exists as an opaque repository/table. Source search found no application writer
  outside the storage layer; the dashboard contract explicitly describes its intended machinery as
  unimplemented. Do not describe that planned OCR approval system as current runtime behavior.

Evidence: `src/domain/gates.ts`, `src/core/command-kernel.ts`,
`src/infra/sqlite/authority-database.ts`, and
[dashboard approval durability](../../rebuild/reference/dashboard-surfaces.md#44-durability-the-approval-manifest-is-part-of-the-contracts-execution-ported-as-is).
Recheck after the timeline work lands before choosing retirement or migration behavior. No rename,
removal or replacement has been approved for this group. No code tests or database writes ran.
