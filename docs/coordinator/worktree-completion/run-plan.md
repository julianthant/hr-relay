# Worktree completion run plan — 2026-08-30

Operator direction: fork supervisors for every remaining worktree and finish all, including R2 parity.
Profile: /Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/project-profile.md.
All runs below have cleared INITIAL intake dependencies; their internal live/integration stages
remain sequenced. No parallel writer shares a checkout.

| Run | Assignment | Start head | Initial needs first | Integration target | Status |
|---|---|---|---|---|---|
| r2 | R2 recovery, its existing parity child, and separately gated 4537 closure | 6f79b445 | — | codex/r2-4537-controlled-close → coordinator integration/03b | received63142ae7 software-ready; child swept; live admission residue |
| dcr | Receive and finish the completed R-DCR branch for integration | 6d1e3ca8 | — | codex/r-dcr-authority-close → coordinator integration/03b | branch-local accepted8839fddb; q4 closed; shared history integration pending |
| dca2 | Finish the interrupted DCA2 gallery implementation | eda17b27 | — | feature/dca2-screenshot-gallery → coordinator integration/03b | OPEN scoped19/UI proof only; full gates held for prerequisites |
| dca4 | Finish the interrupted DCA4 Archive evidence implementation | eda17b27 | — | feature/dca4-archive-evidence → coordinator integration/03b | fullcoverage05 RED5/3634; released/bounded repair and diagnosis |
| dcc1 | Reconcile the alternate strict Settings/apply and command-ingress implementation | 0c115123 | — | feature/r-dcc-dcc1-exclusive → coordinator integration/03b | F7c0b5ae741 verified ready; reserved after DCA2, not OPEN |
| dcc2 | Reconcile the alternate preflight/storage-diagnosis implementation | ac40292b | — | feature/r-dcc-dcc2-exclusive → coordinator integration/03b | branch-local acceptedc9af958a; idle; display/shared integration residue open |
| dcc4 | Reconcile the alternate safe Explorer-edit implementation | 49c6206c | — | feature/r-dcc-dcc4-exclusive → coordinator integration/03b | branch-local received68386456; idle; shared history pending |

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

Latest scheduling: **DCA2 OPEN scoped19/browser receive ONLY; DCC1 NEXT, not OPEN**.
DCA4 coverage05 exit1/5failed3634tests/4failed325files/266.74s verified; no fullparity, slotreleased.
Own explicit image-loading and new-wire redaction registration/canary repairs authorized;
conditional exact Duo4runtime+3fixture selected-hunk port after focused matchingred, preserve
different subject/chain fixtures and default auth behavior. Both artifact route consumption paths
remain read-only diagnosis; generic DCA1 binding centrally owned, no invented pending row.
DCA2 same missing Duo seam source-verified, no local focused red yet; freeze19browser proof,
then release before prerequisite/architecture assessment/fullcoverage. Details in readiness reports.

Historical admission before full05 result:
Gate04 scoped assertion11/11, both actual/ref PNG pairs, geometry/contrast floors and decoder
expected-red/exact-restored positive received. Truncated1,426-key before-map is invalid and kept;
coordinator recomputed1,622 protected paths to recorded-before68ea761f and exact23317-byte e2c03.
The evidence stop was followed by generic-approval miscommunication; disclosed, not retroactively
ratified. Slot released for audit, then freshly allocated remaining abort404/exactrestore/positive,
parent receive and full coverage/full asserted parity. Gate05 remaining abort control now verified:
22340 intended tuple-red, immediatee2c03 restore/42089positive1pass2.4s; parent fullcoverageGO given,
both controls complete; no unnecessary repeats. Subsequent full failure/disposition is above.
No repeated decoder mutant or invented before-map rows authorized.
DCA2 G15 raw17pass/2reference-only failures19.9s and G16 two-triplet update2pass4.4s verified;
both gallery PNG/a11y sets directly reviewed. Independent UI Finish clears scroll-boundary
appearance but retains keyboard/touch proof gaps and thumbnail hover defect. Bounded local
hover/nearest lesson/additive existing19spec repair approved; review/lights/new identity before
reallocation. G17/G18 three-file hover/proof delta536efd/full15a9c224, all14pins/6refcopies,
three independent static reviews0, parent70 and locked lights now verified; DCA2 reserved NEXT.
Browser unrun and original UI acceptance findings open. G16 refs remain provisional.
Old DCA4 d158 is not a valid restore target; current scoped acceptance is not full-suite proof.
DCC1 F7b c9fb464e and
closure6e48c112/exact4+3Duo blob delta verified; normalized worker and parent15/typecheck/lint0
receipts read. All eight axes now received: seven0, Tests two medium sensitivity gaps. Bounded
temporary-file crossing and stale-configIdentity/resolveGate test-only follow-up confirmed;
productionec2933b2 frozen. Latest F7c callback reports final0b5ae741/closure36ec6220,17tests0,
locked91624typecheck/59056lint0 and original Tests/Standards0 now received. Coordinator reproduced
index/closure/dependency graph/browser hashes and guard-only mutation diffs; DCC1 reserved after
DCA2, not OPEN. Mutation blobs reconstructed/hash-matched at receive, not originally retained.

Branch-local supervisors continue; no new dispatch or worktree is needed for that work. Coordinator
receives readiness/final returns using the existing task IDs on the board. R2, DCR, DCC2 and DCC4 returned and
are idle; DCR8839fddb accepted branch-locally after3831-test coverage,265-case parity andq4Count0.
Exact full-range raw-log exception is documented in reports/dcr-receive.md. DCC2 full gates passed
339files/3831tests and239 parity on56ba; slot released before UI/report/commit closure. Loaded
detail inspection exposed a pre-existing undisplayed spanAuthority arm; commit may proceed with
explicit open residue, not unconditional UI acceptance. Final cleanc9af958a is accepted:139paths
evidence-only beyond merge0b9a4de7/exact56ba/parents, independent Docs0; exact667diagnostics/74files
and four hashes verified, full source closure unchanged. See reports/dcc2-receive.md. DCC4 coverage then failed1/3718: a surviving dormant
schema module lacks a redaction inventory disposition (initial deleted-file account corrected).
Released with no parity; repair/review/new readiness required. DCA2 G12 then failed4/19
(two refs, reopen status-count and canceled JPEG download), released without update/coverage.
DCA4 then ran assertion02 on reverified HTTP/oracle candidate:9passed2failed14.1s, desktopa11ydrift
and phone Close41.84375<44px. Released before updates/mutants/coverage; no current heavy owner or
next-ready reservation. Local touch repair needs regression/delta review/lights/new identity.
Subsequently DCA4 received ONE phone-case browser diagnostic allocation with temporary observation,
unchanged assertions, exact d158e014 restoration and immediate release; no full gate/probe loop.
That probe measured FOOTERClose41.84375×44/minWidthauto with no scaling; headerClose44×44.
Raw evidence and exact restore verified, slot released before bounded local repair. DCC4 renewed
9ede08fa guard inventory repair/review/light proof is verified and NOW allocated full coverage→
asserted parity. Existing retention exceptions only, no runtime/history/matrix change; see
reports/dcc4-readiness.md. DCA4 touch repair then returned verified UI2cae368f/backend19f0/specd158,
five affected reviews0/164-test and light receipts; reserved NEXT, no rendered-size acceptance.
DCA2 G13/G14 verified tracked14e0/full2232606e, five repair and five preserved companion hashes,
seven reviews0/70-test and light receipts; reserved after DCA4, native JPEG browser proof unrun.
Exact future sequencing/restoration/reference policies remain in each readiness report. No probes
or heavy commands before explicit OPEN; current DCC4 ownership unchanged.
Subsequent M4 terminal release: renewed coverage336files/3721tests323.84s and239parity3.3m raw
summaries/hashes verified against unchanged9ede; both exits0 reported. Final report/commit proof
still pending. Renewed M4 durable sessions95081/84166 and explicit unsetPARITY command now read;
all18 new archives independently hash/decompress/cmp/header-check pass before commit. One manifest
Duo exit/count wording correction requested; no log changes. Slot NOW explicitly opened to re-pinned DCA4 touch
candidate2cae368f/specd158, DCA2 NEXT only. See both readiness reports; no shared history approval.
DCA4 scoped03 now2 reference-only failures/9passes14.2s; coordinator verified raw590a978d and
pre-capture geometry/decode/download assertion order with unchanged spec. Retain slot for existing
two-triplet protocol; no pixel/full acceptance yet. DCC4 product merge858bd7d0 verified exact
entire9ede tree and ordered49c/13175 parents; manifest wording corrected, final evidence receive pending.
DCC4 evidence commit a14aec0a and location correction68386456 now verified, current clean.
Original not-ignored test-results destination refused before move; existing .gitignore:43 admits
tests/parity/.output/dcc4-raw-evidence. All18 committed archive/decompressed hashes and exact moved
plaintext bytes independently match. Scratch is disposable by future parity, committed archives
durable; no wider cleanup. Final supervisor handback remains pending.
Final DCC4 handback now accepted at68386456: main/M4/reviews/history and clean git/full-range checks,
65artifactlinks and presence-only resource inventory verified; see reports/dcc4-receive.md.
Source retained under OPENhistory dependency. DCA4 subsequent deliberate update11passed was rejected
by detailed desktop PNG review for caption overlay; refs unaccepted, no positive assert/404/full
gates followed, slot released. Coordinator viewed saved PNG/read source and approved bounded local
caption/image separation+declared-token repair with DOM/browser regression seams and fresh reviews/
lights/newhash. No unallocated browser. DCA2 NOW allocated after complete input re-pin, same native
Sol focused19 first; no next reservation. Latest readiness reports supersede older queue snapshots.
DCC1 final review/light receipts and488fecfa tree/closure/dependency identities were verified, but
coordinator found the exact missing4runtime+3fixture Duo additions from845ca5a1. Readiness held for
focused synthetic reproduction. Actual F7 red is DIFFERENT: absent dashboard-activated runtime
generation before Duo,2failed/6passed; parent reproduced. Index68c6147b adds only its report,
executable closure unchanged. Conditional Duo port withheld. Read-only single-seam proposal must
join scenario start to selected Settings/current/runtime before start effects, preserve dashboard
activation, and identify public-runtime refusal/nondefault-success tests. No implementation/test
writing, fixture seed, auto-activation or credential setup authorized by this proposal request.
F7a subsequently verified existing interfaces/owner support: bounded F7b runtime.start join and
public admission/nondefault Settings tests/lesson now approved, not activation-policy expansion.
Reuse exact active snapshot under existing final transaction/file fence before start effects;
preserve worker/core/CLI/dashboard/blocked path. Duo remains conditional on its distinct later red.
See reports/dcc1-runtime-admission.md for acceptance matrix and exclusions; renewed independent
review/light/full-gate readiness still required, no allocation or pre-gate product commit.
Two planned404 controls remain unrun and need future allocation plus a reviewed restoration hash
if the spec changes; protocol remains in reports/dca4-readiness.md. No weakened geometry floor.
DCA2 released after focused parity7/19, then test/fixture-only G10/G11 repair/review/light proof
was verified at b935c86f/28501bd5; G12 proved stable origin/exactURLs/decode through a11y comparison,
not pixel clearance. No coverage/refupdate ran. Its new owned fixture-bff repair may overlap DCA4
at final aggregation; preserve both test/fixture intents by exact provenance. DCC2 repaired the seven-line prerequisite and
renewed verified56ba105f passed full gates; branch receive complete, shared integration remains. DCC4 fixture/Duo
reviews and fresh light receipts remain historical proof; its red full gate requires repair. Other full coverage/parity
needs an explicit slot, then the OS lock. Final shared integration/cleanup still requires the operator's migration
history disposition in `decisions/2026-08-30-migration-history-integration.md` (OPEN/UNAPPROVED).
R2 runtime provisioning and controlled HR approvals remain a separate unresolved boundary.

## Launches
Launch form: same-directory fork reusing an existing isolated worktree. Task IDs are recorded in
board.md; exact paths are in each brief. No additional checkout was created by the seven forks.
