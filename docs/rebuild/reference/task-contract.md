# 01 — The Task Contract & Per-System Task Stores

Status: **Binding design with the Phase 1b domain foundation implemented 2026-07-31 —
2026-07-22 whole-plan/legacy-code corrections integrated;
amended 2026-07-26 (Round 8, §2.7 — the three-tier authoring floor + scaffold generators, D79f),
2026-07-31 (Round 10 — isolated copy/port with legacy preservation, D88/D90), 2026-07-31
(Round 11 — standalone rebuild repo, D93: the rebuild lives in its own `hr-automation-rebuild`
repo at plain `src/`, so isolation is physical and the same-tree guards it required are retired),
2026-08-12 (Round 48, §2.8 — the rich-extraction convention, one task per page visit, D194), and
2026-08-12 (Round 49, §2.10 — the first store CUSTOMIZED under §2.8, D197).**
Conforms to `reference/charter.md` and the binding reconciliation memo `reference/decisions.md`. The
abandoned Step-0 spike is evidence only and has been deleted; all three effect overloads must be
re-proved.

## Ownership (D1 — this doc owns / this doc references)

| This doc **owns** (siblings reference, never redefine) |
|---|
| The task contract and **contract/impl split** (`defineTaskContract` + `defineTask`), system/workflow namespace grammar + closed `SystemId` (D2/D3/D42) |
| Error taxonomy (`TaskError`, declared `errorCodes`) |
| Effect classes + dry-run mechanics (D6/D7), `freshness` + provenance contract fields (D8/D34), and the content-addressed read-artifact boundary (D45) |
| Strict runtime-schema rules, branded domain scalar/id policy, absence semantics, and the task-side subject-binding declaration (D46/D47) |
| The **read-extraction width** convention — one task per page visit, one fixed strict output, consumers project downstream (§2.8, D194), plus the as-built rules the first store BUILT (§2.9, D196) and the first store CUSTOMIZED (§2.10, D197) under it settled |
| Retry policy |
| Decoration (`decorateTask`, hook semantics, error-propagation rule) |
| Task stores—browser, service, and pure workflow mini-stores (D4/D42), session providers + the single login signature, shared leaf-code homes (`stores/common/`) |
| The task **boundary** statement — tasks are bounded; what is NOT a task (D5's task side) |

| This doc **references** (owner) |
|---|
| Workflow builder API (the single API), descriptor shape, RunEnvelope, run-state machine incl. **gates/parks**, checkpoint/resume + the freshness enforcement walk → **ref workflow-model** |
| Span/event wire schema, notes stream, completion (fan-out/approval) union, storage + SSE → **ref dashboard-surfaces** |
| `WriteSafety<In, Out, Proof>` shape attached to `CommitTaskContract` (typed proof/verify + idempotency probe + key, D22/D31) → **ref write-safety** |
| Canonical `ElementId`/`PageStateId`/`ObservationId`, typed `SystemDriver`, scenarios, diagnostics, and knowledge records → **ref operator-trust** |

Grounding (read, not imagined) — every path in this block is a **legacy-repo** path
(`hr-automation`); unqualified `src/` inside the design fences below is the **rebuild repo's** `src/`:
`src/core/kernel/types.ts` (WorkflowConfig/Ctx/SystemConfig),
`src/workflows/person-lookup/workflow.ts` (the `dataString()` untyped-blob hacks, screenshot
sprinkling, `ctx.data.crmMatch as string`), `src/workflows/person-lookup/lookup.ts` +
`src/systems/ucpath/person-org-summary.ts` (the real search shapes the worked example wraps),
`src/workflows/oath-signature/workflow.ts:240-300` (the deferAuth + `loginToUCPath` + `if (!ok)
throw` boilerplate), `src/infra/auth/duo-login-flows.ts` (the well-factored login table — the shape
to imitate), `src/systems/ucpath/selectors.ts` (registry pattern + `// verified` stamps),
`src/systems/onbase/LESSONS.md` (single-app-session-per-identity constraint),
`src/workflows/ocr/orchestrator.ts:1562` (`operationTraceCode` — the cautionary stringly
re-encoding switch).

---

## Phase 1b as-built domain foundation (2026-07-31)

Work item 1b implements the task contract's shared leaf vocabulary, not the task factory/store work
scheduled for 1d. The rebuild now has strict branded schemas for core ids and scalars, canonical
JSON, explicit absence/uncertainty, and structured boundary failures. Semantic UI observations use
stable dotted `ObservationId` values owned by ref operator-trust; dynamic receipt/evidence rows use the separate
UUID-backed `EvidenceEntryId`, so a row occurrence can never masquerade as an observation recipe.
`TraceId` accepts local `HHMMSS` hours only from `00` through `23`. Unit and strict-boundary tests
pin the neighboring invalid shapes, recursively reject unknown object keys, and keep exported
boundary types schema-derived. Task effects, contracts, stores, and subject-binding execution remain
future 1d work and are not claimed complete here.

## Phase 1d ratified seam decisions (2026-08-01)

Phase 1d implements one task/store/session vocabulary and imports the closed identities already
owned by `src/domain/ids.ts`; it does not create a second type universe.

- **D96 — one `SessionNeed`.** Every browser task uses
  `{system, access:"read"|"transaction", session:"reuse-worker"|"fresh", exclusive?:true,
  acceptDownloads?:true}`. A read contract requires `access:"read"`; prepare and commit require
  `access:"transaction"`. Store/factory validation rejects an effect/access mismatch, a session
  system that differs from the store, or `exclusive:true` anywhere except OnBase. OnBase is the
  only identity-exclusive session-provider declaration.
- **D97 — artifact identity and content identity remain separate.** Public artifact references use
  the existing UUID-backed `ArtifactId`; SHA-256 is the immutable content identity and private
  content-addressed storage key. Byte-identical puts return the same reference, but no public
  contract exposes a filesystem path.
- **D100 — provider scope stops at the seam.** Phase 1d lands capability/client/adapter interfaces
  and deterministic fakes. Admission, rate/concurrency/cost budgets belong to 1f; production
  provider pools and consumers belong to 2h. A 1d declaration must not pretend either later layer
  is operational.
- **D101 — reuse closed ids.** `BrowserSystemId`, `ProviderCapabilityId`, `TaskId`, and UI semantic
  ids are imported/re-exported from their existing domain owners. Contract/store modules never
  redeclare their unions.

### Phase 1d as-built — sealed task-contract core (2026-08-01)

`src/domain/contracts/` now owns one bundle-safe `defineTaskContract` factory with distinct read,
prepare, and commit overloads. It validates the existing `TaskId` namespace, verb/effect agreement,
recursively strict input/output/proof schemas (including arrays, unions, lazy nodes, and wrappers),
canonical-JSON examples, literal unique error codes, browser-only subject observations, typed
same-store read-task probe/verifier references, and service-only provider declarations. `any`,
`unknown`, open nested objects, and decision-bearing records/collections fail the recursive audit.
The runtime definition parser is an exact effect-discriminated union too: raw JavaScript callers
cannot add outer keys, submit empty error-code lists, use a durable prepare checkpoint, or attach
read-only artifact metadata to a write contract.
Read contracts require freshness plus provenance and resolve every field override against actual
own schema fields; subject input paths do the same and identity/match pairs must agree. Prepare
contracts are in-memory-only. Commit contracts require a closed parsed `writeSafety` union,
canonical proof↔output↔present-probe agreement, permanent idempotency recovery policy, and
post-prepare subject timing. An unscoped commit must name a closed reviewed
`UnscopedCommitReasonId`; free-text `subject.none` remains available only to non-commit contracts.
Browser/service/full tiers require scenarios; only a pure
`workflow:<id>` light read may start empty. A store registry resolves all scenario/probe/verifier
refs against its corpus; the definition-time read reference also rejects commit-verb ids.

The factory alone stamps `__sealed`, replaces `example` with its parsed canonical output, and
deep-copies/freezes declarative metadata, including reviewed policy arrays and their future entry
objects. Zod schemas and proof/key functions retain their original
unfrozen identities. `unverifiableByPage` requires `policy:"always-park"`, an
operator-attestation proof arm, and an exact reviewed-policy entry (the seed policy is empty).
Dynamic idempotency keys are deliberately validated only when execution has real parsed input;
definition sealing makes no fake claim about an input-free key proof.

`src/base/task.ts` exposes narrow pure/read/prepare/commit contexts. Only the commit context contains
the opaque `MutationCapability`; none of these seams mints it. `TaskError` pins the
`[task-id] code: message` form, defaults unknown failures to non-transient `unhandled`, and keeps
declared error codes literal through `taskFailer(contract)` inference. Browser contexts carry the
store's concrete semantic driver type, not a `{system}` projection. A factory-owned invariant
`DriverDeclaration<Driver>` binds that type to `defineTask`; the store factory requires the same
declaration and re-checks its identity plus exact driver/store system matching at runtime. This
contract-core slice deliberately contained no task impl, store, session, artifact writer, provider
adapter, or runtime mutation token; the bounded 1d seam below now owns the declarations while 1f
still owns execution and mutation-token minting.

### Phase 1d as-built — bounded task/store/session/provider/artifact seam (2026-08-01)

`src/base/task.ts` now binds sealed contracts to effect-specific implementations through
`defineTask`. Literal-preserving `taskId(...)` values keep browser/service/workflow namespaces in
the type system: reads request read access, prepare/commit request transaction access, headless
tasks are sessionless, provider clients are narrowed to the contract's exact declared capability
keys, and a browser implementation receives the concrete driver operations declared by its store.
Browser `defineTask(driver, contract, impl)` and `defineBrowserStore(..., driver, ..., tasks)` must
share the exact factory-owned driver declaration; this prevents both type-erasing a semantic driver
to `{system}` and registering a task against a different same-system driver API. The runtime
backstop independently checks declaration identity, effect/access/system agreement, OnBase-only
exclusivity, download↔content-addressed-read agreement, read-only retry policy, and headless
restrictions before freezing the task.

`src/base/store.ts` declares browser, service, and workflow stores. The registry rejects duplicate
namespaces/task ids, prefix/effect drift, unpaired corpus entries, and missing implementations, and
calls `assertTaskContractReferences` for every registered task so scenario/probe/verifier
resolution cannot be skipped at composition. All nine browser systems now have explicit store and
session declarations. Their login callbacks fail loud as intentionally unwired Phase-1d seams;
they are not operational auth implementations. UCPath records the existing semantic driver as
ready, the other eight driver declarations remain unwired, and OnBase alone requires
`exclusive:true`. No declaration imports or exports a raw Playwright page.

The public artifact seam is strict `{id,sha256,bytes,mediaType}` and never exposes a root or backing
path. The real writer accepts only `.tracker-rebuild/artifacts` beneath a non-symlinked absolute
workspace (the supplied workspace path itself is checked with `lstat`), persists metadata+payload
as one content-addressed object through temp write → file fsync → atomic no-replace hard-link
publication → temp unlink → directory fsync, returns one stable UUID ref for byte-identical content
across writer instances, rejects conflicting media metadata, and reads only exact
id+digest+metadata matches. Fault injection proves cleanup and recovery at every write boundary; a
real child-process `SIGKILL` before publication proves retry recovery too. The protocol has no
digest lock to strand: concurrent same-digest writers race at atomic publication, and every loser
validates the winner before returning its exact ref. A crash may leave an unpublished temp whose
name records its owner PID; a retry removes it only after the OS reports that PID absent, never
because an age threshold elapsed. The provider seam uses strict capability-tagged,
schema-hash-bound canonical
request and `produced|unavailable|invalid-response` result envelopes; deterministic
adapters/clients exhaust fail loud and never translate failure into an empty success. Provider
admission/rate/concurrency/cost budgets, production adapters/pools/consumers, browser acquisition,
login wiring, session lifecycle, and worker execution remain owned by 1f/2h.

### Phase 1d as-built — the first `stores/common/` leaf (2026-08-01)

`src/stores/common/` is now populated by its first shared leaf: the Kronos timecard check, ported
with provenance from legacy `src/services/timecard/index.ts`
(commit `793abe1f`, blob `91c5b930`). The port splits along this doc's own boundary — pure
Clock-injected period/date resolution lives in `src/domain/timecard-period.ts`, and the
orchestration helper that both Kronos stores will bind lives in `src/stores/common/timecard.ts`.

Four boundary changes were made in the port; each removes a silent fallback or a banned primitive
rather than reshaping the algorithm, and each is pinned by a test:

- **No raw `Page`.** Legacy `TimecardDriver` took `(page, …)` on every method. `SemanticTimecardDriver`
  is page-free; concrete Kronos drivers own their Playwright internals (ref operator-trust §1.4).
- **No `waitForTimeout`.** The legacy orchestration slept 3s after navigation and after a period
  switch. Settling is a semantic page-state wait owned by the driver operation; the helper never sleeps.
- **Navigation failure throws.** `goToTimecard(): Promise<boolean>` returning `false` made "could not
  open the timecard" indistinguishable from "no punch entries exist" — both surfaced as `null`.
- **The driver cannot assert its own switch.** `switchPeriod(): Promise<boolean>` becomes a typed
  `TimecardPeriodSwitch` carrying the before/after period labels, which the helper compares (ref operator-trust
  §1.4). "There is no previous period" is a declared named arm, never inferred from a bare `false`.

The window helper also computes its bounds in calendar days rather than `n * 86_400_000` ms: the
legacy arithmetic lands an hour off local midnight across a DST transition, which can shift a bound
by a whole day once day-granularity rounding applies. `TimecardDateRange`, `TimecardMonthDay`, and
`VisibleTimecardMonthDays` are strict schemas in the boundary catalog, because the month/day half of
every timecard date is parsed from an untrusted Kronos grid. The Old Kronos adapter closes its
capability at migration order 2 and New Kronos at order 8; this helper is the seam both bind to.

---

## 1. What today's code teaches us (the problems the contract must kill)

1. **Systems are loose function bags.** `src/systems/ucpath/person-org-summary.ts` exports raw
   `(page, args) => result` functions with hand-written TS types. Nothing declares which system
   session a function needs, whether it mutates, what it throws, or how to retry it. Callers
   (workflows) re-invent all of that per call site.
2. **Workflow handlers are god functions.** person-lookup's handler + step functions are ~800 lines
   mixing navigation, business rules, screenshot policy, and tracker stamping. Output flows through
   `ctx.updateData` — an untyped `Record<string, unknown>` string blob read back with
   `dataString(...)` / `as string` casts. The compiler protects nothing across steps.
3. **Auth is copy-pasted.** `deferAuth: true` + a hand-rolled `ctx.step("ucpath-auth", ...)` +
   `loginToUCPath(page, ...)` + `if (!ok) throw` appears near-identically in 5 workflows.
4. **Names are re-encoded stringly.** `operationTraceCode` re-declares codes that `defineWorkflow`
   already owns; a new workflow compiles fine with the switch stale.
5. **What is already right:** the selectors registries (JSDoc + `// verified` dates + catalog),
   `DUO_LOGIN_FLOWS` (one table, uniform adapter signature, both smoke test and live test derive
   from it), `ctx.retry`'s signal-aware linear backoff, and the leaf drivers themselves (iframe
   handling, employment-instance expansion). These **port verbatim** and get wrapped — the wrapping
   shims themselves (e.g. the login-result adapter, §6.1) are new code and are named as such.

---

## Phase 1f executor ratification (2026-08-02)

Phase 1f turns two Phase-1d seams into mandatory runtime behavior:

- **Task provenance is collected, never inferred after the fact.** The executor constructs one
  real collector for every `TaskCtxCommon`; production `recordData` cannot be omitted, replaced by
  a no-op, or reconstructed from log prose. Each point is parsed through the strict `DataPoint`
  boundary and attached to the current run/attempt/node/task span. Before a read output may become
  a checkpoint or terminal-result dependency, the kernel checks the contract's resolved
  `provenance` policy: every `live` output field has a point recorded during that execution, while
  every `derived` field receives the complete declared upstream provenance with the oldest
  contributing `observedAt`. Missing or contradictory provenance fails the task before durable
  output. `fakeCtx` must supply an explicit recording fake so a unit test cannot accidentally prove
  a production no-op.
- **Provider admission is one generic kernel service.** Every `ctx.providers` call enters the same
  capability-indexed admission path before an adapter can perform remote I/O. It applies the
  immutable run config snapshot's timeout/abort, concurrency, rate, daily-usage, and cost limits;
  records reservations/outcomes with the provider evidence; and returns a typed unavailable result
  when admission cannot be granted. Counters and leases whose reset would change an admission
  decision survive worker restart in authority storage. Tasks cannot hold a worker while sleeping
  for provider capacity or bypass admission through an SDK/raw-network import. Phase 1f supplies
  this capability-neutral core and deterministic adapters only; production provider pools and
  OCR/geocoding/AI consumers remain Phase 2h.

**D112 as built (2026-08-03).** A task-visible admitted client accepts only the strict canonical
payload; it has no caller-supplied signal, timeout, deadline, budget, adapter, or admission id. The
adapter boundary separately exposes a local conservative maximum-cost `estimate` and one `invoke`
that receives only the kernel-composed abort signal, monotonic deadline, and durable admission id.
The adapter result is strict response + measured usage + already-redacted evidence. The kernel
reserves first, invokes outside SQLite, and durably settles before returning produced data; failure
to settle after remote I/O is an explicit uncertain outcome and never leaks the response. Abort and
deadline race the invocation itself, so even an adapter that ignores its signal releases the worker
turn while the durable reservation retains conservative accounting. The Phase-1f deterministic
harness observes estimates/invocations and scripts zero/fixture cost, abort, throw, malformed, and
unavailable cases; it is not a direct client bypass.

---

## 2. The Task contract

### 2.1 Core types

```ts
// src/domain/contracts/base.ts — bundle-safe: imports zod ONLY (guard, §8)
import { z } from "zod";

/**
 * Closed union — adding a system is a deliberate one-line edit here (D2).
 * Browser systems are named after the REAL src/systems/ directories
 * (old-kronos = UKG Kronos, new-kronos = WFD/Dayforce — NOT "kronos"/"ukg").
 * Service systems (D4) host system-less work; see §3.4.
 */
export type BrowserSystemId =
  | "ucpath" | "crm" | "onbase" | "kuali" | "servicenow"
  | "i9" | "new-kronos" | "old-kronos" | "sharepoint";
export type ServiceSystemId = "extraction" | "normalization" | "ocr" | "roster";
export type SystemId = BrowserSystemId | ServiceSystemId;
/** Closed non-browser I/O capabilities (D63). These name operations, not vendors; provider/model
 * selection is config. Extending the union also requires an infra adapter, budgets, preflight,
 * redaction policy, and scenarios. */
export type ProviderCapabilityId =
  | "ocr.extract" | "geocode.census" | "geocode.nominatim" | "ai.advisory";
/** Pure workflow-specific mini-store namespace; registry coverage validates the id against a real
 * descriptor without making domain import workflows. */
export type WorkflowStoreId = `workflow:${string}`;
export type TaskStoreId = SystemId | WorkflowStoreId;

/** Task ids are namespaced by store: "ucpath/search-person-org" or
 * "workflow:verify/merge-enrichment" (D2 slash grammar). */
export type TaskId<S extends TaskStoreId = TaskStoreId> = `${S}/${string}`;

/** Checkpoints/outboxes cross canonical JSON. Browser objects, Date, Map, class instances, etc.
 * are contract errors, not values the persistence layer guesses how to serialize. */
export type JsonValue = null | boolean | number | string | JsonValue[] |
  { readonly [key: string]: JsonValue };
type IsAny<T> = 0 extends (1 & T) ? true : false;
export type CanonicalJsonSchema<S extends z.ZodType> =
  IsAny<z.output<S>> extends true ? never :
  z.output<S> extends JsonValue ? S : never;

/** Opaque compile-time brands stop unrelated strings being interchangeable. Every brand has a
 * strict zod factory at runtime; these aliases are examples, not an exhaustive duplicate list. */
export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type RunId = Brand<string, "RunId">;
export type ItemId = Brand<string, "ItemId">;
export type TraceId = Brand<string, "TraceId">;
export type IsoInstant = Brand<string, "IsoInstant">;
export type DateOnly = Brand<string, "DateOnly">;
export type Eid = Brand<string, "Eid">;
export type MoneyMinorUnits = Brand<number, "MoneyMinorUnits">;
/** Created only by the contract factory after resolving a path against the exact output schema. */
export type ContractFieldPath = Brand<string, "ContractFieldPath">;

/**
 * D8 (contract side): mandatory on EVERY read contract. How long a
 * checkpointed output of this read may age before it is allowed to feed a
 * commit task on resume. `Infinity` is legal but must be written literally
 * and justified in an adjacent comment (grep ratchet, §8). The enforcement
 * declared-dependency freshness walk is kernel behavior owned by ref workflow-model.
 */
export interface Freshness {
  /** Default for facts in this output; field-path overrides may narrow it. */
  defaultMaxAgeMs: number;
  /** Default is forbidden. `audited` must be explicit and is never legal for identity,
   * idempotency-key, or write-proof fields. */
  defaultOverride?: "forbidden" | "audited";
  byField?: readonly {
    /** Validated against the exact output schema at contract definition time. */
    path: ContractFieldPath;
    maxAgeMs: number;
    override?: "forbidden" | "audited";
  }[];
}

export interface ProvenancePolicy {
  /** `live` means this task actually observed the authoritative source during this execution.
   * `derived` carries all input source facts forward and uses their oldest observedAt. */
  default: "live" | "derived";
  byField?: readonly {
    /** Validated against the exact output schema at contract definition time. */
    path: ContractFieldPath;
    source: "live" | "derived";
  }[];
}

/**
 * `prepare` mutates only ephemeral browser state. `commit` is the sole class
 * allowed to call an external-write primitive. A prepare contract may appear
 * only as the first arm of a transaction node (ref workflow-model), never as a resumable
 * standalone step.
 */
export type EffectClass = "read" | "prepare" | "commit";

/** Bundle-safe, declarative expected↔observed subject binding. The observation itself is owned by
 * ref operator-trust's UI registry/system driver. `none` is explicit so a person-scoped task cannot omit the
 * question accidentally. */
export type SubjectBindingSpec =
  | { kind: "none"; reason: string }
  | {
      kind: "person";
      expected: { fromInput: string; identity: "eid" | "name" | "eid-and-name" };
      observe: ObservationId;
      match: "normalized-exact-eid" | "normalized-exact-name" | "eid-and-name";
      requiredAt: "before-subject-read" | "after-prepare-before-fence";
    }
  | {
      /** File/document writes bind to the staged artifact, not merely the surrounding person. */
      kind: "artifact";
      expected: { fromInput: string; identity: "artifact-id" | "sha256" | "document-id" };
      observe: ObservationId;
      match: "exact";
      requiredAt: "before-subject-read" | "after-prepare-before-fence";
    };
```

### 2.1.1 Strict schema and absence rules (D46)

- Every contract input/output/proof/example/scenario and every persisted or transported object is
  defined with `z.strictObject(...)` (or a strict discriminated union of strict objects). Plain
  TypeScript interfaces are implementation views, never trust-boundary validators.
- Unknown keys are errors at the boundary. They are not stripped silently, because a misspelled
  field that disappears is exactly the “workflow says done but used no value” class of bug.
- `optional()` means the producer did not supply a field; `nullable()` means the authoritative
  source was read and has no value. An operation that could not determine a value returns a
  discriminated `unknown`/`ambiguous` outcome, never `null`, empty string, or omitted data.
- `undefined`, `Date`, `Map`, class instances, `NaN`, and `Infinity` values are not persisted.
  `Infinity` is permitted only in **freshness policy metadata**, not task data.
- Dates use branded `DateOnly`/`IsoInstant` schemas; EIDs use the canonical `Eid` schema; money uses
  integer minor units plus currency, never binary floating-point dollars; ids use distinct brands.
- Open records are legal only as explicitly declared presentation/diagnostic extension data that is
  never used for control, identity, writes, or completion. Durable decision-driving shapes may not
  contain `Record<string, unknown|JsonValue>`.
- The kernel runs `safeParse` at ingress and persistence reads, converts the full zod issue tree
  into a typed boundary failure naming path/value/source, and never falls back to a TypeScript cast.

```ts
// src/base/task.ts — server-side (may import Playwright types)
export interface SessionNeed<S extends BrowserSystemId = BrowserSystemId> {
  system: S;
  /** Must agree with the task effect: read→read; prepare/commit→transaction. */
  access: "read" | "transaction";
  /** Worker-session reuse is normal; a fresh boundary is explicit. */
  session: "reuse-worker" | "fresh";
  /**
   * OnBase-style constraint: one live app session per identity. Enforced by a
   * CROSS-PROCESS SQLite lease from day one (D15) — daemons are separate OS
   * processes (src/cli-daemon.ts), so an in-process queue cannot serialize
   * them. The kernel acquires the lease BEFORE opening the context and retains
   * it until that authenticated context is closed. A task boundary does not
   * release an identity-exclusive lease while the context remains alive.
   * Ported knowledge:
   * src/systems/onbase/LESSONS.md ("single app session per identity ...
   * another-session contention").
   */
  exclusive?: true;
  /** Playwright download capture (today's SystemConfig.acceptDownloads). */
  acceptDownloads?: true;
}

export interface RetryPolicy {
  /** Total attempts including the first. Capped by a ratchet (§8) at 3. */
  attempts: 2 | 3;
  backoffMs: number;
  /**
   * The ONLY selector is "transient": errors flagged transient by the page
   * proxy (Playwright TimeoutError, net::ERR_*) or thrown as
   * ctx.fail(code, ..., { transient: true }). Business failures
   * ("eid-not-found") are NEVER retried — retrying a wrong answer is a
   * silent fallback in disguise.
   */
  retryOn: "transient";
}
```

### 2.2 The contract/impl split (D3)

A task is **two files**:

- **contract**—plain data, bundle-safe, in the matching system/service/workflow contract namespace:
  id, zod
  input/output, `title`, `effect`, `errorCodes`, `freshness` (reads), write safety (commits),
  and a **mandatory `example` output**. Descriptors (ref workflow-model) and the dashboard import contracts
  ONLY. E2e stubs derive their **minimum happy-path value** from `example` (schema-parsed); failure,
  cancellation, concurrency, delegation, mismatch, and recovery behavior comes from the checked-in
  `ScenarioManifest` corpus (ref operator-trust). Examples are fixtures, never behavioral coverage.
- **impl**—`run` + session needs + read retry, in the matching store's `tasks/`, imports its typed
  system driver API and the store-owned driver declaration. Only `stores/<system>/driver/**` and
  session infrastructure import Playwright. `defineTask(driver, contract, impl)` binds browser
  implementations; headless service/workflow tasks use `defineTask(contract, impl)`. The store is
  the only impl registry.

```ts
// src/domain/contracts/base.ts (continued)
export interface TaskContractBase<
  Id extends TaskId,
  In extends z.ZodType,
  Out extends z.ZodType,
  Codes extends readonly [string, ...string[]],
> {
  id: Id;
  /**
   * Human label. This is the DEFAULT for the descriptor's step.label (D16);
   * the only override layer is the operator presentation override, and the
   * precedence rule is stated once, in ref workflow-model.
   */
  title: string;
  input: In;
  output: CanonicalJsonSchema<Out>;
  /** Declared error taxonomy. ctx.fail() only accepts these codes. */
  errorCodes: Codes;
  /** Declared secret names; shape/accessor owned by ref clock-config-secrets. Empty/absent means none. */
  requires?: readonly SecretName[];
  /** D63: explicit non-browser remote I/O. Legal only for service-store contracts; absent means
   * deterministic/local. The task receives exactly this narrowed injected client set. */
  providers?: readonly ProviderCapabilityId[];
  /** Explicit subject scope. Person-scoped tasks name the authoritative observation used to prove
   * which record/page is open; service/global tasks declare `{kind:"none"}`. */
  subject: SubjectBindingSpec;
  /** Registered behavioral scenarios (ref operator-trust). `example` is a value fixture, not coverage. */
  scenarios: readonly [ScenarioId, ...ScenarioId[]];
  /**
   * Mandatory canonical output value. A guard parses it through `output`
   * (§8); the e2e stub lane emits it as the task's happy-path response.
   */
  example: z.input<Out>;
}

export interface ReadTaskContract<Id extends TaskId, In extends z.ZodType,
  Out extends z.ZodType, Codes extends readonly [string, ...string[]]>
  extends TaskContractBase<Id, In, Out, Codes> {
  effect: "read";
  freshness: Freshness;                    // MANDATORY on every read (D8)
  provenance: ProvenancePolicy;             // MANDATORY; prevents transform-based freshness laundering
  /** Downloads/generated files are allowed only as content-addressed cache artifacts through
   * the kernel writer. Mutable append/update targets are not read-task effects. */
  artifacts?: "content-addressed";
}

export interface PrepareTaskContract<Id extends TaskId<BrowserSystemId>, In extends z.ZodType,
  Out extends z.ZodType, Codes extends readonly [string, ...string[]]>
  extends TaskContractBase<Id, In, Out, Codes> {
  effect: "prepare";
  /**
   * Browser-page mutation only: navigate and stage fields. It has no external
   * mutation capability in ctx and is legal only inside a transaction node.
   */
  checkpoint: "in-memory-only";
}

export interface CommitTaskContract<Id extends TaskId<BrowserSystemId>, In extends z.ZodType,
  Out extends z.ZodType, Proof extends z.ZodType,
  Codes extends readonly [string, ...string[]]>
  extends TaskContractBase<Id, In, Out, Codes> {
  effect: "commit";
  /** Required and non-optional. Shape owned by ref write-safety. */
  writeSafety: WriteSafety<In, Out, Proof>;
}

/** `const Codes` (TS5) keeps errorCodes as a literal tuple — without it the
 *  union collapses to string[] and ctx.fail() would accept anything (D15).
 *
 *  `defineTaskContract` uses one overload per effect. The abandoned Step-0
 *  spike was removed on 2026-07-21; this three-effect API must be re-proved in
 *  the new Phase-1 type spike before implementation. */
type Sealed<T> = T & { readonly __sealed: true };
export type SealedReadContract<Id extends TaskId, In extends z.ZodType,
  Out extends z.ZodType, Codes extends readonly [string, ...string[]]> =
  Sealed<ReadTaskContract<Id, In, Out, Codes>>;
export type SealedPrepareContract<Id extends TaskId<BrowserSystemId>, In extends z.ZodType,
  Out extends z.ZodType, Codes extends readonly [string, ...string[]]> =
  Sealed<PrepareTaskContract<Id, In, Out, Codes>>;
export type SealedCommitContract<Id extends TaskId<BrowserSystemId>, In extends z.ZodType,
  Out extends z.ZodType, Proof extends z.ZodType,
  Codes extends readonly [string, ...string[]]> =
  Sealed<CommitTaskContract<Id, In, Out, Proof, Codes>>;

export function defineTaskContract<
  Id extends TaskId, In extends z.ZodType, Out extends z.ZodType,
  const Codes extends readonly [string, ...string[]],
>(c: ReadTaskContract<Id, In, Out, Codes>): SealedReadContract<Id, In, Out, Codes>;
export function defineTaskContract<
  Id extends TaskId<BrowserSystemId>, In extends z.ZodType, Out extends z.ZodType,
  const Codes extends readonly [string, ...string[]],
>(c: PrepareTaskContract<Id, In, Out, Codes>): SealedPrepareContract<Id, In, Out, Codes>;
export function defineTaskContract<
  Id extends TaskId<BrowserSystemId>, In extends z.ZodType, Out extends z.ZodType, Proof extends z.ZodType,
  const Codes extends readonly [string, ...string[]],
>(c: CommitTaskContract<Id, In, Out, Proof, Codes>): SealedCommitContract<Id, In, Out, Proof, Codes>;
// impl body freezes + fails loud at module load (validation below).

/** The `Any*Contract` aliases used from here on are the SEALED effect-specific
 *  forms with generics erased to their bounds:
 *    AnyReadContract   = SealedReadContract<TaskId, z.ZodType, z.ZodType, readonly [string, ...string[]]>
 *    AnyPrepareContract = SealedPrepareContract<…same bounds…>
 *    AnyCommitContract  = SealedCommitContract<…same bounds…, z.ZodType, …codes…>
 *    AnyContract        = AnyReadContract | AnyPrepareContract | AnyCommitContract
 *  That union is exactly ref workflow-model §3's `AnyTaskContract`. */
```

`defineTaskContract` freezes the object and **fails loud at module load** on: id not matching
the system/workflow namespace grammar, unknown system prefix, malformed `workflow:<id>`, empty
`errorCodes`, `example`
failing `output.parse`, output/proof not canonical-JSON round-trippable, or a read contract missing
`freshness`/`provenance`; non-strict schemas; unresolved scenario ids; or an invalid subject
declaration. A browser task declaring `subject.kind:"person"` must resolve a same-system
authoritative observation and a wrong-subject scenario. A service/workflow task cannot declare a
browser observation. Browser and workflow-store contracts cannot declare provider capabilities;
service contracts resolve every declared capability and required secret through the provider and
preflight registries. A person-scoped commit must use
`requiredAt:"after-prepare-before-fence"`; the descriptor/kernel reject any other declaration.
`CanonicalJsonSchema` rejects `any` and known non-JSON output types at
compile time; the factory
round-trip is the runtime backstop. A **type-level test** pins that
`ctx.fail("undeclared-code", …)` fails `tsc` (D15).

```ts
// src/base/task.ts (continued) — the impl side + the binding factory
export type NamespaceOf<C> =
  C extends { id: `${infer S extends TaskStoreId}/${string}` } ? S : never;
export type BrowserSystemOf<C> = Extract<NamespaceOf<C>, BrowserSystemId>;
export type SessionsFor<C> = [BrowserSystemOf<C>] extends [never]
  ? readonly []
  : readonly [SessionNeed<BrowserSystemOf<C>>];
export type ProviderNeedsOf<C> = C extends { providers: readonly ProviderCapabilityId[] }
  ? C["providers"] : readonly [];
type ContractDriver<C extends AnyContract> = { system: BrowserSystemOf<C> };
type BaseReadCtxFor<
  C extends AnyReadContract,
  Driver extends ContractDriver<C>,
> = [BrowserSystemOf<C>] extends [never]
  ? NamespaceOf<C> extends WorkflowStoreId
    ? PureTaskCtx<C["errorCodes"]>
    : ServiceTaskCtx<C["errorCodes"], ProviderNeedsOf<C>>
  : ReadTaskCtx<Driver, C["errorCodes"]>;
export type ReadCtxFor<C extends AnyReadContract, Driver extends ContractDriver<C>> =
  BaseReadCtxFor<C, Driver> &
  (C extends { artifacts: "content-addressed" }
    ? { artifacts: ContentAddressedArtifactWriter }
    : { artifacts?: never });

export interface DriverDeclaration<Driver extends { system: BrowserSystemId }> {
  system: Driver["system"];
  status: "unwired" | "semantic-ready";
  // The factory owns a private invariant type member; callers cannot forge declarations.
}

export interface ReadTaskImpl<
  C extends AnyReadContract,
  Driver extends ContractDriver<C> = ContractDriver<C>,
> {
  sessions: SessionsFor<C>; // browser store must name its own system; service/workflow store must be []
  retry?: RetryPolicy;
  /** Receives the PARSED input (z.output — defaults/transforms applied);
   *  returns a pre-parse value (z.input of the output schema) that the
   *  kernel parses through contract.output before anything downstream sees it. */
  run: (args: { input: z.output<C["input"]>; ctx: ReadCtxFor<C, Driver> })
    => Promise<z.input<C["output"]>>;
}
export interface PrepareTaskImpl<
  C extends AnyPrepareContract,
  Driver extends ContractDriver<C> = ContractDriver<C>,
> {
  sessions: readonly [SessionNeed<BrowserSystemOf<C>>];
  retry?: never; // transaction node owns whole-pair retry before a fence; never retry half-filled page state
  run: (args: { input: z.output<C["input"]>; ctx: PrepareTaskCtx<Driver, C["errorCodes"]> })
    => Promise<z.input<C["output"]>>;
}
export interface CommitTaskImpl<
  C extends AnyCommitContract,
  Driver extends ContractDriver<C> = ContractDriver<C>,
> {
  sessions: readonly [SessionNeed<BrowserSystemOf<C>>];
  /** A commit attempt is never generically retried; ref write-safety owns recovery. */
  retry?: never;
  run: (args: { input: z.output<C["input"]>; ctx: CommitTaskCtx<Driver, C["errorCodes"]> })
    => Promise<z.input<C["output"]>>;
}

/** Per-effect overloads (D7): pairing a commit contract with a read-shaped
 *  impl (or vice versa) fails to compile — the ctx types differ. This is
 *  "compile-time where possible"; the factory's runtime checks are the
 *  always-on backstop. */
export function defineTask<C extends AnyReadContract, Driver extends ContractDriver<C>>(
  driver: DriverDeclaration<Driver>, contract: C, impl: ReadTaskImpl<C, Driver>,
): Task<C, Driver>;
export function defineTask<C extends AnyPrepareContract, Driver extends ContractDriver<C>>(
  driver: DriverDeclaration<Driver>, contract: C, impl: PrepareTaskImpl<C, Driver>,
): Task<C, Driver>;
export function defineTask<C extends AnyCommitContract, Driver extends ContractDriver<C>>(
  driver: DriverDeclaration<Driver>, contract: C, impl: CommitTaskImpl<C, Driver>,
): Task<C, Driver>;
type HeadlessReadContract<C extends AnyReadContract> =
  [BrowserSystemOf<C>] extends [never] ? C : never;
export function defineTask<C extends AnyReadContract>(
  contract: HeadlessReadContract<C>, impl: ReadTaskImpl<C>,
): Task<C>;

export type Task<C extends AnyContract, Driver extends ContractDriver<C> = ContractDriver<C>> =
  Readonly<{ contract: C; impl: ImplFor<C, Driver> }> &
  { readonly __task: true };

export type ImplFor<C extends AnyContract, Driver extends ContractDriver<C>> =
  C extends AnyReadContract ? ReadTaskImpl<C, Driver> :
  C extends AnyPrepareContract ? PrepareTaskImpl<C, Driver> :
  C extends AnyCommitContract ? CommitTaskImpl<C, Driver> : never;

export type TaskInput<T> =
  T extends { input: infer I extends z.ZodType } ? z.input<I> :
  T extends { contract: { input: infer I extends z.ZodType } } ? z.input<I> : never;
export type TaskOutput<T> =
  T extends { output: infer O extends z.ZodType } ? z.output<O> :
  T extends { contract: { output: infer O extends z.ZodType } } ? z.output<O> : never;
```

**`z.input` vs `z.output` (D15, review #4):** step input mappings produce `TaskInput<T>` =
`z.input` — a field with `.default(false)` is *omittable* at the mapping site; `run` receives the
parsed `z.output` value with defaults and transforms applied. Conflating the two (`z.infer`
everywhere) would make every defaulted field required in mappings and defeat transforms.

### 2.3 The task ctx (narrow by construction)

```ts
export interface TaskCtxCommon<Codes extends readonly string[]> {
  signal: AbortSignal;
  log: TaskLogger;                             // structured; auto-tagged with taskId + span
  /**
   * Typed fail-loud throw. Produces a TaskError whose message names the task
   * and the offending value:
   *   ctx.fail("eid-not-found", `no Person Org row for EID ${input.emplId}`,
   *            { subject: input.emplId })
   * → "[ucpath/search-person-org] eid-not-found: no Person Org row for EID 10001573"
   */
  fail(code: Codes[number], message: string,
       opts?: { subject?: string; transient?: boolean; cause?: unknown }): never;
  /** Observational data-provenance points (port of today's ctx.recordData). */
  recordData(point: DataPoint | DataPoint[]): void;
}

export interface PureTaskCtx<Codes extends readonly string[]>
  extends TaskCtxCommon<Codes> {} // workflow transforms: no page/artifact/mutation

export interface ServiceTaskCtx<Codes extends readonly string[],
  Needs extends readonly ProviderCapabilityId[]>
  extends TaskCtxCommon<Codes> {
  /** Injected abortable clients, narrowed to the contract declaration. Each call is timeout/rate/
   * concurrency-admitted, redacted, and action-evidenced by infra. No provider SDK or raw fetch is
   * reachable from task code. An empty need tuple exposes no client. */
  providers: ProviderClientSubset<Needs[number]>;
}

export interface ArtifactRef {
  /** Stable UUID identity; never a digest or filesystem path. */
  id: ArtifactId;
  /** Immutable content identity and private content-addressed storage key. */
  sha256: string;
  bytes: number;
  mediaType: string;
}
export interface ContentAddressedArtifactWriter {
  /** Writes temp → fsync → atomic no-replace publication → directory fsync under the private
   * artifact root. Same bytes return the same ArtifactRef; callers never learn the backing path. */
  put(source: Uint8Array | NodeJS.ReadableStream,
      meta: { mediaType: string }): Promise<ArtifactRef>;
  /** Reads by validated ref; contracts never receive or expose an operator filesystem path. */
  open(ref: ArtifactRef): Promise<NodeJS.ReadableStream>;
}

export interface BrowserTaskCtx<
  Driver extends { system: BrowserSystemId },
  Codes extends readonly string[],
>
  extends TaskCtxCommon<Codes> {
  /** Only the declared browser system. Raw Page/Locator access is confined to driver/session
   * infrastructure (ref operator-trust); every operation is element/state/observation-addressed and traced. */
  driver: Driver;
}

export interface ReadTaskCtx<Driver extends { system: BrowserSystemId }, Codes extends readonly string[]>
  extends BrowserTaskCtx<Driver, Codes> {}

export interface PrepareTaskCtx<Driver extends { system: BrowserSystemId }, Codes extends readonly string[]>
  extends BrowserTaskCtx<Driver, Codes> {} // no external mutation capability

export interface CommitTaskCtx<Driver extends { system: BrowserSystemId }, Codes extends readonly string[]>
  extends BrowserTaskCtx<Driver, Codes> {
  /** Only capability that can invoke an audited external-write primitive. */
  mutation: MutationCapability;
}
```

**Subject binding is kernel-enforced, not an optional leaf convention.** For a read that declares
`requiredAt:"before-subject-read"`, the driver freshly observes the declared identity before it
extracts subject-scoped facts and the kernel—not task code—compares that typed observation to parsed
input. For every transaction, the kernel observes on the retained staged page after prepare and
immediately before ref write-safety's fence; mismatch/unknown means zero clicks. Artifact-scoped writes bind
the staged document id/digest the same way. Ref write-safety wraps a matched subject proof—or an explicitly
allowlisted unscoped page-state proof when no stronger subject exists—into the durable
`WriteBindingProof` bound to the mutation capability and post-write verification. Searching for an EID, seeing it in stale page text, or
trusting the workflow input does not count as observing the open record. The New Kronos stale-
timecard incident is the required base scenario, not a separations-only workaround.

**What TaskCtx deliberately does NOT have:** `updateData` (the untyped blob — display fields become
projections of typed task outputs, ref dashboard-surfaces), `step` (the graph node owns orchestration), `delegateTo` (delegation
is workflow-level composition, ref workflow-model), free-form `retry` (retry is declared, kernel-executed),
and **any wait/park primitive** (§2.6).

### 2.4 Error taxonomy

```ts
export class TaskError extends Error {
  readonly taskId: string;
  readonly code: string;          // ∈ the task's declared errorCodes, or "unhandled"
  readonly subject?: string;      // the offending value: EID, doc id, filename, selector intent
  readonly transient: boolean;    // retry eligibility — false unless proven transient
  readonly decoratedBy?: string;  // set when a before/after hook (§4) threw
  /** Secondary failures from onError hooks — NEVER replaces the base error (D15). */
  readonly hookErrors?: readonly { hook: string; error: unknown }[];
}
```

- The kernel wraps any non-`TaskError` escaping `run` as `code:"unhandled"`, `transient:false`,
  preserving `cause`. Nothing escapes without a task name attached — a trace line alone identifies
  the broken task (charter target #1).
- `instanceof`/`code` branching replaces today's ad-hoc `WorkflowError` subclasses; the two real
  branching cases (`EmplIdNotRecognizedError`, `RetryPageError`) become declared codes.
- Message contract is pinned by a unit test: `[<taskId>] <code>: <message>`.
- **The base TaskError always propagates.** A failing `onError` hook attaches to `hookErrors`;
  it can never replace `"submit-failed"` with `"decorator-failed"` (§4.1, pinned by test).

### 2.5 Identity & naming scheme

- `id = "<system>/<verb-object>"`, kebab-case (D2): `ucpath/search-person-org`,
  `onbase/upload-document`, `crm/read-onboarding-record`,
  `extraction/extract-pdf-fields`, `ocr/read-form-pages`, `roster/match-spreadsheet`.
- Verb prefixes are meaningful: `read-`/`search-`/`list-`/`extract-` ⇒ `effect:"read"`;
  `fill-`/`stage-` ⇒ `effect:"prepare"`; `save-`/`submit-`/`upload-`/`create-`/`update-`/`delete-`
  ⇒ `effect:"commit"`. `fill-and-submit-` is forbidden: it must become a transaction pair.
  A ratchet test (§8) enforces verb↔effect agreement so a misdeclared effect can't hide.
- A codegen'd `KnownTaskId` union — derived from the **contract barrels**
  (`domain/contracts/*/index.ts`) at build time, like `schemas:export` — gives descriptor
  projections and the dashboard a closed type to key on. Bundle-safe by construction: it is
  generated from files that themselves import only zod.

### 2.6 The task boundary — tasks are bounded; waits are not tasks (D5)

**A task is a run-to-completion Promise with bounded duration** (minutes, not hours). The executor
races every task against the immutable run snapshot's `timeouts.taskMs` and the run AbortSignal;
transactions additionally have `timeouts.transactionMs`. Browser timeout poisons/releases the
lease; service SDK/file operations must honor the same signal. A timeout before a fence may restart
preflight; after a fence it enters ref write-safety recovery and is never a generic retry. The things
today's code does that do NOT fit that shape are explicitly **not tasks**:

- **Long waits — OCR approval, child-signature watching, external signals** (oath-upload's
  `subscribeToApproval` park + hours-long wait-signatures watch) are **gate nodes** declared in the
  descriptor and owned by **ref workflow-model's run-state machine**; their wire form is ref dashboard-surfaces's
  `gate.opened`/`gate.resolved` events. A task never contains an unbounded poll.
- **Session policy at a park (kernel rule, stated here because stores implement it):** a parked
  run **RELEASES its browser sessions** — holding a Duo'd UCPath page across an overnight approval
  wastes a browser and rots the session anyway. On resume the kernel reacquires via the store's
  session provider; `login` is idempotent (§6.1), so reacquisition is just another login call that
  usually short-circuits to `"already-authenticated"` or re-runs Duo. Exclusive leases (§2.1) are
  released with the session.
- **Duo is fully automated — never a gate (charter §9).** Duo Autopilot clears the MFA WebAuthn
  ceremony hands-off inside the session provider's `login`, for ALL runs — production included.
  There is no phone-approval poll anywhere in the new design; `login` ends by succeeding or
  throwing within seconds and never parks the run. (`duo-poll.ts` and its manual-approval wait do
  not port.)

---

### 2.7 The authoring floor — three declaration tiers (D79f, 2026-07-24)

**The problem this solves.** As written across the reference specs, every task owes roughly ten artifacts:
input/output schemas, `errorCodes`, freshness, provenance classification, subject spec, a mandatory
`example`, a non-empty scenario tuple, naming compliance — and a commit adds `writeSafety` plus
crash/subject scenarios. For a UCPath commit that is exactly right. For a pure transform in a
workflow mini-store — a date-window calculation, a roster row projection — it is ceremony that
makes workflows #2–#10 unpleasant to write, and unpleasant-to-write is how a codebase acquires
copy-paste.

**Three tiers. The floor scales with what the task can break.**

| Tier | Applies to | Required | Optional until |
|---|---|---|---|
| **Light** | `workflow:<id>/…` mini-store pure reads and transforms (`sessions: []`, no page, no provider) | input/output schemas + `example` | scenarios required at the **first incident** — a bug fix here lands its regression scenario like any other |
| **Standard** | browser `read` tasks | Light + freshness/provenance classification + subject spec + `errorCodes` + a happy scenario and its no-match/empty sibling | — |
| **Full** | every `prepare`/`commit` (i.e. every task that can touch a real HR system) | Standard + `writeSafety` (completion arm + proof schema + idempotency) + probe policy + subject matcher + crash/mismatch/proof-unknown scenarios | nothing — a commit pays full fare, always |

The tier is **derived, never declared**: it follows from `effect` + store kind, so a task cannot
opt itself into a cheaper tier. A guard asserts the derivation rather than trusting an author.
Promoting a light task later (a second workflow wants it, so it moves to a system store) raises its
tier automatically and fails the build until the additional artifacts exist — which is the correct
moment to pay, not before.

**`scaffold new-task` / `scaffold new-workflow` are part of the base.** Nothing in the reference specs
previously promised a generator, and the read-only explorer (D55) does not emit code. The
declaration toil is only acceptable if the boilerplate is *generated* — contract skeleton, impl
stub, example, scenario stubs, and store registration, each with `TODO` markers that fail their
guards until filled. This is the concrete answer to "will workflows #2–#10 be pleasant to write."

---

### 2.8 The rich-extraction convention — one task per PAGE VISIT (D194, ratified 2026-08-12)

§2.7 answers *how much a task owes*. This answers the neighbouring question the store libraries
forced open at the order-8 separations migration: **how wide a read task's output should be.** The
operator ratified the rich-extraction convention on 2026-08-12; the options it was chosen from, and
the measured duplication that motivated it, are recorded in `docs/migrations/separations.md` §2.6.

**The convention.** A read task's identity is **"I visited this page and read what it has"** — not
"a caller asked me for these fields."

1. **One task per page visit.** A task navigates to one page (or proves one page state) and returns
   the **full useful surface** that page carries, not only the fields today's first consumer needs.
   Two genuinely different page visits stay two tasks: the convention groups by visit, it never
   merges a second navigation into the first.
2. **The output schema is FIXED and strict, and is never a function of a runtime argument.** A
   contract has one output schema and one schema hash, and runs, checkpoints, terminal results and
   evidence receipts all bind that hash plus the produced value's digest (D110/D114/D82). A
   `read(fields…)` shape — where the caller names the fields and the output shape follows — is
   therefore **banned**: satisfying a variable field set means either one wide all-optional record
   (which no longer proves what was actually read, and would not survive `strict-boundary-schemas`)
   or a separate contract per field set. It also conflates *which page do I visit* with *which
   fields do I want*, so a caller could change navigation by editing a field list.
3. **Consumers project; they never re-scrape.** A downstream node that wants one field binds the
   field path out of a prior node's output, or folds it in a pure workflow mini-store task (§3.5).
   Adding a field to a later workflow must be a `bind`, not a new driver operation.
4. **Every field that can legitimately be blank declares an explicit absent arm** — the proven
   `{state:"absent", reason}` shape — reported only *after* the page state and the subject are
   proven, and a malformed non-blank value still throws (§2.1.1's absence rules, unchanged). This is
   load-bearing, not decorative: the executor validates that provenance covers **every** canonical
   output leaf on every run, so a rich field with no absent arm can fail a workflow that never
   needed it. Absence is reported as data; it is never a silent blank.
5. **Every leaf declares its redaction classification at authoring time** (ref operator-trust §D140 — an
   undeclared leaf fails loud). A wider read owes a wider classification table up front; that is the
   one-time authoring cost the convention accepts.
6. **The tier does not change.** A rich read is still a §2.7 **Standard**-tier task; what grows is
   the per-leaf obligation inside it, not the artifact list around it.

**Scope, and what this decision does NOT do.** The convention binds every **new** task from
2026-08-12 and every task authored by a migration from order 8 onward. It does **not** trigger a
rewrite of existing tasks: a store merges its duplicate extractions when it is next touched for
other reasons, because re-authoring a shipped task's output schema moves a schema hash that existing
run records, checkpoints and receipts already bind. The first known merge target is `crm` —
`crm/read-onboarding-record` and `crm/read-onboarding-dates` share an entire page visit (the same
search, drill-in and record page) and the record page already holds `First Day of Service`, which
the record task drops from its output and the dates task re-runs the whole search to read again. The
CRM **history** page is a second visit and stays its own task under this convention.

---

### 2.11 The third store authored under §2.8 — `ucpath/read-job-summary` (D201, 2026-08-12)

Separations chunk 3 mints the UCPath side of §2.8's convention, and it settles two authoring rules the
first two stores did not have to answer.

**A page's read task reports what the page showed; the JUDGMENT is a separate fold.**
`ucpath/read-job-summary` returns the whole *Employment Instances* grid — every row's empl record,
verbatim HR status, business unit, effective dates, department, job code, title, FTE and class — plus
the page-displayed person identity, the row count, and the **render context** that says whether the
grid is complete. It classifies nothing. "All rows terminated", "two concurrent jobs" and "already
separated" are a pure fold over that output
(`src/domain/separations/job-summary-classification.ts`). Legacy computes those same facts as THROWS
inside its page module, and only when the search happened to render a multi-row grid — so they exist
only in a log, and a single-employment person who is already terminated is never checked at all (S22,
found live on a real person). A read that refuses on the shape of its own answer cannot serve a gate
whose whole job is to SHOW the operator that answer.

**Absent arms are for genuinely-optional CELLS, and the STRUCTURAL ones refuse.** Empl record, HR
status and business unit are required on every rendered row: a blank one means the extraction read
something that is not an employment row. The nine descriptive cells each carry
`{state:"absent", reason}`. The dividing line is *what a blank MEANS*, not what is convenient: a blank
structural cell is a broken read, a blank descriptive cell is a real page state. S24's unreadable
department is therefore data with a reason rather than a refusal — refusing there would fail an
identity check over a cell the identity check does not use, and the consumer that NEEDS a department
is the one that refuses.

**One extraction, two parses.** `searchPersonOrg` and `readJobSummary` share the same page visit and
the same cell read. They do not share a parse: the search keeps its exact preferred-assignment
derivation, which refuses a blank department because a CANDIDATE without one is unusable, while the
job-summary read gives that same cell an absent arm. Widening the search's own output instead would
have moved a schema hash shipped run records already bind (D110/D114/D82) — which is the cost §2.8
warned about, paid the way §2.8 said to pay it: a new contract beside the old one.

### 2.9 The first store authored under §2.8 — `new-kronos` as-built (D196, 2026-08-12)

Separations chunk 1 (`docs/migrations/separations.md` §3) is the first slice authored under the
rich-extraction convention and the first new browser store since the platform was built, so what it
settled is normative for every store slice after it.

**Two tasks, because two page visits.** `new-kronos/search-employee` is the Employee Search results
panel; `new-kronos/read-separation-timecard` is the Timecard. The migration doc's §2.4 inventory
sketches FIVE tasks (`open-timecard`, `verify-timecard-subject`, `set-timecard-range`,
`read-separation-timecard`) — that table predates §2.8, which was ratified later in the same
document. Go To, the subject proof, the range apply and the grid read are one visit to one page and
cannot be re-entered independently; a separate "set the range" task would hand the next task a page
it could not prove it was still standing on. **The rule this settles: a navigation-plus-state-change
sequence on ONE page is ONE task, and the split is at the page boundary, never at the step
boundary.**

**A rich read owes an INVARIANT over its completeness, not just a wider schema.** The WFD timecard
grid is virtualized: a 73-day window renders 51 date rows at `scrollTop: 0`, so a single DOM read
returns a plausible, wrongly-truncated timecard. The task therefore accumulates across scroll and
then asserts a property the complete set must satisfy — WFD renders one row per calendar day, so a
complete read holds every day in the applied window — and refuses when it does not. Generalise it:
**when a page virtualizes, a wide read must state what the complete set must contain and assert
that, rather than trusting the loop that gathered it.** §2.8's obligations (absent arms, declared
classification) are about each leaf; this one is about the SET, and it is the same class of
obligation.

**A rich read binds its columns by NAME.** Legacy addressed the grid by fixed cell index; a column
inserted upstream would silently re-point "Pay code" at "Transfer". The task resolves the live
header row and fails loud naming the missing or ambiguous header. A positional read is exactly the
substitution `no-positional-identity` bans one level up.

**The page's own subject is an OUTPUT, not an internal check.** The timecard read returns the EID and
the display name the timecard itself showed, beside the ones the run expected. The wrong-person
control is still the contract's `subject` binding, which fails the run — but the receipt carries what
was observed, which is what lets an operator finish the double-check without opening UKG.

**A value the classifier does not recognise is REPORTED, never dropped.** The ported sick/holiday
rules are two regexes; the live window carried two pay codes neither matches. They surface as
`unclassifiedPayCodes`. A rich read that silently discards what it could not classify is narrower
than it looks, and here the discarded value could move a real termination's effective date.

**Distinct negatives are distinct ERROR CODES.** Where a migration's answer is "all of these fail"
(separations §4b) but the values must stay distinguishable, the distinct durable value is
`FailureRecord.code`: `employee-not-found`, `search-returned-no-match` and `search-no-signal` are
three codes, not one boolean. A timeout is never a negative.

**Session facts** (ref execution-and-sessions §4.1 owns the contract; recorded here because they were settled in this
slice): New Kronos does **not** hop through `a5.ucsd.edu` — its SSO chain lands on ForgeRock under
`*.prd.mykronos.com`, serving the same UCSD credential form. D120's two independent facts are the
application-issued `kronosAuthToken` on the WFD host plus the absence of both the UCSD SSO form and
ForgeRock's XUI login shell. The IDP's own JWT was rejected as the positive fact: it proves the
identity provider authenticated somebody, and it is scoped to a parent domain that includes the
sign-on host.

**The store is structurally read-only.** No `commit` operation, no `MutationCapability` in its import
graph, and the UI-registry audit refuses an `external-commit` element by name. A later write slice
adds the capability deliberately; it cannot be inherited.

---

### 2.10 The first store CUSTOMIZED under §2.8 — `kuali` as-built (D197, 2026-08-12)

§2.9 settled what a store BUILT whole owes. Separations chunk 2 is the other case ref stores §1
distinguishes — a **CUSTOMIZE** of an existing semantic-ready store — and it settles five more rules
that are normative for every store slice that extends one rather than creating one.

**A sibling task family extends the ONE driver declaration; it never mints a second.** The Kuali
store already had a `DriverDeclaration<KualiRrssDocumentDriver>` bound by four write-family tasks.
The separation read is a fifth task on that SAME declaration, and its operation is added to the same
driver schema. `defineTask(driver, contract, impl)` binds the store's exact invariant declaration
(the `task-driver-boundary` rule), so a second declaration for one store is not a style choice — it
is the thing that boundary exists to refuse. Where the new surface is much wider than the old, the
SCHEMAS may live in their own module; the DECLARATION may not.

**A read surface and a write surface on one page share a screen, so catalog attribution splits by
FACT, not by screen.** `new-kronos` could attribute per screen because its two tasks visit two
pages. Kuali's read and write stand on the same document: three facts are genuinely shared (the EID
field and its observation, the timekeeper field and its observation), fourteen belong to the read
alone, and the Save button still belongs to the commit task alone — because the catalog is what an
operator reads to answer "what can click this?", and naming a read task there would be a lie.

**A registry invariant meets a second legitimate case by becoming PER-KIND, not by being relaxed.**
Kuali's audit required "exactly one subject-authoritative observation" — correct when the store's
only binding was the write's PERSON subject. The separation read's subject is the DOCUMENT (§2.1's
`artifact` kind with `identity:"document-id"`), because the run names a document and DISCOVERS the
person. The rule is now exactly one PER SUBJECT IDENTITY: one `eid` observation and at most one
`document-number` observation. Widening it to "at least one" would have made both unprovable.

**A control the live page carries and legacy has no key for stays DRIVER-INTERNAL.** This is
§2.9's rule applied in the harder direction: it is tempting, when fourteen of eighteen controls port
cleanly, to publish the other four with an invented provenance row. Four fields (Division, Employee
Type, Student Title Code, the optional comments box) and three of four Final Pay radios are read
through their exact live accessible names in the driver, listed together in one named block, and
each re-asserts the exactly-one count on every read. A fabricated port row is worse than an
unpublished element.

**A person field's ARM DISCRIMINATOR is not the person (D140 refinement).** A rich read's fields are
`{state, value}` / `{state, reason}` unions, and declaring the whole field `direct-identifier`
pushes `state` through `last4`. The live proof run on real document 4502 produced a receipt reading
`employee.name.state = "sent"` and `employee.name.reason = "alue"` — not redaction, but a receipt
telling the operator something false. Only the `value` leaf carries the identifier; `state` and
`reason` describe the READ, which is a transaction fact. The general consequence is worth stating
because it is a migration hazard: **changing the evidence classification table moves receipt BYTES
for every already-settled run**, and `evidenceReceipts.insert` correctly refuses the divergent
rebuild by name — so a classification fix strands the receipts of runs settled before it.

---

### 2.12 One store, two screen families, TWO write transactions — `ucpath`'s termination family (D206, 2026-08-14)

Separations chunk 4 is the first slice to add a WRITE family to a store that already had a read
family, and the first to compose **two transaction nodes in one graph**. Five rules fall out, and
each was forced by something live rather than chosen.

**A store's ONE driver declaration joins unrelated screen families, and a fixture answers only its
own half.** The `ucpath` store's Person Organizational Summary family and its Smart HR termination
family share nothing but the system id — different route, different frame model (Person Org lives
inside `#main_target_win0`, Smart HR renders **no iframe at all**), different anchor style. D197
rule 1 still binds: `defineTask(driver, …)` takes the store's exact invariant declaration, so the
type is joined (`src/domain/ui/ucpath-driver.ts`) while the schemas stay in their own modules. The
consequence a fixture cannot dodge is that it must satisfy BOTH halves structurally — and it must
not IMPLEMENT both, because a Person Org fixture that quietly answered a termination scan would be
inventing HR transactions. Each half therefore refuses the other's operations **by name**.

**ONE rich page read, TWO probe folds.** Ref write-safety §5 wants two probe kinds — "is this person already
being terminated effective THIS DATE?" and "does this person have ANY in-progress termination?" —
and they are two questions about the same rows, not two page visits. `scanTerminationTransactions`
returns every transaction the SS Smart HR surface shows and classifies nothing; the folds live in
`src/stores/ucpath/termination-verdict.ts`. That is §2.8/D194 and D201's shape applied to a WRITE's
preconditions, and it is what lets the sweep and the filing share one read while keeping two
independent permanent keys.

**A DELETE is an external write, so it gets its own transaction — not a step inside a prepare.**
Legacy's `deletePendingTransaction` removes every in-progress `Terminat*` row for the EID and is, in
legacy, *the first mutation the run performs*, with no fence, no permanent key and no read-back
(S30/S31). Here it is `ucpath/delete-pending-terminations`, composed BEFORE the filing, with its own
probe, its own verifier and its own key (the person alone, because no date qualifies "this person has
no in-progress rows"). A crash between a hidden delete and a submit would otherwise leave a run that
had mutated UCPath while claiming to have staged nothing.

**A subject binding may be the NAME, and here it must be.** The wizard's Empl ID field holds the
run's own input echoed back; `#PERSON_NAME_NAME_DISPLAY` is UCPath's own answer to it. Legacy reads
that name **nowhere** in the termination flow — checked against the pinned commit, where
`PERSON_NAME_NAME_DISPLAY` appears only in the Person Profile and PayPath families — which is the
structural cause of the `T002173685` wrong-person termination. The live read then made the anchor
stronger than the design: it renders **zero nodes** until UCPath resolves a person, so the beat-③
subject observation and the `emplid-not-recognized` refusal (S48) are the same check. Because legacy
has no key for it, it stays DRIVER-INTERNAL rather than being published with a fabricated port row —
the rule `new-kronos` set and `kuali` re-applied.

**A closed vocabulary must be read off the surface that renders it, and one system may have two.**
`isUcpathTerminationAction` shipped testing legacy's `/Terminat/i` prefix; the SS Smart HR search
grid and its transaction detail render the PeopleSoft CODE `TER`, and only the *Transactions in
Progress* grid renders `Terminatn`. Legacy uses both matchers, in two different modules, without
saying so. The first live read therefore found a probe that would have answered `absent` about a
person with a Pending termination — the duplicate-filing failure the probe exists to prevent. The
fix accepts either form and neither arm is fuzzy: one is equality against a closed code, the other is
legacy's own prefix. The general rule: **when two surfaces of one system render "the same" field,
read both before assuming one vocabulary**, and let a value that matches neither (`(blank)`, live)
fall through rather than be widened into.

---

## 3. Task stores per system plus pure workflow mini-stores

### 3.1 Layout in the rebuild repo's `src/`

```
src/                            # rebuild repo (hr-automation-rebuild) code root — D93
  domain/
    contracts/                # D3: bundle-safe contract files — zod + domain imports ONLY
      base.ts                 # SystemId, TaskId, Freshness, contract types, defineTaskContract
      ucpath/
        index.ts              # contract barrel — KnownTaskId codegen + pairing guard read this
        search-person-org.ts
        save-oath-signature.ts
      onbase/ …  crm/ …  extraction/ …  normalization/ …  ocr/ …  roster/ …
      workflows/
        verify/merge-enrichment.ts       # pure workflow-specific contract
  base/                       # task.ts (impl types + defineTask), store.ts, errors.ts, session.ts
  stores/
    ucpath/
      index.ts                # defineBrowserStore("ucpath", driver, session, tasks) — THE impl registry
      session.ts              # SessionProvider: login/prepareLogin/resetUrl/idleRefresh/exclusive
      driver/                 # ONLY task-adjacent layer allowed raw Page/Locator access (ref operator-trust)
        index.ts              # typed SystemDriver implementation + named complex operations
        ui-registry.ts        # canonical elements/screens/states/observations
        selectors.ts          # copied/ported verified recipes + provenance (§3.3)
      UI-CATALOG.md           # generated; stable ids/labels/search terms/evidence/task uses
      impl/                   # verbatim-ported leaf drivers (person-org-summary.ts, ss-smart-hr.ts…)
      tasks/
        search-person-org.task.ts      # defineTask(driver, contract, impl) — binds the pair
        save-oath-signature.task.ts
    onbase/ …   crm/ …   kuali/ …
    extraction/               # service store (D4, charter §11): CSV + PDF extraction — sessions: []
    normalization/            # service store: contact/address normalization + typed change provenance
    ocr/                      # service store (D4, charter §11): the OCR provider pipeline
    roster/                   # service store (D4, charter §11): spreadsheet matching — sessions: []
    workflows/
      verify/                 # pure mini-store: effect:"read", sessions:[]; peer-reusable
        index.ts
        tasks/merge-enrichment.task.ts
    common/                   # shared leaf code across stores — home of legacy src/systems/common/ (D15)
  scenarios/                  # strict registered behavior corpus (ref operator-trust)
  knowledge/records/          # active/superseded/retired/unverified structured guidance (ref operator-trust)
```

### 3.2 `defineStore` — one impl registry per task namespace

```ts
// src/base/store.ts
export interface BrowserTaskStore<
  S extends BrowserSystemId,
  Driver extends { system: S },
  T extends Record<string, AnyTaskFor<S, Driver>>,
> {
  namespace: S;
  driver: DriverDeclaration<Driver>;
  session: SessionProvider<S>;
  tasks: T;                            // typed bag — ucpathStore.tasks.searchPersonOrg
}
export interface HeadlessTaskStore<N extends ServiceSystemId | WorkflowStoreId,
  T extends Record<string, AnyReadTaskFor<N>>> {
  namespace: N;
  session?: never;
  tasks: T;
}

export function defineStore<
  S extends BrowserSystemId,
  Driver extends { system: S },
  T extends Record<string, AnyTaskFor<S, Driver>>,
>(
  namespace: S, driver: DriverDeclaration<Driver>, session: SessionProvider<S>, tasks: T,
): BrowserTaskStore<S, Driver, T>;
export function defineStore<S extends ServiceSystemId, T extends Record<string, AnyReadTaskFor<S>>>(
  namespace: S, tasks: T,
): HeadlessTaskStore<S, T>;
export function defineWorkflowStore<Id extends string,
  T extends Record<string, AnyReadTaskFor<`workflow:${Id}`>>>(
  workflowId: Id, tasks: T,
): HeadlessTaskStore<`workflow:${Id}`, T>;
```

- `AnyTaskFor<S, Driver>` constrains every browser-store member's contract-id prefix, concrete
  driver declaration, and every `SessionNeed.system` to `S`. The runtime factory additionally
  requires declaration object identity, so two separately declared same-system drivers cannot be
  interchanged. `AnyReadTaskFor<N>` makes service/workflow stores read-only and
  sessionless; a workflow mini-store cannot obtain `page` or `MutationCapability`. The composition
  root also requires every `workflow:<id>` namespace to match a real descriptor id.
  **A store cannot contain a task that touches another store's system.**
  Cross-system behavior (person-lookup's UCPath+CRM dance) is workflow composition, never a task.
- Runtime validation at module load: duplicate ids, id prefix mismatch → throw.
- The store is the ONLY impl registry; the contract barrel is the ONLY contract registry.
  Descriptors (ref workflow-model), the dashboard task index, and the e2e stub happy paths are projections of
  the **contracts**; the daemon resolves impls through the **store**. Coverage ratchets (all in
  `npm run test:architecture`):
  1. **Pairing guard** — every system or workflow contract is bound by exactly one matching
     `stores/**/tasks/*.task.ts` `defineTask` call, and vice versa (an impl without a contract
     or a contract without an impl fails CI).
  2. **Reachability guard** — each `*.task.ts` export is reachable from its store's `index.ts`
     (kills "wrote the task, forgot the registry").
  3. **Bundle-safety guard** — the import graph of `domain/contracts/**` may reach only zod and
     `domain/` (no Playwright, no `stores/`, no `base/task.ts`).
  4. **Example guard** — every contract's `example` parses through its `output` schema.
  5. **Freshness/provenance guard** — `maxAgeMs: Infinity` requires an adjacent justification
     comment; field overrides must name real output paths; a read contract without both declarations
     fails the factory + types, and derived transforms retain their oldest contributing observation.
  6. **Artifact guard** — task code may reach filesystem/download materialization only through a
     declared content-addressed writer; workflow mini-stores cannot declare artifacts, and mutable
     append/update paths are confined to reviewed serialized projectors.

### 3.3 Porting selectors + knowledge (copy verified recipes; never import legacy runtime)

- **Verified selector recipes are copied/ported into the rebuilt driver with provenance.**
  The rebuild repo never imports or re-exports the legacy repo's `src/systems/**` — under D93 that is
  **structural**, not policed: the two repos share no module graph, so a runtime import across them is
  impossible to write. Each new registry entry records its **legacy-repo commit hash + source path/key**,
  verification date, copied recipe/fallback chain, and rebuild fixture/live
  verification. `ui-registry.ts` assigns stable ref operator-trust `ElementId`s; tasks call the typed driver.
  D90 **cross-repo** change accounting maps later legacy selector maintenance to the affected rebuilt
  ids and requires re-port/reverification where applicable — every legacy maintenance change is
  recorded against the affected capabilities/rebuild evidence in the rebuild repo's
  `config/legacy-change-accounting.json`, referencing legacy-repo commit hashes. The legacy repo
  remains intact and is the sole production authority through the single cutover.
- **Two-commit rule per store:** commit 1 is a faithful copy/port (`impl/*` with only the import-path
  edits required inside the rebuild repo's `src/` — reviewable as zero-logic-diff against the
  legacy-repo source at the recorded commit hash);
  commit 2 wraps `impl` in `defineTask` shells
  + contract files. Re-derivation is forbidden (charter): `// verified <date>` stamps, `.or()`
  fallback chains, `getContentFrame`, employment-instance expansion, Duo two-phase factor logic
  are copied faithfully with source provenance; the legacy originals remain in place.
- Existing LESSONS do **not** move wholesale. Each referenced lesson is triaged during migration:
  active invariant → structured `KnowledgeRecord`; incident-only context → linked incident history;
  superseded/duplicate/incorrect → excluded from the generated active guide. The old LESSONS file
  remains with the legacy repo's store through the single cutover. See ref operator-trust §4.
- The rebuild repo's `npm run ui:catalog` generates the new catalog; its `selector:search` searches
  canonical ids, labels, search terms, active knowledge, and recorded legacy-repo source paths. During
  coexistence the legacy repo's own `selectors:catalog` still serves legacy source in that repo, but it
  is not a second source for new tasks.
- The inline-selector architecture guard is **re-implemented in the rebuild repo** over its own
  `src/stores/*/tasks/**` and workflow code (it is not shared with the legacy repo's copy — the repos
  share no gates). Raw `Page`/`Locator`, `page.` calls, and locator recipes are allowed only under
  `stores/*/driver/**` and session infrastructure. Tasks receive `ctx.driver`.

### 3.4 Service stores — system-less work has a home (D4)

Pure compute and non-browser pipelines get **service stores** under the same contract:

- **`extraction`** — CSV + PDF extraction (onboarding's `extraction` step, filename parsing).
  Deterministic, no I/O beyond the filesystem. Its outputs land in workflow input fields via
  **operator-defined column mapping** (charter §11): the operator connects a source column title to
  a canonical field (e.g. some spreadsheet's column → `eid`); mapped values parse through the
  workflow's zod input schema, so ingest is validated by construction. Full design: ref data-intake-and-edit-data.
- **`ocr`** — the OCR provider pipeline (`src/services/ocr/` ports here): model calls, fabrication
  tiering, tolerant-field handling. External I/O, but no browser; contracts declare
  `providers:["ocr.extract"]` and receive only the injected admitted client.
- **`roster`** — spreadsheet matching, using the same operator-defined column mapping onto
  canonical fields (charter §11). Full design: ref data-intake-and-edit-data.
- **`normalization`** — reusable contact/address cleanup currently split across
  `services/llm/normalize-contact.ts` and `services/address/`. Deterministic phone/state/ZIP rules,
  geocoder reads, and optional model suggestions return a strict discriminated result with one
  provenance-labelled change per field (`rule|census|nominatim|ai`) plus explicit
  `unchanged|ambiguous|unavailable`; provider exhaustion/error can never become “no change.” The
  workflow decides whether an advisory enters an approval gate. Shared provider/rate-limit clients
  live in infra and may also serve OCR; one store never imports another store's implementation.

Rules:
- Same contract types, same id grammar (`extraction/extract-pdf-fields`), same error taxonomy, same
  `example`/`freshness` obligations. A service read that feeds a write (roster match → OnBase
  upload) declares `freshness` like any other read.
- `sessions: []` is legal only in **headless service/workflow stores**; browser stores stay
  type-constrained to exactly one need for their own system, and a browser-store task with empty or
  cross-system sessions fails the types and factory.
- Service-store ctx has no `page` member (type-level) and no session provider; `defineStore` for a
  service system takes no `SessionProvider`. Remote service I/O is not ambient: direct provider SDK,
  `fetch`, or HTTP-client imports are restricted to `infra/providers/**`. A service task declares
  `providers`, and `ctx.providers` is narrowed to exactly those capabilities. Pure extraction/
  roster tasks declare none and cannot call the network.
- Provider adapters apply the immutable Clock/config snapshot, timeout, abort, retry/admission,
  redaction, request/response schema, usage/cost, and evidence policy once. Provider failure is a
  typed unavailable/invalid outcome or a declared task error; no adapter returns an empty value
  that can mean success. D63 budgets and scheduling are owned by ref execution-and-sessions.
- A read that downloads or creates a local file declares `artifacts:"content-addressed"` and receives
  the kernel `ContentAddressedArtifactWriter`; direct mutable-path writes/imports from a task fail an
  architecture guard. A retry can therefore recreate the same cache artifact but cannot append a
  workbook or mutate operator-owned state. Mutable local projections use stable-keyed SQLite outboxes
  and serialized projectors (refs dashboard-surfaces/data-intake-and-edit-data), not task `run` side effects.
- What service stores are NOT: a home for waits. Tracker-subscription waiting (oath-upload's
  approval park) is a **gate** (§2.6, ref workflow-model) — it must not be smuggled in as a `local` task.

The old `services/timecard` is **not** another service store. Its pure calendar/range/year functions
move to Clock-injected domain code; its current→previous orchestration becomes a semantic
`stores/common/timecard.ts` helper over a typed timecard-driver interface. Old/New Kronos retain
only their driver implementations. Raw `Page`, fixed sleeps, optional `new Date()` defaults, and
`null` that conflates navigation failure with a verified no-punch result do not cross the boundary
(D61).

### 3.5 Workflow mini-stores — pure specialization, never a system-policy bypass

`stores/workflows/<id>/` holds only pure, sessionless `effect:"read"` tasks whose contract ids use
`workflow:<id>/<verb-object>`. These are workflow-specific transforms/joins that are still useful to
reuse peer-to-peer (for example verify's typed enrichment merge). If a task navigates a browser,
stages a form, commits, or calls a system-specific external API, it belongs in that system/service
store instead. The descriptor coverage guard proves each workflow namespace exists, and the
headless-store overload makes prepare/commit/page access a compile error.
Workflow mini-stores also reject `artifacts`; peer reuse is contract reuse, never a path to hidden
filesystem state. Their contract/impl files may not import workflow descriptors or another mini-
store's implementation, so peer imports cannot create a runtime module cycle.

---

## 4. Customization / decoration model

### 4.1 The invariant

**A decorated task is the same task.** Decoration returns a value of the *same* type `T` — same
contract, same schemas, same effect, same sessions. Hooks can observe, add side actions
(screenshots, extra validation, waits), and veto by throwing — they can never change the input,
replace the output, or swallow the error.

```ts
// src/base/decorate.ts
export interface TaskHooks<C extends AnyTaskContract> {
  before?: (args: { input: TaskInput<C>; ctx: HookCtx }) => Promise<void>;
  after?:  (args: { input: TaskInput<C>; output: TaskOutput<C>; ctx: HookCtx }) => Promise<void>;
  /** Observe only. The kernel ALWAYS rethrows the base TaskError; if this
   *  hook itself throws, its failure is attached as TaskError.hookErrors —
   *  secondary metadata, never a replacement (D15; pinned by unit test). */
  onError?: (args: { input: TaskInput<C>; error: TaskError; ctx: HookCtx }) => Promise<void>;
}

export function decorateTask<T extends AnyTask>(
  base: T, hooks: TaskHooks<T["contract"]>, label: string,
): T
```

- `HookCtx` = `{ driver (read-only capabilities for the task's system), capture, log, signal }` — no `fail` with
  the task's codes. A `before`/`after` hook that throws produces `code:"decorator-failed"`,
  `decoratedBy: label` — a broken decoration is never attributed to the base task. An `onError`
  hook that throws does NOT produce a new error at all: the base error propagates with the hook
  failure in `hookErrors` (§2.4).
- `after` throwing = extra validation failing loud (e.g. oath-signature asserting the saved page
  shows the expected signature date). The output is still the base task's output — a workflow that
  wants a transformed value does it in the next step's input mapping (§5), pure and typed.
- Stacking: `decorateTask(decorateTask(t, a, "x"), b, "y")` — hooks run outside-in for `before`,
  inside-out for `after` (standard middleware order), pinned by a unit test.

### 4.2 Where instrumentation attaches

| Layer | Mechanism | Example |
|---|---|---|
| One step of one workflow | `.decorate("transaction", hooks, label)` on ref workflow-model's builder | pre/post-submit form screenshots in oath-signature |
| Every step of one workflow | `.instrument(hooks)` on ref workflow-model's builder | per-step audit screenshot policy |
| Every task everywhere | kernel-level span hooks (ref dashboard-surfaces) | step timing, `data:point` lanes |

Today's automatic end-of-step screenshots and error screenshots become kernel span hooks — zero
per-workflow code, same as now, but attached at the task boundary instead of `ctx.step`.

### 4.3 Why adding a task cannot break neighbors

- Tasks are **frozen values with no shared mutable state**. There is no `ctx.data` blob a new task
  could clobber (person-lookup's `startDate`-clobbering bug — active-status overwriting the CRM
  value — is structurally impossible: each output is its own typed record).
- The only inter-task coupling is the **explicit input mapping** (§5). Adding step N+1 adds a key
  to the outputs record; existing mappings don't see it. Removing/renaming an output field breaks
  the *consuming mapping* at compile time — the failure surfaces at the edit, not at runtime.
- Decoration returns the same type, so a decorated step slots anywhere the base did; hooks can't
  alter data flow.

---

## 5. Composition — what the contract requires of the builder

**The workflow builder API itself—read/transaction/branch/fork/child/gate nodes, replay, and
resume—is owned and specified only by ref workflow-model.** This section states the obligations task contracts
impose on that builder; it deliberately does not publish a second API sketch.

- **Compile-time:** every node bind must return exactly `TaskInput<T>` (`z.input`—§2.2) and can only
  read workflow input plus declared upstream node outputs. Rename a task output field → every
  consuming read/transaction/branch/child mapping fails `tsc`.
  That is the charter's "a contract change on one side must fail to compile on the other."
  Ref workflow-model's builder accumulates both exact node outputs and each node's concrete contract tuple so
  decoration remains typed without reducing non-task graph outputs to a broad top type.
- **Runtime:** the kernel parses the mapped value through `contract.input` before `run` (zod is
  the second wall—this is also ref workflow-model's "start from graph node N" entry validation: replayed
  checkpoints flow into `outputs` and any missing required data fails the parse loudly, naming the
  task and field). `run`'s return is parsed through `contract.output` — a task cannot leak an
  out-of-contract shape downstream (today's "stub emitted the display label `"A"` instead of the
  enum" class of bug dies at the boundary it was born).
- Branching/conditional steps, fan-out, gate nodes, and checkpoint/replay are ref workflow-model scope; the
  contract here only fixes what a step IS.

---

## 6. Auth and dry-run as contract concerns

### 6.1 Auth: store-provided, kernel-executed, boilerplate deleted

```ts
// src/base/session.ts
export type LoginResult = "logged-in" | "already-authenticated";

export interface SessionProvider<S extends BrowserSystemId> {
  system: S;
  /**
   * THE one login signature (D15 — review #7 found three incompatible ones).
   * Idempotent: safe to call on an authenticated page (returns
   * "already-authenticated"); throws on failure. The DUO_LOGIN_FLOWS entry
   * itself ports verbatim; its Promise<boolean> result is mapped by a NAMED
   * ADAPTER WRAPPER (asLoginResult) — the wrapper is new code, not a
   * verbatim claim.
   */
  login(page: Page, opts: { instance?: string; signal?: AbortSignal }): Promise<LoginResult>;
  prepareLogin?(page: Page): Promise<void>;
  resetUrl?: string;
  idleRefresh?: IdleRefreshCadence;     // today's IDLE_REFRESH_SYSTEMS entry moves here
  exclusive?: true;                     // OnBase — mirrors SessionNeed.exclusive (SQLite lease, §2.1)
}
```

- The kernel computes a workflow's session set as the **union of its composed tasks' `sessions`** —
  no per-workflow `systems:` list to keep in sync with what the handler actually touches.
- Default is today's eager parallel-staggered Duo chain. A workflow overrides per system with
  `auth: { ucpath: "on-first-use" }` — the kernel then logs in lazily at the first task that
  requests that page. That replaces `deferAuth: true` **and** the entire 15-line hand-rolled
  auth-step boilerplate in 5 workflows.
- **Park/resume (D5):** when a run parks at a gate (ref workflow-model), the kernel closes its contexts and
  only then releases identity-exclusive leases; on resume it reacquires by calling `login` again.
  Idempotency is what makes release-on-park safe. Duo is cleared hands-off by Duo Autopilot inside `login`
  (§2.6, charter §9) — a login either finishes or throws; it never parks.
- When auth must be deliberately delayed (oath-signature: UCPath only after OCR approval), the
  descriptor uses `auth(...:"on-first-use")`; the first downstream node acquisition emits a visible
  session/auth child span. Login is worker-owned session infrastructure, not a fake task contract
  or checkpoint.
- `DUO_LOGIN_FLOWS` itself becomes a projection over `stores[*].session` (key/label/run) — the
  smoke test and live auth test keep deriving from one table, which is now the same table the
  kernel uses.

### 6.2 Dry-run: a graph composition, not a task flag

- `dryRun` rides the **RunEnvelope** (kernel-owned, ref workflow-model — D6), never workflow input or TaskCtx.
- Read nodes execute normally. A transaction node executes its `prepare` arm under a retained page
  lease, records an honest `transaction.previewed` span, and ends the run at the node when dry-run
  policy is `stop-after-prepare`. Its `commit` arm is absent from the executable plan.
  **How it ends is D210, normative in ref workflow-model §2.1:** the outcome is `done` (§10.1's "stops
  successfully", discriminated by `envelope.dryRun`, which is already the durable record of the
  request), and the terminal result is a `RunDryRunPreviewResult` — the prepare output plus the
  beat-③ subject observation, `externalCommit: "none"` — bound to the PREVIEW schema hash rather
  than the workflow's declared result, so no consumer can read a preview as a completed write. The
  authored `derive` is never invoked and no `TransactionOutcome` is fabricated to make it fold.
- A prepare task has no `MutationCapability`; a commit task is never invoked in a dry run. Ported
  external-write helpers accept `CommitTaskCtx["mutation"]`, so read/prepare code cannot call them.
- `dryRun:"unsupported"` belongs on the **transaction node**, not the commit task. The executor
  rejects such a run before launching a browser — and so does the START PLAN, because the node
  declaration is the whole of the answer: **dry-runnability is a property of the graph** (D209, doc
  ref workflow-model §2). A graph is previewable when every transaction node declares `stop-after-prepare`; a graph
  with no transaction node refuses by name rather than trivially succeeding, since previewing it
  would be indistinguishable from running it.
- A genuine no-op established by durable history/live prewrite probe short-circuits before commit
  and yields ref workflow-model's typed `TransactionOutcome{disposition:"already-present"}` reconstructed from
  validated proof. The commit impl is not called and no ledger entry claims this run filed it. It is
  not a dry-run simulation.
- Transaction-node validation proves prepare and commit require the same browser system/context,
  the prepare arm is `in-memory-only`, and there is no gate/checkpoint boundary between them.

---

## 7. Alternative shapes for the core contract

### A. Class-based (`class SearchPersonOrg extends Task<In, Out>`)

*Pros:* familiar OO decoration via subclassing; instanceof dispatch; per-task private helpers.
*Cons:* subclass-decoration is exactly the **fork** we're banning (a subclass can override `run`
wholesale and drift from the base — today's cross-spec `approveTo!` borrowing with more ceremony);
zod schemas as `static` members break inference ergonomics (`z.infer<typeof X.input>` on statics
needs annotations); `this`-binding traps in hooks; metadata is behind a constructor, so descriptor
projection needs instantiation — fatal for the bundle-safe contract split (D3).

### B. Plain object + `defineTaskContract`/`defineTask` factories (recommended)

*Pros:* matches the codebase's proven `defineWorkflow` idiom; **best-in-class zod inference**
(generics flow from the literal object; no annotations at call sites); the contract IS plain data →
descriptors and the dashboard import it directly with no Playwright in the graph (D3); decoration
is a pure wrapper returning the same type (fork-resistant by construction); trivially
unit-testable (`task.impl.run({ input, ctx: fakeCtx })`); load-time validation in two small
factories.
*Cons:* no inheritance for shared behavior — shared behavior must live in `impl/` helpers (which is
what we want); the generic signatures of the factories are gnarly (one-time cost in
`domain/contracts/base.ts` + `base/task.ts`).

### C. Fluent builder (`task("ucpath/x").input(S).output(S).run(fn)`)

*Pros:* reads nicely; can stage type inference per call.
*Cons:* partially-built states exist at runtime (forgot `.run()` compiles until the terminal call is
required — needs extra type machinery); worse error locality (a schema mismatch points at the
builder chain, not a field); more base machinery to maintain; harder to grep (task shape varies).

**Recommendation: B.** It is the only shape where (a) the contract is inert data the descriptor
layer can import without executing anything, (b) decoration structurally cannot fork the base, and
(c) the team's existing mental model (`defineWorkflow`) carries over. The builder shape is retained
**only** for workflow composition (ref workflow-model), where accumulating generics genuinely need staged
inference — tasks stay plain objects.

---

## 8. Adversarial self-review — rot vectors and their guards

| # | How it rots back | Mechanical guard |
|---|---|---|
| 1 | **Parallel lists return** — someone hand-maintains a task list beside the stores (icons, labels, stubs) | Contracts + stores are the only sources; the pairing/reachability ratchets (§3.2) fail CI on an unregistered task; every projection (descriptor, dashboard, stub happy paths) is generated from contracts and has its own guard, per charter #5 |
| 2 | **Stringly dispatch** — `switch (taskId)` re-encoding store knowledge (the `operationTraceCode` pattern) | `KnownTaskId` is codegen'd from all system/service/workflow contract barrels; a ratchet forbids task-id literals (including `workflow:*`) outside contracts, stores, descriptors, and generated files; typed `Record<KnownTaskId, X>` maps get compiler exhaustiveness |
| 3 | **Silent fallbacks in wrappers** — `catch { return { results: [] } }` in a task shell | The `fail-loud-catch-default` + `nullish-literal-data-fallback` ratchets are re-implemented in the rebuild repo over its own `src/` from day one (charter non-negotiable); plus: the kernel rethrows the base TaskError unconditionally and a unit test pins that an `onError` hook failure lands in `hookErrors`, never replacing the base error (D15) |
| 4 | **Effect misdeclaration** — an external write hides in read/prepare code | Verb↔effect ratchet (`fill|stage`→prepare; `save|submit|upload|create|update|delete`→commit); external-write helpers require the unforgeable `MutationCapability`, which exists only on `CommitTaskCtx`; dry-run plans contain zero commit nodes |
| 5 | **God tasks** — a task grows into a mini-workflow spanning systems | Browser store sessions are constrained to that system; service/workflow stores are sessionless and have no page. Cross-system logic physically belongs in graph composition |
| 6 | **The untyped blob returns** — someone adds `any`/`Record<string, unknown>` side channels for display data | `CanonicalJsonSchema` rejects `any`/non-JSON outputs; `TaskCtx` has no `updateData`; display fields are projections of typed outputs (ref dashboard-surfaces); a ratchet forbids `z.record(` in contract `output` schemas without an allowlist entry |
| 7 | **Auth boilerplate re-accretes** — a workflow hand-rolls a login step | Auth timing is descriptor policy and execution is worker-owned; a grep-ratchet forbids login-task contracts and importing `stores/*/session.ts` login functions from workflows |
| 8 | **Retry as a fallback** — cranking attempts to paper over a broken selector | `attempts` typed `2 \| 3`; `retryOn` has one value (`"transient"`); business-code errors are never transient unless the throw site explicitly claims it, which the fail-loud review catches |
| 9 | **Decoration forks** — copying a base task file to tweak it | One-task-one-file + duplicate-id load-time throw; a ratchet flags two tasks whose `run` bodies import the same `impl` entry function with >90% identical text (cheap AST-less heuristic, allowlisted) |
| 10 | **Verified legacy knowledge drifts after it is ported** | The bidirectional runtime-import guard (`src`↔`temp_src`) is **retired by D93** — separation is now physical (two repos, no shared module graph), so cross-runtime import is structurally impossible and needs no guard. The load-bearing mitigation is therefore **D90 cross-repo change accounting**: every copied selector/leaf records its legacy-repo commit hash + source path/key + verification evidence, and every legacy maintenance change is booked in the rebuild repo's `config/legacy-change-accounting.json` against the affected rebuilt capability ids, forcing re-port/reverification. The legacy repo is preserved wholesale through the single cutover |
| 11 | **Contract/impl drift** — a contract edited without its impl (or vice versa), or a contract quietly importing server code | Pairing guard + bundle-safety import-graph guard (§3.2); the impl's `run` is typed against the contract's schemas, so a schema edit fails `tsc` in the impl; `example` re-parses on every CI run |
| 12 | **Stale reads feeding writes** — a resumed run replays an old checkpoint into a commit | freshness+provenance metadata are mandatory on every read; derived outputs retain oldest input observation; `Infinity` needs a justification comment; graph dependencies are declared, never inferred by executing JavaScript bind functions (ref workflow-model) |
| 13 | **Undeclared error codes** — `ctx.fail` drifting to arbitrary strings | `const Codes` literal-tuple inference + a checked-in type-level test pinning that an undeclared code fails `tsc` (D15) |
| 14 | **A read task hides a mutable local write** — retry duplicates a workbook row or overwrites an operator edit | read tasks can access only the content-addressed artifact writer when declared; direct mutable filesystem writes fail a guard; mutable sinks are stable-keyed serialized outbox projections (refs dashboard-surfaces/data-intake-and-edit-data) |
| 15 | **TypeScript interface mistaken for runtime validation** — malformed JSON/DB/event payload is cast and reaches a write | every boundary owns a strict zod schema and parses on ingress/read; guard rejects non-strict persisted/wire objects and unchecked `as` casts at boundary adapters |
| 16 | **Person input mistaken for page identity** — a stale employee remains open after a search | explicit subject scope on every task; reads that consume an already-open subject and every transaction resolve a registered authoritative observation at the declared point; wrong/unknown proof fails before extraction/commit; scenario corpus pins the New Kronos stale-timecard case |
| 17 | **Selector duplication returns behind task helpers** | tasks cannot import `Page`/`Locator`, legacy selector maps, or locator recipes; only the driver layer can, and every task-used element/state/observation resolves through the ref operator-trust registry |
| 18 | **One example masquerades as behavioral coverage** | contracts reference registered scenarios; error codes, wrong-subject, unexpected-state, cancellation, and transaction failure obligations are checked by ref guards-and-tests's scenario-coverage guard |
| 19 | **A service task hides provider/network I/O in an import** | service contracts declare provider capabilities; task ctx exposes only injected narrowed clients; direct SDK/fetch imports outside registered infra adapters fail the D63 guard; provider budgets/preflight/scenarios are bidirectionally covered |

Honest residual risks (no full mechanical guard): (a) *output schemas that are too loose*
(`z.string()` where an enum belongs) — mitigated by review + the stub-must-emit-canonical-values
lesson becoming a test-fixture convention (the mandatory `example` at least pins one canonical
value per contract); (b) *the `impl/` layer quietly growing new unported logic* — mitigated by the
two-commit rule but ultimately a review discipline.

---

## 9. Worked example — three real tasks, decoration in practice

### 9.1 `ucpath/search-person-org` (read) — the canonical example (D16)

**Defined once, here; ref workflow-model imports it verbatim.** The output shape is taken from the REAL
primitive it wraps — `lookupPersonInUcpath` (`src/workflows/person-lookup/lookup.ts`), which
returns `PersonLookupRunResult { input, results, selection, allAttempts }` built from
`EidResult` (`src/systems/ucpath/person-org-summary.ts:132`) and `PersonLookupSelection`
(`src/workflows/person-lookup/outcome.ts:39`). Two deliberate exclusions from the contract:
`allAttempts` (the per-strategy search trail — audit material for ref dashboard-surfaces's notes stream, not data
a downstream step may key on) and `EidResult.rowIndex` (a page-local drill-in artifact).

```ts
// src/domain/contracts/ucpath/search-person-org.ts — bundle-safe: zod only
import { z } from "zod";
import { defineTaskContract } from "../base.js";

const Query = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("by-name"), name: z.string().min(1),
                   keepNonHdh: z.boolean().default(false) }),
  z.strictObject({ kind: z.literal("by-eid"), emplId: EidSchema }),
]);

/** Mirrors EidResult (person-org-summary.ts) — required/optional per the real interface. */
const Candidate = z.strictObject({
  emplId: EidSchema, emplRecord: z.string(),
  name: z.string(), lastName: z.string(),
  hrStatus: z.string(), businessUnit: z.string(),
  jobCode: z.string(), jobCodeDescription: z.string(),
  // Populated after drill-in — optional on the real interface:
  department: z.string().optional(), deptId: z.string().optional(),
  positionNumber: z.string().optional(),
  startDate: z.string().optional(),        // ORG Instance Last Hire — NOT the assignment EFFDT
  effectiveDate: z.string().optional(),    // selected assignment-row EFFDT
  terminationDate: z.string().optional(),
  terminationReason: z.string().optional(),
  expectedJobEndDate: z.string().optional(),
  fte: z.string().optional(), emplClass: z.string().optional(),
});

const EXAMPLE_CANDIDATE: z.input<typeof Candidate> = {
  emplId: "10873698", emplRecord: "0", name: "Nguyen,Amy", lastName: "Nguyen",
  hrStatus: "Active", businessUnit: "SDCMP", jobCode: "004723",
  jobCodeDescription: "BLANK AST 3", department: "HOUSING/DINING/HOSPITALITY",
  deptId: "000123", positionNumber: "40012345",
  startDate: "09/15/2025", effectiveDate: "01/01/2026",
};

export const SearchPersonOrg = defineTaskContract({
  id: "ucpath/search-person-org",
  title: "UCPath Person Org search",
  effect: "read",
  /** Identity/status data that may feed a live write (separations feeds a
   *  termination off it). A checkpoint older than 15 min may not feed a
   *  commit task on resume (D8; enforcement walk in ref workflow-model). */
  freshness: { defaultMaxAgeMs: 15 * 60_000 },
  provenance: { default: "live" }, // this execution read the authoritative UCPath grid
  subject: { kind: "none", reason: "identity-search" }, // resolves identity; no subject is open yet
  scenarios: [
    "ucpath/search-person-org/by-eid-found",
    "ucpath/search-person-org/not-found",
    "ucpath/search-person-org/ambiguous",
    "ucpath/search-person-org/unexpected-grid",
  ],
  input: Query,
  // Mirrors PersonLookupRunResult minus allAttempts (audit → notes stream):
  output: z.strictObject({
    results: z.array(Candidate),
    selection: z.strictObject({
      status: z.enum(["resolved", "not-found", "ambiguous"]),   // PersonLookupStatus, verbatim
      searchName: z.string(),
      selected: Candidate.nullable(),
      candidateEids: z.array(z.string()),
    }),
  }),
  errorCodes: ["results-grid-missing", "drill-in-failed"],
  example: {
    results: [EXAMPLE_CANDIDATE],
    selection: { status: "resolved", searchName: "Nguyen, Amy",
                 selected: EXAMPLE_CANDIDATE, candidateEids: ["10873698"] },
  },
});
```

```ts
// src/stores/ucpath/tasks/search-person-org.task.ts — server-side impl
import { defineTask } from "../../../base/task.js";
import { SearchPersonOrg } from "../../../domain/contracts/ucpath/search-person-org.js";
import { ucpathDriver } from "../driver/declaration.js";
import { lookupPersonInUcpath } from "../impl/person-lookup.js";   // ported primitive

export const searchPersonOrg = defineTask(ucpathDriver, SearchPersonOrg, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  retry: { attempts: 2, backoffMs: 2000, retryOn: "transient" },
  run: async ({ input, ctx }) => {
    // Named driver operation wraps the verbatim-ported employment-instance expansion and
    // preferred-row selection; actions still resolve through canonical UI ids/page states.
    const lookup = await ctx.driver.searchPersonOrg(input,
      input.kind === "by-name" ? { keepNonHdh: input.keepNonHdh } : {});
    ctx.recordData({ direction: "read", field: "candidates", value: String(lookup.results.length) });
    return { results: lookup.results, selection: lookup.selection };
  },
});
```

Note what vanished versus today's `searchingStep`: no `ctx.updateData` stamping (projection's job),
no inline screenshot policy (decoration/kernel), no `dataString` casts, no per-call-site error
prose rules ("never stamp prose into emplId" is structurally dead — `emplId` isn't a writable blob
field). And note the `z.input`/`z.output` split working: a mapping may omit `keepNonHdh`
(defaulted), while `run` receives it as a definite `boolean`.

### 9.1.1 CRM Person Lookup reads — source semantics and subject binding (D108)

`crm/read-onboarding-record` retains the source's exact non-empty Process Stage label as
`rawStage`; it does **not** fabricate a normalized status or an `updatedAt` timestamp that the
live record page does not prove. The record identity is the URL record id plus the displayed
UCPath EID and full name. `crm/read-onboarding-dates` owns exactly three business dates:
`invitedOn` is the Onboarding History transition whose New Value is `Offer Letter Sent`,
`startsOn` is the record's First Day of Service, and `completedOn` is the history transition whose
New Value is `Completed`. `Date Signed` is not a completion timestamp and may not substitute for
one. A verified blank becomes that field's explicit `absent` arm; a missing selector, malformed
history row, or indeterminate page state throws.

Both tasks return a typed subject binding beside the extracted output. A found record proves the
registered displayed-EID observation; a genuine zero-result search proves the exact EID query and
may return only an absent result (or all-absent dates). The task compares the requested EID, binding
EID, and every output EID before returning. Any mismatch uses the declared `subject-mismatch` error
code; it never becomes an empty record, first result, or name-based guess.

### 9.2 OnBase import — separate prepare/commit contracts, one transaction lease

```ts
export const FillImport = defineTaskContract({
  id: "onbase/fill-import",
  title: "Fill OnBase import",
  effect: "prepare",
  checkpoint: "in-memory-only",
  subject: { kind:"person", expected:{fromInput:"emplId", identity:"eid"},
             observe:"onbase.import.employee-eid", match:"normalized-exact-eid",
             requiredAt:"after-prepare-before-fence" },
  scenarios: ["onbase/import/prepare", "onbase/import/wrong-subject", "onbase/import/form-missing"],
  input: z.strictObject({
    pdf: ArtifactRefSchema, docType: z.string().min(1),
    emplId: EidSchema, personName: z.string().min(1),
  }),
  output: z.strictObject({ stagedFields: z.array(z.enum(["docType", "emplId", "personName"])) }),
  errorCodes: ["import-form-missing", "field-rejected", "session-held-elsewhere"],
  example: { stagedFields: ["docType", "emplId", "personName"] },
});

export const SubmitImport = defineTaskContract({
  id: "onbase/submit-import",
  title: "Submit OnBase import",
  effect: "commit",
  subject: { kind:"person", expected:{fromInput:"emplId", identity:"eid"},
             observe:"onbase.import.employee-eid", match:"normalized-exact-eid",
             requiredAt:"after-prepare-before-fence" },
  scenarios: ["onbase/import/commit", "onbase/import/proof-unknown", "onbase/import/crash-after-click"],
  input: z.strictObject({ emplId: EidSchema, documentDigest: Sha256Schema }),
  output: z.strictObject({ proof: OnBaseUploadProofSchema }),
  errorCodes: ["upload-unverified", "session-held-elsewhere"],
  example: { proof: ONBASE_UPLOAD_PROOF_EXAMPLE },
  writeSafety: onBaseUploadSafety, // ref write-safety: typed state/artifact proof
});

export const fillImport = defineTask(onbaseDriver, FillImport, {
  sessions: [{ system: "onbase", access: "transaction", session: "reuse-worker", exclusive: true }],
  run: async ({ input, ctx }) => {
    await ctx.driver.goto("onbase.import.form");
    const staged = await ctx.driver.fillImportFields(input);
    return { stagedFields: staged };
  },
});

export const submitImport = defineTask(onbaseDriver, SubmitImport, {
  sessions: [{ system: "onbase", access: "transaction", session: "reuse-worker", exclusive: true }],
  run: async ({ input, ctx }) => {
    await ctx.driver.commitImport("onbase.import.submit", ctx.mutation);
    return { proof: await ctx.driver.verifyImportedDocument(input) };
  },
});
```

Ref workflow-model pairs these in one `transaction` node. The kernel retains the same OnBase page/context and
global identity lease from the first prepare action through commit verification. Dry-run executes
`fillImport` and stops; `submitImport` is not in the executable plan.

### 9.3 Decorating (oath-signature's transaction audit shots)

Decoration is this doc's; the full composed person-lookup flow (binding, conditional steps, gates)
lives in ref workflow-model §3.2 and imports these contracts verbatim (D16).

```ts
const auditedSave = decorateTask(ucpathStore.tasks.saveOathSignature, {
  before: async ({ ctx }) => ctx.capture("oath-staged"),
  after:  async ({ ctx }) => ctx.capture("oath-saved"),
}, "oath-form-audit");
// same type as the base — slots into any step the base fits; on the builder,
// the equivalent is .decorate("transaction", hooks, "oath-form-audit") (ref workflow-model).
```

---

## 10. Settled design questions

1. ~~Dry-run continuation~~ — **resolved 2026-07-21:** a dry run stops successfully after the first
   transaction prepare arm by default. A later preview-only graph may continue only through nodes
   whose inputs do not depend on a commit output; the graph validator proves that dependency.
2. ~~Session lifetime ownership for OnBase exclusivity~~ — **resolved:** cross-process SQLite
   lease covers the authenticated context lifetime; context closes before lease release (§2.1).
3. ~~`errorCodes` granularity~~ — **resolved 2026-07-21:** contracts declare per-task literal tuples.
   Shared error-code constants may live in a store, but each task explicitly selects its subset;
   near-duplicate codes are preferable to a broad code a task can never emit.
4. ~~Screenshot policy default~~ — **resolved 2026-07-21:** browser tasks capture the existing
   automatic terminal audit screenshot through a kernel hook. Service/workflow tasks have no
   screenshot ctx. Additional shots are explicit decoration; removing the terminal shot requires a
   named system-level privacy/volume policy, not a per-workflow silent opt-out.
5. ~~`KnownTaskId` codegen timing~~ — **resolved 2026-07-21:** checked in for reviewable diffs;
   generation runs in the normal build and a freshness guard fails when the file differs.
