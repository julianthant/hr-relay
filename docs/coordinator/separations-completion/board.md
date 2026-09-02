# Board — separations completion

Profile: `project-profile.md`. Board owner: this coordinator only. Integration line: `feature/03b-live-close`, eventual `master --no-ff` after completion.
Verified 2026-09-02 after R4d integration at `79f732e2`, primary checkout. R2/R2a/R3a/R3b/R4a/R4b/R4c/R4d received; overall completion remains open. Coordination artifacts are committed with this board. Historical reports remain evidence, not current admission.

## Current facts
- Built workflow and historical live preview are proved, including 4589 run `ca6a5462-4e52-43b7-ac85-f9bdb7fd30cf`, receipt `0fa49971-bd6a-5a80-8c23-6392614d46c7`, exact-run 0/0/0 (§9.34).
- D300 ingress is implemented; old three-person-secret and active-D295-writer blockers are obsolete. Gone 4537 stays gone.
- All three controlled writes remain open. §§9.35–9.36 prove unsupported individual approval sequencing, permanently reused sweep identity, and a deleted filing still cited by finalization. None is waived by green tests.
- R2 full coverage was red twice; R2a repaired file-worker scheduling in `5853ef80`. After R4d integration, the full gate passes 390/390 files, 4,838/4,838 tests, zero skips; typecheck/lint/manifest/roadmap/exact-merge diff pass and parity remains 287/287. Earlier red evidence is retained in evidence/r2/; repair and receive evidence are in the R4 reports/evidence.
- Dashboard is healthy on repaired separations fingerprint `a6a1600a4398f7caa9d14f14821a9abc606de603ed2a3e83af58d99c72e1d81a`. After R4d integration, storage is healthy/current at schema 29 / backup generation 2407 with 25/25 reconciled run streams and no blocking preflight failure. No actual HR write occurred.
- User authorization: finish separations and prepare it for UI inspection. On 2026-09-02 the operator rejected repeated approvals: a provided EID that matches requires no approval; name-only selection requires approval. R3a ratifies and implements this correction. The operator supplied the possible document set `4593, 4579, 4564, 4544, 4502, 4495`, then explicitly selected document `4495` for the post-repair test. R4c used exactly 4495; any post-R4d rehearsal in R4e must use the same document and may not substitute another. This choice authorizes only dry runs/read-only inspection and does not select or authorize a real deletion target or retention disposition.
- Supervisor policy: every new run uses a newly created standalone supervisor task; do not reuse any earlier supervisor. R4d repairs the new Smart HR settlement defect; R4e repeats the 4495 rehearsal; R4f owns controlled proof. Each requires its own fresh supervisor.
- Integration authorization: after R4f, close reconciliation, and the full declared gates are verified, the coordinator is authorized to merge `feature/03b-live-close` into local `master` with `--no-ff`. No remote push is authorized.

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
| u14 | R4a → R4c → R4e | partial, safely failed | 4495 live run proved dates provenance + D309 machine verification, then D310 scan was unreadable; exact run 0/0/0 | repair u20, then repeat 4495 under fresh R4e |
| u19 | R4b | proved | `3d59c1a4` + `647ed013`; exact red/green regression; 4,819/4,819 coverage; parity 287/287 | complete, merged `31da1fe8` |
| u20 | R4d | proved | live auto-drill evidence, fail-loud exact settlement classifier; `9e08afb4`, merged `79f732e2`; 4,838 coverage + 287 parity | complete; immutable R4c failure retained |

## Residue and decisions
- Exact real/disposable targets and restoration/retention disposition remain unresolved in the decision sheet. Its proposed individual write approvals are superseded by the operator's EID rule; do not re-request them for an EID-verified separation. This separate residue does not block R3a.
- u17/u18 exact-set deletion and filing-survival mechanics: R3b complete and received.
- R4a is received at merge `fcfd1e5f`: it proved submit-free failure evidence but did not reach the target packet.
- u19 dates-provenance repair: R4b received and merged at `31da1fe8`; immutable failed run preserved, no live retry or runtime-row mutation.
- u14 post-repair submit-free rehearsal plus read-only exact target packet: R4c proved the first repair/D309 but failed at D310; carry into fresh-supervisor R4e after u20. R4e must still use exactly document 4495.
- u20 Smart HR settlement diagnosis/repair: R4d received and merged at `79f732e2`; live one-result auto-drill and exact fail-loud settlement are proved.
- u15 controlled writes, measurements and rebuild-ready close: R4f after R4e and explicit operational authorization for the exact target/disposition.
- Run-data rail misleading empty-state confirmed in R2 screenshot at context-rail.tsx:872; owned future UI correction. Fresh Start Run modal currently has Dry run unchecked: inspection is not authorization to start; hr-manage operations explicitly choose dryRun=true.
- Historical 4568/R3, omitted identity/Kuali/job-summary steps, and unrelated dashboard redesign remain in their canonical owners.
- Exact unresolved handoffs: `docs/handoffs/2026-09-02-separations-controlled-sequence-preflight.md`, workspace handoffs `2026-09-01-finish-separations-r1-rev4.md` and `rev5.md`. Retain pending verified recovery/disposition.

## Current recovery boundary
R2/R2a/R3a/R3b/R4a/R4b/R4c/R4d are verified. R4a's immutable 4502 provenance failure remains exact zero-write evidence and R4b repaired it. R4c's immutable 4495 failure proved the dates repair and D309 before the D310 Smart HR timeout; R4d live-proved the one-result auto-drill and repaired that settlement boundary at merge `79f732e2`. Its integrated gates are 67/67 focused, 390 files/4,838 tests coverage, 287/287 parity, and green typecheck/lint/manifest/roadmap/exact-merge diff. The R4d worktree/branch are removed and the dashboard is restored healthy/current. R4e now owns exactly one 4495 dry-run rehearsal and target packet; R4f owns controlled proof after an exact packet plus authorization. Each uses a new supervisor. Current handoff: `handoffs/2026-09-02-separations-ready-for-protocol-decision.md`. Earlier exact handoffs remain active/historical recovery evidence because their controlled-proof close conditions have not been met. Workspace retained.

## R4e admission — 2026-09-02
R4d is accepted and integrated at `79f732e2`. Fresh R4e may inspect exactly document `4495`, start exactly one separations run through the dashboard with `dryRun=true`, drain exactly one supported worker, and collect D309/D310 plus the exact target/disposition packet. It may not substitute another document, retry, resolve a workflow gate, edit source, mutate/repair runtime rows, perform any actual UCPath deletion/filing or Kuali finalization, edit this board, merge to master, or push. If 4495 is unavailable or another code defect appears, preserve exact immutable evidence and return it for a new fresh repair supervisor. Brief: `briefs/r4e-post-r4d-4495-rehearsal.md`; report: `reports/r4e-post-repair-rehearsal.md`; evidence: `evidence/r4e/`.

## R4d admission — 2026-09-02
R4c exact authority: run `26e7eaa2-1111-4a88-be5e-b71e4432b4f7`, trace `sp-132417-26e7`, failure `85895513-780e-445f-87c3-6a5a42f69eb5`, fingerprint `d811fe253c4fa59c5eea9dc13b310c8599a9430d85d3e0b60e4f4c1ae1a4f7ab`, `UNEXPECTED_PAGE_STATE`, write state `not-attempted`. The Smart HR scan rendered neither a result row nor the explicit no-results marker within 45 seconds. R4d may diagnose this exact failure, perform read-only live selector/page-state verification, build a deterministic red regression, implement the smallest proven repair, update required manifest/instruction artifacts, and run full gates/review. It may not retry the 4495 workflow run, resolve a gate, perform an HR write, mutate runtime rows, edit the board, merge to master, or push. Brief: `briefs/r4d-smart-hr-settlement-repair.md`; report: `reports/r4d-smart-hr-settlement-repair.md`; evidence: `evidence/r4d/`.

## R4c admission — 2026-09-02
R4b repair and integrated gates are accepted: focused 26/26, full coverage 390/390 files and 4,819/4,819 tests, parity 287/287, typecheck/lint/manifest/roadmap/diff green; storage healthy/current generation 2282, 24/24 streams reconciled, and zero pending commands/write intents/outbox. The operator explicitly chose document `4495` for this test. R4c may perform read-only inspection and start exactly one dashboard `dryRun=true` separations run for 4495, then drain exactly one worker and collect the exact-run authority/target packet. No substitution, retry, gate resolution, actual HR write, runtime-row repair, registry/environment change, master merge, or push is authorized. Brief: `briefs/r4c-post-repair-rehearsal.md`; report: `reports/r4c-post-repair-rehearsal.md`; evidence: `evidence/r4c/`.

## R4b admission — 2026-09-02
The operator requested the failed dry run be fixed. Exact authority gate: run `05d9d8fa-22e0-4b5c-9e38-2df095162284`, trace `sp-122836-05d9`, attempt 3, failure `3a7959e9-c230-44ae-8c8c-0cd3e5d32278`, fingerprint `d0e11f1e85783ee4067addac7c971b8963a145dbffaac248b535bcccf0591644`, summary `task workflow:separations/read-separation-dates has no recorded provenance for output field source`, write state `not-attempted`. R4b may implement and test only the smallest proven repair, update generated/nearest instruction artifacts required by the repository, and run full gates/review. It may not alter the immutable run/checkpoint rows or perform a live retry; R4c owns that fresh proof.

## R3a admission — 2026-09-02
Verified clean cde45a5b, sole primary worktree, current roadmap/manifest; storage healthy schema29 generation2021, 19/19 reconciled streams. Units u10/u11/u12 now mean policy ratification, conditional identity execution, and real composition proof. Reuse exact native supervisor `/root/sup_supervisor_separations_readiness`; report `reports/r3a-eid-approval-policy.md`. Canonical ratification is assigned to that run, not claimed complete here.

## R3b admission — 2026-09-02
R3a proof accepted: clean sole worktree, full coverage 389 files/4,809 tests, parity 287/287, typecheck/lint/manifest/roadmap green, review PASS, runtime restored and no writes. u17/u18 are ready for code-only protocol mechanics. This admission does not select or authorize a real UCPath deletion target. Reuse `/root/sup_supervisor_separations_readiness`; report `reports/r3b-sweep-and-filing-survival.md`; evidence `evidence/r3b/`.

## R4a admission — 2026-09-02
R3b proof accepted: D310 mechanics, live read-only identity mapping, full coverage 4,818/4,818, parity 287/287, review PASS, runtime healthy and unchanged at 19/0/0/0. u13/u14 are authorized for one dashboard-started `dryRun=true` run and read-only inspection of exactly `4593, 4579, 4564, 4544, 4502, 4495`. No workflow gate resolution or actual HR write/delete/finalization is authorized. Launch a fresh standalone supervisor; report `reports/r4a-fresh-rehearsal-and-target-packet.md`; evidence `evidence/r4a/`.
