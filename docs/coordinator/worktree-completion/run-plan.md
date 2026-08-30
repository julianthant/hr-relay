# Worktree completion run plan — 2026-08-30

Operator direction: fork supervisors for every remaining worktree and finish all, including R2 parity.
Profile: /Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/project-profile.md.
All runs below have cleared INITIAL intake dependencies; their internal live/integration stages
remain sequenced. No parallel writer shares a checkout.

| Run | Assignment | Start head | Initial needs first | Integration target | Status |
|---|---|---|---|---|---|
| r2 | R2 recovery, its existing parity child, and separately gated 4537 closure | 6f79b445 | — | codex/r2-4537-controlled-close → coordinator integration/03b | received63142ae7 software-ready; child swept; live admission residue |
| dcr | Receive and finish the completed R-DCR branch for integration | 6d1e3ca8 | — | codex/r-dcr-authority-close → coordinator integration/03b | branch-local accepted8839fddb; q4 closed; shared history integration pending |
| dca2 | Finish the interrupted DCA2 gallery implementation | eda17b27 | — | feature/dca2-screenshot-gallery → coordinator integration/03b | G10/G11 reverified; heavy slot OPEN, browser rerun unproved |
| dca4 | Finish the interrupted DCA4 Archive evidence implementation | eda17b27 | — | feature/dca4-archive-evidence → coordinator integration/03b | repaired HTTP/oracle candidate verified; queued after DCA2, no slot-open |
| dcc1 | Reconcile the alternate strict Settings/apply and command-ingress implementation | 0c115123 | — | feature/r-dcc-dcc1-exclusive → coordinator integration/03b | active |
| dcc2 | Reconcile the alternate preflight/storage-diagnosis implementation | ac40292b | — | feature/r-dcc-dcc2-exclusive → coordinator integration/03b | merge0b9a4de7 verified exact56ba; evidence review/commit pending, display residue open |
| dcc4 | Reconcile the alternate safe Explorer-edit implementation | 49c6206c | — | feature/r-dcc-dcc4-exclusive → coordinator integration/03b | coverage RED1/3718; released, guard inventory repair |

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
- `dcc-storage-span-visibility`: coordinator-owned OPEN follow-up at dashboard-surfaces §9.8.
  Receive preserves current DCC2 baseline UI; the rich degraded wire is not shown by DoctorReport.
  Exact gated backend commit may proceed with that caveat, but full UI completion is not claimed.
  Before aggregate closure, assess presentation scope against the owner and operator authority;
  any implementation must be separately briefed/reviewed/gated through /ui, not silently added to
  the frozen candidate. Evidence and bounded disposition: reports/dcc2-ui-disposition.md.
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
receives readiness/final returns using the existing task IDs on the board. R2 and DCR returned and
are idle; DCR8839fddb accepted branch-locally after3831-test coverage,265-case parity andq4Count0.
Exact full-range raw-log exception is documented in reports/dcr-receive.md. DCC2 full gates passed
339files/3831tests and239 parity on56ba; slot released before UI/report/commit closure. Loaded
detail inspection exposed a pre-existing undisplayed spanAuthority arm; commit may proceed with
explicit open residue, not unconditional UI acceptance. Merge0b9a4de7 preserves exact56ba and both
parents; final documentation receive remains. DCC4 coverage then failed1/3718: a surviving dormant
schema module lacks a redaction inventory disposition (initial deleted-file account corrected).
Released with no parity; repair/review/new readiness required. DCA2 now
owns heavy after G10/G11 re-pin; DCA4 is NEXT, not allocated.
DCA4 released after focused parity5/11; HTTP/oracle repair is now verified ready and reserved after
DCA2. Two bounded anticipated-red controls are approved only during its future allocation under
the exact restoration/positive-rerun protocol in reports/dca4-readiness.md; browser proof pending.
DCA2 released after focused parity7/19, then test/fixture-only G10/G11 repair/review/light proof
was verified at b935c86f/28501bd5 and rechecked for current allocation. Browser rerun remains unproved;
no coverage/refupdate ran. DCC2 repaired the seven-line prerequisite and
renewed verified56ba105f passed full gates but final branch receive remains. DCC4 fixture/Duo
reviews and fresh light receipts remain historical proof; its red full gate requires repair. Other full coverage/parity
needs an explicit slot, then the OS lock. Final shared integration/cleanup still requires the operator's migration
history disposition in `decisions/2026-08-30-migration-history-integration.md` (OPEN/UNAPPROVED).
R2 runtime provisioning and controlled HR approvals remain a separate unresolved boundary.

## Launches
Launch form: same-directory fork reusing an existing isolated worktree. Task IDs are recorded in
board.md; exact paths are in each brief. No additional checkout was created by the seven forks.
