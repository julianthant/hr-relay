# Supervisor report — Phase 3b R2/u1p parity refreeze

**Date:** 2026-08-28
**Status:** BLOCKED before refreeze
**Repository / branch:** `/Users/julianhein/Projects/hr-automation-rebuild` / `integration/03b`
**Intake HEAD:** `5cd9eda6a7c5fd1557f7471fef105bbb7e434147`
**Verified base:** `49f86c2f32fcce7e37b1c82b214e99595c4cca4b` is an ancestor of intake
**Coordinator board:** `docs/plans/03b-board.md`
**Board intake blob:** `6bbc384040a2aeb9f0acb0e89061905514a3b6bc` (re-verified before close)

## Outcome

The run stopped after u1p-a. The 22 current accessibility-reference failures are fully explained
R2c fingerprint movement, with no visual drift and no role, accessible-name, state, ordering,
visibility, or non-fingerprint content change. However, the requested update set is incompatible
with the parity helper's paired-authority contract: the only approved update command would change
the 22 reviewed `.a11y.yml` files **and** 10 paired Start Run `.meta.json` files. Updating only the
22 YAML files would leave the next assert run red on those 10 metadata files.

`npm run test:parity:update` was therefore not run. No parity reference, PNG, source, fixture,
configuration, generated manifest, threshold, or runtime file changed. u1p-b and u1p-c were not
dispatched. There was no merge.

## Intake and supervision proof

- Native-role pre-dispatch guard: `codex: role policy valid (5 native roles)`.
- UI route: accessibility/UI diff review through the repository parity lane. Stack detected as
  React 19 + Tailwind 4 + TypeScript + Lucide; no shadcn; WIG fetched live.
- One isolated worktree was created at `.hr-rebuild-worktrees/u1p-parity` on
  `feature/u1p-parity`; `npm ci` installed 369 packages.
- u1p-a ran as native `sup_analyst` / `gpt-5.6-terra` / high reasoning, read-only.

## u1p-a semantic-diff verdict

| Reference family | Count | Complete variant set | Only changed line |
|---|---:|---|---|
| `start-run-separations` | 6 | both themes × `1280x720`, `1440x900`, `narrow-1024x768` | header line 4 `descriptorHash` `2d49cb23…` → `0d397a00…`; tree unchanged |
| `separations-start-input` | 4 | both themes × `1440x900`, `narrow-1024x768` | header line 4 `descriptorHash` `2d49cb23…` → `0d397a00…`; tree unchanged |
| `explorer-graph` | 6 | both themes × `1280x720`, `1440x900`, `narrow-1024x768` | tree line 139 task metadata `impl 7ffcaac33154` → `impl fe99beff4f72` |
| `explorer-transaction` | 6 | both themes × `1280x720`, `1440x900`, `narrow-1024x768` | tree line 132 task metadata `impl a2510d0c0332` → `impl 692804fed6ae` |

The descriptor and task fingerprint movements trace to the reviewed R2c closure commits
`56781246`, `a5f53274`, and `3336419a`. Explorer reads the current manifest task fingerprint in
`src/server/dashboard/queries/explorer.ts` and renders its bounded `impl` prefix in
`src/dashboard/surfaces/explorer.tsx`; no surrounding accessible content changed.

## Independent supervisor gate

```text
npm run test:parity
Running 239 tests using 1 worker
22 failed
217 passed (3.8m)
```

The failures were exactly the four families and counts above. No PNG or unrelated parity failure
appeared.

## Stop reason

`tests/parity/helpers/reference-store.ts` makes the a11y tree and metadata one semantic pair:
`assertOrUpdateParityReference` writes/asserts `<name>.a11y.yml` and then `<name>.meta.json` under
the same update switch. The 10 stored Start Run metadata files still carry descriptor hash
`2d49cb23…`, while the current capture carries `0d397a00…`. Thus:

- the approved command necessarily produces **32 changed paths** (22 a11y + 10 metadata); and
- staging only the requested 22 a11y paths would preserve stale paired authority and fail parity.

This is a run-brief/authority-contract conflict, not unexplained UI drift.

## Unit and cleanup ledger

| Unit | Role | Status | Commit | Gate / review |
|---|---|---|---|---|
| u1p-a | `sup_analyst` | complete, STOP verdict | none | complete 22-path semantic review; supervisor parity reproduced 22/217 |
| u1p-b | `sup_terra` + `/ui` | not dispatched | none | blocked before update |
| u1p-c | independent `sup_analyst` | not dispatched | none | no update range existed to review |

The isolated worktree was clean, removed, and `feature/u1p-parity` deleted at its intake commit.
No u1p worktree or branch remains. The original run brief is retained because the blocked unit still
depends on its constraints; this report is the durable paused-state handoff. No browser-system
login, BFF, worker, workflow, 4537 use, gate, `dryRun=false`, external write, remote push, or other
dashboard worktree was touched.

## 1 · Paired parity authority

**Situation.** The helper deliberately prevents accessibility trees and metadata from being
refreshed independently. The current run brief nevertheless permits only 22 a11y files, while the
approved command must also refresh 10 paired Start Run metadata files.

**Options.**

- **A.** Amend u1p-b to permit exactly 32 reviewed files: the 22 `.a11y.yml` files above plus the
  matching 10 Start Run `.meta.json` files — preserves the helper contract and allows one deliberate
  refreeze; the larger path set must be independently reviewed and named explicitly.
- **B.** Plan and review a parity-contract change first — keeps the 22-path brief literal, but changes
  the authority model and is a separate product/test-design seam before the refreeze can resume.

**Recommendation.** A — the metadata files carry the same already-proven descriptor fingerprint,
and refreshing the complete semantic pairs preserves the existing reviewed contract.

**Notes.** _(operator notes here)_

## Resume boundary

After the operator answers item 1, open a fresh supervised u1p run from current `integration/03b`,
re-verify the board and base, repeat the 22-line semantic proof if HEAD moved, then dispatch u1p-b.
Success still requires the independent u1p-c review, parity 239/239, the full integrated gate,
explicit-path commits, `--no-ff` integration, and a clean worktree sweep.
