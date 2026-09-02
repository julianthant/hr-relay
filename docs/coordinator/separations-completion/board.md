# Board — separations completion

Profile: `project-profile.md`. Board owner: this coordinator only. Integration line: `feature/03b-live-close`, eventual `master --no-ff` after completion.
Verified 2026-09-02 at `9321fe2f` (code repair `5853ef80`), sole checkout. R2/R2a received; overall completion remains open on the protocol decision. Coordination artifacts are committed with this board. This replaces stale board facts from `1bbd1005`; historical reports remain evidence, not current admission.

## Current facts
- Built workflow and historical live preview are proved, including 4589 run `ca6a5462-4e52-43b7-ac85-f9bdb7fd30cf`, receipt `0fa49971-bd6a-5a80-8c23-6392614d46c7`, exact-run 0/0/0 (§9.34).
- D300 ingress is implemented; old three-person-secret and active-D295-writer blockers are obsolete. Gone 4537 stays gone.
- All three controlled writes remain open. §§9.35–9.36 prove unsupported individual approval sequencing, permanently reused sweep identity, and a deleted filing still cited by finalization. None is waived by green tests.
- R2 full coverage was red twice; R2a repaired file-worker scheduling in `5853ef80`. Default full gate now passes 388/388 files, 4,795/4,795 tests, zero skips; typecheck/lint/manifest/roadmap pass. R2 parity 287/287 applies to unchanged UI. Earlier red evidence is retained in evidence/r2/; default green and unchanged checks are in evidence/r2a/.
- Dashboard restored and exact historical run link verified; healthy/current storage generation 2021, 19/19 span streams, 19 total runs, global writes 0/0/0. No new workflow or actual HR write occurred.
- User authorization: finish separations and prepare it for UI inspection. Prior implementation/test-seam authorization persists. No per-write approval or protocol answer inferred.

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

## Residue and decisions
- Protocol amendment preserving the real filing, exact real/disposable targets, and explicit restoration/retention disposition: operator decision in `decisions/2026-09-02-controlled-proof-protocol.md` item 1. Implementation seams already authorized; individual live approvals remain required.
- Fresh rehearsal on final implementation, controlled writes, measurements and rebuild-ready close: R3/R4, not dispatched before dependencies clear.
- Run-data rail misleading empty-state confirmed in R2 screenshot at context-rail.tsx:872; owned future UI correction. Fresh Start Run modal currently has Dry run unchecked: inspection is not authorization to start; hr-manage operations explicitly choose dryRun=true.
- Historical 4568/R3, omitted identity/Kuali/job-summary steps, and unrelated dashboard redesign remain in their canonical owners.
- Exact unresolved handoffs: `docs/handoffs/2026-09-02-separations-controlled-sequence-preflight.md`, workspace handoffs `2026-09-01-finish-separations-r1-rev4.md` and `rev5.md`. Retain pending verified recovery/disposition.

## Current recovery boundary
R2/R2a are verified; this is not a closed separations board. Next: operator protocol answer, then detail/brief R3 at the already-authorized implementation/test seams. R4 follows fixed-source rehearsal plus exact targets and each separate actual-write approval. Current handoff: `handoffs/2026-09-02-separations-ready-for-protocol-decision.md`. Earlier exact handoffs listed above remain active/historical recovery evidence because their controlled-proof close conditions have not been met; no file was deleted. Receive proof: `reports/2026-09-02-coordinator-receive.md`. Workspace retained.
