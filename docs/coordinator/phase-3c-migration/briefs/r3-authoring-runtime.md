# R3 brief — D312–D316 authoring/runtime foundation

**Base:** the coordinator's verified integration of R1 then R2 into `feature/03c-workflow-migration`
**Required branch:** `feature/03c-r3-authoring-runtime`
**Units:** u15–u19
**Report:** `docs/coordinator/phase-3c-migration/reports/r3-authoring-runtime.md`
**Authority commit:** `1273c3605a0ae6776a86db34f36077fae49ff50b`

Implement the D312–D316 prerequisite exactly as owned by doc 03c and the referenced contract sections. Begin from the coordinator's integrated R1+R2 base; inspect their reports and carried residue before decomposing. Preserve the existing executor, durable formats, task/store boundaries, gates, receipts, write sequencer and public wire except where D313/D314 explicitly amend behavior. Do not create a second runtime, advanced graph-authoring escape hatch, workflow-keyed generic dashboard adapter or silent fallback.

Own five seams: enforce the strict four-artifact budget for reuse-only workflows; compile the closed explicit `task | parallel | delegate | gate | transaction` algebra into existing node kinds; make the run modal the complete pre-start authority for whole-step omission and supplied output validation; expose Resume from checkpoints and Restart from start without ever repeating a completed external write; then prove Person Lookup + Separations equivalence and delete the superseded authoring path. Treat D307 as the pre-conversion as-built state and D313 as the compiled-recipe target. Preserve the separate read-only T1 decision until the coordinator ratifies it.

Visible run-modal/recovery/Explorer work must invoke `/ui`, follow the repository's Playwright-only browser route, and avoid the external `codex/session-panel` seam and parity states. If required files overlap that branch, surface `NEEDS COORDINATOR` before editing. Live reads/dry runs are pre-authorized; no actual external write is authorized. Any descriptor-closure edit requires manifest regeneration.

Use `/supervise`; the Sol supervisor owns cross-layer design, recovery/write-safety judgment, integration and consequential review. Split bounded implementation and review seams only to native `sup_scout`, `sup_analyst`, `sup_luna` and `sup_terra` roles under repository sizing rules. Require red-capable tests for every refusal and no-repeat-write invariant. Run focused gates throughout, then `npm run build:manifest`, typecheck, lint, full coverage, parity, roadmap/check and diff check. Return logical commits, exact gate evidence, deletion inventory, before/after artifact inventory, screenshots/parity evidence for visible behavior, a clean worktree, cleaned worker worktrees/branches and the report. Never edit `board.md`, merge to the integration branch/master, push, archive tasks or perform an external write.
