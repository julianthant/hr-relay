# Project profile — separations completion

Repository: `/Users/julianhein/Projects/hr-automation-rebuild`.
Workspace: `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/separations-completion`.
Verified 2026-09-02 at coordination admission `318baa75`, runtime/test configuration `5853ef80`; primary checkout on `feature/03b-live-close`, master `769e23c9`. Reports/evidence are committed with this refreshed profile.

R2a default full gate: 388 files / 4,795 tests pass, no skips; typecheck/lint/manifest/roadmap green. R2 parity 287/287 covers unchanged UI. Dashboard restored on 3938/5174; storage healthy/current, 19 runs, zero writes. Exact evidence lives in R2/R2a reports. The original 85d3b082 intake and its red gates remain historical evidence.

## Scope and authorities
The operator requested coordinator-led completion so the workflow can be inspected and UI work can begin. Complete available preparation now; final rebuild-ready status still requires criterion 5.
- Instructions: repository `AGENTS.md` / `CLAUDE.md`, applicable descendant twins, global coordinator and supervise skills.
- Plan/status: `docs/roadmap/roadmap.md`, `docs/rebuild/03b-finish-separations.md`.
- Live/as-built authority: `docs/migrations/separations.md`, especially §§9.33–9.36 and §6.
- Contracts: `docs/rebuild/reference/{write-safety,workflow-model,operator-trust,clock-config-secrets,guards-and-tests,dashboard-surfaces,frontend-backend-integration}.md`; decisions is a pointer index, never a substitute for its owner.
- D284/D300 retain gone canary 4537 and one document-number environment reference. Operator-named batch evidence in §9.34 permits historical inspection; it does not register a replacement controlled target. On 2026-09-02 the operator supplied the current read-only candidate set `4593, 4579, 4564, 4544, 4502, 4495`; R4a may inspect those exact documents but may not infer a write target or disposition.
- D287's original filing → deletion → finalization proof was blocked by §9.36's deleted-receipt contradiction. R3b ratified D310 and implemented the replacement exact-set sweep plus surviving-filing proof; only the live target/disposition and controlled execution remain open.
- Prior implementation and real sequencer plus run/gate/receipt test seams are authorized in `docs/handoffs/2026-09-02-separations-controlled-sequence-preflight.md`. Protocol choice and each actual live write remain operator-owned.

## Gates
`npm run typecheck`, `npm run lint`, `npm run test:coverage`; `npm run build:manifest:check`; `npm run test:parity`; `npm run roadmap:check`; `git diff --check`. Stop the owned dashboard launcher for the full suite because tests use its ports, then restore it. No baseline regeneration to conceal a defect. Any tests require lint.

## Git and operations
Local commits only, explicitly staged paths, no push. Integration remains `feature/03b-live-close` then eventual `master --no-ff` only after verified closure. Preserve other sessions' changes.
The established primary-checkout exception remains for this small serial runtime/readiness run because it owns `.env`, `.auth`, and `.tracker-rebuild`. Coordinator writes only coordination/canonical docs; supervisor owns its exact report/evidence and runtime operations. No overlapping writers. Any implementation workers require isolated `feature/<unit>` worktrees and `--no-ff` integration followed by worktree-sweep.
Live reads and dryRun=true are pre-authorized. Operator correction 2026-09-02: supplied EID verified by exact read-back proceeds without approval; name-only selection requires approval. R3a ratifies this rule; prior individual-write-approval requirements are superseded for the EID-verified path. R3a itself performs no real HR writes. No inferred live deletion target, no altered ledger/key to bypass reuse, no UNKNOWN retry, no fabricated transaction number. Browser work uses playwright-cli through `/ui` and the browser reference; close owned browser sessions after proof.

## Coordination and close
Every newly briefed run receives a fresh standalone `gpt-5.6-sol` high-reasoning supervisor task in its own worktree; supervisors are never reused across runs. R4b repairs R4a's dates-provenance defect, R4c repeats the live rehearsal/target packet on the integrated repair, and R4d performs the separately authorized controlled proof. These runs remain serial because each consumes the preceding run's evidence. Only this coordinator may edit/stage/commit the exact board. Run size 3–5 seams; main judgment remains supervisor-owned. Unique writer artifacts are named in each brief.
Close targets: phase 03b, migration record, roadmap and generated index, applicable instruction twins only if behavior changes; decision pointer only on actual ratification. Keep workspace. Retain unresolved handoffs; remove only after recovery state is verified and fully represented.

## R2a authorized reliability scope
The coordinator received two red full suites and assigned one focused gate-reliability run under the user's completion request. The supervisor may diagnose and fix the runner configuration or the two named expensive test fixture/scanner seams only with evidence. Tests/coverage membership, assertions, floors and 30s limits stay unchanged. Root instruction twins may document a proven runner scheduling rule. No separations protocol or UI implementation is in R2a. Exact scope and evidence are in its brief.

## R3a authority correction
The user explicitly superseded unconditional identity approval and the proposed repeated per-write approvals. Exact supplied-EID verification must not be inferred from a candidate selected by name. R3a owns canonical ratification and implementation; the old proof protocol/target disposition remains separate residue, not an implementation dependency. See briefs/r3a-eid-approval-policy.md.

## R4a failure boundary
The 2026-09-02 live dry run for document `4502` passed authenticated Kuali, UCPath and New Kronos reads, then failed before D309/D310 with failure fingerprint `d0e11f1e85783ee4067addac7c971b8963a145dbffaac248b535bcccf0591644`: `workflow:separations/read-separation-dates` produced `source` without recording its required provenance. The immutable failed run stays evidence. R4b must reproduce the defect at a deterministic executor/task seam, apply the smallest fail-loud repair, and pin regression coverage; it may not edit runtime rows or retry the live run. R4c owns the post-integration live retry under a fresh supervisor.
