# Project profile - Phase 3c authoring and acceptance

**Repository:** `/Users/julianhein/Projects/hr-automation-rebuild`
**Coordination workspace:** `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/phase-3c-migration`
**Coordination UUID:** `57c2dec9-138e-4578-b5da-389ad9b4007a` (minted 2026-09-02 17:38 PDT when the Claude coordinator adopted this established workspace; the earlier Codex-run rows R1/R2 predate it and stay as recorded)
**Coordination short id:** `C57c2dec9`
**Work key:** `phase-3c-migration`
**Coordinator title:** `Coordinate · phase-3c-migration · C57c2dec9 · workflow migration` (alias of the earlier `Coordinate · phase-3c-migration · workflow migration`)
**Coordinator session:** Claude Code background session `571dd99a-cd47-4529-adfe-a4bc7569c29a` (job `571dd99a`; claude.ai session `session_01UqXpak3DKYZxtCEGxLZb4R`)
**Integration checkout:** `/Users/julianhein/Projects/hr-automation-rebuild` · `feature/03c-workflow-migration`
**Verified baseline:** 2026-09-02 17:40 PDT at `cb9a147645f12e230754f0dfcb86cd829ba50335`; D319 later narrows the plan without changing the active R3 implementation seam

## Applicable instructions

- `/Users/julianhein/Projects/hr-automation-rebuild/AGENTS.md` and its byte-identical `CLAUDE.md` twin.
- Descendant instruction twins for every source/test directory a run changes.
- `/Users/julianhein/.claude/skills/coordinator/SKILL.md` for this coordinator (R1/R2 ran under the Codex twin at `/Users/julianhein/.agents/skills/coordinator/SKILL.md`). Every supervisor session runs the `/supervise` skill of its own platform: `/Users/julianhein/.claude/skills/supervise/SKILL.md` for a Claude session (worker roles `sup-scout`, `sup-analyst`, `sup-sonnet` trivial-only, `sup-opus` default), `/Users/julianhein/.agents/skills/supervise/SKILL.md` for a Codex session (`sup_scout`, `sup_analyst`, `sup_luna`, `sup_terra`). Both platforms read `~/.claude/skill-library/parallel-agent-work/REFERENCE.md` for the worktree lifecycle.
- Frontend work must route through `/ui`; browser work must use `playwright-cli` and close owned sessions.

## Canonical authorities

- Plan/status: `docs/roadmap/roadmap.md`; `docs/rebuild/03c-migrate-the-remaining-workflows.md`; `docs/rebuild/03b-finish-separations.md` for carried Phase 3b residue only.
- Specs/contracts: `docs/rebuild/reference/{charter,workflow-model,task-contract,stores,guards-and-tests,dashboard-surfaces,frontend-backend-integration,execution-and-sessions,data-intake-and-edit-data,write-safety,operator-trust,clock-config-secrets}.md`.
- Decisions: `docs/rebuild/reference/decisions.md` is a pointer index; normative text must land in its owning authority in the same commit.
- Rules/lessons: root and descendant `AGENTS.md`/`CLAUDE.md` twins; `docs/rebuild/reference/lessons.md` for new root-level lessons.
- Other close targets: `config/legacy-capabilities.json`, `config/test-subjects.json`, workflow-specific `docs/migrations/*.md`, generated `docs/roadmap/index.html`, and `src/domain/workflow/generated-build-manifest.ts` when their truth changes.

## Gates

- Unit: focused red/green tests for the seam; `npm run typecheck`; `npm run lint`; applicable architecture/scenario/parity checks.
- Integrated: `npm run typecheck && npm run lint`, then `npm run test:coverage` without a concurrent compiler/linter, `npm run test:parity`, `npm run build:manifest:check`, `npm run roadmap:check`, and `git diff --check`.
- Documentation/generated checks: run `npm run build:manifest` after any descriptor import-closure change and commit the result; run `npm run roadmap` after roadmap-source changes and commit the result.
- Live proof: the exact `npm run cli -- dry-run-scenario <workflow> --subject <label>` result plus the durable result and dated workflow migration record. Write workflows additionally require the controlled-commit proof in ref write-safety §3.2.

## Git and integration policy

- Branch/current-line policy: local `master` contains Phase 3b at `414d77b8` and the early Phase 3c R1/R2/D317/session-panel integration at `29186a31` plus status reconciliation through `1867c78b`. The coordinator recreated `feature/03c-workflow-migration` from that exact clean tip for R3. D319 permits only the R4 Phase 3 acceptance/closure run afterward; the former R4-R12 workflow sequence is withdrawn.
- Parallel isolation: every supervisor gets its own worktree and branch. From R3 on, the coordinator creates the worktree under `/Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/<branch-leaf>` (excluded via `.git/info/exclude`) on the canonical branch `feature/phase-3c-migration-c57c2dec9-r<nn>-<slug>`; R1/R2 used Codex-managed worktrees on `feature/03c-r<n>-<slug>`. No supervisor writes the primary checkout or another run's branch. A fresh worktree needs `npm ci`, `.auth` and `duo-autopilot/credentials` symlinked from the root, a mode-600 COPY of the root `.env` (the secure bootstrap refuses a symlink), and `HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation` exported for guard runs.
- Integration: coordinator verifies and merges each clean supervisor branch into `feature/03c-workflow-migration` with `--no-ff`, in run-plan order, and reruns the boundary gate after each merge. Final local `master --no-ff` merge occurs only after 3c-B closes Phase 3.
- Commit and cleanup: logical local commits, explicit path staging only, clean worktrees, then `/worktree-sweep` at completed parallel-batch boundaries.
- Remote writes: forbidden without a new explicit operator instruction.

## Operations and constraints

- Pre-authorized: live read-only selector/login verification and `dryRun=true` workflow runs; Duo Autopilot; stopping/restoring the run's owned local services; local branch/worktree creation and verified local merges requested by the operator.
- Requires operator authority: each actual external write/controlled-commit target and disposition; product choices left as real `you:` lines; history-moving git; any scope expansion outside Phase 3c.
- Hard prohibitions: no production routing change, no legacy runtime dependency, no deletion in the legacy repository, no unknown-submit retry, no fabricated/cached fallback, no secret values in artifacts, no remote push, and no supervisor/worker board writes.
- Reconciled external work: the operator-dispatched session-panel branch landed at `49dc1529` and is contained in master merge `29186a31`; its worktree and branch are absent. R3 may change an overlapping UI seam only through `/ui` and must preserve that integrated behavior.
- Carried Phase 3b residue: R4e/R4f controlled-live proof remains open in `docs/coordinator/separations-completion/`; the local merge did not relabel it complete.

## Coordinator defaults

- Run sizing: one admitted workflow phase or one prerequisite theme, normally 4–6 single-seam units; 8 maximum. Candidate evidence does not create a run.
- Parallel supervisors: 2 initially. Only runs explicitly marked parallel-ready may launch together.
- Launch form: local Claude Code background sessions started by the coordinator with `claude --bg -n "<canonical title>" --permission-mode auto "<prompt>"` from the run worktree (reason: the operator asked the coordinator to complete the phase unattended; a cloud session cannot reach the live systems, `.env`, Duo Autopilot or the legacy checkout this repository's gates and live proofs require). The printed session id is the identity; steering goes through `SendMessage` to that exact id. Operator-started sessions remain available with the same brief.
- Auxiliary worktree budget: 4 total, excluding the primary checkout. Unrelated registered worktrees count and are never removed or repurposed by this coordinator.
- Artifact root override: none; use this workspace.
- Final close: update only the canonical authorities above whose truth changed, verify zero owned residue, merge Phase 3 locally to `master --no-ff` after 3c-B, retain this workspace, and do not push.
