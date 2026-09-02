# Project profile — Phase 3c workflow migration

**Repository:** `/Users/julianhein/Projects/hr-automation-rebuild`
**Coordination workspace:** `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/phase-3c-migration`
**Verified:** 2026-09-02 15:46 PDT at `414d77b810f713d5813c79035fd38064ba04e73c`

## Applicable instructions

- `/Users/julianhein/Projects/hr-automation-rebuild/AGENTS.md` and its byte-identical `CLAUDE.md` twin.
- Descendant instruction twins for every source/test directory a run changes.
- `/Users/julianhein/.agents/skills/coordinator/SKILL.md` for this coordinator and `/Users/julianhein/.agents/skills/supervise/SKILL.md` for every supervisor.
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

- Branch/current-line policy: local `master` contains the authorized Phase 3b merge at `414d77b8`; Phase 3c integrates on `feature/03c-workflow-migration`.
- Parallel isolation: every supervisor gets a separate Codex worktree and a `feature/<run>` branch. No supervisor writes the primary checkout or another run's branch.
- Integration: coordinator verifies and merges each clean supervisor branch into `feature/03c-workflow-migration` with `--no-ff`, in run-plan order, and reruns the boundary gate after each merge. Final local `master --no-ff` merge occurs only after Phase 3c close.
- Commit and cleanup: logical local commits, explicit path staging only, clean worktrees, then `/worktree-sweep` at completed parallel-batch boundaries.
- Remote writes: forbidden without a new explicit operator instruction.

## Operations and constraints

- Pre-authorized: live read-only selector/login verification and `dryRun=true` workflow runs; Duo Autopilot; stopping/restoring the run's owned local services; local branch/worktree creation and verified local merges requested by the operator.
- Requires operator authority: each actual external write/controlled-commit target and disposition; product choices left as real `you:` lines; history-moving git; any scope expansion outside Phase 3c.
- Hard prohibitions: no production routing change, no legacy runtime dependency, no deletion in the legacy repository, no unknown-submit retry, no fabricated/cached fallback, no secret values in artifacts, no remote push, and no supervisor/worker board writes.
- Existing external work: `/Users/julianhein/.codex/worktrees/session-panel/hr-automation-rebuild` on `codex/session-panel` is operator-dispatched and out of scope. Phase 3c runs must avoid its session-panel files and parity states until the coordinator receives that branch separately.
- Carried Phase 3b residue: R4e/R4f controlled-live proof remains open in `docs/coordinator/separations-completion/`; the local merge did not relabel it complete.

## Coordinator defaults

- Run sizing: one order row or one prerequisite theme, normally 4–6 single-seam units; 8 maximum. Write/live-proof rows remain 4–5 units.
- Parallel supervisors: 2 initially. Only runs explicitly marked parallel-ready may launch together.
- Artifact root override: none; use this workspace.
- Final close: update only the canonical authorities above whose truth changed, verify zero unowned residue, merge Phase 3c locally to `master --no-ff`, retain this workspace, and do not push.
