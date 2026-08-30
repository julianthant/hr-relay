# DCA4 heavy-gate readiness — 2026-08-30

## Gate05 — both controls received; full gates proceeding

Current allocation: DCA4 coverage then separately locked asserted parity; DCA2 NEXT, DCC1 reserved
after DCA2. Reservations are not OPEN. Parent explicitly gave full-coverage GO after receiving
remaining abort proof; coordinator added no new approval barrier or duplicate control run.

| Claim | Classification | Verified evidence |
|---|---|---|
| Abort oracle detects wrong fault | Proved | Complete `dca4-a3-gates-05.md`, raw `abort-negative-05.log`, case-local patch and execution JSON read. Session22340 exit1/terminalfdf951: ordinary404 preserves URL/GET/image but failure undefined/sameRequest false, failing exact tuple at spec420. No assertion changed |
| Immediate restoration and positive | Proved | Finallye5f2a3 exit0 within104ms after red; saved23317-byte e2c03 baseline restored. Separate session42089/dd245c exit0,1pass2.4s. Coordinator independently compared complete bytes and SHA256 |
| Candidate continuity | Proved by current independent recomputation and bounded receipts | HEADeda17b27,1,622 protected paths→68ea761f5fb644c0cbf83a42bc4edf005489f1d9a662daea650a6b60efd1b1f6; spec e2c03cb1480d144a4e889e52e98f4dc302bcb4c51fa16042bd448ba35bbac1c0; whitespace/materializer diff0. Before/after05 receipts carry unchanged ref/companion identities |
| Full gates | In progress, no terminal result | Parent full-coverage GO received; `full-coverage-05.log` exists. Full coverage success and subsequent full parity remain unproved. Release on red/repair or last heavy terminal before polish |

Red raw SHA256 `c3f065985c81b5e3d198a5752ce09c2b831588171a3df9561916d6daf7d49b1d`;
positive `af6e14f9f928000cf51cb2d2cc1d30320505cf6ebc72c56e79744babe875c371`.
Both commands used pipefail/direct tee before output transport, existing nonblocking heavy lock
and PARITY_UPDATE unset. Prior04 truncated-map and protocol disclosures remain unchanged.

## Gate04 receive — fresh remaining-sequence allocation

At this earlier receive: **DCA4 heavy OPEN for remaining abort control, parent receive, then full gates; DCA2 NEXT,
not slot-open**.
The prior allocation was explicitly released for the recording-defect audit. This is a fresh grant,
not retroactive approval of the continuation across that evidence stop. Same native unit only.

Coordinator read the complete assigned `dca4-a3-gates-04.md`, `dca4-a4-evidence-audit-04.md`,
commands/control-progress JSON, raw assertion/update/reassertion/decoder logs and temporary patch.
Evidence root in assigned DCA4 checkout: `docs/coordinator/worktree-completion/evidence/dca4-gates/`.

| Claim | Classification | Evidence checked / disposition |
|---|---|---|
| Initial04 is reference-only red | Proved from raw output | 2 PNG failures/9 passes14.0s, desktop39,041/phone4,887 changed pixels. Raw617fb604880999baf2e765cc8ca860e97e099d114588c8d85139eeda2fe61bbc. Both geometry/contrast>=4.5 helpers precede capture; no exact numeric ratio emitted |
| Refreshed pair and scoped assertion | Proved from logs, recorded exits and direct inspection | Update exit0/11pass10.7s; subsequent asserted exit0/11pass10.3s. Coordinator directly viewed both actual04 and both refreshed PNGs, plus full a11y: readable separate caption lane, no additional bounded finding. This is not full-suite acceptance |
| Decoder control | Proved from raw logs, patch and recorded exits | Scoped404 mutant fails exactly missing invocation marker at spec409; restored positive exit0/1pass3.3s. Exact saved23317-byte spec equals current bytes, SHA e2c03cb1480d144a4e889e52e98f4dc302bcb4c51fa16042bd448ba35bbac1c0. Do not repeat completed control unnecessarily |
| Protected-file continuity | Current aggregate independently verified against recorded-before aggregate | Sorted unique Git tracked+untracked paths under src/tests/scripts/config minus exactly six assigned references:1,628 total/1,622 protected, SHA256(JSON.stringify(sorted path-to-file-SHA object))68ea761f5fb644c0cbf83a42bc4edf005489f1d9a662daea650a6b60efd1b1f6. HEAD/UI28f06f9b, exact spec, six refs, empty index, tracked refs/materializer/whitespace checks independently verified |
| Complete per-path before manifest | INVALID; retained evidence gap | Serialized before-map has1,426 keys and literal tool truncation text. Original aggregate remains recorded, but missing rows cannot be recovered. No reconstructed current map may be called original before evidence; no demonstrated product drift |
| Stop/continuation protocol | Disclosed deviation | Worker stop commentary was not seen before generic parent visual approval was interpreted as continuation. Scoped reassert/decoder ran before informed evidence-audit clearance. Parent then stopped further work, allowed healthy restored positive to finish and released. Fresh allocation does not ratify earlier timing |

Additional provenance received/read: `parent-original-digest-provenance-04.json` identifies native
source turn01a05371-5214-7721-be75-520a479a907b, pre-gate command
exec-21457ef0-7678-4caa-9d8b-18d546c10477 exit0/294ms and retained stdout prefix containing
the original68ea digest before initial exec-7889f7fd. Full227408-character stdout is NOT preserved
there. Parent recovered this from native history after the gates; its preserved command/prefix/
chronology is additional aggregate-origin evidence, not a reconstructed original map. Five heavy
execution records corroborate1/0/0/1/0 exits; missing per-path proof remains disclosed.

Raw update SHA256 `2b98738c9a76ed0ac0e4589d65710f752766cd1c319562920af0f6787399e23b`;
reassert `27ad7ad38c22ba3fb3abd685c370d633c4e46a53624a19f2f12e27fb20b099dc`;
decoder red `f1f4a7d46bf49557890b03667af15225d8861f8533d987f6de56683b94d0db04`;
restored positive `abc8d1e0093fc42714f9a0998783f064391ef8571bba4a43c6ad71e233c0559c`.
Commands JSON records initial/update exits1/0; control-progress records reassert/red/positive0/1/0,
UTC16:16:54.871 through16:17:50.340 and exact-byte restoration. These are retained command receipts,
not a new coordinator test execution.

Saved actual04 PNGs: desktop d20f3289f5bee26f80a6567183f1550468b29bd8f6c2c2d2cbbb0a6869ac4024,
phone8cf1f442e94a3a3f466ed846ddc51aecb5c04485ec869e211f77375306536575.
Refreshed active PNGs: desktop1515745bbc5ea128ff7d61a74234a3c0fd521f06082648d26a67e92b3fa5ad91,
phone275ac863a51674e5269c39aea3aea736f34377dbff674d0bf72607ed6a8049c3.
These pairs have different bytes and were inspected separately; no byte-equality claim. A11y/meta
remain exact03 hashes. Original intake/03 remain preserved and unaccepted; current04 scoped pair
has direct review plus asserted proof, not final full-gate acceptance.

Fresh OPEN requires a bounded valid current evidence record, then only the remaining approved
abort404 expected failed-request-tuple red, finally exact e2c03 restore/hash/bytes and separately
locked positive. Parent must receive those proofs before full-coverage GO; restored coverage then
separately locked full asserted parity are allocated. PARITY_UPDATE unset, no own light lane or
reference edits. Unexpected result/hash/repair pauses release immediately; final heavy result also
releases before reporting. Full coverage/full parity and abort control remain unrun at this receive.

## Caption candidate — historical initial allocation

Coordinator independently verified HEADeda17b27, frozen UI
`28f06f9bebdc1bbc85ac7a62367281b0ad3e086ebd7eb92b6936bc95949434bf`, unchanged backend19f0a938,
four-file delta0fde7a72 (+159/-25,95 additive browser lines), all four changed files, five retained
test/fixture companions, six03 reference hashes, empty index and whitespace/materializer/manifest
diff0. Full181-line repair and62-line affected-review receipts read. New reviewed spec SHA256:
`e2c03cb1480d144a4e889e52e98f4dc302bcb4c51fa16042bd448ba35bbac1c0`.
**Do not restore old d158 over these regressions.** Five independent affected axes Count0 received;
the original caption medium was structurally addressed, with rendered proof then pending. Coordinator read
named red/green/old-implementation-red/restored81-test output plus parent21069 receipt165tests/
8files13.63s exit0 and14239 individually locked typecheck/lint, manifest clean, roadmap/diff0 chain.
Parent focused receipt is explicitly a summary with progress dots omitted, not a full raw log.

Actual **OPEN** sent to same supervisor/native unit: re-pin, first unchanged11-case assert with
PARITY_UPDATE unset and existing nonblocking OS lock. Only attributable exact two-triplet drift
permits supported refresh/direct PNG+a11y review/positive assertion. Unexpected geometry/contrast/
oracle failure or visual refusal releases before repair. Then only the two approved404 controls,
one at a time, each exacte2c03 restore/hash/positive; unexpected outcome releases. Parent receives
images/control proof before full coverage/full asserted parity. No other supervisor allocated or
reserved.03 refs remain unaccepted; actual browser caption geometry/contrast still unproved.

## Gate03 visual refusal — historical release and repair input

Gate03 heavy slot was RELEASED; subsequent DCA2 G16 release temporarily left no heavy owner. Two candidate reference
triplets remain **unaccepted**. DCA4 parent independently confirmed the saved
caption overlap and native reviewer medium finding; bounded existing A3 repair proceeds without
browser/build/update/probes/coverage. Persistent wrapping caption lane, unchanged outer frame and
new reviewed spec restoration hash remain required;03 artifacts stay immutable.
Coordinator read complete assigned `dca4-a3-gates-03.md`: scoped assertion2failed/9passed14.2s,
then deliberate two-triplet update11passed10.9s (raw update hash
3f0ac6b0bc278306850869b0247b08af61b77b8d1b4375db9a36f767811f5aaf). Direct PNG review refused
desktop caption overlap; no post-update assertion,404 control or full gate followed. Update-mode
green is not acceptance. Prior intake and exact03 PNG/a11y/meta copies remain preserved.

### Bounded saved-image review and repair disposition

Stack: React19.2.8, Tailwind4.2.2, TypeScript/Lucide; no Next or components.json/shadcn.
Coordinator used `/ui` review route and fetched the live
[Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).
This is a scoped saved-image/source review, not a new browser session or full UI audit.

- `src/dashboard/surfaces/archive.tsx:2376,2381`: full-frame absolute image and bottom-absolute
  caption share the same area; caption visibly overlays the lower image edge in saved desktop03
  PNG826127529d8ec9e3724c51b16e8a0f3241c09ec7f1b5e6c190e8357d80d99992, directly viewed by coordinator.
- `src/dashboard/surfaces/archive.tsx:2324,2381,2403`: three uses of `--ds-bg-inset`, no declaration
  found in dashboard source. DESIGN.md165 and ds/tokens.css70/795/993 declare `--ds-surface-2`
  for inset wells. No measured computed opacity or numeric contrast claim.

Existing supervisor may reuse one native `/ui` writer after receiving its independent diagnosis:
local preview image/caption separation and existing declared surface token, preserving outer-frame/
metadata/footer stability, uncropped exact bytes, async refusal behavior and every existing44px,
edge/nonoverlap/decode/download assertion. No shared DS/materializer/byte/threshold/mask changes.
Confirmed test seam: actual rendered preview DOM/token/layout declaration red→green, then stronger
browser geometry for separate image/caption regions and readable captions in both themes through
all readiness states. DOM declarations do not certify browser geometry or contrast. No browser
while unallocated; changed spec requires new reviewed exact restoration hash before404 controls.
Fresh affected reviews/serial locked lights/new identity precede requeue; no pre-gate commits.

## Touch-floor repair — preceding allocation, now released

Coordinator reverified the complete candidate after DCC4 terminal full-green/release and explicitly
opened DCA4's slot. DCA2 remains NEXT, not open. Same native /ui unit and sole owned command lane.
Scoped03 now reaches reference-only failures; full UI/reference acceptance remains pending. Exact HEAD remains
`eda17b2708286e36542e1e18e9f8ef6a06cf3187`, index empty, diffcheck0, manifest/materializer diffs0;
coordinator roadmap:check0. Backend remains
`19f0a93825bda594f033e24135b65667ac536a931bba11450eb438f284e37c6f`.

| Reproduced identity | SHA256 |
|---|---|
| Seven-path UI aggregate | 2cae368f56de44b7f6c89665fc08fa1d13e1fbe36510266c198d8fa94c19212d |
| archive-model.ts | 52af2d9261568bc6e8bbd2089b15afa0659bff518da130466ccba593b4bb3097 |
| archive-render.test.ts | 5a10fce54df965c3727989ba275e9eaa49cd1ef89a635ac1fc982159cacd5979 |
| src/dashboard/AGENTS.md | b723d2302cd311948b57900020334ca268ee3db4ef8eca5e3e9cd7e4d281c662 |
| Unchanged archive-evidence.spec.ts | d158e014dd85b42ae6f42fb5d02aaf2a54408f348e4ab008627eb25ce8db6de1 |

All five other fixture/client/backend test hashes below were rechecked unchanged. Coordinator read
the isolated +19/−12 three-file patch: local coarse-pointer minimum width, four rendered-footer
declaration checks and dated lesson; no shared DS/JSX change. Assigned `dca4-a3-touch-repair.md`
records test-first and old-constant reds with the same missing-footer-width assertion, restored
80-test/light passes; `dca4-a4-touch-review.md` records five independent affected axes0 and explicit
unaffected-axis skips. Parent receipt records164/164,8files9.70s session79070, then serial locked
typecheck/lint/manifest/roadmap/diff chain84878 exit0. Raw named reds and parent excerpts inspected;
coordinator did not rerun product tests or call DOM declarations rendered geometry proof.

Current allocation: re-pin identities, scoped11 positive assertions first, only attributable
two-triplet supported refresh/direct PNG+a11y review/assert; two previously approved404 controls
with exact unchangedd158 restoration and positive rerun after each; full restored coverage/assert.
The detailed expected-red exception below still applies. Assertions unset PARITY_UPDATE, every
heavy command takes existing nonblocking OS lock. Unexpected result/repair releases immediately.
No source commits before required gates, reference widening, materializer change or shared-history
approval. DCA2 is reserved after DCA4, not concurrently allocated.

### Scoped03 — reference-only red, slot retained

Coordinator read the complete `evidence/dca4-gates/scoped-assertion-03.log`:2failed/9passed,
14.2s, both failures solely a11y drift for `archive-evidence--graphite-warm--1280x720` and
`archive-evidence--paper-ink--phone-390x844`. SHA256:
`590a978d75f0b922dc60cad92d05db59ea96a8852eac2f8dfff496912b6572c3`.
UI2cae368f/unchangedspecd158/HEADeda17b reverified. Source order proves decoded1440×900 image,
exact downloaded bytes, frozen metadata and control-geometry assertions completed before a11y
comparison; phone width/height44px, enabled edge ownership, nonoverlap and overflow checks were
not weakened. Separate geometry/keyboard/narrow/refusal cases passed. Pixel comparison was not
reached in the two failing capture cases, so neither old nor new references are accepted yet.

Slot retained under already-authorized exclusively attributable two-triplet refresh policy.
Supervisor must complete attribution/stamped update/direct PNG+a11y review and assertion before
the two planned404 controls and full gates. No new source repair/extra reference permission.

## Prior HTTP/oracle diagnostic — historical

**Diagnostic complete and slot RELEASED; full-gate readiness still withdrawn.** Coordinator read
touch-target-diagnostic-01.log: one phone case failed unchanged44px assertion. Measured headerClose
44×44/minWidth44; footerClose41.84375×44/minWidthauto/flexShrink0/padding0px6px/font11px.
No active ancestor scale/animation, visualScale1; recorded nonoverflow/inside/footer/overlap/edge
proof otherwise holds for enabled controls. Exact d158e014 spec and UI2f351365 restored/reverified;
no second command/refupdate/404mutant. Local footer-floor regression/repair needs affected review,
light proof/new frozen identity before reallocation. DCC4 now owns heavy, not DCC1.

The one-command diagnostic allocation was bounded as follows. Reverified
HEAD/UI2f351365/specd158e014. Inspect saved source/CSS/context first; if insufficient, same native
unit may add one observational probe then run `npm run test:parity -- tests/parity/archive-evidence.spec.ts
--grep 'verified archived capture evidence paper-ink @ phone-390x844'` under the mandatory
nonblocking heavy lock. Record exact header/footer control identity, computed geometry/flex/min-width
and ancestor transforms with all44px/overlap/edge assertions unchanged. Preserve probe patch/output,
restore exactd158e014 and complete input identity immediately, RELEASE before repair. One command,
no retry, refupdate or404mutant. Skip/release if saved evidence already proves cause. Diagnostic
evidence target: evidence/dca4-gates/touch-target-diagnostic-01.log in assigned tree.

**Readiness withdrawn; heavy slot RELEASED after assertion02.** Raw
`evidence/dca4-gates/scoped-assertion-02.log` confirms9passed/2failed14.1s; supervisor reports
terminal exit1 and no further commands. Desktop reaches a11y drift, while phone Close measures
41.84375px against the unchanged44px floor at spec107. Geometry/refusal/keyboard/narrow cases pass;
that is bounded proof, not reference or full UI acceptance. No reference update, planned mutant or
coverage ran. Coordinator reverified UI2f351365/specd158e014 unchanged at release.

Bounded local touch-target repair requires regression, affected independent review, fresh light
proof and new frozen identity before allocation. Preserve width/height floor, no overlap, edge
ownership and all existing byte/refusal assertions. If the spec changes, explicitly establish its
new reviewed restoration hash before either planned404 control. Both controls remain UNRUN.

For the completed second allocation, coordinator rechecked exact HEAD, both aggregate
diffs, all six new test/fixture hashes, whitespace0 and unchanged materializer before allocation.
Original scoped browser result remains5passed/6failed in its own raw log; assertion02 provides
the later partial browser proof above and does not retroactively change that original result.
Coordinator reverified HEADeda17b27, backend19f0a938…7c6f and these repaired identities:

| Scope | SHA256 |
|---|---|
| Seven-path tracked UI aggregate | 2f351365ae5528949fcd6e0f1982b73badb28a8efcd8a4908dbc7144e3d89bb0 |
| archive-evidence.spec.ts | d158e014dd85b42ae6f42fb5d02aaf2a54408f348e4ab008627eb25ce8db6de1 |
| archive-evidence-fixture.test.ts | 61aa88751464f01106ac34db39fa9792f37c32480170ec491cfe4abf2cdc1d1f |

Other fixture/client/backend test hashes remain unchanged; shared materializer diff0. Coordinator
read HTTP red/green and exact-route/broad-route controls, six HTTP-delta reviews and three oracle
reviews. Parent164tests/8files10.04s excerpt and individually locked typecheck/lint0 are in assigned
evidence/dca4-gates/parent-repair-{focused,lights}.txt; focused excerpt omits progress dots explicitly.
Coordinator roadmap/manifest-diff/whitespace0. No complete browser clearance inferred.

Two planned negative controls require a future explicit allocation and reviewed restoration hash, after restored
decode/abort positives pass in scoped11: decoder response→404 must fail invocation marker;
abort→404 must fail exact requestfailed tuple. One case at a time, all assertions retained, separate
OS lock per command, raw expected-red evidence, exact spec restoration to d158e014 and passing
positive rerun after each. These two expected reds retain logical slot only if intended assertion
fails and restoration/positive proof succeeds. Unexpected pass/failure, hash mismatch or repair need
triggers prompt release before fixes. No reference updates/commits during probes, no extra mutants.
Full gates use restored reviewed candidate. Original reference-only refresh policy is unchanged.

## Earlier allocation — historical, failed scoped browser gate

Disposition then: explicit heavy slot allocated after DCA2 released. Not final acceptance.
Source: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`.

| Claim | Classification | Coordinator evidence |
|---|---|---|
| HEAD remains eda17b2708286e36542e1e18e9f8ef6a06cf3187 | proved | git rev-parse HEAD |
| Tracked UI diff54895c9b4210a5444cd9bdb9dbf02ef4be56f8562329bc5f9e882c31875c1f44 | proved | Reproduced seven-path binary diff hash from A3 repair receipt |
| Backend diff19f0a93825bda594f033e24135b65667ac536a931bba11450eb438f284e37c6f | proved | Reproduced six-path backend/doc binary diff hash from A2 receipt |
| Four new UI files and two backend test identities | proved | SHA256 matched A3-repair/A4 receipts; values below |
| Final static review findings closed | review evidence verified | Read individual UI Correctness/Silent/Security/Performance/Tests/Standards/Docs and Spec reports plus A4 ledger; runtime geometry remains unproved |
| Final comment-only change preserves emitted behavior | supervisor proof recorded | Docs report records identical comment-stripped emission565c751d…dcc0e and same-reviewer final closure; coordinator did not rerun transpilation |
| Parent151 focused tests and full locked typecheck/lint0 | supervisor gate receipts | A4 ledger and A3-repair exact command/session records; not rerun by coordinator |
| Roadmap current; manifest unchanged; diff whitespace clean | proved | Coordinator roadmap:check0, manifest path diff0 and diff --check0 |
| Shared materializer unchanged | proved | Exact artifact-bytes.ts diff0 |
| Six inherited reference/provenance files preserved | inventoried, supervisor byte proof | Intake README records six digests and files exist; final cleanup must retain them |
| Browser/coverage/full parity | residue | Still unrun at allocation; existing inherited broken images are not accepted references |

New file content hashes:

- archive-evidence.spec.ts: `7ad10d2f52012775228411cad869c96dd1195edcb8fbee4cf70e56e4017b12d0`
- fixture-archive-evidence.ts: `3877360ad3540f5579a47c4f4e88be8c366b29332895f4772c53145474792757`
- archive-capture-resource-client.test.ts: `24d91d3aba1b7d22748ac61c6d7ed944fa0b7b8e7c81b9382be464f34e8aeb4f`
- archive-evidence-fixture.test.ts: `1c9dd28762e252ff3108ba933de010fb8399d7e64dbe17d4576dffd5b4688017`
- archive-capture-resource.test.ts: `6853648c074d7f97eae16d83a7f04dccfef4b838ed5879b62e3c4a6d801d1907`
- archive-capture-routes.test.ts: `e0d7d28094586d8adcebc5612820d5d3da8ccffb60badfca6b06a5eb55092a30`

Allocation: scoped11-case Archive parity first, attributable two-triplet update only if needed,
direct PNG/a11y review and assertion, then full coverage/full asserted parity. Existing OS heavy
lock remains mandatory; any non-reference browser failure/source repair pause immediately releases
the logical slot. No hidden normalization, masks/threshold changes or fixed-port workaround.
No commits before required gates; no source-tree removal or shared integration authorized.
The future dca-shared-bytes repair and migration decision remain unresolved integration residue.
