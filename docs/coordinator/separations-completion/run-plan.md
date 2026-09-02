# Run plan — separations completion — 2026-09-02

| Run | Theme | Units | State / needs first | Acceptance |
|---|---|---|---|---|
| R1 | original controlled completion | u0–u5 | historical partial; reports and §§9.33–9.36 | u0 landed; old u2 proof; u3–u5 blocked |
| R2 | make readiness concrete and inspectable | u6–u9 | received; u7/u8/u9 proved, u6 closed through R2a | current gate table, existing preview visible, exact implementation proposal, reconciled status |
| R2a | restore a reliable unchanged full-suite gate | u16 | complete, code `5853ef80`, report verified | default full coverage green with assertions/floors/timeouts preserved; lint and current runtime restored |
| R3a | implement corrected identity approval policy | u10–u12 | complete at `36f0562f`; received | D309, machine verification/name-only gate, 4,809 coverage + 287 parity |
| R3b | sweep scope and surviving filing proof | u17–u18 | complete at `4d4804ec`; received | D310 exact-set/fresh-filing mechanics, 4,818 coverage + 287 parity |
| R4a | fresh rehearsal and target packet | u13–u14 | ready after R3b; dry-run/read-only authorized | one current dashboard dry run, exact-run 0/0/0, D309 visible authority, exact live candidate/disposition packet |
| R4b | controlled proof and close | u15 | R4a + explicit operational authorization for exact live target/disposition | controlled receipts/read-backs/measurements, criterion 5 and close-out |

## Supervisor wave ledger

| Run | Task id / corrections | Host id | Project id | Launch title/time | Worktree/branch | Report | Status | Last cursor |
|---|---|---|---|---|---|---|---|---|
| R4a | pending fresh launch | pending | pending | `Separations R4a — Fresh Rehearsal and Target Packet` / pending | fresh worktree from `feature/03b-live-close` | `reports/r4a-fresh-rehearsal-and-target-packet.md` | briefed | none |
| R4b | not briefed; fresh supervisor required | — | — | — | fresh worktree after R4a integration | `reports/r4b-controlled-proof-and-close.md` | blocked on R4a packet + exact operational authorization | none |

## Dispatch ledger
R2 used one compact nested `sup_supervisor` because serial runtime access and two worker slots sufficed. That historical supervisor was reused through R3b, but the operator superseded that launch policy on 2026-09-02: every new run now gets a newly created standalone supervisor task. R4a and R4b are serial and each gets its own fresh task/worktree. R2 reported without source commits. Historical agent id `/root/sup_supervisor_separations_readiness` (native `sup_supervisor`, clean-context launch, 2026-09-02). Report `reports/r2-readiness.md`; evidence `evidence/r2/`; read-only review findings `research/r2-protocol.md`. Coordinator owns board, plan, decisions and canonical status docs; each supervisor owns only its exact report/evidence/research paths.

## Units
- u6 (supervisor): verify storage/authority and full gates; quiesce/restore own dashboard, preserve exact failures and lint results. No source changes without a bounded defect report and coordinator clarification.
- u7 (supervisor): use hr-manage and /ui browser verification to inspect historical 4589 preview and current start door; capture restricted local screenshots and sanitized evidence. Do not start or approve a new run. Leave dashboard available. Exact run ids and authority before UI claims.
- u8 (supervisor with optional native sup_analyst): read-only verification of protocol options and smallest code seams. A concrete proposal must preserve a live filing through Kuali finalization, support separate approvals and scope sweep identity without weakening existing permanent filing keys. Cite source and agreed regression gates. Do not implement or ratify the pending protocol.
- u9 (coordinator): correct stale status from verified records, regenerate roadmap, commit logical doc categories after gates, prepare one concise decision sheet. Historical facts remain historically labeled.
- u10–u12: reserve stable ids for protocol contract/identity, execution approval path, regression proof; detail and brief only after operator decision.
- u13–u15: reserve fresh runtime/rehearsal, individual controlled writes plus measurements, canonical closure; not dispatched.

## Stop and resume
R2 may finish its bounded preparation while overall completion remains blocked on the operator-owned protocol and targets. It must not relabel preparation as rebuild-ready. Nested supervisor returns coherent evidence directly; coordinator owns any necessary final handoff. No inferred real-write approval.

## R2a launch admission
R2 report verified against raw serial log, source config and rendered screenshot on 2026-09-02. Reuse the idle native supervisor with the new brief `briefs/r2a-gate-reliability.md`; unique report `reports/r2a-gate-reliability.md` and evidence `evidence/r2a/`. Source remains `85d3b082`; all current changes are coordinator docs and R2 evidence. Sequential primary runtime exception continues.

- u16 — supervisor-owned gate reliability: diagnose the repeated full-coverage timeouts. Compare focused covered cases and a full suite with bounded worker scheduling; this is a hypothesis, not a preset fix. Change only proven runner scheduling or affected fixture/scanner performance, preserving all assertions, 30s deadlines, coverage floors and test membership. A broad redesign or unexplained persistent failure returns evidence; no unrelated source changes. Reviewer decision follows actual diff.

## R2/R2a received
2026-09-02: exact reports and raw default coverage output verified, config/twin diff reviewed, UI screenshot inspected, runtime-after authority checked. R2a uses the same `/root/sup_supervisor_separations_readiness` via explicit followup after R2 completed; no sibling supervisor/worker branches. R2 code commits: none. R2a code: `5853ef80`. Canonical authority correction: `9321fe2f`. Coordinator receive report records classifications and review; no master integration or push while overall controlled proof remains open. Next R3 is still gated by the decision sheet; no brief/dispatch exists beyond that dependency.

## R3a re-sizing and launch
2026-09-02: the operator explicitly rejects repeat approvals when a supplied EID matches and requires approval for name-only selection. This clears u10 (owning contract ratification), u11 (central typed identity/execution seam), u12 (real run/gate/receipt regression and visibility). Exact scope is briefs/r3a-eid-approval-policy.md. Existing real composition test seams remain approved. u17/u18 own the separate sweep/filing protocol residue; no per-write approval nodes should be implemented for the EID-matched path. Reuse `/root/sup_supervisor_separations_readiness`, native sup_supervisor, local nested launch via followup, same sole checkout/branch. One compact serial run, report reports/r3a-eid-approval-policy.md, evidence evidence/r3a/. Earlier launch/resume text describes prior authority and is superseded by this explicit correction.

## R3a received / R3b dispatch admission
R3a integrated u10–u12 in commits `47c47666`, `f785a029`, `233cde61`, `8063fb5f`, `5931a695`; proof `36f0562f`. Report and receive record prove gates/review/runtime. R3b exact brief `briefs/r3b-sweep-and-filing-survival.md`, units u17/u18, same nested native supervisor and established primary checkout exception. Exact live target/disposition is deliberately deferred to R4 and does not block safe implementation/tests.

## R3b received / R4a dispatch admission
R3b integrated u17/u18 in `1bda8afb`, `730a5030`, `4e00d145`, `f2eee0ae`; proof `4d4804ec`. R4a brief `briefs/r4a-fresh-rehearsal-and-target-packet.md`, units u13/u14, uses a fresh standalone supervisor worktree. It may start exactly one dashboard `dryRun=true` run and perform read-only inspection of the exact current candidate set `4593, 4579, 4564, 4544, 4502, 4495`; no gate approval or HR write. u15 remains dependent on the exact operator-facing packet and explicit operational authorization, and R4b must launch under another fresh supervisor.
