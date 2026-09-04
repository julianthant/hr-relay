# Board — Phases 0–3 platform authority reset

**Project profile:** `docs/coordinator/platform-authority-reset-cd8c37470/project-profile.md`
**Coordination UUID:** `d8c37470-550f-4093-80dd-139763304d77`
**Work key:** `platform-authority-reset`
**Coordinator title:** `Coordinate · platform-authority-reset · Cd8c37470 · phases 0–3`
**Coordinator task/host:** `01a06ade-e8da-7f91-9e45-bf1fcc12175a` / `local`
**Coordinator checkout:** `/Users/julianhein/Projects/hr-automation-rebuild` · `master`
**Integration target:** `master`
**Board owner:** coordinator; supervisors/workers read only
**Last verified:** 2026-09-03 before the planning commit

## Facts every run needs

- The uniform hierarchy is `Phase → decimal part → numbered supervisor task → checklist subtask`.
- Historical evidence remains valid for 0.1–0.2, 1.1–1.5, and 2.1–2.5.
- Strict order: **0.3 → 1.6 → 2.6 → 3.1 → 3.2 → 3.3 → 3.4**.
- 0.3 is design-only. It must close the run authority, settings catalog/root, migration/recovery,
  and implementation-brief contracts before runtime code changes.
- D327 fixes the outcomes while 0.3 finishes their exact design: one SQLite-backed run lifecycle
  service; one settings catalog and protected `.tracker/settings/` root; provider API keys alone in
  `.env`; derived host facts remain defaults; D308/D321/D322/D324 are explicitly reconciled.
- Current runtime phase output remains historical until implementation changes it deliberately.
- Gates and prohibitions: project profile.

## Decisions ratified

- 2026-09-03 · D326 → one decimal hierarchy across Phases 0–3; no A/B/C/D part grammar.
- 2026-09-03 · D327 → one run lifecycle source of truth and one settings catalog/root.
- 2026-09-03 · operator → finish every generic dashboard journey in reopened 3.1 before resuming
  workflow-specific execution.
- 2026-09-03 · operator → revisit design/foundation first and continue in a fresh session.

## Unit ledger — Phase 0.3

| Unit | Run | Status | Integration evidence | Gate evidence | Review | Notes |
|---|---|---|---|---|---|---|
| U01 | R01 | planned | — | — | domain/authority | Task 1: exact canonical run-record contract |
| U02 | R02 | planned | — | — | security/config | Task 2: exact settings/source catalog contract |
| U03 | R03 | planned | — | — | migration/recovery | Task 3: upgrade, recovery, compatibility deletion |
| U04 | R04 | planned | — | — | consequential | Task 4: adversarial design close and 1.6 briefs |

## Residue

- 1.6 implementation tasks, 2.6 downstream revalidation, and 3.1 Tasks 8–32 are fully placed but
  must consume 0.3's exact contracts rather than redesigning them.
- No runtime implementation was performed in the roadmap-planning session.

## Questions for the operator

- None. The next executable boundary is **Phase 0.3 Task 1**; Task 2 may run concurrently only after
  the coordinator records non-overlapping authorities and integration order.
