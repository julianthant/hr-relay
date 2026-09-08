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
`routes/data.ts` registers the exact Context Data/Attempts paths before the
parameterized section route. The data factory return is inferred, allowing 1-2
to add Rerun values and its route without editing the root. Its production
backing bundle supplies AuthorityDatabase snapshot/evidence reads,
`Pick<RunRecordService, 'read'>`, full descriptor resolution, and source fold/log
evidence access. Existing minimal Context test compositions may omit that
explicit bundle; future Rerun reads must refuse `RERUN_VALUES_NOT_CONFIGURED`
before reads if unconfigured, never use a raw repository fallback. No Rerun
feature is implemented in P. Trust/operator route ownership is extracted as
needed so their peer implementations do not share route files. Root dispatch,
request identity, loopback/content-type guards and static-last order remain.

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

Plan recorded on the peer planning commits `a57ecae8f` and `8af59c63e`;
shared roadmap generation/freshness and owned document links pass. These
planning changes contain no executable/test/config/dependency changes; full
code gates are not represented as rerun by this documentation commit. Baseline on unchanged executable base `2dd3048f8` passed: focused
server/inbox/gate-park command above, 50 files/949 tests, exit 0, 16.71 seconds;
`npm run lint` exit 0. Logs are `/tmp/hr-tail-readers-evidence/baseline.log` and
`baseline-lint.log`. Nine existing instruction twins and their project chains
passed equality and the 32768-byte cap; task-local document links resolve.
No implementation, review, full coverage or live gate has run. The accepted
recovery note's unique findings are captured above. Prerequisite/common-base
and trust completion remain open.
