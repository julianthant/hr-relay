# R7 report — cross-family integration review and final proof

**Status:** COMPLETE for u37–u42. All exit commands pass, the independent review is clean, and the
tracked run worktree is clean. The preserved ≤90-second coverage target remains open: the accepted
121.88-second run misses it by 31.88 seconds without weakening unique protection.

**Branch:** `feature/test-r7-integration-review`

**Base:** `e880da717e75f1bec5d1498a1c30c82c635df4e8`

**Implementation head before final evidence:** `62209483b5d578fe168ac75eddcac8977f771356`

## Outcome

R7 reconciled every accepted R1–R6 family into one risk-based inventory, retained each distinct
failure mode/seam/oracle, and made every offline-authored Vitest file belong to exactly one of three
disjoint projects. The future live combined tier is explicitly zero-owner until it has a dedicated
runner. `test:coverage` remains the one self-contained per-commit superset; no finished gate reads
the legacy checkout.

One default verbose stream now identifies project, file, suite, and full behavior/refusal while
work runs. Long integration harnesses expose stable phases, expected pdfjs diagnostic output is
asserted locally, structural performance counters fail before reporting, and short units gain no
per-assertion chatter. Four-worker isolated forks and existing timeouts remain intact.

The operator's self-contained-gate and risk-retention rulings are ratified in
`guards-and-tests`, D191, `frontend-backend-integration` §7.4, the guard inventory, and byte-identical
root twins. The roadmap plan did not change; its generated site was refreshed because it embeds the
amended owning-reference excerpts. The workflow build manifest remained current.

## Final evidence

| Surface | Result |
|---|---|
| Vitest census | 393 files / 4,885 cases: unit 306/4,046; scenario 17/132; architecture 70/707 |
| Coverage | 85.40% statements · 76.39% branches · 89.41% functions · 87.34% lines |
| Coverage runtime | compact 121.46 s; labeled 121.88 s; +0.42 s / +0.35% reporter cost; ≤90 s target still open |
| Parity | 17 specs / 281 cases / 222 reference triples; 281/281 in 57.12 s, inside ≤75 s |
| Other gates | typecheck, lint, architecture, manifest, roadmap, Duo 43/43, performance bounds, diff and twins PASS |
| Hermeticity | accepted long gates ran with legitimate healthy Node listeners on 3938/5174 before and after, no legacy override |
| Review | all standards/spec/correctness/silent-failure/performance/tests/docs/security axes closed; no open finding |

Detailed gate output, exact deltas, controlled-red proof, invalid contention samples, performance
counters, and cleanup live in `artifacts/r7/u42-final-gates.md`. The exhaustive family ledger is
`u37-reconciliation.md`; topology and additions are `u38-taxonomy.md`; independent review is
`u39-review.md`; authorities and generated disposition are u40/u41.

## Review closure

Independent read-only reviewers initially found topology duplication, future-live scenario
collection, missing duplicate-owner/phase-output red controls, stale doc claims, and stale census
values. Commits `530f85ae`, `7bab5346`, `689d5142`, `3daa6de1`, `dea5a4f6`, and `9ab1eede`
addressed them. Tests re-review returned zero findings. The final docs/spec re-reviews inspect the
committed report packet; any resulting correction is a separate explicit commit rather than an
unreported working-tree adjustment.

Security review found no authentication, authorization, dependency, credential, external-network,
or production-root change. No live HR workflow ran and no HR write occurred. No board row was
edited, no remote was pushed, and this branch was not merged into the coordinator branch.

## Invalid timing evidence retained

The first canonical attempt overlapped an unrelated phase-3c coverage process and ended after
1,603.32 s with five 30-second timeouts, not assertion mismatches. A later compact run passed but
took 824.48 s after another repository coverage process started post-admission. Neither is called a
gate or runtime measurement. The accepted 121-second pair began with no competing
compiler/linter/Vitest/Playwright/performance process and ran under the same legitimate-dashboard
condition.

## Commits

- `974a442b` — enforce final runner topology and diagnostics
- `5d1909fc` — ratify self-contained risk-based test gates
- `530f85ae` — keep live combined scenarios out of coverage
- `6bc4dcc8` — record R7 reconciliation and authorities
- `7bab5346` — derive topology from configured projects
- `689d5142` — distinguish offline test collection
- `3daa6de1` — prove diagnostics and runner enforcement
- `dea5a4f6` — reconcile final test authority claims
- `85a7dd86` — record consequential test review
- `9ab1eede` — refresh final suite topology census
- `62209483` — refresh generated roadmap authority

## Coordinator handoff

Integrate this clean branch with `--no-ff`, rerun the coordinator's post-merge gate, then complete
the recorded worktree/branch/task cleanup lifecycle. Preserve the ≤90-second full-coverage target
as open optimization work; R7 improved the comparable compact sample by 25.20 seconds but did not
waive or attain the budget. No operator judgment is required to integrate the correctness changes.
