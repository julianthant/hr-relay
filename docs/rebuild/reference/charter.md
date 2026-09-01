# Rebuild Program Charter — the standalone rebuild repo

Started 2026-07-17. Reset 2026-07-21 after external review. Expanded 2026-07-22 after the
whole-plan/legacy-code review. **Amended 2026-07-31 to carry the operator's isolated-coexistence,
single-cutover, and testing ratifications (Round 10), and again on 2026-07-31 for D93 (Round 11):
the rebuild leaves `temp_src/` for its own repository, `hr-automation-rebuild`.**

**Status at HEAD (2026-08-21): Phases 0, 1 and 2 are COMPLETE and Phase 3 — the per-workflow
migration loop — is active.** The runtime says so itself: `COMPLETED_THROUGH = "2j"` /
`ACTIVE_ITEM = "3-workflow-migration"` (`src/core/runtime-composition.ts:142-143`). This document is
the VISION and is deliberately NOT rewritten as work lands, so its items keep their 2026-07 voice;
what is BUILT of each one is recorded in the phase docs (`docs/rebuild/00`–`05`) and summarised in
the `<!-- roadmap-status: … -->` blocks below.

This is the single source of truth for the rebuild's vision and constraints. Every design doc in
`docs/rebuild/` must conform to it. The operator reviews each accepted part in plain language before
it becomes binding.

**Standing rule — a decision is not ratified until it lands in its owning doc.** Operator answers
recorded only in a review file or decision sheet are *proposals*. The commit that records an
answer must also fold it into the owning doc (D1 matrix, `reference/decisions.md`) and add one
changelog line to ref decisions. Review files and ref decisions are decision *history*; the owning doc is the
only readable current truth. (Added 2026-07-26 after the 07-23/24 ratifications sat four days in
`docs/rebuild/history/design-inputs/2026-07-22-second-look.md` while ref charter, the master plan and ref write-safety still
specified the world they replaced.)

## Why we're rebuilding (evidence from the 2026-07-17 structural survey)

- **~10 parallel hand-maintained workflow registries** (`WORKFLOW_LOADERS`, dashboard run-surface
  lists, `INPUT_RUN_REGISTRY`/`RUN_MODAL_REGISTRY`, `INSTANCE_LABELS`, e2e stub map, icons, …).
  Adding/renaming a workflow means ~10 synchronized edits; only two lists have coverage guards; a
  typo compiles fine and fails at runtime.
- **Bundle-boundary fault line**: `defineWorkflow` never ships to the browser (workflows import
  Playwright code), so display metadata is re-declared client-side by hand — step-label string
  switches in `dashboard/components/shared/types.ts:406`, `workflow-icons.ts`, `INSTANCE_LABELS`.
  Rename a step and the UI silently renders stale text.
- **OCR approve contract divergence**: three shapes (`approveTo` per-record, `approveDocumentTo`
  per-document, `completeDelegatedRun` no-approval) branch inside one route, and
  `onbase-emergency-contact.ts:82` reaches into another spec's internals
  (`emergencyContactOcrFormSpec.approveTo!.canFanOut`) — cross-spec borrowing that drifts silently.
- **Per-workflow copy-paste**: ~15 lines of identical auth-deferral boilerplate in 5 workflows; the
  `operationTraceCode` switch (`workflows/ocr/orchestrator.ts:1562`) re-encoding codes that
  `defineWorkflow` already declares; status/icon/label maps re-declared in ~6 dashboard components.
- **Root cause**: the system is coupled **by convention** (independent lists sharing string names)
  instead of **by contract** (one typed thing both sides derive from). Nothing forces the second
  edit when you make the first.

## Target architecture (the operator's vision, formalized)
<!-- roadmap: phase-0 -->

<!-- roadmap-status: phase-0 -->
- [x] all 27 items were ratified in Phase 0 and reconciled through **Round 12** (D1–D94); the phase's own record — what it designed, how it ended — is `00-design-the-foundation.md` §Phase summary
- [x] the items are numbered `### 1.`–`### 27.` as of 2026-08-21, so `ref:charter §12` resolves for the first time; the shape is `12.` rather than `§12 —` because that is what `scripts/roadmap/scan-docs.ts`'s section grammar parses
- [x] **six** of these contracts have since been AMENDED by a later decision — D150 (legacy change accounting, §24 + §Non-negotiables), D191 (the gate family, §Non-negotiables), D247 with D216 beside it (command names are not an isolation resource), D263 (§One master plan's form), D193(c) (the Phase-3 entry, D84's order intact), D184 (the D58 inventory guard) — each marked in place above and tabulated in doc 00 §What no longer binds
- [ ] **one** Phase-0 promise is still unbuilt: D79's `scaffold new-task` / `scaffold new-workflow` (the `new-workflow` half is owned by `{#def-explorer-edit}`, the `new-task` half has NO node owner). D85's test-target registry and real-kernel dry-run command are built under their R10 names (`config/test-subjects.json` and `cli dry-run-scenario`; `{#test-tiers}`)
- [x] nothing in Phase 0 ITSELF is open — it wrote no runtime code by policy (§Process), so every item's build state is owned by the phase that implemented it, not by this doc
> 2026-08-21 | docs-cohesion charter | verified against `src/core/runtime-composition.ts:142-143`, `docs/rebuild/00-design-the-foundation.md` §What no longer binds + §Two Phase-0 promises are still unbuilt, and `reference/decisions.md` rounds 1–12; left: nothing in Phase 0 — the six amendments and the two unbuilt promises are each owned elsewhere
<!-- /roadmap-status -->


### 1. Task stores — two levels (operator directive 2026-07-17, the core of the modular structure)

Every *system* has a store—`ucpath`, `onbase`, `crm`, `kuali`, `servicenow`, `i9`,
`new-kronos`, `old-kronos`, `sharepoint`, plus the data-service systems (§11)—holding small, single-purpose,
well-named tasks. AND every *workflow* has its own **mini-store** of tasks. **Any workflow may
compose tasks from a system store, from its own mini-store, OR from another workflow's
mini-store** — reuse is peer-to-peer, not only workflow→system. A task promoted because a second
workflow needs it simply gets imported from wherever it lives; there is no forced relocation.
Workflow mini-stores contain pure workflow-specific compute only (`sessions:[]`, `effect:"read"`);
anything that opens a browser or prepares/commits an external write lives in the owning system
store. Peer reuse therefore cannot bypass system session or write-safety policy.
Tasks stay specific: one function does one specific thing (a "fill form X" task is distinct from
a "submit form X" task — see §a). When something breaks, the broken task is identifiable by name
from the trace alone. Store location never implies scheduling semantics: the workflow graph owns
ordering, branching, fan-out, and page-scoped transaction composition.

**§a — Fill and submit are always SEPARATE task contracts inside one page-scoped transaction
node (dry-run mechanism, revised 2026-07-21).** A fill task has `effect:"prepare"`: it may mutate
the browser page but not the external HR system. A submit/save/upload task has `effect:"commit"`
and is the only task allowed to cross the external-write boundary. The graph pairs them in a
`transaction` node. Both execute under one uninterrupted page/context lease because staged wizard
state is not serializable and lease cleanup would destroy it. A real run binds a stable commit
input, resolves durable history and any live idempotency probe on a separate read lease, then
executes `prepare → fresh subject bind → fence → commit → verify` on the uninterrupted
transaction lease. The probe
is never allowed to navigate the staged page. A dry run executes the same prepare task and
structurally omits the commit arm before execution. The prepare and commit remain separately
named task spans, but there is no checkpoint, retry, park, or page reset between them. A crash
after the fence is write recovery, never "resume at submit."

### 2. Typed task contract

Every task declares zod input + output schemas; TS types are inferred
from them. Types are the primary hardening mechanism: a contract change on one side must **fail
to compile** on the other. No ambiguity, no stringly-typed dispatch.

### 3. Base task + customization

Workflows compose base tasks from the stores and decorate them
(extra actions, screenshots, checks) without forking the base. Adding a task to a workflow must
not break the workflow. Instrumentation (screenshots etc.) attachable at any point.

### 4. Workflow-constant input

Each workflow declares its own zod input schema; that input is
fixed for the entire run. Enables rerun with different inputs and **start from any resumable graph
node**—never an internal prepare/commit arm. Entry validation fails loudly if required upstream
outputs/provenance are missing and proceeds only when the full node-entry contract is satisfied. The
task-N-consumes-task-N-1-output tension must be resolved by an explicit, validated mechanism
(design ref workflow-model owns this).

### 5. Descriptor SSOT

A bundle-safe, plain-data descriptor per workflow containing its complete
typed graph (task, transaction, branch, parallel/fork-join, child-run, and gate nodes), versioned
identity, presentation, run surfaces/actions, input presets, item identity, completion program,
subscriptions, and coordinator policy. Server runtime and client metadata are projections of
this descriptor; the browser consumes a generated/client-safe projection rather than importing
workflow modules. Playwright implementations stay behind the server registry. Every current
parallel list must either disappear into a projection or be named explicitly as a deliberate
non-workflow registry.

### 6. Trace + timeline SSOT

A well-defined trace id with run/task spans and span-addressed action
notes covering every action. Timelines, step durations, and step labels are computed **from**
spans + the descriptor; action detail joins by span path. There is no second hand-maintained
source of time or naming anywhere.

### 7. Tracker + dashboard in scope

The event layer is rebuilt around span events; the dashboard
consumes the descriptor + span contract. (Operator decision: full blast radius, including
tracker.)

### 8. Reusable by construction

Every task is designed plug-and-play even if only one workflow
uses it today. Workflow-specific behavior lives in the customization layer, never inside a base
task.

### 9. Duo is fully automated, everywhere (operator directive 2026-07-17)

Duo Autopilot clears MFA
hands-off for ALL runs — production operator runs included. The new design contains NO
phone-approval pause, poll, or manual-MFA path anywhere. Session providers log in unattended.

### 10. Parallelism-first kernel (operator directive 2026-07-17)

Today's parallel-worker model is
slow (e.g. the ~33s UCPath sleep tax, serialized per-worker items). The new execution kernel is
designed from the ground up for fast parallel work — same parallel-running capability as today,
but re-architected for speed, not ported. Design doc: `reference/execution-and-sessions.md`.

### 11. First-class data-service systems (operator directive 2026-07-17)

`extraction` (CSV + PDF),
`normalization` (contact/address rules plus explicit provider-backed suggestions), `ocr`, and
`roster` (spreadsheet matching) are their own systems with their own task stores. Remote
OCR/model/geocoder calls are declared provider capabilities with injected clients, bounded
admission, redaction, and typed failure outcomes; a service task cannot hide network I/O in a
direct SDK import.
Extraction and roster use **operator-defined column mapping**: the operator manually connects a
source column title to a canonical codebase field (e.g. some spreadsheet's column → `eid`); the
mapped values flow into the workflow's zod input schema, so every cell and assembled row is
schema-validated with visible row-level rejection—not guessed into validity. Design doc: `reference/data-intake-and-edit-data.md`.

### 12. Edit Data over checkpoints (operator directive 2026-07-17)

Whenever a run is stopped or
parked for later resume, the data the workflow currently holds (its checkpoint state) is ALWAYS
live-visible in the Context rail's merged Data section. Descriptor-allowlisted correction fields
are editable in place and schema-validated on save; identity, input, idempotency, proof, and
provenance are read-only. There is no separate Data/Edit Data tab or dialog.

### 13. Write-safety — fenced, fail-closed real mutations
<!-- roadmap: p2-proof -->

<!-- roadmap-status: p2-proof -->
- [x] the fenced, fail-closed kernel is BUILT and MET LIVE (**D135**, 2026-08-04): a dry run with zero durable rows, a forced subject mismatch refused at beat ② with zero fence and zero click, ONE controlled commit on real Kuali doc **4489**, and an idempotent re-run answering `already-present` in 2 ms with no browser — evidence of record in ref write-safety §3.4
- [x] the `resolve/probe → prepare → binding proof → fence → external-commit → proof → durable-commit` sequence this item describes is `src/core/write-sequencer.ts`, the ONLY module permitted to mint a mutation capability
- [x] the ALWAYS-GATE this item names is built and live-proved (**D202**, separations chunk 3, first live gated run 2026-08-12); **D211** put the write plan INSIDE the approved packet, so a separation date that moves after approval re-opens the gate
- [x] three `effect: "commit"` contracts exist — `kuali/save-separation-finalization`, `ucpath/create-termination`, `ucpath/delete-pending-terminations`; D266 retired the annotation-only fourth contract with its test workflow
- [ ] the per-system list is only part built: **CRM, ServiceNow, OnBase and I-9 have no commit contract at all**, and onbase/servicenow/i9 are three-line session declarations with zero tasks — each lands at its own migration (`{#migrations}`)
- [ ] `recoveryAbsence: stabilized` is inherited by `kuali/save-separation-finalization` from the annotation proof's measured mechanism window (D207); confirming or moving that inheritance is chunk 5c's obligation. Both UCPath contracts stay `operator-only` because no UCPath propagation window has ever been measured
> 2026-08-25 | D266 code reconciliation | the retired annotation contract remains only as `ref write-safety` §3.4 history; current inventory is the three real separations commits
- [ ] the immutable ledger is built and guarded but its serialized writer has **no production caller** — `createLedgerProjector` is called only from `tests/`, so nothing drains the durable outbox to a file (doc 05 §Exit criteria)
- [ ] the per-submit double-submit probe policy is decided per workflow at migration time via the §b questionnaire; **separations is the only workflow that has answered it**
- [-] hash-chain / tail-anchor tamper evidence stays deferred to the multi-user phase (**D79**), and **D193** makes multi-user a LATER with no owner and no design
> 2026-08-21 | docs-cohesion charter | verified against `src/core/write-sequencer.ts`, `src/domain/contracts/{kuali,ucpath}/`, `reference/write-safety.md` §3.4 and doc 05's ledger finding; left: the four systems with no commit contract, the unmeasured UCPath window, and the ledger writer nothing composes
<!-- /roadmap-status -->


*(Gap audit: ref foundation-gap-audit §2. Operator answers 2026-07-18. Full design: ref write-safety.)*

Every mutation gets completion-verification and double-submit
protection appropriate to its system, and completion is checked **FAIL-CLOSED**: an unknown or
unverifiable result is NEVER treated as done (operator: *"you have to be very sure they were
completed"*). Per system:
- **UCPath / CRM / ServiceNow** — the irreversible submits. The submit task captures a
  **verifiable receipt** (e.g. a confirmation number) as its typed output; the kernel runs a
  resolve/probe → prepare → binding proof → fence → external-commit → proof → durable-commit
  sequence, and crash-recovery re-runs the probe. A post-fence `absent` authorizes retry only
  after the contract's typed, system-specific propagation/negative-proof policy succeeds; a
  single early miss parks as unknown.
  UCPath is where the real incidents happened (a duplicate person; a wrong-person termination,
  `T002173685`). Permanent-key fencing closes double filing; the wrong-person class additionally
  requires the identity-approval gate, **ratified 2026-07-24 as ALWAYS-GATE** — manual operator
  approval on every separation, for both separation types (Kuali separations and I-9
  separations), with no auto-approve-on-match mode. Its design is owned by ref write-safety §14 and its
  gate-node mechanism by ref workflow-model. The plan never claims a probe that can read the wrong person
  makes that class structurally impossible; the gate is what closes it.
- **Kuali** — **SAVE-only, not a submit** (operator 2026-07-18): a write, but not an irreversible
  filing. No confirmation-number receipt needed; the automation must still verify the save
  completed, fail-closed.
- **OnBase** — the operator **tracks completion manually** (operator 2026-07-18). The automation
  must be *very sure* the upload completed before it reports done — fail-closed, never fail-open.
- An **immutable write-proof ledger** records what was actually filed/saved and is **never
  pruned**. SQLite is the transactional authority: committing a write atomically records the
  checkpoint plus ledger/span outbox rows. A serialized projector appends one ordered stream
  with actor attribution; recovery reconciles every committed-intent/outbox/span permutation.
  Hash-chain/tail-anchor tamper evidence is deferred until the multi-user phase (D79).
- The per-submit **double-submit probe policy is decided per-workflow at migration time**
  (operator deferred it), via the §b migration questionnaire.
- A parked write has no generic Done/Retry escape hatch. The operator may attach proof that parses
  through the commit arm's proof schema (which performs the same atomic durable commit), or record
  an audited confirmed-absent decision that makes the permanent intent retryable. An
  `unverifiableByPage` write uses a typed operator-attestation proof; it never turns an uncertain
  page result into automatic success.
- **Guarantee boundary (D64):** the kernel guarantees at most one unattended commit attempt per
  permanent intent generation and never retries from an unproven absence. Automatic recovery
  converges when the target supplies valid positive or stabilized negative evidence; targets
  without an idempotent API or authoritative negative read park for operator resolution. The
  plan does not claim unconditional distributed exactly-once from a UI probe.

### 14. Local artifacts are replay-safe, not hidden writes

A `read` task may download or derive a
content-addressed local artifact only through the kernel artifact writer (temp + fsync + atomic
no-replace publication + directory fsync); retries address the same bytes and cannot append
mutable business state. Mutable local
outputs such as i9's retention workbook are projections of stable-keyed SQLite outboxes, written
by a serialized projector. They are not mislabeled read-task side effects and cannot duplicate on
task retry.

### 15. Runtime-validated data, not TypeScript-only confidence

Every value crossing an external,
persistence, command, event, config, or client boundary is parsed by a strict zod schema.
Branded ids/scalars and discriminated outcomes replace interchangeable strings; `optional`
means not supplied, `nullable` means observed no value, and `unknown` is an explicit outcome
that must be handled. Open `Record<string, unknown|JsonValue>` bags are forbidden for durable or
decision-driving data. Full rules: refs task-contract/dashboard-surfaces and reconciliation D46.

### 16. Observed-subject binding before real writes

The intended EID/name in a workflow input does
not prove which person's page is open. Subject-scoped browser tasks may declare an authoritative
UI observation and matching policy for high-risk reads; every prepare/commit pair must. A commit re-observes and matches the page
after prepare, immediately before the fence/click, and records expected+observed proof in the
transaction evidence. Missing/mismatched identity fails or parks before mutation. This closes
the stale-page class seen in New Kronos and complements—does not replace—the separations
identity-approval gate. Full enforcement: refs task-contract/write-safety/operator-trust.

### 17. Queue/control/delegation are kernel protocols, not workflow features

Enqueue, retry,
cancel, bump, hide/restore, authoritative tree targeting, dependency transitions, and command
idempotency/versioning have one server-owned implementation. “Delete” means reversible
**Hide from queue**; destructive Purge is a separate offline maintenance operation. Workflows
can restrict safe actions, never redefine their semantics. Delegation declares typed child
input/output, stable child identity, join/failure/partial/cascade/retry policy, and is persisted
atomically with the child manifest. Full design: refs workflow-model/dashboard-surfaces.

### 18. Semantic UI vocabulary + trustworthy evidence

Important controls, screens, page states,
and observations have stable canonical names, non-identity search terms, explicit `supersedes`
links, and verification evidence. Browser
tasks use typed system drivers; raw Playwright pages/locators stay inside driver/session
infrastructure. Every run projects a receipt of inputs, observations, decisions, actions,
verification, output, reused checkpoints/proofs, warnings, and uncertainty. Failures produce a
structured record and redacted diagnostic bundle addressable by `explain run`. Full design:
ref operator-trust.

### 19. Scenarios and knowledge improve with real use without becoming a pile

Every task/workflow
has a registered scenario corpus beyond one happy example; unexpected page states fail visibly
and become new scenarios when understood. Existing LESSONS are triaged, not copied wholesale,
into structured active/superseded/retired knowledge. AI-assisted fixes record the failure,
affected ids/files, regression scenario, verification, and commit; raw chat is never authority.
Full design: ref operator-trust.

### 20. The workflow editor starts as the real graph, then earns safe editing

The base includes a
read-only descriptor/live-run explorer (deferred to the Phase-2 tails, not the spine). After
the transaction proof it may edit presentation and a closed set of typed composition/policy
fields through compile/validate/diff/version/apply; arbitrary code, selectors, subject
matchers, idempotency keys, and write proof remain code work. Running runs never hot-change.
**The DSL graph-authoring mode is TRIMMED (2026-07-24, Q5a)** — no second graph-authoring
pipeline, no codegen, no exclusive source-vs-DSL mode. Workflows are source-authored; the
editor does presentation + safe closed policy fields, and anything else generates a
code-change brief. Reinstatement requires a new explicit operator architecture decision; a
migration questionnaire cannot enable it. Full design: ref operator-trust.

### 21. Irreplaceable local state has an operational recovery contract

SQLite claims,
checkpoints, dependencies, commands, intents, manifests, and outboxes are not reconstructible
from JSONL. Startup integrity/migration/disk/WAL checks, rotating online backups, mandatory
pre-migration backup, restore drills, and read-only rescue mode are part of the base. New writes
stay disabled when authority health is unknown. Full storage owner: ref dashboard-surfaces.

### 22. Mobile/phone document Capture Mode is retired (D294)

The rebuild no longer offers phone document capture, QR start, capture ingress/tunnel, durable
capture sessions, bundle handoff, or a capture-to-workflow binding. Their D174/D175 history remains
in Git and legacy records remain readable only through their historical schema. Diagnostic
screenshots, Receipt Capture tiles, and Archive evidence are distinct diagnostic authority and stay.
The remaining D189 gap is solely safe local serving of the ordinary built dashboard; it is not a
public delivery path.

### 23. AI assistance is optional evidence, never authority

OCR/contact normalization and
operator-requested triage, sanity checks, selector suggestions, or run summaries return strict,
provenance-labelled advisory outcomes. Redacted inputs only; unavailable/invalid model output
is distinguishable from “nothing wrong.” AI cannot select a person, resolve a gate, alter run
state, declare success, create a selector, or authorize a commit. Deterministic contracts,
scenarios, receipts, and UI registry remain authoritative.

### 24. Cutover readiness is proven by capability inventory, not workflow count

Every legacy
workflow, service, route family, dashboard surface, CLI/ops command, exporter, code generator,
and maintenance tool receives a native/replaced/retired-in-target/open disposition plus a
closing milestone and legacy-change-accounting links. Runtime proxy is not a disposition.
**Amended — D150 (2026-08-05):** the legacy-change-accounting half is RETIRED;
`config/legacy-change-accounting.json` is a frozen historical record. The disposition + closing
milestone remain, and **D184 (2026-08-09)** made them enforceable — the guard refuses an entry
`open` at or before the runtime's own `completedThrough`, a target that does not resolve, and
evidence that only says "the legacy file still exists" (doc 00 §What no longer binds).
Completing the inventory authorizes the single cutover only; the whole legacy repo — source and
tests — remains preserved afterward. Any later retirement/deletion requires a separate explicit operator
authorization and its own capability/rollback proof. Master owner: the phase docs; guard owner: ref guards-and-tests.

### 25. Versioning by fingerprint; archiving by version bump; git is the archive (2026-07-24)
<!-- roadmap: p2-2i -->

<!-- roadmap-status: p2-2i -->
- [x] BUILT in 2i-G (**D179**): schema **v13**'s `archived_runs`, `archive_relaunches` and `version_bump_applications` abort UPDATE and DELETE **in SQL** — an archive whose rows could be rewritten is a weaker record than the live row it replaced
- [x] the zero-compat-code claim is CHECKED rather than asserted: `archive-invariants` reads a stored record back with the descriptor list **empty**, which is the only test that can settle "viewing an archived run needs no old-version code"
- [x] the app-version stamp this item depends on was MISSING — the queue projection stamped the build serving the PAGE, so run-detail's "different app build" warning compared a value with itself; `RunRecord` now carries an `appVersion` stamped at the ONE enqueue point and read forward, never back-filled (**D133**/**D179**)
- [x] the workflow LABEL, and since **D242** the short CODE, are FROZEN into the archived record — resolving either later would be a descriptor read on the archived path, which this item forbids
- [x] the MAJOR-bump "cannot archive a non-terminal run" rule is enforced where it decides: `apply` re-derives candidates AND blockers from authority inside its own transaction and refuses naming every blocker, so an unresolved possible-submit is never buried; D274 requires MINOR bumps to archive nothing and therefore never be blocked by non-terminal runs (implementation remains open)
- [x] "git is the archive" holds for the CODE — no archive folders exist anywhere in the tree; prior descriptor versions live in git history while RUN data is archived as self-contained rows
- [ ] two criteria left Phase 2 by explicit DISPOSITION, both on 2i surfaces: the Workflow Explorer's EDIT half (**D186**, reassigned with a named trigger) and the BFF serving no frontend bytes (**D189**) — neither is a waiver and both name an owner
> 2026-08-21 | docs-cohesion charter | verified against `src/domain/archive/model.ts`, `src/services/archive/archive-service.ts`, `src/infra/sqlite/migrations.ts` and `tests/unit/architecture/archive-invariants.test.ts`; left: nothing in 2i itself — all eight squares are `[x]` at `{#p2-2i}`; the two dispositions are recorded above
<!-- /roadmap-status -->


No archive folders. Descriptors carry a version + content fingerprint; guards force a bump on
behavior change; every run permanently stamps the workflow version *and* app version it ran
with at enqueue. **When a workflow's MAJOR version bumps, all runs of prior versions leave the
dashboard** — active surfaces, counts, and filters only ever contain current-version runs — and
move to a read-only **Archive**. A **MINOR bump archives nothing and cannot be blocked**; it records
the new version without moving prior runs. Major-bump archival is what buys the zero-compat-code invariant: the archive
stores each run's final projected row + receipt + evidence pointers as **self-contained data**,
so viewing an archived run needs no old-version code, no shims, no version fallbacks, exactly
one rendering path. A **dashboard (app) update that requires archival is a major effective-version
bump for every affected workflow**, for the same reason. The session making a change declares its scope (single-workflow /
multi-workflow / dashboard) and the bump follows that scope, recorded in the change record.
Three hard rules: the **write ledger is never archived** (what was filed in HR systems stays
forever, independent of run archival); **"relaunch from archive" starts a fresh run on the
current version** from the archived immutable input, never a resume; and a MAJOR bump **cannot
archive a non-terminal run** — queued/parked runs must be terminalized first (cancelled, or for
a parked write RESOLVED present/absent) and the major-bump flow lists them, so an unresolved
possible-submit is never buried. A MINOR bump archives nothing, so non-terminal runs do not block
it. **Hide/Unhide is retired by D234**; Archive is the only whole-run exclusion.

### 26. One projection owns every count (2026-07-24 acceptance requirement)

In the legacy
dashboard the per-workflow badges "always error out" — the recorded bug class of count/badge
divergence (≥4 separate fixes). In the rebuild, Workflow Panel badges, Status Bar counts, and
Queue Panel rows are read from **one** server-side projection. A count may never be computed by
a second path, so it can never disagree or error independently. Projection owner: ref dashboard-surfaces;
guard owner: ref guards-and-tests.

### 27. The receipt must survive the operator's double-check (2026-07-24 acceptance test)

The
operator double-checks most real transactions today. The rebuilt row/receipt therefore carries
the exact proof they would otherwise go fetch: the transaction/confirmation number, the
post-submit confirmation screenshot, and the person identity observed at commit. **Acceptance:
the operator can complete their double-check without opening UCPath.** Owner: ref write-safety (proof
content) + ref operator-trust (receipt surface).
## Non-negotiables
<!-- roadmap: phase-0 -->


- **Fail loud.** The legacy repo's root `CLAUDE.md` rule applies in full to the rebuild repo from
  its first line.
- **Port, don't rewrite, live-verified leaf knowledge.** Selectors (`// verified` dates),
  `duo-login-flows.ts`, UCPath iframe/modal-mask handling, OCR fabrication-tiering + tolerant-field
  lessons, OnBase single-session constraint. This code moves nearly verbatim and gets *wrapped* in
  new contracts. Re-derivation from scratch is forbidden — it discards live verification.
- **Port knowledge, not stale lesson files.** Existing `LESSONS.md`/`CLAUDE.md` entries are evidence
  for migration. They are triaged into ref operator-trust's structured active knowledge or incident history;
  superseded/incorrect/duplicate guidance does not move into the rebuilt prompt/search surface.
- **Local-FIRST with multi-user seams (amended 2026-07-23; supersedes "local-only").** The tool
  stays single-operator today, but the operator intends to open it to others later and wants that
  migration to be configuration, not a second rebuild. So four seams are load-bearing from day one
  and may never be trimmed: (1) **actor attribution** (`requestedBy`/actor id) on every command,
  run, approval, gate resolution, ledger entry, and fix record; (2) **one identity checkpoint** —
  a single auth seam every request passes through, returning the constant "local operator" today;
  (3) **credential-set-keyed sessions** — browser logins keyed by credential set, so a future user
  brings their own HR logins and Duo; (4) **per-actor notification/read state**. Still explicitly
  out of scope for Phase 1: RBAC/permissions UI, user management, teams, network deployment/TLS,
  per-user dashboards, remote sync, HA, distributed consensus. The operator server binds loopback;
  no mobile-capture ingress exists. Secret/SSN/
  HR-data redaction, reliable backups, strict validation, and fail-closed write/identity behavior
  remain mandatory because the tool handles real employee data and transactions.

  **As built 2026-08-29 (D75):** the first BFF middleware is the one checkpoint for every request.
  Solo mode derives only the strict configured `local-operator`; request JSON, query parameters,
  headers and XLSX metadata cannot supply actor identity. Existing
  command-envelope claims must match before handler effects. New operator XLSX evidence is v2 with
  that derived actor id, while v1 stays explicitly unattributed and is never backfilled. Credential
  issuance and the second actor remain Phase 3d work.

  **Reaffirmed and sharpened by the operator 2026-08-12 (D193) — SOLO, LOCAL, NEVER HOSTED.** The
  system is and stays **fully local to the one person using it**, solo-operator only. It is
  **never** deployed to a hosting platform — no cloud, no shared server, no tenant, no hosted
  "environment". This is not a new constraint; it is the existing one stated in the form that
  settles the ambiguity these plans carry: **where the plans say "production" they mean the day
  this repo replaces legacy as the operator's daily LOCAL tool** (the D89 all-at-once cutover) and
  nothing else. A reader who takes "production" as "hosted" is reading it wrong, and any slice that
  quietly assumes a hosting platform is out of scope on its face. Two future items are named here
  so they are not re-derived later — **neither is planned work now, and neither has an owner, a
  slice, or a design**:
  - **LATER — package it as a locally-run app ("web app → real app").** The same local system
    launched as an application instead of a dev server beside a browser tab. When it is taken up it
    is a *delivery* change, not an architecture change, precisely because nothing in the system
    assumes a host.
  - **LATER — a cooperation / multi-user mode is built ON TOP OF the solo mode, if ever.** The four
    seams above are the whole of the investment made toward it, and they were already cheap and are
    already built. **Nothing is designed for multi-user now**; no slice may add scope, ceremony, or
    abstraction in its name. Solo is the shape the system is built for, and a later cooperation
    layer sits over it rather than replacing it.
- **Build speed is the top optimization target (2026-07-24).** Where two designs are both
  correct and both safe, the one that ships sooner wins. This is the tie-breaker behind the
  Phase-1 restructure and the ratified ceremony trims (roadmap §Phases at a glance,
  doc 00 §Size model + delivery tiers). It never overrides a
  write-safety, identity, or fail-loud requirement — those are what the program is for.
- **Same quality umbrella from day one.** The rebuild repo has its own tsconfig project, unit tests,
  and its architecture ratchets, all covering its whole tree from its first file. New
  rebuild source and tests have explicit non-vacuous zero-warning lint gates; known legacy test-lint
  debt stays in the legacy repo, fingerprinted and shrink-only, never silently inherited or used to
  exempt a new diagnostic (D70). No ungated tree on either side.
- **Testing policy is ratified (2026-07-31; D91).** _Amended — **D191 (2026-08-09)**: the
  per-commit gate is `typecheck` / `lint` / `test:coverage`, which REPLACES the earlier
  `test` + `test:architecture` pair (a strict superset, measured faster). The FLOORS below are
  D91's and are unchanged in the tree (`vitest.config.ts:39-43`); R10's raise of the global floor
  to 80 % is owned by the tree's `{#test-tiers}` node and has not landed._
  Rebuild lines/statements/functions gate at
  60% globally and 80% for the named safety-critical set. Branches are report-only through Phase 1
  and gate at 50%/70% at Phase-2 exit. Suite size is reported and reviewed at phase exits rather
  than hard-failed. Legacy tests/projects remain in place and runnable through cutover; retirement
  or deletion requires a later explicit operator authorization.
- **No implementation before the corrected dependency graph is accepted.** The abandoned Phase-1a
  skeleton and spike were removed on 2026-07-21. The next implementation starts from an empty
  rebuild tree; no type shell may forward-declare a contract owned by a later phase.
- **ISOLATED COEXISTENCE — the existing automation remains production-authoritative throughout
  the rebuild (operator ratification 2026-07-31; D88, SUPERSEDES D73; re-mechanized 2026-07-31 by
  D93).** The **legacy repo** (`hr-automation`) — its source, commands, and legacy tests — remains
  live, runnable, maintainable, and eligible for ordinary production fixes, and is the sole
  production authority. The replacement is built in a **standalone rebuild repo**
  (`hr-automation-rebuild`, fresh history seeded from the `feature/rebuild-phase1b` tip): rebuild
  code at plain `src/`, tests at `tests/`, config at `config/`, plan docs still at `docs/rebuild/`,
  gated by that repo's plain gate family (`typecheck`/`lint`/`test:coverage` since **D191**).
  **Isolation is
  now physical:** two repositories share no module graph, build, or process, so cross-runtime
  imports, calls, proxying, and live-state access are structurally impossible — the D88 bidirectional
  ban is preserved as a property, while the guards that enforced it in one tree are retired.
  Because both worlds still run on one machine, distinct state/artifact roots,
  ports, process locks, and browser profiles/sessions remain **required and gated**
  (`config/runtime-isolation.json`, proved by `operational-isolation.test.ts`). Verified leaf
  knowledge is copied/ported with provenance — the legacy commit hash and source path — never
  runtime-imported. _Amended — **D247 (2026-08-20)**: a command NAME is not an isolation resource.
  Names may coincide; a mistyped `npm run dashboard` in the wrong checkout starts THAT checkout's
  dashboard on its own port under its own roots and locks, which is legible and harmless.
  **D216 (2026-08-14)** is the same correction one row down — both repos name the browser-profile
  root `.auth`, because a repo-relative root cannot collide and the SESSION namespace is the half
  that protects browser state._ _Amended — **D150 (2026-08-05)**: cross-repo change accounting is
  RETIRED. Nothing here reads legacy's working tree and legacy work blocks no rebuild gate; the
  staleness risk is covered instead by **live re-verification at each workflow's migration**._
  There is no workflow-by-workflow production flip, live lift/proxy, or mixed-engine authority
  during development.
- **ONE ALL-AT-ONCE CUTOVER, WITH ROLLBACK CODE PRESERVED (operator ratification 2026-07-31;
  D89, mechanics amended by D93).** Cutover occurs only after the complete rebuild passes its
  whole-program readiness gate. The operator stops new legacy enqueues; active and uncertain legacy
  runs are drained, parked, or reconciled; both runtimes' state/config are backed up; any import is
  an explicit versioned one-time operation; and the normal production launcher is atomically
  repointed at the **rebuild repo**. The **entire legacy repo** — source, commands, and tests — is
  preserved as rollback code at initial cutover, which is strictly stronger than the in-tree
  preservation this decision originally assumed. Neither source nor tests are deleted without a
  later, separate operator authorization plus capability proof. After the new runtime has performed
  native writes, rollback requires the reconciliation/dedupe bridge named in doc 05 §Phase summary; the two engines
  never run concurrently as production authority.

## One master plan (operator directive 2026-07-17)
<!-- roadmap: phase-0 -->


When the design docs converge, they are consolidated into a SINGLE phased plan containing every
piece of information needed to build — there must never be multiple competing plans that can cause
mix-ups. _(As built: that plan is the eight phase docs `docs/rebuild/00`–`05`, one per phase, plus
`docs/roadmap/roadmap.md`'s governance prose and phase table. It was ONE file, `07-master-plan.md`,
until 2026-08-20, when it was dissolved into them and preserved at
`docs/rebuild/history/superseded/2026-08-20-master-plan-dissolved.md`; the one-plan rule is unchanged — the
phase docs are one plan, split by phase, and nothing else may sequence the build.)_ Each concept has
exactly one owning doc (the D1 matrix in `reference/decisions.md`); the plan sequences phases and
references the owners, it does not redefine contracts.

**Where the governance rules live now (D263, 2026-08-20).** This charter states the VISION and the
non-negotiables; it does not govern how the program is run day to day. **The governing rules —
which doc owns what, how a decision is ratified, how the plan tree and the docs are bound to each
other, and what a status block means — live in `docs/roadmap/roadmap.md` §Governance**, beside the
plan tree they govern. That file is also the source `npm run roadmap` renders the roadmap site
from. Read §Governance first when the question is *"how is this program run"*; read this charter
when the question is *"what is being built and what may never be traded away"*. **After each build phase completes, it is documented**: subsequent
phases add new docs and/or update existing ones so the documentation always matches what is built.
The foundation's documentation is part of the foundation.

## Migration strategy
<!-- roadmap: migrations -->
<!-- roadmap: cutover -->

<!-- roadmap-status: migrations -->
- [x] the strategy itself is unchanged and still governs: one workflow at a time, each with its own migration plan doc, the §b questionnaire answered BEFORE building (doc 03c §Phase summary's seven-step playbook)
- [x] order 0 (person-lookup) is live-proven from Phase 1; **separations (order 8) is the migration in flight** — **D193(c)** moved the phase ENTRY here to force the store task libraries into existence, explicitly WITHOUT re-sequencing D84's risk-proof order
- [ ] thirteen workflows across nine order rows remain, and **no workflow after separations is named yet**; only person-lookup and the six separations descriptors are registered, so orders 1–7 and 9 have no descriptor at all
- [ ] store reality behind the order: only `ucpath`, `crm`, `kuali` and `new-kronos` have real drivers; `onbase`, `servicenow`, `i9`, `old-kronos` and `sharepoint` are three-line session declarations with zero tasks
- [ ] the legacy capability register stands at **47 open** · 20 replaced · 7 native · 4 retired; every open entry names `phase-3-workflow-migration` and cutover requires zero
> 2026-08-21 | docs-cohesion charter | verified against `{#migrations}` and doc 03c §Recommended migration order; left: every order row after separations, and the 47 open register entries that close with them

<!-- /roadmap-status -->

<!-- roadmap-status: cutover -->
- [x] the SHAPE is ratified and unchanged — one all-at-once authority switch, no per-workflow flip, no live proxy, no mixed-engine production period (**D89**, mechanics amended by **D93**), and the entire legacy repo preserved as the rollback asset
- [ ] **nothing has started.** `{#cutover}` is `not started` and every one of its nine build items is open, including the rehearsal that has never run (doc 05 §Exit criteria)
- [ ] closure — deletion or retirement of the legacy repo — is OUTSIDE this cutover and has no trigger, no elapsed-time rule and no automatic expiry; it needs a separate explicit operator authorization (`{#rollback-window}`)
> 2026-08-21 | docs-cohesion charter | verified against `{#cutover}` and doc 05 §Phase summary + §Exit criteria; left: the whole of it — this section states the rule, doc 05 owns the execution
<!-- /roadmap-status -->


- **Phase 0 (COMPLETE 2026-07-31; `docs/rebuild/00-design-the-foundation.md`):** foundation design
  docs in `docs/rebuild/`, each reviewed part-by-part with the
  operator in plain language (what the old version did → why it hurt → how the new design fixes it).
- **Phase 1 — the SPINE, whose exit test is a live workflow (restructured 2026-07-23, operator
  ACCEPTED).** The old sequence built ten base work items against synthetic fixtures before any
  real workflow ran. It is now cut to the minimum that can carry one workflow end to end: pre-tree
  guard plumbing → strict domain/clock/config/secrets → authority storage/recovery + command/
  write-safety type shell → semantic UI registry/drivers + task/store/session contracts →
  complete workflow graph/results/delegation/scenarios → core registry + executor/checkpoints/
  command service/write sequencer, plus only the span/projection slice of the event layer and the
  queue-surface slice of the dashboard. **Exit is not a fixture: person-lookup runs live on it.**
  Rationale: a live workflow falsifies contracts a fixture cannot, and the stop-loss scenario "a
  base contract flaw found after the base is done" is far cheaper to hit with six work items built
  than ten. The core registry is the composition root; lower layers never import workflows.
- **Phase 2 — the transaction proof, then the deferred base tails.** A page-scoped transactional
  workflow/harness proves prepare-only dry-run, fresh subject binding, real commit recovery,
  durable dedupe, and ledger projection — a read-only slice cannot prove write safety. Only then
  are the tails built, now against a proven spine and a real consumer instead of synthetic
  fixtures: the rest of the event/trust layer (evidence receipts, notifications, knowledge), the
  data-service and intake foundation, and the read-only workflow explorer.
- **Phase 3+:** per-workflow migration, one at a time, slowly populating the task stores with what
  each workflow needs. Every workflow gets its own migration plan doc answering: which store tasks
  it reuses, which new tasks it needs, how each new task is designed as a reusable base + what the
  workflow-specific customization is, and how deep reuse goes beyond the surface.
  - **§b — Each migration includes an operator decision checkpoint (operator directive
    2026-07-18).** Before a workflow is built on the new base, the orchestrator asks the operator
    the workflow-specific questions so nothing is missed for that workflow: which actions are real
    submits, the receipt source + completion check per submit, the double-submit probe policy, the
    dry-run boundary (which submit tasks to split), and any workflow-specific data/gate quirks. The
    operator explicitly wants these questions asked at migration time — "cover everything for each
    workflow as we migrate." This questionnaire is part of every workflow's migration plan doc.
  - **Workflow completion is not production cutover (2026-07-31).** Each migrated workflow is
    proved inside the isolated rebuild repo, but the legacy workflow remains the production
    authority. There is one all-at-once cutover only after every workflow and shared capability is
    ready. The cutover drains/parks/reconciles legacy work, backs up both worlds, runs only explicit
    versioned one-time imports, and atomically repoints the normal launcher at the rebuild repo.
    There is no per-run engine stamp, workflow-scoped flip, live proxy, or mixed-engine production
    period.
  - **Migration order optimizes total rebuild delivery time.** The order is chosen for reuse
    leverage—each migration must make the next cheaper—not for staged production availability.
    Onboarding and separations migrate last because they are the highest-stakes proofs and reuse
    the most. The existing automation continues serving every workflow until the single cutover.

## Process

- Work stays sequential by default with coherent local commits and explicit handoffs when context
  separation is actually needed. The active implementer adversarially reviews every owning doc and
  the master-plan integration before presenting a phase as complete.
- Nothing in the rebuild repo gets built before its design part is operator-approved.
