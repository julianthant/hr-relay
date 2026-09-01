# DCA4 A4 — review ledger (in progress)

Review target is the original `eda17b27` plus explicitly frozen path sets and hashes, not an
unverified branch claim. The backend target is recorded in `dca4-a2.md`; UI will be pinned after
the sole writer returns. Each axis uses its own native read-only reviewer; parent persists results.

| Axis | Backend | UI/final disposition |
| --- | --- | --- |
| Standards | Included in complete-diff pass | 4 original findings independently closed; 0 remaining |
| Spec | Complete-diff pass | 0 findings, native sup_terra; browser proof still required |
| Correctness | 0 findings, native sup_terra | 2 original findings independently closed; 0 remaining |
| Silent failures | 0 findings, native sup_terra | 1 original finding independently closed; 0 remaining |
| Performance | 0 findings, native sup_terra | Structural finding closed; actual rendered geometry remains pending |
| Tests | 2 medium findings; repaired source independently re-reviewed with 0 remaining | 2 UI findings independently closed; 0 remaining |
| Docs | Complete-diff and final UI pass | 1 medium + 1 low independently closed; 0 remaining |
| Security | 0 findings, native sup_sol | 0 findings, native sup_sol |
| Simplify | Skipped | No explicit simplification request or established unnecessary complexity; final gate not yet green |

Detailed axis results live in `dca4-a4-backend-<axis>.md` and retain their independent severity/counts.
No findings are suppressed or reranked across axes. Successful static review is not a substitute for
the queued coverage/parity gate, and no overall approval is claimed yet.

## Frozen UI receipt and released light lane

A3 writer closed before A2 test-only follow-up began. Base/head remains
`eda17b2708286e36542e1e18e9f8ef6a06cf3187`.

Tracked UI diff (`git diff --binary -- src/dashboard/AGENTS.md src/dashboard/client/queries.ts
src/dashboard/surfaces/archive-model.ts src/dashboard/surfaces/archive.tsx
tests/unit/dashboard/archive-render.test.ts tests/unit/dashboard/archive-detail-render.test.ts
tests/parity/helpers/fixture-bff.ts | shasum -a 256`):
`41e10b89b380b1b779471bcb265a352fb720f4f601246c793aca3977de7fd350`.

| New UI file | SHA-256 |
| --- | --- |
| `tests/unit/dashboard/archive-evidence-fixture.test.ts` | `f9fbb19b254032ffccf7aa4ec56e764bd8dcd2bc25e208917c62a46270d059f4` |
| `tests/unit/dashboard/archive-capture-resource-client.test.ts` | `24d91d3aba1b7d22748ac61c6d7ed944fa0b7b8e7c81b9382be464f34e8aeb4f` |
| `tests/parity/helpers/fixture-archive-evidence.ts` | `224c7144203e57b66c3130e3be4d72e9f5b80606751c817a00851dff459a32c7` |
| `tests/parity/archive-evidence.spec.ts` | `f382714beed01d8f363a75f39ba11cfb8897a253309656a70a5891b0d82ddeed` |

Coordinator released the temporary light hold. Parent ran the exact five-file A3 command with
`VITEST_MAX_WORKERS=1`: **exit 0, 5 files / 52 tests, 18.02s**, start 07:25:11 PDT.
Lint is next; coverage/parity still await an allocated slot. All own light commands serialize,
and full lint/typecheck additionally use `/tmp/hr-worktree-light-gate.lock`.

Full lint exited 1: exactly one missing `request` hook dependency in `archive-model.ts:859`.
Full typecheck under the same global lock exited 0. These results precede the requested UI repair.
A2 test-only follow-up is received at routes-test SHA-256
`a456e08d764bc0d212db949ea008b5eec2f819a25cd4b26f1083b16f030aabdc`;
production/backend diff remains unchanged. Focused rerun and red-capable controls are pending.

Parent focused rerun after A2 test repair passed: 2 files / 71 tests, 3.38s (07:28:06 PDT),
`VITEST_MAX_WORKERS=1 HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test --
tests/unit/server/archive-capture-resource.test.ts tests/unit/server/archive-capture-routes.test.ts`.
All first-pass reviewers are now closed. A2 owns the sole temporary-probe/docs/test lane;
A3 is read-only preparation until that ownership returns.

A2 subsequently returned and was closed. Temporary unknown-field and MIME schema controls each
produced exactly 2 intended HTTP `200 !== 500` failures with 36 other route tests passing. Parent
verified all domain/query restoration hashes and clean domain diff. Final backend acceptance with
4 new precedence cases: worker 75/75 pass and focused ESLint exit 0. Updated frozen backend tracked
patch: `19f0a93825bda594f033e24135b65667ac536a931bba11450eb438f284e37c6f`;
only owning-reference clarification changed since original product review. Routes-test hash:
`e0d7d28094586d8adcebc5612820d5d3da8ccffb60badfca6b06a5eb55092a30`.
A3 now owns sole UI write/light-gate lane; backend Docs/Tests rechecks are read-only and exclude UI.

## Final UI repair receipt and parent proof

A3 returned and was closed; no own browser or command remains. Receipt `dca4-a3-repair.md` owns
full red-first/negative-control evidence and the local focus-return diagnosis. No shared DS change.
Final UI tracked patch `d62a186b12275150e1a46c13d49bf165ece44ef404efc29fd9194757f6c9d251`;
four new-file hashes verified by parent against that receipt. Six independent final UI axes now
read the frozen target; no writer is active.

Parent combined acceptance (all five UI files and both backend files, each named in A2/A3 receipts),
`VITEST_MAX_WORKERS=1 HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test -- …`:
**exit 0, 7 files / 151 tests, 10.31s, start 08:00:08 PDT**. Parent full typecheck then lint are
running serially under the shared light lock. Worker final typecheck/lint passed; browser tests
remain prepared, not run. Neither snapshots nor full acceptance are claimed yet.

Parent final full typecheck and lint both exited 0 under the global light lock. Final roadmap
regeneration/freshness and manifest regeneration/no-diff/whitespace chain exited 0. No running
parent command. Final code-axis re-reviews are clear; final UI docs recheck remains pending.

Coordinator approved only SEQUENCING: after readiness AND explicit allocation, scoped 11-case
parity goes first, then full coverage/full asserted parity. This is not slot-open. All six inherited
reference/provenance files are preserved under `evidence/dca4-intake/` before any update. If browser
repair pauses execution, release logical slot immediately. Later shared materializer work is not
implemented or assigned yet; it requires fresh affected integration gates after both component
reports and cannot be certified by these component gates.

## Heavy-gate readiness (not final acceptance)

Every selected static axis is now clear; all reviewers/writers closed. Final Docs caught one low
stale metadata-formatter comment, corrected inline without behavior change. Final UI aggregate:
`54895c9b4210a5444cd9bdb9dbf02ef4be56f8562329bc5f9e882c31875c1f44`.
Comment-stripped TypeScript emission stayed byte-identical (`565c751d…dcc0e`); final focused source
lint passed and independent Docs recheck closed the comment. Four new UI-file hashes stay those
in A3-repair. Backend tracked hash remains `19f0a938…37c6f`, HEAD remains `eda17b27`.

Final raw finding history adds that Docs low to the earlier counts; none is suppressed. All open
static findings: 0. Parent proof: 151 focused tests; full typecheck/lint; manifest clean; roadmap
fresh; whitespace clean. These component lights precede the still-required scoped browser,
two-triplet refresh/assertion, actual PNG/a11y inspection, full coverage and full asserted parity.
Explicit heavy allocation requested; no OS-lock acquisition or browser start yet.

First-pass raw findings by axis: Standards 4, Spec 0, Correctness 2, Silent failures 1,
Performance 1, Tests 4 (2 backend + 2 UI), Docs 1, Security 0. Original counts stay intact even when
one repair resolves independently reported findings. No first-pass completion means final approval.

## Shared-serving boundary

Coordinator requested ownership confirmation for a separately reported inherited unbounded
`materializeVerifiedArtifactBytes` allocation. DCA4 never edited
`src/server/dashboard/queries/artifact-bytes.ts` (verified clean versus HEAD); its improvement only
changes archived resource status to verify-only streaming. The download still uses the inherited
materializer. No new byte cap or phone-policy reuse is authorized here. Coordinator owns any shared
serving repair and its integration; this is explicitly not a DCA4 fix claim.

## First allocated browser gate — red; readiness withdrawn

Coordinator allocated the heavy slot after independently verifying final frozen hashes and lights.
Parent rechecked HEAD, both aggregate patches and all six new UI/backend test hashes; existing
native A3 resumed with `/ui` for gates only. Exact command:

`/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock npm run test:parity -- tests/parity/archive-evidence.spec.ts`

Result: **exit 1, 6 failed / 5 passed, 52.6s**. The two happy image cases never reach a ready image;
both staged geometry cases never begin decode; keyboard and narrow cases never reach success.
All five refusal cases pass. Error contexts show the honest image-load/decode refusal with exact
frozen metadata preserved. This is a non-reference failure, not permission to refresh snapshots.

Parent immediately released the logical slot and coordinator accepted release; DCC2 now owns it.
No reference update, source repair or further heavy gate occurred before release. A3 preserves the
raw log/error contexts in `../evidence/dca4-gates/` and returns hypotheses before a bounded native
`/ui` + `/hr-debug` repair. Existing 151 unit passes and static approvals are historical, not proof
that rendered behavior works. Fresh affected reviews/lights and exact-identity reallocation are
required. Shared materializer, waits, thresholds, byte/decode/geometry/focus invariants stay unchanged.

## Repaired candidate — ready for reallocation, not browser acceptance

HTTP unit receipt `dca4-a3-http-repair.md`: actual ephemeral HTTP proved metadata 200 followed by
byte URL **404 / absent MIME / 9-byte `not found`**. The four-line exact-route dispatch correction
serves the same pinned PNG. Four real HTTP regressions protect byte/header identity, foreign/default
refusal despite static collisions, and neighboring static/API behavior. Old-route and overbroad-route
negative controls fail as intended; all restored. Six independent delta axes are clear in
`dca4-a4-http-review.md`; all reviewers closed.

The browser-oracle repair adds +39/−3 lines only to the spec, preserving all eleven cases and existing
assertions. It requires decoder invocation plus actual natural dimensions, and exact intercepted
Request/abort/failure identity. Two additional raw medium Tests findings are structurally closed;
three independent repaired-delta axes clear in `dca4-a4-browser-refusal-tests.md`. Browser positive
and negative-control execution is still pending allocation. Writer/reviewers closed.

Final HEAD `eda17b2708286e36542e1e18e9f8ef6a06cf3187`; UI aggregate
`2f351365ae5528949fcd6e0f1982b73badb28a8efcd8a4908dbc7144e3d89bb0`; backend aggregate unchanged
`19f0a93825bda594f033e24135b65667ac536a931bba11450eb438f284e37c6f`.
New spec `d158e014dd85b42ae6f42fb5d02aaf2a54408f348e4ab008627eb25ce8db6de1`;
fixture test `61aa88751464f01106ac34db39fa9792f37c32480170ec491cfe4abf2cdc1d1f`.
Canonical PNG fixture/client/backend tests unchanged from prior receive.

Parent final combined focus: **8 files / 164 tests, exit 0, 10.04s, 08:20:50 PDT**;
exact invocation/output excerpt in `../evidence/dca4-gates/parent-repair-focused.txt`.
Parent then ran serial full locked typecheck, full locked lint, manifest regeneration/no-diff,
roadmap freshness and whitespace: **chain exit 0** (session 53880). No owned running process.
Requested new explicit browser allocation; no parity/reference/full gate started while released.

## Second allocated browser gate — phone touch target red

Coordinator reopened DCA4 after DCA2 released. Parent repinned all eight candidate identities;
existing native A3 ran the unmodified eleven-case assertion under the heavy lock. Exact log and
two error contexts/stamp: `dca4-a3-gates-02.md`, `../evidence/dca4-gates/scoped-assertion-02.log`.
Result: **exit 1, 2 failed / 9 passed, 14.1s**. Desktop reaches a11y-only reference drift; phone
fails actual Close width **41.84375px < 44px**. Header/footer identity is ambiguous in the captured
label and must be diagnosed, not guessed. Both positive native-decode/exact-download checks had
passed before those stops. Staged geometry, keyboard, narrow layout and all five refusals pass,
including the new exact abort/decoder invocation checks. This is still not complete UI acceptance.

Parent immediately released the logical slot before any reference update, approved mutant or repair.
All source hashes stayed frozen; no PNG was captured because a11y precedes screenshot on desktop and
the phone stopped earlier. After closing the gate unit, same native A3 resumed READ-ONLY source/CSS
preparation for `/ui` + `/hr-debug` touch diagnosis. Parent requested one separately allocated actual
browser diagnostic if computed geometry cannot be established from saved evidence; no browser/probe
or fix is authorized while released. Do not compensate the 44px threshold or invent a larger wait.
Full coverage/parity and the two approved negative controls remain unrun.

## Allocated one-command diagnostic — exact local cause

Coordinator explicitly allocated only the phone happy case with one temporary observational probe.
Native A3 ran that exact command once; **exit 1**, same unchanged 44px assertion, one selected test.
Measured header Close **44×44 / min-width44px** versus footer Close **41.84375×44 / min-width auto**.
Footer shrink is 0; no relevant scale/zoom/animation; no overflow/overlap or missing active-control
edge ownership in the observation. Cause is the local footer constant's height-only floor, not
pressure, a shared button defect, or timing. `dca4-a3-touch-diagnostic.md` owns exact observations,
temporary patch, raw log, stamp, source positions and restoration identities.

Spec was restored to exact `d158e014…8db6de1` immediately; parent independently repinned all eight
inputs/HEAD/diffcheck/materializer0 and RELEASED before source repair/report polish. After receiving
and closing diagnostic unit, same native A3 owns the bounded local footer min-width repair, actual
rendered-declaration regression and dated lesson. No shared DS change or browser/404 probe while
released. Fresh affected static reviews/lights and actual allocated phone/full proof remain required.

## Touch-repaired candidate ready for new allocation

Native A3 repaired only the existing local footer constant by adding coarse-only `min-w-11`,
strengthened the actual rendered four-action declaration regression, and updated comment/lesson.
The exact41.84375 failure is pinned by test-first red and old-constant negative; final80 focused
worker tests/typecheck/lint pass. `dca4-a3-touch-repair.md` preserves all three before files,
isolated +19/−12 patch, restoration maps and logs. No shared Button/Dialog or JSX changes.

Parent received/closed writer, independently matched hashes and reran **8 files / 164 tests,
exit0, 9.70s, 08:47:06 PDT**. Parent serial full locked typecheck/lint, regenerated clean manifest,
fresh roadmap and whitespace chain **exit0** (session84878). Exact evidence: `parent-touch-focused.txt`
and `parent-touch-lights.txt`. Five independent touch-delta reviews are clear in
`dca4-a4-touch-review.md`; all native agents closed. Actual phone geometry/pixels remain pending.

Final HEAD remains `eda17b2708286e36542e1e18e9f8ef6a06cf3187`; tracked UI patch now
`2cae368f56de44b7f6c89665fc08fa1d13e1fbe36510266c198d8fa94c19212d`.
Model `52af2d9261568bc6e8bbd2089b15afa0659bff518da130466ccba593b4bb3097`, render test
`5a10fce54df965c3727989ba275e9eaa49cd1ef89a635ac1fc982159cacd5979`, dashboard AGENTS
`b723d2302cd311948b57900020334ca268ee3db4ef8eca5e3e9cd7e4d281c662`.
Backend and all six new fixture/client/server/browser test identities remain unchanged; specifically
spec **d158e014…8db6de1** is still the exact restoration target for both unrun404 controls.
No browser/coverage/refupdate since the diagnostic release. New explicit allocation requested.

## Allocated gate03 — touch proof passes; rendered caption refused

After DCC4 release, the coordinator explicitly reopened DCA4. Same native A3 ran the unmodified
scoped11 assertion: **exit1, 2 reference-only failures / 9 passes, 14.2s**. Under the approved exact
two-triplet policy it then ran the supported deliberate update: **exit0, 11 passes, 10.9s**.
Actual phone44px widths/heights, edge ownership, no-overlap/overflow, exact bytes/decode, staged
geometry, keyboard and all five refusal cases passed. This closes the measured touch defect only.

Direct native-size desktop PNG inspection found the readiness caption drawn over the image's
lower edge. Main independently re-viewed the preserved PNG and agrees it is a real visible concern;
the earlier quick glance was not acceptance. Source has full-frame absolute image and bottom-absolute
sibling caption with no separate reserved row. Computed background/contrast remains unmeasured.
The two refreshed triplets are **unaccepted candidate evidence**, not approved baselines.

Parent sent immediate RELEASE to coordinator on receipt, before source repair or report polish.
No active owned process, subsequent assertion,404 controls or full gates. Source UI2cae368f and exact
specd158 remain unchanged. `dca4-a3-gates-03.md` owns raw logs/stamp, six candidate copies, full semantic
attribution and before/after protected maps; original six intake bytes are preserved. Independent
read-only caption/source/token diagnosis is the next bounded unit; no new browser authorization.

## Caption repair reviewed / final lights green

Coordinator explicitly approved the local preview seam and confirmed /tdd rendered DOM/token/layout
plus additive browser geometry seams. Same A3 implemented separate flex image viewport and persistent
wrapping caption with declared surface token; outer sizing/metadata/footer/bytes/async behavior unchanged.
Actual mounted-viewer red and old-implementation negative fail for missing caption lane, restored81
worker tests/typecheck/lint pass. Exact four-file patch and raw logs: `dca4-a3-caption-repair.md`.
Five independent affected axes report0; original1medium structurally closed. `dca4-a4-caption-review.md`
retains reviewers, rationale and browser acceptance limits. All native agents closed.

Parent final165tests/8files13.63s (09:08:52PDT) and serial globally locked fulltypecheck/lint,
manifest regeneration/no-diff, roadmap freshness and diffcheck are exit0. No source changes after
freeze. HEADeda17b27, UI**28f06f9bebdc1bbc85ac7a62367281b0ad3e086ebd7eb92b6936bc95949434bf**;
backend19f0a938 unchanged. NEW independently reviewed spec restoration identity:
**e2c03cb1480d144a4e889e52e98f4dc302bcb4c51fa16042bd448ba35bbac1c0**, never oldd158.

No current heavy allocation. Actual caption geometry/contrast, scoped parity/refupdate/assertion,
two404controls with new exact restoration+positives, full coverage/full asserted parity still pending.
Original and03 triplets preserved/unaccepted. Source worktree retained, no commits until required gates.

## Gate04/05 rendered acceptance and full-gate dispatch

Caption geometry/opaque contrast4.5 floor and all original invariants passed both themes; scoped04
failed only two attributable PNG references. Supported exacttwo-triplet update11pass then direct
parent/native PNG+a11y review and scoped assertion11pass10.3s support refreshed pair. New PNG hashes
1515745b…fa5ad91 and275ac863…a8049c3; semantics/meta unchanged. `dca4-a4-rendered-04.md` owns receive.

A giant tool-output path map was incorrectly serialized with a truncation marker. Parent released
for audit, preserved invalidmap and honest communication timing, independently recovered original
pre-gate command/digest provenance from retained task history and recomputed exact1622path digest
68ea761f…1b1f6. No productmutation; no complete per-path beforeproof claimed. Coordinator assessed
audit and explicitly reopened remainingsequence, not retroactivecompliance. See evidence-audit04.

Both approved404 controls now have intendedred/exacte2c03restoration/immediatepositive proof,
personally received by parent. Abortnegative22340exit1→restoree5f2a3exit0→positive42089exit0/1pass2.4s.
Parent rechecked all source/ref/spec hashes, 23317byte spec baseline equality, protecteddigest/UI,
diffcheck/materializer0. Fresh bounded current05 record is valid. Parent explicitly authorized
fullcoverage then fullassertedparity undercurrentallocation, same native solecommandlane and direct
raw logging. No further source/ref changes, no commits. Finalheavy results remain pending.

## Fullcoverage05 red and bounded sequential repair disposition

Actual fullcoverage session19166 terminale5087c **exit1**; UTC16:23:27.940→16:27:55.326,
4failed/321passed files;5failed/3629passed tests,266.74s. Direct rawlog SHA
8d894ee26188f8e404485bedbcae88965f7259f7d125cc41e25485cc491217ab (22776bytes,245lines).
Parent immediately RELEASED logicalslot. No fullparity, sourcefix or commit during gate.
Bounded postgate record proves protected1622digest68ea/UI28f06/backend19f0a938/spec e2c03 and
refs unchanged. `dca4-a3-gates-05.md` retains exactcommands/sessions/exits/fivefailure names.

| Failure | Observed cause / disposition |
| --- | --- |
| dry-run-scenario-composition, two real-composition fixture cases | Registered Duo credential read fails ENOENT. Not classified as environment-only: synthetic session fixtures still enter default real Duo factory; dry-run adapter lacks existing worker injection forwarding. Coordinator conditionally approved exact4runtime+3fixture additions from845ca5a115ee6eef3e10598e88ea0a7fdf361888 after samefocusedred, preserving all other branch differences/default omission. No auth provisioning. |
| guard-manifest frontend-tailwind-compliance | Own Archive image lacks explicitloading. Coordinator approved local eagerattribute+actualDOMregression/lesson, no guard/DS relaxation. |
| redaction-surface-scan | Own ArchivedCaptureResourceWireSchema leaves resource.downloadUrl/message/reason/state unregistered. Coordinator approved exactD183 registration/producercanary proof after origins traced, no new policy exception. |
| wire-connectivity | Own Archive route and inherited genericartifact route both lack scanner-recognized clients. Shared generic route remains coordinator-owned; read-only contract/actualconsumer diagnosis only, no dummycaller/pendingfiction or scannerweakening. |

One writer/lightlane: A5image repair first; nativeSol reads redaction proposal and nativeAnalyst
reads the two wire joints concurrently without edits/gates. Duo seven-line provenance checked
against gitobject845ca5a1; future sequential port after focusedred and explicit affectedreview.
Fresh light/independent reviews and heavyallocation required; no oldallocation reuse.

## A5 explicit-loading repair received

Three-file +12/-0 delta be50b42e, UI3c89958a; only eagerattribute, actualDOMregression and lesson.
Native actualDOM/unchangedratchet red→green, corrected82tests5files/typecheck/lint0. Parent personally
rehashed frozen files/patch/spec, reran47tests2files6.53s and full lockedlint0. Independent native
Tests/Standards0, both closed; writer closed before receive. dca4-a5-parent-receive.md owns proof.
No browser/ref/fullgate/commit. A6 complete-schema registration now gets sequential writer/light lane.

## A6 complete resource registration received

Exact3file+182/-2 patch30d746aa: fullschema,3repository-authoredtextorigins,6leafpin and11newtests.
RealSQLite/sealedsource9canaries throughactualquery/verifier;3originomission and2test-onlytypedleak
negatives independentlyred/restore26green. No productionmutant/policyexception. Parent101tests3files
4.14s plusgloballylockedlint0; independentTests/Security/Correctness0, closed. SeeA6parentreceive.
No heavy/sourcebyte/refchanges. A7exactconditionalDuoport next; A8guardconcretemechanism approved.

## A7 exact hermetic fixture port received

Actualsame2credentialfail/7pass→9green; onlyapproved4runtime+3test+7lessonadditions from845ca5a1.
Branch-specific9thtest and allA6beforebytes preserved. Parent18tests2files3.07s/lockedlint0;
independentTests/Security/Correctness0includingdefaultomissionsourceassessment, allclosed.
No directnewpost-port omissionregressionclaimed; existingreadinessrefusal1pass is distinctproof.
Patch9cd4f023/runtime d745bad8/testf47721d4/rootAGENTSfc6dfe83; seeA7parentreceive. A8 nextsolelane.

## A8 received — only central generic-route dependency remains in focused guard

Approved mountedparent→realclient/parser/hook→nativehref/src collector and mechanical complete
accounting extraction;19newcases+lostcreditnegative/restoredgreen. Source/testscope4files+437/-32,
patch7ea193bf; allfiveindependentaxes0, closed. Parentfullfile24pass/1generic-onlyfail3.15s,
otheraffected216tests12files13.10s; finalgloballylockedtypecheck/lint0, freshunchangedmanifest,
roadmap/diffcheck0. A8parentreceive and current boundedidentity record own exactreceipt/hashes.
HEADstillEDA17b, UI3c89958a; rootlesson-adjustedbackend1ae6ca5f; current1623digestfbcb4c5a.
No coverage/fullparity/browser sincegate05release, no commits/staging. GenericrouteCENTRALOPEN
requires coordinator disposition before gates/commitpermission; no inventedconsumer or waiver.
