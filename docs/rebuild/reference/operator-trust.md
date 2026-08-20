# 12 — Operator Trust, Semantic UI Vocabulary, Diagnostics, Knowledge & Workflow Authoring

Status: **Binding design with the Phase 1b trust-schema foundation implemented 2026-07-31 — added
2026-07-22 after the whole-plan/legacy-code review;
amended 2026-07-26 (Round 8).** This document owns the human-facing foundation that turns the typed
executor into a system the single operator can understand, debug, extend, and trust. It is
**local-first with deliberate multi-user seams** (D75, §7): it does not add RBAC, user management,
remote administration, distributed coordination, or enterprise deployment ceremony, but four seams
that make a later multi-user migration configuration rather than a second rebuild are load-bearing
from day one and may never be trimmed. It retains correctness controls, PII/secret redaction,
local-only network defaults, durable recovery, and evidence because this tool reads and writes real
HR records. **Round 8 also trims the DSL graph-authoring mode entirely (§5.4, D79a).**
**Amended 2026-07-30 (Round 9):** the base-capability inventory names explicit per-workflow worker
counts and authored fresh-browser-session boundaries instead of executor lanes/capacity math (D87).
**Amended 2026-07-31 (Round 10):** UI knowledge is copied with provenance into an isolated rebuild;
the explorer is Phase-2-only and graph DSL/codegen remains cut.
**Amended 2026-07-31 (Round 11 — D93):** that isolated rebuild is now a standalone
`hr-automation-rebuild` repo (rebuild code at plain `src/`), so copy-with-provenance records the
legacy-repo commit hash alongside the source path/key and "no rebuilt module imports legacy code"
is structural rather than guarded.
**Amended 2026-08-02 (Round 18):** Phase 1f owns the minimal durable `FailureRecord` authority;
Phase 2g still owns automatic bundles, receipts, explain/search, and rich operator projections.

## Ownership (D1)

| This doc **OWNS** | Imports from the owning sibling |
|---|---|
| Canonical UI vocabulary: `ElementId`, `ScreenId`, `PageStateId`, `ObservationId`, search terms, registry records, generated catalog, and the typed system-driver boundary | Task contract/store/session model → ref task-contract; page leases → ref execution-and-sessions |
| Operator evidence receipt, failure record, diagnostic bundle, `explain run`, and redaction policy | Event/storage wire and retention → ref dashboard-surfaces; write-binding proof/write ledger → ref write-safety; secrets → ref clock-config-secrets |
| Scenario corpus/manifests and the bug→regression-scenario rule | Task `example` and errors → ref task-contract; graph outcomes → ref workflow-model; test lanes/guards → ref guards-and-tests |
| Structured knowledge lifecycle and the AI-assisted `FixRecord` ledger | Existing lessons are migration inputs, not another authority |
| Read-only workflow explorer and the staged, constrained workflow editor | Descriptor/graph/delegation model → ref workflow-model; spans/projections → ref dashboard-surfaces |
| The webpage-ready base capability inventory (§8) | Build order → the phase docs |

This doc does **not** redefine task, graph, command, event, write-safety, config, or storage
contracts. It defines the semantic/operator layer those contracts project into.

All interfaces shown here are readable views of strict, versioned zod schemas; implementation
types are inferred from those schemas. The registry, scenario, failure, evidence, diagnostic,
knowledge, fix, editor-draft, and generated-catalog boundaries reject unknown keys recursively.
Canonical ids/digests/instants are branded. A generic metadata map may exist only inside an opaque,
schema-versioned diagnostic attachment that no workflow, command, projection, or policy reads.

---

## 0. Why this is foundation work, not dashboard polish

The old codebase already contains many correct selectors, identity checks, screenshots, lessons,
and queue actions, but they are difficult to reuse consistently:

- A selector registry key is usually a TypeScript property path, not a stable phrase the operator
  can use in a workflow description. The same visible control can acquire multiple names in code,
  comments, lessons, and AI prompts.
- Browser tasks receive a raw Playwright `Page`, so a task can bypass the registry, page-state
  checks, action tracing, redaction, and subject verification even when better infrastructure
  exists.
- A terminal row says `failed` and often preserves only a message. Reconstructing why it failed
  requires correlating tracker rows, logs, screenshots, session events, and source code manually.
- A `done` row does not present a compact receipt of inputs, observations, decisions, writes,
  verification, checkpoint reuse, and uncertainty. The operator therefore rechecks automation that
  should be trustworthy.
- Lessons accumulate as prose. New guidance is mixed with stale/superseded history, so an AI tool
  can follow the wrong lesson confidently.
- The existing workflow modifier edits presentation and shows mined operations, but the rebuild
  plan did not say whether the new graph is only documentation or a safe editing surface.

These are base concerns because every later workflow otherwise invents names, debug output,
scenarios, evidence, and editor behavior independently—the same drift the descriptor rebuild is
meant to remove.

---

## 1. Canonical UI vocabulary and typed system drivers

### 1.1 Four identifiers with one job each

```ts
export type ElementId = Brand<string, "ElementId">;          // "ucpath.smart-hr.save-submit"
export type ScreenId = Brand<string, "ScreenId">;            // "ucpath.smart-hr.transaction"
export type PageStateId = Brand<string, "PageStateId">;      // "ucpath.smart-hr.ready-to-submit"
export type ObservationId = Brand<string, "ObservationId">;  // "new-kronos.timecard.employee-eid"
```

- **Element** = one interactive or observable UI thing: field, button, row, dialog, header.
- **Screen** = a stable operator-recognizable area or route.
- **Page state** = a validated state of that screen, expressed by positive and negative evidence.
- **Observation** = a typed fact read from the UI, such as the employee EID displayed by the
  currently open timecard.

IDs are stable kebab-case dotted names, never generated from a TypeScript file/property path. A
source rename does not rename the operator vocabulary. Every id has one canonical human label and
zero or more search terms. Search terms help humans/AI find the canonical id; they never create another
identity.

These semantic ids are definitions, not event occurrences. Receipt/evidence rows therefore carry a
separate UUID-backed `EvidenceEntryId`; operator-correction `supersedes` links point to that prior
entry id. `ObservationId` is never a UUID and is never reused as generic evidence-row identity.

### 1.2 Registry record

```ts
// Server-only definition under stores/<system>/driver/. Client/task code receives generated ids and
// safe catalog projections, never locator recipes.
export interface UiElementDefinition<ValueSchema extends z.ZodType = z.ZodType> {
  id: ElementId;
  system: BrowserSystemId;
  screen: ScreenId;
  label: string;                         // "Save and Submit"
  searchTerms: readonly string[];        // "submit button", "finalize transaction"
  role: "button" | "field" | "grid" | "row" | "dialog" | "heading" | "link" | "status";
  effect: "observe" | "navigate" | "prepare" | "external-commit";
  value?: CanonicalJsonSchema<ValueSchema>;
  sensitivity: "public" | "hr" | "restricted"; // controls logs/screenshots/diagnostic export
  locator: LocatorRecipe;                // closed recipe union, interpreted by the driver
  requiredStates: readonly PageStateId[];
  verification: {
    verifiedAt: DateOnly;
    fixtureEvidenceRef: string;
    liveReadOnlyEvidenceRef: string;
    scenarios: readonly [ScenarioId, ...ScenarioId[]];
  };
  supersedes?: readonly ElementId[];
}

export interface PageStateDefinition {
  id: PageStateId;
  system: BrowserSystemId;
  screen: ScreenId;
  label: string;
  evidence: readonly StateEvidenceRule[]; // closed all/any/not locator/URL/observation rules
  timeoutMs: number;
  verification: {
    verifiedAt: DateOnly;
    fixtureEvidenceRef: string;
    liveReadOnlyEvidenceRef: string;
    scenarios: readonly [ScenarioId, ...ScenarioId[]];
  };
}

export interface UiObservationDefinition<S extends z.ZodType> {
  id: ObservationId;
  system: BrowserSystemId;
  screen: ScreenId;
  label: string;
  schema: CanonicalJsonSchema<S>;
  read: ObservationRecipe;               // closed recipe; implementation lives server-side
  authoritativeFor: readonly [
    "subject" | "completion" | "page-state",
    ...("subject" | "completion" | "page-state")[],
  ];
  sensitivity: "public" | "hr" | "restricted";
  verification: {
    verifiedAt: DateOnly;
    fixtureEvidenceRef: string;
    liveReadOnlyEvidenceRef: string;
    scenarios: readonly [ScenarioId, ...ScenarioId[]];
  };
}
```

`LocatorRecipe`, `StateEvidenceRule`, and `ObservationRecipe` are closed discriminated unions—not
arbitrary callbacks—but the registry that contains them is still **server-only**. Bundle-safe domain
contracts contain branded ids and public metadata schemas, not locator recipes. System drivers
interpret the recipes. A
specialized live-only read may reference a named driver operation, but that operation must resolve
from the same system registry and carry a fixture/test.

### 1.3 One canonical catalog for the operator and AI tools

The build generates a **safe projection** at `generated/ui-catalog.json` and per-system
`UI-CATALOG.md` from the server registry. Each entry includes canonical id, label, search terms,
screen/state, role/effect, verified date plus fixture/live evidence refs, sensitivity classification, tasks that use it,
related observations, and an exact registry source link. It deliberately omits locator/state/read
recipes and captured values. Search resolves labels and search terms to exactly one canonical id; a
search-term collision fails generation with both definitions named. The dashboard receives this projection; it
never imports the server registry.

Examples of operator language that resolve without source archaeology:

- “the New Kronos employee EID in the open timecard” →
  `new-kronos.timecard.employee-eid` (`ObservationId`)
- “UCPath Save and Submit” → `ucpath.smart-hr.save-submit` (`ElementId`)
- “the OnBase import form is ready” → `onbase.import.ready` (`PageStateId`)

Existing `SELECTORS.md` and `selector:search` are porting evidence, never runtime inputs. Verified
recipes are copy-ported into the rebuild repo's `src/`, recording the legacy-repo commit hash plus
the source path/key, verification date, and rebuild tests; the
generated catalog may display the legacy property path as provenance text, not a resolvable search term.
No rebuilt module imports legacy selector code — with the two repos sharing no module graph (D93),
that import is structurally impossible rather than merely banned — and the legacy repo remains
preserved through cutover.

### 1.4 Tasks do not receive raw `Page`

Raw Playwright access is confined to `stores/<system>/driver/**`, worker-owned session
infrastructure, and the registry interpreter. Browser task contexts receive a typed driver:

```ts
export interface SystemDriver<S extends BrowserSystemId> {
  goto(screen: ScreenIdFor<S>): Promise<PageStateProof>;
  waitFor(state: PageStateIdFor<S>): Promise<PageStateProof>;
  read<O extends ObservationIdFor<S>>(id: O): Promise<ObservationValue<O>>;
  fill<E extends FieldElementIdFor<S>>(id: E, value: ElementValue<E>): Promise<ActionProof>;
  /** Commit-class controls are excluded from this union. */
  click<E extends NonCommitClickableElementIdFor<S>>(id: E): Promise<ActionProof>;
  choose<E extends ChoiceElementIdFor<S>>(id: E, value: ElementValue<E>): Promise<ActionProof>;
  /** The only generic path to an element declared `external-commit`. Prepare/read ctx cannot supply
   * this unforgeable capability; the driver validates its intent generation + subject digest. */
  commit<E extends CommitElementIdFor<S>>(
    id: E, capability: MutationCapability,
  ): Promise<ActionProof>;
}
```

Every driver action automatically records the task/span, element id, page state before/after,
duration, and selector recipe actually used. A task can still call a complex named driver method
for a PeopleSoft grid or iframe workflow, but that method is registered with declared inputs,
outputs, used elements/states, and scenarios. It cannot take an untracked raw locator from the task.
Any named operation that reaches an `external-commit` element must accept and validate
`MutationCapability`; this is checked through its dependency graph. Subject observation uses
`driver.read(spec.observe)`, but normalization/comparison and `SubjectProof` construction belong to
the kernel so a driver cannot assert its own match. Extra screenshots are requested through ref task-contract's
kernel/decorator capture surface, not an unrestricted task driver method.

This preserves the port-first rule: live-verified leaf functions may initially move behind a
driver operation with zero logic change. The boundary changes immediately; internal locator logic
is improved incrementally only after its fixtures/live checks exist.

### 1.5 Registry separation—no “one giant task store” ambiguity

| Concern | Canonical owner | Reuse meaning |
|---|---|---|
| Business/system operation (“search Person Org”, “fill termination”) | System task store (ref task-contract) | Compose the proven operation in workflows |
| UI vocabulary/locator/page-state/observation | UI registry + system driver (this doc) | All system tasks share one named UI fact/control |
| Completed output within a run/item | Checkpoint store (ref workflow-model) | Resume/replay without rescanning when freshness permits |
| Pure workflow-specific transform/join | Workflow mini-store (ref task-contract) | Peer-reuse typed computation, no browser |

The task store prevents repeated reinvention of *operations*. The UI registry prevents repeated
reinvention of *selectors and page truth*. Checkpoints prevent repeated work *within a run/item*.
The workflow mini-store prevents repeated pure transformation code. A workflow never treats one as
an informal substitute for another.

### 1.6 Verification evidence is conjunctive, and a staging anchor needs the stronger arm

_Ratified 2026-08-01 as the Phase-1d UI seam (D98 · D99 · D101), amended 2026-08-14 (D208).
The four rulings amend §1.2's `verification` block and what §1.3 may project; they are stated
here rather than in a dated block at the top of the file._

- **D98 — verification is conjunctive, not singular.** Every runtime/catalog element recipe,
  page-state rule, or observation recipe carries both a required deterministic fixture-evidence ref
  and a required read-only live-evidence ref. Candidate port-inventory rows carry neither and cannot
  enter a runtime registry or generated catalog. The old singular `verified` field is retired.
- **D99 — UI verification scenarios are UI-owned.** Registry scenario refs resolve against a small,
  strict UI verification-scenario schema/corpus owned beside the UI registry. It imports the
  canonical `ScenarioId` grammar and enforces global uniqueness with the existing trust scenario
  corpus; it does not distort `ScenarioManifest` before 1e. Every actual registry fact resolves at
  least one scenario non-vacuously.
- **D101 — semantic ids are imported.** UI modules import/re-export the existing `ElementId`,
  `ScreenId`, `PageStateId`, and `ObservationId` schemas/types from `src/domain/ids.ts`; no driver or
  registry redeclares those closed identities.
- **D208 (2026-08-14) — "resolves to exactly one node" and "resolves to exactly one EDITABLE node"
  are different evidence strengths, and a write-surface anchor requires the second.** D98 made
  verification conjunctive but left every positive assertion at one strength:
  `exactly-one-visible` says a recipe resolved to a single node and says nothing about whether that
  node could have been typed into. That is the whole of the evidence a **read-only** record can
  supply, and it is not the evidence a **staging** anchor needs — a Kuali document rendered at a
  step that owns no edit right resolves each control to exactly one node, disabled, and reads as
  verified. `UiVerificationAssertionSchema` therefore carries a strictly stronger arm,
  **`exactly-one-editable`**: the recipe resolved to one node AND that node was live-observed
  `isEditable()` (text controls) or `isEnabled()` (select, checkbox, radio). The rules that follow
  from it are normative:
  1. An element recipe whose declared `UiEffect` is `prepare` or `external-commit` must carry
     `exactly-one-editable` in its live-read-only manifest, or carry a named, dated exception
     pointing at STRONGER evidence — a controlled commit on that exact control is stronger than any
     assertion in this vocabulary, and `kuali/timekeeper-field` stands on D135's for exactly that
     reason.
  2. `exactly-one-editable` claims nothing about a WRITE. `externalWriteAttempted` stays
     `z.literal(false)` in every manifest: a value staged into a control and discarded by a reload
     never left the browser, and a manifest that could say otherwise would be the one place in this
     tree where read-only evidence can assert an external effect.
  3. The arm is **additive to** `exactly-one-visible`, never a rename of it. A read-only screen's
     observation recipes keep the weaker arm truthfully; downgrading them would claim editability
     nobody looked for, and upgrading the enum in place would silently restate every historical
     manifest as evidence it never gathered.

  As-built: nine of the ten separations-finalization controls in
  `evidence/ui/kuali/separation-document.live.json` at `verifiedAt: 2026-08-14`
  (`docs/migrations/separations.md` §9.12 item 3).

  **Enforcement status, stated rather than assumed.** The schema arm exists and
  `semantic-ui-registry` resolves every manifest assertion against the registry as before; rule 1 is
  an **authoring** obligation today, not a machine check, because the one standing exception
  (`kuali/timekeeper-field`, on D135's controlled commit) has nowhere structured to live — an
  element cannot yet cite evidence stronger than an assertion arm. The trigger that ends that is the
  second such exception: at two, the registry element gains a closed
  `strongerEvidence: { kind: "controlled-commit"; decision: DecisionId }` field and
  `semantic-ui-registry` refuses a `prepare`/`external-commit` element that carries neither
  `exactly-one-editable` nor that field. One exception is a fact; two is a pattern, and a pattern is
  what a guard can hold without inventing a schema for a sample of one (D79a's own argument).

---

## 2. Trust evidence: what happened, why the result is credible, and what remains uncertain

**The schemas landed first, then the tables.** Phase 1b (2026-07-31) built the strict
boundary; schema v10 (D134, 2026-08-04) built the durable tables the rest of this section
writes to.

Strict schemas now exist for failures, redacted diagnostic bundles, terminal evidence receipts,
scenario manifests, preflight scenarios, and knowledge/fix records. Receipt invariants reject false
verified completion, unresolved mandatory evidence, invalid warning/failure combinations, and
duplicate evidence-entry identities. Every top-level evidence row schema is present in the strict
boundary catalog and exercised against recursive unknown-key injection. This is the schema
foundation only: evidence persistence/projection, `explain`, semantic UI registries/drivers, and
authoring/explorer surfaces remain with their later owning work items.

Authority schema **v10** creates every durable table this doc's §2.2/§2.3/§4 records need, so no
later 2g slice has to touch the released migration chain:

| Table | Owns | Column-bound facts (boot invariants check them against `record_json`) |
|---|---|---|
| `diagnostic_bundles` | §2.2 | run, origin kind, failure id, content digest, retention kind, purge instant. `purge_after` exists **exactly** when retention is `ordinary`; a failure id exists **exactly** when the origin is not `operator-request`. |
| `diagnostic_attachments` | §2.2 | one row per `(bundle, artifact)`, with kind/digest/sensitivity, so an artifact is findable without scanning bundle JSON. The bundle's `attachments` array length must equal its indexed row count. |
| `evidence_receipts` | §2.3 | one receipt per terminal run (`run_id` UNIQUE), with result, confidence, and failure id. `failed` is the only result that may name a failure and the only one that must; `verified-done` may only carry `verified` confidence. |
| `knowledge_records` · `fix_records` | §4.1/§4.2 | status column for the active-only view; `fix_records.failure_fingerprint` is indexed for `explain failure`. |

`failures` also gains a searchable `fingerprint` column with an index and a not-null insert trigger,
and `FailureRepository` gains `listByFingerprint`/`countByFingerprint` — §2.1's "same failure seen
before" and §4.2's `explain failure <fingerprint>` are lookups, and the ref dashboard-surfaces repeat-threshold
notification trigger needs a count, not a scan over parsed JSON.

**Deliberately conservative, and named as such.** Knowledge and fix repositories are insert-only.
§4.3's audit ("marks stale records `unverified`") needs a CAS on a record version, and
`KnowledgeRecordSchema` carries no `version` — adding one is a schema decision the maintenance slice
should ratify rather than something this foundation guesses. §4.1's `knowledge/records/` file layout
and the generated per-system `KNOWLEDGE.md` remain that slice's work; the table is the authority the
generator reads.

Not landed with D134: the receipt builder, `explain run`/`explain failure`, and the dashboard
projections — all three land below in D140–D143, which is where the `evidence-receipt` guard becomes
**active**. `notification-durability` and `knowledge-fix-integrity` activate with D138/D139 below.

### 2.1 Durable `FailureRecord`

A failed task/run persists a structured failure; `span.ended.error?: string` alone is retired.

```ts
export interface FailureRecord {
  failureId: FailureId;
  fingerprint: string;                 // stable normalized task/code/state/element signature
  runId: RunId; traceId: TraceId; attempt: PositiveInt;
  workflowId: WorkflowId; nodeId?: NodeId; taskId?: TaskId;
  code: ErrorCode; summary: string; transient: boolean;
  subject?: { expected?: SubjectEvidenceWire; observed?: SubjectEvidenceWire;
              proofRef?: WriteBindingProofId };
  page?: { screen?: ScreenId; state?: PageStateId; urlRedacted?: string; title?: string };
  action?: { elementId?: ElementId; operation?: UiActionKind; sequence?: PositiveInt };
  causeChain: readonly FailureCause[];  // bounded, typed; hook/decorator errors remain secondary
  diagnosticBundleId?: DiagnosticBundleId;
  remediation: readonly RemediationAction[];
  occurredAt: IsoInstant;
}
```

The event stream carries `{ failureId, code, summary, transient }`; the full record lives in
SQLite/diagnostic storage and is fetched on demand. Failure fingerprints power “same failure seen
before” links without treating message text as identity.

**Delivery boundary.** Phase 1f persists this exact strict record in non-rebuildable authority for
every failed task/run and atomically associates its `failureId` with the failure transition. The
minimum service can insert/read by id and detect conflicting replay; it does not synthesize a
`diagnosticBundleId`. Phase 2g adds automatic bundle capture, evidence receipts, fingerprint search,
`explain run`/`explain failure`, retention/pinning, and the rich dashboard projections over that
same authority. There is no smaller Phase-1 failure schema and no Phase-2 replacement record.

#### 2.1.1 The failure section serves content through a whitelist schema (D142)


`FailureDetailWireSchema` names every field it projects off the durable `FailureRecord`. That is doc
11's "unclassified fields drop" applied structurally: a field added to the durable record later
reaches no surface until someone decides how it is classified, rather than relying on a filter
someone has to remember to update. Subject identity travels as a digest plus an already-redacted
display suffix, the page as `urlRedacted`/`titleRedacted`. `sameFingerprintSeen` is §2.1's "same
failure seen before" as a count — what the operator acts on, answerable without projecting other
runs' subjects onto this panel. An absent diagnostic bundle names the slice that will fill it.

The receipt section serves the WHOLE `RunEvidenceReceipt`: §2.2 puts redaction at capture time, every
value already carries its classification and transform, and a second wire projection could only lose
them. Because the receipt now rides the run-detail wire, `src/domain/redaction.ts` is
browser-reachable and drops `node:crypto`/`node:path` for `sha256Hex` and a two-separator basename.

### 2.2 Automatic diagnostic bundle

On an unexpected state, task failure, subject mismatch, recovery park, or operator-requested
snapshot, the kernel captures one bounded bundle:

- failure record and causal chain;
- redacted URL/title, active `ScreenId`/`PageStateId`, and last N driver actions;
- expected vs observed subject proof, or the allowlisted unscoped binding proof for a genuinely
  subjectless file/catalog commit;
- screenshot(s) allowed by sensitivity policy;
- accessibility/DOM excerpt around the failed element, not an unbounded page dump;
- visible error banners and selector recipes attempted;
- relevant browser console/network failures with request bodies/credentials removed;
- parsed input digest and schema/fingerprint—not unrestricted raw SSN/PII;
- descriptor/task/config/build fingerprints, resolved prod/test instance;
- worker, lease, claim generation, clock health, disk/DB health;
- checkpoint ids/freshness/provenance summaries and prior retry lineage.

Bundles are content-addressed and indexed by `DiagnosticBundleId`. Retention is explicit: ordinary
bundles follow notes retention unless pinned by an active knowledge/fix record or a write-recovery
case. Restricted fields are redacted at capture time. Redaction is not deferred to the UI.

#### 2.2.1 As-built — a bundle is captured at the trigger, redacted at capture, and bound to its failure (D137)


The trigger set is **closed and is the sentence §2.2 opens with**: unexpected state, task failure, subject
mismatch, recovery park, operator-requested snapshot. Each maps one-to-one onto a stored
`DiagnosticBundle.origin` arm, and the mapping is what decides whether a `failureId` or a
`requestedBy` actor is mandatory — a mis-triggered capture fails before an artifact is written.

**Redaction is schema-owned and happens at capture.** `redactDiagnosticFields` DROPS every field it
cannot classify, with a warning naming its index; nothing unclassified is "passed through for the UI
to hide". A second lock refuses a bundle in which a never-exportable key (any secret name, cookie,
storage state, SSN) survived as an `allowed` value, so a mis-classification fails loud instead of
exporting. Only a screenshot may stay `restricted`; every other attachment arm is redacted text.

**The failure and its bundle land in one transaction, and the ordering is forced.**
`diagnostic_bundles.failure_id` references `failures(record_key)` while
`FailureRecord.diagnosticBundleId` is a forward reference the failure row must already carry — so
neither can be written second on its own. Capture is therefore two phases: `prepare` redacts and
writes attachments to the content-addressed store (nothing durable in authority has moved; a crash
leaves at most an unreferenced artifact, which that writer already tolerates), and the interpreter
then terminalizes the failure carrying the prepared `bundleId` and `persist`s the bundle inside the
SAME authority transaction as the terminal CAS. A failure can never point at a bundle that does not
exist, and a bundle can never outlive its failure. Injecting the capture port without an authority
transaction fails loud rather than settling half of it.

**Retention is a bounded delete, and a pin is a recorded fact.** An ordinary bundle's `purgeAfter` is
derived from its OWN capture instant plus the D86 notes floor, never from wall-clock now at sweep
time. The sweep reads the `(retention_kind, purge_after)` index, so a pinned bundle is structurally
unreachable from it; purging a pinned bundle by name, or one whose instant has not passed, throws.
Attachment rows and the bundle row are deleted together so the boot invariant tying a bundle's
`attachments` array to its indexed rows can never observe a half-purged bundle.

The content-addressed **artifact bytes are not deleted**. They are shared by digest, so a receipt, a
second bundle, or a scenario fixture may still hold exactly those bytes; the sweep reports the
now-unreferenced artifact ids and reclaiming them needs a reference count the artifact store does
not keep. That is a named residual, not an oversight.

**Disposition, operator 2026-08-12 (D193): both storage remainders are `wont-build-unless-asked`.**
The two open items in this area — **scheduling** the 14/8/5 retention sweep (the sweep function
above is built and tested; nothing in the running system calls it on a cadence) and the
**content-store refcount** that would let those unreferenced artifact bytes be reclaimed — move off
"deferred with an owner" and onto **nobody's milestone**. They are not planned, not owed by any
slice, and no future gate is blocked on them.

**The operator's reasoning, recorded because it is the part that generalizes: this authority
database stores records of COMPLETIONS, not primary records.** The real record of a completed HR
transaction lives in **the external system itself** — the UCPath transaction, the Kuali document —
and can be checked there, in more than one way. What the rows here carry is **how** a thing was
completed and **whether** it completed; once a thing is completed and approved, those rows mean
little going forward. That is why backup is **non-critical at this scope**, and why a manual folder
copy of `.tracker-rebuild/` taken with the app stopped is an acceptable backup for one person on
one machine — and why disk growth is not a problem worth a durable reference count.

**What that reasoning does not say.** It is about the standing value of *old* rows, not about
durability *during* a write: a `write_intents` fence, its binding proof, and the parked-intent rows
are load-bearing for the run that is in flight, and the fail-closed guarantees in ref write-safety rest on
them being durable at the instant they are written. Nothing here weakens that. Equally, **nothing
already built is removed** — capture, capture-time redaction, the pin/purge invariants, the
`purgeAfter` derivation from the bundle's own instant, and the sweep's own refusals stay exactly as
designed, so scheduling it remains a small addition the day the operator asks. The decision is about
*further investment*, not about what exists: **no further storage/retention work happens unless the
operator asks for it.**

**Named seams.** The interpreter terminalizes after its driver lease has closed, so it holds no page:
screenshots and accessibility excerpts arrive through an injected `attachmentsFor` seam that the
system-driver layer fills in. Absent, the bundle carries structured evidence only — never a
fabricated screenshot. `FailureRecord.summary` is deliberately not copied into the bundle: it is
free text that can carry a name or an EID, it already lives in the failure row the bundle joins to,
and duplicating it into an exportable artifact widens the blast radius for nothing.

### 2.3 `RunEvidenceReceipt`

Every terminal run—success, failure, cancellation, or partial outcome—has a server-derived receipt:

Every `EvidenceFact`, `DecisionEvidence`, `ActionEvidence`, `VerificationEvidence`, `ReuseEvidence`,
and `UncertaintyEvidence` row has its own `id: EvidenceEntryId`. The semantic observation that a row
refers to remains a dotted `ObservationId` in the UI/task vocabulary.

```ts
export interface RunEvidenceReceipt {
  receiptId: EvidenceReceiptId;
  runId: RunId; traceId: TraceId; workflowId: WorkflowId; attempt: PositiveInt;
  generatedAt: IsoInstant;
  descriptorFingerprint: Fingerprint;
  configFingerprint: Fingerprint;
  retryOf?: RunId;
  input: readonly EvidenceFact[];          // redacted canonical values + immutable input hash
  observations: readonly EvidenceFact[];   // source, observedAt, task, checkpoint origin
  decisions: readonly DecisionEvidence[];  // branch/gate/identity/dedupe decisions + reason
  actions: readonly ActionEvidence[];      // external reads/prepares/commits/local projections
  verification: readonly VerificationEvidence[];
  output: readonly EvidenceFact[];
  reuse: readonly ReuseEvidence[];         // fresh live, checkpoint, corrected, prior proof
  warnings: readonly UncertaintyEvidence[];
  confidence: "verified" | "partial" | "unknown";
  result: "verified-done" | "done-with-warnings" | "failed" | "cancelled" | "partial";
}
```

The `verified-done` result key is displayed as **Done** only when the descriptor's declared
completion criteria all have evidence and `confidence === "verified"`. `done-with-warnings` is legal only for
declared, non-load-bearing optional observations whose absence cannot change a transaction or core
result. Unknown/ambiguous mandatory facts force `partial`/`failed`/parked state and can never be
hidden by a green status. A transaction's expected/observed subject and proof source are visible
alongside its receipt. Read-only workflows still show source observations and decisions so their
output is auditable. A receipt invariant test rejects `verified-done` with anything but verified
confidence or any unresolved mandatory evidence obligation.

#### 2.3.1 Evidence classification and cross-source obligations are DECLARED (D140)


`src/domain/trust/evidence-classification.ts` binds every leaf of every workflow input, task output,
and workflow result to one ref clock-config-secrets §6 classification plus one permitted transform. Three rules make
it enforcement rather than decoration:

- **An undeclared leaf fails loud.** `redactDiagnosticFields` drops an unclassified *diagnostic*
  field with a warning because that channel accepts free-form payloads. A receipt's leaves come from
  schemas this repository owns, so an undeclared leaf is a missing declaration — a code gap, closed
  the way `pending-impl-bindings.json` closes one. Dropping it would make a receipt look complete
  while hiding what the run read or wrote.
- **The leaf rule is the provenance collector's.** An array is a leaf, an empty object is a leaf, a
  populated object recurses — exactly `src/core/task-provenance.ts`. A finer rule would produce
  facts no stored `FactProvenance` row could date, forcing the receipt to guess an observation
  instant.
- **The transform is refused at DECLARATION time.** `evidenceTransformAllowed` backs both the
  diagnostic-field schema and the classification schema, so a `secret`/`allow` line cannot sit in
  the table looking reviewed until the first run that carries that field.

Business values (`employeeStatus`, `rawStage`, `documentNumber`, onboarding dates, page-state ids,
proof sources) are `safe-diagnostic`: they describe the transaction, not the person, and the queue
row already shows them. Person identifiers are `direct-identifier`/`last4`. A LIST of people is
`sensitive-hr`/`count` — "one candidate matched" is the fact that decides whether a search was
unambiguous, answerable without naming anyone who was not selected.

`evidence-obligations.ts` is what makes the receipt a double-check rather than a transcript. Each
obligation names its sources by `(workflow input | node output, dotted path)` and a closed rule, and
the receipt carries the SERVER's verdict with the facts it compared. The operator never eyeballs two
redacted identifiers: the receipt already did the comparison. A source that is absent is reported
absent — the comparison never silently shrinks to one side and calls that agreement.

#### 2.3.2 The receipt is a pure function of authority, derived and then pinned (D141)


The receipt is **not** written inside the terminal settlement transaction. Two reasons, in order of
weight. First, authority must never depend on a projection to terminalize: a receipt-shaped problem
must not be able to block or unwind a settlement of a real HR transaction. Second, the runs this
program has already produced — the live person-lookup exit run and the controlled Kuali commit —
terminalized before the builder existed, and a mint-only design could never explain them.

The safety a mint-at-settlement design would have bought is bought differently: every identity folds
from the run identity, and `generatedAt` is the terminal settlement instant rather than a clock read,
so re-deriving one run yields the same bytes. `ensureRunEvidenceReceipt` always routes through
`evidenceReceipts.insert`, whose immutable-insert check refuses a divergent rebuild **by name**. A
receipt that disagrees with authority is louder than no receipt.

`generatedAt = lifecycle.endedAt` is a stated reading: the receipt describes the run AS OF the
instant its evidence closed. Nothing about the run changes after that, so a "when was this rendered"
stamp would carry no information and would destroy determinism.

A conditional node that did not run carries a `DecisionEvidence` with its closed reason and an
`absent`, **non-mandatory** obligation. An absence the descriptor authored and D114's terminal record
closed is a correct outcome, not an unresolved one; treating it as unresolved would push every
correct run with a skipped node to `partial`.

#### 2.3.3 The receipt binds to the surfaces its derivation consumes, not to the descriptor's closure (D199)


**D141's "re-deriving one run yields the same bytes" was true only within one commit.**
`buildRunEvidenceReceipt` stamped `descriptorFingerprint` from the CURRENT build's
`descriptor.contractFingerprint`, so any edit anywhere in a ~31-file descriptor closure changed every
already-settled run's derived receipt and `evidenceReceipts.insert` correctly refused it. Chunk 2's
five live-proof `separations-kuali-read` receipts (`sd-140241-ca44`, `sd-140505-28ff`,
`sd-140917-2b9e`, `sd-140921-3385`, `sd-140921-c0af`) were stranded exactly this way by a
raw-control-byte fix that changed no semantics at all, and `explain run` answered
`evidence receipt … already exists with different content` for all five. Re-running the documents was
not available either: a read workflow whose identity is the thing it reads runs once per subject
(`docs/migrations/separations.md` §"the re-run wall").

Stamping the current build was also a **false statement** in its own right — the receipt claimed the
run executed under whatever tree happened to be checked out. `descriptorFingerprint` is now the run's
OWN retained `envelope.contractFingerprint`: a fact about the run, read from authority like
everything else in a receipt.

**The closure hash is neither necessary nor sufficient here, and that is the whole finding.** D136
established the "not necessary" half for parked writes — nearly every edit in a closure leaves every
consumed surface intact. A receipt adds the other direction: the declared redaction table
(`src/domain/trust/evidence-classification.ts`) and the declared cross-source obligations live
OUTSIDE every descriptor's import closure, so they move with `contractFingerprint` byte-identical.
D197 moved one and two receipts changed content under a frozen hash. A hash that can be equal when
the answer moved is not a binding.

So resolvability is stated directly, one named check at a time, against exactly what
`buildRunEvidenceReceipt` reads — the workflow id, the descriptor version, the runtime node walk,
`descriptor.details`, the terminal execution's `dependsOn`, the declared obligations, and the declared
redaction. Everything else it reads is a durable authority row, which is immutable and cannot move.

| check | baseline | what a move means |
|---|---|---|
| `workflow-identity` | `run.envelope.workflow` | this descriptor is not the run's graph |
| `descriptor-version` | `run.envelope.descriptorVersion` | the author declared that semantics moved |
| `canonical-input` | `run.input.parsed.schemaHash` | the input facts would be redacted under a declaration authored for a different shape |
| `evidence-graph` | checkpoint / terminal-dependency / write-intent rows | a node the run's evidence names left the graph |
| `terminal-dependency-set` | the stored `RunResultRecord` | the mandatory-evidence set would move |
| `declared-evidence` | **the stored receipt row** | the redaction, detail or obligation declaration this receipt was written under has changed |

`declared-evidence` is the only check whose baseline is the receipt itself, and it is the only one
that can see a declaration living outside the closure. It runs on re-derivation, attributes every
divergent path to the ONE declaration that owns it (`declared-redaction`, `declared-details`,
`declared-obligations`, `terminal-dependency-set`, `run-identity`, `receipt-composition`), and
refuses — so a genuinely moved declaration reads as *what* moved instead of "the bytes differ".
`evidenceReceipts.insert`'s immutable check stays underneath as the backstop for any caller that does
not come through `ensureRunEvidenceReceipt`; this path never skips it.

A refusal prints the whole check table with both fingerprints, `[held]`/`[MOVED]`/`[skip]` distinct
and an unevaluated check never reported as held. **There is no waiver, override, or force arm.** A
settled run's receipt is an operator-facing record of a real HR transaction; when a declaration truly
moved, the honest outcomes are to restore it or to accept that the receipt is frozen — never to
overwrite it with a newer story about what happened. Chunk 2's own five split exactly that way: the
three whose only change was the closure re-derive byte-identically, and the two that also crossed
D197's classification fix stay frozen and now say so by name.

Owned by `src/core/receipt-derivation-binding.ts`; pinned by
`tests/unit/receipt-derivation-binding.test.ts` and the `evidence-receipt` guard.

#### 2.3.4 A gate's evidence is a `gate_results` row, so the approver reaches the receipt (D204)


> **`gate_results` is a repository name, not a table.** `authority.gateResults` stores its records in
> `checkpoint_payloads` keyed `<runId>:<gateId>` (`src/infra/sqlite/authority-database.ts`). This
> section keeps the repository's vocabulary because that is what the code reads; the OPERATOR-facing
> receipt sentence deliberately does not, and names "the gate result record" with no table at all —
> a trust artifact read months later must not send its reader hunting for a table nobody created.

**Ratified 2026-08-12.** D202 built the ALWAYS-GATE and put the answer to ref write-safety §14.6 risk 6 ("who
approved is lost") into authority: the command kernel writes `resolvedBy`/`resolvedAt` onto the
`gate_results` row inside the same transaction that stores the result and resumes the run, and a
caller-supplied `approvedBy` beside that would be a claim sitting next to authority. D203 then taught
the KERNEL that a gate dependency's durable evidence is that row rather than a checkpoint. **The
receipt was not taught the same thing**, and it derives from checkpoints — so chunk 3's settled live
run `si-161551-774c` listed `node.identity-approval` as `unknown` and carried no decision row at all.
Risk 6 was answered durably and not in evidence, which on a trust surface is the same as unanswered:
the receipt is the artifact an operator reads months later to see the human in the loop.

**The reader moves, for the third time and for D144's reason.** A gate has no checkpoint and never
will — fabricating one would make a durable record claim a shape it does not have. So
`buildRunEvidenceReceipt` takes `gateResults` beside `checkpoints`, and a resolved gate node emits:

- **its payload's leaves as observation facts**, sourced through a new `gate-result` arm of
  `EvidenceSource` carrying the gate id and authority's own `resolvedBy`/`resolvedAt`. The source arm
  is separate from `system` because a gate owns no task contract: what it dates is a DECISION, not an
  observation of a page.
- **one `kind: "gate"` decision**, whose outcome comes from a DECLARED arm table and whose reason
  names the approver, the instant, the resolving command, and the evidence digest the approval was
  bound to (ref write-safety §14.5 — an approval is an observation of a specific packet).
- **a `verified` obligation** for the node, replacing the `unknown` that used to stand for
  "authority holds nothing", which was false.

**Why the decision arm is declared and not sniffed.** `DecisionEvidence.outcome` is a closed
five-value enum and a gate's result payload is authored per gate, so mapping one to the other by
looking for a field called `decision` would put a plausible-but-wrong word on a record of a human
decision — a payload arm this build did not recognise would land as `approved` or vanish.
`src/domain/trust/gate-decisions.ts` declares, per `(workflow, gate)`, the decision leaf, each stored
value's outcome and operator-facing summary, and the bound-evidence leaf. An undeclared gate and an
unlisted arm value both fail LOUD, exactly as `classifyEvidenceLeaf` does for an undeclared leaf, and
the `evidence-receipt` guard fails when a registered descriptor grows a gate node without one.

Redaction extends the same way rather than gaining a hole: `EvidenceValueScope` gains a
`gate-result` arm scoped by `(workflow, gate)` — not by a task id, which a gate does not have — and
the identity gate's four leaves are declared there. The approved `eid` is a `direct-identifier`
taking `last4` like every other identifier on a receipt; the decision, the choice, the digest and the
operator's own rejection reason are the DECISION and are shown, because a receipt whose job is to
display the human in the loop cannot redact the human's reasoning out of it.

The D199 check table gains no new check. `evidence-graph` grows one row-source: a gate result whose
node left the graph, or whose node is no longer a gate, is a graph gap named as such — the second
case is the stronger break, since the row would otherwise read as a decision about a step that no
longer asks a human anything.

**One consequence, recorded rather than waived.** A receipt stored BEFORE this decision cannot
re-derive under it — `declared-evidence` moves, correctly, naming `receipt-composition` (four new
observation rows) and `declared-obligations` (`verification[3].verdict: "unknown" → "verified"`).
D199 has no waiver arm and gains none here. The two `separations-identity-check` receipts the chunk-3
proof session minted were dropped from the standing authority database as an explicit operator
repair — both describe read-only identity checks, both were minted under a build that structurally
could not see the gate row, and §14.9 had already recorded that incompleteness as an open defect —
and then re-derived under D204. That is a data decision about a pre-production database, taken and
written down; it is not a code path, and no code path exists to take it.

Owned by `src/core/evidence-receipt.ts` and `src/domain/trust/gate-decisions.ts`; pinned by the
`evidence-receipt` guard against the REAL gated descriptor, with a foreign gate row, a gate that left
the graph, and an undeclared arm value as negative controls.

#### 2.3.5 A settled gate's panel names the verdict, the approver and the instant (D237)


**Ratified 2026-08-19.** D202 put the approver into authority, D203 taught the kernel to read a
`gate_results` row as a dependency's evidence, and D204 taught the RECEIPT the same thing. The
**panel** was never taught it. `run-detail`'s `resolved` gate arm was keyed on the span stream's
`resolutionKey`, and the command service emits the literal `resolved` for every gate — deliberately,
with a comment naming the deferral (*"Until gate descriptors declare display keys (2h Review), the
one honest key is the fact of resolution itself"*). So the approve/reject arm was **structurally
unreachable**: every settled gated run's panel reported `gate: { state: "absent", reason: "gate
identity-approval resolved with key resolved, which is not an approve/reject verdict" }`, a sentence
that reads like a data problem and was a vocabulary deferral. Separations §9.17 item 7(a) recorded
it against a real settled run; this closes it.

**The source is the durable row, and it is the SAME row the receipt reads.** The panel query takes
`authority.gateResults.listByRun(runId)` — D204's own read — and derives the verdict through D204's
declared arm table (`src/domain/trust/gate-decisions.ts`), with `resolvedBy` and `resolvedAt` taken
off the row the kernel wrote inside the resolving transaction. The span stream is not consulted for
the verdict at all, which is the point: a projection of an event's display key was never authority
for what a human decided, and the two surfaces an operator reads side by side — the panel and the
receipt — now cannot disagree about who answered a gate. The wire's `resolved` arm therefore carries
`resolvedBy` as a REQUIRED field; requiring it is safe precisely because the arm was unreachable, so
no served wire and no archived record can hold a `resolved` gate that predates it, and an optional
field would have bought read-forward safety for a shape nothing ever wrote at the price of a settled
gate that renders without naming a human.

**Where the panel and the receipt deliberately DIVERGE: what a gap does.** The receipt REFUSES to
derive at all when a gate is undeclared or stores an arm value no declaration lists (D204) — it is
the durable artifact, and a trust record that guessed would be worse than no record. The panel must
still render the run it exists to explain, so each way the read can fail to produce a verdict is a
NAMED absence instead: no durable row beside a folded `gate.resolved` span (stated as exactly that
divergence, so a lost decision never reads as a workflow that asked for none), no declaration for
`(workflow, gate)` naming the file that owes one, an arm value no declaration lists naming both what
was stored and what is declared, and a declared outcome that is not an approve/reject verdict. In
neither surface does anything guess the word.

**What the operator sees.** The panel draws a DECISION RECORD in the run's own stream at
`resolvedAt` — the settled counterpart of the open gate's decision card, in the same geometry —
carrying the verdict, the approver and the instant. The archived detail's Decision card names the
approver for the same reason. Ref dashboard-surfaces owns the presentation; this section owns the derivation.

Owned by `src/server/dashboard/queries/run-detail.ts` and `src/domain/dashboard/run-detail.ts`,
over `src/domain/trust/gate-decisions.ts`; pinned by
`tests/unit/server/run-detail-gate-outcome.test.ts` with every named absence as a negative control.

#### 2.3.6 A transaction node IS a terminal dependency — the named gap, closed by D144


**Closed 2026-08-04 (D144, ref write-safety §3.1).** The gap was real: the sequencer stored a transaction
checkpoint under the durable `TransactionOutcome` schema hash while the descriptor factory's
terminal `build` demanded the COMMIT CONTRACT's output schema hash, and the interpreter never
registered a transaction checkpoint as terminal evidence at all — so `kuali-timekeeper-annotation`
could not reach terminal `done` and the controlled commit had no receipt in authority. The stored
hash was the correct one; the terminal side moved. `kualiReceiptEvidence`'s terminal record now
comes from the real `buildRunResult`, and `tests/unit/transaction-terminal-dependency.test.ts`
drives a queued Kuali run through the real interpreter to `done` and derives its receipt.

### 2.4 Rerun transparency

A retry/rerun receipt links to the prior run and shows a field-level diff:

- input changed vs unchanged;
- checkpoint reused vs rerun, with age/freshness/provenance;
- operator-corrected fields and the facts they superseded;
- branch/gate outcomes that changed;
- prior durable write proof reused (therefore no click) vs new fenced write;
- configuration/descriptor/task fingerprint differences.

The dashboard never labels replayed data as newly observed. This is the operator-facing projection
of refs workflow-model/write-safety's provenance and permanent proof rules.

### 2.5 `explain run`

One CLI/API command is the canonical debug entry point:

```text
cli explain run <traceId|runId> [--json] [--bundle <dir>]
```

It resolves the operation tree and prints: current/terminal state, node timeline, checkpoint reuse,
subject bindings, failure fingerprint, last successful action, open gate/dependency, command
history, notification state, write intent/proof, and concrete next safe action. `--bundle` exports a
redacted portable diagnostic package plus a manifest/hash. Codex/Claude prompts reference this
command and the generated catalog instead of asking the operator to manually assemble logs.

#### 2.5.1 `explain run` and the receipt are one derivation (D143)


`cli explain run <traceId|runId> [--json]` resolves either identity and prints §2.5's
sections in §2.5's order. For a settled run it derives the SAME receipt the dashboard serves, so a
terminal explanation and a terminal receipt cannot disagree. Every section an operator could misread
as "nothing happened" says why instead. `--bundle` **refuses**: exporting a diagnostic package
missing the capture evidence its manifest claims is worse than refusing, because the recipient
cannot tell.

---

## 3. Scenario corpus: workflows improve safely as new cases are discovered

### 3.1 `example` is not a scenario

Ref task-contract's contract `example` remains the canonical happy-path output used for type checks and cheap
stubs. A scenario includes inputs, page/data fixtures, timing/failure injection, expected actions,
evidence, and terminal outcome. The previous plan's hand-scripted failure/cancel matrix is replaced
by a registered corpus rather than remaining an unnamed side list.

```ts
export interface ScenarioManifest {
  id: ScenarioId;                       // "new-kronos/stale-timecard-after-search"
  title: string;
  scope: { taskId?: TaskId; workflowId?: WorkflowId; nodeId?: NodeId };
  kind: "happy" | "expected-absence" | "schema-failure" | "unexpected-state" |
        "wrong-subject" | "transient" | "permanent" | "timeout" | "cancel" |
        "parallel" | "branch" | "gate" | "delegation" | "command" | "proof" |
        "crash" | "recovery" | "storage";
  fixture: FixtureRef;
  input: JsonValue;
  injections: readonly ScenarioInjection[];
  expect: ScenarioExpectation;
  contractFingerprint: Fingerprint;
  requiredAssertions: readonly [ScenarioAssertionId, ...ScenarioAssertionId[]];
  source?: { failureFingerprint?: string; knowledgeId?: KnowledgeId; fixId?: FixId };
}
```

The manifest schema is strict and runtime-parsed. Fixture payloads are sanitized before check-in;
restricted live captures remain local content-addressed artifacts and tests use derived/synthetic
equivalents. `input` is a generic canonical-JSON envelope only because one corpus serves every
contract; corpus load resolves `scope`, parses it through that exact task/workflow input schema, and
stores the parsed value plus schema fingerprint before any scenario can execute.

### 3.2 Minimum scenario coverage

- Every task: happy path, every declared business absence/error code, schema-invalid input/output.
- Every browser task: expected page state, unexpected page state, selector missing, cancellation,
  and subject mismatch for subject-scoped tasks.
- Every transaction: dry-run preview, prepare failure, probe unknown/ambiguous/present/absent,
  probe-age expiry, fence CAS loss, commit failure before/after click, proof failure, crash recovery,
  repeated same key.
- Every child-run/delegation: zero/one/many children, child fail/block/partial policy, parent cancel,
  child retry and parent resume, duplicate fan-out replay, two independent delegations joining.
- Queue/control: stale command version, authoritative target mismatch, DB unavailable, partial bulk
  failure, hide/restore, enqueue coalesce/reject/supersede/parallel.
- Storage: disk full, corrupt DB, missing/torn WAL, failed migration, backup restore, projector lag.

### 3.3 Unexpected states become data, never fallbacks

If a page does not match a declared `PageStateId`, the driver returns/throws `UnexpectedPageState`
with captured evidence and parks/fails according to the descriptor. It does not try an unlabeled
fallback selector and continue. The diagnostic bundle makes the new state observable; when the
operator fixes it, the fix adds a new state/transition or adjusts the existing definition and adds
a scenario. The system therefore grows from real use without silently claiming an unmodeled case
completed.

### 3.4 Bug-to-regression rule

Every non-trivial fix must link to a scenario that failed before and passes after. If the bug cannot
be reproduced safely, the `FixRecord` must say why and link to the closest deterministic invariant
test plus live evidence. A failure fingerprint may not be marked resolved with only a code diff.

---

## 4. Structured knowledge and AI-assisted fix history

### 4.1 LESSONS are migration input, not the new authority

The plan does **not** move `LESSONS.md` wholesale into each rebuilt store. During a store/workflow
migration, each relevant old lesson is triaged into one of three destinations:

1. active reusable guidance → a `KnowledgeRecord`;
2. historical incident/context → incident history linked from a record/scenario;
3. superseded/incorrect/duplicate → retained only in git history, not the generated active guide.

The old file remains authoritative for preserved legacy code. The rebuilt system
uses only the structured store and its generated active view, eliminating a permanent dual source.

```ts
export interface KnowledgeRecord {
  id: KnowledgeId;
  status: "active" | "superseded" | "retired" | "unverified";
  scope: { system?: SystemId; workflow?: WorkflowId; task?: TaskId;
           element?: ElementId; pageState?: PageStateId };
  title: string;
  symptom: string;
  trigger: string;
  rootCause: string;
  invariant: string;
  fix: string;
  regressionScenarios: readonly ScenarioId[];
  evidence: readonly EvidenceRef[];
  verifiedAt?: IsoInstant;
  supersedes?: readonly KnowledgeId[];
  sourceCommits?: readonly string[];
}
```

Records are strict-schema JSON under `knowledge/records/`; one generated `KNOWLEDGE.md` per system
shows **active only** guidance for humans/AI. Incident history and superseded records remain
queryable but are not injected into ordinary prompts/search results unless explicitly requested.

### 4.2 `FixRecord`—what Codex/Claude changed and how it was proven

```ts
export interface FixRecord {
  id: FixId;
  failureFingerprint?: FailureFingerprint;
  status: "draft" | "verified";
  requestedBy: "operator" | "codex" | "claude";
  summary: string;
  affected: readonly (TaskId | WorkflowId | ElementId | PageStateId)[];
  files: readonly string[];
  scenarios: readonly ScenarioId[];
  verification: readonly EvidenceRef[];
  commit?: string;
  knowledge?: readonly KnowledgeId[];
  createdAt: IsoInstant;
}
```

Raw chats, AI explanations, and uncommitted reasoning are never runtime authority. A fix becomes
trusted only through code + schemas + scenarios/tests/live evidence + an optional linked knowledge
record. `status:"verified"` requires a commit id and non-empty verification evidence; an uncommitted
or unproven change remains a visible draft and is excluded from active guidance. `cli explain
failure <fingerprint>` shows prior fixes and whether the same scenario still passes.

### 4.3 Maintenance and search

- New record creation checks for matching scope/symptom/element/scenario before adding; suspected
  duplicates require an explicit supersedes/related link.
- A scheduled/manual audit validates referenced ids/files/scenarios/commits and marks stale records
  `unverified`; it never silently leaves dead guidance active.
- Search defaults to `status:active`, current descriptor/task fingerprints, and the current UI ids.

### 4.4 Optional AI assistance reads the evidence; it never becomes the evidence

The old `services/llm` capabilities are explicitly dispositioned rather than disappearing behind a
proxy. Shared provider/key/rate-limit clients move under infra because OCR and contact normalization
also consume them. The operator-facing adapters remain on-demand and advisory:

| Legacy capability | Native disposition |
|---|---|
| failure triage | optional explanation over a `FailureRecord` + redacted bundle index; cannot set retryability or issue a command |
| run summary | optional narrative over the deterministic `RunEvidenceReceipt`; receipt facts/outcome always render beside it |
| record sanity check | deterministic schema/rule issues are authoritative; optional model issues are separately labelled suggestions and never auto-block/approve |
| selector suggestion | development-only candidate recipe/element-id brief from a redacted accessibility snapshot; it cannot edit the registry or stamp verification |
| contact normalization | ref data-intake-and-edit-data's typed normalization task; every proposed change shows source/confidence and requires the owning review policy |

Every invocation parses a strict request, applies schema-driven redaction **before** provider use,
and parses a closed result. It records `promptTemplateVersion`, redacted input digest/evidence refs,
provider/model, start/end, result-schema fingerprint, and one outcome:
`advisory-produced | unavailable | invalid-response`. Pool exhaustion, missing keys, provider error,
and invalid JSON are visible `unavailable/invalid-response`, never an empty “looks fine” result.
Advisories can be copied into a draft `FixRecord` only by an explicit operator/Codex/Claude action;
they cannot transition a run, resolve evidence, select identity, acknowledge a warning, create a UI
registry entry, or call the command/mutation services.
- A migrated selector/element id updates records through the canonical registry mapping; free text
  is not used as the join key.


#### 4.4.1 As-built — the prompt, the answer schema, and the zero-authority edge (D178)


**What a prompt is made of, and what it is NOT.** `src/domain/trust/advisory.ts` assembles every
prompt from the subject record's LEAVES, each pushed through the ONE `redactValue` implementation
under a `(classification, transform)` pair declared in that file. An undeclared leaf is a loud
refusal naming the exact path — never a silent drop, which is how a prompt starts carrying a field
nobody reviewed. A dropped leaf still APPEARS in the prompt as its redacted arm, because "this fact
exists and was withheld" is information the model should have while absence is not.

The declaration produced a finding worth stating plainly: **`FailureRecord.summary` is
`error.message` verbatim**, so a task that threw *"no candidate matched EID 10456789"* would have
put an employee id on the wire. `summary`, `causeChain.summary` and `remediation.message` are
therefore declared `sensitive-hr`/`drop`, and `page.urlRedacted` / `page.titleRedacted` /
`subject.*.displayRedacted` are `direct-identifier`/`drop`. What the model actually receives is the
CLOSED vocabularies beside them — code, node, task, write state, page state, remediation kind,
cause codes — which is enough to explain a failure CLASS, the only thing this section asks an
advisory to do. **Only `safe-diagnostic` may leave the process as a value**, and the guard enforces
that rather than the weaker "the pairing is permitted".

The advisory leaf rule is deliberately FINER than the receipt's (`evidence-classification.ts`
treats an array as one leaf because every receipt fact must be dated by a stored `FactProvenance`
row). A prompt carries no provenance obligation, so it classifies per element FIELD:
`causeChain.code` goes and `causeChain.summary` does not. Under the receipt's rule the whole array
would need one verdict and the useful half would have gone out with the unsafe half.

**The answer schema travels with the question.** The prompt carries the closed advice schema's own
JSON-Schema projection and its fingerprint (D151's "one instruction, generated from the registry" —
a hand-written prompt and a strict parser drift apart the first time the schema grows), and the
consumer parses the answer through that exact schema. A non-conforming answer is `invalid-response`
whose reason names the failing PATHS and never echoes the model's text. **That rule caught a real
leak in D161's adapter:** `JSON.parse`'s own message QUOTES the offending input
(`Unexpected token 'I', "I think the"…`), so the shared transport now reports only the error's
NAME beside the answer's length.

**One adapter, per-consumer schemas.** `src/infra/providers/gemini-advisory.ts` is transport +
provenance only — it stamps provider/model and passes the model's JSON through VERBATIM as
`answer`, and the CONSUMER owns the closed shape. `gemini-transport.ts` is the half it shares with
D161's OCR adapter (endpoint, header-borne key, the 429 → `rate-exhausted` mapping with the
provider's own `Retry-After`, fenced-JSON tolerance): two private copies of that would have drifted
on exactly how a rate limit is reported to the admission kernel.

**Admission binds the SUBJECT run, and says so honestly.** An on-demand operator advisory has no
claimed run, no node and no task to inherit an execution identity from, so
`ProviderExecutionIdentitySchema` became a plain union of two strict objects: the v9 run-node arm
with its bytes UNCHANGED (durable `provider_admissions` rows parse strictly at read — a required
discriminator would have stopped every stored admission from parsing, the D133 defect exactly) and
an advisory arm `{runId, attempt, surface}`. `#providerAdmissionContext` still validates the run's
existence, its retained attempt and its own stored config snapshot (D116's discipline: the target
run's retained identity, never recomputed from current config); only the "is executing this node"
check is skipped, because a finished run is not executing anything and claiming a node the
descriptor never reached would make the row lie about what happened (D144).

**The zero-authority edge is a property of the wiring.** `src/services/trust/advisory.ts` holds
exactly a clock and an admitted `ProviderClient<"ai.advisory">` — no store, no transaction, no
command service, no run handle — so it cannot transition a run, resolve evidence, select identity
or acknowledge a warning even by accident. The caller reads the `FailureRecord` from authority and
hands the VALUE over. The ONE durable footprint an advisory leaves is its `provider_admissions` row
and the capability counter beside it, because D112 budgets every provider call and grants a read no
exemption; `advisory-zero-authority.test.ts` proves a produced/refused/unavailable round trip
leaves every other authority family byte-identical.

**The surface asks, it does not prefetch.** The advisory is `POST /api/v1/runs/:runId/advisory` and
deliberately NOT a run-detail section: a section is fetched whenever the server advertises it, and
this call spends a provider budget — every operator opening a failed run would have made a model
call. `FailureAdvisoryPanel` renders inside the failure record BELOW its remediation ladder (the
record is the evidence; the advisory is a reading of it), behind an explicit "Explain this failure"
button, and every produced advisory carries provider/model/template-version/input-digest plus the
standing sentence that it is advisory, is not evidence, and cannot change the run. `unavailable`
and `invalid-response` render as a `Refusal` with the closed code and the reason — never a blank.

**The bootstrap's `ai-advisory` deferral came off.** `featureAvailability` now reports a fact about
THIS process — `available` when keys composed a pool, `not-configured` naming the environment
family when they did not — and the panel is its first consumer, keeping its control and stating the
server's reason rather than vanishing (the instance selector's house rule).

**Two boundary widenings, both deliberate and both named in `provider-capability-boundary`:**
`src/services/trust/advisory.ts` may type `ProviderClient` (it is the first provider consumer
outside a run task, which receives clients through `ctx.providers`), and
`src/server/dashboard/compose.ts` may import the admission module (it became a second
admitted-provider composition root). The BFF query it hands the closure to names no provider type
at all. `createTimeoutDeadlineScheduler` moved out of the worker composition root to
`src/server/scheduling/` for the same reason — two roots needing one timer is how a second ad-hoc
`setTimeout` gets born, and a bound armed on one of those is invisible to the kernel.

**Deferred at D178, dispositioned at D192.** §4.4's table names five adapters; two landed (failure
triage, and ref data-intake-and-edit-data §4.2's contact normalization). Of the remaining three, run summary and the
development-only selector-suggestion brief are now **retired** (D192, below); the record sanity
check stays **open**, deferred to order-8. `AdvisorySurfaceIdSchema` carries no arm for any of them
— a surface nothing can answer is a dead vocabulary, and retirement keeps it that way rather than
adding one later only to delete it. `evidenceRefs` on the recorded invocation is served as the
wire's `failureId` beside the outcome rather than a separate list; a receipt-scoped advisory will
need the fuller form.

**Proof:** `tests/unit/advisory-redaction.test.ts`, `tests/unit/advisory-strict-output.test.ts`,
`tests/unit/advisory-provider-exhaustion.test.ts`, `tests/unit/advisory-zero-authority.test.ts`,
`tests/unit/architecture/ai-advisory-no-authority.test.ts`, and the two new executable scenarios in
`tests/scenario/normalization-contact.scenario.test.ts`. No test contacts a live provider: the
production adapter takes its `fetch` by injection precisely so these can exist.

#### 4.4.2 The three producerless adapters get their dispositions (D192, closed 2026-08-18)

dispositions.**

- **Run summary → RETIRED.** `RunEvidenceReceipt` (D141/D144) is already the run's structured,
  byte-reproducible, per-field-redaction-declared summary, derived from authority and served by both
  `cli explain run <traceId|runId>` and the run-detail receipt section. An LLM digest over the same
  facts would duplicate it and reintroduce paraphrase risk on the exact surface D141 built to
  eliminate.
- **Selector suggestion → RETIRED as an operator surface.** An operator-facing LLM selector
  suggestion is an unverified selector reaching a live driver — the fail-loud, no-unverified-fallback
  pattern root `CLAUDE.md` bans outright. The deterministic catalog half (`npm run selector:search`)
  stays primary and is unaffected; selector discovery/repair remains the dev-time live-verification
  loop the charter already pre-authorizes.
- **Record sanity check → RETIRED (operator ruling, 2026-08-18), its deferral condition having
  been MET deterministically.** D192 deferred it to the order-8 separations migration, where it was
  to render as prose beside the ref write-safety §14 ALWAYS-GATE identity approval. Separations arrived, and
  the gate packet's own server-computed `comparisons` array (§14.2 — the deterministic side-by-side
  of disconfirming evidence, Kuali beside UCPath, leading the packet) now occupies exactly that
  slot; §9.17's live pass flagged the condition as materially satisfied and left the closure to the
  operator, who ruled: **no AI feature — the deterministic comparison IS the sanity check.**
  `AdvisorySurfaceIdSchema` stays closed at its D178 two-value shape; no surface arm is ever added
  for it. Reopening requires a fresh decision, not a build.

`config/legacy-capabilities.json` carries all three dispositions (all three AI advisory tools now
`retired`: `legacy-tool-ops-summarize-run`, `legacy-tool-ops-selector-suggest`, and — as of
2026-08-18 — `legacy-tool-ops-sanity-check-record`), and the `legacy-capability-disposition` guard
(D184) validates the shapes.

### 4.5 As-built — knowledge is admitted before it is inserted, and supersession is expressed forward (D139)


The knowledge/fix tables are insert-only (D134), so a duplicate that lands cannot be retracted.
Admission is therefore audited INSIDE the insert transaction. Two ACTIVE records may not claim the
same scoped rule — identical scope plus either the same normalized title or a shared regression
scenario — unless the successor explicitly supersedes the predecessor. An unknown supersedes ref, a
self-reference, and a duplicate id are each refused with the conflict named.

**Supersession is expressed forward by the new record**, and the active view subtracts every
superseded id. Nothing rewrites the older row, so the generated guide stops showing stale advice
without any record mutating and without the `version` field §4.3's audit would need. §4.3's
"mark stale records `unverified`" still awaits that schema decision — this slice does not guess it.

The generated per-system `KNOWLEDGE.md` is the ACTIVE view alone: superseded, retired, and
unverified records never reach it, and its header says it is generated so it cannot read as a second
authority. §4.1's `knowledge/records/` on-disk file layout is not built; the table is the authority
and `writeKnowledgeProjection(root)` is the generator. Wiring it to an npm script is 2i's, with the
explorer.

A verified `FixRecord` requires a commit plus non-empty verification evidence plus a regression
scenario; a draft may claim neither commit nor evidence; a verified fix may not link knowledge that
is missing or itself `unverified`. **A raw appended lesson is not authority**: `triageLesson` has
exactly one arm, and it returns the obligations the author still owes — there is no path from prose
to a record.
Still Phase-2g work, not landed here: automatic bundle capture triggers, retention/pinning sweeps,
notification trigger wiring, and `explain failure`. The `notification-durability` and
`knowledge-fix-integrity` guards stay **planned** until those features exist.

---

## 5. Workflow explorer/editor—staged hybrid, one graph

### 5.1 Decision

Build a **read-only workflow explorer in Phase-2 tail 2i**, with closed presentation/policy editing
alongside it after graph, validation, versioning, and evidence are proven. A free-form visual
programmer and DSL/codegen are rejected: graph/composition, arbitrary code, selectors, and
write-proof logic remain reviewed source work.

### 5.2 Phase A—read-only explorer (Phase-2 tail 2i)

The explorer is a projection of the exact descriptor and live span/checkpoint data—not a mined or
parallel graph. It shows:

- workflow input schema, surfaces, identity, enqueue policy, actions, systems, secrets;
- nodes/edges, branch conditions, parallel joins, delegation policies, gates;
- each task's input/output/error/effect/freshness/provenance/scenarios;
- UI elements/page states/observations used by each browser task;
- transaction subject-binding, probe, fence, proof, and dry-run boundary;
- editable vs read-only checkpoint fields;
- source links to descriptor, contract, impl, driver, scenarios, knowledge;
- on a selected live run: the same graph overlaid with timings, attempts, checkpoint reuse,
  failures, children, evidence, and current safe actions.

This serves both operator debugging and AI code changes: “the failure is at
`separations/ucpath-transaction → ucpath.smart-hr.ready-to-submit`” resolves to stable ids and source
locations without reverse-engineering row prose.

### 5.3 Phase B—safe edits only

> **DEFERRED OUT OF PHASE 2 — D186 (2j, 2026-08-09).** Phase B is **not built**, and this is a
> decision rather than a slip. The argument is D79a's own, one level down: an editor exists to
> avoid a code change per tweak **across many workflows**, and the tree today has ONE production
> workflow (`person-lookup`) plus the one-node transaction proof
> (`kuali-timekeeper-annotation`). With one workflow, editing the source IS the cheaper and more
> reviewable path, so a Phase-B pipeline right now would be — in §5.4's own words about the
> trimmed DSL — "a pipeline whose only user is its own test". Building it against a single
> consumer would also fix its closed policy union and its override schema against a sample of
> one, which is precisely how an authoring surface acquires the wrong shape.
>
> **What holds the line meanwhile.** Phase A shipped and is proved: the explorer is a projection
> of the ONE composition root, and `workflow-editor-compile-integrity` asserts the read-only
> boundary in both directions plus D79a's no-DSL trim. Its guard-inventory entry already records
> that it carries **no Phase-B arms**, and it gains them in the commit that builds them. Nothing
> about the deferral weakens a safety property: there is no partial editor, no half-authority, and
> no config path that can reach a descriptor.
>
> **The trigger that ends the deferral, named so it is checkable.** The SECOND production workflow
> whose presentation, notification preference, or allowlisted policy value an operator wants to
> change *without* a code change. At that point the closed set has two consumers to be shaped by,
> and §5.4's apply protocol (strict versioned override, temp+fsync+atomic-replace, stale-base
> refusal, code-change brief for everything else) is what must be built — unchanged by this
> deferral. Doc 02 §Exit criteria is amended accordingly; the criterion is not waived,
> it is reassigned to the migration that first needs it.

In Phase-2 tail 2i, the editor may change only a closed, reviewable subset:

- presentation labels/order/grouping and notification preferences;
- choose explicitly allowlisted presentation and operational policy values from closed unions;
- configure descriptor-allowlisted Edit Data fields.

It may not author arbitrary JavaScript, new task implementations, selectors/locator recipes,
page-state evidence, subject matchers, mutation helpers, proof schemas, idempotency keys, or secrets.
Those remain code changes. The editor may generate a patch scaffold naming the exact required files
and failed obligations.

### 5.4 Compile/apply protocol

Every edit is a draft with a base descriptor version/fingerprint. “Validate” runs the same builder,
schema, graph, guard, and scenario checks as source-authored descriptors. “Generate patch” produces:

- canonical descriptor JSON/TypeScript patch;
- human-readable semantic diff (nodes, edges, effects, policies, UI ids, evidence obligations);
- impacted workflows/tasks/scenarios;
- new descriptor version/fingerprint requirement.

> **DSL-authored mode is TRIMMED (D79a, operator 2026-07-24).** This section previously defined
> two authoring modes and a whole second pipeline for the DSL one: exclusive per-workflow mode,
> deterministic codegen into `descriptor.generated.ts`, an isolated-output-directory build,
> restart-gated atomic apply, and exact-hash rollback. It is cut. Two reasons, both from the plan's
> own text: §b question 12 expects everything real to stay source-authored, and the Phase-2 proof
> would have needed a *synthetic* workflow because no real candidate was ever named — a pipeline
> whose only user is its own test. **Every workflow is source-authored.** Reconsideration requires
> a new explicit operator architecture decision; migration questionnaires cannot enable it.

**What remains after the trim.** There are two apply levels. **Presentation-only** changes write the
existing strict versioned override through temp+fsync+atomic-replace and can hot-apply.
**Graph/composition/code-only policy** changes never mutate a live descriptor; the editor emits a
**reviewed code-change brief** and
cannot apply the edit itself. Anything the closed editable set cannot express produces a
**code-change brief**, never partial config and never a second authority.

_The rejected DSL pipeline's own design text — codegen, isolated build, restart-gated apply,
exact-hash rollback — is preserved verbatim at
`docs/rebuild/history/superseded/2026-08-20-operator-trust-5.4-dsl-authoring.md`. It is history,
not a design to implement._

### 5.5 New-workflow authoring path

The same explorer provides a guided scaffold flow so adding a workflow does not begin with string
search and copied boilerplate:

1. choose a unique workflow id/code/category and strict input/result schemas from canonical fields;
2. search registered tasks by intent/system/input/output, inspect their scenarios/UI dependencies,
   and compose task/transaction/branch/parallel/child/gate nodes;
3. define stable item identity, input subject, result derivation, enqueue/actions, delegation,
   freshness, evidence, and notification expectations;
4. receive an automatically generated “missing obligations” list—unbound fields, uncovered branch,
   missing subject observation, result dependency, proof/probe, scenario, UI id, or secret;
5. generate a source-authored workflow/scenario scaffold plus code-change brief; no DSL or runtime
   generated descriptor is produced.

The authoring UI never invents a task because a name looks similar. It shows exact schemas and
requires an explicit binding. New browser behavior starts in the UI registry/driver/task contract,
then becomes selectable by workflows; this is the “fix once, reuse everywhere” path.

### 5.6 What happens to the old workflow modifier

Its useful presentation editing and operation mining are port inventory. The preserved legacy
modifier stays inside the legacy repo; with no shared module graph (D93) it cannot be proxied or
imported. The new read-only explorer replaces mined operations with descriptor tasks and
driver UI ids. Presentation overrides may migrate into Phase B once they round-trip through the
same descriptor projection. Generated `config/workflow-design/*.md` files are not runtime
authority; the descriptor and validated draft history are.

### 5.7 Phase A as-built — the explorer is a projection, and it proves it (2026-08-09, D176)

Phase A landed in 2i-G. §5.2's list is served, with two named exclusions below.

**The derivation, and why it is the whole contract.** `buildWorkflowExplorer`
(`src/server/dashboard/queries/explorer.ts`) reads the ONE composition root — `WORKFLOW_MODULES` —
plus each descriptor's factory-sealed `workflowProjections` / `descriptorRuntimeNodes` /
`workflowTerminalResultExecution`, the generated build manifest, `config/pending-impl-bindings.json`,
and the in-code UI registries. There is no literal node list, no per-workflow switch, and no
hand-maintained table anywhere in it. A workflow appears because it is registered and a node appears
because the factory returned it. `workflow-editor-compile-integrity` asserts that over the REAL
registry in both directions, so "this is the as-built graph" is a checkable claim rather than a
caption.

**Source links RESOLVE; they are never interpolated.** A path is rendered to a human — or to an AI
about to open it — as "the file that owns this fact", so every path is a candidate looked up in a
real listing: the manifest's own fingerprinted source closure for a contract and its store
implementation, the scenario directory listing for a scenario. A miss is reported `unresolved`
carrying the exact path it tried and why. Printing `src/domain/contracts/<id>.ts` because the
convention usually holds is the plausible-but-wrong value the charter forbids. A workflow
mini-store's `workflow:` scheme is translated to a path segment in exactly one place, and the result
is then checked like every other candidate.

**UI links are reversed out of the catalog's own `taskUses`, not re-derived.** The relationship is
already data in the driver registries (§1.2); walking recipes to recompute it would produce a second
answer that could disagree with the one `semantic-ui-registry` pins.

**A closure is reported as its presence, never as decompiled prose.** `bind`, `choose`,
`derive`, and the write-safety key function are shown as the shape they sit in plus their source
file. (`when` was in that list until D228 removed it from the list of closures entirely — see §5.9.) `inputSubject` states whether it is a declared constant or a function of the input rather than
being evaluated against a fabricated input to print a specimen answer. A freshness bound of
`Infinity` crosses the wire as the word `unbounded`: as a raw number `JSON.stringify` turns it into
`null`, which reads as a MISSING bound rather than a deliberate one.

**Two exclusions, each with its reason.**

- **The live-run overlay** (§5.2's last bullet — the same graph carrying timings, attempts,
  checkpoint reuse, failures, children, evidence and safe actions) is NOT in this slice. Ref dashboard-surfaces's
  run-detail timeline already serves those facts per run; joining the two projections is its own
  work with its own wire, and shipping half of it would put a second, thinner run view beside the
  one operators already use.
- **Scenario coverage CLAIMS** are absent by construction. What a scenario claims to cover lives in
  the executable corpus (`tests/scenario/coverage-claims.ts`), `scenario-coverage` already audits
  those claims against the graph in both directions, and `src/` importing a test module to re-serve
  them would put a second copy of that relationship in the product. Each node's own derived coverage
  points are served instead — those come from the graph, which is where they are true.

**Phase B is not started, and the guard says so.** `workflow-editor-compile-integrity` is `active`
with only the arms Phase A can hold; §5.3/§5.4's draft union, stale-base apply and code-change brief
have no code, so the guard has no arms for them and its inventory entry states that in as many
words. The guard gains them in the commit that builds them.

**Presentation as-built delta (2026-08-14 — no contract change, no new wire field).** The surface
is now the operator demo's three-panel explorer (`src/dashboard/surfaces/explorer.tsx`, provenance
`hr-automation@1bffbd65`) over the SAME `/api/v1/explorer` projection this section describes. Where
the demo draws a fact this wire does not serve, the port omits or restates rather than fabricates:
the toolbar slot the demo's run picker occupies carries the workflow identity band (the run overlay
stays excluded per the first exclusion above — the demo's per-node run state, recorded values,
provenance lines and delegation child rows are ALL that one exclusion, seen from four angles); the
node panel's contract table listed TASK ARMS, not contract fields, with its header counting arms and
the ⓘ saying so in as many words — **superseded by §5.9 (D227), which serves a derived field census
and counts fields**; the graph header omits the demo's file-count segment (a per-run
fact, not a registry one); no lane dividers exist because no lane fact exists on the descriptor
(a descriptor-authored phase would sit inside §5.3's closed editable set once Phase B exists); and
the demo's `Version registry` header action is absent because no version-registry surface exists in
this tree. The conditional-node line printed "runs when the descriptor's own when() predicate
holds" — honest, and less than the demo's authored sentence — and the recorded fix named an authored
`whenLabel` / node `purpose` / workflow `summary`. **Two thirds of that landed and one third was
refused**: `purpose` and `summary` are authored data (§5.9, D229), while `whenLabel` is refused
because a sentence beside a predicate is a second description of one rule — the `when` itself became
a DECLARED condition instead (ref workflow-model §3.3, D228). Read-only per D186
throughout: no edit affordances anywhere.

### 5.8 The generated UI catalog gets a surface, and it serves the COMMITTED artifact (2026-08-09, D177)

§1.3's catalog was reachable only from `npm run selector:search` and two markdown projections. It
now has a read-only surface, and two rules make it trustworthy.

**It serves the committed bytes and never regenerates.** `npm run ui:catalog` is the ONE writer. A
surface that regenerated on read would silently heal a stale checkout mid-session — precisely the
defect the 2026-08-03 tracked-artifact lesson records. So the query opens
`generated/ui-catalog.json` read-only, parses it, and then asserts through the drivers' own
`assertSafeUiCatalogFresh` that what is on disk still equals what the registries compose. A stale
artifact **throws with the generator's own remediation** rather than being served: a catalog that
disagrees with the drivers describes selectors the system does not use, and an operator or an AI
acting on it would be acting on fiction.

**Provenance sits beside the id, not behind it.** §10 says plainly that the registry cannot make a
stale live verification current, so every row carries its `verifiedAt` and both evidence refs at the
same weight as its id — never folded into a disclosure a hurried reader skips.

### 5.9 The node panel is a FIELD table, and its census is derived (2026-08-19, D227)

§5.7's presentation delta recorded that the ported node panel listed TASK ARMS where the operator's
demo lists contract FIELDS, and that the header counted arms with the ⓘ saying so. That gap is
closed: the panel is a field table, `Field · System · Recorded`, and no part of it is authored.

**The census is a projection of the contract's own zod shape.** `contractSchemaLeaves`
(`src/validation/contract-boundary.ts`) walks the SAME schema object `deriveSchemaHash` fingerprints
into `inputSchemaHash` / `outputSchemaHash`, so the field list and the hash on the arm band above it
describe one shape. A hand-maintained field list beside a schema hash is the classic pair that
eventually disagrees, and there is nowhere in this tree to author one.

Three rules decide the census, and each is borrowed rather than invented:

- **An array is ONE leaf**, exactly as `evidenceLeaves` and the freshness / provenance `byField`
  prefix rule already treat it. Indexing rows would be a census of a specimen run, not of a
  contract — and a `Recorded` verdict would then resolve at a granularity no policy can name.
- **A union contributes the UNION of its arms' leaves**, and a path missing from any arm is
  `sometimes`. That is `schemaOwnsPath`'s `every`/`some` split seen from the producing side. A field
  that is `z.null()` in one arm and an OBJECT in another is listed as its children only: the bare
  null row would count a container as a field, and the children's `sometimes` already carries "this
  may hold no record".
- **An unrecognised zod tag throws by name.** A tag this walker does not understand may be a
  container, and emitting one row for it would under-report a whole subtree while looking complete.

**`Recorded` is a fact about provenance, never a value.** No run is laid over this graph (§5.7's
first exclusion), so the recorded VALUE of a field is not a fact the registry holds. What it does
hold is the descriptor's declaration, and every arm of `ExplorerFieldRecordedWireSchema` is a
statement the registry can actually make: a read arm's output leaf is `observed` with its provenance
source (longest declared prefix, the kernel's own rule) and its freshness bound (whole-path match,
also the kernel's own rule — the two genuinely differ and the explorer states each the way its
consumer enforces it); an INPUT leaf is `bound`, because the graph binds it and nothing observes it;
a prepare arm's output is `not-recorded`, because its checkpoint is in-memory-only; a commit arm's
output is `checkpointed` in the transaction outcome (D144). The fifth arm is `unknown`, and it is
deliberately reachable — a read contract whose provenance this projection did not receive leaves its
outputs undeclared, and the column then says so by name rather than printing the `live` most reads
happen to declare. Substituting the common answer for the missing one is the plausible-but-wrong
value the charter forbids.

**A node's `when`, in words.** §5.7 recorded the conditional line as "runs when the descriptor's own
when() predicate holds" and named an authored `whenLabel` as the fix. The fix taken instead is
**D228** (ref workflow-model §3.3): the condition is DECLARED data, the executor evaluates it and the surface
renders it through `describeNodeCondition` — one value, two readers, so the sentence cannot disagree
with the rule. §5.7's "a closure is reported as its presence" is unchanged for `bind`, `choose`,
`derive` and the write-safety key; `when` simply stopped being a closure. The wire's
`shape.conditional: boolean` is replaced by `shape.condition`, and a condition the closed vocabulary
cannot express is a compile error in the descriptor rather than a plausible sentence here.

**The descriptor's own words (D229).** §5.7 recorded that the ⓘs open with the DERIVATION ("this
graph is the as-built descriptor, read from …") where the demo opens with the descriptor's own
sentence, and named authored prose as the fix. A descriptor now carries `summary` — one sentence
about the workflow — and `nodePurposes`, one sentence per node, both plain data on the broad
descriptor view beside `subjectProjection` and `timeline`. A declared node-purpose list is
**exhaustive**, checked by the factory for D225's reason: a node quietly missing its sentence is a
node the surface stops explaining while every gate stays green. The derivation note has not gone —
it moved one paragraph down, because the descriptor's sentence is what the reader came for and the
derivation is how they know to trust it.

The wire carries `{state:"authored"} | {state:"absent", reason}` rather than throwing, and the
choice is deliberate: the explorer serves every registered workflow in ONE document, so refusing the
whole surface over a missing sentence would take the operator's index of the system down for a piece
of prose. The `absent` reason names the file that owes one, because the reader of this surface is
exactly the person — or the AI — who would author it, and nothing composes a sentence from a
two-word label. **`explorer-prose-declared` is what makes the arm unreachable in the product**: a
registered workflow with no summary, or a node with no purpose, fails the build. A fixture
descriptor is out of scope by design — it is not in the composition root, and prose about a graph
nobody runs is prose nobody reads.

**The header counts fields now.** A read is one field a read arm observes FROM a system — an output
leaf; a write is one field a commit arm writes TO a system — an input leaf. A prepare arm stages the
values its commit then writes, so its inputs are deliberately not counted, or every write would be
reported twice. The demo's third segment (`1 file`) stays absent for the reason §5.7 already gave.

---

## 6. Notifications—durable, event-derived, and actionable

The notification wire is owned by ref dashboard-surfaces; this section defines operator behavior. Notifications
are produced server-side from durable state/event transitions, never solely from a React effect.
They survive dashboard reloads and dedupe by stable fingerprint.

Notify only when the operator would need to know or act after missing a toast:

- run failed/Done (`verified-done` key)/Done with warnings/cancelled/partial;
- operator gate opened or resolution failed;
- write recovery needs proof/absence confirmation;
- subject mismatch;
- storage/backup/integrity/disk health failure;
- repeated failure fingerprint crossed a threshold;
- capture or blocking local projection completed/failed.

Transient acknowledgements (“copied”, “saved draft”, “retry requested”) remain ephemeral UI
messages. Every durable notification links to a run/failure/gate/command/storage incident and offers
only actions currently authorized by the server projection. Reading/snoozing affects the
notification, never the underlying run or failure.

### 6.1 The fold is an UPDATE, and that is not a weakened ledger (D134)

A repeated identical trigger folds into the **one row** its `(actorId, dedupeFingerprint)` already
owns: `count` increments, `lastSeenAt` advances, `status` returns to `unread` (a repeat is news
again), and `version` advances exactly once. Schema v10 adds the unique `(actor_id,
dedupe_fingerprint)` index and SQLite triggers that freeze `notificationId`, `actorId`,
`dedupeFingerprint`, and `createdAt`, refuse a `version` that does not advance by exactly one, and
refuse a `seen_count` that rewinds. `AuthorityRepositories.notifications` is therefore the one
authority repository with a mutation surface (`fold`, `updateState`) rather than insert-only.

**Why an update and not append-and-fold.** The folded firings leave no rows behind, so `count` and
`lastSeenAt` are not derivable from any history — an append-only encoding would have to invent a row
per firing purely to be counted, and ref dashboard-surfaces §2.6 explicitly says a repeat must NOT spam the inbox.
Read/unread and snooze are per-notification operator state by nature; folding them would make the
unread inbox a projection rather than the authority ref dashboard-surfaces names it.

**Why it does not touch the ledger's immutability.** A notification is derived operator-facing state
about something else that happened; the ledger is the record of what was really filed against a live
HR system. Those are different classes of fact and schema v10 keeps them structurally different:
`ledger_projections` and `ledger_partitions` carry `BEFORE DELETE` triggers that abort, a projection
may make exactly one `assigned → appended` transition and can never have its `seq`, digest, or
partition rewritten, and `ledger/*.jsonl` is append-only and never pruned. Nothing about the
notification fold is available to the ledger, and nothing in the ledger is mutable.

### 6.2 The durable row is committed BEFORE any delivery, and a failed toast changes nothing (D138)


`publish` settles create-or-fold in one authority transaction and only then attempts OS delivery.
A delivery that throws is **reported and never written back**: status, count, and version are
untouched, so the operator who missed the toast still finds an unread item — that, not the toast, is
the alert (§6, ref dashboard-surfaces §10.4). No per-attempt delivery state is stored; storing one would invite a
retry loop that mutates the record the operator is reading. A missing desktop channel reports
`no-channel`, never success.

Ref dashboard-surfaces §2.6's event list routes onto D79b's six trigger keys: run failure and subject mismatch →
`failed`; open operator gate → `gate-waiting`; unknown write outcome → `write-parked`; repeat
threshold → `repeating`; storage degradation, stalled lease/outbox, and failed backup → `storage`;
and the verified-done receipt → `verified-done`. The first five ping; `verified-done` is inbox-only.

**A notification carries no free text.** Every trigger-event arm is ids, closed codes, and counts,
and the title/summary are composed from those — because §2.6 forbids raw secrets and captured form
contents in notification text, and the only way to guarantee that is to give leakage nowhere to
enter. The dedupe fingerprint covers what makes two firings the same trigger and never the
occurrence, the instant, or the count, so a repeat folds (§6.1) instead of minting a row. Snooze
suppresses delivery only: it never flips status, and marking read never clears a snooze.

---

## 7. Local-FIRST scope, the multi-user seams, and the retained safety floor

**Amended 2026-07-23 (D75).** The operator intends to open this tool to other people later and
wants that to be *configuration, not a second rebuild*. So the scope statement is no longer
"local-only" but **local-first with four deliberate seams**. Everything below about what is *not*
built is unchanged; what changes is that four cheap structural decisions are now load-bearing and
**may never be trimmed as ceremony**, because retrofitting any of them later means touching every
command, every run, and every stored record.

| Seam | What it means today | Why it must exist now |
|---|---|---|
| **Actor attribution** | every command, run, approval, gate resolution, ledger entry, and fix record carries `requestedBy`/`actor`, constant `"local-operator"` | retrofitting an actor onto an existing immutable ledger and command history is impossible — the old rows have no honest answer |
| **One identity checkpoint** | a single auth seam every request passes through, returning the constant local operator | one place to change later; without it, authorization logic scatters across routes |
| **Credential-set-keyed sessions** | browser sessions/logins keyed by credential set, with exactly one set configured | a future user brings their own HR logins and their own Duo; pre-keying makes that config |
| **Per-actor notification/read state** | the inbox is actor-keyed with one actor | read-state is per-person by nature; a global unread flag cannot be split later |

This does **not** soften the safety floor and does not add scope: no RBAC, no permissions UI, no
user management, no teams, no network deployment or TLS, no per-user dashboards, no remote sync.
The dashboard still binds loopback. D79c follows directly from this: commands keep `version` +
`actor` in the wire shape **everywhere**, while CAS enforcement stays only where a real race exists
(cancel-tree, edit-vs-resume, gate resolution, write-recovery) — the seam is in the shape, not in
the enforcement cost.

Not built now: user accounts/RBAC, tenant separation, remote/cloud deployment, distributed
consensus, external audit signing, high availability, public API compatibility, or enterprise
plugin ecosystems.

**Reaffirmed 2026-08-12 (D193) — solo is the shape; cooperation is a LATER layer on top of it, if
ever.** The operator restated the scope in its sharpest form: the system is fully local to the one
person using it, solo-operator only, and is **never hosted**. That does not retire the four seams —
they are already built, they cost nothing to keep, and they are exactly what keeps a later
cooperation mode a configuration rather than a second rebuild — but it does settle their
*direction*: multi-user is built **over** the solo system later, so **no slice designs for it now**
and none may claim scope, ceremony, or abstraction in its name. The charter's Non-negotiables carry
the normative statement, including the second named future item (packaging the local system as a
locally-run app) and the reading rule that "production" in these plans means the D89 local cutover,
never a hosting platform.

Still mandatory:

- bind the operator dashboard/API to loopback only; native LAN/remote operator mode is rejected;
- permit exactly one explicit exception: an operator-started, short-lived mobile-capture ingress
  may expose only the token-scoped phone assets/status/upload/replace/reorder/delete/finalize routes
  listed in ref data-intake-and-edit-data §5.1. The ingress starts with a capture session, expires/stops with it, and cannot
  route to queue, commands, files, evidence, settings, health, or any catch-all route;
- never log/export secrets; restrict and redact SSN/I-9/HR data in notes/bundles/screenshots;
- durable DB integrity/backups/restore because local single-operator state is irreplaceable;
- fail-closed writes, subject binding, typed commands, and immutable write receipts;
- schema validation at every persisted/transport boundary;
- reproducible diagnostics and scenarios.

These are correctness and recoverability requirements, not production-scale ceremony.

---

## 8. Base capability inventory (webpage-ready)

The following is the canonical list Claude may use to build an explanatory webpage. It describes
what the **base** implements before workflow-specific leaf behavior is migrated:

1. Strict runtime-validated domain types and branded ids.
2. Read / prepare / commit task effects with typed inputs, outputs, errors, freshness, provenance,
   examples, and scenarios.
3. Per-system task stores, service stores, and pure workflow mini-stores.
4. Canonical semantic UI registry with stable element/screen/page-state/observation names.
5. Typed system drivers; no raw Playwright page in workflow/task code.
6. Workflow descriptor as the single source for graph, UI, actions, identity, gates, and policies.
7. Typed DAG nodes: read, transaction, branch, parallel join, child run, and gate.
8. Standard delegation contract for one/many children, joins, failure, cancellation, retry, and
   partial outcomes.
9. Workflow-constant input plus typed checkpoint context and start-at-node validation.
10. Field-level provenance, freshness checks, and safe Edit Data patches.
11. Server-authoritative enqueue/coalesce/supersede policies and versioned command engine.
12. Standard queue operations: cancel, retry, bump, hide/restore; destructive purge is separate.
13. Explicit per-workflow worker counts, one active item per worker, visible backpressure, and authored fresh-browser-session boundaries.
14. Page reset/poison isolation and context-exclusive write transactions.
15. Automated Duo login for every authenticated browser session, including production; service-only
    runs do not acquire a browser or invoke Duo.
16. Fail-closed fresh subject binding before every real person/file-scoped write fence; declared
    subject assertions are also available to high-risk reads.
17. Permanent write intents, same-key concurrency fence, typed landing proof, and at most one
    unattended commit attempt per intent generation; recovery needs typed positive proof or a
    sequence of authoritative negative observations all captured after the propagation window,
    otherwise it
    parks, and there is no generic “force done”.
18. Never-pruned ordered actor-attributed write ledger projected from atomic outboxes; hash-chain/
    tail-anchor tamper evidence is deferred until multi-user.
19. Content-addressed immutable artifacts and idempotent outbox-based mutable projections.
20. Append-only span/note streams and server-side queue/timeline/session projections.
21. Durable actor-keyed typed notifications with read/unread state and optional snooze.
22. Structured failure records and automatic redacted diagnostic bundles.
23. Per-run evidence receipts showing inputs, observations, decisions, actions, verification,
    output, reuse, and uncertainty.
24. `explain run`/`explain failure` CLI/API and portable diagnostic export.
25. Registered scenario corpus with wrong-page/wrong-subject/crash/control/storage cases.
26. Bug-fix rule requiring a linked regression scenario or explicit evidence exception.
27. Structured active/superseded/retired knowledge records instead of append-only lessons.
28. AI FixRecord ledger linking code changes, failures, scenarios, evidence, and commits.
29. Read-only workflow explorer overlaying descriptor design and live execution on the same graph.
30. Constrained, versioned editing of closed presentation and operational-policy fields in Phase-2
    tail 2i; graph/composition changes remain source-authored code changes.
31. Operator-defined spreadsheet mappings keyed by stable target-field path (not just concept),
    with projection fingerprints, duplicate-safe source columns, per-cell schema errors, and saved
    layout maps.
32. One command envelope with strict run, gate, notification, and capture arms; typed gate results
    live in authority while events carry only their immutable reference/hash.
33. Raw ingress transformed exactly once into canonical input; every authority read revalidates a
    transform-free/default-free canonical schema and semantic changes require explicit migration.
34. Immutable per-run config/instance snapshots and one injectable clock.
35. Fail-loud fiscal-year configuration and one secrets accessor.
36. SQLite startup doctor, WAL/disk monitoring, native online backups whose completed copy
    self-reports its authority generation, pre-migration backup, tested restore, and read-only
    rescue mode.
37. Full type/lint/architecture/fixture/stub/live guard umbrella with non-vacuity checks, zero-debt
    rebuild linting, and fingerprinted shrink-only legacy test-lint debt during coexistence.
38. Bidirectional runtime/state/import isolation plus one global cutover interlock; no per-run
    legacy/native generation or gradual production flip.
39. Immutable intake admission manifests and hash-diffed reruns showing every valid, rejected, and
    explicitly excluded source row.
40. Guided new-workflow scaffolding with task/schema search and a generated missing-obligations list.
41. Loopback-only single-operator control runtime, with only the short-lived token-scoped mobile
    capture ingress exception; no RBAC/team/HA/remote operator deployment machinery in the base.
42. Generated UI and active-knowledge catalogs plus exact source links for operator/Codex/Claude
    reference—generated views are never a competing authority.
43. Durable restart-safe mobile capture sessions with immutable photo refs, idempotent ordering,
    retryable bundle outbox, and atomic PDF→intake/OCR handoff.
44. Typed contact/address normalization that distinguishes unchanged, ambiguous, and provider-
    unavailable results and preserves the source of every proposed field change.
45. Closed provider capabilities for OCR/geocoding/AI, with narrowed injected clients, infra-only
    SDK/network adapters, timeout/abort/concurrency/rate/cost budgets, preflight, evidence, and
    produced/unavailable/invalid outcomes—remote I/O cannot hide in an import.
46. Optional schema-bounded AI triage/sanity/selector/summary assistance over redacted structured
    evidence; it has no command, identity, registry-write, completion, or mutation authority.
47. Machine-checked legacy capability disposition so every old service/route/UI/CLI/tool is native,
    replaced, retired in the target, or visibly blocking cutover; it never authorizes old-source deletion.
48. One exhaustive runtime-dependency inventory covering every browser system, provider,
    endpoint, env/config/secret consumer, and preflight check in both directions.
49. One typed environment doctor powering startup, Settings health, workflow preflight, and
    `test-login`, with exact blocking capability and remediation instead of scattered checks.

### What is better than the old codebase

- Fix a selector/page-state once in the system driver; every task using the canonical id benefits.
- Fix an operation once in the task store; workflows compose it rather than copy it.
- A field rename breaks consumers at compile time and invalid external/persisted data fails at
  runtime boundaries instead of leaking inward.
- Wrong/stale person pages are blocked by authoritative observed identity, not inferred from what
  the operator searched for.
- Queue/delegation behavior is kernel-owned and uniform instead of workflow-specific route logic.
- A run cannot claim success without evidence; reruns disclose what was reused and why.
- Failures arrive with a stable fingerprint, context bundle, prior fixes, and a safe next action.
- New scenarios discovered during real use become regression fixtures instead of silent fallbacks.
- AI tools read current generated guidance and stable ids, not a pile of contradictory lessons.
- The workflow editor explains the real graph first and edits only what the contracts can prove.

---

## 9. Mechanical guards

Ref guards-and-tests registers the following:

- canonical UI ids/search terms unique; every task-used element/state/observation resolves;
- raw `Page`/`Locator` imports and `page.` calls restricted to driver/session infrastructure;
- subject-scoped browser tasks have registered authoritative observations and mismatch scenarios;
- strict runtime schemas parse all UI registry, scenario, knowledge, fix, evidence, failure, and
  diagnostic manifests;
- no persisted free-form `Record<string, unknown>`/`Record<string, JsonValue>` outside an explicit
  opaque diagnostic payload that is never used for decisions;
- every non-trivial fix references a registered regression scenario/evidence exception;
- generated active knowledge contains no superseded/retired/unverified records;
- workflow editor drafts cannot name unregistered tasks/fields/policies and cannot modify active
  run snapshots;
- diagnostic redaction fixtures prove restricted example values never appear in exported bundles;
- durable notifications derive from server events and dedupe/lifecycle transitions are replay-safe.

---

## 10. Explicit residuals

- Locator/page-state correctness still ultimately depends on live system behavior. The registry
  makes evidence, ownership, and reuse explicit; it cannot make a stale live verification current.
- Some pages expose no authoritative subject identity. A subject-scoped write on such a page cannot
  auto-commit; it must gain a verified cross-page observation/proof or park for typed operator
  confirmation. “The search succeeded” is not sufficient evidence.
- A constrained visual editor cannot express every complex workflow. Falling back to reviewed code
  is expected, not a failure of the model.
- Diagnostic screenshots may contain unavoidable HR context. Capture-time redaction/minimization
  reduces exposure but cannot promise perfect visual redaction; restricted bundles remain local and
  short-lived unless pinned.
