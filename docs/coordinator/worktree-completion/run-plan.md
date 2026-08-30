# Worktree completion run plan — 2026-08-30

Operator direction: fork supervisors for every remaining worktree and finish all, including R2 parity.
Profile: /Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/project-profile.md.
All runs below have cleared INITIAL intake dependencies; their internal live/integration stages
remain sequenced. No parallel writer shares a checkout.

| Run | Assignment | Start head | Initial needs first | Integration target | Status |
|---|---|---|---|---|---|
| r2 | R2 recovery, its existing parity child, and separately gated 4537 closure | 6f79b445 | — | codex/r2-4537-controlled-close → coordinator integration/03b | active |
| dcr | Receive and finish the completed R-DCR branch for integration | 6d1e3ca8 | — | codex/r-dcr-authority-close → coordinator integration/03b | active |
| dca2 | Finish the interrupted DCA2 gallery implementation | eda17b27 | — | feature/dca2-screenshot-gallery → coordinator integration/03b | active |
| dca4 | Finish the interrupted DCA4 Archive evidence implementation | eda17b27 | — | feature/dca4-archive-evidence → coordinator integration/03b | active |
| dcc1 | Reconcile the alternate strict Settings/apply and command-ingress implementation | 0c115123 | — | feature/r-dcc-dcc1-exclusive → coordinator integration/03b | active |
| dcc2 | Reconcile the alternate preflight/storage-diagnosis implementation | ac40292b | — | feature/r-dcc-dcc2-exclusive → coordinator integration/03b | active |
| dcc4 | Reconcile the alternate safe Explorer-edit implementation | 49c6206c | — | feature/r-dcc-dcc4-exclusive → coordinator integration/03b | active |

## Dependency order and returns
- R2: receive current parity child → reviewed paired recapture → child merge/full gate → secret
  admission → fresh rehearsal → separately approved controlled writes → evidence close.
- DCA2 and DCA4 may proceed independently on their existing DCA1 base; final DCA aggregation
  includes the retained DCA3 tip 7a85bbd5 and waits for BOTH reports.
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

## Launches
Launch form: same-directory fork reusing an existing isolated worktree. Task IDs are recorded in
board.md; exact paths are in each brief. No additional checkout was created by the seven forks.
