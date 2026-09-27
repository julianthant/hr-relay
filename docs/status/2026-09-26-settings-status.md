# Status — Settings redesign — 2026-09-26

Checkpoint: `58c422505` on `codex/settings-design-system`. This is a progress snapshot, not final acceptance.
Plan owner: [settings-and-records](../rebuild/plans/phase-3/3.1-finish-the-dashboard/ui-refinement/settings-and-records.md).
Verified against the committed candidate, retained focused checks, and the three active worker assignments.

## 1 · Complete

| Item | Evidence | Since |
| --- | --- | --- |
| Shared compact design system, autosave, Credentials and ranked model controls | [78 focused tests](/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-assembly/kit-combined/combined-tests.log), candidate `f63624c67` | Sept 26 |
| Ten completed tabs; Paths layout implemented but relocation unfinished | [Owning acceptance record](../rebuild/plans/phase-3/3.1-finish-the-dashboard/ui-refinement/settings-and-records.md#reference-tabs-and-runtime-path-allocation--2026-09-26), [reference-tab checks](/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-5/reference-tabs/unit.log) | Sept 26 |
| Browser-profile and Duo path editing, relocation plan autosave | `fd26da778`, `1a267574c`; [Paths implementation](../../src/dashboard/surfaces/settings-relocation.tsx) | Sept 26 |
| Relocation admission, explicit v56 upgrade, durable recovery checkpoints and restore safeguards | `01cb0f52b`, `ca1304dd7`, `f1bf98b8e`, `58c422505`; [31 checkpoint tests](/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-6/relocation-control/activation-control-tests.log), [12 restore checks](/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-6/runtime-relocation/v56/restore-consumer-test-final.log) | Sept 26 |

## 2 · Drift — where implementation differs from the original design work

| Plan said | Reality | Kind | Consequence |
| --- | --- | --- | --- |
| Cohesive Settings redesign | The operator also approved verified database and artifact relocation, including offline recovery. Its engine remains uncommitted and incomplete. | Approved scope expansion | Paths cannot be counted complete until copying and recovery pass end-to-end checks. |
| Local candidate acceptance | The final combined checks remain outstanding while engine and UI changes are being assembled. | Not done | No claim of final completion, master integration, or push. |

Zoom checks are explicitly waived. Broad repository gates remain deferred under the owning Phase 3.1 cadence.

## 3 · Next

1. Runtime worker: finish exact activation recovery, complete file/reference verification, and CLI execution; prove fault recovery using temporary synthetic data.
2. Parallel test worker: run genuine both-folder, artifact-only, and subsequent state-only moves; verify credentials, artifacts, archive records, Settings history, and committed WAL data survive.
3. UI worker: add the exact copyable command and concise stop/restart guidance to the existing Paths pending-plan banner.
4. Root: inspect the completed changes, integrate category commits, and finish affected combined checks. Preserve unrelated worktrees and all real runtime data.

## 4 · Needs you

None. Current implementation and synthetic verification are authorized. Master integration and push remain outside this assignment.
