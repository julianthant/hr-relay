# The task contract — `defineTaskContract`/`defineTask`, effects, drivers, provenance, and the per-system task stores

**What this doc is.** The contract every unit of real work in this system is written against: what a
task IS (§2), where its implementation lives (§3), how it is instrumented (§4), what it asks of the
workflow builder (§5), and how authentication and dry-run reach it (§6). It is a REFERENCE spec —
cited as `ref task-contract §N`, never actionable on its own. What is scheduled and what is left
lives in the phase docs `docs/rebuild/00`–`05` and in `docs/roadmap/roadmap.md`.

**It is as-built, not aspiration.** The contract shipped in Phase 1d (2026-08-01) and has executed
every run since 1f. At HEAD the tree holds **39 sealed task contracts** under
`src/domain/contracts/<store>/` — 29 in system stores (`ucpath` 10, `kuali` 10, `crm` 2,
`new-kronos` 2, `extraction` 2, `normalization` 1, `ocr` 1, `roster` 1) and 10 in the two workflow
mini-stores (`workflow:separations` 9, `workflow:person-lookup` 1) — bound by 16 store directories
under `src/stores/`: nine browser stores (one per closed `BrowserSystemId`), four service stores,
two workflow mini-stores, and `common/`, which is shared leaf code and not a store. Four guards in
`docs/rebuild/guard-inventory.json` name this doc as an owner: `task-contract-sealing`,
`task-store-boundaries`, `artifact-effect-boundary` and `provider-capability-boundary`.

**How to read it.** §1 is the legacy grounding — the four failure shapes the contract exists to
kill. §2 is the contract: §2.1–§2.7 the platform half (types, the contract/impl split, the ctx, the
error taxonomy, naming, the boundary, the authoring floor), then §2.8–§2.12 the **store
conventions the order-8 migration settled**, each pinned to the store that forced it. §3 is where
implementations live, §4 decoration, §5 the obligations this contract imposes on `ref
workflow-model`'s builder, §6 auth and dry-run. §8 is the rot table, §9 three worked examples, §10
the settled questions. Where the code and an earlier sentence disagreed, the sentence was corrected
to the code (cohesion plan R9/D252) and the correction says which file settled it.

**Status blocks.** A section that describes a tree node carries `<!-- roadmap: <id> -->` and, once
per node per doc, a `<!-- roadmap-status: <id> -->` checklist the roadmap generator renders in that
node's drawer. Where a node's checklist lives under a different section of this doc, the section
says so in one line rather than opening a second block.

Conforms to `reference/charter.md` and the decision ledger `reference/decisions.md`.

## Ownership (D1 — this doc owns / this doc references)

| This doc **owns** (siblings reference, never redefine) |
|---|
| The task contract and **contract/impl split** (`defineTaskContract` + `defineTask`), system/workflow namespace grammar + closed `SystemId` (D2/D3/D42) |
| Error taxonomy (`TaskError`, declared `errorCodes`) |
| Effect classes + dry-run mechanics (D6/D7), `freshness` + provenance contract fields (D8/D34), and the content-addressed read-artifact boundary (D45) |
| Strict runtime-schema rules, branded domain scalar/id policy, absence semantics, and the task-side subject-binding declaration (D46/D47) |
| The **read-extraction width** convention — one task per page visit, one fixed strict output, consumers project downstream (§2.8, D194), plus the as-built rules the first store BUILT (§2.9, D196), the first store CUSTOMIZED (§2.10, D197), the first store to split judgment out of a read (§2.11, D201) and the first store to gain a WRITE family beside a read family (§2.12, D206) settled |
| Retry policy |
| Decoration (`decorateTask`, hook semantics, error-propagation rule) — **designed, not built**; §4 states the absence |
| Task stores — browser, service, and pure workflow mini-stores (D4/D42), session providers + the single login signature, shared leaf-code homes (`stores/common/`) |
| The task **boundary** statement — tasks are bounded; what is NOT a task (D5's task side) |

| This doc **references** (owner) |
|---|
| Workflow builder API (the single API), descriptor shape, RunEnvelope, run-state machine incl. **gates/parks**, checkpoint/resume + the freshness enforcement walk → **ref workflow-model** |
| Span/event wire schema, notes stream, completion (fan-out/approval) union, storage + SSE → **ref dashboard-surfaces** |
| `WriteSafety<In, Out, Proof>` shape attached to `CommitTaskContract` (typed proof/verify + idempotency probe + key, D22/D31) → **ref write-safety** |
| Canonical `ElementId`/`PageStateId`/`ObservationId`, typed `SystemDriver`, scenarios, diagnostics, and knowledge records → **ref operator-trust** |
| The store CATALOG — every store, every task, and the REUSE / CUSTOMIZE / BUILD reading a migration starts from → **`STORES.md`** (derived from code; code wins on any disagreement) |

## § numbers, and what moved (2026-08-21)

Section numbers are load-bearing: thirteen tree nodes carry a `ref:task-contract §N` ref that the
`roadmap-doc-binding` guard resolves against a real heading (§2, §2.1.1, §2.7, §2.8, §2.9, §2.10,
§2.11, §2.12, §3.1, §6.2, §9.1, §9.1.1, §9.2), and code comments and sibling docs cite others. So
**no section was renumbered.** What moved is narrative, not numbering:

| was | is now |
|---|---|
| the opening `Status:` paragraph and its six dated amendment clauses | this header, which states what the doc IS rather than when it changed |
| the grounding paragraph of legacy paths, above §1 | inside §1, whose whole subject it is |
| `## Phase 1b as-built domain foundation` | folded into §2.1.1 (cohesion plan R9 item 1) |
| `## Phase 1d ratified seam decisions` + `### Phase 1d as-built — sealed task-contract core` | folded into §2.1 (D96/D101) and §2.2 (the factory as it shipped) |
| `### Phase 1d as-built — bounded task/store/session/provider/artifact seam` | folded into §2.3 (ctx, artifacts, providers) and §3.2 (the store factories) |
| `### Phase 1d as-built — the first `stores/common/` leaf` | folded into §3.3 (the port rules it settled) with the layout half in §3.1 |
| `## Phase 1f executor ratification` | folded into §2.3 — provenance collection and provider admission are both ctx contracts |
| `## 7. Alternative shapes for the core contract` + `### A/B/C` | `history/superseded/2026-08-21-task-contract-7.md`; shape B is normatively stated in §2.2 |

`### 2.11` stood between §2.8 and §2.9 since 2026-08-12; the four store sections now read
§2.9 → §2.10 → §2.11 → §2.12, which is also their chronological order.

---
## 1. What today's code teaches us (the problems the contract must kill)

**Grounding — read, not imagined.** Every path in this block is a **legacy-repo** path
(`hr-automation`, the frozen production reference, D93/D94); unqualified `src/` everywhere else in
this doc is the rebuild repo's own `src/`. `src/core/kernel/types.ts`
(WorkflowConfig/Ctx/SystemConfig), `src/workflows/person-lookup/workflow.ts` (the `dataString()`
untyped-blob hacks, screenshot sprinkling, `ctx.data.crmMatch as string`),
`src/workflows/person-lookup/lookup.ts` + `src/systems/ucpath/person-org-summary.ts` (the real
search shapes §9.1's worked example wraps), `src/workflows/oath-signature/workflow.ts:240-300` (the
deferAuth + `loginToUCPath` + `if (!ok) throw` boilerplate), `src/infra/auth/duo-login-flows.ts`
(the well-factored login table — the shape to imitate), `src/systems/ucpath/selectors.ts` (registry
pattern + `// verified` stamps), `src/systems/onbase/LESSONS.md` (single-app-session-per-identity
constraint), `src/workflows/ocr/orchestrator.ts:1562` (`operationTraceCode` — the cautionary
stringly re-encoding switch).

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

**What the rebuild actually did with each.** (1) and (2) are structurally dead: a task declares its
`sessions`, `effect`, `errorCodes` and retry, and there is no `ctx.data` blob to cast out of — see
§2.1 and §4.3. (3) is dead: nine stores declare one `SessionProvider` each and the worker executes
the login (§6.1). (4) is only PARTLY dead: nothing re-encodes task ids in a switch today, but the
`KnownTaskId` codegen §2.5 and §8 row 2 name as the mechanical guard **was never built** — what
holds the line instead is that `TaskId` is a branded literal type minted by `taskId(...)` and every
projection derives from the contract corpus (§3.2). (5) held: `stores/*/impl/**` carries ported
leaves with provenance, and `legacy-selector-port-provenance` pins 406 keys to a fixed legacy
commit's blobs.

## 2. The Task contract

<!-- roadmap: p1-authority -->
<!-- roadmap-status: p1-authority -->
- [x] `defineTaskContract`'s three effect overloads validate, parse the `example`, deep-seal and register the object in a module-private WeakSet, so `defineTask` can refuse anything it did not mint (`src/domain/contracts/base.ts`; D96–D101, Phase 1d)
- [x] `defineTask`'s four overloads bind an impl to a sealed contract and re-check effect↔access, session system, OnBase-only exclusivity, download↔content-addressed agreement, read-only retry and headless restrictions at runtime (`src/base/task.ts`)
- [x] the three store factories and the registry's both-directions corpus match — every registered task is in the corpus, every corpus id has an implementation, every scenario/probe/verifier reference resolves (`src/base/store.ts`; guard `task-store-boundaries`)
- [x] all nine closed browser systems have exactly one store; four carry a `semantic-ready` driver declaration and a bound login recipe (`ucpath`, `crm`, `kuali`, `new-kronos`), five are declaration-only with no `BROWSER_SYSTEM_BINDINGS` entry (`i9`, `onbase`, `old-kronos`, `servicenow`, `sharepoint`)
- [x] 39 sealed contracts across 10 namespaces at HEAD, all bound: `config/pending-impl-bindings.json` is the checked-in empty set D107 requires
- [ ] `decorateTask` and its hook semantics (§4) have no module in `src/` — the instrumentation the model describes is not available to a workflow today
- [ ] the `KnownTaskId` codegen §2.5 and §8 row 2 name as the anti-stringly-dispatch guard was never built
> 2026-08-21 | docs-cohesion 5.1 task-contract | verified against src/domain/contracts/base.ts, src/base/{task,store,session}.ts, src/stores/*/index.ts and src/infra/browser/system-bindings.ts; left: decoration (§4) and the two generators (§2.5, §2.7), each named where it is promised
<!-- /roadmap-status -->

§2.1–§2.7 are the platform half of the contract — the types, the split, the ctx, the errors, the
naming, the boundary and the authoring floor. §2.8–§2.12 are the **store conventions** the order-8
separations migration settled: how wide a read is, and what a store owes when it is built, when it
is customized, when judgment must leave a read, and when a write family joins a read family.

### 2.1 Core types

The shipped types live in `src/domain/contracts/base.ts` (bundle-safe: zod plus `src/domain/**`
only — no Node built-in, no `src/base/**`) and `src/base/task.ts` (server-side). The sketch below
is the contract they encode; **where it and the files differ, the files win** and the difference is
a defect in this doc.

**Every closed identity is imported, never re-declared (D101).** `src/domain/ids.ts` owns
`BrowserSystemId`, `ServiceSystemId`, `ProviderCapabilityId`, `TaskId`, `TaskStoreId`, the semantic
UI ids and every branded scalar; contract and store modules re-export them and never mint a second
union. Adding a system is a one-line edit in ONE file (D2).

```ts
// src/domain/ids.ts — the closed unions (D2/D101)
BrowserSystemId  = "ucpath" | "crm" | "onbase" | "kuali" | "servicenow"
                 | "i9" | "new-kronos" | "old-kronos" | "sharepoint";   // 9, named after the REAL
                                                                        // systems: old-kronos = UKG,
                                                                        // new-kronos = WFD/Dayforce
ServiceSystemId  = "extraction" | "normalization" | "ocr" | "roster";   // system-less work (D4, §3.4)
SystemId         = BrowserSystemId | ServiceSystemId;
ProviderCapabilityId = "ocr.extract" | "geocode.census" | "geocode.nominatim" | "ai.advisory"; // D63
TaskStoreId      = SystemId | `workflow:${WorkflowId}`;                  // §3.5's mini-stores

/** A BRANDED string, not a template type: one regex pins `<registered-store>/<kebab-case-operation>`
 *  for all 13 namespaces plus `workflow:<id>`. `taskId("ucpath/search-person-org")` parses AND keeps
 *  the literal in the type as LiteralTaskId<"ucpath/search-person-org">, which is what lets
 *  NamespaceOf<C> resolve a store from a contract without a second declaration. */
const id = taskId("ucpath/search-person-org");
```

```ts
// src/domain/contracts/base.ts — what every contract carries
interface TaskContractBase<Id, Input, Output, Codes> {
  readonly id: Id;                        // TaskId, parsed by the factory
  readonly title: string;                 // the DEFAULT for the descriptor's step label (D16);
                                          // the only override layer is operator presentation
  readonly input: Input;                  // zod, recursively strict
  readonly output: CanonicalJsonSchema<Output>;   // rejects `any` and non-JSON at compile time
  readonly errorCodes: readonly [string, ...string[]];   // kebab-case, unique, non-empty
  readonly requires?: readonly SecretName[];             // shape owned by ref clock-config-secrets
  readonly providers?: readonly ProviderCapabilityId[];  // service-store reads ONLY (D63)
  readonly subject: SubjectBindingSpec;   // explicit; never omitted
  readonly scenarios: readonly ScenarioId[];             // non-empty except for a workflow: read
  readonly example: z.input<Output>;      // mandatory canonical output value
}

// the three effect arms
ReadTaskContract    += { effect: "read"; freshness: FreshnessPolicy; provenance: ProvenancePolicy;
                         artifacts?: "content-addressed" }
PrepareTaskContract += { effect: "prepare"; checkpoint: "in-memory-only" }
CommitTaskContract  += { effect: "commit"; writeSafety: WriteSafety<Input, Output, Proof> }  // ref write-safety
```

**`effect` is the whole safety story in one field.** `read` observes; `prepare` mutates only
ephemeral browser state and is legal only as the first arm of a transaction node (ref
workflow-model); `commit` is the sole class whose ctx carries a `MutationCapability` and therefore
the sole class that can reach an external-write primitive (§2.3, ref write-safety §3). The
verb↔effect table is enforced, not advisory (§2.5).

**Freshness and provenance are mandatory on every read (D8/D34), and both are field-resolvable.**

```ts
FreshnessPolicy  = { defaultMaxAgeMs: number | Infinity;
                     defaultOverride?: "forbidden" | "audited";
                     byField?: { path: ContractFieldPath; maxAgeMs; override? }[] }
ProvenancePolicy = { default: "live" | "derived";
                     byField?: { path: ContractFieldPath; source: "live" | "derived" }[] }
```

`ContractFieldPath` is a branded dot path the factory resolves against the **exact output schema**
(`assertSchemaOwnsPath`), so a policy naming a field the output does not have fails at module load
rather than silently applying to nothing. A duplicate or contradictory `byField` provenance rule is
refused by the schema itself. `Infinity` is legal, must be written literally, and is the one place
a non-finite number may appear in this system (§2.1.1). The freshness ENFORCEMENT walk — which
checkpoint may feed which commit on resume — is kernel behaviour owned by ref workflow-model;
`live` versus `derived` is checked per execution by the collector in §2.3.

**The subject binding is declarative, and its `none` arm is two different facts.**

```ts
SubjectBindingSpec =
  | { kind: "none"; reason?: string; reviewedReasonId?: UnscopedCommitReasonId }
  | { kind: "person";   expected: { fromInput: ContractFieldPath;
                                    identity: "eid" | "name" | "eid-and-name" };
      observe: ObservationId; match: "normalized-exact-eid" | "normalized-exact-name" | "eid-and-name";
      requiredAt: "before-subject-read" | "after-prepare-before-fence" }
  | { kind: "artifact"; expected: { fromInput: ContractFieldPath;
                                    identity: "artifact-id" | "sha256" | "document-id" };
      observe: ObservationId; match: "exact"; requiredAt: … }
```

The two `none` fields are mutually exclusive and the factory decides which by EFFECT: a
non-commit contract must give free-text `reason` and may not claim review; an **unscoped commit**
must name a `reviewedReasonId` present in `UNSCOPED_COMMIT_REASON_REGISTRY` and may NOT give free
text (ref write-safety). `identity` and `match` must agree for a person (`eid` ⇒
`normalized-exact-eid`, and so on), the observation must belong to the contract's own system, and a
person-scoped or artifact-scoped **commit** must observe `after-prepare-before-fence` — any other
timing is refused at definition. A service or workflow contract cannot declare a browser
observation at all.

```ts
// src/domain/session.ts — what an impl declares it needs (D96)
SessionNeed = { system: BrowserSystemId;
                access: "read" | "transaction";        // must agree with effect: read→read,
                                                       // prepare/commit→transaction
                session: "reuse-worker" | "fresh";     // a fresh boundary is explicit
                exclusive?: true;                      // OnBase ONLY — one live app session per
                                                       // identity, held by a cross-process SQLite
                                                       // lease from before the context opens until
                                                       // after it closes (D15; ported from legacy
                                                       // src/systems/onbase/LESSONS.md)
                acceptDownloads?: true }               // legal only on a content-addressed read

RetryPolicy = { attempts: 2 | 3; backoffMs: number; retryOn: "transient" }
```

`SessionsFor<C>` computes the need TUPLE from the contract, so most of that agreement is a compile
error rather than a runtime one: a headless contract gets `readonly []`, a browser read gets
`access: "read"` with `acceptDownloads` admitted only when the contract declares
`artifacts: "content-addressed"`, a prepare/commit gets `access: "transaction"` with downloads
forbidden, and `exclusive: true` is REQUIRED on `onbase` and impossible elsewhere. `validateTaskBinding`
re-checks every one of those at module load, because a type is not a runtime guarantee.
`retryOn` has exactly one value: business failures are never retried, because retrying a wrong
answer is a silent fallback in disguise. Retry is legal only on a read — the prepare/commit pair's
recovery is ref write-safety's, never a generic re-run.

### 2.1.1 Strict schema and absence rules (D46)

<!-- roadmap: p1-base -->
<!-- roadmap-status: p1-base -->
- [x] branded schemas for every core id and scalar, canonical JSON, explicit absence/uncertainty and structured boundary failures shipped in 1b (`src/domain/ids.ts`, `src/domain/canonical-json.ts`; 2026-07-31)
- [x] `assertContractBoundarySchema` audits every contract input/output/proof RECURSIVELY — through arrays, unions, lazy nodes and wrappers — so `any`, `unknown`, an open nested object or a decision-bearing record fails at module load (`src/validation/contract-boundary.ts`; guard `task-contract-sealing`)
- [x] `strict-boundary-schemas` extends the same rule to every durable, wire and config boundary in the tree, not just contracts
> 2026-08-21 | docs-cohesion 5.1 task-contract | verified against src/domain/ids.ts, src/domain/canonical-json.ts and src/validation/contract-boundary.ts; the 1b as-built block that stood above §1 is folded in here; left: nothing in this section
<!-- /roadmap-status -->

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

**As built (1b, 2026-07-31 — the foundation these rules sit on).** The strict branded schemas for
core ids and scalars, canonical JSON, explicit absence/uncertainty and structured boundary failures
landed as work item 1b, ahead of the task factory itself. Two identity rules from that slice are
still load-bearing here: semantic UI observations use stable dotted `ObservationId` values owned by
ref operator-trust, while dynamic receipt/evidence rows use the separate UUID-backed
`EvidenceEntryId` — so a row occurrence can never masquerade as an observation recipe — and
`TraceId` accepts local `HHMMSS` hours only from `00` through `23`. Unit and strict-boundary tests
pin the neighbouring invalid shapes, recursively reject unknown object keys, and keep exported
boundary types schema-derived.

**The recursion is the point.** `assertContractBoundarySchema` walks a contract schema through
arrays, unions, lazy nodes and wrappers rather than checking its top level, because every escape
this rule exists to close is nested: an `any` three levels down, a `z.record` inside an array, an
open object behind an optional. `CanonicalJsonSchema<Output>` closes the compile-time half — a
schema whose output is not JSON-representable resolves to `never`, so the contract does not type —
and the factory's `output.parse(example)` plus `canonicalJsonStringify` is the runtime backstop.

### 2.2 The contract/impl split (D3)

A task is **two files**:

- **contract** — plain data, bundle-safe, at `src/domain/contracts/<store>/<verb-object>.ts`: id,
  zod input/output, `title`, `effect`, `errorCodes`, `subject`, `scenarios`, a mandatory `example`,
  plus `freshness`/`provenance` (reads) or `writeSafety` (commits). Descriptors (ref
  workflow-model) and the dashboard import contracts ONLY.
- **impl** — `run` + session needs + read retry, at `src/stores/<store>/tasks/<verb-object>.ts`. It
  imports the store's driver declaration and its typed driver API. Only `src/stores/*/driver/**`
  and `src/infra/browser/**` may touch Playwright (guard `task-driver-boundary`).
  `defineTask(driver, contract, impl)` binds a browser task; a headless service or workflow task
  uses `defineTask(contract, impl)`. The store is the only impl registry.

**There is no contract barrel, and nothing needs one.** `src/domain/contracts/index.ts` re-exports
`base.ts` and `write-safety.ts` and nothing else; each contract module is imported by name where it
is used. The **contract corpus** — the closed `(id, effect)` list every reference resolves against
— is projected from the REGISTERED STORES in `src/stores/index.ts` (`corpusFor`), so a contract
that no store binds is not in the corpus at all, and `defineTaskStoreRegistry` refuses both
directions: a registered task absent from the corpus, and a corpus id with no implementation. This
is the correction to a long-standing sentence in this doc: the barrel was the design, the store
registry is the as-built, and the store registry is strictly stronger — a barrel can list a
contract nobody implements.

**`example` is a checked fixture, and its original consumer was never built.** The factory parses
it through `output` and the SEALED contract carries the PARSED canonical value in its place
(`Sealed<Contract, Output>` replaces `example: z.input<Output>` with `z.output<Output>`), so
`contract.example` is always canonical, always JSON-stringifiable and always schema-true. Three
guards read it: `descriptor-coverage` re-parses every registered contract's example,
`write-safety-contract` runs the commit proof round-trip over it, and `evidence-receipt` walks its
leaves to prove every one has a declared redaction classification. What does NOT read it is an e2e
stub lane — `maybeWrapE2EStub` and the per-workflow stub map were designed in D3 and never ported
(`history/superseded/2026-08-20-guards-and-tests-stub-lane.md`, verified against the tree
2026-08-20). Behavioural coverage comes from the registered `ScenarioManifest` corpus (ref
operator-trust) and, from R10 onward, from live dry-run scenarios; the example is a value fixture
and never coverage.

```ts
// src/domain/contracts/base.ts — one overload per effect (D7), `const Codes` keeps the tuple literal
defineTaskContract(read)    → SealedReadContract
defineTaskContract(prepare) → SealedPrepareContract
defineTaskContract(commit)  → SealedCommitContract
```

**What the factory refuses, at module load.** `RuntimeTaskContractDefinitionSchema` is an exact
effect-discriminated union of strict objects, so a raw JavaScript caller cannot add an outer key,
submit an empty `errorCodes` list, give a prepare contract a durable checkpoint, or attach
read-only `artifacts` metadata to a write contract. On top of that, `assertCommon` refuses: an id
outside the namespace grammar; an empty title; a non-strict or `any`-bearing input/output; an
`example` that does not parse or canonicalize; duplicate error codes; an unknown store namespace;
`providers` on anything but a service read; a prepare/commit outside a browser namespace; an empty
`scenarios` list anywhere except a `workflow:` read; a subject observation crossing systems or
naming an input path the schema does not own; an identity/match pair that disagrees; an unscoped
commit with free text instead of a reviewed id, or with a reason id the registry has not reviewed;
a commit subject observed anywhere but `after-prepare-before-fence`; and a verb that disagrees with
the effect (§2.5). Reads additionally resolve every freshness and provenance field path against the
output schema. Commits additionally run the whole `writeSafety` round trip: the proof reconstructs
the canonical output, the present-probe proof equals the output proof, the idempotency probe and
the completion verifier are same-store READ task ids, and `recoveryAbsence` parses as a negative
settlement policy. An `upload-verify` completion that declares `unverifiableByPage` must match an
entry in `REVIEWED_UNVERIFIABLE_BY_PAGE_POLICY` **by task id and by reason text** and must exercise
an `operator-attestation` proof arm — the reviewed list is `contracts: []` today, so the field is
currently unusable by construction, which is the correct state until OnBase's OQ2 is answered
(order 7).

**The seal is a runtime identity, not a flag.** `defineTaskContract` deep-copies and freezes the
declarative metadata (`sealDeclarativeMetadata`, which refuses any non-plain object), replaces
`example` with its parsed value, stamps `__sealed`, and registers the object in a module-private
WeakSet. `assertFactorySealedTaskContract` is what `defineTask` calls, so a hand-built object that
satisfies the TYPE — `__sealed: true` included — is refused by identity. Zod schemas and the
proof/key FUNCTIONS keep their original unfrozen identities, because freezing a schema breaks it.
Dynamic idempotency keys are validated only when execution has real parsed input: sealing makes no
claim about a key it cannot compute.

**`defineTask` re-checks everything the type already said.** Four overloads (browser read, browser
prepare, browser commit, headless read) plus a runtime backstop that refuses an impl with an
unknown field, a missing `run`, a session count other than one for a browser task, a session system
that is not the store's, an access that disagrees with the effect, `exclusive: true` outside OnBase
or absent on OnBase, `acceptDownloads` without a content-addressed read contract, a retry policy on
a prepare or commit, a headless task with a session or a driver, and a workflow mini-store task
declaring artifacts. The bound task is frozen and registered in a second WeakSet, so
`defineBrowserStore` can refuse anything `defineTask` did not mint.

**The driver declaration is INVARIANT, and that is the whole point.**
`DriverDeclaration<Driver>` carries a private identity function `(driver: Driver) => Driver` under
a unique symbol, which makes `Driver` invariant: a task bound to one concrete driver API cannot be
registered against another, and a semantic driver cannot be type-erased to `{ system }`.
`declareDriverFor<KualiRrssDocumentDriver>()("kuali", "semantic-ready")` mints one; `declareDriver`
mints the empty `unwired` form for a store that has no semantic operations yet. Both go through the
same factory, which registers the declaration in a WeakSet — so `assertFactoryDeclaredDriver`
refuses a forged one, and `defineBrowserStore` requires *object identity* with the store's own
declaration, not merely a matching system. This is the rule `CLAUDE.md` states as "browser tasks
bind the store's exact invariant `DriverDeclaration<ConcreteDriver>`", and §2.10's first as-built
rule is what it looks like when a store grows a fifth task.

**`z.input` vs `z.output` (D15, review #4).** A node's bind produces `z.input` — a field with
`.default(false)` is *omittable* at the mapping site — and `run` receives the parsed `z.output`
value with defaults and transforms applied, returning a `z.input` of the output schema that the
kernel parses before anything downstream sees it. Conflating the two (`z.infer` everywhere) would
make every defaulted field required in mappings and defeat transforms.

**A type-level test pins the negative.** `ctx.fail("undeclared-code", …)` must fail `tsc`; that is
what `const Codes` inference and `taskFailer(contract)` exist for.

### 2.3 The task ctx (narrow by construction)

```ts
// src/base/task.ts
interface TaskCtxCommon<Codes> {
  readonly signal: AbortSignal;
  readonly log: TaskLogger;                    // debug/info/warn with flat structured fields
  readonly fail: (code: Codes[number], message: string,
                  options?: { subject?; transient?; cause? }) => never;
  readonly recordData: (point: DataPoint | readonly DataPoint[]) => void;   // D115, always present
}
type      PureTaskCtx    = TaskCtxCommon;                             // workflow: mini-store reads
interface ServiceTaskCtx extends TaskCtxCommon { providers: ProviderClientSubset<Capabilities> }
interface BrowserTaskCtx extends TaskCtxCommon { driver: Driver }     // the store's CONCRETE driver
interface CommitTaskCtx  extends BrowserTaskCtx { mutation: MutationCapability }
// a read declaring artifacts: "content-addressed" additionally receives
//   { artifacts: ContentAddressedArtifactWriter }
```

`ReadTaskCtx` and `PrepareTaskCtx` are aliases of `BrowserTaskCtx`: what distinguishes a commit is
the `MutationCapability`, and **no seam here mints one**. The token's brand is declare-only, so the
type cannot make it unforgeable; the runtime registry in `src/base/mutation-capability.ts` does,
through a module-private WeakSet whose only permitted minting caller is
`src/core/write-sequencer.ts` (guard `task-driver-boundary`, D122). A driver's `commit` operation
verifies the token before it clicks.

**What TaskCtx deliberately does NOT have:** `updateData` (the untyped blob — display fields are
projections of typed task outputs, ref dashboard-surfaces), `step` (the graph node owns
orchestration), `delegateTo` (delegation is workflow-level composition, ref workflow-model),
free-form `retry` (retry is declared, kernel-executed), and **any wait or park primitive** (§2.6).

**Provenance is a data channel the executor owns, never an inference from logs (D115, 1f).** Every
`TaskCtxCommon` carries a real collector: production `recordData` cannot be omitted, replaced by a
no-op, or reconstructed from log prose, and `fakeCtx` must supply an explicit recording fake so a
unit test cannot accidentally prove a production no-op. Each point is parsed through the strict
`DataPoint` boundary — `{ direction: "read" | "write", field: ContractFieldPath, value: JsonValue }`
— and the collector stamps the run/trace/attempt/workflow/node/task identity and the Clock instant
(`src/domain/task-provenance.ts`). Before a read output may become a checkpoint or a terminal-result
dependency, the kernel checks the contract's resolved `provenance` policy: every `live` field has a
point recorded **during that execution**, and every `derived` field receives the complete declared
upstream provenance and retains its **oldest** contributing `observedAt`. Missing or contradictory
provenance fails the task before durable output. The declared upstream set is resolved from
factory-authenticated descriptor metadata, never from a caller's claim, and undeclared evidence is
rejected. Two arms of that evidence exist, because a gate is not a checkpoint: `checkpoints` are
whole authority `run_checkpoints` rows, and `gateResults` are `gate_results` rows contributing
exactly ONE `operator`-sourced fact dated at `resolvedAt` and no output leaves (D203 — a task that
declared a gate as a dependency was structurally unrunnable until the READER moved).

**Providers are admitted, never ambient (D63/D100/D112, 1f).** A service contract declares
`providers: [...]` and `ctx.providers` is narrowed to exactly those capability keys; a task with no
declaration has no client at all, and a browser or workflow contract may not declare one. Every
call enters ONE capability-indexed admission path before an adapter can perform remote I/O: it
applies the run's immutable config snapshot for timeout/abort, concurrency, rate, daily usage and
cost; records reservations and outcomes with the provider evidence; and returns a typed
`unavailable` result when admission cannot be granted. The task-visible client accepts only the
strict canonical payload — no caller-supplied signal, timeout, deadline, budget, adapter or
admission id — while the ADAPTER boundary separately exposes a conservative local `estimate` and
one `invoke` that receives only the kernel-composed abort signal, monotonic deadline and durable
admission id. The kernel reserves first, invokes outside SQLite, and durably settles before
returning produced data; failure to settle after remote I/O is an explicit uncertain outcome and
never leaks the response. Abort and deadline RACE the invocation, so an adapter that ignores its
signal still releases the worker turn while the durable reservation retains conservative
accounting. Counters and leases whose reset would change an admission decision survive worker
restart in authority storage, so a task can neither hold a worker while sleeping for capacity nor
bypass admission through an SDK or raw-network import (guard `provider-capability-boundary`).

**Artifacts are content-addressed, and identity is not content (D97/D45).** A read that downloads
or generates a file declares `artifacts: "content-addressed"` and receives
`ContentAddressedArtifactWriter` — `put(bytes | Readable, { mediaType }) → ArtifactRef` and
`open(ref) → Readable`, nothing else. The public reference is
`{ id: ArtifactId, sha256: Fingerprint, bytes: number, mediaType }`: a UUID for the reference, a
digest for the CONTENT, and **never a filesystem path or root**. Byte-identical puts return the
same reference across writer instances; conflicting media metadata for one digest is refused; reads
match on id, digest and metadata exactly. The real writer accepts only
`.tracker-rebuild/artifacts` beneath a non-symlinked absolute workspace (the workspace path itself
is `lstat`-checked) and publishes through temp write → file fsync → atomic no-replace hard link →
temp unlink → directory fsync. There is no digest lock to strand: concurrent same-digest writers
race at publication and every loser validates the winner before returning its exact ref. A crash
may leave an unpublished temp whose name records its owner PID; a retry removes it only after the
OS reports that PID absent, never because an age threshold elapsed (guard
`artifact-effect-boundary`).

### 2.4 Error taxonomy

```ts
// src/base/errors.ts — as built
export class TaskError<Code extends string = string> extends Error {
  readonly taskId: TaskId;
  readonly code: Code;                  // ∈ the task's declared errorCodes, or "unhandled"
  readonly subject: string | undefined; // the offending value: EID, doc id, filename, intent
  readonly transient: boolean;          // retry eligibility — false unless the throw site proves it
}
export function wrapUnhandledTaskError(taskId, error): TaskError<"unhandled">;
```

- The message form is `[<taskId>] <code>: <message>`, composed in the constructor and pinned by
  unit test. Nothing escapes a task without a task name attached — a trace line alone identifies the
  broken task (charter target #1).
- `wrapUnhandledTaskError` wraps anything non-`TaskError` escaping `run` as `code: "unhandled"`,
  `transient: false`, preserving `cause`, and preserving the message when the thrown value was an
  `Error` (a non-`Error` throw becomes "task threw a non-Error value", which is itself the
  diagnosis).
- `instanceof`/`code` branching replaces today's ad-hoc `WorkflowError` subclasses; the two real
  branching cases (`EmplIdNotRecognizedError`, `RetryPageError`) become declared codes.
- `taskFailer(contract)` produces the `ctx.fail` bound to that contract's literal code tuple, which
  is what makes an undeclared code a compile error.
- **The `decoratedBy` and `hookErrors` fields this section described until 2026-08-21 do not
  exist.** They belong to §4's decoration model, which has no module in `src/` — see §4. The rule
  they encode (a hook failure never replaces the base error) is still the right rule and is stated
  where it will be built, not here as though it shipped.

### 2.5 Identity & naming scheme

- `id = "<store>/<verb-object>"`, kebab-case (D2): `ucpath/search-person-org`,
  `crm/read-onboarding-record`, `extraction/extract-spreadsheet`, `roster/match-spreadsheet`,
  `workflow:separations/match-identity`. ONE regex in `src/domain/ids.ts` pins the whole grammar
  for all thirteen system namespaces plus `workflow:<id>`, and `taskId(...)` parses it while
  keeping the literal in the type.
- **Verb prefixes are enforced, and the read list is wider than a first reading suggests.**
  `EFFECT_VERBS` (`src/domain/contracts/base.ts`) is the whole table:

  | effect | verbs |
  |---|---|
  | `read` | `read-` `search-` `list-` `extract-` `match-` `verify-` |
  | `prepare` | `fill-` `stage-` |
  | `commit` | `save-` `submit-` `upload-` `create-` `update-` `delete-` |

  `match-` and `verify-` are READ verbs on purpose: a matcher is a pure fold over an earlier read
  (`workflow:separations/match-identity`), and a write's **verifier** is a read of the page after
  the fact (`ucpath/verify-termination`) — ref write-safety's completion arm requires exactly that,
  and `assertReadTaskReference` refuses a probe or verifier whose verb is not on the read line.
  `fill-and-submit-` is impossible: it is not a verb, and a task cannot carry two effects.
- **`KnownTaskId` codegen was never built.** §8 row 2 and the old text here promised a generated
  union derived from contract barrels; there are no barrels (§2.2) and no generator. What holds the
  line instead is structural: `TaskId` is branded, `taskId(...)` is the only mint, `LiteralTaskId`
  keeps the literal so `NamespaceOf<C>` resolves a store from a contract, and every projection
  (descriptor, dashboard index, corpus) is derived from the registered stores rather than a
  hand-kept list. What is genuinely missing is the ratchet that would forbid a task-id STRING
  LITERAL outside contracts/stores/descriptors; nothing in the tree carries one today, and nothing
  would fail if one appeared.

### 2.6 The task boundary — tasks are bounded; waits are not tasks (D5)

**A task is a run-to-completion Promise with bounded duration** (minutes, not hours). The executor
races every task invocation against an injected monotonic deadline and the run AbortSignal:
`taskDeadlineMs` is a REQUIRED dependency of the worker loop with no default, composed from the
run's immutable config snapshot (`timeouts.taskMs`, 180 s by default —
`src/server/worker/compose.ts`), and both invocation arms race the same deadline controller so a
driver that ignores its signal still lands terminal `failed` with its session poison-closed (guard
`bounded-task-deadline`, ref execution-and-sessions §5.5). Acquiring the driver has its own,
shorter bound — `timeouts.sessionAcquireMs`, 60 s (D125). `timeouts.transactionMs` (300 s) is
declared in the config schema and **read by nothing**: a transaction's beats are bounded by the
per-task deadline and by the node's own `probeToFenceMaxMs`, so the leaf is either an unwired
intention or dead config, and it is recorded here rather than described as enforcement.

A timeout before a fence may restart preflight; after a fence it enters ref write-safety recovery
and is never a generic retry. The things today's code does that do NOT fit the bounded shape are
explicitly **not tasks**:

- **Long waits — OCR approval, child-signature watching, external signals** (oath-upload's
  `subscribeToApproval` park + hours-long wait-signatures watch) are **gate nodes** declared in the
  descriptor and owned by **ref workflow-model's run-state machine**; their wire form is ref
  dashboard-surfaces's `gate.opened`/`gate.resolved` events. A task never contains an unbounded
  poll.
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
  not port.) The one thing that DOES serialize across workers is the Duo ceremony itself — one
  credential, one server-side signature counter (D243/D244) — which is why the parallel-run work
  carries a durable per-credential ceremony lease (`{#duo-lease}`, owner ref
  execution-and-sessions). That is a session concern, not a task one: no task waits on it.

---

### 2.7 The authoring floor — three declaration tiers (D79f, 2026-07-24)

<!-- roadmap: phase0-size-model -->
<!-- roadmap-status: phase0-size-model -->
- [x] the tier is DERIVED, never declared: `assertCommon` requires a non-empty `scenarios` list for every non-`workflow:` namespace, and the effect decides everything else — a light task cannot opt into a cheaper floor because nothing declares a floor (`src/domain/contracts/base.ts`)
- [x] the floor held through 39 contracts across 10 namespaces without a per-task exemption
- [ ] `scaffold new-task` / `scaffold new-workflow` — ratified as part of the base with D79f and never built; there is no generator in `scripts/` and no `scaffold` script in `package.json`
> 2026-08-21 | docs-cohesion 5.1 task-contract | verified against src/domain/contracts/base.ts (the tier derivation) and package.json/scripts (no generator); the missing generators are the same absence `{#phase0-size-model}`'s own log records
<!-- /roadmap-status -->

**The problem this solves.** As written across the reference specs, every task owes roughly ten
artifacts: input/output schemas, `errorCodes`, freshness, provenance classification, subject spec, a
mandatory `example`, a non-empty scenario tuple, naming compliance — and a commit adds `writeSafety`
plus crash/subject scenarios. For a UCPath commit that is exactly right. For a pure transform in a
workflow mini-store — a date-window calculation, a roster row projection — it is ceremony that
makes workflows #2–#10 unpleasant to write, and unpleasant-to-write is how a codebase acquires
copy-paste.

**Three tiers. The floor scales with what the task can break.**

| Tier | Applies to | Required | Optional until |
|---|---|---|---|
| **Light** | `workflow:<id>/…` mini-store pure reads and transforms (`sessions: []`, no page, no provider) | input/output schemas + `example` | scenarios required at the **first incident** — a bug fix here lands its regression scenario like any other |
| **Standard** | browser `read` tasks | Light + freshness/provenance classification + subject spec + `errorCodes` + a happy scenario and its no-match/empty sibling | — |
| **Full** | every `prepare`/`commit` (i.e. every task that can touch a real HR system) | Standard + `writeSafety` (completion arm + proof schema + idempotency) + probe policy + subject matcher + crash/mismatch/proof-unknown scenarios | nothing — a commit pays full fare, always |

The tier is **derived, never declared**: it follows from `effect` + store kind, so a task cannot opt
itself into a cheaper tier. **As built, the derivation is the factory's own refusals rather than a
separate audit** — `assertCommon` requires scenarios for every namespace except `workflow:`, reads
require `freshness` and `provenance` in the type AND at runtime, commits require the whole
`writeSafety` round trip, and `defineTask` refuses a headless task that is not a sessionless read.
Promoting a light task later (a second workflow wants it, so it moves to a system store) raises its
tier automatically and fails the build until the additional artifacts exist — which is the correct
moment to pay, not before.

**The scaffold generators D79f ratified with it were never built.** `scaffold new-task` and
`scaffold new-workflow` — contract skeleton, impl stub, example, scenario stubs and store
registration, each with `TODO` markers failing their guards until filled — do not exist in
`scripts/` and have no `package.json` script. The declaration toil is therefore still paid by hand,
which is a live cost against "will workflows #2–#10 be pleasant to write" and belongs on whoever
schedules the next store. Nine stores' worth of evidence says the floor itself held; nothing says
the toil was acceptable, because nobody measured it.

### 2.8 The rich-extraction convention — one task per PAGE VISIT (D194, ratified 2026-08-12)

<!-- roadmap: sep-1 -->
<!-- roadmap: sep-2 -->
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

### 2.9 The first store authored under §2.8 — `new-kronos` as-built (D196, 2026-08-12)

<!-- roadmap: sep-1 -->
<!-- roadmap-status: sep-1 -->
- [x] two tasks because two page visits — `new-kronos/search-employee` and `new-kronos/read-separation-timecard`, both live-proven (D196, 2026-08-12; `src/stores/new-kronos/tasks/`)
- [x] the completeness INVARIANT over the virtualized grid: the scroll loop and the fold share ONE implementation, `timecardRangeCoverage`, and the loop terminates on coverage rather than on the widget (D205, 2026-08-13; `src/stores/new-kronos/driver/grid-scroll.ts:130`)
- [x] columns bound by header NAME, read from the same container as the cells, with the counts compared (D205)
- [x] the store is structurally read-only: no `commit` contract, no `MutationCapability` in its import graph, and the UI-registry audit refuses an `external-commit` element by name
- [ ] the pay-rule WRITE family — order 6, below
> 2026-08-21 | docs-cohesion 5.1 task-contract | verified against src/stores/new-kronos/{index.ts,declaration.ts,tasks/,driver/grid-scroll.ts} and src/domain/ui/new-kronos-timecard.ts; left: nothing in this section — the write family is `{#order-6}`'s
<!-- /roadmap-status -->

<!-- roadmap: order-6 -->
<!-- roadmap-status: order-6 -->
- [ ] BE the `new-kronos` store gains its pay-rule write family: a `commit` contract with `writeSafety`, a `CommitCapableSystemDriver` operation, and the `external-commit` element the registry audit refuses today — the capability is added deliberately by that slice and cannot be inherited (§2.9)
> 2026-08-21 | docs-cohesion 5.1 task-contract | verified: `src/stores/new-kronos/` has read tasks only and its driver declares no commit operation; the rest of order 6 (the canonical-EID audit gate, work-study) is owned by 03c and ref data-intake-and-edit-data §1
<!-- /roadmap-status -->
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

**As built, that invariant is also the loop's TERMINATION condition (D205, 2026-08-13).** The first
implementation stopped scrolling when `scrollTop` refused to advance, which was a true statement
about the wrong thing: the position was being written to ui-grid's pinned viewport, which drives no
virtualization, so a 14-of-35-day read reported itself whole and the fold accepted it. The loop now
continues until `timecardRangeCoverage` says every day of the applied window is present and refuses
when it cannot get there — **the same function the fold refuses on**, shared as ONE implementation
(`src/stores/new-kronos/driver/grid-scroll.ts`). Two corollaries came with it and generalise past
this store: an algorithm inside a `page.evaluate` closure is untestable by construction, so the
harvest moved behind a port a fake grid can run; and terminating on what the gathered SET must
contain is the only form of the rule that survives a widget lying about itself.

**A rich read binds its columns by NAME — read from the same container as the cells.** Legacy
addressed the grid by fixed cell index; a column inserted upstream would silently re-point "Pay
code" at "Transfer". The task resolves the live header row and fails loud naming the missing or
ambiguous header. The first version of that fix was a different hardcoded offset wearing a safer
name: it queried header names `document`-wide, catching the PINNED `Date` header, while the cells
came from a body row that has none — nothing threw, and every column was off by one (D205). Read
the names from the container the cells came from and compare the counts. A positional read is
exactly the substitution `no-positional-identity` bans one level up.

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

<!-- roadmap: sep-2 -->
<!-- roadmap-status: sep-2 -->
- [x] a fifth task extended the ONE `DriverDeclaration<KualiRrssDocumentDriver>` rather than minting a second (D197, 2026-08-12; `src/stores/kuali/declaration.ts`)
- [x] catalog attribution splits by FACT where a read and a write share one document, and the Save button stays the commit task's alone
- [x] the registry invariant became PER SUBJECT IDENTITY — one `eid` observation, at most one `document-number` observation — rather than being relaxed to "at least one"
- [x] a person field's `state`/`reason` arms are transaction facts, not identifiers; only `value` carries the identifier (D140 refinement)
- [x] the store is ten tasks at HEAD, still on the one declaration — D261's Action-List resolver (`kuali/search-separation-action`) is the latest, added 2026-08-20
> 2026-08-21 | docs-cohesion 5.1 task-contract | verified against src/stores/kuali/{declaration.ts,tasks/ (10 files)} and src/domain/ui/{kuali-rrss-document,kuali-separation-document,kuali-action-list}.ts; left: nothing in this section
<!-- /roadmap-status -->
§2.9 settled what a store BUILT whole owes. Separations chunk 2 is the other case `STORES.md` §1
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

### 2.11 The third store authored under §2.8 — `ucpath/read-job-summary` (D201, 2026-08-12)

<!-- roadmap: sep-3 -->
<!-- roadmap-status: sep-3 -->
- [x] `ucpath/read-job-summary` returns the whole Employment Instances grid verbatim and classifies nothing; the disposition is a pure fold in `src/domain/separations/job-summary-classification.ts` (D201, 2026-08-12)
- [x] structural cells (empl record, HR status, business unit) refuse a blank; the nine descriptive cells carry `{state:"absent", reason}`
- [x] one page visit, two parses — the search keeps its own preferred-assignment derivation rather than widening a shipped output schema
- [x] a settle wait proves that SOME outcome rendered and a pure verdict function says which; the four-result page that broke the old three-arm `.or()` is a pinned case (D213, 2026-08-14)
> 2026-08-21 | docs-cohesion 5.1 task-contract | verified against src/domain/contracts/ucpath/read-job-summary.ts, src/domain/separations/job-summary-classification.ts and src/domain/ui/ucpath-job-summary.ts; left: nothing in this section — the gate half is ref write-safety §14 and ref workflow-model §5.5
<!-- /roadmap-status -->
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

**A settle wait proves that SOME outcome rendered; a pure function says WHICH (D213,
2026-08-14).** UCPath's `#PTS_CRITTEXT_DISP` was modelled as a positive "no results" marker and is
the search-CRITERIA banner, which renders on every result list stating the count. Waiting on a
three-arm `.or()` therefore CLAIMED the arms were mutually exclusive, and the first subject whose
name matched four people rendered banner and grid together, resolved two elements and threw — while
the classifier behind it would have read that ordinary page as "ambiguous". The wait now asks
whether any outcome has rendered (`.first()`) and a pure verdict function decides which, so the
decision is testable; its load-bearing arm is the REFUSAL — a count banner with no grid beside it
throws by name rather than answering not-found, because reading a four-result page as "nobody
matched" is a silent wrong value about a person. Two subjects were not enough to find this: both
earlier ones matched exactly one person, where UCPath auto-navigates to the detail page, so only one
arm had ever matched and the mapping stayed internally consistent and externally wrong. When a
registry LABEL asserts something the live page disproves, move the LABEL — durable catalogs and
selector provenance bind the id.

**One extraction, two parses.** `searchPersonOrg` and `readJobSummary` share the same page visit and
the same cell read. They do not share a parse: the search keeps its exact preferred-assignment
derivation, which refuses a blank department because a CANDIDATE without one is unusable, while the
job-summary read gives that same cell an absent arm. Widening the search's own output instead would
have moved a schema hash shipped run records already bind (D110/D114/D82) — which is the cost §2.8
warned about, paid the way §2.8 said to pay it: a new contract beside the old one.

### 2.12 One store, two screen families, TWO write transactions — `ucpath`'s termination family (D206, 2026-08-14)

<!-- roadmap: sep-4 -->
<!-- roadmap-status: sep-4 -->
- [x] two transaction nodes in one graph, and the DELETE is its own transaction with its own probe, verifier and permanent key (D206, 2026-08-14; `src/stores/ucpath/tasks/`, ten tasks)
- [x] ONE rich page read, TWO probe folds (`src/stores/ucpath/termination-verdict.ts`)
- [x] the subject binds UCPath's own `PERSON_NAME_NAME_DISPLAY`, kept driver-internal because legacy has no key for it — the anchor renders zero nodes until UCPath resolves a person, so the subject observation and the `emplid-not-recognized` refusal are one check
- [x] the closed vocabulary accepts both surfaces' spellings (`TER` and `Terminatn`), neither arm fuzzy, and a value matching neither falls through
- [ ] the controlled commit on a real subject — canary doc 4537, blocked until its separation date 2026-08-28 (`{#track-a}`)
> 2026-08-21 | docs-cohesion 5.1 task-contract | verified against src/stores/ucpath/{tasks/ (10 files),termination-verdict.ts,driver-declaration.ts} and src/domain/ui/{ucpath-driver,ucpath-smart-hr-termination,ucpath-ss-smart-hr}.ts; left: the live commit, which is Track A's PROOF row
<!-- /roadmap-status -->
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

<!-- roadmap: order-1 -->
<!-- roadmap-status: order-1 -->
- [ ] BE the `i9` store is a declaration only — `defineBrowserStore("i9", declareDriver("i9", "unwired"), i9Session, {})`, zero tasks, no `driver/`, no `BROWSER_SYSTEM_BINDINGS` entry; order 1 builds its driver, login recipe and tasks into exactly the layout below
> 2026-08-21 | docs-cohesion 5.1 task-contract | verified against src/stores/i9/{index.ts,session.ts} and src/infra/browser/system-bindings.ts; the rest of order 1 (person-lookup's Search + Match modes) is owned by 03c and ref dashboard-surfaces §9
<!-- /roadmap-status -->

<!-- roadmap: order-2 -->
<!-- roadmap-status: order-2 -->
- [ ] BE the `sharepoint` and `old-kronos` stores are declarations only, same shape as `i9`; order 2 gives them drivers, login recipes and download tasks
- [ ] BE the first content-addressed download task — `artifacts: "content-addressed"` plus `acceptDownloads: true`, which §2.1's session type admits only together; `stores/common/spreadsheet-grid.ts` is the shared leaf already waiting for the roster half
> 2026-08-21 | docs-cohesion 5.1 task-contract | verified against src/stores/{sharepoint,old-kronos}/, src/stores/common/spreadsheet-grid.ts and src/base/artifacts.ts; no task in the tree declares `artifacts` today
<!-- /roadmap-status -->

```
src/                            # the rebuild repo's code root (D93)
  domain/
    contracts/                # bundle-safe: zod + src/domain/** ONLY (guard task-contract-sealing)
      base.ts                 # defineTaskContract, the effect arms, the seal
      write-safety.ts         # the WriteSafety runtime schema a commit contract binds
      index.ts                # re-exports those two — there is NO per-store barrel (§2.2)
      ucpath/                 # one file per contract, named for the task
        search-person-org.ts  read-job-summary.ts  stage-termination.ts  create-termination.ts …
      crm/ …  kuali/ …  new-kronos/ …  extraction/ …  normalization/ …  ocr/ …  roster/ …
      person-lookup/          # a workflow mini-store's contracts (ids are workflow:person-lookup/…)
      separations/            # nine of them
    ui/                       # the semantic driver types every store's driver implements
  base/                       # task.ts (defineTask + the ctx types), store.ts, session.ts,
                              # errors.ts, artifacts.ts, providers.ts, mutation-capability.ts
  stores/
    index.ts                  # BROWSER_STORES / TASK_STORES + the two registries and their corpus
    ucpath/
      index.ts                # defineBrowserStore("ucpath", ucpathDriver, ucpathSession, tasks)
      driver-declaration.ts   # declareDriverFor<UcpathStoreDriver>()("ucpath", "semantic-ready")
      session.ts              # the LOGIN RECIPE — a sanctioned raw-browser owner
      session-provider.ts     # the composition-safe SessionProvider value tasks' graphs can see
      driver/                 # the ONLY task-adjacent layer allowed raw Page/Locator access
        interpreter.ts        # the semantic driver over a live page
        ui-registry.ts        registry-locators.ts   catalog.ts   fake.ts
        person-org-operation.ts  smart-hr-operation.ts    # the ported leaves live HERE
      tasks/                  # one file per task; defineTask(driver, contract, impl)
      termination-verdict.ts  # pure folds over a task output (§2.12)
      UI-CATALOG.md           # generated; stable ids/labels/search terms/evidence/task uses
      CLAUDE.md               # the store's own as-built notes
    crm/ · kuali/ · new-kronos/          # the other three wired browser stores
    i9/ · old-kronos/ · onbase/ · servicenow/ · sharepoint/   # declaration + session only
    extraction/ · normalization/ · ocr/ · roster/             # service stores (D4, §3.4)
    person-lookup/ · separations/                             # workflow mini-stores (§3.5)
    common/                   # shared leaf code, NOT a store: timecard.ts, spreadsheet-grid.ts
  workflows/<id>/             # descriptor.ts (bundle-safe) + module.ts (server composition)
  control/workflow-registry.ts # the ONE WORKFLOW_MODULES tuple every registry derives from
```

Two naming corrections against what this section used to show: task impl files are
`tasks/<verb-object>.ts`, not `*.task.ts`, and there is no per-store `impl/` directory — the
verbatim-ported leaves live under `driver/` beside the interpreter that calls them, because they
are the layer that touches a page and the boundary guard is drawn at `driver/**`. A workflow
mini-store's contracts sit at `domain/contracts/<workflow-id>/`, not under a `workflows/` folder.

### 3.2 The store factories — one impl registry per task namespace

<!-- roadmap: p1-authority -->

```ts
// src/base/store.ts — three factories, one registry
defineBrowserStore(namespace, driver, session, tasks) → BrowserTaskStore
defineServiceStore(namespace, tasks)                  → HeadlessTaskStore
defineWorkflowStore(workflowId, tasks)                → HeadlessTaskStore<`workflow:${Id}`>
defineTaskStoreRegistry(stores, corpus)               → TaskStoreRegistry
```

There is no single `defineStore` with overloads; three named factories are what shipped, and the
names are load-bearing because the three enforce different things.

- **`defineBrowserStore`** parses the namespace, requires the driver declaration by OBJECT IDENTITY
  (`assertFactoryDeclaredDriver`), requires the session provider's system to match, requires
  `exclusive: true` on OnBase and refuses it everywhere else, and then validates every task:
  camelCase key, factory-minted (`assertFactoryDefinedTask`), an id prefixed by this namespace, the
  store's exact driver declaration, no duplicate id. A driver-bound task cannot be registered in a
  headless store and vice versa.
- **`defineServiceStore`** additionally requires every task to be a sessionless READ.
- **`defineWorkflowStore`** requires the same and also refuses `artifacts` or `providers` — a
  mini-store may not acquire hidden filesystem state or network reach (§3.5).
- **`defineTaskStoreRegistry`** requires stores minted by those factories, refuses a duplicate
  namespace or task id, and then matches the store set against the **corpus** in BOTH directions: a
  registered task missing from the corpus fails, a corpus id with no implementation fails, an effect
  disagreement fails, and `assertTaskContractReferences` resolves every scenario id and every
  commit's probe/verifier against that corpus. Two registries are composed in `src/stores/index.ts`
  — `browserStoreRegistry` (the nine browser stores, the declaration view ref
  execution-and-sessions' coverage guard consumes) and `taskStoreRegistry` (all sixteen, the
  executable task index).

**A store cannot contain a task that touches another store's system.** Cross-system behaviour
(person-lookup's UCPath + CRM dance) is workflow composition, never a task.

**What actually guards this, by name.** The six numbered "coverage ratchets" this section used to
promise map onto the tree like this — three exist under different names, two are the factories
themselves, and one was never built:

| the promise | what enforces it at HEAD |
|---|---|
| pairing — every contract bound by exactly one impl, both directions | `defineTaskStoreRegistry`'s corpus match (above) plus `descriptor-coverage`'s D107 audit of `config/pending-impl-bindings.json`, which is checked-in EMPTY and must gain an entry in the same commit as an unbound contract |
| reachability — a task file the store forgot | structural: the corpus is projected FROM `store.tasks`, so a task no store exports does not exist as far as the registry, the descriptor and the dashboard are concerned |
| bundle safety — a contract reaching server code | `task-contract-sealing`'s AST plus transitive import-graph audit over every `src/**/contracts/**` module (forged seals, casts and dynamic imports included), and `descriptor-coverage`'s bundle-safe value-import closure over every descriptor |
| the `example` parses through `output` | `descriptor-coverage` re-parses every registered contract's example, and the factory parses it at definition (§2.2) |
| freshness/provenance | the factory (both required on a read, field paths resolved against the exact output schema) and the executor's provenance collector (§2.3). **The `maxAgeMs: Infinity` justification-comment ratchet does not exist**: seven contracts declare `Infinity` today and every one carries its argument in an adjacent comment, which is a convention held by review, not by a gate |
| artifacts | `artifact-effect-boundary` |

### 3.3 Porting selectors + knowledge (copy verified recipes; never import legacy runtime)

- **Verified selector recipes are copied/ported into the rebuilt driver with provenance.** The
  rebuild repo never imports or re-exports the legacy repo's `src/systems/**` — under D93 that is
  **structural**, not policed: the two repos share no module graph, so a runtime import across them
  is impossible to write. Each ported module records the **legacy commit hash and source path** in
  its header (`src/stores/ucpath/session.ts` names
  `hr-automation@793abe1f…` and `src/infra/auth/login.ts`), and
  `legacy-selector-port-provenance` pins all 406 registry keys to that FIXED commit's blobs, so
  legacy moving on cannot invalidate the guard. `ui-registry.ts` assigns stable ref operator-trust
  `ElementId`s; tasks call the typed driver.
- **Cross-repo change accounting is RETIRED (D150, 2026-08-05).** This section required D90
  accounting — every legacy maintenance change booked in `config/legacy-change-accounting.json`
  against the affected rebuilt ids — and that is no longer true in either direction: nothing here
  reads legacy's working tree, and legacy work never blocks a rebuild gate. The file remains as a
  frozen historical record and is read by nothing. **What replaced it is stronger for the risk it
  covered** (a ported selector going stale after legacy fixed it): mandatory **live
  re-verification at each workflow's migration**, which the charter already makes standing and
  pre-authorized. A selector checked against the live system beats one diffed against legacy's copy
  of it.
- **Two-commit rule per store:** commit 1 is a faithful copy/port (only the import-path edits the
  rebuild's own `src/` requires — reviewable as a zero-logic diff against the legacy source at the
  recorded commit hash); commit 2 wraps it in `defineTask` shells and contract files.
  Re-derivation is forbidden (charter): `// verified <date>` stamps, `.or()` fallback chains,
  `getContentFrame`, employment-instance expansion and Duo two-phase factor logic are copied
  faithfully with source provenance, and the legacy originals stay in place.
- **A port is allowed to change a BOUNDARY, and each change is named.** `src/stores/common/`'s
  first shared leaf — the Kronos timecard check, ported from legacy `src/services/timecard/index.ts`
  (commit `793abe1f`, blob `91c5b930`) — split along this doc's own boundary: pure Clock-injected
  period/date resolution went to `src/domain/timecard-period.ts`, the orchestration both Kronos
  stores bind went to `src/stores/common/timecard.ts`. Four boundary changes were made, each
  removing a silent fallback or a banned primitive rather than reshaping the algorithm, and each
  pinned by a test: **no raw `Page`** (the semantic timecard driver is page-free; concrete drivers
  own their Playwright internals); **no `waitForTimeout`** (the legacy 3 s sleeps after navigation
  and after a period switch become semantic page-state waits owned by the driver operation);
  **navigation failure throws** (`goToTimecard(): Promise<boolean>` made "could not open the
  timecard" indistinguishable from "no punch entries exist" — both surfaced as `null`); and **the
  driver cannot assert its own switch** (`switchPeriod(): Promise<boolean>` becomes a typed
  `TimecardPeriodSwitch` carrying before/after period labels that the helper compares, so "there is
  no previous period" is a declared arm and never an inferred `false`). The window helper also
  computes bounds in calendar days rather than `n * 86_400_000` ms, because the legacy arithmetic
  lands an hour off local midnight across a DST transition and day-granularity rounding then shifts
  a bound by a whole day. `TimecardDateRange`, `TimecardMonthDay` and `VisibleTimecardMonthDays` are
  strict schemas in the boundary catalog, because the month/day half of every timecard date is
  parsed from an untrusted grid.
- Existing LESSONS do **not** move wholesale. Each referenced lesson is triaged during migration:
  active invariant → structured `KnowledgeRecord`; incident-only context → linked incident history;
  superseded/duplicate/incorrect → excluded from the generated active guide. The old LESSONS file
  stays with the legacy repo's store through the single cutover. See ref operator-trust §4.
- `npm run ui:catalog` generates the per-store `UI-CATALOG.md` (four exist today: ucpath, crm,
  kuali, new-kronos) and `npm run selector:search` searches canonical ids, labels, search terms,
  active knowledge and recorded legacy source paths.
- The inline-selector architecture guard runs over this repo's own `src/stores/*/tasks/**` and
  workflow code. Raw `Page`/`Locator`, `page.` calls and locator recipes are allowed only under
  `src/stores/*/driver/**`, a store's `session.ts`, and `src/infra/browser/**`; tasks receive
  `ctx.driver` and may not reach any of those three transitively (guard `task-driver-boundary`).

### 3.4 Service stores — system-less work has a home (D4)

<!-- roadmap: p2-2h -->
<!-- roadmap-status: p2-2h -->
- [x] all four service stores exist and are registered: `extraction` (2 tasks), `ocr` (1), `roster` (1), `normalization` (1) — `src/stores/{extraction,ocr,roster,normalization}/`
- [x] each is a `defineServiceStore` whose tasks are sessionless reads by construction, and `ocr/extract-form-page` is the one contract in the tree that declares `providers`
- [x] the provider seam behind it — admission, budgets, the reviewed adapter list — is ref execution-and-sessions' and is guarded by `provider-capability-boundary`
> 2026-08-21 | docs-cohesion 5.1 task-contract | verified against src/stores/{extraction,normalization,ocr,roster}/index.ts and src/domain/contracts/ocr/extract-form-page.ts; the intake/Edit-Data half of 2h is ref data-intake-and-edit-data's
<!-- /roadmap-status -->

Pure compute and non-browser pipelines get **service stores** under the same contract:

- **`extraction`** — CSV + PDF extraction (onboarding's `extraction` step, filename parsing).
  Deterministic, no I/O beyond the filesystem. Its outputs land in workflow input fields via
  **operator-defined column mapping** (charter §11): the operator connects a source column title to
  a canonical field, and mapped values parse through the workflow's zod input schema, so ingest is
  validated by construction. Full design: ref data-intake-and-edit-data.
- **`ocr`** — the OCR provider pipeline: model calls, fabrication tiering, tolerant-field handling.
  External I/O, no browser; its contract declares `providers: ["ocr.extract"]` and receives only the
  injected admitted client.
- **`roster`** — spreadsheet matching over the same operator-defined column mapping onto canonical
  fields (charter §11). Full design: ref data-intake-and-edit-data.
- **`normalization`** — reusable contact/address cleanup. Deterministic phone/state/ZIP rules,
  geocoder reads and optional model suggestions return a strict discriminated result with one
  provenance-labelled change per field (`rule|census|nominatim|ai`) plus explicit
  `unchanged|ambiguous|unavailable`; provider exhaustion or error can never become “no change.” The
  workflow decides whether an advisory enters an approval gate. Shared provider clients live in
  infra and may also serve OCR; one store never imports another store's implementation.

Rules:

- Same contract types, same id grammar (`extraction/extract-spreadsheet`), same error taxonomy, same
  `example`/`freshness` obligations. A service read that feeds a write (roster match → OnBase
  upload) declares `freshness` like any other read.
- `sessions: []` is legal only in headless service/workflow stores; browser stores are
  type-constrained to exactly one need for their own system, and a browser-store task with empty or
  cross-system sessions fails both the type and the factory.
- A service ctx has no driver member (type-level) and no session provider; `defineServiceStore`
  takes no `SessionProvider`. Remote I/O is not ambient: direct provider SDK, `fetch` or
  HTTP-client imports are confined to `src/infra/providers/**`, a service task declares
  `providers`, and `ctx.providers` is narrowed to exactly those capabilities. Pure extraction and
  roster tasks declare none and cannot call the network.
- Provider adapters apply the immutable Clock/config snapshot, timeout, abort, admission,
  redaction, request/response schema, usage/cost and evidence policy once. Provider failure is a
  typed unavailable/invalid outcome or a declared task error; no adapter returns an empty value
  that can mean success. Budgets and scheduling are owned by ref execution-and-sessions.
- A read that downloads or creates a local file declares `artifacts: "content-addressed"` and
  receives the kernel writer (§2.3); direct mutable-path writes from a task fail
  `artifact-effect-boundary`. A retry can therefore recreate the same cache artifact but cannot
  append a workbook or mutate operator-owned state. Mutable local projections use stable-keyed
  SQLite outboxes and serialized projectors (refs dashboard-surfaces / data-intake-and-edit-data),
  never task `run` side effects.
- What service stores are NOT: a home for waits. Tracker-subscription waiting (oath-upload's
  approval park) is a **gate** (§2.6, ref workflow-model) and must not be smuggled in as a task.

The old `services/timecard` is **not** another service store. Its pure calendar/range/year functions
moved to Clock-injected domain code and its current→previous orchestration to
`src/stores/common/timecard.ts` over a typed timecard-driver interface (§3.3); Old and New Kronos
retain only their driver implementations. Raw `Page`, fixed sleeps, optional `new Date()` defaults
and a `null` that conflates navigation failure with a verified no-punch result did not cross the
boundary (D61).

### 3.5 Workflow mini-stores — pure specialization, never a system-policy bypass

<!-- roadmap: p1-authority -->
<!-- roadmap: sep-2 -->

`src/stores/<workflow-id>/` holds only pure, sessionless `effect:"read"` tasks whose contract ids
use `workflow:<id>/<verb-object>`. These are workflow-specific transforms and joins that are still
worth reusing peer-to-peer. Two exist: `workflow:person-lookup` (one task) and
`workflow:separations` (nine — the identity match, the employment fold, the date reconciliation,
the department and termination-type resolutions, the plan, and the two `verify-` folds over an
approval and a receipt). Every one of them is a fold over an earlier node's output, which is what
§2.8 rule 3 means by "consumers project; they never re-scrape".

If a task navigates a browser, stages a form, commits, or calls a system-specific external API, it
belongs in that system or service store instead. The descriptor coverage guard proves each
`workflow:<id>` namespace matches a real descriptor id, and `defineWorkflowStore` makes
prepare/commit, sessions, artifacts and providers impossible — a mini-store cannot obtain a driver
or a `MutationCapability`, so it cannot become a quiet second path to a system. Their contract and
impl files may not import workflow descriptors or another mini-store's implementation, so peer
reuse cannot create a runtime module cycle.

## 4. Customization / decoration model

<!-- roadmap: phase-1 -->
<!-- roadmap-status: phase-1 -->
- [-] `decorateTask`, `TaskHooks` and `HookCtx` are DESIGNED and not built: there is no `src/base/decorate.ts`, no builder `.decorate()` / `.instrument()`, and no per-task hook of any kind in `src/`. Nothing in Phase 1 needed one, and no descriptor asks for one today
- [-] the automatic end-of-step and error SCREENSHOTS §4.2 promised to re-home as kernel span hooks do not exist either — the rebuild captures no screenshots at all; the only diagnostic capture is failure-time and redacted (`src/base/diagnostics.ts`, D137)
- [x] the ONE instrumentation layer that does exist is the kernel's: the executor emits task spans keyed by `(runId, attempt, spanPath)` with the claim generation folded in (D123/D214), which is what every timeline, duration and verdict reads
> 2026-08-21 | docs-cohesion 5.1 task-contract | verified by absence — no `decorateTask`, `TaskHooks`, `HookCtx`, `.decorate(` or `.instrument(` anywhere in src/, and no screenshot producer; §4.1–§4.3 keep the contract for whoever builds it, marked as the contract rather than as behaviour
<!-- /roadmap-status -->

**This section is a contract for a mechanism that does not exist yet.** It is kept normative — a
decoration model that gets invented ad hoc per workflow is exactly the fork this doc was written to
prevent — but nothing below describes shipped behaviour, and §4.2's "today's automatic screenshots"
sentence described the LEGACY system, not this one. What to do when a workflow genuinely needs a
pre/post side action today: put it in the driver operation (where the page is), or make it its own
node (where the graph can see it). Do not invent a hook.

### 4.1 The invariant

**A decorated task is the same task.** Decoration returns a value of the *same* type `T` — same
contract, same schemas, same effect, same sessions. Hooks can observe, add side actions
(screenshots, extra validation, waits), and veto by throwing — they can never change the input,
replace the output, or swallow the error.

```ts
// src/base/decorate.ts — NOT BUILT; the shape the model requires when it is
export interface TaskHooks<C extends AnyTaskContract> {
  before?: (args: { input: TaskInput<C>; ctx: HookCtx }) => Promise<void>;
  after?:  (args: { input: TaskInput<C>; output: TaskOutput<C>; ctx: HookCtx }) => Promise<void>;
  /** Observe only. The kernel ALWAYS rethrows the base TaskError; if this
   *  hook itself throws, its failure is attached as TaskError.hookErrors —
   *  secondary metadata, never a replacement (D15). */
  onError?: (args: { input: TaskInput<C>; error: TaskError; ctx: HookCtx }) => Promise<void>;
}

export function decorateTask<T extends AnyTask>(
  base: T, hooks: TaskHooks<T["contract"]>, label: string,
): T
```

- `HookCtx` = `{ driver (read-only capabilities for the task's system), capture, log, signal }` — no
  `fail` with the task's codes. A `before`/`after` hook that throws produces `code:"decorator-failed"`,
  `decoratedBy: label` — a broken decoration is never attributed to the base task. An `onError`
  hook that throws does NOT produce a new error at all: the base error propagates with the hook
  failure in `hookErrors`. **Both fields are part of THIS design**; the shipped `TaskError` has
  neither (§2.4), so building decoration means extending that class in the same commit.
- `after` throwing = extra validation failing loud (e.g. oath-signature asserting the saved page
  shows the expected signature date). The output is still the base task's output — a workflow that
  wants a transformed value does it in the next node's input mapping (§5), pure and typed.
- Stacking: `decorateTask(decorateTask(t, a, "x"), b, "y")` — hooks run outside-in for `before`,
  inside-out for `after` (standard middleware order), to be pinned by a unit test.

### 4.2 Where instrumentation attaches

| Layer | Mechanism | Example | Built? |
|---|---|---|---|
| One step of one workflow | `.decorate("transaction", hooks, label)` on ref workflow-model's builder | pre/post-submit form screenshots in oath-signature | **no** |
| Every step of one workflow | `.instrument(hooks)` on ref workflow-model's builder | per-step audit screenshot policy | **no** |
| Every task everywhere | kernel-level span hooks (ref dashboard-surfaces) | step timing, task/browser/run span kinds | **yes** — the executor's span emission |

The point of the three layers is that per-workflow instrumentation code is not the answer to any of
them; when the first two are built, they attach at the task boundary rather than inside a handler.

### 4.3 Why adding a task cannot break neighbors

This one IS as built, and it holds without decoration:

- Tasks are **frozen values with no shared mutable state**. There is no `ctx.data` blob a new task
  could clobber (person-lookup's `startDate`-clobbering bug — active-status overwriting the CRM
  value — is structurally impossible: each output is its own typed record, and `defineTask` freezes
  the bound task).
- The only inter-task coupling is the **explicit input mapping** (§5). Adding node N+1 adds a key
  to the outputs record; existing mappings do not see it. Removing or renaming an output field
  breaks the *consuming mapping* at compile time — the failure surfaces at the edit, not at
  runtime.
- Decoration, when it exists, returns the same type, so a decorated step slots anywhere the base
  did and hooks cannot alter data flow.

---

## 5. Composition — what the contract requires of the builder

<!-- roadmap: p1-authority -->

**The workflow builder API itself — read/transaction/branch/fork/child/gate nodes, replay, and
resume — is owned and specified only by ref workflow-model.** This section states the obligations
task contracts impose on that builder; it deliberately does not publish a second API sketch.

- **Compile-time:** every node bind must return exactly `TaskInput<T>` (`z.input`, §2.2) and can
  only read workflow input plus declared upstream node outputs. Rename a task output field → every
  consuming read/transaction/branch/child mapping fails `tsc`. That is the charter's "a contract
  change on one side must fail to compile on the other." Ref workflow-model's builder accumulates
  both exact node outputs and each node's concrete contract tuple, so a decorated node would stay
  typed without reducing non-task graph outputs to a broad top type.
- **Runtime:** the kernel parses the mapped value through `contract.input` before `run`
  (`src/core/run-executor.ts:915`) — zod is the second wall, and this is also ref workflow-model's
  "start from graph node N" entry validation, where replayed checkpoints flow into `outputs` and
  any missing required data fails the parse loudly, naming the task and field. `run`'s return is
  parsed through `contract.output` (`:1053`), so a task cannot leak an out-of-contract shape
  downstream: the class of bug where a stub emitted the display label `"A"` instead of the enum
  dies at the boundary it was born at.
- Branching, fan-out, gate nodes and checkpoint/replay are ref workflow-model's scope; the contract
  here only fixes what a step IS.

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
