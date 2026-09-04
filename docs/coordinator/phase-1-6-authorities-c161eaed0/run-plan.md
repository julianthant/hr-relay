# Run plan — Phase 1.6 canonical run and settings authorities — 2026-09-04

**Coordination UUID:** `161eaed0-8809-4a38-b11b-fcd85b727f86`
**Coordinator owner/channel:** `01a06d9c-1667-7451-a022-5f661d373703` / `local`
**Integration checkout:** `/Users/julianhein/Projects/hr-automation-rebuild` · `master`

| Run | Canonical supervisor title | Theme | Units | Worker roles | Base | Worktree allowance | Integration order | Parallel-ready | Needs first | Exit evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| R01 | Supervisor · phase-1-6-authorities · C161eaed0 · R01 · schema floor | Task 1 schema floor | U01 | Luna/Terra | `dfd73b638bdd1bd49c7e4df91cbca5797ec12ebe` | 4 | 1 | no · serial prerequisite | — | isolated base+task gate green; report verified; integrated gate green; worktree/ref/task closed |
| R02 | Supervisor · phase-1-6-authorities · C161eaed0 · R02 · run-record service | Task 2-1 run authority | U02 | Luna/Terra | `ebc41c45863c9748f3cc48b23f2b9483fb748421` | 2 | 2 | yes · only with R03 from same base | wave parity baseline ruling | isolated base+task gate green; report verified; integrated gate green; worktree/ref/task closed |
| R03 | Supervisor · phase-1-6-authorities · C161eaed0 · R03 · settings catalog and root | Task 2-2 settings authority | U03 | Luna/Terra | `ebc41c45863c9748f3cc48b23f2b9483fb748421` | 2 | 3 | yes · only with R02 from same base | wave parity baseline ruling | isolated base+parity+task gate green; report verified; integrated gate green; worktree/ref/task closed |
| R04 | Supervisor · phase-1-6-authorities · C161eaed0 · R04 · lifecycle writers | Task 3 runtime writers | U04 | Luna/Terra | exact R03 integration SHA | 4 | 4 | no · serial after wave 2 | U02+U03 integrated and closed | isolated base+task gate green; report verified; integrated gate green; worktree/ref/task closed |
| R05 | Supervisor · phase-1-6-authorities · C161eaed0 · R05 · operator run commands | Task 4 command writers | U05 | Luna/Terra | exact R04 merge SHA | 4 | 5 | no · serial | U04 integrated and closed | isolated base+architecture+task gate green; report verified; integrated gate green; worktree/ref/task closed |
| R06 | Supervisor · phase-1-6-authorities · C161eaed0 · R06 · settings consumers | Task 5 runtime resolution | U06 | Luna/Terra | exact R05 merge SHA | 4 | 6 | no · serial | U05 integrated and closed | isolated base+parity+task gate green; report verified; integrated gate green; worktree/ref/task closed |
| R07 | Supervisor · phase-1-6-authorities · C161eaed0 · R07 · authority upgrade | Task 6 migration/recovery proof | U07 | Luna/Terra | exact R06 merge SHA | 4 | 7 | no · serial | U05+U06 integrated and closed | isolated full task gate and real-root evidence; report verified; integrated gate green; worktree/ref/task closed |
| R08 | Supervisor · phase-1-6-authorities · C161eaed0 · R08 · foundation close | Task 7 closure | U08 | Luna/Terra | exact R07 merge SHA | 4 | 8 | no · serial | U07 integrated and closed | full close gate/live dry-runs/review/docs; report verified; integrated gate green; worktree/ref/task closed |

## Supervisor wave ledger

| Coordination UUID | Run | Parent coordinator | Canonical title | Task id / corrections | Host id | Project id | Launch time | Base · worktree · branch | Allowance/reservation | Report/gate | Order | Status | Cleanup | Last cursor |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `161eaed0-8809-4a38-b11b-fcd85b727f86` | R01 | `01a06d9c-1667-7451-a022-5f661d373703` / `local` | Supervisor · phase-1-6-authorities · C161eaed0 · R01 · schema floor | `01a06da0-533b-7a22-99ea-a6c094b9bc0a` (setup handle `client-new-thread:193fd8f9-0b7d-4e57-8c4c-e0cfeb3f91b2`) | `local` | `e23dea50-674d-4a39-ad94-49fcff726de8` | launched 2026-09-04T18:10:12Z | `dfd73b638bdd1bd49c7e4df91cbca5797ec12ebe` · worktree removed · branch deleted | 4 slots · released | `reports/r01.md` · base + Task 1 proofs | 1 | complete · merged `ebc41c45` | exact task archived | `8d4d27b2-20f4-4bf0-99fd-11ea752aa99e:144` |
| `161eaed0-8809-4a38-b11b-fcd85b727f86` | R02 | `01a06d9c-1667-7451-a022-5f661d373703` / `local` | Supervisor · phase-1-6-authorities · C161eaed0 · R02 · run-record service | pending | pending | `e23dea50-674d-4a39-ad94-49fcff726de8` | pending | `ebc41c45863c9748f3cc48b23f2b9483fb748421` · managed worktree pending · `feature/phase-1-6-authorities-c161eaed0-r02-run-record-service` | 2 slots · blocked | `reports/r02.md` · base + Task 2-1 proofs | 2 | blocked on wave parity ruling | pending | none |
| `161eaed0-8809-4a38-b11b-fcd85b727f86` | R03 | `01a06d9c-1667-7451-a022-5f661d373703` / `local` | Supervisor · phase-1-6-authorities · C161eaed0 · R03 · settings catalog and root | pending | pending | `e23dea50-674d-4a39-ad94-49fcff726de8` | pending | `ebc41c45863c9748f3cc48b23f2b9483fb748421` · managed worktree pending · `feature/phase-1-6-authorities-c161eaed0-r03-settings-root` | 2 slots · blocked | `reports/r03.md` · base + Task 2-2 proofs + parity | 3 | blocked on wave parity ruling | pending | none |
| `161eaed0-8809-4a38-b11b-fcd85b727f86` | R04 | `01a06d9c-1667-7451-a022-5f661d373703` / `local` | Supervisor · phase-1-6-authorities · C161eaed0 · R04 · lifecycle writers | pending | pending | pending | pending | wave 2 integration pending · managed worktree pending · `feature/phase-1-6-authorities-c161eaed0-r04-lifecycle-writers` | 4 slots · planned | `reports/r04.md` · base + Task 3 proofs | 4 | planned | pending | none |
| `161eaed0-8809-4a38-b11b-fcd85b727f86` | R05 | `01a06d9c-1667-7451-a022-5f661d373703` / `local` | Supervisor · phase-1-6-authorities · C161eaed0 · R05 · operator run commands | pending | pending | pending | pending | R04 merge pending · managed worktree pending · `feature/phase-1-6-authorities-c161eaed0-r05-run-commands` | 4 slots · planned | `reports/r05.md` · base + Task 4 proofs | 5 | planned | pending | none |
| `161eaed0-8809-4a38-b11b-fcd85b727f86` | R06 | `01a06d9c-1667-7451-a022-5f661d373703` / `local` | Supervisor · phase-1-6-authorities · C161eaed0 · R06 · settings consumers | pending | pending | pending | pending | R05 merge pending · managed worktree pending · `feature/phase-1-6-authorities-c161eaed0-r06-settings-consumers` | 4 slots · planned | `reports/r06.md` · base + Task 5 proofs + parity | 6 | planned | pending | none |
| `161eaed0-8809-4a38-b11b-fcd85b727f86` | R07 | `01a06d9c-1667-7451-a022-5f661d373703` / `local` | Supervisor · phase-1-6-authorities · C161eaed0 · R07 · authority upgrade | pending | pending | pending | pending | R06 merge pending · managed worktree pending · `feature/phase-1-6-authorities-c161eaed0-r07-authority-upgrade` | 4 slots · planned | `reports/r07.md` · base + Task 6 proofs | 7 | planned | pending | none |
| `161eaed0-8809-4a38-b11b-fcd85b727f86` | R08 | `01a06d9c-1667-7451-a022-5f661d373703` / `local` | Supervisor · phase-1-6-authorities · C161eaed0 · R08 · foundation close | pending | pending | pending | pending | R07 merge pending · managed worktree pending · `feature/phase-1-6-authorities-c161eaed0-r08-foundation-close` | 4 slots · planned | `reports/r08.md` · full Task 7 close gate | 8 | planned | pending | none |

## Units

### R09 / U09 — Repair the inherited parity baseline

- Operator choice 3 A; serial after R01 and before wave 2. Existing run ids remain unchanged.
- Launch: compact nested `sup_supervisor`, because this is one bounded reference repair; no concurrent supervisor.
- Parent: `/root`, coordinator task `01a06d9c-1667-7451-a022-5f661d373703` / `local`; coordination UUID `161eaed0-8809-4a38-b11b-fcd85b727f86`.
- Exact agent identity: `/root/sup_supervisor_phase_1_6_c161eaed0_r09_parity_baseline` returned by native dispatch; allowance 2 auxiliary worktrees, within budget 4.
- Branch: `feature/phase-1-6-authorities-c161eaed0-r09-parity-baseline`.
- Worktree: `/Users/julianhein/Projects/hr-automation-rebuild-r09-parity-baseline`.
- Base: `3d9c7917f7db8b83edb473582840ed595353ee4e`, verified at worktree creation and supplied verbatim at dispatch.
- Scope/gate/report: `briefs/r09.md`; `reports/r09.md`; verified derived-hash-only metadata/display/reference diff proof (operator explicitly approved displayed hashes), parity assertion pass, lint, full profile base gate. Other semantic content, layout, production code and existing tolerance remain unchanged.
- R02/R03 consume the same R09 integrated baseline; their earlier `ebc41c45` base reservations are superseded.
- Status: active. Cleanup pending; nested agent has no separate sidebar archival.

### U01 — Land the singleton v30 schema floor
- Scope: doc 01 §1.6 Task 1 exact seam.
- Acceptance: base gate, M3(open), M9, M21, baseline matrix cell, storage/backup/doctor v29 no-migrate proofs, planned guard row.
- Dependency: none; 0.3 is closed.
- Role: Sol supervisor with permitted Luna/Terra support.
- Mode: sequential.
- Artifact: `reports/r01.md` plus supervisor-owned non-board artifacts named there.
- Review: storage correctness, fail-loud opening, migration atomicity, guard completeness.

### U02 — Implement the canonical run-record service
- Scope: doc 01 §1.6 Task 2-1 exact seam; no settings/composition/schema work.
- Acceptance: base gate, D330 #1–#23/#25/#26, P33 claim half, deletion proofs #16/#25.
- Dependency: U01 integrated and closed; paired wave parity-baseline ruling pending.
- Role: Sol supervisor with permitted Luna/Terra support.
- Mode: parallel-safe only with U03 from the same base.
- Artifact: `reports/r02.md`.
- Review: lifecycle/CAS/order/tombstone correctness and service-only mutation boundary.

### U03 — Implement the settings catalog and protected root
- Scope: doc 01 §1.6 Task 2-2 exact seam; no migrations/authority-database/run-service/Settings UI.
- Acceptance: base gate, unchanged parity, assigned D331 ladder, M14 schema half, A4/A5/A7 deletion tests and catalog guard.
- Dependency: U01 integrated and closed; paired wave parity-baseline ruling pending.
- Role: Sol supervisor with permitted Luna/Terra support.
- Mode: parallel-safe only with U02 from the same base.
- Artifact: `reports/r03.md`.
- Review: catalog closure, private-file/CAS behavior, secret non-disclosure, resolver/environment deletion.

### U04 — Cut over executor and worker lifecycle writers
- Scope: doc 01 §1.6 Task 3 exact seam.
- Acceptance: base gate, assigned D330 composition reruns, `worker-loop-writes-only-through-the-service` deletion proof.
- Dependency: U02 and U03 integrated and closed.
- Role: Sol supervisor with permitted Luna/Terra support.
- Mode: sequential.
- Artifact: `reports/r04.md`.
- Review: fence/terminal ordering, identity preservation, direct-mutator deletion.

### U05 — Cut over operator run commands and archive/delete writers
- Scope: doc 01 §1.6 Task 4 exact seam.
- Acceptance: base+architecture gates, D330 #24/#27, kernel idempotence/CAS/race proofs, active no-lifecycle-SQL guard.
- Dependency: U04 integrated and closed; D330 cancel option A already landed.
- Role: Sol supervisor with permitted Luna/Terra support.
- Mode: sequential.
- Artifact: `reports/r05.md`.
- Review: typed settlements, tree delete, cancel request/worker settlement, guard negative control.

### U06 — Cut over settings mutation and runtime resolution
- Scope: doc 01 §1.6 Task 5 exact seam.
- Acceptance: base+unchanged parity, P16/P20/P33 composition/P4 composition, hostile-environment deletion proof.
- Dependency: U05 integrated and closed.
- Role: Sol supervisor with permitted Luna/Terra support.
- Mode: sequential.
- Artifact: `reports/r06.md`.
- Review: no environment leaf at composition, value-free spawn, next-use credentials, restart reporting.

### U07 — Prove upgrade, rollback, recovery, and compatibility boundaries
- Scope: doc 01 §1.6 Task 6 exact seam.
- Acceptance: base, M1–M27/S1–S6, fixture upgrade, doctor, architecture entries, explicit operator-root backup then stopped-system upgrade and remove-list evidence.
- Dependency: U05 and U06 integrated and closed.
- Role: Sol supervisor with permitted Luna/Terra support.
- Mode: sequential.
- Artifact: `reports/r07.md` plus exact redacted upgrade evidence paths named by the supervisor.
- Review: transactional upgrade/rollback, private files, compatibility isolation, no provider-key import.

### U08 — Close the rebuilt foundation
- Scope: doc 01 §1.6 Task 7 exact seam; only gate-demanded product fixes.
- Acceptance: complete Task 7 gate, both dry-run live manifests with zero write authority, adversarial review, canonical docs/handoff.
- Dependency: U07 integrated and closed.
- Role: Sol supervisor with permitted Luna/Terra support.
- Mode: sequential.
- Artifact: `reports/r08.md` and canonical doc/handoff evidence.
- Review: independent adversarial authority/secret/guard review is mandatory.

## Decisions gating runs

- Wave 2 parity baseline: Phase 1.6 requires parity green and byte-unchanged, but exact base `ebc41c45` inherits 116 descriptor-hash-only mismatches after `dae04a11`; choose the owning authority path before R02/R03 dispatch.
- The prior claimed/running cancel decision is ratified in D330 and Task 4 owes proof #27.

## Date or external gates

- Task 6 requires a stopped system and an explicit verified storage backup immediately before the real-root upgrade.
- Task 7 live workflows remain dry-run only; unavailable external systems are reported explicitly under repository rules.

## Residue carried in

- None.

## Stable coordinator progress footer

Steps — 1/11 complete
- [x] R01 — Task 1: Land the schema floor
- [!] R02 — Task 2-1: Implement the canonical run-record service — blocked on wave parity baseline
- [!] R03 — Task 2-2: Implement the settings catalog and protected root — blocked on wave parity baseline
- [ ] R04 — Task 3: Cut over executor and worker lifecycle writers
- [ ] R05 — Task 4: Cut over operator run commands and archive/delete writers
- [ ] R06 — Task 5: Cut over settings mutation and runtime resolution
- [ ] R07 — Task 6: Prove upgrade, rollback, recovery, and compatibility deletion
- [ ] R08 — Task 7: Close the rebuilt foundation
- [ ] RECONCILE — Reconcile Phase 1.6 canonical authorities
- [ ] CLOSE — Close the coordinator workspace and all supervisor rows
- [>] R09 — Repair the inherited parity baseline
