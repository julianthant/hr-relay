# R2 — separations readiness for operator inspection

**Status: useful inspection and protocol proposal delivered; integrated readiness gate remains RED.** R2 preparation does not close criterion 5. The coordinator owns a focused R2a follow-up for the repeated suite timeouts and R3/R4 for the pending protocol, implementation and individually approved live proof.

Date: 2026-09-02. Supervisor: nested `/root/sup_supervisor_separations_readiness`. Repository `/Users/julianhein/Projects/hr-automation-rebuild`, branch `feature/03b-live-close`, source `85d3b0829d34f327f594c77c7e782ae28a8e2a1e`. Primary-checkout runtime exception from `project-profile.md`. Report/evidence/research only; no runtime source, test, config, registry or environment edits. No new workflow run, live write, retry, gate approval or protocol ratification.

## Unit proof

| Unit | Result | Evidence |
|---|---|---|
| u6 — current gates/runtime | Gates executed; full coverage red twice. Dashboard restored, HTTP 200 on 3938 bootstrap and 5174 frontend. Storage healthy generation 2020/current compatible backup gap 0, span streams reconciled 19/19. Write counts remain 0/0/0. | `../evidence/r2/gate-observations.md`, `storage-before.json`, `storage-after.json` |
| u7 — real dashboard inspection | Exact historical 4589 run/receipt, Logs, Run data and current Start Run options/steps inspected; no new run. Browser closed; dashboard left available. | `../evidence/r2/ui-inspection.md`, `screenshots.json` |
| u8 — safe protocol and code seams | Source conflict verified; exact target selection/key, controlled-proof approvals, surviving filing receipt and explicit target-disposition proposal recorded. One native read-only analyst contributed source review; supervisor owns consequential judgment. | `../research/r2-protocol.md` |

## Gate table

| Command | Verified result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0, zero warnings gate |
| `npm run build:manifest:check` | exit 0, current manifest |
| `npm run test:parity` | exit 0, **287 passed**, assert mode, no reference regeneration |
| `npm run roadmap:check` | exit 0 after coordinator regeneration; repeated after final coordinator status changes |
| `git diff --check` | exit 0 |
| `npm run test:coverage`, first run alongside typecheck/lint | exit 1; 384/388 files passed; 4,786 tests passed, 3 failed, 6 skipped / 4,795 |
| `npm run test:coverage`, rerun alone | exit 1; **386/388 files passed; 4,788 tests passed, 1 failed, 6 skipped / 4,795** |

The serial red is a 30,000 ms fixture `beforeAll` timeout at `tests/unit/server/dashboard-perf-fixture-shape.test.ts:36` (six skipped cases) and a 30,000 ms test timeout at `tests/unit/architecture/guard-manifest.test.ts:195` (required ratchet arms/violating fixtures). First-run descriptor BYTE-drift and runtime-inventory timeout cases cleared in the serial rerun. The old storage-singleton failure did not recur. Overlap is not a proved cause; serial failures remain. No timeouts, assertions, worker configuration, coverage floors or baselines were weakened. No coverage percentages or suite-size pass is claimed from a failed suite. Exact raw logs remain under ignored `.screenshots/separations-2026-09-02/r2-*.log`; sanitized details are in the gate evidence.

**NEEDS COORDINATOR — gate follow-up:** diagnose the repeated timeouts in a bounded run. The coordinator has assigned R2a; R2 stopped source work safely and restored the runtime. No further full-suite rerun or speculative fix was attempted.

## Operator inspection door and limits

Open:
`http://localhost:5174/?day=2026-09-01&run=ca6a5462-4e52-43b7-ac85-f9bdb7fd30cf`

This verified deep link selects the historical run. If the left queue shows another workflow due to browser preference, select **Workflow Panel → Separations**. Use **Logs** and **Receipt** in the run panel. Trace `sp-155454-ca6a`; receipt `0fa49971-bd6a-5a80-8c23-6392614d46c7`; attempt 1. The coordinator can open this URL for the operator; no code change is needed for inspection.

| Subject | Run / attempt | Authority state | Gate | Writes | Result | Next action |
|---|---|---|---|---|---|---|
| Historical doc 4589 | `ca6a5462…` / 1 | terminal `done`, `dryRun=true` | none open; historical identity gate was resolved | no intents/attempts/outbox; global and exact-run 0/0/0 | receipt partial/unknown, `DRY_RUN_PREVIEW` | Inspect existing Logs/Receipt only; fresh proof after final implementation |

The preview stopped at `clear-pending`'s present probe before staging; it does not prove filing or finalization. Current receipt verification leaves the first transaction and downstream mandatory obligations unknown. Historical descriptor fingerprint `0e750f535bf9d1f94be1ce1de83469c698a7fa9d6c7f0768cd9dab62afe458f6` differs from served/source `955991960b7b388ac4f44e64badd0ce895288797e5eb327bc9d6c5f0ccb7c6f1`. R2 did not reobserve live 4589 availability or register it as the replacement controlled canary.

The **Run data** rail still says “No run data recorded — this run has not extracted or written any fields yet,” while Logs and Receipt visibly show extracted data. This is a concrete future UI wording/projection seam, not a reason to mislabel authority. Start Run exposes numeric-document input, Options and optional Steps; the inspected fresh modal had Dry run unchecked, capture checked, Interactive priority and Headed mode. No confirmation was reached. Required steps: Kuali extraction, Identity check, Job summary; optional steps: Kronos timecard, UCPath transaction, Kuali finalization. Screenshots contain person data and remain ignored/local; sanitized hashes are committed-ready.

## Pending protocol and authorized implementation

The existing D287 filing→delete-that-filing→Kuali-finalize sequence can leave Kuali citing an absent filing; §9.36's real-sequencer/fake-driver diagnostic remains the red safety expectation. Adding gates and changing only the key would not cure it.

Recommended proposal, not ratified: independent deletion proof on an exact separately approved disposable transaction/set; preserve the actual filing through Kuali finalization; explicitly choose reversible restored targets or a narrowly named retention exception in write-safety §3.2 for the intended real outcome and disposable target. No blanket waiver, new target or per-write approval is inferred. The coordinator's single decision sheet is `../decisions/2026-09-02-controlled-proof-protocol.md`.

Implementation/test seams were already authorized, so no repeat permission request is needed once protocol is chosen. Research names the smallest contract, driver selection, controlled-proof graph/gate, receipt and test seams. Generic sequencer permanent-key reuse and filing keys remain intact; deletion key and actual selected rows bind to the exact approved live set, with refusal on drift. Per-write approvals belong to the supported controlled-proof composition; the ordinary one-identity-gate UX is preserved unless an explicit further product decision changes it. D265/D266 harness placement must be resolved without a test-only rail. Finalization needs a surviving true filing, not an operator-asserted omission substituted as controlled evidence.

## Reviews, git, board and cleanup

- Native role guard passed: `codex: role policy valid (1 supervisor + 4 workers)`.
- Child: `/root/sup_supervisor_separations_readiness/sup_analyst_u8_protocol_sources`, native `sup_analyst`, Terra/high, read-only. No worker commits/files or additional scouts. Supervisor verified its consequential source conclusions and extended the proposal to actual browser selection and target disposition.
- Code review skipped: this run changed only evidence/research/report text; no implementation diff exists. Consequential protocol source review was performed as above. Browser proof was through ui's playwright-cli route; runtime through hr-manage.
- Worktree-sweep read-only audit: sole primary checkout; sole feature branch `feature/03b-live-close`, three inherited commits ahead of master (`3ebe9f78`, `1008aebd`, `85d3b082`). No worktree/branch to remove, merge, or prune. Master remains `769e23c9`. No push, staging, merge or commit by R2. Coordinator explicitly requested evidence-only return for its logical explicit-path commits.
- Shared tree is intentionally dirty with coordinator-owned docs plus R2 artifacts, not a clean integrated close. See `../evidence/r2/git-inventory.md`. No source/config/test/script diff was present. Full readiness is not claimed.
- Exact read-only board: `docs/coordinator/separations-completion/board.md`. At intake and final reread, committed blob `f2b9d7698e066cf9b50175898dd6f9b9ddfb6dd0`, working blob `e3c4a2673c049007d1a2c869c5f476d0dc77044a`; dirty coordinator intake was predeclared, no material scope change. R2 never wrote/staged/committed the board.
- No consumed handoff was deleted: unresolved protocol/controlled-proof recovery obligations remain. No new handoff required for this nested return.
- Runtime safe state: launcher PID **31057**, BFF **31140**, Vite **31118**, exec session **11477**. No workflow worker started. No owned browser remains. Session Panel has historical expired/failed worker-card residue; no worker cleanup/authority mutation performed. The sole browser console error was favicon HTTP 404.

**Return disposition:** R2 report/evidence/research are ready for coordinator verification and commits. Proceed with bounded R2a gate remediation; keep protocol/targets and real-write approvals operator-owned. Do not relabel this preparation as rebuild-ready.
