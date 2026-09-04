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
| R01 | 1.6.1 | active | Verify canonical merged floor plus repaired baseline parity |
| R02 | 1.6.2-1 | planned | Dependencies in run plan |
| R03 | 1.6.2-2 | planned | Dependencies in run plan |
| R04 | 1.6.3 | planned | Dependencies in run plan |
| R05 | 1.6.4 | planned | Dependencies in run plan |
| R06 | 1.6.5 | planned | Dependencies in run plan |
| R07 | 1.6.6 | planned | Dependencies in run plan |
| R08 | 1.6.7 | planned | Dependencies in run plan |

## Admission residue

- Sole ownership of remaining Phase 1.6 implementation is awaiting operator clarification because another coordination has a worktree in this scope. No foreign task/report adoption.

## Verified open findings (2026-09-04)

- R01/G1: M9 requires zero settings-family filesystem opens and zero resolver calls during downgrade refusal (ref dashboard-surfaces §D332.11 #9, lines 2283–2289). The existing compose-real-port v29/v31 lock-release test lacks those spies and the exact CURRENT=29 / floor=30 setup. Coordinator verified source and tests; add exact regression proof, do not waive.
- R01/G2: M21 requires exact v27/v28/v29 traversal, v29 extra-table refusal and a DDL-derived-list negative control (§D332.11 #21). Current tests prove all-three read-only admission, v27 traversal and v27 extra-table refusal. Coordinator verified the gap. Add proof at the assigned Task 1 seam; Task 6 still owns the real upgrade command repetition.
- Runtime transport: create_thread returned client-new-thread:a6e2f58d-eaff-402c-a4fc-1623650b9a1f. Permanent task 01a06e90-ea8a-7f72-8559-e9c1829a0ec6 was verified from unique exact-worktree metadata and the original delegation envelope. The hook still records only the client id, and the child has no enrolled runtime session. wait_threads was rejected by PreToolUse because the permanent id is absent from the runtime address book. No runtime state or hook was modified and no blocked call bypassed.
