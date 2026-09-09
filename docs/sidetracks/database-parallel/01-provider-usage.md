# Provider requests and usage: storage foundation

## Archive-report amendment — 2026-09-08

This plan retains sole ownership of provider request/usage accounting. Archive transfer removes
run-owned request rows only after outstanding reservations are settled or otherwise accounted for
conservatively; it never refunds consumed usage or erases aggregate/key accounting. Any provider
information included in the saved run report is captured before cleanup. Add focused proof of
archive cleanup versus ordinary deletion, late callbacks, uncertainty and unchanged consumption.
The archive owner calls the existing accounting boundary; do not implement archive storage here.

Archive design owner: [independent archive reports](../database-remaining/README.md#approved-group-3-independent-archive-reports-and-no-relaunch).
This is a planning amendment. Preserve existing in-flight gate schedules, candidate evidence and
accepted work; it does not launch implementation or reschedule reviews. New launch readiness awaits
the complete revised allocation and verified prompts.

## Assignment and approval

**Product owner: `side/provider-usage`. Parallel peer P in the [parallel execution plan](README.md).**
Implementation is **WAITING ON the accepted `side/database-foundation` release**. The operator's
2026-09-08 amendment moves shared schema, migration and existing-runtime adapters into that
prerequisite. This peer owns generic accounting behavior and retains the provider-neutral restriction.
The four running worker, command, operation and timeline plans remain unchanged.

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

The one [prerequisite task](00-prerequisites.md) must publish its verified B release before launch.
Use that exact accepted release base, also used by both peers. Record this peer's detailed evidence
only in `01-provider-usage-evidence.md` in this folder; do not share an `implementation.md` or edit another peer's plan.

## Authorities and ownership

- [Document routing](../../README.md), [root instructions](../../../AGENTS.md),
  [roadmap governance](../../roadmap/roadmap.md), and
  [operating reference](../../../.agents/skill-library/repository-work/REFERENCE.md).
- [Execution and sessions: provider storage foundation](../../rebuild/reference/execution-and-sessions.md#provider-storage-foundation)
  owns the pending amendment to D112's storage and accounting contract.
- [Clock/config/secrets](../../rebuild/reference/clock-config-secrets.md), D321/D322/D332/D343,
  owns immutable configuration, secret boundaries and upgrade/backup admission.
- [Dashboard surfaces](../../rebuild/reference/dashboard-surfaces.md), D308, and
  [operator trust](../../rebuild/reference/operator-trust.md) own deletion and truthful evidence.
- [Guards and tests](../../rebuild/reference/guards-and-tests.md), §3.14 D191, owns gates.
- The [parallel execution plan](README.md) owns the completed prerequisites: timeline T2, run completion,
  then shared database foundation B. B owns migration, integrity and shared deletion composition.
  This peer consumes that accepted base and must not reactivate retired tables.
- [Worker names](../worker-names/README.md), [command groups](../command-groups/README.md) and
  [operation names](../operation-names/README.md) keep their existing scope and order.

Product scope includes the schemas and behavior below, but execution ownership is split explicitly.
B owns physical schema/IDs/global repository types, migrations, upgrade/recovery/integrity, shared
retention hooks and minimal legacy adapters. P owns only `src/infra/sqlite/provider-accounting.ts`,
`src/core/provider-admission.ts`, the exclusive provider tests and this plan/evidence as bound by B.
No migration, global type, composition, catalog-input or sibling-file edits in P. The [parallel execution plan](README.md)
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

1. **S1 Admit and bind:** verify accepted B release, full base SHA, frozen types/schema, real legacy
   adapters, exact owned paths and independent test-resource slots. No unmerged peer inputs.
2. **S2 Generic accounting:** implement generic scope/meter reservation, settlement, expiry, rollover,
   uncertainty and read models within the accepted schemas. Preserve the existing capability path.
3. **S3 Prove the vertical slice:** complete P1–P4/P6 and the generic-specific P5 cases on B alone.
   Link B's exact historical-migration proof without claiming all of P5 from an empty fixture.
4. **S4 Gate and review:** complete required gates, freeze candidate, obtain fresh independent review,
   fix/re-review and return a compact candidate handoff. As the designated peer integration owner,
   resume only for the operator's concrete integration assignment; do not idle watching siblings.

| Proof | Required result / negative control |
| --- | --- |
| P1 Generic storage | Two synthetic vendors, two credentials, model-specific and shared scopes, plus keyless and unknown attribution round-trip without vendor-specific schema changes. Arbitrary provider IDs do not activate an adapter. No raw key material in fixtures, DB, logs or public evidence. |
| P2 Atomicity and replay | Real independent SQLite connections race for the last allowance; only one succeeds. Inject request/aggregate write failures and prove complete rollback. Exact reserve/settle replay changes no totals; changed attribution, budget or usage under the same identity refuses before any effect. |
| P3 Windows and uncertainty | Minute/day rollover, settlement across reset, overlapping limits and expiry preserve original allocations and cumulative totals. Denial spends nothing. Unknown outcome retains its charge without remaining active forever; overage and unknown limits remain explicit. |
| P4 Retention | Archive does not add usage. Run deletion preserves cumulative consumption, removes request detail, reconciles pending reservations and remains integrity-clean. Late settlement after tombstone cannot resurrect or double count. Rollback of deletion restores both halves. |
| P5 Historical conversion | Populated historical fixtures include every lifecycle, active leases, blocked budgets, midnight boundaries and incomplete history. IDs/evidence/replay survive; no invented key or all-time history. Failure before commit, interruption after commit, exact resume, repeated no-write upgrade, verified backup/restore, fresh creation and supported old generations pass. |
| P6 Existing runtime | Composed admission, advisory exhaustion and pool tests preserve current calls, budget refusals, retry times, one remote invocation and UNKNOWN behavior. Old table readers/writers are retired; real key selection and adapter behavior remain unchanged. Existing storage diagnostics remain valid. |

One Astra/high supervisor implements this independent peer locally with zero implementation workers.
One fresh read-only `sup_review` on Astra/high reviews the complete candidate, P1–P6 allocation,
unchanged-runtime proof and frozen-schema boundary. It receives pinned base/head/tree, full diff,
plan and gate evidence, never the author's working conversation; it does not implement or delegate.

| Assignment | Branch and checkout | Base and integration condition |
| --- | --- | --- |
| `side/provider-usage` | Create `codex/provider-usage` at `/Users/julianhein/Projects/hr-worktree-provider-usage`; verify availability. | Exact accepted B release SHA, also used by D and G. Record it before edits; no dependency on either peer. |

The [parallel execution plan](README.md) names this implementing supervisor the **one peer-batch integration owner**,
with an actual task ID recorded at launch. This role does not authorize an automatic merge. Return
reviewed candidates for operator-chosen integration; accept exact handoffs and resume for assigned
integration. The shared plan owns serialized target operations, combined gates, conflict review and
safe owned cleanup. No peer has to wait for P's feature implementation to test or be reviewed.

B supplies final schema and adapters plus provider P1/P5/P6 foundation proof. P supplies generic
P1–P4/P6 and changed-input regression proof; no requirement is waived. Shared contract/index status
changes belong to this task only during the assigned integration stage, not concurrent feature edits.

## Gates and application boundaries

Focused iterations use existing selectors and new synthetic foundation tests:

- `npm run test -- tests/unit/provider-admission.test.ts tests/unit/provider-pool.test.ts tests/unit/advisory-provider-exhaustion.test.ts`
- `npm run test -- tests/unit/storage-upgrade.test.ts tests/unit/storage-upgrade-tombstones.test.ts tests/unit/storage-backup.test.ts tests/unit/storage-restore-drill.test.ts`
- `npm run test:architecture -- tests/unit/architecture/provider-capability-boundary.test.ts tests/unit/architecture/migration-history-immutability.test.ts tests/unit/architecture/secrets-single-source.test.ts`

Adapt selectors only to accepted predecessor renames, record the mapping, and preserve meaningful
negative controls. Run lint whenever tests run. Focused passes do not replace full gates.

Each implementation candidate/commit and materially changed integration requires `npm run typecheck`,
`npm run lint`, `npm run test:coverage`, applicable generated checks and `git diff --check`. Use at
most four effective file workers. Keep coverage free of this task's compiler/linter contention;
serialize shared coverage/generation outputs and coordinate evidenced host conflicts without killing
peer processes. Independent typecheck/lint/freshness may overlap within verified capacity. Record
exact SHA/tree, commands, exits, logs, worker settings and P1–P6 evidence. Changed relevant inputs,
failures or unresolved proof require reruns; unchanged recording-only work follows D191.

Run `npm run stores:catalog` / `npm run stores:catalog:check` and manifest generation/check when
affected; never hand-edit generated output. Run `npm run roadmap:check` for owner changes and update
guard inventory if guard membership changes. Existing UI behavior is outside the feature scope,
but altered served shapes require their transitive tests. If an unavoidable dashboard adaptation is
needed, apply `/ui`, `npm run web:build` and full `npm run test:parity`; a new display remains excluded.

No live provider call is necessary: generic and compatibility proofs use synthetic adapters and
populated isolated databases. Applying the upgrade to the operator's database requires a separately
assigned action after accepted integration: recheck executable/schema/stopped locks and backup,
use the supported `storage upgrade --plan --json` then upgrade/doctor commands, and verify sanitized
before/after counts, identities and totals. This plan does not authorize that application.

## Progress and launch status

- Original product scope remains approved. On 2026-09-08 the operator explicitly approved revising
  the remaining plans for parallel execution, including their ownership, prerequisites and gates.
- Earlier inspection/check records are historical planning evidence. This amendment's validation
  is recorded in the [parallel execution plan](README.md); no product tests are claimed from planning.
- B-owned storage prerequisites and this peer's S1–S4/P1–P6 proof allocation: **not started**. Required product proof, gates, independent review, accepted integration
  and cleanup remain unfinished until linked to exact evidence.
- Launch: **WAITING ON accepted B release and its recorded independence/resource evidence**. Verify the committed plan revision, base, branch/path ownership
  and capacity. Do not substitute a planning commit or unmerged sibling for the prerequisite.

The operator opens `/supervise side/provider-usage` using this absolute plan path and the approved plan SHA.
This is an approved side-work assignment. This side plan is the task owner wherever `/supervise`
refers to a task/phase section. Record progress, review, gate evidence and completion here; do not
create a phase number or mark roadmap tasks complete. Preserve repository contracts, Astra/high,
fresh read-only `sup_review`, all required gates and the linked integration/cleanup conditions.
Send Done / Now / Remaining at start/resume and after each verified step. No automatic task launch,
push or application to the operator database.
