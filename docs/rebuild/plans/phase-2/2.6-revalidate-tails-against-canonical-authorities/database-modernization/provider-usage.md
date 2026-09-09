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
No per-peer review, master merge, provider-owned integration or automatic task dispatch remains.

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

**WAITING ON:** C0's exact execution brief and the assignment's actual prerequisite release.
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
