# Board — separations completion

Profile: `project-profile.md`. Board owner: this coordinator only. Integration line: `feature/03b-live-close`, eventual `master --no-ff` after completion.
Verified 2026-09-02 at R4a admission source `318baa75` (code repair `5853ef80`), primary checkout. R2/R2a/R3a/R3b received; overall completion remains open. Coordination artifacts are committed with this board. This replaces stale board facts from `1bbd1005`; historical reports remain evidence, not current admission.

## Current facts
- Built workflow and historical live preview are proved, including 4589 run `ca6a5462-4e52-43b7-ac85-f9bdb7fd30cf`, receipt `0fa49971-bd6a-5a80-8c23-6392614d46c7`, exact-run 0/0/0 (§9.34).
- D300 ingress is implemented; old three-person-secret and active-D295-writer blockers are obsolete. Gone 4537 stays gone.
- All three controlled writes remain open. §§9.35–9.36 prove unsupported individual approval sequencing, permanently reused sweep identity, and a deleted filing still cited by finalization. None is waived by green tests.
- R2 full coverage was red twice; R2a repaired file-worker scheduling in `5853ef80`. Default full gate now passes 388/388 files, 4,795/4,795 tests, zero skips; typecheck/lint/manifest/roadmap pass. R2 parity 287/287 applies to unchanged UI. Earlier red evidence is retained in evidence/r2/; default green and unchanged checks are in evidence/r2a/.
- Dashboard is healthy on the current separations fingerprint. After R4a, storage is healthy/current at generation 2280 with 24/24 reconciled run streams, zero pending commands, zero unresolved write intents, and zero durable outbox rows. No actual HR write occurred.
- User authorization: finish separations and prepare it for UI inspection. On 2026-09-02 the operator rejected repeated approvals: a provided EID that matches requires no approval; name-only selection requires approval. R3a ratifies and implements this correction. On 2026-09-02 the operator supplied the current possible document set `4593, 4579, 4564, 4544, 4502, 4495` for read-only R4a inspection. Prior implementation/test-seam authorization persists; no real deletion target or retention disposition is inferred.
- Supervisor policy: every new run uses a newly created standalone supervisor task; do not reuse any earlier supervisor. R4b, R4c, and R4d each require their own fresh supervisor.
- Integration authorization: after R4d, close reconciliation, and the full declared gates are verified, the coordinator is authorized to merge `feature/03b-live-close` into local `master` with `--no-ff`. No remote push is authorized.

## Unit ledger
| Unit | Run | Status | Evidence | Disposition |
|---|---|---|---|---|
| u0 | R1 | integrated historically | D300; reports/r1-rev3.md; migration §9.33 | closed |
| u1 | R1 | stopped safely | gone 4537; run 325cd998…; 0/0/0 | preserve |
| u2 | R1 | historical green | §9.34; 4589 preview, older fingerprint | fresh proof required after implementation |
| u3/u4/u5 | R1 | blocked | §§9.35–9.36 | R3/R4 after decision |
| u6 | R2 + R2a | proved | reports/r2a-gate-reliability.md closes the full-gate failures; runtime healthy/current, 0/0/0 | complete |
| u7 | R2 | proved | evidence/r2/ui-inspection.md + screenshots.json; exact run link rendered | complete |
| u8 | R2 | proved proposal | research/r2-protocol.md; native analyst + supervisor source review | operator protocol decision |
| u9 | R2 | proved | canonical readiness reconciliation `9321fe2f`; decision sheet and receive report in this commit | complete preparation |
| u16 | R2a | proved | `5853ef80`; 4,795/4,795 default coverage; exact config diff reviewed | complete |
| u10/u11/u12 | R3a | proved | D309; `47c47666`..`36f0562f`; 4,809/4,809 coverage; parity 287/287; review PASS | complete |
| u17/u18 | R3b | proved | D310; `1bda8afb`..`4d4804ec`; 4,818/4,818 coverage; parity 287/287; review PASS | complete |
| u13 | R4a | partial, safely failed | `3c3c7152`; 4579 failed New Kronos lookup; 4502 passed authenticated reads then hit missing `source` provenance; every run 0/0/0 writes | receive failure evidence; repair in u19 |
| u14 | R4a → R4c | not reached | D309/D310 never reached for 4502 | repeat target packet after u19 |
| u19 | R4b | ready | failure `3a7959e9-c230-44ae-8c8c-0cd3e5d32278`, fingerprint `d0e11f1e…`; exact missing-provenance authority | fresh-supervisor repair |

## Residue and decisions
- Exact real/disposable targets and restoration/retention disposition remain unresolved in the decision sheet. Its proposed individual write approvals are superseded by the operator's EID rule; do not re-request them for an EID-verified separation. This separate residue does not block R3a.
- u17/u18 exact-set deletion and filing-survival mechanics: R3b complete and received.
- R4a is received at merge `fcfd1e5f`: it proved submit-free failure evidence but did not reach the target packet.
- u19 dates-provenance repair: R4b, fresh supervisor, no live retry or runtime-row mutation.
- u14 post-repair submit-free rehearsal plus read-only exact target packet: R4c after R4b integration, another fresh supervisor.
- u15 controlled writes, measurements and rebuild-ready close: R4d after R4c and explicit operational authorization for the exact target/disposition.
- Run-data rail misleading empty-state confirmed in R2 screenshot at context-rail.tsx:872; owned future UI correction. Fresh Start Run modal currently has Dry run unchecked: inspection is not authorization to start; hr-manage operations explicitly choose dryRun=true.
- Historical 4568/R3, omitted identity/Kuali/job-summary steps, and unrelated dashboard redesign remain in their canonical owners.
- Exact unresolved handoffs: `docs/handoffs/2026-09-02-separations-controlled-sequence-preflight.md`, workspace handoffs `2026-09-01-finish-separations-r1-rev4.md` and `rev5.md`. Retain pending verified recovery/disposition.

## Current recovery boundary
R2/R2a/R3a/R3b are verified. R4a task `01a0637f-5933-7db2-abf9-2a98a802040e` is received: its clean branch commit `3c3c7152` was merged at `fcfd1e5f`; current authority independently confirms the terminal 4502 failure and zero writes. The failure is not login: authenticated New Kronos employee/timecard reads completed, then the dates task omitted provenance for output field `source`. Next is fresh-supervisor R4b repair, followed serially by fresh-supervisor R4c live rehearsal/target packet and R4d controlled proof. Current handoff: `handoffs/2026-09-02-separations-ready-for-protocol-decision.md`. Earlier exact handoffs remain active/historical recovery evidence because their controlled-proof close conditions have not been met. Workspace retained.

## R4b admission — 2026-09-02
The operator requested the failed dry run be fixed. Exact authority gate: run `05d9d8fa-22e0-4b5c-9e38-2df095162284`, trace `sp-122836-05d9`, attempt 3, failure `3a7959e9-c230-44ae-8c8c-0cd3e5d32278`, fingerprint `d0e11f1e85783ee4067addac7c971b8963a145dbffaac248b535bcccf0591644`, summary `task workflow:separations/read-separation-dates has no recorded provenance for output field source`, write state `not-attempted`. R4b may implement and test only the smallest proven repair, update generated/nearest instruction artifacts required by the repository, and run full gates/review. It may not alter the immutable run/checkpoint rows or perform a live retry; R4c owns that fresh proof.

## R3a admission — 2026-09-02
Verified clean cde45a5b, sole primary worktree, current roadmap/manifest; storage healthy schema29 generation2021, 19/19 reconciled streams. Units u10/u11/u12 now mean policy ratification, conditional identity execution, and real composition proof. Reuse exact native supervisor `/root/sup_supervisor_separations_readiness`; report `reports/r3a-eid-approval-policy.md`. Canonical ratification is assigned to that run, not claimed complete here.

## R3b admission — 2026-09-02
R3a proof accepted: clean sole worktree, full coverage 389 files/4,809 tests, parity 287/287, typecheck/lint/manifest/roadmap green, review PASS, runtime restored and no writes. u17/u18 are ready for code-only protocol mechanics. This admission does not select or authorize a real UCPath deletion target. Reuse `/root/sup_supervisor_separations_readiness`; report `reports/r3b-sweep-and-filing-survival.md`; evidence `evidence/r3b/`.

## R4a admission — 2026-09-02
R3b proof accepted: D310 mechanics, live read-only identity mapping, full coverage 4,818/4,818, parity 287/287, review PASS, runtime healthy and unchanged at 19/0/0/0. u13/u14 are authorized for one dashboard-started `dryRun=true` run and read-only inspection of exactly `4593, 4579, 4564, 4544, 4502, 4495`. No workflow gate resolution or actual HR write/delete/finalization is authorized. Launch a fresh standalone supervisor; report `reports/r4a-fresh-rehearsal-and-target-packet.md`; evidence `evidence/r4a/`.
