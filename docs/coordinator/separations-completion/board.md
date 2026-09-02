# Board — separations completion

Profile: `project-profile.md`. Board owner: this coordinator only. Integration line: `feature/03b-live-close`, eventual `master --no-ff` after completion.
Verified 2026-09-02 at `9321fe2f` (code repair `5853ef80`), sole checkout. R2/R2a received; overall completion remains open; the 2026-09-02 operator correction clears R3a identity-policy implementation. Coordination artifacts are committed with this board. This replaces stale board facts from `1bbd1005`; historical reports remain evidence, not current admission.

## Current facts
- Built workflow and historical live preview are proved, including 4589 run `ca6a5462-4e52-43b7-ac85-f9bdb7fd30cf`, receipt `0fa49971-bd6a-5a80-8c23-6392614d46c7`, exact-run 0/0/0 (§9.34).
- D300 ingress is implemented; old three-person-secret and active-D295-writer blockers are obsolete. Gone 4537 stays gone.
- All three controlled writes remain open. §§9.35–9.36 prove unsupported individual approval sequencing, permanently reused sweep identity, and a deleted filing still cited by finalization. None is waived by green tests.
- R2 full coverage was red twice; R2a repaired file-worker scheduling in `5853ef80`. Default full gate now passes 388/388 files, 4,795/4,795 tests, zero skips; typecheck/lint/manifest/roadmap pass. R2 parity 287/287 applies to unchanged UI. Earlier red evidence is retained in evidence/r2/; default green and unchanged checks are in evidence/r2a/.
- Dashboard restored and exact historical run link verified; healthy/current storage generation 2021, 19/19 span streams, 19 total runs, global writes 0/0/0. No new workflow or actual HR write occurred.
- User authorization: finish separations and prepare it for UI inspection. On 2026-09-02 the operator rejected repeated approvals: a provided EID that matches requires no approval; name-only selection requires approval. R3a ratifies and implements this correction. Prior implementation/test-seam authorization persists; no real deletion target or retention disposition is inferred.

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

## Residue and decisions
- Exact real/disposable targets and restoration/retention disposition remain unresolved in the decision sheet. Its proposed individual write approvals are superseded by the operator's EID rule; do not re-request them for an EID-verified separation. This separate residue does not block R3a.
- u17/u18 exact-set deletion and filing-survival mechanics: R3b dispatched after R3a receive; fake writes/read-only live mapping only.
- Fresh rehearsal on final implementation, controlled writes, measurements and rebuild-ready close: R4 after R3b; exact targets/dispositions remain required for actual controlled writes.
- Run-data rail misleading empty-state confirmed in R2 screenshot at context-rail.tsx:872; owned future UI correction. Fresh Start Run modal currently has Dry run unchecked: inspection is not authorization to start; hr-manage operations explicitly choose dryRun=true.
- Historical 4568/R3, omitted identity/Kuali/job-summary steps, and unrelated dashboard redesign remain in their canonical owners.
- Exact unresolved handoffs: `docs/handoffs/2026-09-02-separations-controlled-sequence-preflight.md`, workspace handoffs `2026-09-01-finish-separations-r1-rev4.md` and `rev5.md`. Retain pending verified recovery/disposition.

## Current recovery boundary
R2/R2a are verified; this is not a closed separations board. R3a is received complete at `36f0562f`; receive report `reports/2026-09-02-r3a-receive.md`. Next: R3b implements exact-set deletion authority and a fresh surviving-filing check under `briefs/r3b-sweep-and-filing-survival.md`. R4 then runs a fixed-source submit-free rehearsal and needs exact target/disposition authority only for controlled live writes. Current handoff: `handoffs/2026-09-02-separations-ready-for-protocol-decision.md`. Earlier exact handoffs listed above remain active/historical recovery evidence because their controlled-proof close conditions have not been met; no file was deleted. Receive proof: `reports/2026-09-02-coordinator-receive.md`. Workspace retained.

## R3a admission — 2026-09-02
Verified clean cde45a5b, sole primary worktree, current roadmap/manifest; storage healthy schema29 generation2021, 19/19 reconciled streams. Units u10/u11/u12 now mean policy ratification, conditional identity execution, and real composition proof. Reuse exact native supervisor `/root/sup_supervisor_separations_readiness`; report `reports/r3a-eid-approval-policy.md`. Canonical ratification is assigned to that run, not claimed complete here.

## R3b admission — 2026-09-02
R3a proof accepted: clean sole worktree, full coverage 389 files/4,809 tests, parity 287/287, typecheck/lint/manifest/roadmap green, review PASS, runtime restored and no writes. u17/u18 are ready for code-only protocol mechanics. This admission does not select or authorize a real UCPath deletion target. Reuse `/root/sup_supervisor_separations_readiness`; report `reports/r3b-sweep-and-filing-survival.md`; evidence `evidence/r3b/`.
