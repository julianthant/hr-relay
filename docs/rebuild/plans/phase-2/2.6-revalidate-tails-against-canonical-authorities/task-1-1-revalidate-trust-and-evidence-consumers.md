# Task 2.6.1-1 · Revalidate trust and evidence consumers

Read the [shared phase scope and prerequisite](README.md). Requirements remain
in [operator trust](../../../reference/operator-trust.md) and
[run authority](../../../reference/dashboard-surfaces.md#d3302--existence-and-disposition).

### Task 1-1 · Revalidate trust and evidence consumers
<!-- roadmap: p2f-trust -->

- [ ] Rewire notification, receipt, failure, capture, log, gate, and parked-write run joins.
- [ ] Prove durable linkage through retry, archive, and tombstone without rewriting evidence.
- [ ] Stay behind the stable run/evidence boundary; do not edit intake data projections or generic
  lifecycle status/count/archive projections owned by Tasks 1-2 and 1-3.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes §D330.9's evidence-linkage invariants:
> spans/logs, receipts, failures, captures and gate records are evidence ABOUT a run and link to it by
> the stable `runId` alone, so no reader joins evidence to evidence to reach a lifecycle fact and the
> span fold contributes no lifecycle arm (§D330.12 item 1). Existence stays §D330.2's three-way answer
> (`absent` · `present` live/archived · `deleted`), and §D330.8's tombstone governs deletion — a
> deleted run's gate records leave WITH the run. The notification inbox row stays run-linked. No
> redesign.

## Approved execution brief — 2026-09-08

The operator requested planning followed by implementation in this same task,
then explicitly approved the shared-reader prerequisite. This authorizes plan
persistence and execution without a fresh-session prompt. It does not authorize
other wave assignments, pushes, production writes or authority redesign.

### Checkout, ownership and order

The supervisor in Codex task `01a08042-bb76-7131-844a-872dd909a835` owns both
serial stages and their integrations. The prerequisite uses `codex/tail-readers`
at `/Users/julianhein/Projects/hr-worktree-tail-readers`, created from the
committed plan on master descending from foundation close
`2dd3048f8d5d223f3eb1347353c83c3d07297cfe`. The trust stage uses `codex/tail-trust`
at `/Users/julianhein/Projects/hr-worktree-tail-trust`, created only after the
prerequisite is reviewed and integrated. Its base is that verified integration
plus its recording-only completion commit; record the actual SHA before editing.
Never reuse or remove another task's worktree. Recheck the four-auxiliary limit.

Each stage freezes its own candidate, passes one fresh complete `sup_review`
review and its gates, then merges `--no-ff` into master. Remove the prerequisite
worktree/ref before opening the trust worktree. The prerequisite's integrated
executable tree is the common wave base for all three peers. Their independent
candidates permit either peer integration order; only shared target, generated
output and guard inventory edits serialize. A changed prerequisite/API or
behavioral merge conflict needs renewed affected review. No sibling dispatch.

Supervisor implements the coupled query/composition boundary. One optional
`sup_astra` worker may perform the mechanical query extraction (new query files
and old run-detail delegators only) while the supervisor handles separate
composition/route extraction; activate only after the exact exports are frozen.
Both operate sequential contributions in the owned prerequisite checkout with
non-overlapping files; no worker commits independently. The worker must not
change behavior, contracts, gates or the shared API without returning the issue.
All Codex roles use Astra/high; no nested delegation. Each stage has one fresh
complete read-only reviewer, two initial reviews total, one active at a time.

### P — shared-reader prerequisite
<!-- roadmap: p2f-readers -->

D344 displays this independently accepted prerequisite as its own roadmap gate. The existing
owner, branch, P1–P3 steps, gates and P/T execution authorization remain unchanged.

P1 extracts the existing mixed query into explicit files without changing public
payloads, errors, route admission, archive bytes or lifecycle derivations:

- `queries/run-detail-types.ts`: existing dependency and descriptor-view types.
- `queries/run-read.ts`: shared query admission, retaining the old behavior in
  this extraction stage; typed canonical read backing is exposed separately.
- `queries/run-trust.ts`, `run-logs.ts`, `run-captures.ts`: receipt/failure,
  gate/parked-write, immutable log snapshots and diagnostic capture verification.
- `queries/data.ts`: Context Data/Attempts implementation plus `createDataQueries`.
- Existing `queries/run-detail.ts`: generic detail/timeline and delegators;
  retain public exports so callers and archive freeze stay compatible.

P2 separates wiring and registration. `compose/trust.ts` owns receipt/capture/
notification dependencies. `compose/data.ts` owns data query composition;
`compose/operator.ts` owns operator projection/detail/archive read wiring.
`routes/data.ts` handles Context Data/Attempts on the existing parameterized
section path before the generic section registrar; other sections call `next()`. The data factory return is inferred, allowing 1-2
to add Rerun values and its route without editing the root. Its production
backing bundle supplies AuthorityDatabase snapshot/evidence reads,
`Pick<RunRecordService, 'read' | 'list'>`, full descriptor resolution, and source fold/log
evidence access. Existing minimal Context test compositions may omit that
explicit bundle; future Rerun reads must refuse `RERUN_VALUES_NOT_CONFIGURED`
before reads if unconfigured, never use a raw repository fallback. No Rerun
feature is implemented in P. Trust/operator route ownership is extracted as
needed so their peer implementations do not share route files. Root dispatch,
request identity, loopback/content-type guards and static-last order remain.

P2 also supplies the independent `runReader?: CanonicalRunReader` read/list port
for trust and generic lifecycle consumers, separate from the data backing bundle.
Production binds both to the same service. Shared fixture backing lands in P:
`tests/helpers/canonical-run-reader.ts` supplies an isolated SQLite service reader
and an explicitly named in-memory unit fake with caller-controlled generation.
The fake is never canonical acceptance evidence. Dashboard harnesses expose
`runReader` and `runReaderState`; existing detail/section/archive/parity/perf
compositions pass their actual reader. `archiveSnapshots` refuses an unconfigured
fixture. This mechanical addition resolves the pre-freeze 1-1/1-3 fixture conflict;
post-P the helper freezes and generic fixtures remain 1-3-owned. Receipt, diagnostic and notification dependency interfaces also expose optional `runReader`
ports, wired in production and shared BFF/scenario/parity/perf fixtures without
changing reads in P. T and 1-3 require
the direct `runReader` port at admission with no raw or data-bundle fallback.

P3 runs the existing behavioral safety net and required gates, reviews the
complete extraction, integrates it, and records actual exports, path ownership,
base SHA and checks here. Publish the common base to the existing 1-2/1-3 tasks.
No wave implementation begins before this acceptance. The prerequisite may
mechanically adapt source-sensitive guards, preserving their injected violations
and membership; guard inventory changes, if required, include deciding evidence.

### T — canonical trust consumers

T1 uses the canonical read-only service at trust admission and notification
observation. Receipts, failure, gate, parked-write and capture serving must not
require a span fold to decide existence. Distinguish absent, live, archived and
deleted; live requests cannot bypass the Archive door. Raw evidence reads stay
separate from lifecycle reads. Logs can use an optional fold as evidence for
extra partition instants, never as existence or lifecycle authority. Validate
run/workflow/trace/attempt membership and preserve immutable page snapshots.

T2 rewires `src/server/trust/receipt-service.ts`, its Explain and dry-run-scenario
composition callers, `queries/diagnostic-bundle.ts`, extracted trust/capture/log
queries and `compose/trust.ts`. Receipt derivation and item-wide compatible
checkpoint reuse stay unchanged. Failure/gate/capture/write records must match
the admitted run; write generation/status checks remain. Archive snapshots still
freeze the live projection before archival; archived reads use immutable evidence
and never reconstruct history from current descriptors/private settings.

T3 preserves notification commit-before-delivery, dedupe/read/snooze semantics
and failure reporting in `src/services/notifications/inbox.ts`. Observe gate parks
through canonical list/read, with paging/stale-generation handling. Prove run
linkage across retry/archive/delete and prohibit resurrection from retained
JSONL/artifact bytes. Do not add the unbuilt notification producers owned by 3.1.

T4 adds behavioral/negative-control tests using a separate real SQLite trust
fixture under `tests/unit/server/helpers/` or local fixtures. After P,
`dashboard-harness.ts` belongs to 1-3 and is not edited by 1-1. Existing trust,
capture, log, receipt, notification and Explain test files belong to 1-1;
generic detail/timeline/projection/archive/Activity tests belong to 1-3.

T5 freezes candidate evidence, obtains complete independent review, resolves
findings, integrates and verifies the combined tree, removes owned worktree/ref,
records delivery assessment and marks only 1-1 complete. Task 2 still waits for
all three peers; this is not Phase-2.6 closure.

### Feasibility and acceptance proof

| Requirement / inspected mechanism | Permitted change and proof |
| --- | --- |
| `RunRecordService.read/list` already supply snapshot-bound canonical existence, disposition and generation paging. | P supplies ports; T migrates only trust consumers. Inject stale/missing/contradictory fold evidence; canonical answers must win. No core-service or DDL redesign. |
| `run-detail.ts:requireRun` currently admits fold first and all section families share it. | P separates ownership; T removes fold admission only from trust. Positive canonical no-fold cases for receipt/failure/gate/write/capture and logs; missing evidence remains explicit, never fabricated. Generic lifecycle changes remain 1-3. |
| Receipt service and Explain read raw run repositories; retries retain separate receipts, item-wide checkpoint reuse. | Canonical identity and trace resolution; compare independent retry receipts/source bytes, verify missing/deleted refusal and archived-door behavior. Do not rewrite pinned evidence or change derivation fingerprint. |
| Capture query verifies exact bundle/digest/index/bytes but no canonical run port. | Verify membership before serving; include absent/deleted and shared-byte cases, foreign/duplicate bundle records and corrupt/missing artifact negative controls. Preserve redaction and abort behavior. |
| Gate/write/failure records explain authority; parked write already checks run ID/status/generation. | Real gate/failure/write mismatches refuse. Stale fold open/resolved gate cannot grant a lifecycle state or a write action. Terminal/parked positive controls must still serve correct evidence. |
| Inbox settles one transaction before OS delivery; delete already removes run-linked notifications behind tombstone. | Delivery observer sees committed row; failed/snoozed/no-channel delivery preserves row; retry/archive/delete retain their specified linkage/cascade and cannot republish a deleted run. No notification-schema change identified. |
| Archive freeze calls synchronous detail/sections while live; readback is frozen. | Existing archive/failure/log/capture tests remain green; source run/evidence and archive bytes remain identical through extraction/retry; deletion preserves shared bytes and accounts retained JSONL without recreating records. |
| Protected input classification belongs to retained evidence. | Existing redaction guards plus deliberately protected values verify no current private configuration lookup, raw permanent key or identifier leak. |

All above are inspected mechanisms, not executed proof yet. Existing test
locations include `tests/unit/server/run-detail-captures.test.ts`,
`run-detail-gate-outcome.test.ts`, `diagnostic-bundle-readback.test.ts`, the
archive capture suites, `tests/unit/notification-inbox.test.ts`,
`notification-gate-park.test.ts`, receipt suites and
`tests/unit/run-record-service/service.test.ts`. No live environment operation is
needed for this synthetic downstream proof. The actual operator database remains
untouched. Preserve D135 and never retry an UNKNOWN submit.

### Gates and recording

For P baseline and each meaningful extraction, run focused affected tests via
`npm test -- --project unit tests/unit/server tests/unit/notification-inbox.test.ts tests/unit/notification-gate-park.test.ts`.
T iteration uses exact changed trust suites and its new linkage tests. Run lint
when tests run. A focused failure is repaired before full gates, not hidden by
a narrower command. No test assertion, timeout, membership or floor is weakened.

Each implementation candidate: `npm run typecheck`, `npm run lint`, then
`npm run test:coverage` with no compiler/linter contention and at most four file
workers. Also `npm run web:build`, `npm run test:parity` without refreeze,
`npm run build:manifest:check`, `npm run stores:catalog:check`,
`npm run roadmap:check`, and `git diff --check`. Generate only when actual owned
inputs changed; generation precedes freshness checking. Coverage includes the
architecture project, so no duplicate full architecture run is required.
Host resource conflicts are coordinated by concrete active process evidence.

Integrations run typecheck/lint/full coverage on materially changed executable
trees. For an unchanged reviewed executable tree, inspect and record identical
input hashes before reusing candidate results under D191; recording-only changes
run roadmap generation/freshness, affected document links, existing instruction
twin/chain checks and diff whitespace. Required prior-result reuse cites tested
SHA, command, exit and unchanged inputs; never label reused results rerun.

Review P covers every extraction, root/route wiring, preserved public contracts,
negative controls and actual path ownership. Review T covers all acceptance rows,
source/consumer linkage, retry/archive/delete, asynchronous capture/delivery,
redaction, test quality and integrated prerequisite assumptions. Both reviewers
receive frozen base/candidate/plan/evidence identities and complete changed-path
inventory; no author reviews their own work. Awaiting review is not completion.

Stop only for a changed prerequisite, a newly evidenced contract/ownership
conflict, actual failed access/resource gate or unresolved required review. Fix
ordinary implementation/test defects within ownership. Never take sibling files
or authority-schema work to hide a failure.

## Current execution state

P is **accepted and integrated**. T is **in progress**, bound before edits to
`codex/tail-trust` at `/Users/julianhein/Projects/hr-worktree-tail-trust`, from
common base `64db38e017f585014173bae3c428e6c2a1f63099`. The supervisor implements
T locally; its separate complete independent reviewer remains required. Independent complete review
P-R1 by `sup_review_tail_readers` passed all 51 candidate paths with no findings:
base `6e0d05183ba9427e23af4427b62265389fc12281`, candidate
`249d96edf1cf0007e93f6313fc85d37a1dee4878` (tree
`c20f792990b4b148e9c66c26f587f92241d8999e`). The reviewer independently checked
inventory, exports/body equivalence, whitespace, instruction twins and all eight
final gate-log digests; gate execution/input binding remained supplied supervisor
evidence, not a reviewer rerun. No pre-run input manifest was captured.

Integration `826cae74414e84fcd8559bbb34a43f2d68e4678e` merged P without behavioral
conflicts onto `d9f0977908943ca94a258ae12f08216650dad16d`. The intervening D344
instruction/planning changes explicitly preserve this in-flight P/T ownership,
gates, peer communication and integration authorization. All runtime, test,
script, configuration and dependency inputs match the reviewed candidate:
Git input-list SHA-256 `0f251e5800a69e6652410f889f9fa9190942672bf1f88d758ac8a7ea08693068`.
`/tmp/hr-tail-readers-evidence/integration-input-identity.json` records both full
SHAs and all differing documentation paths. Typecheck, full coverage, web build,
unchanged-reference parity, manifest and catalog results below are reused under
D191, not rerun. The affected roadmap binding guard passed 23 tests; integration
lint, roadmap generation/freshness, document links, nine instruction pairs/chains
and whitespace are recording gates. The common wave base is the completion
record commit enclosing this paragraph; the supervisor publishes its resolved
full SHA to the existing approved peer tasks before any wave edits.

The owned P worktree and branch were removed after clean-state verification.
Its consumed planning handoff was removed; the unrelated 1-3 handoff remains.
There are no owned P gate/browser processes. No push or live operation occurred.

P preserves lifecycle derivations and payloads; it only exposes canonical ports.
The fixed shared seam consists of `queries/run-detail-types.ts`, the
`queries/run-sections.ts` dispatcher, `routes/api-types.ts` (re-exported from
`routes/api.ts`), and `tests/helpers/canonical-run-reader.ts`. The helper exposes
`sqliteRunReader(database, clock)` and `inMemoryRunReaderFake(state)`; the latter
uses explicit records/archived/deleted maps and caller-controlled generation,
and is not canonical acceptance evidence. Existing detail compositions pass the
reader explicitly; shared receipt/diagnostic/inbox compositions do likewise.

`readRunCaptureSection` lives in `queries/run-captures.ts`. After acceptance,
1-3 owns generic `queries/run-read.ts` admission and its stable section schema;
1-1 owns trust/log/capture readers; 1-2 owns `queries/data.ts`. Composition and
route ownership follow P2. `createOperatorArchive` and projection receive the
same canonical service instance. `composeDataQueries(deps)` returns the inferred
`createDataQueries` result `{ contextData, contextAttempts, canonical, source }`.
`registerDataRoutes(app, queriesFactory)` is lazy, preserving archive-only
fixtures; its existing parameterized route handles Context sections and passes
other sections onward. A future literal Rerun route registers before it.

### Candidate gate evidence

All commands below exited 0 on the final executable/test inputs; subsequent
changes before this commit only record evidence in this owner. Logs and their
SHA-256 digests are in `/tmp/hr-tail-readers-evidence/gate-record.json`.

| Command | Result | Log in that directory |
| --- | --- | --- |
| `npm run typecheck` | PASS | `prereq-typecheck-reviewed.log` |
| `npm run lint` | PASS, zero warnings | `prereq-lint-reviewed.log` |
| `npm run test:coverage` | 441 files / 5,549 tests; statements 85.92%, branches 77.56%, functions 89.88%, lines 88.04%; suite-size check PASS | `prereq-coverage-reviewed.log` |
| `npm run web:build` | PASS | `web-build-final.log` |
| `npm run test:parity` | 261 cases PASS; no reference change | `parity-final.log` |
| `npm run build:manifest:check` | PASS | `manifest-final.log` |
| `npm run stores:catalog:check` | PASS | `catalog-final.log` |
| `npm run roadmap:check` | PASS | `roadmap-final.log` |
| `git diff --check`, task links, instruction twins/chains | PASS; nine pairs, chains below 32,768 bytes | recording check |

Coverage used the unchanged `vitest.config.ts`: forks, isolated files,
`maxWorkers = min(4, availableParallelism())`, inherited by all three projects.
Four workers were observed; no task compiler/linter ran alongside coverage.
The full run includes all 80 architecture files and 17 scenario files; no
standalone full architecture run is claimed. Gate inventory membership, floors,
timeouts and assertions remain unchanged. The two existing route guards now
expand imported registrars at their call sites; injected unguarded mutations,
late guards and missing registrars still fail. No guard was added or retired.

### Retained iteration evidence and provisional assessment

Baseline on unchanged executable base `2dd3048f8` passed 949 server/inbox/gate-park
tests and lint. The mechanical worker `/root/sup_astra_query_extract` returned
its bounded query extraction; the supervisor inspected and incorporated it.
The worker is finished; the independent reviewer did not participate in that work.

- Implementation defects: eager data composition broke 48 minimal archive-route
  fixtures; lazy registration restored them. Literal Context routes broke wire
  connectivity; preserving the existing parameterized route restored 53 focused
  checks. The first coverage attempt caught three type-import cycles; neutral
  `api-types.ts` removed them and the 59 focused checks passed.
- Planning omission: independent downstream gates also needed canonical fixture
  backing, including receipt, diagnostic and notification compositions. The
  shared ports and 31 detail fixture bindings now land before wave 1. Earlier
  coverage/parity passes remain historical, not final-candidate evidence.
- Implementation defects in that addition: a new terminal fixture had an invalid
  `reason` field and then an unbranded Map key; both were corrected. The last
  notification port initially imported a core type across the service layer;
  the architecture guard rejected it. A domain `RunExistence` read contract
  removed the inversion; the focused ratchet and final complete gates passed.

All failed logs are retained beside the final evidence. No production runtime,
operator database, live transaction or push was used. Prerequisite integration,
review acceptance and cleanup are complete; all T proof and completion remain open.


## T implementation and proof record

T remains open until its complete independent review, integration gates and cleanup.
The dedicated checkout is based on `64db38e017f585014173bae3c428e6c2a1f63099`.
The supervisor implemented T locally. No peer-owned source, fixture, contract,
authority schema or generated runtime input was edited.

- `server/trust/canonical-reader.ts` binds CLI compositions to canonical read/list;
  the pure `run-reader.ts` helper admits live trust reads with distinct absent, deleted and archived refusals.
  Receipt/failure/gate/write/capture serving no longer requires a span fold.
  Generic operator admission remains 1-3-owned. Shared ports and dispatcher freeze.
- Receipt derivation and Explain run in an authority transaction. The derivation,
  composition fingerprint and item-wide compatible checkpoint reuse are unchanged;
  run/workflow/trace/attempt identity is checked before evidence is served.
  Explain resolves trace identities through a canonical paged read, refusing stale
  walks; dry-run evidence collection uses the same canonical reader and receipt path.
- Canonical lifecycle decides a gate's open state; durable gate rows explain a
  resolution. Optional folded resolution evidence can explain a missing durable
  decision, never open a gate. Identity checkpoints must match the logical item
  and cannot come from a future attempt. Parked intents retain status/generation
  checks and bind workflow/item/run/attempt plus their binding proof.
- Logs use the canonical workflow and attempt upper bound. Optional fold instants
  only expand the partition scan. The run/trace/workflow tuple is checked on each
  line; positive historical attempts remain valid through same-run requeue.
  No immutable initial-attempt field exists on a requeued canonical row, so a
  missing/stale fold never supplies an invented lower bound. Immutable page walks
  and retained-input redaction remain unchanged.
- Capture reads recheck disposition and exact membership after asynchronous byte
  work; failed re-admission disposes prepared leases. Discovery while tracing all
  routes found the existing generic `/artifacts/v1/:artifactId` door bypassed run
  disposition. The repair stays in owned diagnostic queries and trust routes:
  admit at least one verified live membership, refuse archive-only membership,
  preserve legitimately shared bytes and recheck after lease preparation. This
  expands the inspected route proof within T's existing capture-serving scope;
  no new endpoint, shared interface, schema or product authority is introduced.
- Notification publication checks canonical run/workflow linkage inside the
  transaction before creating/folding its row; delivery remains after commit.
  Gate observation uses canonical live list paging in one read snapshot and
  refuses stale page walks. No future notification producer is added.

The separate real SQLite trust fixture supplies canonical create/read/retry/
archive/delete paths. The empty projector supplies evidence only; it is never
lifecycle acceptance authority. New tests exercise no-fold receipt/Explain/log/
failure/capture/gate/write serving, foreign receipt/failure/gate/intent linkage,
immutable log pagination, independent retry receipts, archive-door refusal,
tombstone cascade, unchanged JSONL and shared artifact bytes, deletion during
verification/preparation and lease cleanup. Existing notification durability
proof still checks committed rows before delivery, failed/no-channel delivery,
dedupe, read state and snooze. Final gate results are recorded below after execution.

Iteration findings: newly enforced ports exposed unconfigured receipt, diagnostic
and notification unit fixtures; those now supply real canonical backing. One
capture fixture's intentionally arbitrary input hash could not derive a receipt;
it now binds its input to the registered canonical schema. Typed absence changed
Explain's unknown-run assertion to check both refusal class and canonical absent
reason. An inner cleanup catch initially violated `preserve-caught-error`; the
aggregate now retains both failures with the original admission failure as cause.
The generic route's new pre-read initially escaped its established corruption
normalizer; the existing BFF path-redaction test caught it, and the normalization
boundary was restored. Earlier parity (261 PASS), build and freshness checks are
provisional for the later generic-route repair, not final-candidate evidence.

The later generic-byte proof also preserves cross-membership metadata agreement
when one member is archived and another remains live. Its archive fixture initially
omitted the terminal failure named by the real run; the canonical archive service
correctly refused it. The fixture now freezes the actual failure section and
passes archive binding checks. A provisional parity run collided with a concurrent
production build over `dist/dashboard` and had one readiness timeout (256 passed,
two failed, three not run). Build and parity are now serialized, with compiler/
linter processes stopped before parity and coverage; no timeout/reference change.
The host has 11 logical CPUs and 18 GiB RAM. Existing peers acknowledged the next
heavy-gate slot for T and are keeping their source work independent.


A peer feasibility limitation was reported during T gates: 1-3's new no-fold
header invokes the P-era capture-availability reader, whose retained generic
admission still requires a fold. Thus P's earlier either-order independence
claim is not established for that particular 1-3 path. T supplies the canonical
capture admission within its approved ownership and does not depend on either
peer. The 1-3 owner was told to record the actual dependency and handle the
required dependency/merge-order amendment with its operator; this task neither
silently approves that amendment nor edits 1-3 files. Acceptance of T does not
claim completion or independent gates for either peer.


### T full-suite repair evidence

The first complete T coverage run executed 442 files and 5,561 tests: 438 files /
5,555 tests passed, four files / six tests failed. This is a failed gate, not a
coverage-floor pass. `/tmp/hr-tail-trust-evidence/coverage.log` retains the result.

- The archive import guard found that the new admission helper value-imported
  `RunRecordService`, reaching `base/workflow.ts` from immutable Archive reads.
  The runtime factory now lives in composition-only `canonical-reader.ts`; pure
  admission uses only a type import. The unchanged archive guard passes.
- Two privacy fixtures supplied foreign workflow/item/attempt or receipt tuples.
  They now bind to the fixture's actual run; all raw-key/EID withholding and
  immutable-authority assertions remain intact. Together these repair checks
  passed seven tests in two files.
- The inherited D344 roadmap hierarchy changed four displayed task codes without
  updating `roadmap-ui.test.ts`. The narrow repair updates those four expected
  values only; all six UI tests pass against unchanged generated roadmap input.
  Both existing peers requested this shared baseline correction. No unrelated
  roadmap task's source, branch or worktree was modified. The earlier P reuse
  record missed this guard-consumed documentation input; it does not justify
  waiving the failing test. This interim repair was later superseded by the accepted master update
  recorded below; it is absent from the final T diff.
- Both unchanged whole-source lifecycle SQL guard tests exceeded their 30-second
  deadlines under four-worker coverage. Another task's compiler/linter was
  observed during the run. Focused discrimination and a lower file-concurrency
  repeat will preserve all tests, assertions, floors, isolation and deadlines.

After the failures, T released the acknowledged heavy-gate slot to 1-2 and held
its own whole-repository compiler/AST guard work during the peer coverage run.
The completed serialized parity run passed all 261 cases. Later factory/fixture
repairs reopen affected checks before candidate acceptance.


Focused discrimination passed both unchanged lifecycle SQL guard tests in 16.40
seconds (8.405 / 7.740 seconds), with no deadline change. The temporary adapter
`/tmp/hr-tail-trust-two-workers.config.mts` imports the actual Vitest config and
asserts deep equality after stripping only root/project `maxWorkers`. Resolved
configuration confirms two workers at root and every project, unchanged include/
exclude sets, isolation, 30-second test/hook timeouts and all coverage thresholds.
Its SHA256 is `32733f490018020281a1bd648cfd5721a56fc52a5821d61d4c24017ba7955977`.

The repaired factory passed 97 focused trust tests in seven files. Final source
inspection found one further generic-byte admission gap: a forged bundle runId
could otherwise keep its old content digest and claim another live run. The
existing bundle content-identity verifier is now shared by exact-bundle and
generic-byte admission. A negative control supplies a different real live run
with the original digest and verifies refusal; all 36 capture tests pass.


The generic-route change passed 157 BFF/archive tests in two files. Its new test
initially used an unbranded runId; canonical parsing corrected the fixture and
final typecheck passed. Full lint reported a transient parser error while that
fixture was edited; focused lint and a new full lint on frozen source passed.
Build, manifest/catalog/roadmap freshness and whitespace checks passed. Final
all-file input hashes (excluding only this evidence owner) are retained in
`/tmp/hr-tail-trust-evidence/final-inputs.json`, 2,175 inputs, SHA256
`f237c9677e27ab79b87ad767d05dc8bd04930ca0a9828bb4352c3e96c6cce7f3`.
This inventory includes Markdown and generated roadmap HTML consumed by tests.


### Accepted upstream baseline update during T verification

While T coverage ran, master integrated the independently reviewed roadmap naming
candidate `55efefcf4dd0145e477126b19688e36f0377ba1e` as
`a3c73c8039508ea307db70f9c2f01228c689435c`. Its commit records complete
`sup_review_task_names` PASS and 441-file/5,549-test coverage. The accepted change
includes `generate-roadmap.ts` and both roadmap test files, and supersedes T's
interim roadmap expectations. T stopped its owned old-base coverage with SIGTERM
(exit 143), verified its runner and children exited, and retained the partial log;
no complete-pass claim is made. Both formerly timed-out guards had passed under
that coverage run in 22.323 / 22.509 seconds without raised deadlines.

T preserved its implementation, removed only its now-superseded roadmap test
patch, and fast-forwarded its dedicated branch to the accepted merge. The final
review base is now `a3c73c8039508ea307db70f9c2f01228c689435c`; original creation base
`64db38e017f585014173bae3c428e6c2a1f63099` remains historical provenance. Relevant
instruction changes were read; existing in-flight P/T permissions remain intact.
The added source/test inputs require fresh final gates. This is an external
prerequisite change, not an accepted test waiver or peer implementation merge.


## T candidate gates — awaiting independent review

The complete T candidate is the implementation commit containing this record,
reviewed against base `a3c73c8039508ea307db70f9c2f01228c689435c`. All T checkboxes
remain open until exact-candidate independent acceptance, integration and cleanup.
T-R1 is one fresh complete `sup_review`, covering every T changed path and the
T1–T4/proof-table requirements, including generic artifact admission and privacy.
No peer implementation is included. The accepted upstream roadmap test repair is
outside T's diff and is preserved unchanged.

| Gate | Evidence and result |
| --- | --- |
| Typecheck / full lint | `npm run typecheck`, `npm run lint`: exit 0; `typecheck-upstream.log`, `lint-upstream.log`. |
| Full coverage / suite size | `npm test -- --coverage --config /tmp/hr-tail-trust-two-workers.config.mts`, then `npm exec tsx -- scripts/suite-size.ts`: exit 0; 442 files / 5,561 tests; 318.292 seconds. Global statements 85.92%, branches 77.63%, functions 89.89%, lines 88.08%; configured floors pass. 345 unit / 17 scenario / 80 architecture files. |
| Visual parity | `npm run test:parity`: exit 0, 261 cases, 56.256 seconds; `parity-upstream.log`. No reference refreeze. |
| Build / manifest / catalog | `npm run web:build`, `npm run build:manifest:check`, `npm run stores:catalog:check`: exit 0 in final logs. Compared pre/post-upstream all-file manifests: no runtime, build-config or dependency input changed; these results are reused. |
| Roadmap | `npm run roadmap:check`: exit 0; both roadmap test files pass all 29 tests on accepted upstream source. |
| Documentation / whitespace | Nine instruction pairs equal, chains within cap, no audit issues; `git diff --check` passes. |

Evidence is retained in `/tmp/hr-tail-trust-evidence`. The final manifest is
`final-inputs-upstream.json`, 2,175 files including documentation/generated test
inputs, excluding only this evidence owner; SHA256
`b9a53d61b23abafc67b941a67b0af15990b7e9618435584c3b59b6ac2d939671`.
Every listed input was reverified unchanged after coverage. The resource-only
adapter and resolved configuration are retained there; both former 30-second
SQL guards pass under final coverage in 22.341 / 22.657 seconds. No owned compiler,
linter, build or parity ran alongside coverage. Peers confirmed their releases.

All failed and interrupted iterations remain recorded above. T's heavy-gate
window was released after final parity for peers to continue independently while
this frozen candidate receives review. No push, production write or live HR run.
