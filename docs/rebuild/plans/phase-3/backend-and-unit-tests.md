# Backend, unit tests and confirmed Logs connection

Status: Phase 1 and its startup reconciliation prerequisite accepted locally on 2026-10-01;
Phases 2–5 remain proposed. This descriptive
supporting plan does not assign new roadmap task numbers, reopen accepted task checkboxes, or grant
release/freeze/cutover admission. Roadmap recording and integration remain separate operator choices.

## Goal and agreed direction

Make the local backend maintainable by one developer and ready for a future macOS/Windows Electron
shell. Reorganize the backend and its unit tests together, simplify the runtime's public boundaries,
and connect the approved Logs design to structured, confirmed facts emitted by the backend.

The operator wants focused unit tests now. Complex-test design and execution will be discussed
later with the operator. An [initial test audit](backend-and-unit-tests-audit.md) inventories the
corpus, identifies mixed tiers and proposes dispositions. This plan does not delete complex suites
as a shortcut or claim that unit tests prove browser behavior, persistence, sockets or crashes.

The continuation is
`/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-logs-backend`,
branch `codex/logs-backend`, source HEAD `27fd907207ab42fc938856954ef75a136da32f74`.
It contains the approved Logs UI commit `1211a24b81547ec2b7c6e27837c4d57c081d259e`.
Verify the checkout and any new changes before each phase. Keep the existing worktree; do not
create more worktrees, repurpose another checkout, push or merge without operator authorization.
Before Phase 2, complete the separately authorized [continuation reconciliation](backend-continuation-reconciliation.md)
and verify its accepted combined candidate. Phase 1 acceptance alone does not incorporate the
startup branch or finish the module layout.

These are five implementation phases for this initiative, not the numbered roadmap's phase-exit
gates. Each fresh chat implements only its requested phase. Heavy execution follows the current
`~/.codex/codex_workflow/heavy_route.md` directly, using its roles, ownership, verification and
closure rules. The operator selected Heavy route only: do not use the Astra orchestrator,
Luna-worker skill or other worker-adapter skills. This task-specific route replaces earlier
orchestrator/adapter requirements for these phase chats. Planning does not launch workers.
Assign disjoint files explicitly and keep integration and acceptance with the root.
The handoff authorizes existing `docs/` owners and external evidence in place of the absent
`agent_docs/` framework. Keep that substitution; do not create a parallel documentation framework.

## Scope boundaries

- Preserve the approved Logs layout, typography, colors, read/fill/click treatment and step-end
  screenshot presentation. Attention/identity/failure blocks are deferred.
- Preserve detailed backend traces, classifications, exact ownership and external-write safety.
- Build one reusable API; workflows and system tasks do not open their own frontend connections.
- Give each worker an ordered logical stream. Multiplex those streams through the existing transport.
- Use current TypeScript, Hono, SQLite authority and JSONL diagnostic storage. No new distributed
  queue, database, orchestration service or logging framework is needed for this local application.
- Prepare an application boundary that Electron can host later. Electron shell, installer, bundled
  runtime/browser compatibility, IPC implementation and OS acceptance are separate delivery work.
- Do not migrate or revalidate every existing workflow now. New authoring follows the shared model;
  old runs and unmigrated definitions have an explicit legacy path. Do not guess confirmed success.
- Keep existing complex tests available with recorded dispositions. Only exact obsolete or replaced
  tests are retirement candidates. Unknown primary-checkout files are outside cleanup scope.

## Backend layout and naming

The target structure is:

```text
src/
  base/                         browser-safe workflow/task authoring builders
  domain/                       shared strict schemas and pure business rules
  workflows/<workflow-id>/workflow.ts
  dashboard/                    renderer, state and client transport adapter
  backend/
    app/                        boot, configuration admission, dependency composition
    runtime/                    worker loop, execution, sessions, checkpoints, write sequencing
    runs/                       start, cancel, retry and run-read services
    logs/                       confirmed facts, step/result projection, stream coordination
    systems/<system>/           semantic driver, session provider and verb-object tasks
    processing/<capability>/    headless extraction, OCR, normalization and roster tasks
    workflow-tasks/<workflow>/  workflow-specific task wrappers over domain decisions
    storage/                    SQLite repositories, JSONL and artifact adapters
    transports/                 HTTP/SSE routes and transport admission
  cli.ts                        thin command entry point
```

Create folders when they have an owner and real code. Keep the browser-safe builders outside
`backend`; moving every existing `base` module into the backend would break workflow imports.
Shared wire shapes belong in `domain`; Node/filesystem/browser implementations belong in `backend`.
The renderer does not import the backend. Composition wires dependencies; module functions receive
explicit ports instead of reaching through a global container.

Use kebab-case files/folders, verb-object task names, verb functions in camelCase, and PascalCase
types. Name a module by its responsibility, such as `log-service.ts` or `log-repository.ts`.
Avoid an expanding `utils`, `common` or `manager` catch-all. Split cohesive policies from I/O when
that produces a useful interface; do not split a file solely to meet a line-count target.

The runtime keeps one entry point per worker/run/write operation. Extract decision policies from
the large executor/sequencer and resource adapters from composition, preserving transaction order
and shared SQLite transaction ownership. A directory move and a behavior change should be separate
reviewable commits. No long-term forwarding-module maze.

### Store ownership

The current `src/stores/` modules are reusable task packages, not database repositories. Keep that
cohesive pattern: a browser store owns its semantic driver declaration, session provider and tasks;
a headless store owns sessionless tasks. All three kinds use the same validated registration path.
Their implementations move by responsibility:

| Current store kind | Proposed implementation home | Responsibility |
| --- | --- | --- |
| Browser: UCPath, Kuali, CRM and the other registered browser systems | `backend/systems/<system>/` | Browser/session lifecycle, semantic page operations and reusable system tasks |
| Service: extraction, OCR, normalization and roster | `backend/processing/<capability>/` | Artifact/provider processing and reusable headless tasks |
| Workflow: Person Lookup and Separations mini-stores | `backend/workflow-tasks/<workflow-id>/` | Task wrappers, provenance and named refusals for workflow-specific domain decisions |

Use a consistent `store.ts` registration file and `tasks/<verb-object>.ts` convention in each
package. Browser packages additionally have `driver-declaration.ts`, `session-provider.ts` and
`driver/`. Boot composition owns the executable task registry. Preserve the existing factory
validation, exact shared driver object, namespace/contract IDs, strict outputs and effect rules;
moving a file does not authorize changing a task's contract or widening write authority.

Workflow definitions continue importing contracts, never concrete store implementations. Pure
decisions remain in `domain`; database repositories remain in `backend/storage`. Place shared
helpers at their actual owner after checking for I/O; do not blindly move `stores/common` into
domain or create another unowned shared-helper folder. Pending/unwired stores remain explicitly
unwired; a directory move is not a feature implementation or retirement decision.

Store tasks receive the runtime's shared log/action API. Browser facts inherit the store's exact
system and leased session; the runtime adds worker/run/attempt/step identity. Headless processing
and workflow tasks have their own source kind and explicit evidence references where appropriate,
not a guessed browser-system label. Internal computations still stay out of the approved basic
Logs feed while retaining their detailed traces.

Matching units cover registration refusal, exact driver/session binding, contract validation,
task input/output/refusal behavior, injected semantic-driver effects and confirmed log facts.
Actual selectors, login, saved external records and provider/network behavior remain separate
complex proofs for later operator review.

## Unit-test model and target layout

```text
tests/
  unit/
    domain/<module>/
    backend/<module>/
    dashboard/<module>/
    workflows/<module>/
    tooling/<capability>/       deterministic script, build and test-runner policies
  integration/<module>/         real storage, process, transport or composed boundary proofs
  architecture/                import, schema, collection and generated-product invariants
  scenario/                    existing workflow/feature scenarios and live manifests
  parity/                      existing browser scenes and reviewed references
  fixtures/                    shared synthetic data
  helpers/                     only small, explicitly owned cross-tier harnesses
```

A unit exercises a cohesive public behavior with deterministic inputs. Inject external page,
storage, network, process, clock and ID ports where they are dependencies. Real SQLite, a running
HTTP server, child processes, multi-module workflow walks and a browser belong to other tiers.
Reading a fixture file alone does not make a pure function test an integration test. DOM component
wiring can be a small unit; it is not visual evidence.

Use independent expected outcomes. Assert the returned fact or observable state and the refusal
case that would catch a bug. An external adapter call can be a necessary effect oracle; reproducing
all private call order is not a useful default. Do not mock the policy under test, derive the
expected result by calling that policy again, or equate a fake repository with durability.

Phase 1 establishes accurate tiers and collection ownership. Phase 2 finishes module ownership
for every retained unit and its support files; the flat unit root is not the final layout. Existing
domain, dashboard, workflow and tooling units receive explicit homes without requiring unrelated
source refactors. Keep fixtures with their consumers; use shared fixture folders only for actual
cross-module data, and do not leave unused resource harnesses under units merely for compatibility.

Substantive unit quality review happens with each changed module, after a short triage and before
behavior-sensitive refactoring. Reuse adequate tests; rewrite poor tests, consolidate overlapping
coverage, and remove obsolete or redundant units only with a recorded reason and surviving behavior
mapping. A deliberately retired requirement must be identified explicitly. Private implementation
assertions need a meaningful behavior or constraint to justify keeping them. Do not retire a test
because it fails, nor lose distinct refusal, boundary or safety cases when consolidating.
Complex-suite redesign and retirement remain for later operator discussion; their retained files
stay collected in their own tiers. Extracting a pure case does not authorize deleting its original
complex proof. These suites are not in the development phase gates below.

## Shared logging contract to implement

Tasks call a small runtime-owned logger/action API through their execution context. System helpers
and semantic drivers bind the real store/session. No arbitrary workflow webhook or frontend URL.
The backend validates and classifies facts, chooses concise results and serves display-ready data.
The frontend handles presentation, search, copy, paging and subscription state.

The API names below are proposed public meanings; Phase 3 finalizes signatures against the existing
task and frozen operation declarations.

| Operation | Confirmation and meaning | Display fact |
| --- | --- | --- |
| `form.read` | Read and validate the declared fields or empty state | Read values, from the exact system/session |
| `form.fill` | Enter controls and confirm their readback | Filled values; no external write claim |
| `action.click` / `action.keypress` | Verify the declared UI effect | Confirmed interaction |
| `form.submit` | Use the existing write sequencer, then verify the saved record and durably settle | Confirmed external write only after that complete boundary |
| `form.verify` | Compare observed fields/record with declared expected facts; retain purpose and source | Verification reads plus an explicit verification outcome |
| `step.result` | Select a declared outcome from confirmed evidence | Concise text such as “No pending terminations” |
| `step.capture` / `step.finished` | Capture while the exact page lease is owned, then associate its artifact with the step occurrence | Screenshot metadata at that step's end |

Every submitted form needs verification of the saved effect, not a check that the Submit button was
clicked. Required post-submit verification remains inside the protected write machinery. A false,
ambiguous or unreadable verification cannot publish a successful submit or empty-state result.
UNKNOWN submits are never automatically retried. Filling, submitting and verification remain
distinct event meanings even when rendered together in one form table.

The versioned event/wire contract must include:

- Stable event identity and a sequence within an exact worker stream incarnation. Include worker,
  run, claim/attempt, task attempt, frozen invocation/action and step occurrence identity.
- `system` from the registered driver/session, such as UCPath, Kuali or CRM. This is the external
  application, separate from the browser engine. Do not infer it from log prose.
- Action kind, safe declared label/field values, verification purpose/proof references, and explicit
  unavailable/refused states. Detailed attempted/started/failed actions remain in backend traces.
- Distinct instants: `occurredAt`, `confirmedAt`, `recordedAt`, and `capturedAt` for screenshots.
  Use `confirmedAt` for confirmed action display. A displayed timestamp is not the transport arrival
  time. Sequence and exact identity determine order; wall-clock ties do not.
- A backend-selected step result and exact step-owned capture metadata. Do not select the last
  arbitrary string field in the frontend or attach an unowned capture to a nearby step.

After a normal read/fill/interaction is confirmed, publish its fact before unrelated remaining task
work finishes. Confirmation is still required. Keep lifecycle traces for actions that never confirm.
For an external write, publish its successful outcome only after the verifier and durable settlement.
No new fallible log flush may run between the write fence and external submit.

Keep log delivery status separate from transaction outcome. A failed diagnostic/log append after an
external write must not turn a committed operation into a retryable task failure. Surface the log
delivery failure explicitly through a defined diagnostic/health path. Never silently claim that a
missing durable log was delivered. Define queue saturation and shutdown behavior before wiring it.

## Delivery and performance shape

Keep the existing authority database and diagnostic JSONL ownership. Initially adapt the existing
note writer, retention/archive behavior and incremental stream reader rather than creating a
second authoritative UI-log database. A worker stream is a logical identity, not a separate browser
connection or HTTP server. The BFF multiplexes subscriptions and filters by exact run ownership.

Write/validate a fact once; serve that persisted record to history and live readers. Treat worker
IPC or file-change notifications as wake-up hints, with bounded incremental tailing as recovery.
Do not expose an event before the persistence contract says it is available. Reuse the bounded
demand-driven SSE bridge; a future Electron transport uses the same event contract.

Support snapshot plus ordered deltas, event-ID deduplication, resume cursors, generation changes,
bounded queues and explicit reset on a gap or overflow. Close subscriptions and owned writer handles
on shutdown. UI history and live events must not duplicate a row or merge different attempts.

Optimize the actual hot path: no complete workflow/day rescan for each event, no complete Logs
refetch for each timeline revision, no repeated field/result classification in the renderer.
Record deterministic work counters and queue bounds in units. Actual wall-clock latency, filesystem
concurrency, socket behavior and Electron process performance remain unverified until their later
operator-reviewed checks. Do not advertise a measured speed improvement from unit tests alone.

## Phase gates used during this initiative

Run exact affected unit files through the existing runner, scoped lint with zero warnings, and
affected static/generated/build checks. Example before layout migration:

```sh
npm run test -- --project unit tests/unit/declared-action-confirmation.test.ts
```

Phase 1 introduces the explicit unit command and records its exact collection. Later phases bind
their actual moved paths in their acceptance record. Do not issue a command against a nonexistent
future path or call an empty collection a pass. Tests imply lint; keep compiler/linter work separate
from any later coverage run. Use the current maximum of four test-file workers.

Do not run or redesign integration, scenario, browser parity or live HR suites in these phases.
Do not globally exclude them, lower floors, remove assertions or hide them from the complete runner
to obtain a green result. Approved unit rewrites, consolidation and exact retirements require the
Phase 2 behavior/disposition mapping and must preserve useful behavior, refusal and safety coverage.
Adjust path-bound guard and coverage ownership deliberately during moves.
New test project collection must preserve every retained file exactly once.
Keep the effective safety-critical coverage ownership when moving code: a former `src/core/**`
module must not silently lose its 80% floor under a new `src/backend/**` path.

Historical unrelated failures are not this initiative's repair scope. Record a baseline failure
and its affected inputs, then resolve new diagnostics attributable to changed modules. A build or
static check that cannot pass must be reported as incomplete, not waived by a focused unit pass.
The handoff's 72 unrelated typecheck diagnostics are historical, not a current count.

At each phase end, save exact commit/check commands, outcomes, moved/retired test mappings, and
deferred obligations in that phase's acceptance record below. Commit by logical category; never
push. Do not mark a numbered roadmap phase, production release or Electron acceptance complete.
Later operator-reviewed complex checks and applicable full gates remain separate admission work.

## Phase 1 — Make test ownership and unit execution explicit

**Deliverable:** an accurate test-tier map, a usable unit-only command, and a documented artifact
policy. Start with the audit, not deletion.

1. Refresh the complete inventory. Classify test bodies and transitive harnesses. For a mixed file,
   move it intact to integration initially; extract its pure cases with the owning backend change.
2. Record keep/move/rewrite/retire dispositions. Quality-review the affected seams first; leave
   unreviewed complex behavior explicitly pending rather than issuing a blanket quality verdict.
3. Move clearly classified tests to their tier homes and preserve existing module groups, assertions
   and cases. Phase 2 finishes the module layout alongside backend restructuring.
   Update imports, shared fixture ownership, instructions twins where present, and project/guard
   collection. Keep scenarios and parity in their existing tiers.
4. Add `test:unit` and an explicit integration project/script without changing the complete runner's
   retained membership. Prove that the unit command cannot collect a DB/process/socket/browser
   composition test, and every retained Vitest file is still collected exactly once overall.
5. Reuse runner scratch/failed-run retention. Remove the exact stale tracked `test-results/.last-run.json`
   only after verifying it is still unused. Ignore generated metadata at its proper owner; preserve
   references and useful evidence. Do not clean another checkout.

**Unit coverage:** collection selection, nonempty refusal, duplicate/orphan detection and artifact
path policy using small injected listings/fixtures. These tests protect actual mistakes in the
runner configuration, not a copy of its constants.

**Verifiable outcome:** inventory/disposition mapping accounts for all source test files; the new
unit command has a recorded nonempty collection; focused runner/policy units and lint pass;
all retained tests have a collection owner. Complex suites remain unrun. This outcome does not
require rewriting every old assertion or completing complex-test design.

## Phase 2 — Give backend modules and their unit tests matching homes

**Deliverable:** the cohesive backend structure above, with a thin boot/composition boundary,
finished unit module ownership, and reviewed focused coverage for each changed responsibility.
Unit cleanup belongs inside this phase; do not launch a separate wholesale cleanup first.

1. Verify accepted Phase 1 and reconciliation handoffs. Produce a current-to-target source/test/support
   move map and dependency rules before moving code. Assign every retained unit and support file
   a clear module owner, including units outside the backend packages. Preserve pure
   `base`/domain/workflow imports and frozen runtime identities.
2. Before each module's refactor, map its public responsibilities and meaningful success, refusal,
   boundary and safety behavior. Triage relevant cases as keep, rewrite, consolidate or remove;
   record reasons, gaps and surviving coverage. Use the actual bodies and called harnesses, not
   filenames alone. Establish or refine focused behavior checks before behavior-sensitive changes;
   reuse adequate existing units and do not add tests solely for a mechanical move.
3. Move modules in bounded sequential packages: composition/transports, run services, runtime,
   browser stores, processing stores, workflow-task stores, storage/adapters. Update registrations,
   CLI imports, task fingerprints,
   build-manifest/catalog generators, instruction links and path-bound guards from their sources.
4. Separate pure execution, checkpoint, terminal and write-decision policies from resource I/O.
   Preserve authority transactions and fence/submit/verify/settle order. Do not broadly redesign
   persistence or change transaction decisions in the same mechanical move.
5. Finish unit cleanup with each package: rewrite poor cases around public behavior, consolidate
   genuine overlap, and remove exact obsolete or redundant cases with the recorded disposition.
   Keep meaningful failure visibility and independent expected outcomes; do not replace durability
   evidence with fake repositories or delete complex proofs. Place tests and fixtures at their
   final owners, remove verified unused unit support, and record focused units/lint and affected
   static/generated checks before accepting the package.

**Unit coverage:** worker ownership and sequential claiming policy; cancellation/claim-loss decisions;
exact action/attempt binding; checkpoint compatibility; submit/verify/UNKNOWN/refusal policy. No fake
database assertion is described as proof of atomic settlement or recovery.

**Verifiable outcome:** no renderer/workflow runtime imports from the backend, no stale imports or
unowned moved code; every retained unit/support file has a named module home, with no unexplained
loose files at the unit root. Each changed module has a completed behavior/disposition map linking
rewritten, consolidated or removed cases to surviving coverage or an explicitly retired requirement.
Focused units/lint pass, affected generated closures are current, and the production bundle check
confirms browser-safe imports. Report any static baseline limits.
Real process boot, DB recovery and external-write behavior remain deferred complex proofs.

## Phase 3 — Implement the shared confirmed action and step API

**Deliverable:** one versioned contract and execution-context API used by system helpers and a
synthetic task through the production injection seam.

1. Finalize strict event schemas, action meanings, verification purpose, exact worker/run/session/
   step identities, timestamps and declared result selection against the existing frozen declarations.
2. Implement read, fill/readback, interaction confirmation and verification helpers. Route submit
   through the existing sequencer; require saved-effect verification before its successful fact.
3. Publish ordinary confirmed facts before the enclosing task settles. Preserve full lifecycle
   traces and exact verification proof. Define logging failure/saturation handling separately
   from the remote transaction outcome.
4. Put concise result selection in the backend. An unreadable scan is unavailable/unknown;
   only a confirmed empty scan can select “No pending terminations”.

**Unit coverage:** pending verifier means no success event; verifier false/throw means no success;
confirmed fact arrives while the enclosing task is still blocked; readback mismatch; navigation
click versus submit classification; source-system binding; distinct timestamps; cross-attempt/session
refusal; ambiguous results; logging failure cannot request another external submit. Use controlled
promises and a manual clock, not sleeps or guessed timer durations.

**Verifiable outcome:** a synthetic task using production context wiring emits the documented facts
and trace lifecycle; all focused API/policy units and lint pass. This is not a live-browser proof.
Record the exact shared contract at its existing reference owners and decision index when approved.

## Phase 4 — Connect ordered worker streams and incremental history

**Deliverable:** the shared facts have a persisted history path and a bounded, resumable live
`run-logs` subscription, using the existing transport.

1. Adapt existing JSONL note writing and scoped incremental reading behind the log module ports.
   Preserve archive/retention/redaction and exact run boundaries; define versioned old-record reads.
2. Wire worker facts to the BFF hub. Give each worker incarnation a sequence/stream ID, multiplex
   connections and serve run-owned deltas. Keep persistence, notification and delivery statuses explicit.
3. Implement snapshot/delta merge, deduplication, resume/gap reset, cancellation and shutdown policy.
   Reuse the pull-based SSE queue; do not create an eager unbounded stream-controller queue.
4. Replace repeated full reads with cursor/delta work. Measure deterministic parser/read/dispatch
   counts with injected ports and bounded workloads.

**Unit coverage:** interleaved workers; sequence ties and restarts; duplicate replay; snapshot/delta
equivalence; expired cursor; partial line tail; malformed/foreign event refusal; queue overflow;
slow-subscriber isolation; redaction; delivered versus failed append; shutdown draining policy.

**Verifiable outcome:** the production worker composition and query/subscription adapters are wired;
unit fakes demonstrate the stream protocol and work bounds, focused units/lint pass, and affected
wire/generated checks pass. Actual filesystem replay, process notification and socket backpressure
remain explicitly unverified until operator-reviewed complex checks. Do not call this a measured
end-to-end performance result.

## Phase 5 — Serve the approved Logs UI with step results and captures

**Deliverable:** the existing LogFeed renders the backend's confirmed, display-ready step facts
and receives live deltas without rediscovering business outcomes in the browser.

1. Map served events to the approved renderer types, preserving table and row design. Keep frontend
   functions limited to presentation, search/copy/count, paging and subscription state.
2. Move result selection/classification out of the frontend bridge. Preserve a truthful legacy
   fallback for old runs; do not manufacture confirmed actions or missing results.
3. Capture at an explicit step end while its session/page lease is owned. Serve stable artifact
   identity, owning step occurrence, system/session and `capturedAt`; render once at that step end.
   Stream artifact metadata, not image bytes; use the existing guarded artifact download path.
   Represent missing/failed capture truthfully without changing a settled write into a failure.
4. Update live/paged merge and stale-response isolation so switching runs or attempts cannot place
   a late result or screenshot into the new view. Preserve immutable history cursors.

**Unit coverage:** server display projection, backend-selected empty result, verification-read
presentation, confirmed-only rows, system labels, action timestamp use, capture dedup/ownership,
failed/absent capture, old records, paged/live duplicates and stale-run responses. Small component
wiring tests may check served content; CSS screenshots and live capture behavior are deferred.

**Verifiable outcome:** backend data drives the existing renderer through the real client adapter;
focused projection/adapter/component units, lint and affected bundle/static checks pass. Produce
synthetic sample payloads for operator inspection. Visual approval is retained, but fresh browser
parity, live HR verification and full workflow migration are not claimed.

## Later work with the operator

Review the retained complex suites in plain language: situation, real components/resources,
simulated boundary, expected evidence, and failure being detected. Agree on a small scenario list
before implementing or rewriting complex cases. Useful initial candidates are real boot/shutdown,
JSONL replay/retention, paused-client backpressure, write settlement/recovery, live form confirmation,
step capture ownership, approved UI behavior and macOS/Windows packaging. These are suggestions,
not accepted scenarios or automatic next-phase work.

Only after that review should the initiative seek applicable full gates, workflow acceptance,
Electron delivery or release admission. Unit-only progress does not erase those later obligations.

## Acceptance records

Keep one concise record per completed phase here, with exact candidate SHA, changed module/test
mapping, focused commands/results, generated/static evidence, known baseline failures, explicit
unrun checks and next phase prerequisite. Do not mark completion from a worker summary alone.

| Phase | State | Accepted candidate and evidence |
| --- | --- | --- |
| 1 — Test ownership and unit execution | Accepted locally | `a46d792273af908dd9bfd29d6f5eb19b874a319e`; focused checks and independent preservation verification below; broad checks deferred |
| 2 — Backend modules and reviewed units | Proposed | Requires accepted Phase 1 and continuation reconciliation |
| 3 — Confirmed action/step API | Proposed | Requires Phase 2 |
| 4 — Ordered worker streams | Proposed | Requires Phase 3 |
| 5 — Approved Logs connection | Proposed | Requires Phase 4 |

### Phase 1 acceptance — 2026-10-01

Accepted code candidate: `a46d792273af908dd9bfd29d6f5eb19b874a319e`, branch
`codex/logs-backend`, in the assigned continuation worktree. The source base is
`27fd907207ab42fc938856954ef75a136da32f74`; approved UI commit
`1211a24b81547ec2b7c6e27837c4d57c081d259e` remains an ancestor. Production source and
dependency-lock inputs are unchanged. This acceptance covers only this initiative's Phase 1.

Logical commits: `cf776d22c` preserves the supplied planning inputs; `8636292be` establishes
test ownership, collection and artifact policy; `c3a39c570` moves remaining resource suites
intact and corrects the current tier owner; `a46d79227` preserves synthetic-source fixture
paths after relocation. The recording-only closure retains this tested code candidate.

The [complete disposition mapping](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-09-30/logs-backend-phase1/disposition.json)
accounts for all 666 original source tests: 239 unit, 267 integration, 84 architecture,
17 scenario and 59 parity files. There are 351 moves, 315 keeps and no retirements. Mixed
DB, filesystem, process, HTTP and workflow-composition suites moved intact. Fixture-only reads,
injected policies and DOM wiring remain units; the two resource-capable helper imports retained
in units were checked against the functions their cases actually call. Case extraction and
complex-suite quality redesign remain deferred to their owning backend work and operator review.

All 607 original offline Vitest files remain uniquely collected. Three new policy files produce
610 files across four projects: unit 241, integration 267, architecture 85 and scenario 17.
Independent AST comparison preserves all 6,407 original registration titles and counts, with
no original assertion-count decrease. Changed bodies are explained by relocated paths/project
ownership and strengthened fixture guards. Scenario/parity test and support-source bytes, and
the three uncollected live manifests, match baseline. Fork isolation, four-worker limit,
timeouts, coverage inputs and floors are unchanged.

| Focused command or receipt | Actual outcome |
| --- | --- |
| `npm run test:unit -- tests/unit/scripts/test-project-policy.test.ts tests/unit/scripts/test-artifact-policy.test.ts tests/unit/advisory-redaction.test.ts tests/unit/system-login-recipes.test.ts tests/unit/canonical-run-reader-fixture.test.ts` | 5 files / 48 cases passed; final-candidate policy rerun passed 3/3 |
| `npm run test:unit -- --project integration` | Expected refusal, exit 1: `Invalid unit test filter: "--project"`; named commands reject options that could widen selection |
| `npm run test:architecture -- tests/architecture/test-data-ownership.test.ts tests/architecture/test-artifact-ownership.test.ts` | Final candidate: 2 files / 6 cases passed |
| `npm run test:architecture -- tests/architecture/guard-manifest.test.ts -t 'recursively registers every guard file exactly once\|keeps architecture recursively complete and out of the unit project'` | Final candidate: 2 selected cases passed; empty, duplicate and orphan controls also pass in the pure policy units |
| Path-sensitive secret-safety controls and six other affected static guards | Six reported fixture regressions repaired and passed; 11 additional negative controls passed. Exact commands and logs are in the verification report below |
| Scoped ESLint with `--max-warnings 0` over affected runner/config/test inputs, then repair-touched files | Passed; unchanged inputs reuse the earlier scoped receipt, and all repair-touched files were checked again |
| `npm run roadmap:check` | Passed after the affected path-reference regeneration |
| [Final collection receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-09-30/logs-backend-phase1/all-collection-fixture-repair.json) | 610 unique files, no retained orphan or duplicate owner; listing did not execute complex suites |

The existing runner still removes successful owned scratch and retains failed-run diagnostics
under `/tmp/hrt-<uid>/run-*`. Generated coverage, parity scratch and `test-results/` metadata
are ignored; reviewed parity references and source fixtures remain tracked. Only the unused
tracked `test-results/.last-run.json` was removed. No unknown directory contents or peer checkout
was cleaned. The fixture guards deliberately pin the exact compatibility exports and three
existing resource harness exceptions.

Independent verification passed this bounded acceptance surface; its
[decision-ready report](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-09-30/logs-backend-phase1/verification/candidate-verification-report-a46d792.md)
links the fingerprint, classification, command and raw diagnostic evidence. `npm run typecheck`
still exits 2 with 72 diagnostics: the normalized baseline/candidate diagnostic multisets match
exactly, with no candidate-only error. Full secret guards retain two baseline failures on
`identity-approve-model.ts`; fail-loud and SQLite-boundary failures also reproduce on the
immutable base. These checks are red, not waived or represented as passing; broad production
repair is outside this assignment.

Integration, scenario, browser/parity, live HR, full coverage and full-suite execution remain
unrun. No backend behavior, approved UI, Electron, release/freeze/cutover, push, merge, peer
cleanup or next-phase launch occurred. The peer-owned untracked
`docs/rebuild/plans/phase-3/backend-continuation-reconciliation.md` was left untouched.
Phase 2 may consume this accepted local candidate only after the operator launches that work;
integration and complex-test review remain separate choices.

## Prompts for fresh chats

The [startup reconciliation prerequisite](backend-continuation-reconciliation.md) is accepted locally
at `dd585d2e7815bc892474f31ebb49c4b905c50735`. It preserves the accepted Phase 1 and approved Logs
inputs, accounts for all 30 startup-only commits, and records focused evidence, baseline static
failures and explicit deferrals. Future authorized backend work consumes this combined candidate;
this record does not launch Phase 2 or admit complex/full gates.

Each prompt is self-contained about its boundary. Read this plan and the audit before executing;
load only the relevant source/reference/module instructions. If a predecessor has not been accepted,
verify and report the missing prerequisite rather than implementing the next phase. Do not launch
another phase automatically. The operator's future complex-test review stays deferred.

### Phase 1 prompt

```text
Work in /Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-logs-backend.
Use Heavy route only: read ~/.codex/codex_workflow/heavy_route.md and follow it directly.
Do not use /astra-orchestrator, /luna-worker or other worker-adapter skills.
Read docs/README.md, current instructions,
docs/handoffs/2026-09-30-logs-ui-backend.md,
docs/rebuild/plans/phase-3/backend-and-unit-tests.md and its sibling audit.
Verify branch codex/logs-backend, HEAD, status, approved UI ancestry and ownership.
The planning source base is 27fd907207ab42fc938856954ef75a136da32f74; do not reset newer work.
Execute only Phase 1: test inventory/dispositions, accurate unit/integration/architecture
ownership, a unit-only command, preserved complete collection, and artifact policy.
Inspect test bodies and transitive harnesses. Move mixed suites intact before extracting
units; do not delete a complex suite just because it is complex. Retire only exact obsolete
or demonstrably replaced behavior. Preserve scenario/parity sources for later user review.
Update collection/fixture/path guards deliberately; do not weaken assertions or floors.
Run focused unit/policy tests, lint and affected static checks. No integration/scenario/
browser/live tests, broad failure repair, backend behavior changes or Electron work.
Reuse this worktree. No push, merge, peer cleanup or next-phase launch. Commit logical
categories and update this plan's Phase 1 acceptance record with actual evidence and deferrals.
```

### Phase 2 prompt

```text
Work in /Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-logs-backend.
Use Heavy route only: read ~/.codex/codex_workflow/heavy_route.md and follow it directly.
Do not use /astra-orchestrator, /luna-worker or other worker-adapter skills.
Read current instructions, docs/README.md,
docs/rebuild/plans/phase-3/backend-and-unit-tests.md, its sibling audit and
backend-continuation-reconciliation.md. Verify checkout ownership, accepted Phase 1 and
the accepted combined reconciliation candidate; preserve unrelated changes. Do not start
Phase 2 on an unreconciled base.
Execute only Phase 2: reorganize the backend into cohesive modules and rebuild focused
unit coverage with each module. Begin with an exact source/test/support move and dependency
map. Give every retained unit and support file a clear module home; finish the flat unit
layout without broad source refactors outside this phase's backend responsibilities.
For each module, triage meaningful behaviors and existing cases before changing code:
keep, rewrite, consolidate or remove, with reasons, gaps and surviving coverage. Establish
or refine focused public-behavior and refusal checks before behavior-sensitive refactoring;
reuse adequate tests. Finish unit cleanup alongside each module, not as a separate blanket
cleanup phase. Remove only exact obsolete or redundant units with recorded dispositions;
preserve distinct boundary, refusal and safety cases. Do not delete tests because they fail.
Include browser, service and workflow stores using this plan's Store ownership section.
Keep browser-safe base/domain/workflows outside backend. Separate mechanical moves from
policy extraction, preserve authority transaction ownership and write ordering, and update
registrations, generators, fingerprints, guards, imports and nearest instruction twins.
Extract deterministic cases from mixed suites without replacing real persistence evidence
with fakes or retiring their original complex proofs. Remove verified unused unit support.
Run exact affected units, lint and affected static/generated/build checks. Record unrelated
baseline failures without weakening the checks. Complex-test execution, redesign and
retirement stay deferred for operator discussion.
Do not implement the new log contract, migrate every workflow or add Electron packaging.
Reuse this worktree. No push, merge, peer cleanup or next-phase launch. Commit logical
categories and record Phase 2 evidence, exact source/test/support mappings, unit disposition
and surviving-coverage mappings, and remaining obligations in this plan.
```

### Phase 3 prompt

```text
Work in /Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-logs-backend.
Use Heavy route only: read ~/.codex/codex_workflow/heavy_route.md and follow it directly.
Do not use /astra-orchestrator, /luna-worker or other worker-adapter skills.
Read current instructions, docs/README.md and
docs/rebuild/plans/phase-3/backend-and-unit-tests.md. Verify the accepted Phase 2 candidate.
Execute only Phase 3: the shared confirmed action/step contract and execution-context API.
Implement distinct read, fill/readback, interaction, protected submit and verification meanings.
Use exact frozen run/action/attempt/worker/system/session/step ownership and explicit timestamps.
Publish ordinary facts after verification while the task can still be running. Publish an
external write's success only after saved-effect verification and durable settlement.
Preserve detailed traces, fence-to-submit safety and UNKNOWN refusal. Logging failures must
not cause another submit. Put concise result selection in the backend with truthful unknowns.
Wire a synthetic task through the real production injection seam; do not claim live proof.
Add focused units using controlled promises and manual clocks, run lint/affected checks,
and record approved contract changes at their existing owners and decision index.
No UI redesign, live actions, broad workflow migration or complex-test execution/design.
No push, merge, peer cleanup or next-phase launch. Commit and record Phase 3 evidence here.
```

### Phase 4 prompt

```text
Work in /Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-logs-backend.
Use Heavy route only: read ~/.codex/codex_workflow/heavy_route.md and follow it directly.
Do not use /astra-orchestrator, /luna-worker or other worker-adapter skills.
Read current instructions, docs/README.md and
docs/rebuild/plans/phase-3/backend-and-unit-tests.md. Verify the accepted Phase 3 candidate.
Execute only Phase 4: persisted, ordered logical streams per worker and a resumable run-logs
subscription through current HTTP/SSE. Adapt existing JSONL and incremental readers behind
log ports; preserve redaction, archive/retention, old-record semantics and exact run ownership.
Multiplex connections. Implement snapshot/delta merge, deduplication, resume/gap reset,
bounded queues, explicit delivery health, shutdown and slow-subscriber isolation.
Avoid per-event whole-day rescans and full Logs refetches. Use focused unit work counters
and queue/protocol tests with injected ports; do not call them real I/O or latency proof.
Wire production adapters, run focused units, lint and affected wire/static/generated checks.
Complex filesystem/process/socket checks remain deferred for later operator review.
No frontend redesign, Electron IPC implementation, live HR or broad workflow migration.
No push, merge, peer cleanup or next-phase launch. Commit and record Phase 4 evidence here.
```

### Phase 5 prompt

```text
Work in /Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-logs-backend.
Use Heavy route only: read ~/.codex/codex_workflow/heavy_route.md and follow it directly.
Do not use /astra-orchestrator, /luna-worker or other worker-adapter skills.
Use /ui for frontend changes. Read current instructions,
docs/README.md, docs/handoffs/2026-09-30-logs-ui-backend.md and
docs/rebuild/plans/phase-3/backend-and-unit-tests.md. Verify accepted Phase 4 and UI ancestry.
Execute only Phase 5: connect the existing approved LogFeed to backend-served confirmed facts,
results, system labels, timestamps and explicit step-owned screenshots at step ends.
Keep design unchanged. Remove frontend business-result inference, preserve truthful legacy
states, immutable paging, live deduplication and isolation from late run/attempt responses.
Capture while the exact step page lease is owned; represent failed/absent capture explicitly.
Add focused projection/adapter/model and small wiring units; run lint/affected bundle checks.
Provide synthetic sample payloads. Browser parity, live form/capture tests and complex-test
design/execution remain deferred for the operator. Do not refreeze references to force green.
No attention-block redesign, Electron packaging, broad workflow migration or release claims.
No push, merge, peer cleanup or next-phase launch. Commit and record Phase 5 evidence here.
```
