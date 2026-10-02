# Backend, unit tests and confirmed Logs connection

Status: Phase 1, its startup reconciliation prerequisite and Phase 2 are accepted locally on
2026-10-01; the operator-approved layout polish has passed code verification and is closing locally
before Phases 3–5, which remain proposed. This descriptive
supporting plan does not assign new roadmap task numbers, reopen accepted task checkboxes, or grant
release/freeze/cutover admission. Roadmap recording and integration remain separate operator choices.

## Goal and agreed direction

Make the local backend maintainable by one developer and ready for a future macOS/Windows Electron
shell. Reorganize the backend and its unit tests together, simplify the runtime's public boundaries,
and connect the approved Logs design to structured, confirmed facts emitted by the backend.

The operator wants focused unit tests now. Complex-test design and execution will be discussed
later with the operator. An [initial test audit](backend-and-unit-tests-audit.md) inventories the
corpus, identifies mixed tiers and proposes dispositions. The operator subsequently retired the
parity and scenario suites; retained integration and performance suites remain for later discussion.
Unit tests do not prove browser behavior, persistence, sockets or crashes.

The continuation is
`/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-logs-backend`,
branch `codex/logs-backend`. The initiative started from source commit
`27fd907207ab42fc938856954ef75a136da32f74`; each phase records its own verified entry and acceptance.
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
- Keep existing integration tests available with recorded dispositions. The operator retired the
  parity and scenario suites on 2026-10-02; future scenario tests will be designed with the operator.
  Unknown primary-checkout files are outside cleanup scope.

## Backend layout and naming

The operator-approved target structure, amended on 2026-10-01, is:

```text
src/
  workflow-kit/                 browser-safe shared workflow/task authoring and compilation
  models/                       shared types, strict schemas and schema-bound validation
  rules/                        shared pure decisions; backend-only policies stay with their owner
  workflows/<workflow-id>/
    workflow.ts                 browser-safe definition entry point
    steps/<step-name>/step.ts    browser-safe step harness definition, when registered
    task-registry.ts            backend-loaded implementation registration
    tasks/<verb-object>.ts      workflow-specific implementations
  dashboard/                    renderer, state and client transport adapter
  backend/
    app/                        boot, configuration admission, dependency composition
    runtime/                    worker loop, execution, sessions, checkpoints, write sequencing
    runs/                       start, cancel, retry and run-read services
    logs/                       confirmed facts, step/result projection, stream coordination
    systems/<system>/           semantic driver, session provider and verb-object tasks
    processing/<capability>/    headless extraction, OCR, normalization and roster tasks
    storage/                    SQLite repositories, JSONL and artifact adapters
    transports/http/            HTTP routes, SSE subscriptions and transport admission
    transports/cli/             CLI transport adapters
  cli.ts                        thin command entry point
```

Create folders when they have an owner and real code. Keep the browser-safe builders outside
`backend`; the authoring library remains browser-safe in `workflow-kit`.
Shared wire shapes belong in `models`; Node/filesystem/browser implementations belong in `backend`
or the explicitly backend-loaded workflow task implementations. Validate browser safety from each
definition entry point's transitive closure, rather than treating every file in `workflows` as a
renderer entry point. Models may include schema refinements; shared business decisions belong in
rules. Do not blindly rename mixed domain modules or introduce old-path forwarding modules.
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
| Workflow: Person Lookup and Separations mini-stores | `workflows/<workflow-id>/tasks/` and sibling `task-registry.ts` | Task wrappers, provenance and named refusals for workflow-specific decisions |

Use a consistent `task-registry.ts` registration file and `tasks/<verb-object>.ts` convention in each
package. Browser packages additionally have `driver-declaration.ts`, `session-provider.ts` and
`driver/`. Boot composition owns the executable task registry. Preserve the existing factory
validation, exact shared driver object, namespace/contract IDs, strict outputs and effect rules;
moving a file does not authorize changing a task's contract or widening write authority.

Workflow definitions continue importing contracts, never concrete store implementations. Pure
decisions belong in `rules` or their actual workflow/module owner; database repositories remain in `backend/storage`. Place shared
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
    models/<module>/
    rules/<module>/
    workflow-kit/<module>/
    backend/<module>/
    dashboard/<module>/
    workflows/<module>/
    tooling/<capability>/       deterministic script, build and test-runner policies
  integration/<owner>/<module>/ real storage, process, transport or composed boundary proofs
  architecture/<owner>/        import, schema, collection and generated-product invariants
  perf/                        existing performance checks, not a current execution gate
  types/                       compile-time contract checks
  support/fixtures/            genuinely shared synthetic data
  support/helpers/             small, explicitly owned cross-tier harnesses
  support/processes/           shared child-process fixtures
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
Retained integration and performance suites stay collected in their own tiers; their redesign and
retirement remain for later operator discussion. Extracting a pure case does not authorize deleting
a retained complex proof. Parity and scenario suites are the operator-approved retirement exception.
These complex suites are not in the development phase gates below.

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

## Layout polish — Finish the approved structure before Phase 3

**Status:** code verified; final ledger correction and local commit closure pending. Authorized by
the operator on 2026-10-01. Entry candidate:
`7e237bd7c3d0a45952e38c49f6d9be75057d08ef`, branch `codex/logs-backend` in the assigned continuation
worktree. Deployment ID: `backend-layout-polish-20261001`. This is a structural continuation of
accepted Phase 2; it does not reopen that candidate or implement Phases 3–5.

**Deliverable:** apply the amended source/test layout and retire the operator-rejected UI catalog.
Use parallel packages only after a stable move map establishes disjoint file ownership. Preserve
exports, task/contract IDs, refusals, admission and external-write ordering during moves. Keep
required generated workflow code beside its owner. Do not create placeholder log APIs or an empty
Electron shell; those remain later work.

1. Produce an exact source, test and support move/retirement map. Classify schema and pure-decision
   ownership from code and dependencies. Move the authoring kit, combine workflow definitions and
   workflow-specific tasks, and name implementation registration files `task-registry.ts`.
2. Complete backend responsibility groups: app bootstrap/composition/registries, runtime
   execution/workers/checkpoints/gates/writes, run commands/queries/projections/lifecycle, HTTP/SSE
   transports and storage maintenance/configuration/compatibility. Keep actual modules cohesive.
3. Group scripts under dev/build/docs/test/verify. Move build-only infrastructure into scripts and
   reusable workflow validation into the kit. Keep root configuration limited to active application
   configuration; move migration/provenance ledgers to their documentation owner and sanitized
   selector manifests to `docs/rebuild/evidence/selectors/`, updating readers and references.
4. Retire the UI catalog navigation, URL keys, endpoint/client method, projection schemas, generator,
   selector-search command, generated JSON and per-system catalog documents. Keep actual semantic
   registries, selectors, action proofs, write classification and their distinct safety assertions.
   Retire only exact feature-only tests and references; preserve mixed-test unrelated behaviors.
5. Mirror source ownership in units and group integration files by owner. Consolidate truly shared
   support under `tests/support`, retaining suite-local fixtures with their consumers. Preserve every
   retained test's collection, assertions, coverage ownership and timeout. Complex suite redesign,
   execution and broader quality approval remain deferred; catalog and the subsequently approved
   parity/scenario retirements are the exact exceptions. Remove verified empty folders.
6. Apply the operator's continuation amendments: group architecture guards by the responsibility
   they protect, with owned helpers and violation fixtures; update recursive collection, guard
   inventory and all consumers without changing guard membership or assertions. Keep main workflow
   definitions at `<workflow-id>/workflow.ts` and registered step harnesses at
   `<workflow-id>/steps/<step-name>/step.ts`. Preserve runtime workflow IDs, role declarations,
   declared scenario IDs and the operator's manual identity-check edits.
   The shared source-path derivation remains the single authority for these locations.
7. Apply the operator's 2026-10-02 retirement of the parity and scenario suites. Do not restore their
   tests or reference images. Remove obsolete suite commands, collection and configuration wiring;
   retain useful shared synthetic support only where a remaining test needs it. Preserve runtime
   declaration and write-safety validation without presenting deleted tests as executed evidence.
   Missing rehearsal manifests must produce an explicit unavailable result before execution.
   Future scenario tests are a separate operator-led design task, not part of this phase.
   Unit harnesses may inject deterministic scenario source text for declared test identities; those
   fixtures do not provide production scenario evidence. Production Explorer source links remain
   unresolved when the real sources are absent, and edits requiring that evidence remain refused.

**Acceptance:** exact mapped disposition for every affected file/case; no unresolved import or
browser-safe definition-closure regression; unchanged critical write blocks and approved Logs UI;
focused affected units and lint, applicable source-only guards, current build/store/roadmap outputs
and production web build. Use deterministic import/AST preservation evidence for mechanical moves.
Do not run DB/process/socket/browser suites or refreeze screenshots. Record unrelated baseline
failures separately and repair every new diagnostic attributable to this change. No push, merge,
next-phase execution or production/Electron acceptance is authorized.

Evidence owner:
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/backend-layout-polish/`.
The existing empty-folder receipt remains historical; new implementation/verification receipts get
their own subfolders. The root owns this phase's progress and acceptance record; closure documentation
uses the existing docs/evidence framework instead of creating absent `agent_docs` files.

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
| 2 — Backend modules and reviewed units | Accepted locally | Code candidate `2a1bad93b14b9b17bbccb7e69dc7974dfcf0e3f7`; exact mappings, focused checks and independent combined-candidate preservation verification below |
| Layout polish — Approved final source/test homes | Code verified; local closure pending | Frozen code SHA-256 `a65ca56206aa238124e379b44f1ecb941fe17660abdffeaa24be2a6a50ab421f`; entry `7e237bd7` |
| 3 — Confirmed action/step API | Proposed | Requires Phase 2 and layout polish |
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

### Phase 2 execution — 2026-10-01

Deployment ID: `logs-backend-phase2-20261001`. The operator authorized only Phase 2 in the
existing `codex/logs-backend` worktree. Entry was clean at
`4b2f3232f8e41b849084c7b745a09ac61070b55f`. Independent source and test ownership reads verified
that accepted Phase 1 `a46d792273af908dd9bfd29d6f5eb19b874a319e`, reconciliation
`dd585d2e7815bc892474f31ebb49c4b905c50735`, and approved Logs UI
`1211a24b81547ec2b7c6e27837c4d57c081d259e` remain ancestors. The two commits after the
reconciliation candidate change only its two plan records.

The accepted pre-mutation [layout map](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/layout/report.md)
and its [refinement](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/layout/refinement.md)
account for 982 source files, 248 units and 47 support files with baseline byte hashes and no
target collisions. Exact ledgers are
[source](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/layout/source-map.json),
[unit](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/layout/unit-map.json),
[support](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/layout/support-map.json), and
[static dependency edges](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/layout/dependency-edges.json).
These are intended destinations, not completed moves or quality verdicts. Each package records
actual deviations, case triage and surviving coverage separately. The Node config resolver moves
with its path defaults after the shared leaf-path rule is extracted to domain provenance;
settings journal/runtime readers remain runtime-owned. Storage relocation history keeps its
existing transaction ownership at storage. All 40 former core modules retain their 80% floor.

Module case triage, focused checks, logical commits and final preservation evidence will be
recorded here as completed. Evidence is retained under
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/`.
Complex-suite execution, redesign and retirement remain deferred; this execution does not
authorize integration, push, worktree cleanup or a later phase.

Operator cadence amendment on 2026-10-01: batch each remaining related relocation set as one
major package. Keep focused units, import/static checks and lint during the package, then run
expensive combined typecheck/build once at package completion. Reuse fresh evidence and rerun it
only when a failure or later repair changes its inputs.

The [immutable baseline report](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/baseline/report.md)
records an explicit 248-file unit run: 234 files and 2,379 cases pass; 14 files and 59 cases fail.
The exact failed titles and outputs remain retained. Scoped lint over 276 test/support paths
passes with zero warnings. Selected driver/layout/registry/data-ownership architecture checks
have 48 passing cases and two existing registry failures: the finalization manifest names a
workflow with no built descriptor. Manifest and store catalog freshness pass. The nonexecuting
complete collection lists 622 unique files (248 unit, 271 integration, 86 architecture,
17 scenario). These failures remain red; later package checks compare attributable deltas.

Prerequisite policy extraction: `ce0ca0d75` moves the unchanged leaf traversal from the Node
resolver to domain provenance and repoints snapshot consumers. The new unit covers nested
objects, arrays/null leaves, object order, frozen output and empty/scalar roots. No existing
unit is retired. [Exact unit and lint receipts](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/app-transports/config-extraction-checks/receipt.json)
record two files/seven cases and zero-warning scoped lint passing before mechanical moves.

The [runtime case triage](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/runtime-triage/runtime-triage.md)
pins original cases and called harnesses to entry source. Existing checkpoint, terminal,
action-binding and negative-settlement units survive. Selected narrow extraction candidates
are worker idle disposition, transient retry eligibility and durable intent classification;
their repository, lease, fence, cancellation and settlement effects stay in the runtime.
All original mixed-suite persistence/reopen/order proofs remain collected and unrun.
No runtime case retirement is justified by this triage.

App/transports verification exposed a stale stopped-command guard after its incorrect repository
root was repaired: secure bootstrap reaches the supported converter through the existing
`storage relocate` branch. D352 requires this stopped, verified-backup v56 upgrade. The correction
must authenticate that exact dynamic dispatch boundary and reject eager/widened imports; it does
not exempt ordinary runtime roots. No guard is retired.

Verification scope deviation: the affected `authority-upgrade-adapters-retired` architecture
file was initially executed whole, including its SQLite-backed recovery cases. Their exact
executions and receipts remain retained. Further runs select only static path/negative-control
cases. This record does not claim that every complex proof remained unexecuted or grant broader
complex-test admission.

The [runs preparation](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/runs/prep-triage.md)
and [exact proposed map](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/runs/prep-map.json)
cover 98 source files and 24 units. Eight policy-only unit files follow their domain owners;
all existing cases survive. The queued-run service target is `backend/runs/enqueue.ts`.
Before those mechanical moves, parameter-only workflow audits move to validation, the pending
implementation binding schema moves to domain, and the receipt service constructs its failure
query directly. Actual registry reading and composition stay in app. The sealed placement and
mechanical commit receipts below supersede these proposed destinations where ownership changed.

The [store triage](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/store-triage/report.md)
accounts for nine browser stores, four processing stores and two workflow task stores. Existing
browser/domain policy cases survive; processing, Kuali and Separations wrapper gaps require
focused injected-port outcome/refusal checks. The exact unused `fake-kuali-page.ts` support
candidate may be removed only after a final consumer check. The three self-contained
registration/session/provider-declaration cases in `task-store-seams.test.ts` are authorized
for extraction to app units; all resource/fault/recovery cases stay at their complex tier.

Processing preparation corrects ownership by actual behavior: the intake, OCR admission/stack,
normalization and roster policy units follow their existing domain modules. The Vite ownership
probe follows app host resources, and the OCR command adapter follows CLI transports. The
spreadsheet intake adapter follows processing; its unchanged synchronous parser port moves from
the command kernel to browser-safe base so processing does not import runtime. That interface
placement precedes mechanical moves and does not move or alter the kernel's transaction.

The [public-unit ownership audit](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/public-units/report.md)
records 173 unit bodies, 38 module groups and 31 body-based destination corrections. Its
[effective map with the timecard split](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/public-units/effective-unit-map-with-split.json)
resolves the 248 original unit files to 249 named targets, including 130 dashboard targets.
The [case-level timecard proposal](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/public-units/timecard-split-proposal.json)
preserves 25 domain period cases and eight asynchronous driver cases with their actual owners.
These public moves remain pending. The missed app readiness unit has moved with its three
unchanged cases; its exact unit, zero-warning lint, collection and path checks pass. The
[independent delta recheck](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/phase2/app-verification/readiness-move-recheck.json)
confirms all 424 refreshed package paths and unchanged case bodies.

The [independent app verification](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/phase2/app-verification/verification-report.md)
confirms source/test move hashes, original test membership and assertions, instruction twins,
unchanged renderer source, effective runtime-composition coverage ownership and fresh D352
negative controls. Immutable-baseline and fresh candidate typecheck outputs are byte-identical
(72 diagnostics); the earlier differing candidate typecheck receipt is stale. The four red
static selectors are reproduced at baseline: open `Record` boundary, missing legacy evidence,
missing finalization descriptor and wire-connectivity import-time configuration access.
The existing storage relocation layer inversion remains a later storage-package obligation.
These checks remain red, rather than being waived or described as passing.

App/transports is committed as `13a20166398ed396062582a472705f17e40b6669`: 87 source and
14 unit moves, 1,048 import specifiers across 281 importer files, and 45 literal-path files.
Exact moves, unit dispositions and the accepted path hashes remain in
[the package evidence](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/app-transports/).
The affected unit receipt records 269 passing cases and one unchanged descriptor-equivalence
failure; the subsequent readiness move has a separate three-case passing receipt. Scoped lint,
manifest/catalog freshness, production bundle and roadmap freshness pass. The final guard
controls preserve the exact D352 stopped-command boundary and classify backend responsibilities,
including refusal of unknown backend owners and type-only layer inversions. No test or guard is
retired. The separate Runs placement and mechanical categories below preserve this committed base.

Runs policy placement is committed as `aaf977ffa5d1093296a63e66ac267520012c7b97`.
The [13-path candidate receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/runs/policy-placement-candidate.json)
records unchanged parameter-only audit bodies, the unchanged strict pending-binding schema,
direct lower consumers and direct receipt-query construction. The app tuple, filesystem reader,
query/command composer and transaction code remain with their existing owners. Existing focused
checks passed before extraction; the new schema unit passed before placement and covers valid
facts, unknown fields, blank provenance and malformed identifiers. Candidate units pass four
files/35 cases; six selected static cases, scoped zero-warning lint, manifest freshness and the
61-file browser-safe audit closure pass. Base and validation now share domain's tier zero;
fresh controls reject base value imports and validation type-only imports into higher backend
layers. Real-tree layering still reports only the known storage inversion. Fresh typecheck
remains byte-identical to the 72-diagnostic baseline. The subsequent mechanical Runs and runtime
receipts below record the completed follow-on categories.

The mechanical Runs candidate exposed a shared capture adapter: both run capture and historical
archive conversion use the same terminal snapshot/report projection. Its whole unchanged body
belongs at `backend/storage/archive/report-capture.ts`, where both owners can import downward.
No unit directly imports that adapter; the two affected archive query/projection units keep
their Runs homes. The conversion still owns save, verify, transfer, publish and
read ordering. No layer exemption is authorized. Three transitional edges from Runs to the old
intake parser and settings runtime remain pending until those processing/runtime modules move.
An intermediate mechanical commit does not accept these introduced diagnostics; fresh static
checks must close them before Phase 2 acceptance. The existing restore-plan inversion remains a
storage obligation.

Runs mechanics is committed as `07ce2ec6e6008468e521f7694068cae277780efc`, with final acceptance
still pending the dependency repairs above. The [sealed mechanical report](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/runs/mechanical-report.md)
links 98 source moves (97 Runs and one shared Storage adapter), 26 whole unit moves, one fixture,
and the exact 568-path candidate hashes. All 26 unit bodies remain unchanged; 97 source bodies
remain unchanged after import normalization, and the Explorer root-depth constant is adjusted
for its new location. Focused units have 275 passing cases and one identical baseline failure.
Scoped lint, manifest/catalog freshness, web build and diff checks pass. Typecheck retains the
same 72 diagnostic headers. Fresh layering records the three pending moves and the original
restore inversion. The unchanged `control-command-single-path` false positive was reproduced
at the preceding committed HEAD and remains recorded rather than weakened. No additional
complex suite was executed.

The parser port is committed as `180f9997f2d8109b5f0b94af2b2c028d9e5495ab`.
The [five-path receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/intake-port/report.md)
proves unchanged interface text and import-only changes to the kernel and three direct type
consumers. Scoped lint, focused browser-safe/layer refusal selectors and manifest freshness pass.
No behavior test was added for this type-only placement. Typecheck retains the same 72 diagnostic
headers, and layering retains the same four pending edges. Runtime mechanics is now released.
Its body audit places the pure step-omission and write-safety units with domain; provider-pool
belongs with processing, system-login-recipes and its fake-login-page support with systems, and
the vendored Duo unit with its own public module. All existing cases remain retained.

Runtime's real dependency audit further corrects four reusable browser adapters from runtime
to `backend/systems/browser-shared`: action notes, authenticated-application observations,
the login contract and UCSD SSO. System drivers already consume these lower adapters; placing
them at runtime would introduce lower-to-higher imports. Their bodies remain whole and unchanged,
and the direct action-note unit follows the shared browser owner. The runtime session factory
and declared-action binder retain runtime ownership. The whole run-resource factory follows
`backend/app/worker/run-resources.ts`, because it composes authority, providers, session resources,
environment and preflight. This corrects composition ownership without extracting the
app-owned preflight return type or widening layer rules. Final maps and fresh checks remain
required before accepting the mechanical runtime candidate.

Runtime mechanics is committed as `5ce5072dc0f6e2b8fe3be37d645c2c884fea043f`.
The [sealed runtime report](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/runtime/mechanical-report.md)
records 28 source and four whole-unit moves, exact 207-path hashes, and AST-equivalent bodies
for all 32 moved files. Nine affected unit files pass 108 cases; scoped lint, manifest/catalog,
web build and diff checks pass. Fifteen runtime safety floors follow their new paths, and the
negative coverage control checks all 31 already-moved former-core modules. Typecheck retains
the same 72 diagnostic headers. The settings dependency edges are closed; only the assigned
Processing intake and Storage restore edges remain. Driver-lease, bounded-deadline and command
static findings are proven against original entry conditions and remain red with their assertions
intact. Selected deterministic runtime decision coverage and extraction is released separately;
runtime final acceptance still requires the remaining moves and fresh phase-owned checks.

Runtime policy extraction is committed separately as `7d9cd1e490db8e9d15b7175946e19899a1bde90d`.
The [policy report](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/runtime-policy/candidate-report.md)
records tests established before caller changes, exact 11-path hashes, nine new deterministic
decision cases and the existing terminal factory's added positive identity case. Initial affected
units passed four files/14 cases; the subsequent durable identity refinement passes its five-case
file, so the combined count was not rerun after that assertion-only addition. The refinement
proves complete record metadata and reference identity survive every returning decision. Idle
wait effects, retry session/span/terminal effects, durable lookup, original refusal messages and
probe/fence/submit/verify/settlement stay in the callers. Byte evidence preserves the sequencer's
live-probe-through-EOF tail, executor post-retry tail and bounded-wait function. Extracted files
keep 80% floors. Scoped lint, affected static controls, manifest/catalog and web build pass;
typecheck remains at the same 72 normalized diagnostics, and the two selected entry guard
failures remain red. No resource-backed proof was executed. Systems focused gap tests are now
released; their subsequent mechanical moves require a separate category and fresh checks.

Person Lookup's mixed unit is split only at whole-case boundaries. The original UCPath/CRM
task/checkpoint case and active-status/provenance/refusal case stay intact under app task-binding
composition. Registry inventory follows app registration, the CRM subject/output mismatch follows
CRM, and the unresolved/inactive and absent-CRM-EID cases follow the workflow wrapper. This
preserves the distinct composition proofs rather than replacing them with isolated assertion
slices. New focused wrapper checks cover missing success facts and named refusals; none replace
the six original cases or real persistence evidence.

The external Systems preparation now accounts for 11 existing unit files and 117 direct case
bodies, including 32 login-recipe cases and the whole-case Person Lookup split. Source hashes
for all 86 proposed moves match the committed preparation base. These are preparation and
preservation inventories, not executed test results. The Processing ledger's 155 entries are
TypeScript AST counts of direct literal-title `it(...)` declarations with callback bodies across
eight files; each has a body hash and retained disposition. The corrected app commit reference
is `13a20166398ed396062582a472705f17e40b6669`. Module mutation and gate acceptance remain pending
their sequential release and fresh combined-candidate checks.

Storage preparation projects ten layer inversions from five over-broad adapter assignments.
Actual ownership resolves them without exemptions: the three archive command/runtime-version
services follow `backend/runs/archive`, and stopped span-root reconstruction follows
`backend/runs/recovery/span-root-repair.ts`. The stopped relocation operation follows
`backend/app/storage/relocate.ts` because it binds host configuration, settings and exclusive
application admission. These files remain whole to preserve transaction and activation order;
native/SQLite relocation adapters, historical archive transfer and the complete relocation-plan
reader/projector remain storage-owned. The external map must be refreshed and reprojected before
release. The prepared pure relocation-history unit may add deterministic sequence/digest/audit
refusal coverage; its real SQLite integration proof remains unchanged and unexecuted. No storage
case or support retirement is justified by preparation.

The refreshed [Storage preparation](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/storage/README.md)
uses committed `7d9cd1e` and projects zero layer inversions after those five whole-owner
corrections. Its 84-source inventory includes 79 Storage owners and the five Runs/Application
services, with exact direct consumer/import obligations. All 468 recorded case-title groups and
five support mappings remain retained; these are static inventories, not runner results. The
path ledger preserves D352's exact lazy bootstrap dispatch and stopped verified-backup v56
admission. Storage mutation remains unreleased until the preceding packages complete.

Storage's additive projection coverage is committed as
`8810f0b7ccc9a2c148bdaae342c127a118d73562` before its source moves. The
[receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/storage/projection-unit/receipt.md)
records one file/four passing cases and zero-warning lint. The unit covers empty and exact
plan/cancel history, revision gaps, independent request-fingerprint and destination-digest drift,
and audit revision mismatch through narrow history ports. It proves pure projection only; the
existing real SQLite history, verified-backup and recovery proofs remain unchanged and unrun.
The follow-up fixture typing repair is committed as
`ee9474e213c105ef08909e348c394c6809909dcf`: revisions and fingerprints use their production
schemas, with no casts or case/oracle changes. The four cases and scoped lint pass. Combined
compiler confirmation remains with Systems.
The remaining widened command-union fixture is repaired in
`2916c1f8eff55b57adf111e0cbf5edc4402c6fe4` by parsing the changed request before repository
injection. The same four cases and lint pass; no cast or production edit is introduced. Systems
must still produce the current combined compiler comparison.

Systems mechanics is committed as `40cac461b56994188fa90577a7e13e3b19e96293`.
The [sealed manifest](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/systems/systems-candidate-sealed.json)
records 86 source moves, 272 exact changed paths, 117 moved direct case bodies and their surviving
homes. All 33 timecard cases split at whole-case ownership boundaries, the three pure registration
cases move to app, eight resource/fault/recovery cases remain in the unchanged integration suite,
and all six Person Lookup cases survive whole at app, CRM or workflow-task owners. The 32-case
login suite and its fixture follow browser-shared. The removed fake Kuali page has no remaining
consumer; the semantic fake and complex proofs remain.

Affected Systems units report 237 passes and two unchanged dashboard global-key failures. The
six Kuali wrappers retain 19 passing focused cases. Scoped lint passes 152 paths; catalog and build
manifest checks, 118-entry UI catalog generation and the web build pass, with the existing Vite
large-chunk warning. Selected static checks report 15 passes and the known guard-manifest ratchet
failure for two recorded control-layer inversions. Current typecheck has exactly the same 72
normalized diagnostic headers in the same order as entry, with zero additions/removals. Twelve
parity reference groups (36 files) remain byte-identical and unexecuted; their stale store labels
are recorded for later whole-triple reconciliation. No complex integration or parity suite ran.

The [remaining module preparation](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/remaining-modules/report.md)
assigns 17 residual source paths, 176 public/corrected units and 46 mapped live support paths to
explicit module owners. Logs retains current facts/emission/diagnostics only; pure wire/event
and schema validation modules remain browser-safe in domain. Trust units retain their mixed
structural/refusal proofs, receipt composition and its immutable JSON fixture follow Runs evidence,
and vendored Duo coverage follows tooling. The residual preflight report service needs a narrow
consumer-owned domain-type port before its runtime move. The existing server instruction pair
and ledger move only after its last source module, with current root/module pointers updated and
all existing twins kept byte-identical. These maps are preparation, not completed moves; final
renderer preservation must account for import-only changes rather than reuse older byte hashes.

The [independent Runs/runtime review](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/runtime-independent/report.md)
is pinned to `7d9cd1e`. It verifies category commit hashes, moved source/test bodies, complete
durable-record identity, original refusal text, idle clock/cadence evaluation, retry and
probe/fence/submit/verify/settle boundaries, 31 moved former-core floors plus the three new policy
floors, and instruction twins. It finds no new behavior or preservation defect within that scope.
This is bounded intermediate acceptance, not final Phase 2 acceptance: the unchanged unit failure,
72 typecheck diagnostics, recorded static failures and two pending dependency moves stay open.
The newer Kuali category and subsequent Systems candidate are outside that review's freshness.

The two-file preflight prerequisite is committed as `200c987833c33d91b88232a21ada9f4d27728c1c`.
Its [receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/preflight-port/report.md)
defines a consumer-owned port from existing domain types and updates only the unit fixture's type.
The public history/refusal case passes before and after, and exact two-file lint passes. Source
branches, timing, replay behavior and assertions remain unchanged. The application composition
is structurally compatible; full compiler validation remains with the affected combined candidate.
Disjoint ownership excluded Systems paths from this commit and preserved all peer edits.

Kuali's focused coverage is committed before Systems moves as
`ef6863f695d941cadf50e5d6e9fd166492ee65a5`.
The [test-only receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/systems/kuali-wrapper-test-receipt.json)
records 19 passing cases across all six wrappers and zero-warning scoped lint. Independent expected
facts, named refusals, exact semantic arguments, no extra operations, unchanged save-capability
identity, and distinct absent/unknown read-back outcomes are checked. No Kuali production source
changed and no durable-write evidence is claimed by injected semantic ports. Existing finalization
field policy coverage is reused. The separate Systems mechanical category is now released;
processing, workflow tasks, storage and final module moves remain pending their sequential gates.

Processing and workflow gap-test categories are released on disjoint new unit paths while
Systems owns source moves. They may run only their exact units and scoped lint; source, old-case,
support, generator and guard edits remain locked until their sequential mechanical releases.
Peer paths stay outside each candidate, and unfinished peer compiler findings cannot be waived
as entry baseline. The Person Lookup draft's proposed value-free mismatch message was an incorrect
new assumption: the current local-record redaction owner deliberately displays supplied
identifiers. That unexecuted constraint is withdrawn on contract evidence, with no production
redaction change or existing case deletion. The new named-refusal/no-output case and original
composed mismatch explanation survive.

Workflow wrapper coverage is committed before its mechanical moves as
`9c3f51133c0e3cfaa3be7f3c6c462ae46d43a80a`. The two new units cover eight Separations
wrapper outcomes/refusals and one Person Lookup named refusal. Independent expected fields,
the sealed packet and its fixed digest, refusal count and absent output are asserted against
unchanged production sources. The exact two-file receipt records nine passing cases and
zero-warning lint. Existing mixed composition and domain cases remain retained. The initial
fixture expectation for a job title was corrected to the supplied `STDT 2` value; production
behavior was not changed to satisfy the test. Systems and Processing peer edits remain outside
this category; workflow mechanical mutation is still gated on Processing's committed moves.

Processing focused coverage is committed separately as
`ee65304f53a8b8690155fdedbee701e9a068a55e` before its source moves. The
[six-file receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/processing/six-unit-test-receipt.json)
records 27 passing cases and exact scoped zero-warning lint at the preceding committed HEAD.
Spreadsheet byte signatures, typed cells, named selection and shape refusals; intake cache,
synchronous re-derivation and eight-grid retention; extraction/OCR outputs and refusals;
normalization advice; and roster match/refusal facts are checked. PDF rendering observes actual
PNG bytes through an in-memory artifact port and makes no persistence claim. Initial CSV fixture
shape and expected unknown-sheet message errors were corrected in tests, then both checks were
rerun successfully. No production source or existing case changed. Systems owns the current
mechanical category; Processing's production and old-unit moves remain locked until it commits.

Systems' combined compiler check exposed 47 new diagnostics in those additive test categories
(43 Processing and four workflow), in addition to the 72 entry diagnostics. Their focused unit
and lint passes do not establish compiler acceptance. The owners must repair the test typing
without weakening cases or changing production behavior, and Systems must rerun the combined
compiler before sealing. These findings are candidate failures, not unrelated baseline failures.

Workflow's test-only typing repair is committed as
`ea85f764a7e97724ce2b8253e6de7fa2a080f9c1`: copy the readonly options at two mutable input
boundaries and parse the existing timestamp through `IsoInstantSchema`. All nine cases and their
assertions survive. The [repair receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/workflow-tasks/type-repair-receipt.md)
retains fresh exact two-file unit/lint logs; combined compiler confirmation remains pending.
The [earlier category receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/workflow-tasks/test-check-receipt-9c3f511.md)
records its original executed commands from retained output, without claiming a new rerun.

Processing's test-only typing repair is committed as
`a585142212f26017227cb9ce9919733882ba315e`. Five files change; the grid unit remains byte-identical.
Contract-derived output types and explicit result discriminants replace ambiguous optional
properties; equivalent fail-fast outcome checks preserve the former membership assertions.
Schema validation strengthens injected observations, the partial OCR fixture omits its answer
without an unsafe cast, and XLSX fixture cells use the library's accepted null shape. All 27 cases
and outcome/refusal/effect oracles survive. The refreshed six-file receipt records 27 passing
cases and zero-warning lint. Systems owns the combined post-commit compiler confirmation.

The combined recheck at `a58514221` retains all 72 identical entry diagnostic headers and finds
five remaining Processing test errors, with no Systems or workflow additions. The test helper
output annotations still disagree with implementation-return branding. These five findings
remain candidate failures; the Processing owner must repair lawful boundary typing/validation
before another combined compiler check. No floor, assertion or compiler rule is relaxed.

The second Processing typing repair is committed as
`2800b708ecac9e06163693d0f00bdef3910ffb0d`. Four task units now parse successful implementation
results through their production output schemas, establishing the published branded identities
without casts. All 27 cases and their prior outcome/refusal/effect oracles pass; scoped six-file
lint passes. Systems must still confirm that the combined compiler returns exactly the 72 entry
diagnostics before its mechanical category can seal.

Processing mechanics is committed as `f3646d882d0d80551e524f6fa128864108928cc7`.
The [candidate report](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/processing/candidate-report.md)
and [manifest](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/processing/candidate-manifest.json)
record 19 source moves, nine existing unit moves and 108 exact candidate paths. All 159 mapped
existing static callback bodies retain their hashes. Fifteen focused unit files pass 186 cases,
including the 27 additive Processing cases. Scoped lint passes 72 paths; diff check, generated
manifest and store catalog checks pass. Typecheck retains the same 72 normalized entry headers,
with zero additions/removals.

The selected architecture run passes 79 cases and retains the existing infra/SQLite relocation-plan
layer inversion; the prior Runs-to-intake edge is closed. The legacy capability disposition file
retains three failures for stale evidence paths outside this package. Both remain red and recorded;
no assertion or guard is weakened. No complex, scenario, parity or live suite ran.

Workflow-task mechanics is committed as `40ec7fa6d5e504d3d72253af5ce15d8b521e4c68`.
The [candidate report](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/workflow-tasks/candidate-report.md)
and [manifest](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/workflow-tasks/candidate-manifest.json)
record 12 source moves and five unit moves with 59 exact changed paths. The two whole Person
Lookup cases from the mixed original survive at their workflow owner. Source/import-normalized
preservation matches 12 moved sources and 14 unit/scenario files; all 140 recorded callback bodies
match, and 61 mapped whole-case targets resolve.

Ten focused unit files pass 95 cases. Scoped lint, manifest/catalog checks and web build pass.
The final typecheck retains the same 72 normalized diagnostic headers with zero additions/removals;
the selected architecture run retains only the existing infra/SQLite relocation-plan inversion.
Live authoring, task-contract, store-reference and docs-index paths now point at
`backend/workflow-tasks` and `backend/app/task-registry`; superseded history remains unchanged.
An exploratory task-contract selection exposed its unchanged above-worktree root calculation and
is recorded separately, without changing the final affected gate. No complex suite ran.

Storage mechanics is committed as `082b20b917185916bee891b7892f1b176b75bcc9`.
The [validation receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/storage/mechanics/validation-receipt.json)
and [sealed manifest](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/storage/mechanics/sealed-manifest.json)
record 84 source moves, five support moves, one existing unit move and 489 exact dirty paths before
Git recognized them as 401 changed files. Seventy-nine sources retain Storage ownership; the three
archive services, span-root repair and stopped relocation operation follow their accepted Runs,
Runs recovery and Application owners. Root reconciliation matched all 489 manifest paths and
working-tree hashes exactly before the commit.

All 468 mapped existing test-title groups survive and the four additive relocation-history cases
remain. Four focused units pass 46 cases; scoped lint passes 397 files with zero warnings. The
focused Storage guards pass seven cases, test-data ownership passes eight cases, layer and catch
scans cover 947 files with zero findings, unit collection lists 2,516 titles, and build-manifest
generation/check plus store-catalog check pass. Typecheck retains 72 diagnostics with no additions
or removals after normalizing the authority-database diagnostic to its new path. The former
restore-plan layer inversion is closed, and all five re-owned former-core modules retain the 80%
floor.

The aggregate guard remains red on the untouched dashboard log-feed image-loading finding; the
SQLite public-surface scanner retains the existing `classifyRelocationActivation` construction;
legacy-capability closure retains 12 stale external evidence paths. Broad all-project collection
stops before execution when an unrelated registry mock resolves `TEST_DATA_CONFIG_PATH` as
undefined. Actual coverage, web build and real SQLite/history/backup/recovery proofs were not run;
the affected backend/static/generated checks above provide this package's assigned evidence.

The final residual layout is committed as `cf71514fc65bbb8b5ea94ca2abfe19de791b2b8f`.
The [candidate report](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/remaining-modules/candidate-report.md)
and [exact manifest](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/remaining-modules/candidate-manifest.json)
record 17 source moves, all 176 mapped public/corrected unit homes and all 45 surviving mapped
supports. One hundred seventy-five mapped units move in this package; the mapped timecard-period
unit was already at its target, and the later separation-timecard unit follows it to the Kronos
domain home with all 22 cases. Of 46 prepared support rows, 39 move here, five were already at
their targets, the fake login page had already moved with Systems and the proven-unused fake Kuali
page had already been removed. Root reconciliation matched all 683 manifest paths and hashes before
Git recorded 448 changed files.

All 1,461 mapped literal case titles and 5,158 assertion calls survive, all 130 translated source
dependency edges match, and 3,863 relative imports resolve. The flat unit root and `src/server/`
are gone. The server instruction pair and ledger now live under `src/backend/`; both root and
backend instruction twins are byte-identical. Seven current fact/emission/diagnostic sources live
under Logs, pure event and validation sources remain browser-safe under domain, and the residual
preflight report service consumes its committed runtime port. No new Logs API or source policy was
implemented.

The full unit run reports 254 passing files and 2,457 passing cases plus the same 14 files and 59
baseline-red cases; no failure was deleted or assertion weakened. Full/scoped lint, layer checks,
affected guards, manifest generation/check, store catalog check, web build and `git diff --check`
pass. Typecheck retains 72 diagnostics with no missing-module or missing-symbol diagnostic. The
approved domain move required exact strict-boundary classifications for seven in-process types,
four named Zod-introspection implementations and proof-shape's schema-walk record. A new unlisted
validation-file control still refuses interfaces/types, assertions, open records, `any`, open
schemas and parse fallback. The focused strict suite retains only the pre-existing workflow-graph
open-Record finding.

Full architecture remains red with existing source/evidence/fingerprint findings and an unrelated
registry mock whose `TEST_DATA_CONFIG_PATH` resolves undefined. Integration, scenario, parity,
live, full coverage and real persistence proofs remain unexecuted as assigned.

Systems also identified old store owner/implementation labels in reviewed parity accessibility
references. Those triples stay unchanged: `ref frontend-backend-integration` §7 requires pixel,
semantic and provenance refresh together, while this initiative defers parity execution. Exact
stale path mappings belong in the Systems obligation ledger for later operator-reviewed parity
reconciliation; no manual accessibility-only refresh or fresh parity pass is claimed.

#### Phase 2 acceptance — 2026-10-01

Accepted code candidate: `2a1bad93b14b9b17bbccb7e69dc7974dfcf0e3f7`, branch
`codex/logs-backend`, in the assigned continuation worktree. The final repair commit removes only
one trailing blank EOF line from three files; the [repair receipt](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/remaining-modules/whitespace-repair-receipt.json)
and fresh base-to-candidate `git diff --check` pass. Accepted Phase 1, reconciliation and approved
Logs UI commits remain ancestors.

The [independent acceptance report](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/final-verification/verification-report.md)
and [machine-readable summary](/Users/julianhein/Projects/hr-automation-rebuild-evidence/2026-10-01/logs-backend-phase2/final-verification/verification-summary.json)
bind the verdict to that SHA. All 2,438 expanded entry unit cases collect exactly once; 78 focused
additions are accounted. All 2,246 original literal registrations and ordered assertion expressions
survive. The final unit tree has 268 physical and 268 uniquely collected files with no direct flat
unit file. The full-unit receipt retains the exact entry failure set: 254 files and 2,457 cases pass;
14 files and 59 titles fail. No failing test was removed or weakened.

The combined source-owner maps resolve 996 paths. A 1,886-file import audit finds 13,040 relative
edges and zero unresolved imports. All 40 former-core 80% floors and three extracted runtime-policy
floors remain. Nine instruction pairs are byte-identical; `src/server` is absent. Renderer code AST
matches entry after import-specifier normalization. Five transaction/write-critical blocks,
effect-anchor order and the live-probe-through-EOF tail remain unchanged. Manifest/catalog checks,
lint, the backend layer guard, affected static checks and the web build have passing current package
receipts. Typecheck retains the same 72 baseline diagnostics and no missing-module or missing-symbol
diagnostic.

The sole support retirement is the exact unreferenced fake Kuali page; all other 46 original
supports are mapped and present. Existing persistence, recovery, process, browser, scenario and
parity proofs remain retained. Four earlier guard runs accidentally executed the SQLite-backed
schema 0/46/49 recovery cases in `authority-upgrade-adapters-retired.test.ts`. This is a disclosed
process deviation: later selections excluded them, no further complex proof ran, and it does not
change the independently verified code/layout/preservation result.

Known reds remain red: the 14-file/59-title unit baseline, 72 typecheck diagnostics, the existing
workflow-graph open-`Record` strict-boundary finding, stale evidence/fingerprint architecture
findings and the unrelated registry mock collection failure. No check was weakened to accept them.
Complex-suite redesign, retirement and execution review; real persistence/process/browser/parity
acceptance; full coverage; push, merge, worktree cleanup and Phases 3–5 remain deferred to explicit
operator direction. This acceptance launches none of them.

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

Historical launch prompt for the accepted phase; its entry paths describe that phase's original inputs.

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

Historical launch prompt for the accepted phase. The layout-polish amendment above now owns the
final source and test homes; do not rerun this prompt to undo that structure.

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
docs/rebuild/plans/phase-3/backend-and-unit-tests.md. Verify accepted Phase 2 and the subsequent
layout-polish candidate. Use the current workflow-kit/models/rules/workflows/backend homes.
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
