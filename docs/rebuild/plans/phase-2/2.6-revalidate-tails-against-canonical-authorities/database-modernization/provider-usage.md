# Provider requests and usage: storage foundation

**Phase 2.6-only execution rule:** 2.6.9 is the single Finalization task and the last task of
the phase. No intermediate or nested finalizers. Earlier implementation tasks use focused tests,
lint and affected freshness; 2.6.9 owns full gates, independent review, remaining repairs, master
integration when assigned, handover and cleanup. Other phases retain their existing rules.

> **Combined-plan amendment — 2026-09-09.** This file retains the approved product scope,
> acceptance proofs and historical inspection below. [The combined workflow](README.md) and
> [prerequisite releases](prerequisites.md) now exclusively own assignment IDs, dependencies,
> write-set allocation, candidate release, gates, review timing, integration and launch status.
> Earlier A/B/T1/T2/P/D/G execution allocations, per-unit full gates/reviews, master prerequisites
> and provider-owned integration below are superseded for this unlaunched batch. They are not
> alternate launch instructions. Every product proof remains required; heavy proof and independent
> review run in the final session. Existing in-flight timeline T1 keeps its own schedule.

**P-specific approval, 2026-09-09:** the operator approved the [approved P01–P06 brief](provider-usage.md#approved-execution-brief--2026-09-09)
with the repaired F prerequisite, the exact shared integrity-check exception, local master merge
and owned cleanup after focused PASS. That brief supersedes conflicting older allocation,
WAITING ON, no-master and retention instructions below. Full gates and independent review remain
2.6.9; current implementation status is recorded in the P execution record below.

## Archive-report amendment — 2026-09-08

This plan retains sole ownership of provider request/usage accounting. Archive transfer removes
run-owned request rows only after outstanding reservations are settled or otherwise accounted for
conservatively; it never refunds consumed usage or erases aggregate/key accounting. Any provider
information included in the saved run report is captured before cleanup. Add focused proof of
archive cleanup versus ordinary deletion, late callbacks, uncertainty and unchanged consumption.
The archive owner calls the existing accounting boundary; do not implement archive storage here.

Archive design owner: [independent archive reports](decisions.md#approved-group-3-independent-archive-reports-and-no-relaunch).
This is a planning amendment. Preserve existing in-flight gate schedules, candidate evidence and
accepted work; it does not launch implementation or reschedule reviews. New launch readiness awaits
the complete revised allocation and verified prompts.

## Assignment and approval

**Current assignment: 2.6.6.1 P.** This file owns its product requirements within the
[combined workflow](README.md). Implementation waits for C0 and the verified F development
release. Earlier side-work IDs are historical aliases only.

On 2026-09-08 the operator chose `provider_requests` and `provider_usage`, with request budget
details and usage totals/current windows/remaining quota. They accepted application-only accounting
and instructed “okay do that. make the plan.” They then narrowed the assignment: “dont wire the
actual like stuff from each key we have … just build the tables so i can add whatever provider i
want later. dont do it for a specific provider rn.” That later instruction governs this plan.

Three outcomes:

1. Replace `provider_admissions` with `provider_requests`, retaining request identity, lifecycle,
   budget/reservation and outcome evidence, with provider-neutral attribution fields.
2. Replace `provider_budget_counters` with `provider_usage`, supporting cumulative usage, quota
   windows, reservations and locally calculated remaining amounts through generic storage methods.
3. Supply a safe migration and preserve existing capability-level admission behavior. Prove the
   future attributed path with synthetic providers; do not connect actual keys or providers.

This session persists the plan only. Shared storage lands in prerequisite B; this supervisor completes
the generic accounting behavior. Real
per-key attribution, provider configuration, selection, adapters and presentation belong to later work.

Use [prerequisites](prerequisites.md) for the exact release and evidence allocation. Each peer
records progress only in its assigned owner/evidence file; shared plan edits belong to the
prerequisite or final owner. No shared implementation.md or peer-plan edits.

## Authorities and ownership

- [Document routing](../../../../../README.md), [root instructions](../../../../../../AGENTS.md),
  [roadmap governance](../../../../../roadmap/roadmap.md), and
  [operating reference](../../../../../../.agents/skill-library/repository-work/REFERENCE.md).
- [Execution and sessions: provider storage foundation](../../../../reference/execution-and-sessions.md#provider-storage-foundation)
  owns the pending amendment to D112's storage and accounting contract.
- [Clock/config/secrets](../../../../reference/clock-config-secrets.md), D321/D322/D332/D343,
  owns immutable configuration, secret boundaries and upgrade/backup admission.
- [Dashboard surfaces](../../../../reference/dashboard-surfaces.md), D308, and
  [operator trust](../../../../reference/operator-trust.md) own deletion and truthful evidence.
- [Guards and tests](../../../../reference/guards-and-tests.md), §3.14 D191, owns gates.
- The [combined execution plan](README.md) owns the completed prerequisites: timeline T2, run completion,
  then shared database foundation B. B owns migration, integrity and shared deletion composition.
  This peer consumes that accepted base and must not reactivate retired tables.
- Worker names (historical owner: `58d4fbcba:docs/sidetracks/worker-names/README.md`), command groups (historical owner: `58d4fbcba:docs/sidetracks/command-groups/README.md`) and
  operation names (historical owner: `58d4fbcba:docs/sidetracks/operation-names/README.md`) keep their existing scope and order.

Product scope includes the schemas and behavior below, but execution ownership is split explicitly.
B owns physical schema/IDs/global repository types, migrations, upgrade/recovery/integrity, shared
retention hooks and minimal legacy adapters. P owns only `src/infra/sqlite/provider-accounting.ts`,
`src/core/provider-admission.ts`, the exclusive provider tests and this plan/evidence as bound by B.
No migration, global type, composition, catalog-input or sibling-file edits in P. The [combined execution plan](README.md)
owns the exact write set, release proof, resource slots and handoff controls. Read nearest instructions.

Do not change pool rotation, key/model selection, secret readers or `.env.providers`; add real
provider registrations, key fingerprints, price schedules, quota discovery, token extraction, API
calls or telemetry ingestion; add a provider registry table, UI, BFF quota endpoint or CLI report;
change scheduling, workflow capabilities or external-write retry policy; amend existing config
snapshots; or apply migrations to the operator database. No push, live HR transaction or cutover.
Existing provider-specific adapters are outside behavioral scope. Minimal caller adaptations required
by the new storage contract are allowed; this is not permission to implement future per-key wiring.

## Inspected behavior and feasibility

Inspection base: `121df12e817c3e19708217d1b9e22d50b8787477` on local master. This is planning
evidence, not the future implementation base. Active rename/integration/timeline work has independent
checkouts. No implementation checkout is created or reserved by planning.

| Current mechanism | Storage consequence |
| --- | --- |
| `src/domain/provider-admission.ts` binds each admission to a run node or advisory surface, immutable config and request fingerprints. | Preserve both execution identity forms, original request IDs, replay/version checks and run/config relationships. Do not invent an executed node for advisory work. |
| `authority-database.ts` reserves, settles, interrupts and expires requests transactionally. Counter identity is capability; fixed UTC-minute/day windows govern existing behavior. | Retain the existing production path in explicit capability-scoped usage rows; add generic attributed scopes without pretending current calls identify a key. |
| `provider-pool.ts` selects a child independently during estimate and invoke; its key/model label is only presentation evidence. | Actual key attribution requires future selection work. This assignment never parses labels into authoritative provider/key identities or changes the pool. |
| Existing measured usage contains request count and cost, with no token fields. Gemini adapters currently supply zero cost estimates and outcomes. | Preserve historical bytes and current adapter behavior, but label legacy accounting as reported under the old contract. Do not promote a legacy zero to independently measured spending; the new generic contract can express unknown/estimated/measured values. |
| D308 deletes run-owned provider admissions. Capability counters are stored separately; integrity compares active reservations with reserved request rows. | Keep run details deletable and aggregates independent. Deletion must finalize any outstanding reservation conservatively before removing its request, without refunding historical consumption or leaving active-count mismatches. |
| Secrets currently come from registered environment families through `src/domain/secrets.ts`. | Storage accepts opaque caller-supplied references only. No reading, enumerating, hashing or persisting real keys in this assignment. |

Sanitized read-only target observation at `2026-09-08T20:46:26.837909+00:00`:
`/Users/julianhein/Projects/hr-automation-rebuild/.tracker/state.db` had zero `provider_admissions`
and zero `provider_budget_counters`; `PRAGMA quick_check` returned `ok` and FK violations were zero.
This does not prove populated migration or future compatibility. Recheck exact target/schema and
stopped-state admission before any separately assigned application. No product tests, migrations,
backups, provider calls or key inspection were performed for this observation.

## Data contract

### Provider requests

One row represents one admission/request decision, including denials. Keep stable request ID,
run/attempt/node-or-surface identity, capability, immutable config identity, request fingerprint,
version/timestamps, reserved/denied/settled/interrupted/expired state, request budget and estimate,
reservation allocations, outcome and redacted evidence. A reservation is permission to invoke,
not proof that a remote call occurred. A denied request consumes no new usage allocation.

Add a versioned attribution union: **legacy capability scope**, **unattributed**, or **attributed**.
An attributed request accepts a validated provider identifier, opaque credential reference when
applicable, optional model identifier, and explicit accounting-scope references. Keyless attribution
is distinct from missing attribution. Provider identifiers are data, not a hard-coded vendor enum.
They do not register or activate adapters. Keep existing capability validation at runtime; adding a
provider to storage does not automatically add a workflow capability.

Caller-supplied references never contain raw keys or secret fragments. A credential reference must
identify an immutable credential generation; its future issuer owns rotation/reordering stability.
This plan implements validation and identity/replay binding, not that issuer. Shared quotas have an
explicit shared scope so different credentials/models can charge the same pool. A request may debit
both an application budget scope and a shared/key quota scope; each distinct scope is charged once.
Do not sum overlapping scopes into a fictitious total.

### Provider usage

Store aggregate accounting independently of run ownership. Use stable accounting-scope identity
with explicit kind (legacy capability, credential, provider/model, or shared quota). Support typed
request, token and cost quantities with explicit units; input/output token meters remain distinct
when supplied. No adapter populates new token or key fields in this assignment.

For each scope/meter, represent cumulative tracked quantities, tracking start/coverage, current
window boundaries/reset, settled usage, active reservations, conservatively retained unknown
charges, configured limit and its provenance. Keep measured and estimated/unknown amounts distinct.
All-time means **since the stated tracking start**, not the account's entire lifetime. Historical
coverage gaps remain explicit. A scope may have multiple limits/windows without becoming multiple
independent copies of the same quota. The supervisor may choose the indexed physical layout within
these two tables, but must bind unique scope/meter/window identities and request allocation links.
No third accounting table or unvalidated free-form payload is needed.

Expose remaining through the repository read model as `limit - charged usage - active reservations`,
where charged usage includes conservative retained amounts exactly once. Make negative overage
explicit; do not hide it with a plausible zero. Missing limit or insufficient accounting information
returns a typed unknown. Limits are captured inputs, never downloaded or inferred from a provider
name. A cost can be estimated or measured; a configured zero/free allowance is not evidence of a
zero bill. Generic callers must supply a valid upper bound for an enforced budget or receive a typed
refusal; preserve the legacy path's admitted semantics without relabeling its evidence.

Use one deterministic database transaction for request creation plus all affected reservations,
and one for settlement/interruption/expiry plus aggregate changes. Exact replay is a no-op;
divergent replay or stale fencing fails. Independent connections cannot overspend a shared scope.
Persist the original reservation windows: late settlement must not refund or debit the wrong new
window. Retain enough previous-window allocation state until its requests are finalized. Resetting
a current window never clears cumulative totals. No new automatic retry or waiting scheduler.

Timeout, crash and unknown outcome release active concurrency when finalized but retain the
conservative budget charge. They do not become measured consumption. Deleting a run removes its
request details under D308 while retaining non-personal totals and tracking coverage. Finalize
outstanding accounting in that same deletion transaction; late callbacks for the deleted owner are
refused and cannot recreate a request or double count. Preserve existing tombstone guards.

### Migration and compatibility

Use the supported stopped upgrade path and strict versioned schemas; do not edit released migration
fingerprints or migrate on ordinary boot. Replace the two old physical tables without keeping a
second live accounting authority. Preserve IDs, lifecycle/config fingerprints, evidence and request
replay meaning; validate SQL/JSON mirrors, constraints and allocation relationships before commit.

Existing counters become explicitly legacy capability scopes with their current windows, budgets,
blocks and reservations preserved. Existing requests remain unattributed to any actual key. No
per-key history may be fabricated from evidence strings, current settings or the empty observed
target. Do not label retained current-window counters as historical all-time usage. Start new
cumulative tracking at migration with explicit coverage; legacy reservations settling afterwards
must retain their pre-tracking origin. Preserve old records for compatibility where required by the
versioned representation, without reporting them twice as new consumption.

Existing admission callers continue through a compatibility mapping into the new tables and legacy
scope. They retain current capability budgets, retryAt/not_before behavior and one invocation per
admitted request. This mapping is the only production wiring change. Future per-key producers use
the generic repository contract once separately implemented; absent key attribution remains visible.

## Ordered work, proof and execution

1. **S1 Admit and bind:** verify F development release, full base SHA, frozen types/schema, real legacy
   adapters, exact owned paths and independent test-resource slots. No unmerged peer inputs.
2. **S2 Generic accounting:** implement generic scope/meter reservation, settlement, expiry, rollover,
   uncertainty and read models within the accepted schemas. Preserve the existing capability path.
3. **S3 Prove the vertical slice:** complete P1–P4/P6 and the generic-specific P5 cases on F alone.
   Link B's exact historical-migration proof without claiming all of P5 from an empty fixture.
4. **S4 Development release:** focused proof, lint and affected freshness; record the committed
   candidate for final 2.6.9 validation, repair and independent review.

| Proof | Required result / negative control |
| --- | --- |
| P1 Generic storage | Two synthetic vendors, two credentials, model-specific and shared scopes, plus keyless and unknown attribution round-trip without vendor-specific schema changes. Arbitrary provider IDs do not activate an adapter. No raw key material in fixtures, DB, logs or public evidence. |
| P2 Atomicity and replay | Real independent SQLite connections race for the last allowance; only one succeeds. Inject request/aggregate write failures and prove complete rollback. Exact reserve/settle replay changes no totals; changed attribution, budget or usage under the same identity refuses before any effect. |
| P3 Windows and uncertainty | Minute/day rollover, settlement across reset, overlapping limits and expiry preserve original allocations and cumulative totals. Denial spends nothing. Unknown outcome retains its charge without remaining active forever; overage and unknown limits remain explicit. |
| P4 Retention | Archive does not add usage. Run deletion preserves cumulative consumption, removes request detail, reconciles pending reservations and remains integrity-clean. Late settlement after tombstone cannot resurrect or double count. Rollback of deletion restores both halves. |
| P5 Historical conversion | Populated historical fixtures include every lifecycle, active leases, blocked budgets, midnight boundaries and incomplete history. IDs/evidence/replay survive; no invented key or all-time history. Failure before commit, interruption after commit, exact resume, repeated no-write upgrade, verified backup/restore, fresh creation and supported old generations pass. |
| P6 Existing runtime | Composed admission, advisory exhaustion and pool tests preserve current calls, budget refusals, retry times, one remote invocation and UNKNOWN behavior. Old table readers/writers are retired; real key selection and adapter behavior remain unchanged. Existing storage diagnostics remain valid. |

## Execution ownership

Use [the combined workflow](README.md), [prerequisite releases](prerequisites.md) and
[launch registry](PROMPTS.md). One Astra/high supervisor owns this assignment; default zero
implementation workers. Shared migrations, composition and fixture work belongs to its prerequisite.
Return a committed development candidate after focused checks, lint and affected freshness; final
2.6.9 owns heavy gates, independent review, all remaining repairs and operator-assigned integration.
No per-peer independent review or automatic task dispatch. The approved P01–P06 exception below assigns local master integration and owned cleanup to P.

## Focused checks and final proof

Suggested selectors from source inspection, to verify on the actual prerequisite release:

- `npm run test -- tests/unit/provider-admission.test.ts tests/unit/provider-pool.test.ts tests/unit/advisory-provider-exhaustion.test.ts`
- `npm run test -- tests/unit/storage-upgrade.test.ts tests/unit/storage-upgrade-tombstones.test.ts tests/unit/storage-backup.test.ts tests/unit/storage-restore-drill.test.ts`
- `npm run test:architecture -- tests/unit/architecture/provider-capability-boundary.test.ts tests/unit/architecture/migration-history-immutability.test.ts tests/unit/architecture/secrets-single-source.test.ts`

Add real populated migration, concurrent connection and fault-injection tests for the proof rows;
replace retired guards with meaningful negative controls and deciding inventory evidence. Preserve
all assertions, test membership, coverage floors, isolation and timeouts. Run lint whenever tests
run. A focused pass is not complete product acceptance. The full required typecheck/coverage/
architecture/parity/build/recovery and generated gates are owned by [2.6.9](final-validation.md).
Use /ui for frontend work and deliberate parity changes; preserve the scoped product exclusions.

No live external submission, real provider/key wiring, operator database upgrade or source cleanup
is authorized here. An operator-root upgrade/cleanup is a separately assigned action after accepted
integration, verified stopped ownership, source-bound backup, supported upgrade plan/apply/doctor
and sanitized before/after identity/count evidence. This planning work changes no runtime data.

**Prerequisite resolved:** repaired F `2bb25b6efbe62ca88d64a429f01dc567a76ecfbc`; the approved P01–P06 brief below owns current launch conditions.
All earlier planning checks remain historical Git evidence, not gates for the new implementation.

## C0 execution allocation — 2.6.6.1 P

Prerequisite: **one frozen F release, identical to D/G/S base**. One Astra/high supervisor, zero implementation workers.
Use the exact `P` branch and absolute worktree in [PROMPTS.md](PROMPTS.md#binding-registry).
This allocation supersedes older shared-file/side-task ownership in this owner; product proof is retained.
Current inspected baseline is R `60b356dd119140dc972a077751ad16af934acb2e`, schema39/floor37.
Future prerequisites build the explicitly named new modules before peers launch; names do not assert readiness.

Ordered outcomes: Verify F supplied repository and real legacy adapter; implement generic atomic accounting; prove independent-connection races, replay and uncertainty; release to L.

### Exclusive changing paths

- `src/infra/sqlite/provider-accounting.ts` (new target)
- `src/core/provider-admission.ts`

### Proof and test ownership

P1–P6 remain, with unchanged conversion proof consumed from F. P owns runtime accounting and retained cumulative usage; no real provider/key wiring. F supplies snapshot-driven invocation inputs so S never edits this implementation.

- `tests/unit/provider-admission.test.ts`
- `tests/unit/provider-pool.test.ts`
- `tests/unit/advisory-provider-exhaustion.test.ts`
- `tests/unit/provider-accounting/accounting.test.ts` (new required test)

Run the owned unit files with `VITEST_MAX_WORKERS=1 npm run test -- --project unit --maxWorkers=1`
followed by their explicit paths above (exclude a performance script from Vitest). New paths must exist
and collect meaningful cases before release. Use `npm run lint`; run affected architecture guards
with `--project architecture --maxWorkers=1`, and the affected manifest/catalog/roadmap generators
before their `:check` commands. Preserve existing floors, membership, assertions and timeouts.
Desktop visual work uses `/ui`; focused rendering/accessibility proof is due here, complete parity/build
and all heavy gates remain 2.6.9. Preserve every inherited proof row; record exact tested tree and exits.

The prerequisite owns shared fixtures, registries, global unions and generated inputs; create only
owned fixture files beside the new tests. Shared architecture guard retirement is recorded by the
prerequisite with violating fixtures and guard-inventory evidence. No peer may edit another peer
or prerequisite path. A newly discovered required shared edit blocks peer release until its owning
prerequisite is amended and revalidated. Do not replace a missing baseline with an unused export.

Release committed candidate/base/tree and focused evidence to the next named consumer. No master
integration, independent review, heavy-gate waiver, sibling dispatch or live database application.
Future-base binding remains WAITING ON the actual prerequisite release, not a fabricated SHA.

Authored evidence stays in this task's existing `provider-usage.md` owner; shared indices remain read-only.


## Approved execution brief — 2026-09-09

The operator approved P01–P06 after consultation with “Explain database tables”, then verified
F's repaired release and replied “approve”. This is the complete execution owner for **2.6.6.1 P**.
It retains all product requirements and P1–P6 above. Earlier statements assigning integration
only to 2.6.9 or prohibiting every shared-file edit are superseded only by the exceptions below.
This approval implements no product code and does not mark P or Phase 2.6 complete.

### Binding and allocation

| Field | Binding |
| --- | --- |
| Supervisor | One operator-started GPT-6 Astra/high supervisor; zero implementation workers. One cohesive accounting/retention assignment. No child dispatch. |
| Inspected checkout | Clean master `0eeedcadad5ed4f686799be4dd190133372d5e2b`; schema47/floor46. F repair changed no P-owned source files or provider integrity query. |
| Source prerequisite | Exact common F resolver repair release `2bb25b6efbe62ca88d64a429f01dc567a76ecfbc`, superseding `51e4c087a0d455619ca93a3bbddc5c8fb5a24a48` and initial `7ec279750817934b7da69ce433e0e5a44fed6a58`. Require the complete resolver repair closure receipt linked below and ancestry. |
| Mode / branch / path | Create `codex/provider-usage` in a new worktree `/Users/julianhein/Projects/hr-worktree-provider-usage` from that exact prerequisite. These names are proposals until execution rechecks absence/ownership. |
| Plan availability | The planning handoff supplies the full committed plan SHA on master. Read this section and its linked controls with `git show PLAN_SHA:path`; restore only this owner from that committed plan into P's worktree before recording implementation evidence. Do not replace other shared documents with the older F versions. |
| Capacity | One unrelated auxiliary worktree, `hr-separation-accounting-final`, existed at approval. Preserve it; recheck the four-auxiliary-worktree ceiling and ownership before creating P. |
| Integration | This supervisor merges the committed focused-PASS candidate locally into clean master at `/Users/julianhein/Projects/hr-automation-rebuild`, verifies input reuse or reruns invalidated checks, and removes only P's owned worktree/ref. No push. |
| Release consumer | L consumes P's recorded immutable candidate and local integration SHA/tree together with the other actual child releases. P does not wait for or launch D/G/S; their repaired F source base and allocations remain unchanged. |
| Review / final acceptance | No independent reviewer or full gates here. Final 2.6.9 owns fresh complete read-only `sup_review` on Astra/high, full gates, remaining repairs and phase acceptance. A P completion is a merged scoped development release. |

**Production ownership:** `src/infra/sqlite/provider-accounting.ts` and
`src/core/provider-admission.ts`, plus exactly these two boundaries in
`src/infra/sqlite/authority-database.ts`: the named `provider-active-reservations-match`
entry and that entry's pre-43 handling in `inspectHistoricalAuthorityInvariants`.
The shared-file exception grants no other database, composition, DDL or global type/API edits.
Other peers retain read-only ownership of that file. A conflicting active owner must be resolved
before the shared edit; serialize only the conflicting operation, not independent peers.

**Test ownership:** `tests/unit/provider-admission.test.ts`, `tests/unit/provider-pool.test.ts`,
`tests/unit/advisory-provider-exhaustion.test.ts`, new
`tests/unit/provider-accounting/accounting.test.ts`, and fixture/support files beside that new test.
Existing F fixtures and other suites can be read/run but remain unchanged. Keep implementation
progress, evidence and delivery assessment in this file; do not create a competing plan/evidence Markdown file.

**Completion-document ownership:** serialize narrowly scoped P status/release/prompt updates in
this file, the combined README, prerequisites and PROMPTS, parent Phase 2.6 README and roadmap
source/generated site. Never overwrite sibling edits or change their allocations. Generate any
necessary manifest/catalog outputs only through their existing generators; no source catalog or
guard-inventory changes are admitted by this task. Preserve released migrations and guard semantics.

### Parallel coordination and remaining duties

The operator requested this plan/prompt amendment after updating the parallel protocol on
2026-09-09. Read and follow [Parallel coordination](/Users/julianhein/.agents/skill-library/focused-sessions/REFERENCE.md#parallel-coordination)
before any coordination. This section binds that protocol to P; it adds no coordinator, routine
check-in, reservation round, peer launch or acceptance handshake.

- **Independent assignment:** one P supervisor owns P01–P06, its isolated branch/worktree,
  focused gates, local master integration, integration verification and owned cleanup. The operator
  opens D/G/S separately. Their existence does not require messages or a group-wide resource slot.
  L already owns consuming the recorded P/D/G/S releases; 2.6.9 already owns complete review,
  full gates and final acceptance. Those existing duties need no new acceptance handshake.
- **Message necessity:** inspect committed owners, Git and primary evidence first. Default to no
  peer messages. Contact an exact verified recipient only when that owner must take a necessary
  action on an unresolved blocker, changed required input, actual write/resource conflict or duty
  transfer. Send the fact, resource/commit and requested action once. No broadcasts, availability
  surveys, acknowledgments, readiness reports, progress relays or duplicate native result delivery.
  Do not reuse planning-task IDs as future implementation recipients or infer ownership from titles.
- **Isolation and actual conflicts:** shared planning documents, generated output and Git indexes
  are shared writes. Keep independent edits and checks in P's isolated checkout; serialize only
  the actual shared-target operation under the existing isolation policy. The earlier planning-only
  D/P/G commit exchanges create no implementation queue or sibling dependency. For an evidenced
  conflict, use a verified supported acquisition mechanism; otherwise request once from the known
  owner and require a valid grant. Silence, elapsed time and clean Git alone grant no ownership.
  Release after the conflicting operation, including failure; notify only a named waiter who needs
  that release, with verified process exit or mutation completion. Do not invent locks or queues.
- **Durable state:** maintain one compact execution record here with P's actual task ID,
  branch/worktree, base/candidate/tree, owned scope, gate evidence and tested inputs, dirty state,
  pending verification and remaining-duty owner. Only when a real conflict exists, add its exact
  resource, owner, needed action, acquisition evidence and release condition. No pre-emptive peer
  roster or speculative waiter list is required.
- **Transfer and resume:** P retains its required gates, final verification, integration and cleanup
  until complete or explicitly transferred to an authorized recipient who accepts those remaining
  duties. Sending a message is not acceptance. A preassigned L/2.6.9 duty is not a new transfer.
  If an owned dependency is unresolved, continue independent work and use supported completion waits
  with cursors/backoff only while its result is needed. Use an existing authorized return/resume
  mechanism; otherwise state the operator resume point. Do not add monitoring or dispatch.
- **Finish:** after P's owned work/processes are complete, record the scoped development release
  and end the turn. Do not monitor siblings, broadcast completion or seek acceptance from L merely
  because P finished. If duties were explicitly transferred and none remain locally, end with the
  contribution status and remaining owner; keep overall completion open where appropriate.
  Done / Now / Remaining updates go to the operator, not to peers.

Product scope, P's narrow shared integrity amendment, exact F prerequisite, focused checks,
local merge/cleanup and final 2.6.9 full-gate/review timing are unchanged.

### Feasibility and required proof

Inspection is distinct from execution proof. F's retained receipt reports 961 unit, 199 affected
architecture and 67 filtered UI tests plus lint/freshness PASS. Those prove the repaired baseline,
not P's unimplemented generic behavior. Its mixed-history fixture covers a settled legacy request;
P must extend missing lifecycle/boundary cases rather than claim all historical proof from that fixture.

| Requirement / current mechanism | Permitted change and proof |
| --- | --- |
| Generic persistence | Frozen `ProviderAccountingStorage` supplies transactions, get/list usage and versioned writes; strict domain schemas and SQL support generic attribution, meter/windows and immutable request allocations. P supplies callable generic storage policy within its owned modules. Round-trip two synthetic vendors/credentials, model/shared/keyless/unattributed scopes, tokens/costs and explicit unknowns; no real provider activation. |
| Atomic admission and replay | `withAuthorityTransaction` uses BEGIN IMMEDIATE; writes have CAS and immutable request/attribution/allocation guards. Prove genuine independent-connection contention for the final allowance, complete rollback after either request or aggregate failure, exact no-op replay and divergent attribution/budget/usage refusal. Validate execution/config identity before allocating; refusals cannot invoke an adapter. |
| Windows and uncertainty | Existing schema retains per-request original window allocations and independent aggregate tracking. Implement overlapping limits without duplicate scope charging, late settlement against original windows, reset without lifetime loss, explicit overage/unknown remaining and conservative finalization of unknown outcomes. Unknown/expired outcomes release active reservations without inventing measured usage or erasing charges. |
| Legacy and generic coexistence | The current reservation invariant counts every reserved request of a capability against its legacy counter. Two independent in-memory probes confirmed a false mismatch for legacy active=0 plus one generic reservation. Filter both counter and request to legacy kind. Prove mixed valid rows with zero and nonzero legacy reservations, genuine corrupt legacy counts, and unrelated capability isolation. Generic consistency must be proven separately; excluding it from a legacy check is not validation. |
| Historical integrity | The existing pre-43 adapter rewrites table/JSON names but cannot safely remove new aliased kind filters. Use an explicit historical SQL branch for this named invariant retaining unwrapped semantics; do not weaken all queries through broad replacements. Prove actual historical invariant/backup validation with both valid and corrupt populated schema42 fixtures and wrapped43 boundary controls. Missing-table/parser acceptance alone is insufficient. |
| Retention and callbacks | Shared deletion invokes P-owned `finalizeProviderRun` inside its tombstone/authority transaction before removing requests. Its generic branch currently refuses. Complete generic conservative finalization there; prove aggregate/tracking survival, no usage added by capture/archive, deletion rollback restoring both halves, and late callbacks refusing without recreation or double accounting. Future archive storage/wiring remains L/A-owned. |
| Historical conversion and compatibility | Reuse only applicable unchanged F P5 evidence. Add provider-owned populated fixtures covering reserved/denied/settled/interrupted/expired history, active leases, blocked budgets, midnight and incomplete tracking; preserve IDs, evidence, replay and pre-tracking origin. Prove supported conversion, before/after-commit faults, exact resume/no-write repeat and source-bound backup/restore. No fabricated key or all-time history. |
| Runtime exclusion proof | Existing capability admission, advisory exhaustion and pool suites pin budget refusal, retry times, single invocation and UNKNOWN behavior. Preserve pool/adapter/secret behavior and retained configuration. Generic rows have no new dashboard/CLI producer; no visual output or wire contract is changed. No new UI, live provider or operator-root preflight is required for this synthetic storage assignment. |

### Ordered execution

1. **P01 — Bind execution.** Verify committed plan, repaired F ancestry and complete receipt;
   recheck branch/path/capacity and identify other active owners. Create the isolated checkout;
   verify source inputs against F, load this approved owner from the plan SHA, and bind evidence
   directory and effective test worker. Read the linked Parallel coordination protocol and initialize
   the local execution record; no peer check-in is required. Report Done / Now / Remaining before subsequent work.
2. **P02 — Correct integrity checks.** Reproduce mixed-kind corruption reporting through the real
   current invariant; implement only the named shared query/historical mapping exception. Add
   current/historical positive and corrupt negative controls in the P-owned test. Preserve genuine
   corruption detection. This bounded exception is approved; no separate F task is required.
3. **P03 — Implement accounting.** Complete generic reserve/settle/interrupt/expiry, scope/meter
   accounting, cumulative tracking, remaining read models, windows and replay fences on the frozen
   storage interfaces. Preserve legacy capability behavior and no real provider/key wiring.
4. **P04 — Prove safety and retention.** Complete P1–P6 at the boundaries above, including real
   connection races, denied/divergent requests with no effects, rollover plus late settlement,
   uncertainty plus expiry/deletion, deletion fault plus retry/late callback, and historical recovery.
   Each refusal test also needs a valid control reaching that same boundary. Repair in-scope failures.
5. **P05 — Focused release.** Run the assigned/affected selectors, lint and freshness below; preserve
   failed logs and record exact commands/exits, tested commit/tree, proof coverage and deferred full
   checks. Commit logical categories with exact staging paths. No failing focused check is waived.
6. **P06 — Merge and cleanup.** Verify master cleanliness/ownership and all intended candidate
   ancestry; serialize the local merge. Repair in-scope integration failures and rerun invalidated
   focused checks. Preserve candidate/evidence reachability; compare all execution inputs before
   reuse. Update P status to a merged development release, preserve proof outside its worktree,
   stop only owned processes and remove only the owned auxiliary worktree and merged branch.
   Verify registration/path/ref absence and clean master, record actual cleanup and L's release,
   and end the turn without monitoring siblings or broadcasting completion. No automatic successor.
   Keep review/full gates explicitly deferred to 2.6.9.

### Focused gate schedule and resource recipe

Use one effective file worker and at most four across active tasks. Independent connection races
must still be real; file-worker limits do not replace concurrency proof. Recreate the F resource-only
adapter at `/Users/julianhein/Projects/hr-provider-usage-evidence-20260909/vitest-one.config.mts`
(after checking that evidence path is free or owned; use a unique suffix if occupied):

```typescript
import baseline from "/Users/julianhein/Projects/hr-worktree-provider-usage/vitest.config.ts";
export default { ...baseline, test: { ...baseline.test, maxWorkers: 1,
  projects: baseline.test!.projects!.map((project) => {
    if (typeof project !== "object") throw new Error("unexpected project configuration");
    return { ...project, test: { ...project.test, maxWorkers: 1 } };
  }),
} };
```

Verify resolved configuration/observed workers and compare with the authoritative config: only
root/project maxWorkers may differ. Preserve includes/excludes, assertions, isolation, timeouts,
reporters and coverage floors. Store the adapter, comparison and exact actual path with evidence.
Run commands from the P worktree; substitute the recorded path only if the evidence directory changed.

```sh
VITEST_MAX_WORKERS=1 npm run test -- --config /Users/julianhein/Projects/hr-provider-usage-evidence-20260909/vitest-one.config.mts --project unit --maxWorkers=1 tests/unit/provider-admission.test.ts tests/unit/provider-pool.test.ts tests/unit/advisory-provider-exhaustion.test.ts tests/unit/provider-accounting/accounting.test.ts tests/unit/database-foundation/transaction-contracts.test.ts tests/unit/database-foundation/four-way-independence.test.ts tests/unit/database-foundation/mixed-history.test.ts tests/unit/storage-upgrade.test.ts tests/unit/storage-upgrade-tombstones.test.ts tests/unit/storage-backup.test.ts tests/unit/storage-restore-drill.test.ts
VITEST_MAX_WORKERS=1 npm run test -- --config /Users/julianhein/Projects/hr-provider-usage-evidence-20260909/vitest-one.config.mts --project architecture --maxWorkers=1 tests/unit/architecture/provider-capability-boundary.test.ts tests/unit/architecture/migration-history-immutability.test.ts tests/unit/architecture/storage-recovery.test.ts tests/unit/architecture/strict-boundary-schemas.test.ts tests/unit/architecture/redaction-surface-scan.test.ts tests/unit/architecture/secrets-single-source.test.ts tests/unit/architecture/roadmap-doc-binding.test.ts
npm run lint
npm run build:manifest
npm run build:manifest:check
npm run stores:catalog
npm run stores:catalog:check
npm run roadmap
npm run roadmap:check
git diff --check
```

During iteration, run the changed boundary and neighboring refusal combinations plus lint. Before
each implementation candidate release, run the complete focused sets above and affected freshness;
new tests must exist and collect meaningful cases. Generation precedes its check and shared-target
operations are serialized. At integration, rerun invalidated tests/lint/generation; otherwise record
compared code/test/config/dependency inputs and exact accepted reuse under D191. Documentation-only
recording checks local links, instruction-pair equality and complete chains below 32,768 bytes,
roadmap generation/freshness/bindings and whitespace; reuse unaffected implementation evidence.

No full typecheck, coverage, whole architecture suite, broad parity/build/performance or independent
review is due here; all remain 2.6.9. Do not describe deferred proof as PASS. Browser/UI gates are
excluded because admission/pool behavior and presentation contracts remain unchanged, not merely
because P edits no UI file. Reopen that exclusion if implementation would change those outputs.

### Stop conditions and current state

Fix routine defects within this ownership. Return for amendment only if a new required DDL/type/API,
shared composition/sibling change, real provider wiring, visual behavior or other material scope
change is discovered. No operator database mutation, credential/configuration setup, live HR
submission, UNKNOWN-submit retry, push or deletion of another task's resources is authorized.
The specifically approved integrity hunks and merge/cleanup require no renewed permission.

Planning state: operator-approved, implementation unstarted; prerequisite available and plan
persistence/validation owned by the planning session. The outgoing handoff supplies the verified
plan commit and readiness after documentation gates. No implementation PASS is asserted here.


### Planning validation — 2026-09-09

Approval persistence used an isolated documentation snapshot to exclude concurrent D/G edits.
The unchanged roadmap generator/freshness and all 24 roadmap-binding tests passed; repository
lint passed with zero warnings. Local-link, nine instruction-pair, 17,333-byte maximum project
chain and whitespace checks passed. No runtime, tests, configuration, dependencies or released
migrations changed. Full gates and independent review remain deferred to 2.6.9. Exact candidate
verification and logs are retained in [planning evidence](/Users/julianhein/Projects/hr-provider-plan-evidence-20260909-81pg5uis); the handoff supplies the committed
plan SHA only after staged-content, prerequisite and reachability verification. No implementation
checkout was created and no product completion is claimed.


### Resolved launch prerequisite — F resolver repair

The launch hold recorded during persistence is resolved. The common integrated F source is
`2bb25b6efbe62ca88d64a429f01dc567a76ecfbc`, with final release record
`e06a1c82e9983deb281c5400671f6ce330214000` and tested candidate
`f917ffe7b2308b4746e2aba16719a68cbafdb56c`. The
[resolver repair cleanup receipt](/Users/julianhein/Projects/hr-database-foundation-resolver-evidence-20260909/closure.json)
is complete; F's registered worktree, physical path and branch are absent. P's approved plan commit
`c6b481773c799f9ef801a5fbacd083fe2a4b01d9` is preserved in master ancestry.

The follow-up changes settings resolver application/composition and related fixtures only. P's two
production modules, reservation-integrity query, historical mapping, frozen provider schemas/API
and migrations are unchanged from the previously inspected F prerequisite. The mixed-kind defect
and the approved P-only shared-file exception therefore remain as planned. No scope, ownership,
gate, review, merge or cleanup decision is reopened. Preserve the new shared settings fixtures.

F's source-bound focused evidence reports 1195 unit cases, 199 affected guards and 67 filtered UI
checks plus lint/freshness PASS. All non-document inputs of its final record match its tested
candidate; the planning rebind verifies that equality and reuses F's lint under D191. It reruns
roadmap generation/freshness, all 24 binding tests, links, instruction-pair/chain and whitespace
checks for the new documentation. These are planning checks, not P implementation acceptance.

**Launch binding:** create `codex/provider-usage` at
`/Users/julianhein/Projects/hr-worktree-provider-usage` from exactly
`2bb25b6efbe62ca88d64a429f01dc567a76ecfbc`. Before editing, read this complete owner from the
final verified plan commit supplied by the planner, then restore only this owner from that commit
into P's worktree. Recheck prerequisite ancestry, the complete receipt, available branch/path and
four-worktree capacity; preserve the unrelated separation worktree. The planner returns READY
only after this factual rebind is committed and read back. No implementation or child launch
occurs in planning; full gates and independent review remain 2.6.9.

## P execution record — 2026-09-09

P01 complete. One supervisor, zero workers. Approved plan
`9d8b7b8168d77e29ffe75fea23b337326b97b1a0`; checkout
`/Users/julianhein/Projects/hr-worktree-provider-usage`, branch `codex/provider-usage`,
base `2bb25b6efbe62ca88d64a429f01dc567a76ecfbc`. The complete F closure receipt and
ancestry were verified, including absence of F's path/registration/ref. P occupies the fourth
auxiliary slot; unrelated separation, D and G worktrees are preserved. Only this owner was
restored from the approved plan. Production inputs match F before implementation.

Evidence root: `/Users/julianhein/Projects/hr-provider-usage-evidence-20260909`.
The one-file-worker adapter imports the real configuration; `config-comparison.log` proves
only root/project maxWorkers differ. Dependency installation is reused through an owned
node_modules symlink; no secrets or operator database were accessed. No resource collision
or required peer action was found; no peer messages were sent.

P01–P04 are implemented and focused boundary proof is passing. P05 complete selected gates
and P06 local integration/owned cleanup remain open.
Full gates and independent review belong to 2.6.9. L consumes the recorded release; no launch
or monitoring duty is assigned to P.

### Implementation and proof allocation

`createGenericProviderAccounting(storage)` in `src/infra/sqlite/provider-accounting.ts` supplies
reserve, finish (settled/interrupted/lease-expired) and usage reads on F's frozen transaction port.
The real request-write boundary checks execution and retained configuration before aggregate writes.
The admission fingerprint binds the complete parsed admission input, including all supplied budgets,
windows, attribution and original request fingerprint, so even denied replay cannot change a budget.
Window identities retain their original bounds and policy. A new window uses a new identity; changing
an existing policy under the same identity refuses. Scope/meter duplicates and inconsistent meter
bounds refuse. No production provider, credential issuer, adapter, registry or pool behavior changes.
`src/core/provider-admission.ts` required no change: existing callers remain capability-scoped.

Cumulative quantities count finalized usage once per distinct scope/meter, regardless of overlapping
windows. Active reservations remain separate in windows. A mixed measured/estimated total is labeled
estimated; any unknown component makes the cumulative total a conservative unknown upper bound.
Request records retain the supplied meter evidence. Unknown settlement retains at least the original
upper bound, overage stays negative, missing limits remain typed unknown, and absent reservation
bounds produce a typed denial. This does not assert provider-verified or account-lifetime totals.
`inspectGenericProviderAccounting` separately checks generic allocation/window and active-amount
consistency; legacy reservation checks deliberately cover legacy rows only.

| Proof | Execution evidence |
| --- | --- |
| P1 | Two synthetic vendors and credential generations, keyless and unattributed requests; provider/model, credential, application and shared scopes; input/output token and cost evidence; unknown limits. No actual provider producer is added. |
| P2 | Two real forked processes open independent SQLite connections and attempt the final allowance before the first commits: exactly one reserved and one denied. Request and aggregate INSERT/UPDATE faults roll back both halves and authority generation; a second-scope failure also rolls back the first scope. Exact reserve/finalize replay is a no-op; divergent attribution, budget, usage and fencing refuse. |
| P3 | Overlapping minute/day limits, midnight rollover and late settlement preserve original allocations; cumulative usage is charged once. Explicit overage, missing bounds/limits, uncertain interruption, lease expiry and late refusal are covered with valid controls. |
| P4 | Real archive insert/capture changes no provider consumption; archive-origin and ordinary queue deletion both use the accounting boundary. Deletion fault restores request/usage/tombstone/generation; successful deletion retains consumed and uncertain totals, tracking and no active reservation. Late callbacks cannot recreate requests. Future archive transfer wiring remains L/A-owned. |
| P5 | Populated schema42 has reserved, denied, settled, interrupted and expired records, an active lease, a blocked budget, midnight boundaries and historical coverage gaps. Actual backup inspection and stopped upgrade prove precommit rollback, postcommit exact resume, repeated no-write upgrade, preserved IDs/evidence/replay, pre-tracking settlement and exact source-bound backup restore. Schema42 and wrapped43 valid/corrupt reservation controls exercise the real historical invariant and backup validator. Assigned unchanged F mixed-history and storage suites additionally cover supported generations and fresh roots. |
| P6 | The complete selected release run includes existing admission, pool, advisory exhaustion and four-way composed baseline suites. These pin budget refusal, retry, single invocation and UNKNOWN behavior without key wiring. No UI, browser, public wire or live target change is introduced. |

P02's defect was reproduced in `p02-reproduction.log`, then all four current/historical controls
passed in `p02-corrected.log`; repository lint passed in `p02-lint.log`. Fourteen vertical cases
passed in `p04-archive-history.log`, with scoped lint PASS in `p04-scoped-lint.log`; the final
release adds paired malformed-input and second-scope rollback controls. Initial complete runs passed 215 unit cases and 183 affected architecture cases, plus lint.
An additional check of the four owned TypeScript files exposed four diagnostics, now repaired
and passing in `owned-types-corrected.log`; it is not a full typecheck. Exact corrected final gate
inputs, commands and exits are recorded in the external `release-*.json` receipts and matching logs.
The initial `candidate-*.json` receipts and all failed logs remain retained.
Generated manifest/catalog/roadmap checks are recorded by the same receipt runner.

### Delivery assessment

The approved narrow integrity exception was sufficient; no product scope amendment, new global API,
DDL, composition edit, delegation or ownership transfer was needed. Local implementation/proof
repairs addressed an unsupported refined-Zod pick, an initial fixture exceeding its configured zero
cost budget, historical metadata columns, an invalid historical reason enum, redundant lint
assertions, closing an open SQLite handle before restoring its main file, and four scoped TypeScript
diagnostics (branded versions, archive-content parsing and IPC narrowing). The IPC helper then
needed validation moved outside `finally` and an explicit method binding to satisfy strict lint. Failed logs are
retained beside passing replacements. These are implementation/proof setup defects, not evidence of
a planning omission. Reading the exact runtime schemas and closing every SQLite handle before
fixture restore, plus checking owned-file types/lint before the complete release set, would have
prevented the avoidable retries. There has been no independent review;
2.6.9 retains that duty and all full gates. No timing savings or broader acceptance is claimed.

### P05 committed focused release

Implementation candidate: `594490f8e0dc78c1f7c0efd5319057fde30119c9`; tree `9c10ae3c6c6e721a9829779d7822b513b6c40412`.
Source prerequisite remains exact F `2bb25b6efbe62ca88d64a429f01dc567a76ecfbc`.
The five implementation/test paths are committed; this record adds no runtime input.

| Gate | Result and retained receipt |
| --- | --- |
| Assigned unit selectors | 11 files / 215 cases PASS (`release-unit.json`). After the IPC-only test-helper correction, the 16-case provider file passed again (`accepted-provider-unit.json`); 199 unchanged cases are reused. |
| Assigned architecture selectors | 7 files / 183 cases PASS (`release-architecture.json`). No changed production/guard input after that run; only the isolated race-process helper and evidence prose changed. |
| Repository lint | PASS, zero warnings (`accepted-lint.json`). |
| Owned TypeScript diagnostics | Four owned files, zero diagnostics (`accepted-owned-types.json`); full typecheck is deferred. |
| Freshness | Manifest, catalog and roadmap generation/check PASS (`final-*-generate.json` / `final-*-check.json`). No generated runtime delta. |
| Documentation | Local links, nine instruction pairs, 17,333-byte maximum chain and whitespace PASS (`final-doc-check.log`). |

`release-reuse.json` records the exact comparison; accepted receipts retain every tested file hash,
command, cwd, source HEAD and exit. `observed-workers.json` confirms one effective file worker.
P01–P05 are complete. P06 local merge, integration verification and owned cleanup remain open.
This is a scoped development release, without independent review or full gates; those remain 2.6.9.
