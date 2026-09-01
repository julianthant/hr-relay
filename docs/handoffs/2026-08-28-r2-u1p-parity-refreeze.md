# Run brief — Phase 3b R2/u1p: deliberate parity refreeze before 4537

**Date:** 2026-08-28
**Repository:** `/Users/julianhein/Projects/hr-automation-rebuild`
**Integration branch / verified base:** `integration/03b` / `49f86c2f32fcce7e37b1c82b214e99595c4cca4b`
**Coordinator board:** `/Users/julianhein/Projects/hr-automation-rebuild/docs/plans/03b-board.md`
**Board intake blob:** `6bbc384040a2aeb9f0acb0e89061905514a3b6bc`
**Supervisor report:** `/Users/julianhein/Projects/hr-automation-rebuild/docs/handoffs/2026-08-28-r2-u1p-parity-refreeze-report.md`

## Outcome

Restore the required parity gate before spending the sole live subject. The coordinator reproduced
`npm run test:parity` at `49f86c2f`: exactly **22 failed / 217 passed**, all accessibility-reference
drift in these families: `start-run-separations` ×6, `separations-start-input` ×4,
`explorer-graph` ×6 and `explorer-transaction` ×6. The frozen descriptor hash is
`2d49cb23…`; current is `0d397a00…`. The u1r run changed no dashboard, parity, descriptor or generated
manifest file, and its generated manifest is byte-identical to base `24349da3`; the report traces the
unrefrozen movement to R2c commits `56781246` `a5f53274` `3336419a` after refreeze `0f4c3605`.

Deliberately review and refresh only those 22 `.a11y.yml` authorities. Do not alter product code,
fixtures, selectors, visual PNGs, test thresholds or runtime behavior. No HR system, test subject,
workflow, BFF, worker, gate or external write belongs to this run.

## Required intake and method

- Root `AGENTS.md`, `src/dashboard/AGENTS.md`, this brief, board and run plan.
- `/ui` is mandatory because this is the parity authority, even though no product UI change is
  expected. Invoke `/supervise` for the run.
- Read `tests/parity/helpers/reference-store.ts` and the four affected reference families before
  authorizing an update. The stored reference is reviewed authority, not a snapshot cache.
- Use one isolated `feature/u1p-parity` worktree. Do not touch other dashboard-session worktrees.

## Units

### u1p-a — provenance and semantic-diff verdict

One read-only `sup_analyst` unit. Compare the last reviewed references at `0f4c3605`, the R2c range,
u1r base `24349da3`, and current HEAD. For all 22 failures, classify every changed line—not merely
the headline `descriptorHash`. Prove the current rendered accessibility tree differs only in
expected descriptor/task implementation fingerprint metadata caused by the reviewed R2c closure.
Any role/name/state/ordering/visibility/content change, unexplained fingerprint, changed failure
family/count or non-a11y drift stops the run without updating references.

The analyst returns findings to the supervisor; it writes no artifact or board.

### u1p-b — deliberate reference update

One `sup_terra` implementation unit in the isolated worktree. Invoke `/ui`, then run the repository's
only approved refreeze command, `npm run test:parity:update`. Stage exactly the 22 expected
`tests/parity/references/*.a11y.yml` files by explicit path. No `.png`, source, fixture, config,
generated manifest or unrelated reference may change. Record before/after hashes and a compact
family/count table in the supervisor report. Commit as one parity-authority change.

Acceptance in the worktree: `npm run test:parity` → **239/239 passed**; `git diff --check`; the
changed-path set is exactly the 22 reviewed a11y files.

### u1p-c — independent review, integration and close

One independent `sup_analyst` review of the update range. Recompute the semantic diff from frozen
authority to updated files and verify each new reference byte-for-byte matches the current captured
accessibility output; reject broad refreezes or self-fulfilling “current equals expected” reasoning.
If findings require edits, use a separately named `sup_terra` fix unit and re-review.

Merge `feature/u1p-parity` into `integration/03b` with `--no-ff`, sweep only this run's worktree and
branch, then run on the integrated root:

`npm run typecheck`; `npm run lint`;
`HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test:coverage`;
`npm run test:parity`; `npm run build:manifest` and require no diff;
`npm run roadmap:check`; `git diff --check`.

If aggregate coverage loses files only to fixed 30-second resource timeouts, rerun the exact failed
files alone unchanged and report both results; do not weaken bounds. Success still requires parity
239/239, clean tree, no u1p worktree/branch and no browser.

## Stop and close rules

- Stop on any changed path outside the exact 22 reviewed a11y references.
- Stop if the new capture contains unexplained semantic/visual drift; do not update around it.
- Never run u1, 4537, an HR login, a workflow, a gate or any `dryRun=false` path.
- Before board write-back, re-read the exact board and require blob
  `6bbc384040a2aeb9f0acb0e89061905514a3b6bc`. Board write-back is authorized at close for that path
  only. Commit the report and board close; do not create a handoff on success.

## Paste-ready supervisor prompt

```text
You are the SUPERVISOR for Phase 3b R2/u1p: deliberate parity refreeze before 4537.
Run brief: /Users/julianhein/Projects/hr-automation-rebuild/docs/handoffs/2026-08-28-r2-u1p-parity-refreeze.md
Coordinator board: /Users/julianhein/Projects/hr-automation-rebuild/docs/plans/03b-board.md
Board write-back: AUTHORIZED AT CLOSE for this exact path only after verifying blob 6bbc384040a2aeb9f0acb0e89061905514a3b6bc.
Supervisor report: /Users/julianhein/Projects/hr-automation-rebuild/docs/handoffs/2026-08-28-r2-u1p-parity-refreeze-report.md
Repo: /Users/julianhein/Projects/hr-automation-rebuild; integration target/base: integration/03b at 49f86c2f+.
Read the brief, board, run plan, root/dashboard AGENTS.md and parity reference helper. Verify consequential intake facts.
Invoke /supervise and /ui. Execute u1p-a through u1p-c with only native roles and one isolated feature/u1p-parity worktree.
First prove every line of the 22 a11y drifts is expected R2c fingerprint metadata; unexplained semantic or visual drift stops the run.
Then use only npm run test:parity:update and change exactly the 22 reviewed a11y files—no PNG, source, fixture, config, manifest or threshold change.
Require independent semantic-diff review, parity 239/239, the full integrated gate, explicit-path commits, --no-ff integration and this run's worktree sweep.
No HR login, BFF, worker, workflow, 4537 use, gate, dryRun=false, external write, remote push or other dashboard worktree is in scope.
At close re-read the board, require its intake blob unchanged, commit only the authorized report/board update, and return proof. No success handoff.
```
