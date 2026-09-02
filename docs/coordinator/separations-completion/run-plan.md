# Run plan — separations completion — 2026-09-02

| Run | Theme | Units | State / needs first | Acceptance |
|---|---|---|---|---|
| R1 | original controlled completion | u0–u5 | historical partial; reports and §§9.33–9.36 | u0 landed; old u2 proof; u3–u5 blocked |
| R2 | make readiness concrete and inspectable | u6–u9 | received; u7/u8/u9 proved, u6 closed through R2a | current gate table, existing preview visible, exact implementation proposal, reconciled status |
| R2a | restore a reliable unchanged full-suite gate | u16 | complete, code `5853ef80`, report verified | default full coverage green with assertions/floors/timeouts preserved; lint and current runtime restored |
| R3 | implement approved safe proof protocol | u10–u12 | blocked on protocol decision from R2 | real sequencer and run/gate/receipt regression proof, supported individual approvals, safe sweep scope; no real writes |
| R4 | fresh rehearsal and controlled proof | u13–u15 | R3 + operator targets and individual approvals | fresh rehearsal, controlled-write receipts/measurements, criterion 5 and close-out |

## Dispatch ledger
R2 uses one compact nested `sup_supervisor` because serial runtime access and two worker slots suffice; no new user-owned task is requested. Primary checkout exception is in profile. R2 reported without source commits. Agent id `/root/sup_supervisor_separations_readiness` (native `sup_supervisor`, clean-context launch, 2026-09-02). Report `reports/r2-readiness.md`; evidence `evidence/r2/`; read-only review findings `research/r2-protocol.md`. Coordinator owns board, plan, decisions and canonical status docs; supervisor owns report/evidence/research only.

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
