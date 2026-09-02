# Run plan — separations completion — 2026-09-02

| Run | Theme | Units | State / needs first | Acceptance |
|---|---|---|---|---|
| R1 | original controlled completion | u0–u5 | historical partial; reports and §§9.33–9.36 | u0 landed; old u2 proof; u3–u5 blocked |
| R2 | make readiness concrete and inspectable | u6–u9 | received; u7/u8/u9 proved, u6 closed through R2a | current gate table, existing preview visible, exact implementation proposal, reconciled status |
| R2a | restore a reliable unchanged full-suite gate | u16 | complete, code `5853ef80`, report verified | default full coverage green with assertions/floors/timeouts preserved; lint and current runtime restored |
| R3a | implement corrected identity approval policy | u10–u12 | complete at `36f0562f`; received | D309, machine verification/name-only gate, 4,809 coverage + 287 parity |
| R3b | sweep scope and surviving filing proof | u17–u18 | complete at `4d4804ec`; received | D310 exact-set/fresh-filing mechanics, 4,818 coverage + 287 parity |
| R4a | fresh rehearsal and target packet | u13–u14 | received partial at `fcfd1e5f`; submit-free 4502 run failed missing `source` provenance before D309/D310 | immutable failure evidence, exact-run 0/0/0 |
| R4b | dates checkpoint provenance repair | u19 | complete at `73954594`; received/merged `31da1fe8` | exact red/green regression, one-line repair, 4,819 coverage + 287 parity |
| R4c | post-repair rehearsal and target packet | u14 | complete/received `8962c70e`; 4495 proved repair + D309, failed D310 unreadable, 0/0/0 | immutable live evidence; no target packet |
| R4d | Smart HR settlement diagnosis/repair | u20 | admitted from exact R4c failure; no workflow retry | read-only live state map, deterministic red/green, smallest repair, full gates/review |
| R4e | post-R4d 4495 rehearsal and target packet | u14 | blocked on R4d integration; same exact 4495 dry-run/read-only authority | one 4495 dashboard dry run, exact-run 0/0/0, complete D309/D310 packet |
| R4f | controlled proof and close | u15 | R4e + explicit operational authorization for exact live target/disposition | controlled receipts/read-backs/measurements, criterion 5 and close-out |

## Supervisor wave ledger

| Run | Task id / corrections | Host id | Project id | Launch title/time | Worktree/branch | Report | Status | Last cursor |
|---|---|---|---|---|---|---|---|---|
| R4a | setup client `client-new-thread:97be6d8a-f75f-4200-92c3-709a0d9e1b4f` → canonical `01a0637f-5933-7db2-abf9-2a98a802040e` | `local` | `e23dea50-674d-4a39-ad94-49fcff726de8` | `Separations R4a — Fresh Rehearsal and…` / 2026-09-02 12:02 PDT | `/Users/julianhein/.codex/worktrees/8164/hr-automation-rebuild`, `feature/r4a-fresh-rehearsal-and-target-packet` | `reports/r4a-fresh-rehearsal-and-target-packet.md` | received/merged `fcfd1e5f` | none |
| R4b | setup client `client-new-thread:37f37e61-3d05-4f72-b47e-cf779bb011af` → canonical `01a063aa-212d-7672-a5f2-c8e9c338cc81` | `local` | `e23dea50-674d-4a39-ad94-49fcff726de8` | `Separations R4b — Dates Provenance Repair` / 2026-09-02 12:48 PDT | removed after merge; `feature/r4b-dates-provenance-repair` deleted | `reports/r4b-dates-provenance-repair.md` | received/merged `31da1fe8` | none |
| R4c | setup client `client-new-thread:26408a4c-96fd-4a32-b3fa-b4f73f7b6c73` → canonical `01a063c4-7ae3-7970-9843-83704a8841d5` | `local` | `e23dea50-674d-4a39-ad94-49fcff726de8` | `Separations R4c — 4495 Post-Repair Rehearsal` / 2026-09-02 13:16 PDT | removed after merge; `feature/r4c-post-repair-rehearsal` deleted | `reports/r4c-post-repair-rehearsal.md` | received/merged `8962c70e` | none |
| R4d | setup client `client-new-thread:a7217046-4f3e-4edf-b86c-18ee01ad0407`; canonical pending | `local` | `e23dea50-674d-4a39-ad94-49fcff726de8` | `Separations R4d — Smart HR Settlement Repair` / 2026-09-02 13:41 PDT | worktree setup from `feature/03b-live-close` | `reports/r4d-smart-hr-settlement-repair.md` | queued | none |
| R4e | not briefed; fresh supervisor required | — | — | — | fresh worktree after R4d integration | `reports/r4e-post-repair-rehearsal.md` | blocked on R4d | none |
| R4f | not briefed; fresh supervisor required | — | — | — | fresh worktree after R4e integration | `reports/r4f-controlled-proof-and-close.md` | blocked on R4e packet + exact operational authorization | none |

## Dispatch ledger
R2 used one compact nested `sup_supervisor` because serial runtime access and two worker slots sufficed. That historical supervisor was reused through R3b, but the operator superseded that launch policy on 2026-09-02: every new run now gets a newly created standalone supervisor task. R4a, R4b, and R4c each used their own task; R4d, R4e, and R4f remain serial and each gets another fresh task/worktree. R2 reported without source commits. Historical agent id `/root/sup_supervisor_separations_readiness` (native `sup_supervisor`, clean-context launch, 2026-09-02). Report `reports/r2-readiness.md`; evidence `evidence/r2/`; read-only review findings `research/r2-protocol.md`. Coordinator owns board, plan, decisions and canonical status docs; each supervisor owns only its exact report/evidence/research paths.

## Units
- u6 (supervisor): verify storage/authority and full gates; quiesce/restore own dashboard, preserve exact failures and lint results. No source changes without a bounded defect report and coordinator clarification.
- u7 (supervisor): use hr-manage and /ui browser verification to inspect historical 4589 preview and current start door; capture restricted local screenshots and sanitized evidence. Do not start or approve a new run. Leave dashboard available. Exact run ids and authority before UI claims.
- u8 (supervisor with optional native sup_analyst): read-only verification of protocol options and smallest code seams. A concrete proposal must preserve a live filing through Kuali finalization, support separate approvals and scope sweep identity without weakening existing permanent filing keys. Cite source and agreed regression gates. Do not implement or ratify the pending protocol.
- u9 (coordinator): correct stale status from verified records, regenerate roadmap, commit logical doc categories after gates, prepare one concise decision sheet. Historical facts remain historically labeled.
- u10–u12: reserve stable ids for protocol contract/identity, execution approval path, regression proof; detail and brief only after operator decision.
- u13 — R4a live rehearsal attempt, now immutable submit-free failure evidence.
- u14 — exact target packet, carried from incomplete R4a into post-repair R4c; R4c execution terms follow below.
- u15 — controlled writes, measurements, and canonical closure in R4f after exact authorization.
- u19 — R4b dates-provenance repair: build a deterministic red replay/test for missing `source` provenance, apply the smallest root fix, prove red/green, run complete gates and correctness/silent-failure review. No runtime-row edits or live retry.
- u14 — R4c post-repair live proof: use exactly document 4495 for one dashboard-started `dryRun=true` run; no substitution or retry. Prove exact-run 0/0/0, D309 authority, D310 packet, and cleanup. If unavailable or defective, return exact evidence without broadening scope.
- u20 — R4d Smart HR settlement repair: start from exact R4c immutable failure, live-verify the current read-only SS Smart HR page state, reproduce it at the narrow driver seam, implement the smallest proven fail-loud repair, and run complete gates/review. No workflow retry.

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
R3b integrated u17/u18 in `1bda8afb`, `730a5030`, `4e00d145`, `f2eee0ae`; proof `4d4804ec`. R4a brief `briefs/r4a-fresh-rehearsal-and-target-packet.md`, units u13/u14, uses a fresh standalone supervisor worktree. It may start exactly one dashboard `dryRun=true` run and perform read-only inspection of the exact current candidate set `4593, 4579, 4564, 4544, 4502, 4495`; no gate approval or HR write. u15 remains dependent on the exact operator-facing packet and explicit operational authorization. Any successor run must launch under another fresh supervisor.

## R4a received / R4b repair admission
R4a canonical task `01a0637f-5933-7db2-abf9-2a98a802040e` committed sanitized report/evidence at `3c3c7152`; the coordinator verified a clean branch, no browsers, healthy/current generation 2280 storage, 24/24 reconciled streams, and zero pending commands/write intents/outbox, then merged it at `fcfd1e5f`. The run-data authority proves 4502 reached authenticated New Kronos timecard read and then failed because `workflow:separations/read-separation-dates` recorded no provenance for output field `source`. Fresh R4b owns u19 under `briefs/r4b-dates-provenance-repair.md`; R4c owns the live retry/target packet after integration. R4d replaces the earlier unbriefed controlled-proof R4b label.

## R4b received / R4c dispatch admission
R4b canonical task `01a063aa-212d-7672-a5f2-c8e9c338cc81` proved the exact immutable failure red, added the one missing `source` data point plus a real-collector regression, passed independent correctness/silent-failure review and the full gates, and completed clean at `73954594`. The coordinator merged it at `31da1fe8`, reran focused 26/26, full coverage 390 files/4,819 tests, parity 287/287, typecheck/lint/manifest/roadmap/diff, restored the dashboard, verified healthy/current generation 2282 and 24/24 reconciled streams with zero pending commands/write intents/outbox, then removed the worktree/branch. The operator's direct instruction selects document `4495` for R4c, replacing 4502 as the post-repair test. R4c is a new supervisor and may run exactly one 4495 `dryRun=true` rehearsal; no fallback document or real write is authorized.

## R4c received / R4d repair admission
R4c canonical task `01a063c4-7ae3-7970-9843-83704a8841d5` started exactly one 4495 dashboard dry run, proved R4b's dates-source checkpoint and D309 machine verification with zero gate rows, then failed safely at D310's pending-set read because SS Smart HR rendered neither a result row nor an explicit empty marker within 45 seconds. Exact writes remained 0/0/0; cleanup and storage health passed; sanitized evidence/report commits `7cffd819` and `a2b80efb` were merged at `8962c70e`, then the worktree/branch were removed. The apparent board conflict in the report was a primary checkout switch to `master`; the coordinator restored `feature/03b-live-close` and reconciled against its current board. R4d is a fresh diagnosis/repair supervisor under `briefs/r4d-smart-hr-settlement-repair.md`; R4e owns the next 4495 retry, and R4f replaces the earlier controlled-proof label.
