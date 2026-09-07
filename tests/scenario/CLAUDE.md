# `tests/scenario/` — the corpus map

The normative spec is `docs/rebuild/reference/guards-and-tests.md` §10 (R10). This file is the map:
what is in this directory, and which of the corpus's **three declared kinds** a new file must be.

`auditScenarioCorpusLayout` (`src/domain/workflow/scenario-execution.ts`, guarded by
`tests/unit/architecture/scenario-coverage.test.ts`) refuses any file here that is none of them, so
the choice below is enforced rather than conventional.

| Kind | Path | Claims a scenario id? | Carries a manifest row? |
| --- | --- | --- | --- |
| **Graph scenario** (T1a) | `<name>.scenario.test.ts`, or `workflows/<workflow-id>/structural.scenario.test.ts` | **must** — an `it("<scenario-id> — …")` per registered row | yes |
| **Dashboard scenario** (T2) | `dashboard/<feature>/<name>.scenario.test.ts` | **must not** | no |
| **Integration walk** | `<name>.walk.test.ts` | **must not** | no |

The T2 and walk kinds share one obligation for one reason: neither walks a graph, so a coverage
claim on either would count a path nobody executed as executed.

2026-09-02 — Every registered workflow owns exactly one collected T1a source at
`workflows/<workflow-id>/structural.scenario.test.ts`; `scenario-coverage` derives that mapping from
the workflow registry and refuses a split or flat workflow source. Flat graph scenarios remain only
for contract/capability evidence that belongs to no registered workflow. Structural fixtures use
synthetic subjects and may preserve a verified page/data shape, but they never claim that shape is
current live-world evidence; only the uncollected T1b manifest and its recorded run can do that.

2026-09-02 — Every collected offline scenario keeps EID-shaped fixture values in the reserved
synthetic range `10800000`–`10800099`; `19999999` is the sole invalid-EID sentinel. Names and
document numbers authored by the same fixtures must be visibly synthetic too. A collected scenario
may derive a declared operator label from the real registered descriptor, but it must not copy that
label into fixture input or treat it as external-world evidence. Real observed subject identifiers
belong only to private test-input storage and durable T1b run evidence, never collected source.
D341’s approved detour makes private test configuration the owner; do not restore the retired
environment source or place canaries in application Settings. See §10.5 for implementation status.

`workflows/<workflow-id>/dry-run.scenario.ts` (T1b) is deliberately **not** `.test.` — a checkpoint
manifest vitest collected would start a browser inside the per-commit gate.

D309's Separations supplied-EID cases list the conditional `identity-approval` gate in
`nodesExcluded`, carry no `gateResults`, and expect its receipt obligation `absent`/non-mandatory;
`approval` still checkpoints the machine-verification subject. Name-resolved coverage must exercise
the real park/command/resume chain. A manifest must never invent an operator result for the skipped
arm or use a name-search EID to qualify itself as supplied.

D310's Separations composition keeps the sweep before filing and inserts one always-rerun UCPath
filing-presence read between the durable filing receipt and Kuali finalization. Exact-set scenarios
must derive the v2 sweep key from the complete eligible/protected transaction set; a pre-D310
person-only intent is immutable history and must cause a pre-browser refusal. A finalization test
that deletes the fake filing after the identity gate must fail at `filing-presence` with zero Kuali
stage, fence, click or durable write rows; it must not re-file as repair.

## `dashboard/` — the T2 tier

A T2 file drives a dashboard feature through the **real** run/queue projection and the **real**
command service over a **real** authority database, with no browser and no React. It is the seam
`tests/unit/dashboard/` structurally cannot reach: the surfaces' pure halves are already covered
there, and what a feature scenario adds is a command's effect on authority, a projection's response
to a transition, and a refusal arm reaching the surface. §10.12's checklist is the authority; two of
its items are load-bearing enough to repeat — **both `CommandResult` refusal arms** (`rejected` AND
the CAS `conflict`) must be exercised (D253), and a feature that changes what an operator does to a
RUN needs a T3 pair as well, not just a T2.

- `dashboard/separations/` — the first feature (2026-08-27). `world.ts` is its shared composition:
  `src/server/dashboard/compose.ts` minus the clock, the id factory and the process edges (worker
  supervisor, write sequencer, intake parser), each of those wired to **throw** rather than no-op.
  Three files split by what they observe — the start/queue/timeline composition
  (`run-projection`), the gate chain and both refusal arms (`identity-gate`), and the parked-gate
  notification composition (`needs-you`). Pure Explorer declarations and write-ledger folds stay
  with their unit owners.

## Fixtures a scenario may import

`tests/fixtures/` is shared fixture DATA for any tier. Existing cross-tier imports from
`tests/unit/fixtures/` are migrated by the approved D341 detour to shared ownership; consult §10.5
for acceptance status. New shared data uses that common home/interface. Test-specific assertions,
behavioral helpers and architecture violation fixtures remain at their owner. Offline scenarios
never require private test configuration; file paths are named inputs, not developer-machine paths.
