# Worktree completion run plan — 2026-08-30

Operator direction: fork supervisors for every remaining worktree and finish all, including R2 parity.
Profile: /Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/project-profile.md.
All runs below have cleared INITIAL intake dependencies; their internal live/integration stages
remain sequenced. No parallel writer shares a checkout.

| Run | Assignment | Start head | Initial needs first | Integration target | Status |
|---|---|---|---|---|---|
| r2 | R2 recovery, its existing parity child, and separately gated 4537 closure | 6f79b445 | — | codex/r2-4537-controlled-close → coordinator integration/03b | received63142ae7 software-ready; child swept; live admission residue |
| dcr | Receive and finish the completed R-DCR branch for integration | 6d1e3ca8 | — | codex/r-dcr-authority-close → coordinator integration/03b | q3 evidence0fcc33c0; exact raw-log whitespace exception verified; q4 pending |
| dca2 | Finish the interrupted DCA2 gallery implementation | eda17b27 | — | feature/dca2-screenshot-gallery → coordinator integration/03b | focused parity7/19; released; scoped locator/URL repair before new allocation |
| dca4 | Finish the interrupted DCA4 Archive evidence implementation | eda17b27 | — | feature/dca4-archive-evidence → coordinator integration/03b | focused parity5/11; released; image readiness/decode repair |
| dcc1 | Reconcile the alternate strict Settings/apply and command-ingress implementation | 0c115123 | — | feature/r-dcc-dcc1-exclusive → coordinator integration/03b | active |
| dcc2 | Reconcile the alternate preflight/storage-diagnosis implementation | ac40292b | — | feature/r-dcc-dcc2-exclusive → coordinator integration/03b | renewed56ba105f reverified; heavy slot OPEN |
| dcc4 | Reconcile the alternate safe Explorer-edit implementation | 49c6206c | — | feature/r-dcc-dcc4-exclusive → coordinator integration/03b | dbd1b32c reviewed/light-ready; NEXT after DCC2, not allocated |

## Dependency order and returns
- R2: receive current parity child → reviewed paired recapture → child merge/full gate → secret
  admission → fresh rehearsal → separately approved controlled writes → evidence close.
- DCA2 and DCA4 may proceed independently on their existing DCA1 base; final DCA aggregation
  includes the retained DCA3 tip 7a85bbd5 and waits for BOTH reports.
- DCA aggregation also owns **dca-shared-bytes**: DCA2's performance review exposed unbounded
  preallocation in `src/server/dashboard/queries/artifact-bytes.ts`'s shared
  `materializeVerifiedArtifactBytes`. The coordinator verified `new Uint8Array(ref.bytes)` occurs
  before stream verification, and that DCA4's Archive caller also uses it. After both component
  reports, assign one bounded shared-serving repair/review unit against all integrated consumers;
  no duplicate DCA2/DCA4 writers. Preserve exact-id, whole-byte verification and refusal semantics
  without inventing a diagnostic-size limit or borrowing the phone-capture cap. This remains
  required before DCA integration acceptance; the future run is not dispatch-ready yet.
- The same shared-serving unit carries DCA2's Standards-low duplicated success/Range416 shaping
  between generic and bundle routes (assigned dca2-g4-initial-axes.md). Consolidation requires
  exact status/header/body/error proof across consumers, or an explicit justified disposition;
  it is neither silently waived nor added to either component's current frozen gate scope.
- DCC1/2/4 map and repair independently, but return schemas/commands may overlap. Final integration
  is serial, preserving reviewed existing control-plane behavior at a9b5395f.
- Reporting is a receive/verify run, not reimplementation. Its current unavailable People result
  is legitimate for the seven ineligible canonical rows.
- Coordinator receives completed reports and checks exact heads/reviews/gates. No root/master
  release merge is included. No run is complete merely because a supervisor has started.
- Final integration/cleanup can be assigned one bounded supervisor run after concrete return
  dependencies clear; this is retained work under the operator's completion authorization.
- Source handoff cleanup occurs only after verified consumption and durable preservation; unresolved
  decision/evidence records stay. The older R2 parity handoff is historical intake, not current
  truth about its now-committed batch.

## Current decision and receive boundary

Branch-local supervisors continue; no new dispatch or worktree is needed for that work. Coordinator
receives readiness/final returns using the existing task IDs on the board. R2 has returned and is
idle; DCR released after verified3831-test coverage and265-case parity at6851990b, with q3/q4
closure remaining. DCC2 now owns heavy at56ba105f; DCC4 dbd1b32c is verified NEXT, not allocated.
DCA4 released after focused parity5/11 and needs image-readiness/decode repair.
DCA2 released after focused parity7/19 (ten ambiguous locators,
two reference failures; ephemeral URL needs diagnosis). DCA2 needs repair/review and new identity
before reallocation; no coverage/refupdate ran. DCC2 repaired the seven-line prerequisite and
renewed verified56ba105f is allocated. DCC4 fixture/Duo reviews and fresh light receipts are
verified; neither candidate has full-gate acceptance yet. Other full coverage/parity
needs an explicit slot, then the OS lock. Final shared integration/cleanup still requires the operator's migration
history disposition in `decisions/2026-08-30-migration-history-integration.md` (OPEN/UNAPPROVED).
R2 runtime provisioning and controlled HR approvals remain a separate unresolved boundary.

## Launches
Launch form: same-directory fork reusing an existing isolated worktree. Task IDs are recorded in
board.md; exact paths are in each brief. No additional checkout was created by the seven forks.
