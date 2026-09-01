# Supervisor report — Phase 3b R2/u1p parity refreeze

**Date:** 2026-08-28
**Status:** COMPLETE — parity authority restored
**Repository / branch:** `/Users/julianhein/Projects/hr-automation-rebuild` / `integration/03b`
**Intake HEAD:** `5cd9eda6a7c5fd1557f7471fef105bbb7e434147`
**Verified base:** `49f86c2f32fcce7e37b1c82b214e99595c4cca4b` is an ancestor of intake
**Coordinator board:** `docs/plans/03b-board.md`
**Board intake blob:** `6bbc384040a2aeb9f0acb0e89061905514a3b6bc` (re-verified before close)
**Resume intake HEAD / board blob:** `8d1d2347bf7fff77ce726076b9cf4cfe622961a9` /
`3c33fe376e56c566491151bd1c929a18768b4156` (re-verified before the second close)
**Final intake HEAD / board blob:** `0bdef6660029977ca7e3498f5e54e069da6e1a17` /
`2989bb0d4fd754748161459051b278738a1ab22a` (re-verified unchanged before final close)

## Outcome

The run restored the parity authority with exactly **48 fingerprint-only reference changes: 30
a11y + 18 metadata**. Operator answers 1 A and 2 A authorized the complete paired set after assert
ordering had masked the downstream Start Run plan/result pairs. `npm run test:parity:update`
completed 239/239 in the isolated worktree, the assert lane then completed 239/239, and the update
landed as `17a11a6c`.

Independent u1p-c review found zero semantic or visual findings across all 48 files. Its first full
assert encountered one unrelated pre-capture `ERR_NETWORK_IO_SUSPENDED` at `intake-mapping`; the
exact unchanged case passed 1/1 immediately, and the final integrated parity lane passed 239/239.
The feature commit merged `--no-ff` as `4ad93cb4`. No PNG, source, fixture, configuration,
generated manifest, threshold, or runtime file changed.

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

## Baseline supervisor gate

```text
npm run test:parity
Running 239 tests using 1 worker
22 failed
217 passed (3.8m)
```

The failures were exactly the four families and counts above. No PNG or unrelated parity failure
appeared.

## Authority-scope reconciliation

`tests/parity/helpers/reference-store.ts` makes the a11y tree and metadata one semantic pair:
`assertOrUpdateParityReference` writes/asserts `<name>.a11y.yml` and then `<name>.meta.json` under
the same update switch. The 10 stored Start Run metadata files still carry descriptor hash
`2d49cb23…`, while the current capture carries `0d397a00…`. Thus:

- the approved command necessarily produces **32 changed paths** (22 a11y + 10 metadata); and
- staging only the requested 22 a11y paths would preserve stale paired authority and fail parity.

This was a run-brief/authority-contract conflict, not unexplained UI drift. It was resolved by the
operator's two explicit recommended-option answers and the exhaustive corpus inventory below.

### Complete latent set discovered on resume

| Reference family | A11y | Metadata | Fingerprint-only datum |
|---|---:|---:|---|
| `start-run-separations` | 6 | 6 | descriptor hash |
| `separations-start-input` | 4 | 4 | descriptor hash |
| `separations-start-plan` | 4 | 4 | descriptor hash |
| `separations-start-result` | 4 | 4 | descriptor hash |
| `explorer-graph` | 6 | 0 | rendered task `impl` prefix |
| `explorer-transaction` | 6 | 0 | rendered task `impl` prefix |
| **Total** | **30** | **18** | **48 paths** |

Across the 193-reference corpus there are exactly 18 stale descriptor headers and their 18 paired
JSON fields, plus the 12 Explorer a11y files with the two reviewed task implementation prefixes.
`appVersion`, `capturedAt`, adapter, fixture, viewport, theme, variant, every other accessibility
line, and all PNG sources remain unchanged.

## Unit and cleanup ledger

| Unit | Role | Status | Commit | Gate / review |
|---|---|---|---|---|
| u1p-a | `sup_analyst` | complete | none | complete surfaced-drift semantic review; supervisor baseline reproduced 22/217 |
| u1p-b first attempt | `sup_terra` + `/ui` | stopped and reverted | none | approved 32-path command exposed masked plan/result pairs; no retained change |
| u1p-a2 | `sup_analyst` | complete | none | complete 193-reference static reconciliation; exact latent set = 48 fingerprint-only paths |
| u1p-b final | `sup_terra` + `/ui` | complete | `17a11a6c` | update 239/239; assert 239/239; exact 48 paths; lint/diff clean |
| u1p-c | independent `sup_analyst` | complete | none | zero semantic findings; one unrelated network-I/O transient, exact case 1/1 green; final integrated parity 239/239 |

The isolated worktree was removed and `feature/u1p-parity` deleted after `--no-ff` integration. No
u1p worktree or branch remains. The original run brief remains the run's audit input; no success
handoff was created. No HR login, BFF, worker, workflow, 4537 use, transaction gate,
`dryRun=false`, external write, remote push, or other dashboard worktree was touched.

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

## Answers (2026-08-28)

| # | Chosen | Note |
|---:|:---:|---|
| 1 | A | No note; operator said “do recommend.” |
| 2 | A | No note; operator said “do recommendation.” |

Answer 1 authorized the stated exact 32 paths. Answer 2 then authorized the 16 masked plan/result
pairs after the exhaustive audit established the complete 48-path boundary.

## 2 · Complete fingerprint authority set

**Situation.** A full corpus audit now proves that one complete update must refresh 48 paths, not
32: the previously reviewed 32 plus 16 `separations-start-plan` / `separations-start-result` a11y
and metadata pairs. Those 16 carry only the same reviewed descriptor hash movement and were hidden
because assert mode stopped at the earlier Start Run input mismatch.

**Options.**

- **A.** Permit exactly the 48 paths in the complete table above — preserves paired authority,
  contains every known R2c fingerprint delta, and enables one independently reviewed refreeze.
- **B.** Plan and review a parity-contract or capture-order change first — avoids widening this run,
  but parity remains red and the 4537 rehearsal remains blocked.

**Recommendation.** A — the exhaustive corpus inventory explains every added path with the same
reviewed descriptor fingerprint and finds no semantic or visual change.

**Notes.** _(operator notes here)_

## Integrated close proof

| Proof | Result |
|---|---|
| Feature / integration | `17a11a6c` / `4ad93cb4` (`--no-ff`) |
| Typecheck / lint | pass / pass |
| Coverage | 321 files / 3,520 tests passed; statements 84.68%, branches 74.81%, functions 87.64%, lines 86.70% |
| Parity | 239/239 passed in 3.3m |
| Build manifest | regenerated byte-identically; no diff |
| Roadmap / diff | fresh / clean |
| Worktree sweep | no `feature/u1p-parity` branch or u1p worktree |
| Repository | clean `integration/03b` before authorized report/board close commit |

R2/u1p is complete. The parity prerequisite for the later 4537 rehearsal is restored; this run did
not start that rehearsal or authorize any transaction.
