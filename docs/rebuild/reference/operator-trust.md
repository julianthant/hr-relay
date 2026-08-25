# 12 — Operator Trust, Semantic UI Vocabulary, Diagnostics, Knowledge & Workflow Authoring

Status: **binding contract; as-built through Phase 2j, Track B (D227/D237) and D262's gate-park
publisher, re-verified against the code 2026-08-20.** This document owns the human-facing foundation
that turns the typed executor into a system the single operator can understand, debug, extend and
trust. It is **local-first with deliberate multi-user seams** (D75, reaffirmed D193 — §7): no RBAC,
no user management, no remote administration, no distributed coordination, but four seams that keep
a later multi-user migration configuration rather than a second rebuild. It retains correctness
controls, PII/secret redaction, local-only network defaults, durable recovery and evidence, because
this tool reads and writes real HR records.

**Where the code and this document disagreed on 2026-08-20, the code won and the sentence changed.**
A contract that is designed but unbuilt now says so by name in its own section instead of being
written in the present tense; each such gap names the node that owns it. The standing shape
decisions this doc still carries: the DSL graph-authoring mode is trimmed (§5.4, D79a), the Workflow
Explorer's EDIT half is deferred behind a named trigger (§5.3, D186), UI knowledge is copy-ported
with provenance into a repository that shares no module graph with legacy (§1.3, D93), and the
minimal durable `FailureRecord` is Phase 1f's while automatic bundles, receipts and `explain` are
Phase 2g's (§2).

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

<!-- roadmap: phase-1 -->

<!-- roadmap-status: phase-1 -->
- [x] a stable operator vocabulary instead of TypeScript property paths — four branded ids, 120 catalog entries (§1.1, §1.7)
- [x] tasks cannot reach a raw `Page` — `task-driver-boundary`, AST plus transitive import graph (§1.4)
- [x] a failed run persists a structured record rather than a message — Phase 1f's durable `FailureRecord` (§2.1)
- [x] a `done` run carries a receipt of inputs, observations, decisions, actions, verification, reuse and uncertainty (D141, §2.3)
- [x] the explorer answered “documentation or editing surface” — read-only, edit half deferred behind a named trigger (D176/D186)
- [ ] lessons still accumulate as prose: the structured store is built and nothing writes to it (§4.1)
> 2026-08-20 | docs-cohesion operator-trust | verified each of §0's six drift problems against the code; five are closed by the base, the sixth (lessons → knowledge records) is blocked on a caller, not on a schema
<!-- /roadmap-status -->

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

<!-- roadmap: p1-authority -->

<!-- roadmap-status: p1-authority -->
- [x] four branded semantic ids, imported and never redeclared (D101) — `src/domain/ids.ts:43-46`
- [x] four per-store server-only registries; locator recipes never leave the server (§1.2, §1.7)
- [x] typed drivers, raw Playwright confined to the driver/session owners — `task-driver-boundary`
- [x] verification is conjunctive (D98/D99) and a staging anchor carries `exactly-one-editable` (D208)
- [x] the generated catalog is the ONE projection and throws when stale (§1.3, D177)
- [ ] `semantic-ui-registry` never calls Kuali's own audit functions — three stores of four (§1.7)
- [ ] D208 rule 1 is an authoring obligation, not a machine check; its trigger is a second exception (§1.6)
> 2026-08-20 | docs-cohesion operator-trust | verified against src/domain/ui/**, src/stores/*/driver/ui-registry.ts, generated/ui-catalog.json and tests/unit/architecture/{semantic-ui-registry,task-driver-boundary}.test.ts; left: the Kuali audit call site and D208's second exception
<!-- /roadmap-status -->

### 1.1 Four identifiers with one job each

<!-- roadmap: p1-authority -->

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
separate `EvidenceEntryId`; operator-correction `supersedes` links point to that prior entry id.
`ObservationId` is never reused as generic evidence-row identity.

**As-built.** The four ids are `brandedText<…>(QUALIFIED_ID_PATTERN, …)` at `src/domain/ids.ts:43-46`
and are re-exported — never redeclared — by `src/domain/ui/contracts.ts:13-25` (D101). An
`EvidenceEntryId` is **derived**, not minted: `deriveEvidenceEntryId(receiptId, kind, key)`
(`src/domain/trust/evidence-identity.ts:46-54`) over a receipt id itself derived from `(runId,
attempt)`, which is what lets §2.3.2 re-derive one run's receipt to the same bytes. A random UUID
there would have made determinism impossible.

### 1.2 Registry record

<!-- roadmap: p1-authority -->

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

**As-built — the record above is the SHAPE, not one shared type.** There is no single
`UiElementDefinition` in the tree and deliberately so (§1.5): each store owns its own schema family
under `stores/<system>/driver/ui-registry.ts` — `src/stores/ucpath/driver/ui-registry.ts:181-274`,
`crm/…:62,114,155`, `kuali/…:183,277,318`, `new-kronos/…:129,182,223` — because a locator recipe is
a fact about ONE system's DOM and a shared union would have to admit every system's arms at once.
What IS shared is the cross-store vocabulary and the safe projection: `src/domain/ui/contracts.ts`
holds `UiSemanticKindSchema` / `UiSensitivitySchema` / `UiRoleSchema` / `UiEffectSchema` (`:27-32`),
`UiCatalogVerificationSchema` (`:45-53`) and the `UiCatalogEntrySchema` union §1.3 projects
(`:154-172`).

Three shipped fields the record above does not show, and one it shows that does not exist. A real
element carries **`provenance`** (`LegacySelectorProvenanceSchema`: the pinned legacy commit, path,
key, source line and blob — the copy-with-provenance rule made structural), **`scope`**
(`"page" | "content-frame"`, because PeopleSoft renders inside an iframe and a recipe that does not
say which document it means is a recipe that resolves twice) and **`portContext`**; `supersedes` is
a required array rather than optional. The `value?: CanonicalJsonSchema<…>` shown above is **not**
how a value type is declared — the shipped field is a flat `valueType` enum (`"eid" | "text" |
"rows" | "none"`), narrow on purpose. All 406 ported keys are pinned to a fixed legacy commit's
blobs by `legacy-selector-port-provenance`, so legacy moving on cannot invalidate the provenance
(and, per the charter, live re-verification at each migration is what keeps the SELECTOR current).

### 1.3 One canonical catalog for the operator and AI tools

<!-- roadmap: p1-authority -->
<!-- roadmap: p2-2i -->

The build generates a **safe projection** at `generated/ui-catalog.json` and one per-system
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

**As-built.** `npm run ui:catalog` (`scripts/generate-ui-catalog.ts`) is the ONE writer;
`buildSafeUiCatalog()` (`src/stores/ucpath/driver/catalog.ts:146-354`) merges all four registries
into `generated/ui-catalog.json` plus **four** markdown projections —
`src/stores/{ucpath,kuali,crm,new-kronos}/UI-CATALOG.md`. The projection SET is derived from the
catalog's own `system` values (`uiCatalogSystems`, `catalog.ts:376-378`), not from a list, and
`semantic-ui-registry` proves that derivation both ways: a store that ships a `driver/ui-registry.ts`
appears in the catalog and its markdown is guarded. `assertSafeUiCatalogFresh` (`catalog.ts:356-363`)
rebuilds and compares, throwing `generated UI catalog is stale; run npm run ui:catalog` — which is
why §5.8's surface may serve the committed bytes without ever regenerating them. A fifth resolution
example, added by D261 (2026-08-20): "the Kuali Action List row for this document number" →
`kuali.action-list.document-link` (`ElementId`), beside
`kuali.action-list.matched-document-number` (`ObservationId`) — both declared in
`src/domain/ui/kuali-action-list.ts:44-60`.

### 1.4 Tasks do not receive raw `Page`

<!-- roadmap: p1-authority -->

Raw Playwright access is confined to `stores/<system>/driver/**`, worker-owned session
infrastructure, and the registry interpreter. Browser task contexts receive a typed driver:

```ts
// src/domain/ui/driver.ts:43-62 — the shipped shape. The id sets are TYPE PARAMETERS a store fills.
export interface SystemDriver<
  S extends BrowserSystemId,
  Screens extends ScreenId,
  States extends PageStateId,
  Fields extends Readonly<Record<string, string>>,
  Observations extends Readonly<Record<string, string>>,
  Clicks extends ElementId = never,
> {
  readonly system: S;
  goto(screen: Screens): Promise<PageStateProof>;
  waitFor(state: States): Promise<PageStateProof>;
  fill<I extends keyof Fields & ElementId>(id: I, value: Fields[I]): Promise<UiActionProof>;
  read<I extends keyof Observations & ObservationId>(id: I): Promise<Observations[I]>;
  click(id: Clicks): Promise<UiActionProof>;
}

/** The only generic path to an element declared `external-commit`, and a SEPARATE interface: a
 * store that cannot write does not carry the method at all. Prepare/read ctx cannot supply the
 * unforgeable capability; the driver validates its intent generation + subject digest. */
export interface CommitCapableSystemDriver<Commits extends ElementId = never> {
  commit(id: Commits, capability: MutationCapability): Promise<UiActionProof>;
}
```

Two things the shape above says that an earlier draft of this section did not. A per-system driver
is an **intersection**, not an instantiation — `UcpathStoreDriver` is the joined navigation driver
plus `Pick<>` of exactly the named operations that store publishes
(`src/domain/ui/ucpath-driver.ts:37-47`), and its `read` deliberately accepts BOTH id families
because the kernel calls it at ref write-safety beat ③ with whichever observation the running
contract declared. And there is **no `choose` verb**: `fill` is typed by the element's declared
`valueType`, and a combobox, checkbox or radio is staged through the store's own named prepare
operation (separations' one-pass ten-field staging) rather than a fourth generic method that would
give one control two ways in.

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

<!-- roadmap: p1-authority -->

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

<!-- roadmap: p1-authority -->

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

### 1.7 As-built — what the four registries hold today

<!-- roadmap: p1-authority -->

_Counted from the committed `generated/ui-catalog.json` on 2026-08-20; the catalog is the projection,
so these are the facts the operator and an AI can actually resolve._

| system | screens | page states | elements | observations |
|---|---|---|---|---|
| `ucpath` | 7 | 10 | 30 | 4 |
| `kuali` | 2 | 5 | 20 | 6 |
| `new-kronos` | 2 | 4 | 16 | 1 |
| `crm` | 3 | 4 | 5 | 1 |

120 entries in all. By declared `UiEffect`: 33 `observe`, 18 `navigate`, 17 `prepare` and **three**
`external-commit` — `ucpath.smart-hr.save-and-submit-button`,
`ucpath.smart-hr.delete-selected-button` and `kuali.rrss-document.save-button`. Those three are the
whole surface §1.4's `commit` seam and ref write-safety's fence exist for; every other element in
the tree is structurally unable to leave a mark on a real system.

Provenance is pinned rather than described: **406** ported legacy selector keys resolve to their
exact source line in a FIXED legacy commit's blobs (`legacy-selector-port-provenance`), so legacy
moving on cannot invalidate the record — what keeps a selector *current* is the charter's live
re-verification at each workflow's migration, not a diff against legacy.

**One gap, stated because a guard's inventory sentence reads wider than what it executes.**
`semantic-ui-registry`'s structural audit calls `auditUcpathUiRegistry`, `auditCrmUiRegistry` and
`auditNewKronosUiRegistry` and cross-checks id uniqueness across those three.
`auditKualiUiRegistry` and `auditKualiUiEvidenceBindings`
(`src/stores/kuali/driver/ui-registry.ts:1036`, `:1163`) exist and carry real business rules — global
id uniqueness within Kuali, search-term collision, cross-screen dependency resolution, the Save
button's `external-commit` assertion, D261's anchored-recipe restriction — and **nothing calls
them**. Kuali is therefore proved today at the zod-schema level and through catalog freshness
(`buildSafeUiCatalog` does include it), not through its own structural audit. The fix is one call
site in the guard; until it lands, §9's first row is narrower than it sounds.

---

## 2. Trust evidence: what happened, why the result is credible, and what remains uncertain

<!-- roadmap: p1-base -->
<!-- roadmap: p2-2g -->

<!-- roadmap-status: p1-base -->
- [x] strict schemas for failures, redacted bundles, receipts, scenario manifests, preflight scenarios and knowledge/fix records (Phase 1b, 2026-07-31)
- [x] every top-level evidence row in the strict boundary catalog, exercised against recursive unknown-key injection — `strict-boundary-schemas`
- [x] receipt invariants refuse false verified completion and unresolved mandatory evidence — in the schema's own `superRefine`, and again as a SQL CHECK
> 2026-08-20 | docs-cohesion operator-trust | verified against src/domain/trust/**, src/infra/sqlite/migrations.ts; the 1b claim is exactly the schema half and this section now says which tables came later (D134)
<!-- /roadmap-status -->
<!-- roadmap-status: p2-2g -->
- [x] schema v10's five durable tables plus the indexed `failures.fingerprint` (D134)
- [x] automatic redacted diagnostic capture, two-phase, persisted inside the terminal transaction (D137)
- [x] the durable actor-keyed inbox — the row commits before any delivery, and a repeat FOLDS (D134/D138)
- [x] knowledge and fix admission audited INSIDE the insert transaction (D139)
- [x] the receipt DERIVED from authority rather than minted at settlement (D140–D143)
- [ ] `explain failure <fingerprint>` is not built (§2.1, §4.2)
- [ ] the knowledge projection has no caller, so no `KNOWLEDGE.md` exists (§4.1)
- [ ] the retention sweep has no caller (§2.2) — `{#def-retention}`, `never` by D193
> 2026-08-20 | docs-cohesion operator-trust | verified against src/core/{evidence-receipt,diagnostic-capture}.ts, src/services/{notifications,trust}/**, src/infra/sqlite/migrations.ts; left: the three unreachable halves above, each named in its own section
<!-- /roadmap-status -->

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

<!-- roadmap: p1-kernel -->

<!-- roadmap-status: p1-kernel -->
- [x] the exact strict `FailureRecord` in non-rebuildable authority for every failed task/run, its `failureId` associated atomically with the failure transition (Phase 1f)
- [x] four invariants live in the schema, not in a test: one primary cause, `transient` agreeing with it, no present-but-empty block, and `attempting`/`unknown` requiring a commit action
- [x] the whitelist wire (D142) — a field added to the durable record reaches no surface until someone classifies it
> 2026-08-20 | docs-cohesion operator-trust | verified against src/domain/trust/failure.ts:72-103 and the run-detail failure section; the interface printed here was three fields out of date and now matches
<!-- /roadmap-status -->

A failed task/run persists a structured failure; `span.ended.error?: string` alone is retired.

```ts
// src/domain/trust/failure.ts:72-103 — the shipped strict schema, read as an interface.
export interface FailureRecord {
  failureId: FailureId;
  fingerprint: FailureFingerprint;     // stable normalized task/code/state/element signature
  runId: RunId; traceId: TraceId; attempt: PositiveInt;
  workflowId: WorkflowId; nodeId?: NodeId; taskId?: TaskId;
  code: ErrorCode; summary: string; transient: boolean;
  writeState: "not-attempted" | "prepared" | "attempting" | "committed" | "verified" | "unknown";
  subject?: { expected?: SubjectEvidenceWire; observed?: SubjectEvidenceWire;
              proofRef?: WriteBindingProofId };            // at least one of the three
  page?: { screen?: ScreenId; state?: PageStateId; urlRedacted?: string; titleRedacted?: string };
  action?: { elementId?: ElementId; operation?: UiActionKind; sequence?: PositiveInt };
  causeChain: readonly FailureCause[];  // 1–12, EXACTLY ONE `primary`; the rest are secondary
  diagnosticBundleId?: DiagnosticBundleId;
  remediation: readonly RemediationAction[];               // at least one
  occurredAt: IsoInstant;
}
```

Four invariants the shape alone does not show, all enforced in the schema's own `superRefine`: the
cause chain carries exactly one `primary` and the record's `transient` flag must EQUAL that primary
cause's; a `subject`, `page` or `action` block may not be present-but-empty; and a `writeState` of
`attempting` or `unknown` requires `action.operation === "commit"` — the failure of a run that may
have left a mark on a real system cannot be recorded without naming the act that might have left
it. Both page strings are redacted at the point they are written (`titleRedacted`, not `title`).

The event stream carries `{ failureId, code, summary, transient }`; the full record lives in
SQLite/diagnostic storage and is fetched on demand. Failure fingerprints power “same failure seen
before” links without treating message text as identity.

**Delivery boundary.** Phase 1f persists this exact strict record in non-rebuildable authority for
every failed task/run and atomically associates its `failureId` with the failure transition. The
minimum service can insert/read by id and detect conflicting replay; it does not synthesize a
`diagnosticBundleId`. Phase 2g added automatic bundle capture (§2.2.1), evidence receipts (§2.3),
fingerprint search (`FailureRepository.listByFingerprint`/`countByFingerprint` over the indexed
`failures.fingerprint` column) and `explain run` (§2.5.1). There is no smaller Phase-1 failure schema
and no Phase-2 replacement record.

**`explain failure <fingerprint>` is NOT built.** The composer's own usage line names it, and its
subject dispatch accepts only `run` (`src/server/explain/compose.ts:39-44`). The lookup it needs
exists; the command does not. Owned by `{#track-a}`'s close-out beside the knowledge surface (§4.3),
and named again in §4.2 where the doc used to describe it in the present tense.

#### 2.1.1 The failure section serves content through a whitelist schema (D142)

<!-- roadmap: p2-2g -->

`FailureDetailWireSchema` names every field it projects off the durable `FailureRecord`. That is doc
11's "unclassified fields drop" applied structurally: a field added to the durable record later
reaches no surface until someone decides how it is classified, rather than relying on a filter
someone has to remember to update. Subject identity travels as a digest plus an already-redacted
display suffix, the page as `urlRedacted`/`titleRedacted`. `sameFingerprintSeen` is §2.1's "same
failure seen before" as a count — what the operator acts on, answerable without projecting other
runs' subjects onto this panel. An absent diagnostic bundle names why there is no action; a present
id opens E29's exact-id readback, which verifies the attachment index and each stored digest before
it returns its strict wire or the canonical durable manifest.

The receipt section serves the WHOLE `RunEvidenceReceipt`: §2.2 puts redaction at capture time, every
value already carries its classification and transform, and a second wire projection could only lose
them. Because the receipt now rides the run-detail wire, `src/domain/redaction.ts` is
browser-reachable and drops `node:crypto`/`node:path` for `sha256Hex` and a two-separator basename.

### 2.2 Automatic diagnostic bundle

<!-- roadmap: p2-2g -->
<!-- roadmap: def-retention -->
<!-- roadmap: def-search-export -->

<!-- roadmap-status: def-retention -->
- [ ] scheduling the sweep — it is built and tested and nothing calls it, so no bundle has ever been purged here
- [ ] the content-store reference count that would let the reported unreferenced bytes be reclaimed
- [x] D193 dispositioned BOTH `wont-build-unless-asked`, and the operator's reasoning is recorded in §2.2.1
- [!] the node's own title names a “14/8/5 schedule” that no constant in this tree implements — the shipped number is 30 days from the bundle's own capture instant (§2.2)
> 2026-08-20 | docs-cohesion operator-trust | verified against src/domain/trust/diagnostic-capture.ts:44 and src/services/trust/diagnostic-retention.ts:45-85; left: the node title, which this doc cannot change
<!-- /roadmap-status -->

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

Bundles are content-addressed and indexed by `DiagnosticBundleId`. Retention is explicit: an
ordinary bundle's `purgeAfter` is its own capture instant plus **30 days**
(`DIAGNOSTIC_ORDINARY_RETENTION_DAYS`, `src/domain/trust/diagnostic-capture.ts:44` — D86's notes
floor, which is where the number comes from), unless the bundle is pinned by an active knowledge or
fix record or a write-recovery case, which stores a named `reason` and no instant at all. Restricted
fields are redacted at capture time. Redaction is not deferred to the UI.

**As-built: the sweep is built, tested, and has no caller.** `createDiagnosticRetentionSweep`
(`src/services/trust/diagnostic-retention.ts:45-85`) reads the `(retention_kind, purge_after)` index,
re-derives each disposition and throws if it disagrees with the row, purges bundle and attachment
rows together, and REPORTS the artifact ids whose last diagnostic reference it just removed. Nothing
in `compose.ts`, in `src/cli.ts` or on any timer calls it, so **no bundle has ever been purged on
this machine** — scheduling it, and the content-store reference count that would let those reported
bytes be reclaimed, are `{#def-retention}`, dispositioned `wont-build-unless-asked` by D193 (the
reasoning is in §2.2.1). Read §10's fourth residual through this: a restricted bundle is local, and
it is not short-lived.

**"14/8/5" names no constant in this tree.** The phrase reaches the tree node and
ref dashboard-surfaces from an early draft; the shipped schedule is ONE number — 30 days from the
bundle's own capture instant — with no tiering by kind, sensitivity or age. Cite the constant, not
the phrase.

#### 2.2.1 As-built — a bundle is captured at the trigger, redacted at capture, and bound to its failure (D137)

<!-- roadmap: p2-2g -->

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

**E29 readback.** `GET /api/v1/diagnostic-bundles/:bundleId` accepts only the stored UUID and joins
the D137 row to its exact attachment index. It recomputes the bundle digest, drains every referenced
content-addressed artifact, and compares each byte count and digest before serving captured time,
total attachment bytes, redaction facts, and the strict content list. Missing ids answer
`TARGET_NOT_FOUND`; a malformed index, digest, or artifact answers the typed
`DIAGNOSTIC_BUNDLE_CORRUPT` failure instead of serving a plausible record. The companion
`/manifest` route sends the canonical durable bundle JSON with attachment disposition; the browser
does not reconstruct an export. It is deliberately a bundle metadata/export surface, **not** the
unserved generic artifact-byte route in ref frontend-backend-integration §3.6.

### 2.3 `RunEvidenceReceipt`

<!-- roadmap: p2-2g -->
<!-- roadmap: sep-6c -->
<!-- roadmap: order-7-dash -->
<!-- roadmap: observed-logs -->

<!-- roadmap-status: sep-6c -->
- [x] a previewed run's receipt derives `partial` with `unknown` confidence, so `verified-done` is structurally unreachable for a preview (§2.3.7, D215/D238)
- [x] the envelope's `dryRun` and the terminal preview result must AGREE or the derivation throws
> 2026-08-20 | docs-cohesion operator-trust | verified against src/core/evidence-receipt.ts:707-761; the preview terminal's receipt shape is as chunk 6c recorded it
<!-- /roadmap-status -->

Every terminal run—success, failure, cancellation, or partial outcome—has a server-derived receipt:

Every `EvidenceFact`, `DecisionEvidence`, `ActionEvidence`, `VerificationEvidence`, `ReuseEvidence`,
and `UncertaintyEvidence` row has its own `id: EvidenceEntryId`, DERIVED from
`(receiptId, kind, key)` so a re-derivation reproduces it (§1.1). The semantic observation that a row
refers to remains a dotted `ObservationId` in the UI/task vocabulary.

```ts
export interface RunEvidenceReceipt {
  receiptId: EvidenceReceiptId;
  runId: RunId; traceId: TraceId; workflowId: WorkflowId; attempt: PositiveInt;
  generatedAt: IsoInstant;
  descriptorFingerprint: Fingerprint;
  configFingerprint: Fingerprint;
  retryOf: { state: "absent" } | { state: "present"; value: RunId };
  failure: { state: "absent" } | { state: "present"; value: FailureId };  // `failed` only
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

**As-built** (`src/domain/trust/evidence.ts:118-184`, `src/core/evidence-receipt.ts`). The two enums
above are exact and closed; **`rehearsal` is not one of them** (§2.3.7). The `superRefine` on the
schema — not a separate test — is what refuses `verified-done` beside a warning, a failure or an
unresolved mandatory obligation, refuses `done-with-warnings` with no non-load-bearing warning, and
makes `failed` the only arm that may (and must) name a failure; authority repeats the pair it can
express in SQL, `CHECK (result <> 'verified-done' OR confidence = 'verified')`
(`src/infra/sqlite/migrations.ts:167`). The verdict itself is derived, never authored: `confidence`
is `unknown` when a mandatory fact or obligation is unresolved or absent, `partial` when any warning
stands, else `verified`; `result` then reads off the terminal outcome and that confidence
(`evidence-receipt.ts:840-861`).

#### 2.3.1 Evidence classification and cross-source obligations are DECLARED (D140)

<!-- roadmap: p2-2g -->

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

<!-- roadmap: p2-2g -->

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

<!-- roadmap: sep-2 -->

<!-- roadmap-status: sep-2 -->
- [x] the receipt binds to the SURFACES its derivation consumes, not to the descriptor's 31-file closure (D199)
- [x] `declared-evidence` takes the stored receipt row as its baseline — the only check that can see a declaration living outside the closure
- [x] no waiver arm: chunk 2's five split three re-derived byte-identically, two frozen by design
> 2026-08-20 | docs-cohesion operator-trust | verified against src/core/receipt-derivation-binding.ts; the six-row check table matches the code
<!-- /roadmap-status -->

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

<!-- roadmap: sep-3 -->

<!-- roadmap-status: sep-3 -->
- [x] a gate's durable evidence is its `gate_results` row, so the approver reaches the receipt (D204)
- [x] the decision arm is DECLARED per `(workflow, gate)`; an undeclared gate and an unlisted arm value both fail loud
- [x] redaction extends by a `gate-result` scope rather than a hole; the operator's reasoning is shown, not redacted
> 2026-08-20 | docs-cohesion operator-trust | verified against src/core/evidence-receipt.ts and src/domain/trust/gate-decisions.ts
<!-- /roadmap-status -->

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

<!-- roadmap: track-b -->

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

<!-- roadmap: p2-2g -->

**Closed 2026-08-04 (D144, ref write-safety §3.1).** The gap was real: the sequencer stored a transaction
checkpoint under the durable `TransactionOutcome` schema hash while the descriptor factory's
terminal `build` demanded the COMMIT CONTRACT's output schema hash, and the interpreter never
registered a transaction checkpoint as terminal evidence at all — so `kuali-timekeeper-annotation`
could not reach terminal `done` and the controlled commit had no receipt in authority. The stored
hash was the correct one; the terminal side moved. `kualiReceiptEvidence`'s terminal record now
comes from the real `buildRunResult`, and `tests/unit/transaction-terminal-dependency.test.ts`
drives a queued Kuali run through the real interpreter to `done` and derives its receipt.

#### 2.3.7 A DRY RUN is a rehearsal, and the label is derived from the verdict (D215/D238)

<!-- roadmap: track-b -->

**Ratified 2026-08-19.** `done → verified-done` used to be mechanical, so a preview that wrote
nothing wore the label reserved for an independently verified real completion — while its own
receipt already said otherwise. Nothing had to be invented: a previewed run derives
`result: "partial"` from the receipt builder itself, because its `completion.terminal-result`
obligation is `unknown` and its `DRY_RUN_PREVIEW` warning is load-bearing, which makes
`verified-done` structurally unreachable for a preview (`evidence-receipt.ts:707-761`).

Two facts about that arm are worth keeping. **The preview's two shapes are both recorded**: a
staged-and-observed preview and one that settled at the probe (D215's `not-observed` subject
verdict, the ordinary separations subject) produce different warning text, because a rehearsal that
never staged anything is a different rehearsal. And **the two facts are cross-checked**: the
envelope's `dryRun` flag and a terminal result bound to `RunDryRunPreviewResultSchema`'s hash must
AGREE, and a mismatched pair throws rather than picking one (`:713-721`).

The **label** lives one layer out, on the dashboard wire, and deliberately not on the receipt:
`OutcomeWireSchema` carries `rehearsal: z.literal(true).optional()` beside the same five-arm
`result`, with a refinement making `rehearsal === true` and `verified-done` unrepresentable
(`src/domain/dashboard/run-detail.ts:286-300`). It is not a sixth result and not a new confidence
tier — it is D6's envelope fact, already on the queue row, said again where an operator reads the
outcome. `terminalOutcomeText` (`src/dashboard/surfaces/log-panel-model.ts:67-72`) is a pure
exported function for the reason D187 taught: this tree renders no React in the unit lane, so an
operator-facing sentence is only as pinned as the parity corpus unless it is extracted.

#### 2.3.8 The demo's `receiptInvariant` Banner is structurally unnecessary here (ledger 2 D11)

<!-- roadmap: track-b -->

**Answered 2026-08-21.** The demo's Receipt renders a `receiptInvariant` Banner that fires when a
receipt claims `result: "verified-done"` without `confidence: "verified"` — a defensive display for
a pairing the demo's own data could carry. The question ledger 2 D11 left open was whether this
tree's receipt can hold that pairing at all; it cannot, at two independent layers, so the Banner has
no case to ever draw.

**The authority layer.** `evidence_receipts`' DDL carries `CHECK (result <> 'verified-done' OR
confidence = 'verified')` (`src/infra/sqlite/migrations.ts:167`) — SQLite refuses the INSERT before
the row exists.

**The domain layer, independently.** `RunEvidenceReceiptSchema`'s `superRefine`
(`src/domain/trust/evidence.ts:123,162`) rejects the same pairing at PARSE time: `if
(receipt.result === "verified-done") { if (receipt.confidence !== "verified") context.addIssue(...)
}`. This is the schema the wire and every in-process consumer read through — it makes the pair
unrepresentable before a byte reaches the database, not merely after.

Both checks encode the SAME invariant `receiptInvariant` exists to warn about, so no receipt this
tree can construct — durable or in-memory — ever reaches `receipt.tsx`/`trust.tsx`'s
`ReceiptEvidenceBody` in the state the Banner is for. Building the Banner would be dead code: a
warning for a state the type system and the database both already refuse to let exist. This is
distinct from D238's `rehearsal`/`verified-done` refinement (§2.3.7) — that pair is about a DIFFERENT
mismatch (a dry run wearing the verified label) enforced on `OutcomeWireSchema`, one layer out on
the dashboard wire; this one is about `result`/`confidence` on the receipt itself, enforced at
authority and at the domain schema both.

#### 2.3.9 The declaration is the OBSERVED LOG's redaction too (D270)

<!-- roadmap: observed-logs -->

**Ratified 2026-08-21; transaction lane completed 2026-08-25.** §2.3.1's table stopped being a
receipt-only contract. Every point a task records through `ctx.recordData` is captured and stamped
at record time for a `data.observed` event (`03a` §Observed logs), and each leaf is pushed through
`redactEvidenceLeaf` — the SAME function, over the SAME table, that the receipt uses. There is
deliberately no second redaction implementation: a log that leaked a value the receipt would have
dropped is the same defect from a different surface, and the two channels are then provably
consistent about one leaf rather than consistent by review.

Probe, prepare and verify redact and emit synchronously. Commit is the only delivery exception:
its points and one Clock instant are frozen in `ctx.recordData`, then redaction and emission wait
until the callback settles. A commit task may legally record a page fact before invoking its
driver, so synchronous delivery there would put the fallible span writer between a durable fence
and the external click. The flush emits the kernel's strict `transaction.fenced` arm first, then
the commit batches in call order; an undeclared commit leaf parks rather than preventing the click.

Three consequences follow, and each is enforced rather than described.

**The refusal message is channel-neutral.** `classifyEvidenceLeaf` used to end *"a receipt never
drops a leaf silently"*; it now names both channels, because the author it is talking to may never
have opened a receipt.

**A leaf is undeclared until somebody declares it, fixtures included.** The executor's own fixture
contracts borrow the manifest-known id `ocr/extract-form-page` — they must, because
`resolveTaskImplFingerprint` fails loud on an id the generated build manifest does not carry — and
their six test-local paths are DECLARED rather than exempted. A fixture bypass would mean the
refusal is never exercised by a composed run, and the executor's fixtures are the only composed runs
the unit lane has. The two person identifiers there carry the same `last4` as everywhere else, so a
fixture cannot become the surface that proves a raw identifier reaches a stream.

The write-sequencer corpus injects its fixed implementation fingerprint instead. Its five sealed
task contracts export their exact ids as `WRITE_FIXTURE_TASK_IDS`; the orphan-classification guard
adds only that derived set to the manifest/runtime baseline. Its probe/prepare/commit/verify leaves
remain ordinary declarations and pass through the production refusal — the set is accounting for
an executable test runtime, not a redaction bypass.

**Presentation preserves the arm boundary.** The dashboard's combined log renderer reads the strict
row union in its served sequence: only `data.observed` supplies direction, redacted value facts and
any browser system its exact descriptor origin declares. `transaction.fenced` is the durable authority beat preceding a commit batch,
not a page observation, so the surface does not manufacture a system chip, read/write arrow or value
pill for it. A note remains prose. This keeps a redacted page fact, an authority fact and an operator
message distinguishable even when their clocks are equal.

**The orphan rule's baseline widened to the build manifest.** `evidence-receipt.test.ts` used to
refuse a `task-output` scope naming a task no registered descriptor composes. That is the wrong
baseline once the emission exists: the executor runs whatever a composed descriptor names, so a
registered task that no descriptor composes YET is not an orphan — a DELETED one is, and the wider
rule still catches it. D184's rot check is intact.

**Transaction roles do not borrow declarations.** The four idempotency probes and four post-fence
verifiers each have their own task scope in §2.3.1's table. UCPath EIDs use `last4`; states, dates,
document numbers and transaction numbers are transaction facts and use `allow`. A verifier is the
landing authority and cannot inherit its probe's declaration merely because their shapes happen to
match.

##### What is recorded and still NOT classified

Every one of the eighteen task nodes across the five registered descriptors was already declared, so
the original emission added no production declaration. The transaction lane now declares its eight
roles. Five descriptor-less `recordData` call sites remain unclassified: four data-service tasks and
one OCR task. They are listed rather than guessed at because no run can reach them yet:

| Task | Why it is not declared here |
|---|---|
| `extraction/extract-spreadsheet` · `extraction/extract-pdf-pages` · `normalization/read-contact-advice` · `roster/match-spreadsheet` | wired into no descriptor, so no run can reach them; declaring a shape nothing has executed would be a guess. |
| `ocr/extract-form-page` — its OWN output leaves | same, plus a real finding: the task records `pageFingerprint` and `hasRecord`, and `AdmittedExtractionSchema` carries neither, so `finalizeRead` would refuse it (`task provenance path … does not exist in the output`) the first time a descriptor composed it. Declaring `AdmittedExtraction`'s leaves would hide that; it is recorded here instead, unowned, for whoever wires the OCR route. |

### 2.4 Rerun transparency

<!-- roadmap: p2-2g -->
<!-- roadmap: def-search-export -->

<!-- roadmap-status: def-search-export -->
- [ ] the rerun FIELD-LEVEL diff — nothing reads a prior run's receipt beside the current one (§2.4)
- [ ] the screenshot gallery and the artifact-bytes route the diagnostic store would serve (§2.2)
- [x] the per-fact half exists today: `retryOf` plus `reuse` rows carrying `ageMs` and the bound they were judged against
> 2026-08-20 | docs-cohesion operator-trust | verified against src/domain/trust/evidence.ts:97-103 and src/core/command-kernel.ts:623; left: the comparison, which needs a run corpus to be worth shaping
<!-- /roadmap-status -->

A retry/rerun receipt links to the prior run and shows a field-level diff:

- input changed vs unchanged;
- checkpoint reused vs rerun, with age/freshness/provenance;
- operator-corrected fields and the facts they superseded;
- branch/gate outcomes that changed;
- prior durable write proof reused (therefore no click) vs new fenced write;
- configuration/descriptor/task fingerprint differences.

The dashboard never labels replayed data as newly observed. This is the operator-facing projection
of refs workflow-model/write-safety's provenance and permanent proof rules.

**As-built — half of this is built, and the half that is missing is the DIFF.** A receipt carries
`retryOf` (the prior run, minted by the kernel's retry at `src/core/command-kernel.ts:623`) and its
own `reuse` rows — `fresh-live | checkpoint | corrected | prior-proof`, each with `ageMs` and the
`freshnessLimitMs` it was judged against (`src/domain/trust/evidence.ts:97-103`) — so "was this
observed again or replayed" is answered per fact, on the run's own receipt, and the trust surface
prints `retry of <runId>` (`src/dashboard/surfaces/trust.tsx:289`). What does not exist is the
FIELD-LEVEL COMPARISON of two receipts: nothing in `src/` reads a prior run's receipt beside the
current one to say which input changed, which branch outcome moved, or which fingerprint differs.
The operator can open both receipts; the system does not diff them. Owned by `{#def-search-export}`,
which is where a corpus of runs to compare first becomes reachable.

### 2.5 `explain run`

<!-- roadmap: p2-2g -->

One CLI/API command is the canonical debug entry point:

```text
cli explain run <traceId|runId> [--json] [--bundle <dir>]
```

It resolves the operation tree and prints, in this order: state, node timeline, checkpoint reuse,
subject bindings, failure, last successful action, open gate, open dependency, command history,
notifications, write intent/proof, evidence receipt, and the concrete next safe action
(`src/server/explain/explain-run.ts:317-346`). Codex/Claude prompts reference this command and the
generated catalog instead of asking the operator to manually assemble logs.

**Three sections do not print what this paragraph once promised, and each says why rather than
printing an empty heading — which is the whole discipline of this command.** `--bundle` **REFUSES**
by name (§2.5.1): exporting a diagnostic package missing the capture evidence its manifest claims is
worse than refusing. `command history` is absent because authority indexes commands by id, not by
run, and the by-run projection is ref dashboard-surfaces's queue projection rather than this
command's.

The `notifications` section is absent too, and **its reason has gone stale**: it reads *"no
notification trigger is wired yet … so this run has none rather than none being shown"*
(`src/server/explain/explain-run.ts:256-260`), which was true when it was written and stopped being
true at D262. `gate-park.ts` publishes a RUN-SCOPED row for a run parked at a gate (§6), so the one
sentence a run explanation must never get wrong — *this run has none* — can now be false on exactly
the runs an operator is most likely to explain. The honest arms are to read the inbox for the run's
own links, or to narrow the reason to "this command does not read the inbox". It is a one-line
reason string and a reader of a trust surface has no way to know it is old; recorded here rather
than fixed, because this pass changes documents and not code.

#### 2.5.1 `explain run` and the receipt are one derivation (D143)

<!-- roadmap: p2-2g -->

`cli explain run <traceId|runId> [--json]` resolves either identity and prints §2.5's
sections in §2.5's order. For a settled run it derives the SAME receipt the dashboard serves, so a
terminal explanation and a terminal receipt cannot disagree. Every section an operator could misread
as "nothing happened" says why instead. `--bundle` **refuses**: exporting a diagnostic package
missing the capture evidence its manifest claims is worse than refusing, because the recipient
cannot tell.

---

## 3. Scenario corpus: workflows improve safely as new cases are discovered

<!-- roadmap: p2-2j -->

<!-- roadmap-status: p2-2j -->
- [x] the executable corpus and `scenario-coverage`, audited in BOTH directions, plus D185's corpus-layout audit
- [ ] `ScenarioManifest`'s preflight fault set has no runner and `preflight-coverage` stays `planned` (D188)
- [ ] §3.2's coverage policy is not proved in full — the audit is over graph-derived points, not a contract's error enum
- [ ] the tier layout moves to `ref guards-and-tests §Testing tiers` under R10; this section keeps what a scenario IS
> 2026-08-20 | docs-cohesion operator-trust | verified against tests/scenario/** (16 files), tests/unit/architecture/scenario-coverage.test.ts and guard-inventory.json; left: the runner and the tier move
<!-- /roadmap-status -->

### 3.1 `example` is not a scenario

<!-- roadmap: p2-2j -->

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

**As-built — TWO mechanisms share the word "scenario", and only one of them runs.**
`ScenarioManifest` above is real code (`src/domain/trust/scenario.ts:33-90`) and it has exactly one
consumer: `PREFLIGHT_SCENARIO_MANIFESTS` (`src/domain/trust/preflight-scenarios.ts:32`), the closed
set of preflight FAULT scenarios. **Nothing executes them.** The `preflight-coverage` guard is
`planned` in `guard-inventory.json` and its test file does not exist on disk; D188's re-disposition
says in as many words that the missing half is a corpus of executed fault scenarios and that the
guard activates with the first migration that adds a preflight runner.

The corpus that DOES run — `tests/scenario/**`, sixteen files — is built on a much smaller shape:
`ScenarioCoverageClaim { scenarioId, covers }` (`tests/scenario/coverage-claims.ts`), one claim per
scenario, each asserted by its own test to match the path the walk actually exercised. That is why a
claim there cannot outlive the path it describes, and it is also why the rich manifest above buys
nothing today: the executable lane never parses one. Both are honest; conflating them is what makes
this section read as though the manifest gates the suite. It does not.

### 3.2 Minimum scenario coverage

<!-- roadmap: p2-2j -->
<!-- roadmap: track-a -->

<!-- roadmap-status: track-a -->
- [ ] regression scenarios for separations' close-out
- [ ] knowledge records for separations — blocked on a CALLER, not on a schema: the store, the admission audit and the projection are built and unreachable (§4.1)
- [ ] capability dispositions
> 2026-08-20 | docs-cohesion operator-trust | verified the three doc-side close-out obligations against the code; all three open, and the knowledge half needs one composition-root wire rather than a design
<!-- /roadmap-status -->

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

**As-built, and being restructured.** Sixteen files under `tests/scenario/` walk the corpus today,
and `scenario-coverage` audits it in BOTH directions — every branch, gate, delegation and
transaction coverage point the graph derives is claimed, and every claim resolves to a real point
AND a real file; D185 added a corpus-layout audit so a scenario title that parses as a `ScenarioId`
must resolve rather than being read as prose. The list above is a coverage POLICY, and it is not met
in full: nothing in the tree proves that every declared business absence code, every selector-missing
arm or every storage fault has a scenario, because the audit is over graph-derived points, not over
a contract's error enum.

**Where the policy is moving.** R10 (operator, 2026-08-20) reorganizes `tests/` by what a test NEEDS
— a no-dry-run tier and a dry-run tier built on a live `dryRun=true` run of each workflow with
checkpoints asserted over authority — and the owning spec is **ref guards-and-tests §Testing tiers**,
tracked as `{#test-tiers}`. This section keeps the operator-trust half (what a scenario IS, and why
`example` is not one) and stops being the place the tier layout is described.

### 3.3 Unexpected states become data, never fallbacks

<!-- roadmap: phase-1 -->

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

<!-- roadmap: p2-2g -->
<!-- roadmap: track-a -->

### 4.1 LESSONS are migration input, not the new authority

<!-- roadmap: p2-2g -->

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

Records are strict-schema JSON; one generated `KNOWLEDGE.md` per system shows **active only**
guidance for humans/AI. Incident history and superseded records remain queryable but are not
injected into ordinary prompts/search results unless explicitly requested.

**As-built — the authority is the TABLE, and the generator has no caller.** The `knowledge/records/`
on-disk layout was never built and is not owed: `knowledge_records` / `fix_records` (schema v10) are
the authority, and `projectKnowledgePages` / `renderKnowledgeMarkdown`
(`src/domain/trust/knowledge-projection.ts:147-209`) render the ACTIVE view from it, with
`writeKnowledgeProjection` (`src/services/trust/knowledge-service.ts:86-102`) writing the files
behind a path-escape guard. D139 recorded that wiring the generator to an npm script was 2i's work,
"with the explorer". **It did not happen.** Nothing in `src/cli.ts`, `compose.ts`, `src/dashboard/**`
or `package.json` constructs the knowledge service or calls the projection, so no `KNOWLEDGE.md`
exists in this tree and no record has ever been written by the running system. The store, the
admission audit (§4.5) and the projection are real and unit-tested; the operator has no way to reach
them. Owned by `{#track-a}`'s close-out, which is where the first migration's knowledge records land.

### 4.2 `FixRecord`—what Codex/Claude changed and how it was proven

<!-- roadmap: p2-2g -->

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
or unproven change remains a visible draft and is excluded from active guidance.

`cli explain failure <fingerprint>` — which would show prior fixes and whether the same scenario
still passes — **is not built** (§2.1). The indexed `fix_records.failure_fingerprint` column and
`FailureRepository.listByFingerprint` exist for it; the command does not.

### 4.3 Maintenance and search

<!-- roadmap: p2-2g -->

- New record creation checks for matching scope/symptom/element/scenario before adding; suspected
  duplicates require an explicit supersedes/related link.
- A scheduled/manual audit validates referenced ids/files/scenarios/commits and marks stale records
  `unverified`; it never silently leaves dead guidance active.
- Search defaults to `status:active`, current descriptor/task fingerprints, and the current UI ids.

**As-built: the first bullet is built, the other two are not, and one of them cannot be built as
written.** Duplicate admission IS enforced, inside the insert transaction (§4.5). The **audit**
needs a CAS on a record version and `KnowledgeRecordSchema` carries no `version` — D134 named that
as a schema decision the maintenance slice must ratify rather than guess, and it has not been taken,
so nothing marks a stale record `unverified`. **Search does not exist**: there is no CLI command, no
BFF route and no surface over knowledge or fix records at all. Both remainders belong to
`{#track-a}`'s close-out beside §4.1's generator, and neither is blocking anything today for the
plain reason that the table is empty.

### 4.4 Optional AI assistance reads the evidence; it never becomes the evidence

<!-- roadmap: p2-2i -->
<!-- roadmap: def-sanity-check -->

<!-- roadmap-status: def-sanity-check -->
- [x] the operator RULED on it: 2026-08-18, no AI feature — the §14.2 gate packet's server-computed `comparisons` array IS the sanity check (§4.4.2)
- [x] `config/legacy-capabilities.json` carries `legacy-tool-ops-sanity-check-record` as `retired`, machine-checked by `legacy-capability-disposition`
- [!] the tree still shows this node `planned` with `you: re-disposition D192`; the doc and the capability register both say RETIRED, and only the orchestrator may move a node
> 2026-08-20 | docs-cohesion operator-trust | verified against config/legacy-capabilities.json and src/domain/dashboard/advisory.ts (AdvisorySurfaceIdSchema is still the D178 two-value shape); left: the node's own status
<!-- /roadmap-status -->

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

<!-- roadmap: p2-2i -->

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

<!-- roadmap: p2-2i -->
<!-- roadmap: def-sanity-check -->

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

<!-- roadmap: p2-2g -->

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
and `writeKnowledgeProjection(root)` is the generator. Wiring it to an npm script was 2i's, with the
explorer — **it did not happen, and §4.1 now says so where a reader will look for it.**

A verified `FixRecord` requires a commit plus non-empty verification evidence plus a regression
scenario; a draft may claim neither commit nor evidence; a verified fix may not link knowledge that
is missing or itself `unverified`. **A raw appended lesson is not authority**: `triageLesson` has
exactly one arm, and it returns the obligations the author still owes — there is no path from prose
to a record.
**What that 2026-08-04 sentence left open, settled here (2026-08-20).** Automatic bundle capture
triggers LANDED — the interpreter captures and persists inside the terminal transaction (§2.2.1).
The retention sweep is built and has no caller (§2.2). Notification trigger wiring landed for TWO of
seven event kinds (§6.3). `explain failure` is still not built (§2.1, §4.2). Both guards named there
are now **active**: `notification-durability` and `knowledge-fix-integrity` execute in the suite and
are registered in `guard-inventory.json` — the second covers both halves of §9's fix→scenario and
active-knowledge rules.

---

## 5. Workflow explorer/editor—staged hybrid, one graph

<!-- roadmap: p2-2i -->
<!-- roadmap: def-explorer-edit -->

### 5.1 Decision

<!-- roadmap: p2-2i -->
<!-- roadmap: def-explorer-edit -->

<!-- roadmap-status: def-explorer-edit -->
- [ ] Phase B's closed editable subset — presentation, notification preference, allowlisted policy values (§5.3)
- [ ] the compile/apply protocol: strict versioned override, temp+fsync+atomic-replace, stale-base refusal, code-change brief (§5.4)
- [ ] the new-workflow authoring path (§5.5), folded into this node by the operator on 2026-08-20 rather than given its own
- [x] the trigger is named and checkable: the SECOND production workflow whose policy an operator wants to change without a code change (D186)
> 2026-08-20 | docs-cohesion operator-trust | verified NOTHING of the edit half exists — no draft union, no apply path, no compile route, no scaffold command in src/cli.ts; the deferral is whole, not partial
<!-- /roadmap-status -->

Build a **read-only workflow explorer in Phase-2 tail 2i**, with closed presentation/policy editing
alongside it after graph, validation, versioning, and evidence are proven. A free-form visual
programmer and DSL/codegen are rejected: graph/composition, arbitrary code, selectors, and
write-proof logic remain reviewed source work.

### 5.2 Phase A—read-only explorer (Phase-2 tail 2i)

<!-- roadmap: p2-2i -->

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

**Phase A shipped in 2i-G and is as-built in §5.7 (the derivation and its two named exclusions),
§5.8 (the catalog surface) and §5.9 (the node panel's derived field census).** Those three sections
amend this one; they keep their own numbers because the tree's `{#p2-2i}` and `{#track-b}` nodes
cite them.

### 5.3 Phase B—safe edits only

<!-- roadmap: def-explorer-edit -->
<!-- roadmap: phase2-dispositions -->

<!-- roadmap-status: phase2-dispositions -->
- [x] the Workflow Explorer's EDIT half left Phase 2 by explicit disposition, on D79a's own argument one level down (D186)
- [x] nothing partial was built: no draft union, no half-authority, no config path that can reach a descriptor
- [x] `workflow-editor-compile-integrity` is `active` with Phase-A arms only, and its inventory entry says so in as many words
> 2026-08-20 | docs-cohesion operator-trust | verified against tests/unit/architecture/workflow-editor-compile-integrity.test.ts and guard-inventory.json; the deferral is a decision with a trigger, not a slip
<!-- /roadmap-status -->

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

<!-- roadmap: def-explorer-edit -->

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

<!-- roadmap: def-explorer-edit -->

> **NOT BUILT, and folded into the same deferral as §5.3.** No scaffold flow, CLI command or
> generator exists: `src/cli.ts` registers `dashboard`, `worker`, `explain`, `ocr` and `storage` and
> nothing else, and a repo-wide search for a scaffold/authoring path returns nothing. The section
> below is the design, written in the present tense because it describes what the flow must do when
> it is built — it does not describe anything an operator can run today. It travels with
> `{#def-explorer-edit}` (the operator's ruling, 2026-08-20) rather than getting a node of its own,
> even though authoring a NEW workflow and editing an existing one's policy are different
> capabilities: both wait on the same explorer half, and one deferral with a named trigger is more
> honest than two.

The design: the same explorer provides a guided scaffold flow so adding a workflow does not begin
with string search and copied boilerplate:

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

<!-- roadmap: def-explorer-edit -->

Its useful presentation editing and operation mining are port inventory. The preserved legacy
modifier stays inside the legacy repo; with no shared module graph (D93) it cannot be proxied or
imported. The new read-only explorer replaces mined operations with descriptor tasks and
driver UI ids. Presentation overrides may migrate into Phase B once they round-trip through the
same descriptor projection. Generated `config/workflow-design/*.md` files are not runtime
authority; the descriptor and validated draft history are.

### 5.7 Phase A as-built — the explorer is a projection, and it proves it (2026-08-09, D176)

<!-- roadmap: p2-2i -->

<!-- roadmap-status: p2-2i -->
- [x] the explorer is a projection of the ONE composition root, guarded in both directions over the REAL registry (D176)
- [x] source links RESOLVE against a real listing; a miss is `unresolved` carrying the path it tried
- [x] the UI catalog surface serves the COMMITTED artifact and refuses a stale one (D177)
- [x] the node panel is a derived FIELD census (D227) and the descriptor's own prose is declared and guarded (D229)
- [ ] the live-run overlay stays EXCLUDED by decision — run facts belong to the run-detail timeline
- [ ] scenario coverage CLAIMS stay in the executable corpus by decision, not for want of a wire
> 2026-08-20 | docs-cohesion operator-trust | verified against src/server/dashboard/queries/explorer.ts and src/dashboard/surfaces/explorer.tsx; both exclusions are still deliberate and still true
<!-- /roadmap-status -->

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
the demo's `Version registry` header action now opens the actual Archive registry — `4e09fb49` gives
the Explorer the matching `ghost` button with the `Eye` icon and moves Archive's view selection into
the dashboard route as `?archive=&archiveView=versions`. `archive.tsx` renders `<Table label="Workflow
version registry">` inside that selected `Versions & bumps` view (`D179/D223`); the Explorer's door
therefore replaces its takeover with the destination it names, rather than creating a local registry
or leaving the operator one click short (ledger 3 EX5). The conditional-node line printed "runs when the descriptor's own when() predicate
holds" — honest, and less than the demo's authored sentence — and the recorded fix named an authored
`whenLabel` / node `purpose` / workflow `summary`. **Two thirds of that landed and one third was
refused**: `purpose` and `summary` are authored data (§5.9, D229), while `whenLabel` is refused
because a sentence beside a predicate is a second description of one rule — the `when` itself became
a DECLARED condition instead (ref workflow-model §3.3, D228). Read-only per D186
throughout: no edit affordances anywhere.

### 5.8 The generated UI catalog gets a surface, and it serves the COMMITTED artifact (2026-08-09, D177)

<!-- roadmap: p2-2i -->

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

<!-- roadmap: track-b -->
<!-- roadmap: sep-dash -->
<!-- roadmap: order-1-dash -->
<!-- roadmap: order-2-dash -->
<!-- roadmap: order-3-dash -->
<!-- roadmap: order-4-dash -->
<!-- roadmap: order-5-dash -->
<!-- roadmap: order-6-dash -->
<!-- roadmap: order-7-dash -->
<!-- roadmap: order-9-dash -->

<!-- roadmap-status: track-b -->
- [x] B6 — the node panel is a FIELD table whose census projects the contract's own zod shape (D227)
- [x] B2's derivation half — a settled gate names verdict, approver and instant from the durable row (D237), and a dry run reads `rehearsal`, never `verified-done` (D238)
> 2026-08-20 | docs-cohesion operator-trust | verified against src/validation/contract-boundary.ts, src/server/dashboard/queries/run-detail.ts and src/domain/trust/gate-decisions.ts; every wire square that cites this section reads the same derivation
<!-- /roadmap-status -->

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

<!-- roadmap: p2-2g -->

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

That list is the POLICY. §6.3 says which of it a producer actually fires today, and it is two of
seven.

### 6.1 The fold is an UPDATE, and that is not a weakened ledger (D134)

<!-- roadmap: p2-2g -->

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

<!-- roadmap: p2-2g -->

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

### 6.3 As-built — the closed vocabulary, the two publishers, and the five arms with no producer

<!-- roadmap: p2-2g -->
<!-- roadmap: sep-dash -->

<!-- roadmap-status: sep-dash -->
- [x] the notification square — `gate-park.ts` publishes `gate-opened` for a run parked at a gate, on transitions only (D262)
- [ ] `failed`, `subject-mismatch` and `write-parked` have no producer, so the square is filled for the GATE arm alone (§6.3)
- [!] there is no OS delivery implementation in the tree, so every publish settles `no-channel` — the durable row is the whole alert
> 2026-08-20 | docs-cohesion operator-trust | verified against src/services/notifications/{gate-park,storage-health,inbox}.ts and src/server/dashboard/compose.ts; left: four unreachable trigger arms and the delivery channel
<!-- /roadmap-status -->

**The vocabulary is closed twice over.** `NotificationTriggerSchema`
(`src/domain/notifications.ts:12-19`) has six arms — `failed`, `gate-waiting`, `write-parked`,
`repeating`, `storage`, `verified-done` — and the EVENT a producer constructs,
`NotificationTriggerEventSchema` (`src/domain/notification-triggers.ts:54-102`), has seven kinds,
because `run-failed` and `subject-mismatch` both project to `failed`. `projectNotificationTrigger`
(`:151-217`) is the one place an event becomes a row: it composes the trigger, the channel, the
title, the summary and the links from ids, closed codes and counts, which is what makes D138's "a
notification carries no free text" enforceable rather than aspirational.

**Two producers exist, and both were built for a reason this doc should keep.**

| event kind → trigger | producer | driven by | discipline |
|---|---|---|---|
| `storage-degraded` → `storage` | `src/services/notifications/storage-health.ts:62-92` (D222) | a 15-minute backup tick plus one boot beat (`compose.ts:268,442-486`) | publishes on state TRANSITIONS only, and advances its in-process memory ONLY after the durable publish resolves, so a throw leaves the transition pending and the next tick retries |
| `gate-opened` → `gate-waiting` | `src/services/notifications/gate-park.ts:92-145` (D262) | a 5-second watch re-deriving `authority.runs.listParkedAtGate()` (`compose.ts:303,495-522`) | keyed `(runId, gateId)`, remembered only after the publish commits, and FORGOTTEN when the park leaves the observed set — so a re-park is news again |

Both are watches over authority rather than hooks on a transition, which is D218's lesson applied
before it could bite: a hook fires in the process that owns the emitter, and the worker is a
different process from the BFF.

**Five event kinds have no producer at all** — `run-failed`, `subject-mismatch`, `write-parked`,
`repeating-failure` and `verified-done` — which leaves four of the six trigger arms (`failed`,
`write-parked`, `repeating`, `verified-done`) unreachable in the running system. Every one of them
is schema-valid, dedupe-folded and rendered the moment something publishes it; nothing does. Read
the policy list above with that in mind: a run that fails, a subject that mismatches and a write that
parks are exactly the events §6 exists for, and today the operator learns about them from the queue
row and the run panel, not from the inbox. The wiring is per-node work: the failed/subject-mismatch/
write-parked arms belong with `{#sep-dash}`'s and each `Dashboard · wire` set's notification square,
`repeating` needs the `countByFingerprint` threshold §2.1 already indexes for, and `verified-done` is
the one inbox-only arm.

**Three more facts a reader of the wire will otherwise get wrong.** *Severity is not durable*: no
record carries one, and `notificationWireOf` (`src/domain/dashboard/projection.ts:736-764`) derives
`error` for `failed`/`write-parked`, `info` for `verified-done` and `warning` for the rest at
projection time. *There is no notifications route*: the rows ride the one `DashboardDayWire`
(`run-queue-projection.ts:1518-1520`), so the bell moves when the day snapshot does. And *there is no
OS delivery implementation in this tree at all* — `OsNotificationDelivery` is an interface
(`inbox.ts:43-45`), the production inbox is constructed without one (`compose.ts:444-448`), so every
publish settles `no-channel` and the `ping` channel names an INTENT, not a delivery that happened.
D138's guarantee still holds and is doing the work it was designed for: the row is the alert.

**Read / unread / snooze are commands, CASed on the row's own `version`** — which the fold advances
on every publish, so a bell action races a fold that is designed to happen. A stale one comes back
`rejected` with `invalid-state` naming the version it moved to (`command-kernel.ts:993-1040`); the
notification family does not currently produce the `conflict` arm, and the bell handles both through
`settleCommandResult` regardless, because D253's defect was a surface that branched on one refusal
and let the other fall through to success.

## 7. Local-FIRST scope, the multi-user seams, and the retained safety floor

<!-- roadmap: later-unplanned -->

<!-- roadmap-status: later-unplanned -->
- [x] the four seams are built and carry one constant local operator: actor attribution, one identity checkpoint, credential-set-keyed sessions, per-actor notification state
- [x] D193 reaffirmed solo, local, never hosted — no slice designs for multi-user and none may claim scope in its name
- [x] the one loopback exception is the operator-started, token-scoped mobile capture ingress
> 2026-08-20 | docs-cohesion operator-trust | verified the seams are load-bearing in code (the inbox is actor-keyed, commands carry `actor`); nothing here proposes work, which is the point of the node
<!-- /roadmap-status -->

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

<!-- roadmap: cross-cutting -->

<!-- roadmap-status: cross-cutting -->
- [x] eleven of the 49 inventory rows now name their own gap in brackets rather than reading as shipped
- [ ] `apply-settings` is the kernel's ONE `PHASE1_DEFERRED` arm (`command-kernel.ts:141-148`) — Settings reads and nothing there saves
- [ ] `test-login` and the workflow-preflight RUNNER are unbuilt; the storage/authority half of the doctor is real and was drilled at 2j (D181)
- [ ] the cross-date search module, the artifact-bytes route and the export writers are unbuilt (rows 24, 42)
> 2026-08-20 | docs-cohesion operator-trust | re-checked the inventory against the code row by row; the eleven bracketed rows are the whole delta, and each names the section that owns it
<!-- /roadmap-status -->

The following is the canonical list Claude may use to build an explanatory webpage. It describes
what the **base** implements before workflow-specific leaf behavior is migrated.

**Read it as as-built EXCEPT where an item names its own gap in brackets** — re-checked against the
code 2026-08-20, and eleven items now carry one. An item with no bracket is a capability an operator
can reach today.

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
21. Durable actor-keyed typed notifications with read/unread state and optional snooze
    **[no OS delivery exists; two of seven triggers have a producer — §6.3]**.
22. Structured failure records and automatic redacted diagnostic bundles.
23. Per-run evidence receipts showing inputs, observations, decisions, actions, verification,
    output, reuse, and uncertainty.
24. `explain run` CLI/API **[`explain failure` is not built, and `--bundle` portable export
    REFUSES rather than exporting a package it cannot complete — §2.1, §2.5]**.
25. Registered scenario corpus with wrong-page/wrong-subject/crash/control/storage cases
    **[sixteen executable scenarios audited both ways; §3.2's full coverage policy is not proved,
    and the tiers move to ref guards-and-tests under R10]**.
26. Bug-fix rule requiring a linked regression scenario or explicit evidence exception.
27. Structured active/superseded/retired knowledge records instead of append-only lessons
    **[table, admission audit and projection built; nothing in the running system writes or reads
    them — §4.1]**.
28. AI FixRecord ledger linking code changes, failures, scenarios, evidence, and commits
    **[same — the store exists, no surface reaches it]**.
29. Read-only workflow explorer over the descriptor design **[the LIVE-EXECUTION overlay is a named
    exclusion, not a slip: run facts stay on the run-detail timeline — §5.7]**.
30. Constrained, versioned editing of closed presentation and operational-policy fields
    **[DEFERRED out of Phase 2 by D186 with a named trigger — §5.3; nothing partial was built]**;
    graph/composition changes remain source-authored code changes.
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
40. Guided new-workflow scaffolding with task/schema search and a generated missing-obligations list
    **[not built; no scaffold command exists — §5.5]**.
41. Loopback-only single-operator control runtime, with only the short-lived token-scoped mobile
    capture ingress exception; no RBAC/team/HA/remote operator deployment machinery in the base.
42. Generated UI catalog plus exact source links for operator/Codex/Claude reference — generated
    views are never a competing authority **[the ACTIVE-KNOWLEDGE catalog's generator has no caller,
    so no `KNOWLEDGE.md` exists — §4.1]**.
43. Durable restart-safe mobile capture sessions with immutable photo refs, idempotent ordering,
    retryable bundle outbox, and atomic PDF→intake/OCR handoff.
44. Typed contact/address normalization that distinguishes unchanged, ambiguous, and provider-
    unavailable results and preserves the source of every proposed field change.
45. Closed provider capabilities for OCR/geocoding/AI, with narrowed injected clients, infra-only
    SDK/network adapters, timeout/abort/concurrency/rate/cost budgets, preflight, evidence, and
    produced/unavailable/invalid outcomes—remote I/O cannot hide in an import.
46. Optional schema-bounded AI **triage** assistance over redacted structured evidence, with no
    command, identity, registry-write, completion or mutation authority **[the sanity-check, selector
    and summary adapters are RETIRED, not pending — D192 and the 2026-08-18 ruling, §4.4.2]**.
47. Machine-checked legacy capability disposition so every old service/route/UI/CLI/tool is native,
    replaced, retired in the target, or visibly blocking cutover; it never authorizes old-source deletion.
48. One exhaustive runtime-dependency inventory covering every browser system, provider,
    endpoint, env/config/secret consumer, and preflight check in both directions.
49. One typed environment doctor **[the storage/authority half powers startup and Settings health
    and was drilled at 2j (D181); the workflow-preflight RUNNER and `test-login` are not built, and
    `apply-settings` is the kernel's one `PHASE1_DEFERRED` arm — `command-kernel.ts:141-148`, so
    Settings reads and nothing there saves. `{#cross-cutting}` / `{#def-settings}` own the rest]**.

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

Ref guards-and-tests owns the register; this is the row set that answers for THIS doc, checked
against `docs/rebuild/guard-inventory.json` and `tests/unit/architecture/` on 2026-08-20. Ten guards
name `reference/operator-trust.md` as an owner, nine of them `active`.

| the rule this doc states | the guard that holds it | status |
|---|---|---|
| canonical UI ids and search terms unique; every task-used element/state/observation resolves; catalogs byte-fresh and recipe-free; legacy candidate ids cannot enter a runtime catalog | `semantic-ui-registry` | active — **but it audits ucpath · crm · new-kronos only; Kuali's own audit functions exist and are never called (§1.7)** |
| raw `Page`/`Locator`, `getBy*`, `evaluate`, `$` and frame access confined to the driver/session owners and `src/infra/browser/**` | `task-driver-boundary` | active (AST **and** transitive import graph) |
| subject-scoped browser tasks have registered authoritative observations and mismatch scenarios | `subject-before-fence` (ref write-safety) for the ORDER, `ucpath-person-org-strict` for that one store's read discipline | active — **no general per-store guard exists; the rule is enforced by the sequencer at runtime and by one store's own suite** |
| strict runtime schemas parse every UI-registry, scenario, knowledge, fix, evidence, failure and diagnostic boundary; no persisted open `Record` outside the opaque diagnostic attachment | `strict-boundary-schemas` (ref guards-and-tests) | active — recursive, including union and lazy members |
| a receipt is strict at every level, carries a source and instant per fact, and refuses `verified-done` for non-verified confidence, an unresolved mandatory obligation, any warning or a failure id — each proven by a violating fixture; redaction is DECLARED | `evidence-receipt` | active |
| every non-trivial fix links a registered regression scenario or a stated evidence exception; generated active knowledge shows no superseded/retired/unverified record; admission is audited inside the insert transaction | `knowledge-fix-integrity` | active |
| a notification is a durable record FIRST and a delivery second — a delivery that throws leaves the row unread with count and version untouched | `notification-durability` | active (the load-bearing arm injects a throwing delivery) |
| the explorer round-trips from the REAL registries in both directions, and no edit path exists | `workflow-editor-compile-integrity` | active **at Phase A only** — its inventory entry states it carries no Phase-B arms and gains them in the commit that builds them (§5.3) |
| every registered workflow serves the descriptor's own `summary` and every node its own `purpose`, compared byte-for-byte against the declaration | `explorer-prose-declared` | active (D229) |
| the advisory closure's value-import graph reaches no authority writer | `ai-advisory-no-authority` | active (D178) |
| every declared runtime dependency has a preflight scenario exercising its FAILURE, not merely its presence | `preflight-coverage` | **planned** — re-owned by D188; activates with the first migration that adds a preflight runner (§3.1) |

Two rules this section used to claim that no guard holds, stated rather than dropped. **Diagnostic
redaction fixtures**: `redaction-surface-scan` (D183, owned by ref guards-and-tests) is the 2j sweep
that proves no classified value reaches a wire, durable row, ledger file, notification or provider
unreviewed, and `evidence-receipt` holds the declared-classification half — but there is no fixture
asserting that a restricted EXAMPLE value cannot appear in an exported bundle, because §2.5's
`--bundle` export does not exist to be scanned. **Workflow-editor drafts cannot modify active run
snapshots**: unenforceable and unnecessary today for the same reason — there is no draft.

## 10. Explicit residuals

<!-- roadmap: operator-calls -->

<!-- roadmap-status: operator-calls -->
- [x] every residual re-checked against the code and classified closed / open / standing, with the owning node named (§10)
- [x] one residual was FALSE as written — restricted bundles are local but not short-lived, because nothing purges them
- [!] four residuals have NO node: the uncalled Kuali registry audits, `explain failure`, the absent OS delivery channel, and `explain run`'s notifications reason, stale since D262
> 2026-08-20 | docs-cohesion operator-trust | the four unowned items are reported to the plan, not adopted here — this doc may not mint a node
<!-- /roadmap-status -->

Re-checked item by item against the code on 2026-08-20. Each row is **closed** (the mechanism
exists — the residual was a gap and is not one now), **open** with the node that owns it, or
**standing** (a true fact about the world that no build closes). Four items this pass found have no
node at all; they are listed under the table and reported to the plan rather than quietly adopted.

| residual | verdict | who owns it |
|---|---|---|
| Locator/page-state correctness ultimately depends on live system behaviour; the registry cannot make a stale live verification current | **standing** — and the registry's job is to make staleness VISIBLE, which it does: every element, state and observation carries `verifiedAt` plus both evidence refs at the same weight as its id (§1.2, §5.8) | every migration's live re-verification (`{#migrations}` and each `order-N`). D150 retired legacy change accounting on exactly this argument: a selector checked against the live system beats one diffed against legacy's copy |
| Some pages expose no authoritative subject identity, so a subject-scoped write there cannot auto-commit — it must gain a verified cross-page observation or park for typed operator confirmation | **closed as a mechanism** (the fact about those pages stands): the park and the `operator-confirmed-absent` settlement arm are built and were exercised live — D128's controlled commit parked `unknown` with zero checkpoint, ledger and terminal rows | ref write-safety §4.1 owns the arm; nothing is owed here |
| A constrained visual editor cannot express every complex workflow; falling back to reviewed code is expected | **open, and moot until an editor exists** — D186 deferred Phase B entire, so there is no partial editor and no half-authority (§5.3). §5.4's code-change brief is part of the deferred half | `{#def-explorer-edit}`, trigger named: the SECOND production workflow whose policy an operator wants to change without a code change |
| Diagnostic screenshots may carry unavoidable HR context; capture-time redaction cannot promise perfect VISUAL redaction | **standing** — only a screenshot may stay `restricted`; every other attachment arm is redacted text, and a never-exportable key surviving as `allowed` fails the capture (§2.2.1) | this doc; no build closes it |
| …“restricted bundles remain local and **short-lived** unless pinned” | **CORRECTED — the second half was false.** They are local. They are not short-lived: the sweep is built, tested, and has no caller, so no bundle has ever been purged on this machine (§2.2) | `{#def-retention}`, status `never` — D193 dispositioned scheduling AND the content-store refcount as `wont-build-unless-asked` |
| `explain failure <fingerprint>` (§2.1, §4.2) | **open** — the indexed column and `listByFingerprint` exist; the command does not | **unowned** (see below) |
| The knowledge/fix store has no writer, no reader and no surface; §4.3's audit needs a `version` field nobody has ratified (§4.1, §4.3) | **open** — table, admission audit and projection are built and unit-tested; nothing in the running system reaches them | `{#track-a}`'s close-out line (“regression scenarios, knowledge records, capability dispositions”) |
| Five of seven notification event kinds have no producer, leaving four trigger arms unreachable (§6.3) | **open** | the notification square on `{#sep-dash}` and each `Dashboard · wire` set for `failed` / `subject-mismatch` / `write-parked`; `repeating` and `verified-done` are **unowned** |
| A rerun's FIELD-LEVEL diff against the prior run (§2.4) | **open** — per-fact `reuse` rows and `retryOf` exist; nothing compares two receipts | `{#def-search-export}`, where a corpus of runs to compare first becomes reachable |
| `preflight-coverage` is `planned`; nothing executes the preflight fault manifests (§3.1) | **open** | `{#cross-cutting}` — D188 re-owned it; it activates with the first migration that adds a preflight runner |
| §3.2's minimum coverage policy is not proved in full (the audit is over graph-derived points, not a contract's error enum) | **open** | `{#test-tiers}` (R10), spec `ref guards-and-tests §Testing tiers` |

**Four residuals no node names — reported, not adopted.** This doc may not mint a node, so each is
stated here and carried to the plan.

1. **Kuali's registry audit functions are never called.** `auditKualiUiRegistry` and
   `auditKualiUiEvidenceBindings` hold real rules and no test invokes them, so
   `semantic-ui-registry`'s structural audit covers three of the four stores (§1.7). One call site
   closes it.
2. **`explain failure <fingerprint>` has no owner.** It is a CLI capability rather than a workflow
   close-out; the nearest home is `{#cross-cutting}`'s non-workflow capability inventory, which does
   not list it today.
3. **No OS delivery channel exists at all.** `OsNotificationDelivery` is an interface with no
   production implementation, so every publish settles `no-channel` and the `ping` channel names an
   intent (§6.3). D138's guarantee holds — the row IS the alert — but "the operator missed the
   toast" describes a toast that cannot be shown.
4. **`explain run`'s notifications absence reason went stale at D262** and can now tell an operator
   *"this run has none"* about a run that has a `gate-opened` row (§2.5). A one-line reason string on
   a trust surface, where a reader has no way to know it is old.
