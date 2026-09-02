# R4b — dates checkpoint provenance repair

Date: 2026-09-02. No date gate. Base: current `feature/03b-live-close` after R4a merge `fcfd1e5f` plus coordinator admission commit.
Repository `/Users/julianhein/Projects/hr-automation-rebuild`. Board `docs/coordinator/separations-completion/board.md` is READ ONLY.
Report: `docs/coordinator/separations-completion/reports/r4b-dates-provenance-repair.md`. Evidence: `docs/coordinator/separations-completion/evidence/r4b/`.

## u19 — reproduce and repair missing dates provenance

Use `/debug --fast` only after the deterministic red test proves the direct cause; otherwise use the full ranked-hypothesis loop. The immutable live evidence is run `05d9d8fa-22e0-4b5c-9e38-2df095162284`, trace `sp-122836-05d9`, attempt 3, failure `3a7959e9-c230-44ae-8c8c-0cd3e5d32278`, fingerprint `d0e11f1e85783ee4067addac7c971b8963a145dbffaac248b535bcccf0591644`, write state `not-attempted`, exact summary:

```text
[workflow:separations/read-separation-dates] unhandled: task workflow:separations/read-separation-dates has no recorded provenance for output field source
```

The static omission of `source` from `readSeparationDatesTask`'s `ctx.recordData` list is a direct-cause candidate, not permission to skip the gate.

1. Build and run one fast deterministic test at the real task/executor provenance seam that fails with the exact missing-`source` symptom on admitted source. Show it red before modifying production code.
2. Apply the smallest root fix that makes the red gate green. Do not add a fallback, weaken provenance validation, swallow the error, edit/delete/reinsert any checkpoint/runtime row, or alter replay identity.
3. Prove the new test fails when the fix is removed and passes when restored. Re-run the original unminimized composition seam. Remove every `[DEBUG-xxxx]` probe and temporary harness.
4. Scope starts at `src/stores/separations/tasks/read-separation-dates.ts` and the closest real unit/scenario test. Touch `src/core/run-executor.ts`, `src/core/task-provenance.ts`, replay policy, or schemas only if the red loop disproves the narrow cause. Update the nearest `AGENTS.md`/`CLAUDE.md` twin and dated module lesson if behavior/invariants change.
5. Because this task is in the separations descriptor closure, regenerate/check the build manifest. Run focused tests, `npm run typecheck`, `npm run lint`, `npm run test:coverage`, `npm run build:manifest:check`, `npm run roadmap:check`, `git diff --check`, and `npm run test:parity`. Any deliberate parity refresh must use `npm run test:parity:update`, be audited, and be followed by a green assertion run.
6. Require an independent `sup_terra` correctness + silent-failure review of the exact diff and regression proof. Commit logical code/test/docs/generated categories with explicit paths; clean worker worktrees.

No live browser run, retry, gate decision, HR write, runtime-row mutation, board write, master merge, or push is authorized. R4c, under a different fresh supervisor after coordinator integration, owns the live 4502 retry and target packet. Stop with the exact report, commits, gates, review, and clean branch; no handoff on coherent completion.
