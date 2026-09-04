# Board — Phase 1.6

**Coordination UUID:** 858cc3dc-8536-4077-8049-34b76cc31baf
**Work key:** execute-phase-1-6-from
**Coordinator:** 01a06e8e-d1fc-7260-9fc7-cda1ea031a9a · local
**Integration checkout:** /Users/julianhein/Projects/hr-automation-rebuild · master
**Board owner/write rule:** this coordinator only; supervisors and workers read only.
**Profile:** project-profile.md
**Run plan/address book:** run-plan.md / supervisors.json
**Last verified:** 59c8bfb1d165ca83c7b7b470fab2ca60bd16fe1b, clean tree, 2026-09-04

| Run | Phase task | State | Evidence / residue |
|---|---|---|---|
| R01 | 1.6.1 | active | Baseline verification green; M9/M21 proof remediation brief ready; approved identity repair applied and normal wait_threads passed |
| R02 | 1.6.2-1 | planned | Dependencies in run plan |
| R03 | 1.6.2-2 | planned | Dependencies in run plan |
| R04 | 1.6.3 | planned | Dependencies in run plan |
| R05 | 1.6.4 | planned | Dependencies in run plan |
| R06 | 1.6.5 | planned | Dependencies in run plan |
| R07 | 1.6.6 | planned | Dependencies in run plan |
| R08 | 1.6.7 | planned | Dependencies in run plan |

## Admission residue

- 2026-09-04 operator confirmed the previous coordinator is stopped and assigned this coordinator to continue and verify existing work. Ownership is resolved; existing implementation is verified from canonical code/specs and exact evidence. Previous task identities are not silently adopted.

## Verified open findings (2026-09-04)

- R01/G1: M9 requires zero settings-family filesystem opens and zero resolver calls during downgrade refusal (ref dashboard-surfaces §D332.11 #9, lines 2283–2289). The existing compose-real-port v29/v31 lock-release test lacks those spies and the exact CURRENT=29 / floor=30 setup. Coordinator verified source and tests; add exact regression proof, do not waive.
- R01/G2: M21 requires exact v27/v28/v29 traversal, v29 extra-table refusal and a DDL-derived-list negative control (§D332.11 #21). Current tests prove all-three read-only admission, v27 traversal and v27 extra-table refusal. Coordinator verified the gap. Add proof at the assigned Task 1 seam; Task 6 still owns the real upgrade command repetition.
- Runtime transport: create_thread returned client-new-thread:a6e2f58d-eaff-402c-a4fc-1623650b9a1f. Permanent task 01a06e90-ea8a-7f72-8559-e9c1829a0ec6 was verified from unique exact-worktree metadata and the original delegation envelope. The hook still records only the client id, and the child has no enrolled runtime session. wait_threads was rejected by PreToolUse because the permanent id is absent from the runtime address book. No runtime state or hook was modified and no blocked call bypassed.

## Resume boundary

Handoff: `handoffs/2026-09-04-phase-1-6-verified-id-repair.md`. R01 has no worker rows. Its supervisor worktree, branch and task remain open deliberately. R02–R08 were never launched. Zero lifecycle rows are claimed closed.

## Resumed verification

- R01 final commit `1638c9736f9f9ac03c63aab359a24a08e47179af`: clean supervisor worktree; 411 files / 5,032 tests and 269 assert-mode parity tests passed; typecheck, lint and manifest check passed. G1/G2 remain open, and no supervisor lifecycle closure is claimed.

## Admission repair proposal

Exact old/proposed records and authenticated launch linkage: `evidence/task-identity-repair-proposal.json` (2bba9c34). Operator approval requested explicitly after the hook rejection; no response yet. Ready R01 proof continuation: `briefs/r01-proof-amendment.md` (3dfcf704). Previous parity text normalization independently proved in `evidence/inherited-parity-verification.json` (bd243209).

## Approved admission repair applied

2026-09-04 user answered yes to the exact proposed repair. Original launch, metadata, branch, base and envelope revalidated; runtime address replaced and original enrollment restored atomically. Audit: `evidence/task-identity-repair-result.json`. Normal `wait_threads` accepted the permanent task id. No hook files, scope or cleanup checks changed by the repair. R01 will continue its existing task with the bounded generated proof amendment.
