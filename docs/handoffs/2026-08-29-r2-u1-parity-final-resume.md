# Handoff — finish R2 u1 parity-final worktree

**Date:** 2026-08-29
**Paused at:** `test:parity:update` left a complete 201-scene reference regeneration unreviewed and
uncommitted in the child worktree; the parent R2 supervisor then hit its Codex usage limit.
**Cleanup owner:** coordinator after the resumed parity supervisor's report is received
**Remove when:** the 436-path batch has been reviewed and either accepted or rejected by exact path,
the resulting child commit has merged `--no-ff` into the clean R2 parent, the child worktree and
branch are removed, and the result is preserved in the named supervisor report.

## Task summary

Finish exactly one worktree: `feature/r2-u1-parity-final`. It is the immediate blocker for the
Phase 3b R2 supervisor. The child contains no source, fixture, configuration, manifest or threshold
edit; it contains 436 modified parity references produced from the current R2 parent: 201
accessibility trees, 201 metadata files and 34 PNGs. Audit the batch against the parent branch's
actual changes, retain only independently justified authority movement, prove assert mode, merge it
into the R2 parent and sweep only this child.

This is not permission to run 4537, open an HR login, start a worker, approve a gate, execute a
workflow or perform any `dryRun=false` action. Do not resume the remainder of R2 in this run.

## Plan and shared state

- Plan: `/Users/julianhein/.codex/worktrees/a1da/hr-automation-rebuild/docs/plans/2026-08-27-03b-runs.md`
- Coordinator project profile: none; this task continues the established Phase 3b coordination
  layout rather than migrating it
- Coordinator board: `/Users/julianhein/.codex/worktrees/a1da/hr-automation-rebuild/docs/plans/03b-board.md`
  — **read-only for this unit; no board write-back authorization**
- Parent run brief:
  `/Users/julianhein/.codex/worktrees/a1da/hr-automation-rebuild/docs/handoffs/2026-08-28-r2-4537-controlled-close.md`
- Historical parity report:
  `/Users/julianhein/.codex/worktrees/a1da/hr-automation-rebuild/docs/handoffs/2026-08-28-r2-u1p-parity-refreeze-report.md`
- Owning contracts: `docs/rebuild/reference/frontend-backend-integration.md` §7,
  `docs/rebuild/reference/dashboard-surfaces.md`, and the parity helpers under
  `tests/parity/helpers/`
- Supervisor report to create:
  `/Users/julianhein/.codex/worktrees/a1da/hr-automation-rebuild/docs/handoffs/2026-08-29-r2-u1-parity-final-report.md`

## Current state (verified, not remembered)

- Parent repository / branch:
  `/Users/julianhein/.codex/worktrees/a1da/hr-automation-rebuild` /
  `codex/r2-4537-controlled-close`
- Parent HEAD: `6f79b4457ae8e54407ac81c9503b03937abd7430`; clean; 32 commits after coordinator
  base `13175b13340fec7b5326207fe54f98078d481d7d`
- Child repository / branch:
  `/Users/julianhein/.codex/worktrees/a1da/r2-units/u1-parity-final` /
  `feature/r2-u1-parity-final`
- Child HEAD: the same `6f79b445`; no child commit; 436 unstaged modified paths
- Dirty-path inventory: 201 `*.a11y.yml`, 201 `*.meta.json`, 34 `*.png`; diffstat is 470
  insertions and 470 deletions plus the binary image changes
- The earlier u1p refreeze at `4ad93cb4` was a different, completed 48-path fingerprint-only
  batch. Do not cite that review as approval for this new full-corpus regeneration.
- The root checkout currently being used by the coordinator is `master`; do not merge, rebase or
  otherwise reconcile `master` in this parity-only run. The integration target is the R2 parent
  branch named above.
- The prior R2 task is idle after a usage-limit failure. No prose from that interrupted turn is
  completion evidence.

## Progress

- [x] Parent R2 secret/admission and diagnostic-safety changes are committed through `6f79b445`;
  this handoff does not receive or approve those changes.
- [x] The parity update command produced one complete dirty reference batch and touched no file
  outside `tests/parity/references/`.
- [ ] **Resume here:** inventory all 201 scene pairs and map every changed field/PNG to the exact
  parent commit and rendered behavior that caused it.
- [ ] Independently inspect all 34 changed PNG pairs and every non-fingerprint accessibility or
  metadata delta. Unexplained visual or semantic drift is a finding, not refreeze authority.
- [ ] Retain the smallest complete accepted set. If a path is rejected, restore that exact path
  only after its disposition is recorded; never use a broad reset, checkout or clean.
- [ ] Commit accepted references by explicit paths on `feature/r2-u1-parity-final`, run the gates,
  merge `--no-ff` into `codex/r2-4537-controlled-close`, rerun the integrated gates, then remove
  exactly the child worktree and branch and prune worktree metadata.
- [ ] Write the supervisor report with the per-family path counts, causal commits, PNG review
  evidence, commit/merge SHAs, exact gate counts and cleanup proof.

## Supervised units

1. `sup_scout_r2_parity_inventory` — read-only complete reference/field/family inventory and parent
   commit attribution. High reasoning, 120k/105k.
2. `sup_analyst_r2_parity_judgment` — independent semantic, accessibility and visual judgment of
   all changed families and 34 PNGs; return findings without editing. High reasoning, 200k/180k.
3. `sup_terra_r2_parity_apply` — through `/ui`, retain only the reviewed complete authority set,
   run focused/assert parity and commit exact paths. High reasoning, 240k/220k.
4. `sup_sol_r2_parity_review` — independent correctness, test-authority, accessibility and
   silent-drift review of the proposed commit; fixes, if any, are a separate one-seam unit. High
   reasoning, 240k/220k.
5. `sup_sol_r2_parity_integrate` — verify the frozen parent, merge `--no-ff`, run the integrated
   gate, write the report and perform the exact child sweep. High reasoning, 240k/220k.

Every visible task name must begin with the exact native role above. Do not use generic roles or a
bare model override. One seam per unit; do not let an auditor edit the batch it judges.

## Stop rules

- If the parent moves from `6f79b445` before integration, stop and report the new SHA; do not merge
  a stale generated corpus.
- If any of the 34 PNGs or any accessibility-tree content lacks a source/contract explanation,
  stop at a coherent reviewed boundary and issue a `/decision-brief`; do not bless it as generated
  noise.
- If assert mode disagrees after the accepted commit, diagnose the exact scene; do not run another
  corpus-wide update as a retry.
- Do not touch DCA2, DCA4, the three DCC-exclusive worktrees, R-DCR, the root checkout, or any
  remote.

## Verification before resuming

```bash
git -C /Users/julianhein/.codex/worktrees/a1da/hr-automation-rebuild status --short --branch
git -C /Users/julianhein/.codex/worktrees/a1da/hr-automation-rebuild rev-parse HEAD
git -C /Users/julianhein/.codex/worktrees/a1da/r2-units/u1-parity-final status --short
git -C /Users/julianhein/.codex/worktrees/a1da/r2-units/u1-parity-final rev-parse HEAD
git worktree list
```

After the reviewed child commit and again after the parent merge:

```bash
npm run typecheck
npm run lint
npm run test:coverage
npm run build:manifest
git diff --exit-code -- src/domain/workflow/generated-build-manifest.ts
npm run test:parity
npm run roadmap:check
git diff --check
```

Run the commands from the worktree being proved. Use the repository's documented low-concurrency
form if host load causes the known macOS timeout flake; report both the original failure and the
unchanged rerun rather than weakening a bound.

## Pointers

- Read first: both worktrees' root `AGENTS.md`,
  `/Users/julianhein/.codex/worktrees/a1da/hr-automation-rebuild/src/dashboard/AGENTS.md`, the
  parent run brief and historical u1p report above
- Parity authority: `tests/parity/helpers/reference-store.ts` and the applicable parity specs
- Browser procedure: `/Users/julianhein/.agents/skill-library/playwright-cli/REFERENCE.md`
- Related decisions: D284, D286 and D287; none authorize this reference batch or a live write

## Suggested skills

- `/supervise` — run the five one-seam native-role units
- `/ui` — mandatory for parity and visual-reference judgment
- `/review` — independent test-authority and silent-drift review
- `/worktree-sweep` — remove only the integrated parity child at close
