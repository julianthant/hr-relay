# Project profile — separations completion

Repository: `/Users/julianhein/Projects/hr-automation-rebuild`.
Workspace: `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/separations-completion`.
Verified 2026-09-02 at status commit `9321fe2f`, runtime/test configuration `5853ef80`; sole worktree on `feature/03b-live-close`, master `769e23c9`. Reports/evidence are committed with this refreshed profile.

R2a default full gate: 388 files / 4,795 tests pass, no skips; typecheck/lint/manifest/roadmap green. R2 parity 287/287 covers unchanged UI. Dashboard restored on 3938/5174; storage healthy/current, 19 runs, zero writes. Exact evidence lives in R2/R2a reports. The original 85d3b082 intake and its red gates remain historical evidence.

## Scope and authorities
The operator requested coordinator-led completion so the workflow can be inspected and UI work can begin. Complete available preparation now; final rebuild-ready status still requires criterion 5.
- Instructions: repository `AGENTS.md` / `CLAUDE.md`, applicable descendant twins, global coordinator and supervise skills.
- Plan/status: `docs/roadmap/roadmap.md`, `docs/rebuild/03b-finish-separations.md`.
- Live/as-built authority: `docs/migrations/separations.md`, especially §§9.33–9.36 and §6.
- Contracts: `docs/rebuild/reference/{write-safety,workflow-model,operator-trust,clock-config-secrets,guards-and-tests,dashboard-surfaces,frontend-backend-integration}.md`; decisions is a pointer index, never a substitute for its owner.
- D284/D300 retain gone canary 4537 and one document-number environment reference. Operator-named batch evidence in §9.34 permits historical inspection; it does not register 4589 as the replacement controlled target.
- D287's filing → deletion → finalization sequence is blocked by §9.36's deleted-receipt contradiction. The protocol amendment is not ratified.
- Prior implementation and real sequencer plus run/gate/receipt test seams are authorized in `docs/handoffs/2026-09-02-separations-controlled-sequence-preflight.md`. Protocol choice and each actual live write remain operator-owned.

## Gates
`npm run typecheck`, `npm run lint`, `npm run test:coverage`; `npm run build:manifest:check`; `npm run test:parity`; `npm run roadmap:check`; `git diff --check`. Stop the owned dashboard launcher for the full suite because tests use its ports, then restore it. No baseline regeneration to conceal a defect. Any tests require lint.

## Git and operations
Local commits only, explicitly staged paths, no push. Integration remains `feature/03b-live-close` then eventual `master --no-ff` only after verified closure. Preserve other sessions' changes.
The established primary-checkout exception remains for this small serial runtime/readiness run because it owns `.env`, `.auth`, and `.tracker-rebuild`. Coordinator writes only coordination/canonical docs; supervisor owns its exact report/evidence and runtime operations. No overlapping writers. Any implementation workers require isolated `feature/<unit>` worktrees and `--no-ff` integration followed by worktree-sweep.
Live reads and dryRun=true are pre-authorized; actual writes require individual approval. No inferred live deletion target, no altered ledger/key to bypass reuse, no UNKNOWN retry, no fabricated transaction number. Browser work uses playwright-cli through `/ui` and the browser reference; close owned browser sessions after proof.

## Coordination and close
One compact nested native `sup_supervisor` run at a time, at most two subordinate worker slots. Only this coordinator may edit/stage/commit the exact board. Run size 3–5 seams; main judgment remains supervisor-owned. Unique writer artifacts named in brief.
Close targets: phase 03b, migration record, roadmap and generated index, applicable instruction twins only if behavior changes; decision pointer only on actual ratification. Keep workspace. Retain unresolved handoffs; remove only after recovery state is verified and fully represented.

## R2a authorized reliability scope
The coordinator received two red full suites and assigned one focused gate-reliability run under the user's completion request. The supervisor may diagnose and fix the runner configuration or the two named expensive test fixture/scanner seams only with evidence. Tests/coverage membership, assertions, floors and 30s limits stay unchanged. Root instruction twins may document a proven runner scheduling rule. No separations protocol or UI implementation is in R2a. Exact scope and evidence are in its brief.
