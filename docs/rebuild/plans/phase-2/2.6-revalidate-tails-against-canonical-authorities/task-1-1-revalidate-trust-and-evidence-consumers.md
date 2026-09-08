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

P is **accepted and integrated**. T remains unstarted. Independent complete review
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
