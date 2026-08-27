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

`workflows/<workflow-id>/dry-run.scenario.ts` (T1b) is deliberately **not** `.test.` — a checkpoint
manifest vitest collected would start a browser inside the per-commit gate.

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
  Three files split by what they observe — the descriptor's declaration squares
  (`wired-surfaces`), the gate chain and both refusal arms (`identity-gate`), and the two squares
  outside the descriptor (`needs-you-and-ledger`).

## Fixtures a scenario may import

`tests/fixtures/` is shared fixture DATA for any tier. Importing from `tests/unit/fixtures/` is
established practice here (`operator-lifecycle.walk.test.ts` does it) — those are contract fixtures,
not unit assertions.
