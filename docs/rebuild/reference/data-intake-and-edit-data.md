# 06 — Data Intake (operator column mapping) & Edit Data over checkpoints

Status: **revised 2026-07-22 after the whole-plan/legacy-code review; amended 2026-07-26
(Round 8, §5.1 — the mobile-capture durability trim, D79d) and 2026-07-31 (Round 11 — standalone
rebuild repo, D93: the rebuild lives in its own `hr-automation-rebuild` repo at plain `src/`);
**verified against the code and re-ordered 2026-08-21 (docs-cohesion, plan
`docs/plans/2026-08-20-rebuild-docs-roadmap-cohesion.md` §3.5).**
Intake now produces a durable, replayable admission manifest; every data boundary is strict;
scenario coverage and evidence make partial/excluded rows impossible to mistake for silently
completed work.

## Ownership (D1 — this doc owns / this doc references)

| This doc **owns** (siblings reference, never redefine) |
|---|
| The **operator column-mapping design** — the mapping object, per-source persistence + header fingerprint, the upload→map→validate→run UI flow, per-cell coercion, the unmapped-required block, fuzzy-suggestion policy |
| The **extraction** intake task designs (built as `extraction/extract-spreadsheet` and `extraction/extract-pdf-pages` — §3.1/§3.2 renamed the design's `parse-csv`/`parse-pdf-fields`), **roster** matching (`roster/match-spreadsheet`), OCR extraction (`ocr/extract-form-page`) and typed **normalization** service outcomes (`normalization/read-contact-advice`) — their contract shapes + intake semantics |
| The **intake pipeline**: how a parsed+mapped dataset becomes N workflow inputs, and the pre-run per-row rejection review (nothing half-launches) |
| The **Edit-Data surface** — its data source, editable/read-only rules, the edit-during-resume concurrency rule |
| Roster/retention projection semantics: typed stable-key record, blocking outbox, idempotent xlsx upsert, and concurrent-edit conflict policy (storage/projector authority remains ref dashboard-surfaces) |

| This doc **references** (owner) |
|---|
| **Canonical field definitions** — the field vocabulary + zod schemas live in the rebuild repo's `src/domain/` (defined THERE). This doc owns the *mapping/intake semantics onto* those fields, not the vocabulary itself |
| Task contract/impl split (`defineTaskContract`/`defineTask`), service stores (D4), `freshness` field, error taxonomy → **ref task-contract** |
| The **injected-data mechanism** (`RunEnvelope.injected`, §5.6 #3), checkpoint store + resume scope (D9), freshness walk (D8), the "Live Edit Data over checkpoints" subsection → **ref workflow-model** |
| SSE wire shapes (`detailSurfaces` incl. the Context-rail `data` section), the span vocabulary (incl. D254's retirement of `span.patched`), notes stream, SQLite projection role (D14) → **ref dashboard-surfaces** |
| Standard CAS command path for Edit Data → **ref dashboard-surfaces** |
| Scenario manifests, evidence receipts, run explanation, knowledge/fix records → **ref operator-trust** |

Grounding (read, not imagined) — every path in this block is a **legacy-repo** path
(`hr-automation`); unqualified `src/` in the design sections below is the **rebuild repo's** `src/`:
`src/services/matching/roster-loader.ts` (today's **hardcoded**
`COLUMN_PATTERNS` header regexes — the thing operator mapping replaces),
`src/dashboard/components/ocr/shared/match-confidence.ts` (confidence→tier bucketing),
`src/domain/identity/{eid,ocr-person-name}.ts` (canonical EID + name shapes),
`src/workflows/{work-study,separations,person-lookup}/schema.ts` (target input shapes),
`src/dashboard/components/log-panel/EditDataTab.tsx` + `/api/{run-with-data,save-data,find-prior-by-key}`
+ the kernel `prefilledData`/`splitPrefilled` side-channel (the Edit-Data hack this replaces).

---

## 0. What today does, and what specifically hurts

- **Roster ingest hardcodes the schema.** `roster-loader.ts` recognizes columns via a fixed
  `COLUMN_PATTERNS` table (`/^ucpath\s*id$|^empl(oyee)?\s*id$/i`, `/first\s*name/i`, …) and dynamic
  header-row sniffing. A spreadsheet whose column is `"Employee ID#"` or `"Student Name"` — real
  operator layouts — silently yields `eid = ""` or is skipped, because no operator ever *told* the
  system which column means what. It works only for the layouts someone pre-baked a regex for.
- **Ingest is not schema-validated at the source.** Parsed rows flow onward as loose
  `RosterRow`/blob shapes; a malformed EID or date surfaces much later (a wrong UCPath search, a
  failed write) instead of at the cell that was wrong.
- **Edit Data is a side channel.** The dashboard's Edit-Data tab POSTs `prefilledData`; the kernel's
  `splitPrefilled` strips it *before* schema parse and re-injects it as accumulated strings
  (`/api/run-with-data`) or overlays a terminal row (`/api/save-data`). It is gated on
  `detailFields.some(f => f.editable)` and only **separations** opts in. There is no typed contract
  for "what data does this run currently hold" — the tab edits stringified `data`, not checkpoints.

The new model makes intake **operator-mapped and schema-validated by construction**, and makes Edit
Data a **typed view of the run's checkpoints** edited through ref workflow-model's `injected` mechanism.

---

## 1. Canonical field registry (vocabulary lives in the rebuild repo's `src/domain/`, referenced here)

<!-- roadmap: p2-2h -->

<!-- roadmap-status: p2-2h -->
- [x] the canonical field registry is closed at 47 ids and frozen against the RECORDED D58/D68 scan, checked in both directions (§1/§1.1, D146; `src/domain/fields/registry.ts:56-110`, `config/canonical-field-inventory.json` at legacy `4deabc5a`)
- [x] mapping identity, the layout fingerprint, per-cell coercion, the suggestion scorer and `defineIntakeProjection`'s object-identity proof are built and bundle-safe (§2.1–§2.6, D147)
- [x] the extraction store's two tasks (§3.1/§3.2, D149/D152), the roster store with its honest port split (§4, D163) and the normalization store including D178's `ai` arm (§4.2, D165/D178)
- [x] OCR: one admission gate three producers cannot bypass, the generated instruction, the form registry and the classify/group scanner (§4.3–§4.11, D151–D161)
- [x] validation, rejection, the immutable manifest and the rerun diff, on schema v11's ABORT-on-rewrite authority (§5/§5.0/§4.9, D148/D159)
- [x] the retention-projection model end to end, unwired by design (§4.1, D164)
- [ ] two 2h designs have no caller and both are named in place: the saved-mapping STORE (§2.3) and a descriptor that DECLARES an artifact projection (§4.1)
> 2026-08-20 | docs-cohesion data-intake-and-edit-data | verified against `src/domain/{fields,intake,ocr}/**`, `src/stores/{extraction,roster,ocr,normalization}/**`, `src/infra/sqlite/migrations.ts:863-908`; left: the two uncalled designs
<!-- /roadmap-status -->

- [x] the canonical-EID audit gate this migration replays its fixtures through exists and is enforced — `/^10\d{6}$/` everywhere, with the loose legacy `/^\d{5,}$/` recorded as a validation bug rather than a second domain value (§1, §9.1)
- [ ] `work-study` is not in the tree: no input schema, no intake projection, and §8's worked example is this migration's TARGET rather than a transcript
- [ ] the weekly export's saved mapping — the whole point of §2.3's fingerprint — has no writer, so week two re-maps from scratch until `order-6-dash` builds one
- [ ] `effectiveDate` as a per-run constant typed once (§8 step 2) rides the intake session's `constants`; the drawn control belongs to ref dashboard-surfaces §11
> 2026-08-20 | docs-cohesion data-intake-and-edit-data | verified against `ls src/workflows/` (no work-study) and `src/domain/fields/registry.ts`; left: the workflow itself

The closed, typed field vocabulary is domain-owned (charter §11). This doc consumes it; it does not
redefine the field schemas. **The ids shown below are an excerpt, not the Phase-1 inventory.** Before
the registry freezes, D58/D68 scan every legacy workflow input/schema, roster/header rule, OCR form,
and Edit-Data field; each shared mappable concept is assigned one canonical id/schema or explicitly
remains a workflow-local strict field with a reason. No current mappable field may be silently
omitted because it was absent from this example. The registry entry shape is:

```ts
// src/domain/fields/registry.ts  — domain-owned; imports zod + domain identity only
import { z } from "zod";

export type CanonicalFieldId = // excerpt; generated inventory/type is exhaustive in the build
  | "eid" | "firstName" | "lastName" | "fullName" | "email"
  | "deptId" | "department" | "effectiveDate" | "kualiDocId";   // closed union — one-line edit to grow

export interface CanonicalField<S extends z.ZodType = z.ZodType> {
  id: CanonicalFieldId;
  label: string;                       // "Employee ID (EID)"
  /** THE schema. A workflow input schema composes from this SAME object, so a
   *  value the mapper coerces is, by construction, valid for the workflow input. */
  schema: S;
  /** string cell → pre-parse value (z.input<S>). Throws a legible per-cell error
   *  naming the row + column + value on a bad cell (fail-loud — §2.4). */
  coerce: (raw: string, loc: CellLocation) => z.input<S>;
  /** Header-name hints for the SUGGESTION engine only — NEVER auto-applied (§2.5). */
  aliases: readonly string[];
  /** Canonical sample values — power the mapping-grid preview + fuzzy suggestion. */
  examples: readonly string[];
}
```

`eid` ports the canonical EID schema and normalization behavior into the rebuild repo without
importing legacy code — under D93 that non-import is structural (separate repos, no shared module
graph): `coerce` runs the native `normalizeEid` (strip non-digits), then the schema is
`z.string().regex(/^10\d{6}$/)` (ref task-contract §9.1 `SearchPersonOrg` + `isUcpathEmployeeId`).
`firstName`/`lastName`/`fullName` port the canonical `ocr-person-name.ts` shapes (title-cased
"Last, First"). `effectiveDate`/date fields coerce `MM/DD/YYYY` via the ported `dates.ts` helpers.

**The load-bearing invariant—each mapped field uses the target field's exact schema.** A
spreadsheet-capable workflow declares an `intake` projection naming which input fields are mappable;
those field schemas reuse canonical schema objects rather than parallel regexes:

```ts
// src/workflows/person-lookup/module.ts:43 — the one declared projection at HEAD
export const personLookupIntake = defineIntakeProjection(PersonLookupInput, {
  emplId: CANONICAL_FIELDS.eid,          // the same schema object the mapper coerces to
  name:   CANONICAL_FIELDS.fullName,
});
```

The declaration rides the workflow's **server composition module**, never its descriptor (§2.7's
reason: it would fold into `contractFingerprint` and re-stamp every existing run). `work-study` —
this section's original example — is not in the tree yet; it arrives with the order-6 migration, and
until then `person-lookup` is the only workflow an operator can map a column to.

This proves each coerced cell satisfies its target field. The assembled row is still parsed through
the **full workflow schema**, so cross-field refinements/default interactions may reject it visibly;
the plan does not overclaim that field validity implies whole-input validity. A guard (§7 #6)
asserts every field exposed by an intake projection reuses its declared canonical schema. Workflows
may still have non-intake fields such as file refs, selectors, options, and discriminants.

> **Resolved base decision:** `Eid` means the canonical UCPath 8-digit identifier matching
> `/^10\d{6}$/` everywhere. The old `work-study`/`separations` `/^\d{5,}$/` validators are loose
> validation bugs, not evidence for a second domain value. Before each migration, scan its real
> fixtures/tracker inputs through the canonical schema and quarantine/report every rejection. If
> evidence proves a genuinely different source identifier exists, give it a domain-specific name
> and brand plus an explicit, verified conversion to `Eid`; never add a vague `legacyEid` or widen
> `Eid` globally.

### 1.1 Phase-2h as-built — the registry is frozen against a recorded scan (D146)

<!-- roadmap: p2-2h -->

`src/domain/fields/registry.ts` holds the closed `CanonicalFieldId` union (47 ids) and
`src/domain/fields/cell-coercion.ts` holds the pure per-cell core. The D58/D68 scan this section
required is **recorded**, not implied: `config/canonical-field-inventory.json` lists every legacy
workflow input schema, the roster header rules, the OCR form fields and the Edit-Data editable
fields at legacy commit `4deabc5a`, and gives each scanned field exactly one disposition — a
canonical id, or workflow-local **with a reason id drawn from a declared, fully-used set**.

`intake-canonical-field-registry.test.ts` checks the coverage in **both directions**, so neither
artifact can drift alone: a canonical field no scanned source evidences is unevidenced vocabulary,
and a scanned field with no disposition is exactly the silent omission this section forbids. It also
re-reads each named legacy file and fails when a scanned field no longer appears there — the frozen
legacy tree is what makes that a real drift detector. Writing this scan found four fields recorded
against the wrong file (`parentSubject`/`parentRunId`/`taskGroupId` are spread from
`legacy:src/domain/delegation-input-fragments.ts`, not declared in the consuming schemas), which is
the class of error the both-directions check exists to catch.

Three rules the as-built adds, each because the alternative hides something:

- **A tight schema needs evidence.** `eid` is `/^10\d{6}$/` because §9.1 resolved it; dates are ISO
  `DateOnly` because the domain owns the value and the driver owns the `MM/DD/YYYY` wire form;
  `ssn`, `postalCode`, `state` and the phone fields are pinned from verified legacy validators.
  Everything else carries a conservative non-empty-text schema plus `evidence:"audit-at-migration"`
  and a required `auditNote`. Inventing `/^\d{4,6}$/` for `deptId` from three disagreeing call sites
  would be the unverified constant this tree bans, and a schema wrong in the TIGHT direction rejects
  real operator data at the moment the operator is least able to argue with it.
- **`ppsEid` is a separate field with its own brand.** It is the resolved-base-decision case in this
  section made concrete: legacy's `i9-check` keeps `ppsEid` beside `emplId` precisely because UCPath
  may not know the person. No conversion between the two is declared, so nothing can silently treat
  one as the other.
- **Redaction is declared per field, because a reject row is durable.** Each field carries a
  `(classification, redactTransform)` pair refused at definition time by the same table
  `redactDiagnosticFields` uses. The immutable manifest therefore stores a redacted cell while the
  live grid — reading the content-addressed source artifact — shows the operator the real value to
  fix. `ssn` and `dob` use `digest` rather than `last4`: the last four of an SSN is itself a widely
  used identifier.

Two further checks are structural rather than documentary. `defineCanonicalField` refuses any
`example` its own `coerce` + `schema` reject, so a registry whose declared sample values are fiction
cannot load. And no normalized header alias may claim two fields: an ambiguous alias would make the
§2.5 scorer's top hit arbitrary, and an arbitrary suggestion accepted with one click is §7 vector #1
wearing a disguise.

**Naming reconciliation.** `src/domain/ids.ts` owns `IntakeManifestId`, and ref dashboard-surfaces's
D67 command union binds `enqueue-intake-manifest` to it. That id is THE manifest identity, and it is
the only one the tree ever grew: `IntakePlanIdSchema` — the name §5 was drafted against — exists
nowhere in `src/`, so the reconciliation this paragraph asked for happened by the second id never
being minted. `IntakeManifestIdSchema` is what `src/domain/intake/manifest.ts:199` and
`src/core/capture-intake-handoff.ts:170` both parse. `reservedManifestId` and terminal
`intakeManifestId` are two lifecycle fields carrying that SAME identity, not two identities: the
former is the durable pre-enqueue reservation and the latter states that its manifest actually
fanned out.

---

## 2. Operator-defined column mapping

<!-- roadmap: p2-2h -->

### 2.1 The mapping object (zod-typed)

<!-- roadmap: p2-2h -->

```ts
// src/domain/intake/mapping.ts:72-83  (domain — bundle-safe, zod only) — as built
export const ColumnMappingSchema = z.strictObject({
  workflow:       WorkflowIdSchema,
  /** Exact target-field set/schema this map was built against (D66). */
  intakeProjectionFingerprint: FingerprintSchema,
  /** header fingerprint of the source this mapping was built for (§2.3). */
  fingerprint:    FingerprintSchema,        // as built: FingerprintSchema, not a bare Sha256
  savedAt:        IsoInstantSchema,         // provenance, drives stale display
  headerRowIndex: z.number().int().nonnegative(),   // which sniffed row is the header
  /** Stable within one parsed layout: normalized header + duplicate occurrence. */
  columns:        z.array(z.strictObject({
    sourceColumnId: z.string(), header: z.string(), normalizedHeader: z.string(),
    occurrence: z.number().int().positive(), currentIndex: z.number().int().nonnegative(),
  })),                                      // as built: DetectedColumnSchema.omit({ samples: true })
  /** Target-field binding, not canonical-concept binding (D66). Two target paths may intentionally
   * use the same canonical field, e.g. homeCity and mailingCity. */
  bindings: z.array(z.strictObject({
    targetFieldId: IntakeTargetFieldIdSchema,
    canonicalFieldId: CanonicalFieldIdSchema,
    sourceColumnId: SourceColumnIdSchema,
    confirmedAt: IsoInstantSchema,
  })),
});
export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;
```

The mapping binds each stable target id from `defineIntakeProjection` by
`sourceColumnId = base64url(canonicalJson({ normalizedHeader, occurrence }))`, never raw header,
delimiter concatenation, or position. Duplicate `Name` columns are distinct. Current index is diagnostic only; duplicate-header reuse
requires visible confirmation because reordered identical headings are semantically unknowable.
Load validates that every binding's target id still exists, its recorded canonical id matches the
current intake projection, no target appears twice, and the projection fingerprint is unchanged.
This permits two target fields with the same canonical concept without one binding overwriting the
other.

All saved mapping, parse result, validation request/result, intake plan, edit snapshot, and edit
command schemas are strict and versioned. Unknown keys are errors. Missing, blank, null, invalid,
and unresolved are distinct states; UI code never converts them to `""` or omits them to make a
schema pass. Canonical scalars (`WorkflowId`, `SourceColumnId`, SHA-256, EID, ISO instant/date,
artifact id) are branded at parse time, so equally shaped strings cannot be interchanged by a cast.

### 2.2 The UI flow (upload → map → validate → run)

<!-- roadmap: p2-2i -->

1. **Upload.** Operator uploads a `.csv`/`.xlsx` to `POST /api/v1/intake/files?workflow=<id>`
   (§2.7 — creation carries BYTES, so it is a route and not a command arm).
   `extraction/extract-spreadsheet` (§3.1) returns the **detected columns + a few sample values per column** (never the whole file to the
   client at this stage — sample rows only).
2. **Map.** The mapping grid shows each stable target field/path the *target workflow* requires
   (+ optionals), including its canonical concept label,
   with a dropdown of detected source columns and each column's sample values inline. The operator
   connects each canonical field to a column. Fuzzy header matches appear as **suggestions** the
   operator confirms — never pre-applied (§2.5).
3. **Validate.** On "Validate", every data row is coerced+parsed against the bound target fields'
   canonical schemas
   (§2.4). The result is a **rows-valid / rows-rejected** split shown in the grid, each rejection
   naming the offending row + column + value.
4. **Run.** Enabled only when **every required target field is bound**, at least one row is valid,
   and the operator has reviewed the rejection list (§5). A valid zero-row intake is not a no-op
   success: it stays blocked with `no-valid-rows` and the manifest remains inspectable. Running fans
   out the *valid* rows as N workflow inputs; rejected rows are never launched.

### Spreadsheet Intake review and comparison amendment — 2026-09-14

**Operator-approved; implementation remains assigned to 3.1.9.6.** The operator selected the
narrow Intake ownership amendment and spreadsheet-only scope, then approved its complete I1–I5
[execution brief](../plans/phase-3/3.1-finish-the-dashboard/task-9-6-finish-intake-surfaces.md#approved-execution-brief--2026-09-14).
This amends the D170/D171/D173 interaction and confirmation boundary without changing D334's
ordinary Run/Rerun ownership or C0's independent import identities.

- Spreadsheet upload remains the Run modal's existing file entry, with its component extracted
  into Intake ownership. Cancellation or supersession prevents a late response reopening the
  workspace. Cancellation does not assert rollback of a durable import; a lost response is
  uncertain delivery, not proof that the file never reached the server. Retrying the same
  digest/workflow joins its open import and preserves its mapping and selected comparison.
- The served review distinguishes unresolved rows from rejection history. Acknowledging the
  history cannot make an unresolved rejection, unbound required field or zero-valid intake ready.
  Corrections, explicit exclusions, counts and provenance must reconcile every source row; refused
  commands retain the operator's draft. The kernel remains the final readiness authority.
- An open import may explicitly select an earlier immutable manifest for the same workflow,
  including one with different source bytes. Retain that comparison identity in the import's
  preparation data and resolve it through existing manifest lookup. Missing or wrong-workflow
  identities refuse; do not infer a changed file's predecessor from its name or latest unrelated
  record. Existing same-byte comparison behavior remains, and changing an existing comparison is
  an explicit revisioned action rather than an upload-retry side effect.
- Show exact source-file, mapping, projection, workflow-contract, canonical-schema and
  membership/input differences. A new enqueue carries the exact served review binding;
  repeat/changed-plan confirmation names the comparison the operator saw. Bind it to the session
  revision, current source/decisions, validation basis, current schema/projection and prior
  comparison. Re-derive and verify inside the enqueue transaction before manifest/member effects.
  Changing comparison, mapping, corrections, exclusions or schema invalidates confirmation.
  Missing, stale or mismatched confirmation refuses without creating a manifest or runs.
- Preserve historical record parsing and exact applied-command replay before new effects.
  Read-forward optional preparation fields require no backfill or new table. An old command shape
  may remain readable/replayable, but a new request cannot omit current confirmation to bypass it.
  Immutable submitted data, old manifest identities, independent same-byte imports and run origins
  remain unchanged in `imported_artifacts`.
- Terminal imports remain read-only through member archive cases. Comparison reads import evidence;
  it creates no execution action on an archived run and copies no executable values from an archive
  report. A fresh upload has its own source, import identity and explicit review. Applied enqueue
  followed by a lost response/readback recovers the exact result/session rather than blindly
  submitting another enqueue.

The scope is the existing spreadsheet pipeline. The roadmap's classification/OCR wording for
3.1.9.6 is corrected accordingly; existing OCR and workflow-specific obligations retain their
current owners. Phone Capture Mode remains retired. Saved-mapping persistence (§2.3) and
constant/unbind commands retain their existing deferred ownership. This amendment authorizes no
new artifact table, SQLite migration, external HR execution or workflow activation.

### 2.3 Per-source persistence — header fingerprint (recommended scheme)

<!-- roadmap: p2-2h -->

A recurring layout (the same weekly work-study export) should not be re-mapped each time. Reuse is
keyed by a **header fingerprint**:

```
fingerprint = sha256(canonicalJson(
  detectedColumns.map(c => ({ header: normalize(c.header), occurrence: c.occurrence }))
                 .sort(byHeaderThenOccurrence)
))
normalize(h) = h.trim().toLowerCase().replace(/\s+/g, " ")
```

Order-insensitive and unambiguous: canonical JSON preserves element boundaries, so `["a b","c"]`
cannot collide semantically with `["a","b c"]`. Duplicate counts/occurrences are included.
Saved at `config/column-mappings/<workflow>/<fingerprint>.json` (gitignored operator state, mirrors
`.tracker/settings.json`).

> **As built (2026-08-20): the reuse LOGIC is built, the STORE is not.** `resolveSavedMapping`,
> `heldBindings` and the three refusal gates are complete and unit-pinned in
> `src/domain/intake/mapping.ts:243-407`, and `intake-mapping-boundary.test.ts` holds the
> "index never binds" rule. Nothing calls them: there is no writer for
> `config/column-mappings/`, no saved-mapping table (schema v12 stores the in-progress
> `intake_sessions` row and v11 the terminal `intake_manifests` row — neither is a reusable
> mapping), and `resolveSavedMapping`'s only callers are its own tests. So today every upload is
> a fingerprint MISS by construction and the operator re-maps each time. The reuse rules below stay
> NORMATIVE — they are what the store must obey when it is built. Owner: `order-6-dash`
> (the first recurring layout is work-study's weekly export), reported as a `builds:` line.

- **Exact fingerprint hit** → the saved `ColumnMapping` is **pre-loaded into the grid, visibly**,
  and the operator still clicks Run. This is reuse-with-a-glance, **not** a silent auto-run — the
  operator always sees the resolved bindings before any row launches.
- **Stale-fingerprint guard (fail-closed).** Even on a hit, each bound field is re-resolved by
  normalized header + occurrence. A bound column that is now absent → that
  field reverts to **unmapped + loud** ("saved mapping bound `eid` to column 'Employee ID#', which is
  no longer present — re-map"). We never fall back to stored positional index (a
  column-insertion would then map the wrong column silently). The stored `index` is kept only to
  *detect* a header that moved. Any reused binding involving duplicate headers is marked
  `confirmationRequired`; Run remains disabled until the operator confirms samples.
- **Fingerprint miss** → treated as a brand-new layout: no reuse, fuzzy suggestions only. A
  near-miss layout can never partially reuse a stale mapping.

### 2.4 Per-field coercion + loud per-cell errors

<!-- roadmap: p2-2h -->

Coercion is per canonical field (`field.coerce`), then the value is `field.schema.parse`d. A bad
cell **throws a legible error naming row + column + value** — never a substituted default, never a
skipped cell counted as valid:

```
CellCoercionError: work-study intake, row 12, column "Employee ID#" (→ eid):
  value "10-4567" is not a UCPath EID (must be 10xxxxxx, 8 digits).
```

Dates (`MM/DD/YYYY`), EIDs (`normalizeEid` then `/^10\d{6}$/`), names (title-cased) each have their
own coercion; a coercion that cannot produce a schema-valid value is a **row rejection** (§5), not a
guessed value. A whole-column coercion that fails on *every* row is surfaced as a likely **mis-map**
hint ("column 'DeptCode' bound to `effectiveDate` — all 42 rows failed date coercion; wrong column?").

### 2.5 Fuzzy header auto-match — SUGGESTIONS only, never silent auto-apply

<!-- roadmap: p2-2h -->

The suggestion engine scores each detected header against every target field's referenced canonical
field `aliases` + `label` (the redesigned successor of `COLUMN_PATTERNS`). It **proposes** a binding (a highlighted
dropdown default the operator can accept in one click) but **never applies it** — the grid starts
with the field *unbound* and the suggestion shown as a hint. Rationale (charter fail-loud): a
confident-but-wrong header guess ("Name" → `fullName` when the file's real name is in "Legal Name")
is exactly the silent-substitution class we ban. Mechanically enforced: the mapping is only
`bindings`-populated by an operator action (accept-suggestion or manual pick); a guard (§7 #1)
asserts no code path writes `bindings` from the suggestion scorer directly.

### 2.6 Phase-2h as-built — projection, mapping and suggestions (D147)

<!-- roadmap: p2-2h -->

`src/domain/intake/` holds the three pieces, deliberately separate because that separation is what
makes reuse fail closed. The whole tree is bundle-safe (no Node built-in) since the mapping grid is a
browser surface — ref frontend-backend-integration §8.13's lesson applies to every new domain module, not only the ones that
already burned.

**`projection.ts` — `defineIntakeProjection`.** It proves §1's invariant by **object identity**, not
by structural equivalence: the schema found at a target path must BE the canonical field's schema
object. A byte-identical copy is refused, because two identical schemas can drift apart in one commit
and the drift is invisible — the mapper keeps coercing to the canonical shape while the workflow
validates against the copy. That is §7 vector #6, and the legacy tree already shipped it (`/^\d{5,}$/`
against a canonical `/^10\d{6}$/`). Wrappers are unwrapped so `fields.eid.schema.optional()` still
counts, and `optional`/`default`/`catch` — but **not** `nullable` — make a target non-required.
`intakeProjectionFingerprint` folds each target's `(id, canonicalId, required, schemaHash)`, so a
saved mapping built against a looser canonical schema cannot be reused after it tightens.

**`mapping.ts` — identity and reuse.** `SourceColumnId` is `base64url(canonicalJson({
normalizedHeader, occurrence }))`; canonical JSON rather than delimiter concatenation because a
header can contain the delimiter, and two columns sharing one id is the same failure as binding by
position. Reuse has three gates and then a per-binding resolution. `workflow-mismatch`,
`projection-changed` and `layout-mismatch` refuse outright — §2.3's "a near-miss layout can never
partially reuse a stale mapping". Past them, each binding re-resolves by header + occurrence into
`held`, `confirmation-required` (`duplicate-header` or `column-moved`, with the indices it moved
between) or `unbound` with a message naming the saved header. **The stored index never binds**; it
exists only to report that a column moved. The column-absent arm is reachable only when a mapping
file disagrees with itself — it is operator-greppable configuration — and is kept because a
defence-in-depth gate that is never the first to fire is still the one that holds when the first is
edited away.

**`suggestions.ts` — proposes, structurally cannot bind.** A `ColumnBinding` requires `confirmedAt`;
a `Suggestion` has no such field and no way to acquire one, and `confirmBinding` is the single mint.
So there is no code path from the scorer to a populated `bindings` array — §7 vector #1 becomes a
type fact rather than a convention. Scoring adds one signal legacy's regexes never had: the column's
real sample values are tried through the canonical field's own `coerce` + `schema`, and a header that
matches while NONE of the data parses scores **zero** rather than being merely discounted, because
that combination is a mis-map. A `CellCoercionError` there is the measurement, not a failure;
anything else propagates. Candidates within 0.05 of each other are marked `ambiguous` and are
excluded from preselection — choosing between two indistinguishable columns for the operator is the
silent guess in miniature, and `intake-canonical-field-registry` separately forbids one alias
claiming two fields so the scorer cannot be made arbitrary from the registry side either.

### 2.7 Phase-2i as-built — the durable session, the parser seam, and the five arms (D170)

<!-- roadmap: p2-2i -->

§2.2's flow is stateful across many operator actions, and D159's manifest is deliberately terminal,
so the in-progress state gets its own durable row. Schema **v12**'s `intake_sessions` (2i-E1
foundation) retains exactly the operator's DECISIONS plus the immutable source identity — the whole
`ArtifactRef`, the sheet/header selection, confirmed bindings, run constants, corrections,
exclusions, a validation arm keeping `readAt`, and (on every newly created row) the exact
`reservedManifestId` enqueue must later consume. The reservation is optional only so a
pre-reservation stored row reads forward; it is never back-filled.

**The ROUTE creates the session; commands only mutate it.** `POST /api/v1/intake/files?workflow=<id>`
takes raw bytes (size-capped, media-type-checked), publishes them through the one content-addressed
writer, runs discovery via the shared grid edge, mints both the session and its reserved manifest
identity in the new `mapping` row, and returns both on the session wire. There is deliberately no
open arm in the intake command family, exactly as capture has no
`capture-open`: creation carries BYTES, and bytes do not belong in a command envelope that is
journaled, replayed and audited. A **re-upload of the same source digest JOINS its open session**
rather than forking one — the digest is the identity, and a second session over the same file would
silently abandon the first one's mapping and let both enqueue the same rows.

**Rows and detected columns are RE-DERIVED on every read, never stored.** They are a pure function of
`(artifact bytes, sheet, headerRowIndex)`, all three of which are immutable or retained, so a stored
copy has nothing to be reconciled against and could only drift. The kernel therefore reads them
through an injected deterministic `intakeParser` seam — it cannot import a spreadsheet parser
(`src/stores/**` is below it) and its authority transaction is synchronous — which is split into an
async `prepare` (read the artifact once, parse the grid) and a pure synchronous `parse` (rank header
candidates, settle a header row, detect columns, compute the layout fingerprint). A key nobody
prepared **throws by name**; the kernel never maps against a guessed layout.

**The five non-enqueue arms activate, and their placeholder payloads AMEND** (D161/D167's rule — they
were deferred-arm placeholders no producer ever sent, so there is nothing to migrate):
`inspect-intake` → `{sheet?, headerRowIndex?}`; `confirm-intake-mapping` →
`{targetFieldId, sourceColumnId, headerFingerprint}`; `correct-intake-row` →
`{sourceRow, field, correctedValue}`; `exclude-intake-row` → `{sourceRow, reason}`;
`validate-intake` stays payload-free. All five target `{intakeSessionId, expectedVersion}`.
`enqueue-intake-manifest` was still deferred at D170 and landed one decision later — D171, §5.2 —
so all six arms are live at HEAD (`src/domain/commands.ts:172-177`, the family list at `:432`).

Four rules run through the arms:

- **`confirmBinding` is still the ONE mint**, and it is now additionally fenced by the layout: the
  confirmation carries the `headerFingerprint` its grid was built against, and a mismatch is refused
  rather than applied to whatever column now occupies that slot. Suggestions remain hints on the
  wire, beside `bindings` and never folded into it.
- **Any change to the mapping unvalidates the session.** A validation asserts something about a
  specific `(layout, bindings, corrections, exclusions)`; leaving `validated` standing after one of
  them moves would let a stale verdict gate an enqueue.
- **A sheet or header-row change discards the row-level decisions.** A correction and an exclusion
  both name a source row, and a source row means nothing once the header moves under it — dropping
  them loudly is the only alternative to silently re-pointing them at whoever now occupies row 17.
- **An arm other than `inspect-intake` refuses while no header row is settled.** Re-discovering one
  inside a mapping command would mint a binding against a row the session never recorded, which its
  own schema refuses outright.

`validate-intake` RUNS `validateIntakeRows` and retains only `{validatedAt, readAt}`. Running it is
what proves the mapping can be applied to these bytes at all (a bound column that vanished throws
now rather than at enqueue); storing its dispositions would be the same drift as storing rows, since
they are a pure function of the retained inputs plus that exact `readAt` — which is why `readAt` is
retained at all (§4.6's two-digit-year resolution must replay identically). `GET
/api/v1/intake/:sessionId` re-derives them for the review surface.

**Where the projection is declared.** Doc §1's spreadsheet-capable declaration rides the workflow's
**server composition module**, not its descriptor: an intake projection declares which input fields
an operator may bind a column to, which the server needs and a run envelope does not, and putting it
on the descriptor would fold it into `contractFingerprint` and re-stamp every existing run's
contract for a surface that touches none of them. At D170 no registered workflow declared one — person-lookup's input is a UNION and
`defineIntakeProjection` resolved target paths only through a strict object — so every arm and the
upload route refused **by name** rather than mapping against an invented target set. §2.8 (D172)
taught the resolver to walk a union and declared the first projection; the refusal arm stays, and it
is what any workflow without a projection still gets.

### 2.8 Phase-2i as-built — the first real projection, and unions resolve (D172)

<!-- roadmap: p2-2i -->

- [x] the intake model this square wires is workflow-GENERIC and live — the durable session (schema v12), the upload route and all six command arms (§2.7/§2.8, D170–D172); a new workflow needs only a `defineIntakeProjection` declaration on its `module.ts`
- [ ] `work-study` has no projection because the workflow is not in the tree — `person-lookup` is the only one declared (`src/workflows/person-lookup/module.ts:43`); order 6 brings the second
- [ ] saved-mapping reuse has no store, so a recurring weekly export is re-mapped on every upload — §2.3's as-built note; this square is where that writer belongs
- [ ] the per-row `execution-option` constants entry and the unbind arm live in the DRAWN workspace, which this doc does not own — ref dashboard-surfaces §9.7.1 (2i-E3, D173)
> 2026-08-20 | docs-cohesion data-intake-and-edit-data | verified against `src/domain/commands.ts:172-177,432`, `src/domain/intake/mapping.ts`, `src/workflows/person-lookup/module.ts:43` and `src/infra/sqlite/migrations.ts:904`; left: the second projection and the mapping store
> 2026-08-21 | track-f | ref dashboard-surfaces §9.7.1's D173 text claimed "the grid renders `constants` read-only (today always empty)" — corrected: nothing renders `session.constants` at all; `intake.tsx:938` reads only `session.constants.length` inside the `nothingBound` blocker computation (ledger 3 IN155)

`person-lookup` is the first workflow to declare an intake projection, so this is the commit where
the route and all six arms stop refusing by name. Three decisions, each of which a permissive
implementation would have got wrong quietly.

**A union input schema IS traversed, on one rule.** `resolveSchemaPath` refused unions outright, and
`PersonLookupInput` is `{name, …} | {emplId, name?, …}` — so the whole union-input class of
workflows was unmappable. Two workarounds were available and both are silent-wrong-value bugs:
resolving against *the first arm that has the key* picks one shape's schema for a value the other
shape will parse, and flattening the union into one object invents a schema the workflow never
declared. Instead the path resolves in **every** member, and:

- it must resolve to the **same schema object** everywhere it resolves. Two arms spelling
  `z.string().min(1)` twice are two objects — §7 vector #6 at arm granularity — so
  `divergent-across-union` refuses by name and names how many arms disagreed. `person-lookup`
  therefore shares one `PersonNameSchema` across both arms and the canonical view;
- a member that lacks the path makes the target **omissible**, so `required` means "every valid
  input must supply this". That is the only reading under which §5's `unmapped-required` rejection
  is true — claiming otherwise would reject, per row, inputs the workflow itself accepts;
- if no member resolves it, the failure reported is the one that walked FURTHEST, so the message
  names a real shape's fields rather than "a union".

A union at the LEAF is a value shape, not a fork: nothing is left to walk, so it resolves as itself
and a canonical field that is itself a union still matches by identity.

**The projection binds two targets, and only two.** `emplId → eid` and `name → fullName` are the
whole of what a roster row says about a *person*. `keepNonHdh` and `includeCrmDates` are recorded in
`config/canonical-field-inventory.json` as `execution-option` precisely because they describe the
RUN, and binding a spreadsheet column to one would let a file decide whether this system reads CRM.
They keep their schema defaults, so an intake row that omits them is valid.

**Neither target is `required`, and that is the union telling the truth.** No single path is
present-and-mandatory in every accepted input. The combination is still enforced, one level down:
§5's pipeline parses every assembled row through this exact schema, so a row carrying neither
identifier is rejected with the schema's own words. **Residual:** zod reports a failed non-
discriminated union as a root issue reading `Invalid input`, and `BoundaryIssueSchema` keeps only
`{path, code, message}` — so such a row rejects legibly as `workflow-schema` but without naming
which identifier was missing. Composing that message is `validate.ts`'s business, recorded here for
whoever next touches it.

`name` reusing `CANONICAL_FIELDS.fullName.schema` is not a cosmetic tidy: §1's invariant is proved
by OBJECT IDENTITY, so a column bound to `name` is coerced through `fullName.coerce` and must then
satisfy the very schema the workflow validates with. The descriptor's source closure moved, so
`contractFingerprint` moved with it — expected, and the reason the parity `wf` stamp re-freezes.

---

## 3. Extraction store tasks (service store — D4)

<!-- roadmap: p2-2h -->

- [x] every store this workflow composes exists and is pinned: `extraction/extract-pdf-pages` → `ocr/extract-form-page` → `roster/match-spreadsheet`, plus the classify/group scanner and `cli ocr stack` (§3.2, §4.3, §4.8)
- [x] the durability floor is in SQL, not convention — `ocr_extractions` is UNIQUE on `(source_sha256, source_page, form_type)` and ABORTs on update (schema v11, §4.9)
- [ ] there is no OCR workflow: `src/workflows/` holds no descriptor that composes these tasks, so the graph, its review gate and its fan-out are exactly what this node builds
- [ ] the roster SCORING has never met a real roster — the tiering ported verbatim, the scoring is new code, and this migration's live-verify is where §7's honest residual is discharged
- [x] D294 retires the former Capture Mode binding; this OCR workflow has no photograph-to-run obligation (§5.1)
> 2026-08-20 | docs-cohesion data-intake-and-edit-data | verified against `src/stores/{extraction,ocr,roster}/tasks/`, `src/domain/ocr/stack.ts`, `src/server/ocr/compose.ts:91` and `ls src/workflows/`; left: the workflow

`extraction` is a service store (`sessions: []`, no browser, no `page` ctx). Contracts live in
`src/domain/contracts/extraction/`; impls in `src/stores/extraction/tasks/` (ref task-contract §3.4).

```ts
// src/domain/contracts/extraction/extract-spreadsheet.ts:70-90 — as built (D149)
export const ExtractSpreadsheet = defineTaskContract({
  id: taskId("extraction/extract-spreadsheet"),
  title: "Parsing spreadsheet",
  effect: "read",
  provenance: { default: "live" },   // observes these content-addressed bytes now
  freshness: {
    defaultMaxAgeMs: Number.POSITIVE_INFINITY,  // the artifact id IS its digest
    defaultOverride: "forbidden",               // so an override could only lie
  },
  artifacts: "content-addressed",
  subject: { kind: "none", reason: "deterministic local artifact parsing resolves no person" },
  scenarios: ["intake/spreadsheet/happy", "intake/spreadsheet/no-header",
              "intake/spreadsheet/duplicate-headers", "intake/spreadsheet/unreadable"],
  input:  ExtractSpreadsheetInputSchema,   // { artifact, sheet?, headerRowIndex? }
  output: ExtractSpreadsheetOutputSchema,  // {
    //   sheets, sheet,                       every sheet the workbook holds, and the one read
    //   headerRowIndex: … .nullable(),       null ⇒ operator selection required
    //   headerCandidates: ServedHeaderCandidate[],
    //   columns: DetectedColumn[],           STABLE ids, not positions (§2.1) — [] while null
    //   rows: string[][],                    header-relative — [] while null
    //   skippedRows,                         the preamble above the header, so the grid can show it
    // }
  errorCodes: ["unreadable-file", "empty-sheet", "unknown-sheet", "invalid-header-selection"],
});
```

Two deltas from the design sketch this section was drafted as, both recorded where they were
decided. The task is `extraction/extract-spreadsheet`, not `parse-csv`; and its sibling is
`extraction/extract-pdf-pages` — a page RASTERIZER — not `parse-pdf-fields`, because no legacy code
reads an AcroForm anywhere (§3.2, D152). `columns` carries `DetectedColumn`, so the grid receives
`sourceColumnId` from the extraction itself and never binds by position.

- **Header discovery does not require a known alias.** The first `HEADER_SCAN_DEPTH` = 20 rows
  (`src/domain/intake/header-discovery.ts:85`) are ranked using generic
  structure (non-empty cell density, mostly-string cells, uniqueness, data rows beneath). Existing
  recognizable-header logic contributes confidence but is not a precondition. A candidate
  preselects visibly only when it clears `HEADER_PRESELECT_FLOOR` = 0.7 AND beats the runner-up by
  `HEADER_PRESELECT_MARGIN` = 0.1 (`:87-91`) — two indistinguishable candidates are not a
  preselection; otherwise `headerRowIndex:null` and the operator chooses from candidate rows.
  The chosen row is re-parsed and validated before mapping.
- **Fail-loud stays.** Empty/unreadable sheets throw. If no plausible row exists, the UI requires an
  explicit row selection or rejects it; novel headings never abort before the mapping grid.
- The task is pure/deterministic; its output feeds §5's mapping+fan-out, never a write directly.

### 3.1 Phase-2h as-built — `extraction/extract-spreadsheet` (D149)

<!-- roadmap: p2-2h -->

**The id is `extraction/extract-spreadsheet`, not `parse-csv`.** Ref task-contract owns the id grammar and its
read verbs are `read|search|list|extract|match|verify`; `parse-` is not among them, and ref task-contract §3.4's
own example already writes `extraction/extract-pdf-fields`. The illustrative id above is corrected
here rather than the grammar being widened. One task covers `.csv` and `.xlsx` for the same reason:
a caller must not branch on a file extension it should not be inspecting. Fielded-PDF extraction is
NOT built — it needs its own library and its own decision.

**Parsers, chosen as a safety decision (2026-08-05).** `read-excel-file@9.3.5` for `.xlsx` (MIT,
four small modern dependencies, actively maintained, returns natively typed cells) and
`csv-parse@7.0.2` for `.csv` (MIT, **zero** dependencies, and strict by default — a row whose field
count disagrees with its neighbours throws rather than being padded). Rejected: **`xlsx` (SheetJS
CE)**, abandoned on npm at 0.18.5 with two unfixed high-severity advisories including prototype
pollution when reading a crafted file (CVE-2023-30533) — this process parses operator-supplied files
and drives real UCPath and Kuali writes; **`node-xlsx`**, which resolves SheetJS through a
`cdn.sheetjs.com` tarball URL in its own `package.json`, invisible to `npm audit`; **`exceljs`**,
what legacy uses and unmaintained since 2023, nine runtime dependencies; **`@office-kit/xlsx`**,
technically the nicest but pre-1.0 alpha with an API its authors say will shift — revisit at 1.0.

**A cell is canonicalized to text at this edge, and only here.** A date-FORMATTED `.xlsx` cell
becomes ISO `YYYY-MM-DD` (UTC components, matching how the reader builds it — local components would
shift the day west of Greenwich); a number becomes its decimal text; a blank becomes `""`. This is
the only place that knows a cell was marked as a date, so it is the only place allowed to say so —
and `parseUsOrIsoDate` then REFUSES a bare Excel serial, so a date nobody marked is a loud rejection
naming the cell rather than a 1900-epoch guess. A cell type neither parser documents throws;
`String(value)` would put `[object Object]` into a cell an operator could bind a column to.

**Header discovery is alias-independent and returns a choice when it has one.**
`src/domain/intake/header-discovery.ts` ranks the first 20 rows on structure alone — density, how
text-shaped the row is, distinctness, width agreement with the data beneath, and whether there IS
data beneath — with known aliases adding a capped bonus of at most 0.15. Preselection needs both a
confidence floor (0.7) AND a clear margin over the runner-up (0.1); two indistinguishable rows
return `headerRowIndex: null` with candidates, because picking wrong shifts every column by one and
the coercers would then report it as forty unrelated bad cells instead of one wrong header. An
explicit operator selection is honoured exactly or refused — never clamped.

Writing the tests found a real defect in that ranking: `MM/DD/YYYY` was not recognized as
data-shaped, so an ordinary work-study export scored its first DATA row within 0.085 of its header
and every such file landed in "ambiguous". Dates in both wire forms now count as data, which is
correct on its own terms — a header cell is essentially never a date.

### 3.2 Phase-2h as-built — `extraction/extract-pdf-pages`, and a correction (D152)

<!-- roadmap: p2-2h -->

**§3's `parse-pdf-fields` described a capability that does not exist.** It says "same shape for a
fielded PDF (onboarding's extraction step ports here)". Reading legacy at `4deabc5a`: onboarding's
`extract.ts` is Playwright scraping labelled fields off a CRM page, and **no legacy code reads an
AcroForm anywhere**. What legacy actually does with PDFs is rasterize pages for OCR (`pdf-to-img`),
split a page out for OnBase (`pdf-lib`), and text-extract Kronos reports (`pdf-parse`). Building an
AcroForm reader for a form nobody submits would be implementing a misremembered requirement, so the
real intake need — **rasterization** — is what landed.

`extraction/extract-pdf-pages` turns one content-addressed PDF into one content-addressed PNG per
page, which is exactly what `ocr/extract-form-page` consumes. A page window is **refused, never
clamped**, when it runs past the end: an operator asking for pages 40–50 of a 44-page scan has
miscounted, and quietly returning five would hide it and misnumber every downstream `sourcePage`.
`pageCount` reports the DOCUMENT's page count rather than the window's, so a reviewer can tell a
two-page scan from pages 2–3 of a longer one.

**`pdf-to-img` chosen (2026-08-06).** It wraps Mozilla's `pdfjs-dist` — the reference implementation,
and the one legacy already renders with — behind a Node API; MIT, actively maintained (6.2.0,
2026-06-12), one runtime dependency. Rejected: **`pdf-lib`**, legacy's page splitter, last published
2022-05-12 and unable to rasterize at all — the rebuild needs no PDF *writer* on this path and should
not adopt an unmaintained one speculatively; **`pdfjs-dist` directly**, same engine but the Node
canvas and worker plumbing would be hand-wired; **`mupdf`**, AGPL-3.0, not a licence to take on
casually for a university system; **`pdf-parse`/`unpdf`**, text extractors, and a scanned form has no
text layer.

**Two findings from a real 44-page operator scan, both load-bearing.** Xerox scanners emit JBIG2 for
bilevel pages, and without `wasmUrl` pdfjs announces "Falling back to JS JBIG2 decoder" and takes
~60% longer (736 ms vs 462 ms for five pages) — so the wasm URL is resolved from the INSTALLED
`pdfjs-dist` and cannot drift from the version actually loaded. And pdfjs **transfers** its input
buffer, so a second render over the same `Uint8Array` throws `DataCloneError` on a detached buffer;
every call gets its own copy, which is also what makes a retry safe.

The scenario fixture is a PDF built by hand from literal PDF objects rather than by a library: a
fixture produced by a PDF *writer* would only prove the reader agrees with that writer.

**One honest limit.** `read-excel-file` prioritizes usability over throughput (~3 s for 2000 rows ×
20 columns; very large files can overflow the stack). Operator HR exports are dozens to low
hundreds of rows, so this is fine today and is recorded rather than hidden. A second honest limit:
the `.xlsx` fixture is produced by `write-excel-file`, which proves a real OOXML round-trip but is
**not** proof against Excel's own output — that is a live check against a real operator export.

---

## 4. Roster store tasks (service store — D4)

<!-- roadmap: p2-2h -->

- [x] the matching half is built and scenario-pinned — `roster/match-spreadsheet` with `name-eid-conflict` reporting confidence 0, a claimed EID never overridden, and five executable scenarios (§4, D163)
- [ ] roster INGEST as a workflow step does not exist; onboarding's graph is what this node builds, and it is the first consumer that makes the 24 h freshness budget bite
- [ ] onboarding's legacy extraction is Playwright scraping labelled fields off a CRM page — NOT a fielded-PDF read (§3.2's finding at legacy `4deabc5a`), so the port target is the scrape and no AcroForm reader is owed
> 2026-08-20 | docs-cohesion data-intake-and-edit-data | verified against `src/stores/roster/tasks/match-spreadsheet.ts`, `tests/scenario/roster-match.scenario.test.ts` and `ls src/workflows/`; left: the workflow

`roster` matches one dataset against another (a mapped spreadsheet against extracted OCR records, or
two rosters), producing per-subject matches with confidence.

```ts
// src/domain/contracts/roster/match-spreadsheet.ts:69-85 — as built (D163)
export const MatchSpreadsheet = defineTaskContract({
  id: taskId("roster/match-spreadsheet"),
  title: "Matching against roster",
  effect: "read",
  provenance: { default: "derived" }, // carries subject+roster sources/oldest observedAt
  /** D8: a roster match may feed a WRITE (an OnBase upload keyed on the matched
   *  EID). A stale match must not silently ride into that write on resume. The base maximum is 24h;
   *  a consuming workflow may narrow it, never widen it without a reviewed policy change. */
  freshness: { defaultMaxAgeMs: 24 * 60 * 60_000 },
  subject: { kind: "none", reason: "pure cross-source roster matching" },
  scenarios: ["roster/match/exact-eid", "roster/match/name-only", "roster/match/ambiguous",
              "roster/match/name-eid-conflict", "roster/match/no-match"],
  artifacts: "content-addressed",
  input:  MatchSpreadsheetInputSchema,   // { subjects[], rosterArtifact, mapping, sheet?, readAt }
                                         // the roster is operator-mapped too (§2); `readAt` is
                                         // required so a replayed coercion resolves identically
  output: MatchSpreadsheetOutputSchema,  // { matches: [ … ] } — wrapped, so the one array leaf
                                         //   has a named provenance path
  //  each match:
  //  z.strictObject({
  //    subjectId:       ItemId | StableRecordId,
  //    matchedEid:      fields.eid.schema.nullable(),
  //    matchConfidence: z.number().min(0).max(1),          // 0–1 — same axis as today
  //    tier:            z.enum(["high", "medium", "low"]), // ported bucketing (below)
  //    mismatch:        z.enum(["none", "name-eid-conflict", "no-match", "ambiguous"]),
  //  })
  errorCodes: ["roster-unreadable", "no-name-column", "no-eid-column", "mapping-mismatch"],
});
```

- **Match confidence ports `match-confidence.ts` HONESTLY.** The confidence→tier thresholds
  (`high ≥ 0.6` = the backend `LLM_HIGH_CONFIDENCE` cutoff, `low < 0.4`, non-finite → `low`) are a
  **live-verified pure mapping** — they port **verbatim** into a domain module both the roster task
  and the dashboard badge import (no re-implementation). The *scoring* that produces the 0–1
  confidence (name/address/EID alignment) is **redesigned** onto the canonical fields and must be
  **re-verified** against a real roster at the first migration that runs it — order 3, the OCR
  pipeline, which is what matches extracted records against a roster (roster INGEST is order 9) — flagged as redesigned, not claimed
  live-verified.
- **Mismatch surfacing.** A `name-eid-conflict` (the roster's name and EID point at different people)
  or `ambiguous` (multiple candidates) is a **first-class output field**, not a swallowed default —
  the intake review (§5) and the OCR approval cards surface it exactly like today's `warnings` +
  `MatchConfidenceBadge`. A match the roster cannot make is `matchedEid: null` + `mismatch:"no-match"`
  (the caller then falls through to person-lookup), **never** a fabricated EID.
- **Freshness (D8).** Because a roster match can feed a write, the contract declares a finite
  `maxAgeMs`; the resume freshness walk (ref workflow-model §5.5) refuses a stale replayed match feeding a
  commit transaction, naming the roster + age + limit.

**As-built (D163, 2026-08-08).** The store landed as sketched, with the port split exactly as
above: `src/domain/matching/match-confidence.ts` carries the tier bucketing VERBATIM (legacy
`match-confidence.ts` at `0fd181c2`), `name-match.ts`/`levenshtein.ts` carry the five-tier scorer
and the same/similar/different classifier (legacy `match.ts` at `ab9ab5ab`, `levenshtein.ts` at
`c5caad80`), and `roster-match.ts` is the REDESIGNED composition — every verdict arm pinned in
`tests/unit/roster-match.test.ts` and awaiting its real-roster re-verify at the roster migration.
The composition's fail-closed choices: a `name-eid-conflict` reports **confidence 0** (a number
implying partial trust on a conflicted identity is how a wrong person gets paid); a subject's
CLAIMED EID is never overridden by a name-matched different one (that is a conflict too); a
top-score tie between distinct EIDs is `ambiguous`; a sub-floor best reports its honest near-miss
score under `no-match`. Legacy's LLM disambiguation arm did NOT port (a provider concern with no
tier in this contract), nor did `correctNameSpelling` (a Kuali write-path concern). Deviations
from the sketch, each deliberate: `subjectId` is the union of the two real caller identities
(`ItemId` | `StableRecordId`) — the sketch's `StableItemIdSchema` was never built; the output is
wrapped (`{ matches }`) so the one array leaf has a named provenance path; `readAt` joins the
input (canonical coercers demand the observation instant — the intake-validation rule) beside an
optional `sheet`; and `mapping-mismatch` + `no-eid-column` join the error codes — a mapping that
does not fit these exact bytes (proved by re-detecting columns and comparing the mapping's own
header fingerprint) and a mapping with no EID binding are refusals worth naming. The task parses
through the ONE shared grid edge (`src/stores/common/spreadsheet-grid.ts`, lifted verbatim from
`extract-spreadsheet` so the date-cell canonicalization cannot fork), and a cell that fails its
canonical coercion nulls THAT fact on THAT row through the sanctioned discriminated wrapper —
counted, logged, never an erased row and never a swallowed error. Five executable scenarios
(`tests/scenario/roster-match.scenario.test.ts`) pin the contract's arms end to end.

### 4.1 Mutable retention workbooks are serialized projections, not read-task side effects

<!-- roadmap: def-search-export -->
<!-- roadmap: cross-cutting -->

- [x] the retention-workbook MODEL this migration needs is built and unit-pinned — `DurableArtifactProjectionSpec`, the one-transaction checkpoint + stable-keyed outbox commit, the blocking `RunArtifactProjector`, the `xlsx-retention` sink and the fail-closed conflict park (§4.1, D164; `src/infra/artifacts/artifact-sink-projector.ts`, `xlsx-retention-sink.ts`, 13 arms in `tests/unit/artifact-projection.test.ts`)
- [x] the i9 document model the workflow reads is built as ONE form across two loose sections, with the section-absent arms named (§4.10, D160)
- [ ] no descriptor declares `artifactProjections:` and no composition wires the projector — deliberately: the workbook PATH and the operator-facing retention columns are i9-check's own facts, and a declaring descriptor without the seam fails loud by name
- [ ] the sink writes a four-column DURABILITY layout (`stableKey`/`keyValues`/`record`/`projectedAt`), not the operator's retention columns — those land with this migration
> 2026-08-20 | docs-cohesion data-intake-and-edit-data | verified against `src/infra/artifacts/*`, `src/core/run-executor.ts:1078` and `grep -rl "artifactProjections:" src/workflows/` (empty); left: the declaration and the real column set

<!-- roadmap-status: def-search-export -->
- [x] this doc's half of the export writers exists — `write-excel-file` behind `src/infra/artifacts/xlsx-retention-sink.ts`, with an idempotent stable-keyed upsert and a temp → fsync → atomic-replace write
- [ ] that writer emits a durability layout for ONE sink kind; an operator-facing "export these runs to Excel" writer is not built anywhere
- [ ] the query surface (search runs across dates, view screenshots) is not this doc's — ref frontend-backend-integration §3.6 owns it, and the screenshot evidence store is ref operator-trust §2.2
> 2026-08-20 | docs-cohesion data-intake-and-edit-data | verified against `src/infra/artifacts/xlsx-retention-sink.ts`; left: everything operator-facing — this doc contributes only the writer
<!-- /roadmap-status -->

`i9-check` currently appends to a master retention workbook. Calling that append part of the
`roster/match-spreadsheet` read would make task retry duplicate rows and would violate the effect
contract. The rebuilt roster task therefore returns only the typed match/retention record. Its
workflow descriptor declares a `DurableArtifactProjectionSpec` that names the exact producing
node+field, a canonical record schema, a stable non-positional key (subject identity plus document/
roster version), the `xlsx-retention` sink, and `blocking:true`.

The checkpoint and stable-keyed `artifact_outbox` row commit atomically in SQLite. One sink
projector holds the local exclusive lease, verifies the workbook's previously recorded content
hash, applies an idempotent upsert in memory, writes temp → fsync → atomic replace, and records the
new hash before acknowledging the outbox. A duplicate key is a verified no-op/update, never a
second append. If the operator or another process changed the workbook since the last head, the
projector parks the run with both hashes and preserves both files; it never overwrites concurrent
edits. Because the projection is blocking, the member cannot report `done` until the outbox is
acknowledged. The finite sink registry is infrastructure keyed by sink kind, not another workflow-id
registry; descriptor coverage validates every source/key path and sink id.

Input/download `FileRef` values are likewise content-addressed artifact references created through
ref task-contract's atomic writer, not arbitrary mutable paths.

**As-built (D164, 2026-08-08) — this section landed.** The v1 `artifact_outbox`/
`artifact_sink_heads` shells (JSON tables with zero production rows) grew their REAL semantics at
the repository layer — no migration, because no released bytes existed to migrate: the outbox
record gained `projectionId`/`keyValues`/source identity, `markProjected` is a `pending →
projected` CAS that is idempotent on an already-projected row, and the typed sink head updates one
row per sink under a generation CAS (the notifications discipline). The executor consumes
`descriptor.artifactProjections` at runtime: the checkpoint and its derived stable-keyed rows
commit in ONE authority transaction, the node then BLOCKS on `RunArtifactProjector.projectOutbox`,
and a projection failure is a STRUCTURED NODE FAILURE — ref workflow-model's state machine has no
waiting-on-projection arm (a real gap between this section's "parks" language and ref workflow-model §4), and
the as-built resolution is fail-loud node failure with the durable rows surviving: a relaunch
replays the checkpoint, RE-DERIVES the stable keys (a pure function of the exact output), finds
its pending rows by `projectionId + stableKeyFingerprint` — never by run id — and resumes the
projection to done. The projector's ordering mirrors the ledger lesson: file replace first, then
head + acknowledgement in one transaction; the crash window between them re-reads as a conflict
and parks fail-closed, indistinguishable from and treated like an operator edit (both hashes
named, the operator's bytes untouched, the intended update preserved beside them as
`.pending-<outboxId>.xlsx`). The `xlsx-retention` sink writes a four-column durability layout
(`stableKey`/`keyValues`/`record`/`projectedAt`, canonical JSON text) — the operator-facing
retention columns belong to i9-check's migration, which knows the real fields — through
`write-excel-file` (the maintained sibling of the trusted reader; `@office-kit/xlsx` re-checked
2026-08-08, still 0.9.0, stays refused per §3's reasons). The exclusive lease is a per-sink
`O_EXCL` lock file — the LOCAL scope this section names; multi-worker contention is 2j's soak.
`composeWorkerRuntime` deliberately does NOT wire the projector yet: no production descriptor
declares a projection, and the workbook path is the consuming migration's fact to supply — a
declaring descriptor without the seam fails loud by name. Proof:
`tests/unit/artifact-projection.test.ts` (13 arms: derivation purity, fresh/no-op/update/conflict/
lock, and the executor's atomic-commit, blocking-failure, and cross-run resume arms).

### 4.2 Contact/address normalization is typed advice, not a silent fallback

<!-- roadmap: p2-2h -->

The old path mixes deterministic phone/state/ZIP cleanup, Census→Nominatim fallback, and optional
LLM inference inside `services/llm/normalize-contact.ts`; provider failure collapses to `null`, which
is indistinguishable from “nothing needed changing.” The rebuild exposes one reusable
`normalization/normalize-contact` read contract whose output names what happened:

```ts
const ContactFieldIdSchema = z.enum([
  "relationship", "cellPhone", "homePhone", "address1", "address2",
  "city", "state", "postalCode", "country",
]);
const NormalizationChangeSchema = z.strictObject({
  field: ContactFieldIdSchema,
  before: RedactedValueSchema,
  after: CanonicalJsonValueSchema,
  source: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("rule"), ruleId: NormalizationRuleIdSchema }),
    z.strictObject({ kind: z.enum(["census", "nominatim"]),
                     observedAt: IsoInstantSchema, evidence: EvidenceRefSchema }),
    z.strictObject({ kind: z.literal("ai"), provider: AiProviderIdSchema,
                     model: AiModelIdSchema, confidence: z.number().min(0).max(1) }),
  ]),
});
export const NormalizeContactOutputSchema = z.strictObject({
  normalized: ContactFieldsSchema,
  changes: z.array(NormalizationChangeSchema),
  disposition: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("complete") }),
    z.strictObject({ kind: z.literal("advisory-unavailable"),
                     unavailable: z.array(ProviderFailureSchema).nonempty() }),
    z.strictObject({ kind: z.literal("ambiguous"),
                     fields: z.array(ContactFieldIdSchema).min(1) }),   // as built: .min(1)
  ]),
});
```

Deterministic rules execute first. Provider-backed paths are individually observed and recorded;
one provider may try the next provider only through a declared, scenario-pinned provider policy.
Exhaustion is `advisory-unavailable`, not an empty change list. AI/geocoder values never overwrite
OCR/input silently: the review gate shows before/after/source/confidence and accepted changes become
operator-correction provenance. Ambiguous or unavailable **mandatory** fields block approval; truly
optional suggestions may yield `done-with-warnings` only under ref operator-trust's evidence rule. The contract
uses a finite freshness budget for provider-derived facts and registers rule-only, each-provider,
rate-limit/failure, malformed-model-output, ambiguous, and approval/rejection scenarios.

---

**As-built (D165, 2026-08-08) — this section landed, with the pool.** The store is
`normalization/read-contact-advice` — the sketched `normalize-contact` id violated ref task-contract's
read-verb grammar, the same defect D149 fixed. Deterministic rules ported with provenance
(`legacy:src/services/llm/normalize-contact.ts` and `address/format.ts`): phone → canonical
DIGITS (this tree's canonical phone; display formatting is the consuming workflow's), state/ZIP
tables, country aliases, and the relationship table with the in-law-before-substring order — the
LLM fallback did not port at D165 (the `ai` source arm was left for 2i's advisory producer, so the
schema carried no arm nothing could produce; **D178 landed both** — the arm is
`src/domain/contracts/normalization/normalize-contact.ts:107-112` and its producer is
`src/stores/normalization/tasks/read-contact-advice.ts:266`, described at the end of this section). A rule that cannot decide is `ambiguous`; provider
exhaustion is `advisory-unavailable` carrying each capability's closed reason; `before` values
are redacted under each canonical field's own classification/transform through the ONE
`redactValue` implementation, narrowed at the contract boundary to the string-valued arms a
contact can produce. The census-before-nominatim policy lives in the task under the caller's
`geocode` flag, each observation recorded with instant + confidence; street-LINE advice is
deliberately NOT offered (the 2026-07-13 incident surface — `isSafeStreetReplacement` and the
house-number primitives ported into `src/domain/normalization/street-safety.ts` for the
confidence rules and the EC migration, which owns the live re-verify); city/state/ZIP advice
comes only from a `resolved` outcome above `unverified`. The geocode adapters
(`src/infra/providers/geocode-adapters.ts`) are transport+provenance like D161's — Census
builds the street NAME from components, never TIGER ranges; Nominatim carries the policy
User-Agent; legacy's 1.1s sleep did not port because the kernel's `geocodeNominatim` budget
(`requestsPerMinute: 1`) is the durable form of the same policy. **The pool**
(`src/infra/providers/provider-pool.ts`) is ONE adapter per capability selecting which
key/model child answers each invocation: "one invocation is ONE model call" holds exactly —
rotation advances ACROSS invocations on the exhaustion code family, never a second remote
attempt under one admission; model tiers order the children and keys rotate within a tier;
evidence names the child. `composeWorkerRuntime` now composes the gemini pool (keys × models)
and both keyless geocoders. Proof: `tests/unit/normalization-rules.test.ts`,
`tests/unit/provider-pool.test.ts`, and five executable scenarios in
`tests/scenario/normalization-contact.scenario.test.ts`.

**As-built delta (D178, 2026-08-09) — the `ai` arm goes live, NARROWER than legacy's.** The
`ai` source arm (`{provider, model, confidence}`) landed behind its own `ai` input flag, separate
from `geocode` because the two spend different budgets against different remote systems and a
caller who wanted address verification has not thereby consented to a model reading the record.
The task asks about the fields the deterministic rules could not decide — but **only those whose
canonical `redactTransform` is `allow`**, because ref operator-trust §4.4's rule is that redaction happens
before the wire and the DECLARED classification decides, not the usefulness of the answer.
`CANONICAL_FIELDS.relationship` is `sensitive-hr`, whose widest permitted transform is `count`, so
the one field legacy's LLM fallback existed for is precisely the one this arm withholds: it stays
`ambiguous` for the operator, which is the honest outcome. `address1`/`postalCode`/`cellPhone`/
`homePhone` are `direct-identifier` and are likewise never asked about; `city`/`state`/`country`
are `safe-diagnostic` and are. An answer naming a field the prompt did not carry throws BY NAME
rather than being applied — that is the model volunteering a value for a withheld field. A
malformed answer is a refusal that leaves the fields ambiguous, never a partial accept, and joins
`advisory-unavailable` beside the geocoders' own exhaustion. `ContactFieldIdSchema` and the new
`ContactAdviceSchema` moved into `src/domain/normalization/contact-rules.ts` so ref operator-trust's advisory
module can reach the vocabulary without putting the task contract in its import closure. Proof:
`normalization/contact/ai-advice` and `normalization/contact/ai-withheld-field` in the same
scenario corpus — the second asserts the withheld value appears NOWHERE in the prepared request.

### 4.3 Phase-2h as-built — OCR extraction admits three producers identically (D151)

<!-- roadmap: p2-2h -->

- [x] the three producers are admitted through ONE gate that cannot branch on the source, and an operator's hand reading fingerprints identically to the provider's (§4.3, D151; `src/domain/ocr/extraction.ts`, held by `ocr-producer-parity`)
- [x] routes 2 and 3 are usable from a terminal today — `cli ocr forms | instruction | admit`, non-zero exit on refusal (`src/server/ocr/compose.ts:73`)
- [x] route 1's production adapter is built as transport plus provenance (§4.11, D161; `src/infra/providers/gemini-ocr-extract.ts`)
- [ ] the review row and the approval cards this square wires are the DRAWN surface, which this doc does not own — ref dashboard-surfaces §9 (D7/D8/D10) and ref frontend-backend-integration §5.1
- [ ] `ocr_approvals` (schema v10) has no writer in `src/` outside the storage layer — the approval ACT is what the review surface adds
> 2026-08-20 | docs-cohesion data-intake-and-edit-data | verified against `src/domain/ocr/{extraction,instruction,form-registry,stack}.ts`, `src/server/ocr/compose.ts` and `grep -rl ocr_approvals src` (storage layer only); left: everything drawn

**Operator requirement (2026-08-05):** a page may be read by the automated provider pipeline, by an
AI the operator runs in their own terminal, or by the operator — and *"all should result in the same
result consistently… the output should be in the same format no matter who does it and nobody skips
anything."*

Two mechanisms carry that, and neither is a convention:

**One gate, no branch on the source.** `admitOcrExtraction` (`src/domain/ocr/extraction.ts`) is the
only way any submission becomes a record. `ExtractionSource` is a closed union —
`provider{providerId,modelId}` · `local-agent{agentId,invocation}` · `operator{actorId}` — recorded
as PROVENANCE and never consulted for permission. There is deliberately no `if` on it anywhere in
the function, so a route cannot acquire a weaker rule by being more convenient. A value bound to a
canonical field runs the SAME `coerce` + `schema` an intake column runs, so a model that returns
`10-4567` for an EID is refused for exactly the reason and with exactly the message a spreadsheet
cell would be: the producer's confidence in its own output buys it nothing.

**One instruction, generated from the registry.** `src/domain/ocr/form-registry.ts` declares what
each form HAS; `buildExtractionInstruction` (`src/domain/ocr/instruction.ts:40`) derives the field list, per-field prompt, expected shape
and answer skeleton FROM it. A hand-maintained prompt is the failure this avoids — add a field and
every route asks for it on its next run, where a prompt living in a string constant would let one
route silently stop looking.

**"Nobody skips anything" is the completeness rule.** Every declared path must appear, and each
answer is a value or a TYPED absence. A submission that omits a path is refused; so is one carrying
a path the form does not declare. There is no `.optional()` anywhere in the answer shape, because an
optional field is precisely a field a producer can skip in silence. The three absences are not
interchangeable and that is the point: `not-on-form` (no such box), `blank` (box present, empty — a
fact about the employee), `illegible` (something there, unreadable — a fact about the SCAN, and the
only one a re-read can fix). Legacy collapsed all three into `null` and reconstructed the difference
afterwards by diffing snapshots.

A value the producer read but that its field refuses is `unreadable`, kept WITH its raw text — not a
rejection of the whole record, because a human resolves it and needs to see what the producer saw.
`blockingPaths` names the mandatory fields left unanswered; an empty list means ready for review,
never approved. `answersFingerprint` digests what was read while excluding who read it and when —
so "two routes agree" is checkable rather than asserted, and confidence is excluded because it is
the producer's opinion of itself rather than a fact about the page.

**Routes 2 and 3 are usable now**, through `cli ocr` (`src/server/ocr/compose.ts:73` — three
subjects, `forms` · `instruction` · `admit`):

```
cli ocr forms                      which forms exist, and how many fields each demands
cli ocr instruction <form-type>    the exact brief EVERY route receives
cli ocr admit <submission.json>    run the gate; print the record or the problems
```

An AI the operator runs in their own terminal reads `instruction`, writes the JSON it describes, and
hands it to `admit`; so does the operator; so, later, does the provider adapter. `admit` **exits
non-zero on refusal**, because a terminal agent's own tooling checks the exit status rather than
reading prose, and a refused submission that exited zero would look accepted. An unreadable file is
named as such rather than reaching the gate as `undefined`, where a JSON typo would come back as a
complaint about `formType`.

The command adds no rule of its own — it reads, calls the gate, and reports — and
`ocr-producer-parity` enforces that: only the gate may parse an `AdmittedExtraction`, the gate may
not branch on `source`, and the answer shape may carry no `.optional()`.

**Route 1 is the `ocr` service store**, `ocr/extract-form-page`. Its implementation is three lines
of intent: build the SAME instruction the CLI prints, send it to the admitted `ocr.extract` client,
run the answer through the SAME gate. Its output type is the ordinary `AdmittedExtraction` — there is
deliberately no "provider result" shape, because a second shape is how two routes start meaning
different things. Nothing in it interprets, repairs or supplements what the model returned: a model
that answers a different field set than the form declares fails as `incomplete-extraction` carrying
**the gate's own problem list**, so the operator reads the same correction text a terminal agent
would have. A structured `unavailable` reason keeps its closed code and `retryAt` rather than being
flattened to prose — those are the parts an operator can act on. A page the model could only
partly read is still a success with `blockingPaths` set; that is what a human resolves.

The scenario corpus pins the property that matters: an operator submitting the identical reading by
hand produces the **same `answersFingerprint`** as the provider route. The routes are
interchangeable, not merely similar.

### 4.4 Phase-2h as-built — the forms are legacy's, and reading them found two gaps (D153)

<!-- roadmap: p2-2h -->

Operator confirmation (2026-08-06): the rebuild handles the same forms legacy does, so the field
sets are ported rather than redesigned. Porting them exposed **two structural gaps in D151's first
shape**, both of which are forms of the skipping the operator asked to make impossible:

- **A scanned stack is loose paper.** Legacy's own prompts classify every page, because operators
  feed it piles of it. Without that, a producer handed an emergency-contact page during an oath run
  must either invent oath answers or fail the page, and neither is true. A submission now declares
  `pageKind` BEFORE any field is read; a page that is not the expected form carries no record and is
  **admitted**, not refused.
- **A page is ONE person** (corrected 2026-08-06 against the real corpus — see §4.5). The multi-row
  sign-in sheet legacy supported is used by no workflow, so `record` is a single nullable value
  rather than an array.

**Legacy's prompt knowledge moved onto the form, not into a route.** `extractionNotes` carries the
rules that were learned from real misreads — "do NOT drop the leading `10`"; "scan the top margin and
handwritten notes outside the printed box, because on UPAY585 scans a standalone eight-digit number
above the header is usually the real id"; the observed digit transpositions (`10843962` reported when
the paper said `10002337`) and letter drops (`Sharaf`, not `Shaaf`); "NEVER skip the contact's
address because it resembles the employee's". The guard asserts every note reaches the generated
brief verbatim, so this knowledge cannot end up in one route's prompt string and miss the others.

Legacy's `originallyMissing` — an array of fields the model judged blank, reconstructed afterwards by
diffing snapshots — is **superseded** by the typed absences: `blank` and `illegible` are recorded per
field at the moment of reading, by the producer that read it.

### 4.5 Phase-2h as-built — measured against the real document corpus (D154)

<!-- roadmap: p2-2h -->

`hr-automation/data/documents` holds the operator's real scans, and reading them corrected the form
model twice.

**The oath is one person per page, and its Employee ID box is usually blank.** Every oath in the
corpus is a UPAY 586 with one name at the top; the multi-row sign-in sheet legacy supported is used
by **no workflow** (operator, 2026-08-06). So `recordsPerPage` is gone and `record` is a single
nullable value — an array of at most one is generality with no user. The corpus also shows two
states a naive reading would get wrong: the EMPLOYEE ID box is frequently **blank** on a real oath
(that is normal, and the DEPARTMENT number printed beside it must not be substituted), and a
**signed-but-unwitnessed** oath — employee signature present, date and authorized-official signature
and title and county all empty — is common and meaningful, not an OCR failure. Both are now
`extractionNotes`.

**The page-kind vocabulary comes from the corpus, not from intuition.** `i9.pdf` is decisive: its
page 1 is a Section 2 for one person and page 2 is a Section 1 for a **different** person — loose
sections, out of order — and both are numbered "page 7/8 of 9", so **seven of every nine pages in an
I-9 packet carry no data at all**. The vocabulary is therefore `oath` · `emergency-contact` ·
`i9-section1` · `i9-section2` · `boilerplate` · `unrelated` · `blank`. The last three are kept apart
deliberately: all mean "no data here", but only `unrelated` means something is in the stack that does
not belong (the corpus has a Kronos sick-hours report in the same folder), and only `blank` might
mean the scanner double-fed. `pageFingerprint` folds the CLASSIFICATION as well as the answers, so
two producers that both read "no data" while disagreeing about why have not agreed.

**What this does NOT yet solve — the recommended next slice.** Pairing an I-9 Section 1 with its
Section 2 is a **grouping** problem that sits ABOVE this gate, and the corpus proves it cannot be
positional. The recommendation is three stages rather than one: **classify** every page in the stack
(cheap, and the operator's first checkpoint — "44 pages → 12 oath, 3 EC, 2 §1, 3 §2, 24
boilerplate"), then **group** classified pages into subjects by the name read off each page with an
explicit `orphan-section2` outcome (legacy's `orphanSection2` was this problem), then **extract** per
subject. `ocr/extract-form-page` is stage 3 and already assumes its caller knows the form type;
stages 1 and 2 are what let a caller know it.

**Not built yet:** the `i9` form, whose multi-section structure is its own slice; the production
`ocr.extract` adapter behind the client seam (the contract and store are wired, so it is a real model
call away); and durable storage of admitted extractions. All sit over this gate; none may add a rule
of its own.

### 4.6 Phase-2h as-built — a two-digit year is resolved, not refused (D155)

<!-- roadmap: p2-2h -->

The first live run of the OCR gate over real paper — `detect-test.pdf`, read page by page through
route 2 — reported the stack correctly (4 emergency-contact pages flagged as *not this workflow*, 3
oath pages extracted, 0 refused) and exposed one defect.

Page 5's oath is dated **`11/3/21`**, and `single-oath.pdf` is dated **`4-23-26`**. Two-digit years,
one dash-separated, and both are the normal way these forms are filled in. The coercer refused both
— while the generated brief was simultaneously telling every producer that `M/D/YY` and `M-D-YY` are
expected. **The instruction and the validator contradicted each other**, and on a real batch every
oath date would have landed `unreadable` and gone to a human.

`parseUsOrIsoDate` now accepts `-` as well as `/`, and resolves a two-digit year against **when the
value was observed**: the 2000s reading unless that lands more than a year ahead of the observation,
otherwise the 1900s. So `21`→2021, `26`→2026, `98`→1998. This is a documented rule rather than a
guess, and it is sound for what this system reads — a signature date, hire date, date of birth or
separation date is in the past or at most an appointment starting within the year, never seventy
years early.

The reference is the **observation instant, not `now`**, and it is carried on `CellLocation.readAt`
rather than read from a clock inside the coercer. The intake pipeline passes the run's instant and
the OCR gate passes the submission's own `readAt`, so re-admitting a stored submission years later
resolves its dates exactly as the first admission did. A century that moved under a replay would be
the silent wrong value this rule exists to avoid.

### 4.7 Grouping cannot assume adjacency — measured on raw scanner output (D157)

<!-- roadmap: p2-2h -->

The open question was whether a person's pages arrive together in a real scan. Two genuine scans
answer it, and they answer it **differently** — which is itself the finding.

Provenance first, because it decides what counts as evidence. `detect-test.pdf` carries
`/Creator (VersaLink B7035)` and `Xerox Scan_08052026141856.pdf` carries `/Creator (VersaLink C7020)`
— both raw Xerox MFP output, unbroken. `multiple-oath.pdf` carries `/Producer (macOS Version 26.1)`
and is the assembled one. So the two scans are the ground truth and the tidy file is not.

- **`detect-test.pdf` (7 pages, EC + oath).** A person's pages ARE adjacent: page 1 is an
  emergency-contact form with no partner, then three EC→oath pairs (Tran, Goiset, Provenzano), each
  person's two forms together.
- **`Xerox Scan_08052026141856.pdf` (44 pages, I-9).** A person's pages are NOT adjacent. The first
  four pages are four DIFFERENT people with alternating section types — §2 Casey · §1 Cho · §2
  Cisneros · §1 Chan — not alphabetical, not paired, and no two consecutive pages belonging to one
  person.

**So adjacency is a property of how a particular pile was assembled, not of scanning.** Grouping
must therefore match by the NAME read off each page, across the whole stack, and may use adjacency
only as a tiebreaker between equally good name matches — never as the rule. A design that paired
neighbours would have produced Casey's Section 1 from Cho's page: a real I-9 verification attached
to the wrong person, which is the worst failure this program can produce.

Two properties make the name match workable, both visible in the corpus. An I-9 Section 2 carries
*"Employee Last Name, First Name and Middle Initial from Section 1"* at the top, so both pages of a
pair name the same person independently. And a page whose own name is unreadable — `detect-test.pdf`
page 2 has a sticky note over it — can still be grouped from its partner, which is grouping earning
its keep rather than merely tidying.

An unmatched Section 2 is **flagged, not blocked** (operator, 2026-08-06); legacy's `orphanSection2`
was the same decision, and it backed the row with the roster PPS EID.

### 4.8 Phase-2h as-built — stages 1 and 2 of the scanner pipeline (D158)

<!-- roadmap: p2-2h -->

`src/domain/ocr/stack.ts` lands classification-consumption and grouping;
`cli ocr stack <classified.json> <form-type>` is the operator surface.

**Every page lands in exactly one bucket** — a subject, `unidentified`, `otherForms` or `dataless` —
and `pagesAccounted` must equal `pagesClassified`. That total coverage is the whole point of looking
before extracting: a page belonging to no bucket is a page nobody knows was skipped.

**`personMatchKey` is exact, and deliberately narrow.** Lowercased alphabetic tokens, sorted, with
single letters dropped. Sorted because `Clauldia, Drona A.` (an I-9 §2 header) and `Drona Clauldia` (a §1's
separate boxes) are one person. Initials dropped because a middle initial is written inconsistently
and its absence must not split one person in two. Below two tokens it returns **null** — a surname
alone would group siblings — and such a page is `unidentified` rather than guessed at. There is no
fuzzy scoring: that is exactly where this would start inventing people.

Verified on both real stacks. The 44-page I-9 scan's first four pages group as four separate people;
`detect-test.pdf` reports 3 subjects ready and 4 wrong-type pages for an oath run, and the mirror for
an emergency-contact run, with page 2's sticky-note-covered name surfaced as unidentified rather than
dropped.

**Deferred at D158, and landed with the `i9` form one decision later (§4.10, D160):** the
sectioned-subject case — an I-9 §1 + §2 as one subject — and its orphan outcome. At D158 every form
in the tree was one page per person, so the arm would have been unreachable and untested. It is now
`SubjectCompletenessSchema`'s third arm, `incomplete`
(`src/domain/ocr/stack.ts:89-102`): a person whose pages cover only part of the form is FLAGGED and
never blocked, which is D157's decision and legacy's `orphanSection2` before it — the missing page
is a fact about the paper the operator fed in, not a reason to hide the person who IS there.

### 4.9 Phase-2h as-built — authority schema v11, the durability floor (D159)

<!-- roadmap: p2-2h -->

Everything the intake and OCR pipelines produced was in-memory until here: a manifest and an
admitted extraction survived exactly as long as the process did. Schema **v11** adds
`intake_manifests` and `ocr_extractions`.

Both carry their identifying facts as **columns** beside the record JSON, for the reason v10 gave
`failures` a searchable fingerprint: *"has this file been run before"* and *"has this page already
been read"* are questions an operator asks constantly, and a scan over parsed JSON is not an answer.

`intake_manifests` is **immutable and undeletable** by trigger. A manifest is the rerun authority —
it proves which file and mapping produced which items — and a run has already fanned out against it,
so a rewrite would rewrite history somebody acted on. A rerun creates a new manifest; §5's
`rerunDiff` is what shows the operator the difference.

`ocr_extractions` is UNIQUE on `(source_sha256, source_page, form_type)`: **one page, read once, for
one form.** A second producer reading the same page with a different result is refused by name — a
replacement is a decision a human makes, not a second row that silently doubles a person in the
fan-out. A byte-identical re-read is idempotent, so replaying a submission is safe.

### 4.10 Phase-2h as-built — the i9 is ONE form across two loose sections (D160)

<!-- roadmap: p2-2h -->

The last form lands, and with it the two arms D158 deliberately left unwritten because no form
needed them: a form whose data pages are SECTIONS, and the sectioned subject in grouping.

**A form declares its data-bearing page kinds; `formType === pageKind` was a coincidence of the
one-page forms.** `OcrFormSpec.pageKinds` names them — `["oath"]` for the oath,
`["i9-section1", "i9-section2"]` for the i9 — and the gate's "is this page this form" test runs
against that set, not against string equality with the form type. `i9` itself is deliberately NOT a
page kind: a physical page is a Section 1 or a Section 2, never "an I-9", and a submission claiming
`pageKind: "i9"` fails at the schema. A registry-level seal refuses a page kind claimed by two
forms, because grouping puts each page in exactly one run's buckets.

**The record is UNIFORM across both sections, and the section-absent fields are typed.** Legacy's
prompt already demanded one record shape ("Every record has the SAME fields; which ones are filled
depends on the page kind"); here that is structural. Every submission answers all six fields —
`lastName` · `firstName` · `middleInitial` · `dateOfBirth` · `ssn` · `hireDate` — and a field whose
box lives on the OTHER section (`OcrFieldSpec.onPageKinds`) is answered `not-on-form`, the absence
reason built for exactly this. The gate REFUSES anything else there: a `dateOfBirth` "read" off a
Section 2 page is a value from nowhere (Section 2 has no such box), and `blank`/`illegible` both
claim the box exists. Uniformity also means a misclassified section is held to the same demanded
field set, so classification errors surface as wrong answers rather than as a different rulebook.
Mandatory blocking is per-section for the same reason: a Section 2's `not-on-form` date of birth is
the correct answer, not a gap a human must resolve — while its `illegible` employee name still
blocks.

**The field set and the prompt knowledge are legacy's, with provenance** (`legacy:src/services/ocr/
forms/i9.ts` at `4deabc5a`): the accuracy rule — a single wrong SSN/DOB digit produces NO answer
downstream, indistinguishable from "this person does not work here", so a guess is WORSE than an
admission (live 2026-07-13: a degraded page yielded a confident fabricated `02/28/1972` +
`950-75-2168` and a false "not found"); the observed digit confusions (0/6, 9/4, 8/9, 1/7, 3/5);
whole-name transcription (`Kimi` is not `Kim`, `Torres Perez` is not `Perez`); the §2 name line is
the employee, NEVER the employer's Certification-block name; and List C's Document Number is the
SSN only when the List C document is a Social Security card. Three legacy pieces are deliberately
NOT ported: the `"i9 ssn"` supplemental sheet (no corpus evidence — D154's vocabulary rule; a UCRS
419 classifies `unrelated` and is surfaced by name), the "never round a 2-digit year" note (raw is
verbatim here and D155 resolves the century by documented rule), and the fuzzy Levenshtein pairing
(D158: exact match or a human, because fuzzy scoring is where grouping starts inventing people).

**Grouping gains the sectioned subject: `incomplete`, flagged and never blocked (D157).** An i9
run's expected kinds are the form's two sections; a subject with exactly one page of each is
`complete`, a person with only one section is `incomplete` with `missingKinds` naming the page to
go find — the orphan Section 2 is this arm with `missingKinds: ["i9-section1"]`, legacy's
`orphanSection2` made general. `duplicate` now means a duplicated KIND, and a duplicated section
does not hide a still-missing one: `missingKinds` is carried orthogonally to the enum. The
one-page forms are unchanged by construction (a subject that exists has its only expected kind).
Legacy's §1↔§2 field corroboration — the employer's Section 2 as an independent transcription that
catches confidently-wrong Section 1 reads — needs both extractions in hand and is ref operator-trust evidence
work above this layer; the grouping arm this section lands is what makes those pairs findable.

**Measured live, 2026-08-08, on the whole real 44-page Xerox scan** (route 2: the stack classified
page by page, the grouping and gate run through `cli ocr`). All 44 pages accounted; **19
subjects complete** — every findable §1+§2 pair paired, including one whose halves sit 21 pages
apart (Castillo, §1 p19 + §2 p40) — and **6 incomplete flags** that decompose exactly into the
honest cases: two genuine paper orphans (a §2 with no §1 anywhere; a §1 with no §2), and two people
split by divergent NAME READS — a §2 line the employer abbreviated (`BLAUCKEA, GRENO` for the §1's
`Blauckea, Grera Grere Greri`) and a hard first name two readers spelled one letter apart
(`Metztli`/`Metzti`). The splits are the exact-match design behaving as D158 ratified: both halves
are flagged for a human instead of a fuzzy score inventing the pair. The gate half ran on a real
pair (Casey, §2 p1 + §1 p13): both sections admitted with correct canonicalization (`10/27/2015` →
`2015-10-27`; `919-72-4902` → nine bare digits; `A.` → `A`), each section's off-fields truthfully
`not-on-form`, zero blocking paths, and the off-section probe (a DOB claimed "read" off the §2)
refused by name. **The pass found one prompt gap, fixed in the same slice:** the real §2s mostly
use a LIST A document, leaving List C entirely empty — a case the notes did not pin, so two
producers could split between `blank` and `not-on-form`; the note now says empty List C is
`blank`. **One open observation:** a real §1 (p20) carries a form-filling error on the PAPER — a
date of birth written as `05/14/2015`, the same date as the signature — and the canonical `dob`
schema has no plausibility bound, so it admits. Whether `dob` should range-check is a reviewed
schema decision (the shape is shared by every consumer), left open rather than guessed here.

### 4.11 Phase-2h as-built — route 1's production adapter is transport plus provenance (D161)

<!-- roadmap: p2-2h -->

The first production `ocr.extract` adapter exists: `src/infra/providers/gemini-ocr-extract.ts`,
Gemini, legacy's priority-1 OCR provider. The design constraint is §4.3's, made concrete: the
adapter ADDS NO RULE. It sends the instruction the store task built from the registry, inline with
the page bytes as base64 (the shape legacy proved on this corpus), and what comes back goes through
the one gate. What the adapter owns is exactly two things:

- **Transport.** The API key travels in the `x-goog-api-key` HEADER, never the URL, so no error or
  evidence line can carry it by accident. A remote refusal maps onto the CLOSED reason codes:
  429 → retryable `rate-exhausted` with the provider's own `Retry-After` when named, else the next
  fixed UTC minute boundary (D112's own window semantics, not a guess); 401/403 →
  `adapter-unavailable` (a human fixes keys; retrying cannot); anything else THROWS so admission
  records a durable interruption instead of a verdict. A non-JSON answer is `invalid-response`
  reporting SHAPE only — the body could contain page contents, so no excerpt is ever quoted. One
  invocation is ONE model call; key rotation and the provider fallback chain are the 2h-D pool's
  job, above this adapter.
- **Provenance.** `formType`/`source`/`readAt`/`sourceSha256`/`sourcePage` are STAMPED from the
  request and the injected clock — facts the adapter knows — because the generated skeleton shows
  `local-agent` placeholders a model echoes back. `pageKind` and `record` pass through VERBATIM,
  and a key the model omitted stays omitted so the gate names the gap; the adapter never fills it.

Three supporting changes landed with it. The request envelope carries the WHOLE `ArtifactRef` —
the content-addressed store's `open()` demands the full ref and refuses a mismatched id/sha/size,
so the previous id+sha pair named bytes nobody could actually resolve. `providerModelChain` joined
`src/domain/secrets.ts` (the sole permitted env reader): it resolves the family's `modelsEnv`
chain with the single-model legacy spelling honored, and an empty result is a fact the composition
root judges, never a default. Neither repo's `.env` actually names a chain — legacy's models are
registry knowledge, so a composition root passes the model id explicitly with provenance
(`gemini-3-flash-preview`, legacy `provider-limits.ts` priority-1 tier-1). Usage cost is 0 by
declaration: the keys are the free-tier family and `ocrExtract`'s budget pins
`costLimitUsdMicros: 0`, under which any nonzero measured cost is a breach — a paid deployment
raises the config leaf first. The `provider-capability-boundary` guard's pinned file list now
names the adapter; a new production adapter joins that list deliberately, in the commit that
reviews it.

**Measured live, 2026-08-08:** the real model on the real scan's page 13 (Casey's Section 1),
through the real adapter and the real gate — produced in 14.2 s, classified `i9-section1`, zero
blocking paths, and its `answersFingerprint` came out **byte-identical** to the route-2 reading a
human produced independently earlier the same day (`2ec1504e…`). §4.3's interchangeability claim
held between a person and a production model on real paper.

**Wired (D162, 2026-08-08):** the run executor now builds both capability contexts, and the
worker composition root supplies the ingredients. `RunExecutorDependencies` gained two optional
seams — `providers` (`RunProviderWiring`: adapter registry, `providerAdmissions` repository,
`configSnapshots` repository, admission id factory) and `artifacts` (the kernel writer) — and
`executeTaskNode` refuses a declaring contract with a structured node failure when its seam is
absent, or when the run's RETAINED `configSnapshotId` resolves to no stored snapshot row: the
snapshot is read from authority by the envelope's own id, never re-resolved from current config
(D116's identity, applied to admission). `invokeTask` then mints ONE admitted client per declared
capability per invocation through `createAdmittedProviderClient`, bound to that exact snapshot and
to the invocation's deadline-bounded abort signal, and attaches `ctx.artifacts` only when the
contract declares it. The worker loop forwards both seams verbatim. `composeWorkerRuntime`
composes the writer under the isolation-pinned artifact root and ONE gemini `ocr.extract` adapter
over one key and one model (`OCR_GEMINI_MODEL_ID = "gemini-3-flash-preview"` with provenance,
front-runnable by an operator `OCR_GEMINI_MODELS` chain); an environment with no `GEMINI_API_KEY`
composes an EMPTY registry with a logged warning, so a declaring run is denied
`adapter-unavailable` by admission — loud, durable, never a guessed client. The
`provider-capability-boundary` arms relaxed to explicit allowlists in the same commit: the
executor may mint and type clients, the executor and the composition root may import the
admission module, and every other module stays confined exactly as before. The executor proof is
`tests/unit/run-executor-capability-wiring.test.ts`: all three refusal arms plus the wired arm,
whose task observes the real writer round-trip and whose admission row settles in authority under
the minted id with the run's snapshot identity.

## 5. Intake pipeline: mapped dataset → N inputs, with a pre-run rejection review

<!-- roadmap: p2-2h -->

The mapping (§2) + the parsed rows (§3) + any roster match (§4) compose into **N workflow inputs,
one per valid row**, feeding the run-surface fan-out (the multi-subject `operation` coordinator +
`operation-member` children, ref workflow-model):

```
parse-csv → detected columns ─┐
operator ColumnMapping ────────┼─► coerce+parse each row ─► { valid: WorkflowInput[], rejected: RowReject[] }
(optional) roster match ───────┘                                    │
                                                                    ▼
                                        operator reviews REJECTED before Run  ── nothing launches yet
                                                                    │  (Run enabled only after review)
                                                                    ▼
                                        fan out `valid` as N inputs → operation coordinator + members
```

Before enqueue, validation produces one immutable, strict `IntakePlanManifest`:

```ts
const RejectLocation = {
  rejectId: RowRejectIdSchema,
  sourceRow: z.number().int().positive(),
  code: IntakeErrorCodeSchema,
  reason: z.string().min(1),
};
export const RowRejectSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...RejectLocation, kind: z.literal("unmapped-required"),
                   field: IntakeTargetFieldIdSchema }),
  z.strictObject({ ...RejectLocation, kind: z.literal("cell-coercion"),
                   field: IntakeTargetFieldIdSchema, column: SourceColumnRefSchema,
                   raw: RedactedValueSchema }),
  z.strictObject({ ...RejectLocation, kind: z.literal("field-schema"),
                   field: IntakeTargetFieldIdSchema, column: SourceColumnRefSchema,
                   raw: RedactedValueSchema, issues: z.array(BoundaryIssueSchema).nonempty() }),
  z.strictObject({ ...RejectLocation, kind: z.literal("workflow-schema"),
                   path: WorkflowInputPathSchema, issues: z.array(BoundaryIssueSchema).nonempty() }),
  z.strictObject({ ...RejectLocation, kind: z.literal("duplicate-identity"),
                   itemId: ItemIdSchema, collidingSourceRows: z.array(z.number().int().positive()).min(2) }),
  z.strictObject({ ...RejectLocation, kind: z.literal("cross-field"),
                   paths: z.array(WorkflowInputPathSchema).min(2) }),
]);

// src/domain/intake/manifest.ts:197-235 — as built
export const IntakePlanManifestSchema = z.strictObject({
  version: z.literal(1),
  manifestId: IntakeManifestIdSchema,        // §1.1: the ONE manifest identity
  workflow: WorkflowIdSchema,
  source: z.strictObject({ artifactId: ArtifactIdSchema, sha256: FingerprintSchema,
                           originalName: z.string().min(1) }),
  mappingFingerprint: FingerprintSchema,     // the LAYOUT the decisions were made against
  mappingSnapshotHash: FingerprintSchema,    // the DECISIONS themselves (§2.1)
  intakeProjectionFingerprint: FingerprintSchema,
  workflowContractFingerprint: FingerprintSchema,
  /** The schema every `parsedInput` was produced by, and must be re-read with. */
  canonicalInputSchemaHash: FingerprintSchema,
  createdAt: IsoInstantSchema,
  /** Present exactly when the source is a finalized phone-capture bundle, absent for a
   *  spreadsheet — optional so every pre-D174 manifest still parses (§5.1, D174). */
  capture: z.strictObject({ captureSessionId: CaptureSessionIdSchema,
                            finalizationGeneration: PositiveIntSchema,
                            orderedPhotoSha256: z.array(FingerprintSchema).min(1) }).optional(),
  totals: z.strictObject({ sourceRows: z.number().int().nonnegative(),
                           valid: z.number().int().nonnegative(),
                           rejected: z.number().int().nonnegative(),
                           rejectionEvents: z.number().int().nonnegative(),
                           excluded: z.number().int().nonnegative(),
                           corrected: z.number().int().nonnegative() }),
  /** Exactly one current disposition per source row; totals are derived from this, never guessed
   * from the event arrays. */
  sourceRowDispositions: z.array(z.strictObject({
    sourceRow: z.number().int().positive(),
    disposition: z.enum(["valid", "rejected", "excluded"]),
    itemId: ItemIdSchema.optional(),
    currentRejectIds: z.array(RowRejectIdSchema),
  })),
  validRows: z.array(z.strictObject({ sourceRow: z.number().int().positive(),
                                     itemId: ItemIdSchema, inputHash: Sha256Schema,
                                     parsedInput: CanonicalJsonValueSchema })),
  rejectedRows: z.array(RowRejectSchema),
  /** Corrections never rewrite the source artifact. The parsed value is revalidated through the
   * canonical field and full workflow schemas before it appears in validRows. */
  corrections: z.array(z.strictObject({
    sourceRow: z.number().int().positive(),
    field: IntakeTargetFieldIdSchema,
    original: RedactedValueSchema,
    correctedValue: CanonicalJsonValueSchema,
    correctedAt: IsoInstantSchema,
  })),
  exclusions: z.array(z.strictObject({ sourceRow: z.number().int().positive(),
                                      reason: z.string().min(1), operatorConfirmedAt: IsoInstantSchema })),
});
```

`parsedInput` is stored under the generic canonical-JSON envelope only because manifests cover many
workflows. No caller casts or reads it as a workflow input directly: manifest load, rerun, and
enqueue resolve the named descriptor and parse each value through that descriptor's exact current
transform-free `canonicalInput` schema (D62), never its ingress parser. The stored workflow
fingerprint controls whether that is a same-contract replay or a
visible migration/diff. A parse failure quarantines the manifest; it never reaches a task bind.

The manifest is the rerun/explanation authority: it proves which file and mapping were used, which
rows became which stable items, which cells were corrected without rewriting the source, which rows
were rejected or explicitly excluded, and the exact validated input hashes. Invariants verify that
every source row is represented exactly once in the final valid/rejected/excluded disposition and every
correction points to that row's source value. `rejectedRows` and `rejectionEvents` are immutable
validation history and may overlap a later corrected valid row; consequently the manifest stores a
separate current disposition per source row (`valid|rejected|excluded`) and does not infer it by
adding historical event arrays. Schema refinement requires `itemId` only for `valid`, at least one
current reject id only for `rejected`, neither for `excluded`, unique source-row coverage from
`1..totals.sourceRows`, exact derived totals, and `valid > 0` before enqueue. “Rerun with existing data” references this manifest
and immutable artifact; it revalidates against the current workflow fingerprint and shows a diff
before creating a new run. It never silently reparses a changed file or applies a newer mapping.

**The pre-run rejection review is mandatory—nothing silently half-launches (charter fail-loud).** `Run` is
disabled until (a) every required canonical field is bound and (b) the operator has seen the reject
list. `RowRejectSchema` is a strict discriminated union whose variants are `unmapped-required`,
`cell-coercion`, `field-schema`, `workflow-schema`, `duplicate-identity`, and `cross-field`; every
variant carries source row, canonical field/path when applicable, source column id/header,
redacted raw value, stable error code, and legible reason. The operator either
**fixes the cell in the intake grid** (re-coerces that row live) or **excludes it** — an unresolved
rejection is never silently dropped into or out of the run. Only the `valid` set fans out; a partial
file may run only after every non-valid row has a durable rejection or explicit exclusion in the
manifest. Coordinator, all member inputs, stable ids, dependency rows, and the intake manifest are
inserted atomically; a single invalid input/constraint failure creates none of them.

This is the structural version of "the parsed+mapped dataset becomes N workflow inputs": each
assembled input has passed the full strict workflow schema, so the fan-out cannot enqueue a member
the workflow input schema then rejects. The coordinator evidence receipt displays source/valid/
excluded/enqueued counts plus rejection-event and correction history and links to the manifest; `done` can never imply every source row
ran when exclusions exist.

### 5.0 Phase-2h as-built — validation, rejection and the manifest (D148)

<!-- roadmap: p2-2h -->

`src/domain/intake/validate.ts` is **format-agnostic**: it takes an already-parsed cell matrix plus
the detected columns, the confirmed bindings and the projection, and returns exactly one disposition
per source row. The extraction store owns turning a `.csv`/`.xlsx`/PDF into that matrix, so the
pipeline's invariants can be proved without a file on disk.

**A `CellCoercionError` is converted; nothing else is.** `attemptCoercion` returns a discriminated
value — the `catch` classifies and returns, it sets no flag and supplies no default — so a refused
cell becomes a durable, located `cell-coercion` rejection while a fault in a coercer still reaches
the top. That shape is what keeps the `fail-loud-catch-default` ratchet meaningful here rather than
waived.

**Rejection variants, and the one judgement call.** `unmapped-required` fires per row when a required
target has neither a binding nor a run constant, so the manifest's coverage stays total even when
nothing can validate. A blank cell for an OPTIONAL target is genuine absence, not a rejection; for a
required one it is `cell-coercion` ("is blank"). A whole-input parse failure with a non-empty issue
path is `workflow-schema`. A **root-level** issue is a refinement over the combination and becomes
`cross-field` naming every bound target — truthful ("one of these together is wrong") where
inventing the specific pair zod never reported would be a guess dressed as a diagnosis.
`duplicate-identity` rejects **both** colliding rows: choosing a winner would silently drop a person
the operator listed.

**The manifest stores current disposition and derives every total from it.** `rejectedRows` is
immutable history, so a corrected row keeps its rejection event and loses only its CURRENT reject
ids; totals therefore cannot be accumulated alongside the truth, they are computed from it and the
schema refuses any manifest where the two disagree. That is §7 vector #12 made mechanical. A reject
id is DERIVED from `(source digest, row, kind, subject)`, so re-validating a corrected file is
idempotent instead of growing a duplicate event per pass. `buildIntakeManifest` throws rather than
emitting a manifest in which some row is neither valid, rejected nor excluded.

**Two refinements on §5's text.** The manifest pins `canonicalInputSchemaHash` once, so a reader
re-parsing `parsedInput` proves it is using the schema the value was produced by rather than
inferring it from `workflowContractFingerprint` alone (D62/D110's binding, applied here). And
`enqueueReadiness` separates `unresolved-rejections` from `no-valid-rows`: a valid zero-row intake
stays blocked and inspectable rather than reporting a no-op success.

`rerunDiff` compares an immutable manifest against current reality across five axes — source
artifact, mapping snapshot, intake projection, workflow contract and canonical-input schema — and a
"rerun with existing data" must show the diff before creating a run (§7 vector #11).

### 5.1 Retired — mobile/phone document Capture Mode (D294, 2026-08-31)

The operator has retired this product. No intake source, workflow binding, page, QR flow, tunnel,
operator panel, route, or durable capture-mode authority remains a planned or supported part of the
rebuild. Its historical migration rows remain readable only as migration history; do not revive their
schemas, records, or route contracts for new work. Diagnostic screenshot bundles, Receipt Capture
tiles, and frozen Archive evidence are distinct evidence authority and remain in scope.

The extensive D167/D174 design and as-built notes formerly below are superseded by this retirement;
Git history retains their provenance. A future acquisition feature requires a new decision and a new
design, rather than reactivating this retired implementation.

> **Scope trim (D79d, operator 2026-07-24) — read before implementing.** Phone capture is
> **rarely used**: most documents arrive as scanned PDFs. So this section's durability obligations
> are cut to the two that matter, and the rest is explicitly not built:
> **KEEP** — durable capture sessions (an open session survives a dashboard restart) and **one
> durable finalize outbox** (bundle → register → enqueue either succeeds visibly or fails visibly;
> it can never return success and silently lose the handoff, which is the actual recorded failure).
> **CUT** — the restart-between-every-state scenario matrix. Proving restart recovery from each of
> six session states, for the lowest-stakes subsystem in the program, is ceremony. Two crash points
> are covered: restart with an **open** session, and restart **mid-finalize**.
> This trim touches test surface only; the schemas and the outbox contract below are unchanged.

Capture is an input-acquisition service, not a workflow and not an in-memory callback. Its strict
SQLite authority records are:

```ts
export const CaptureSessionSchema = z.strictObject({
  sessionId: CaptureSessionIdSchema,
  tokenDigest: Sha256Schema,                 // raw phone token is never logged/projected
  workflow: WorkflowIdSchema,
  formType: OcrFormTypeSchema.optional(),
  contextHint: z.string().max(200).optional(),
  state: z.enum(["open", "finalizing", "finalized", "failed", "discarded", "expired"]),
  version: z.number().int().positive(),
  createdAt: IsoInstantSchema,
  connectedAt: IsoInstantSchema.optional(),
  expiresAt: IsoInstantSchema,
  photoRefs: z.array(z.strictObject({
    photoId: CapturePhotoIdSchema,
    artifact: ArtifactRefSchema,             // immutable converted JPEG/PNG bytes + digest
    ordinal: z.number().int().nonnegative(),
    originalMediaType: MediaTypeSchema,
  })),
  finalArtifact: ArtifactRefSchema.optional(),
  handoff: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("pending") }),
    z.strictObject({ kind: z.literal("enqueued"), runId: RunIdSchema,
                     intakePlanId: IntakePlanIdSchema }),
    z.strictObject({ kind: z.literal("failed"), failureId: FailureIdSchema }),
  ]),
});

/** D67 command-family arm; each payload is strict and commandId/requestedAt/reason come from doc
 * 03's CommandEnvelope. Upload bytes are accepted into a temporary bounded request stream and
 * become an ArtifactRef before this authority mutation commits. */
export type CaptureCommandRequest = CommandEnvelope & (
  | { type: "capture-upload" | "capture-replace";
      target: { sessionId: CaptureSessionId; expectedVersion: PositiveInt };
      payload: CapturePhotoMutationPayload }
  | { type: "capture-reorder";
      target: { sessionId: CaptureSessionId; expectedVersion: PositiveInt };
      payload: { orderedPhotoIds: readonly CapturePhotoId[] } }
  | { type: "capture-delete";
      target: { sessionId: CaptureSessionId; expectedVersion: PositiveInt };
      payload: { photoId: CapturePhotoId } }
  | { type: "capture-finalize" | "capture-retry-finalize" | "capture-discard";
      target: { sessionId: CaptureSessionId; expectedVersion: PositiveInt }; payload?: never }
);
```

- **Every mutation is version-stamped and idempotent.** Upload/replace/reorder/delete/finalize/
  discard takes a command id plus the observed session version for audit. Duplicate phone retries
  return the prior result; a serialized transaction validates the requested refs and state against
  current authority, rejecting an inapplicable command without treating version drift alone as a
  CAS conflict. These are ref dashboard-surfaces D67 `CaptureCommandRequest` arms, not route-local mutations. Only
  `finalized|discarded|expired` are terminal and never reopen; `failed` is a durable recoverable
  state whose Retry Finalize command idempotently creates the next stable finalization generation/
  outbox without changing photo identity/order.
- **Photos are immutable refs.** HEIC conversion happens before acceptance; the server validates
  decoded image type/dimensions/size, writes through the content-addressed artifact writer, and
  records only refs/order. Replace changes the ref; it never overwrites bytes. Empty, corrupt,
  oversized, duplicate, and conversion-failure scenarios are explicit.
- **Finalize is an outbox, not fire-and-forget.** The finalize command atomically sets
  `state:"finalizing"` and inserts one stable-keyed bundle/handoff outbox. A serialized projector
  builds temp PDF → validates page count/digest → content-addressed atomic publish, then one SQLite
  transaction records `finalArtifact`, creates the immutable intake/OCR manifest and downstream run,
  marks the outbox done, and sets `finalized`. Crash at every boundary replays the same outbox. The
  phone says “Sent” only after polling/receiving `finalized`; a failure is `failed` with Retry
  Finalize/Discard—not silently converted to `discarded`.
- **Restart and expiry are authoritative.** Open/finalizing/failed sessions reload after dashboard
  restart. The Clock drives the 15-minute pre-connect and 60-minute active idle budgets; expiry is a
  durable transition and notification. Artifact retention distinguishes active evidence from
  expired/discarded staging, with cleanup only after the recorded retention boundary.
- **The handoff uses the same intake proof.** The bundled PDF gets a `FileRef`, source digest,
  capture-session id, ordered photo digests, and form/workflow binding in its manifest. The
  downstream descriptor parses it like any upload; no special `pdfPath` or callback bypass exists.
- **Network scope is explicit.** The loopback dashboard starts no public listener by default. When
  the operator starts capture, a short-lived ingress/tunnel may serve only the phone asset and
  token-scoped manifest/upload/replace/reorder/delete/finalize/status routes. Start/list/discard,
  queue, files, settings, evidence, and commands remain loopback-only (ref operator-trust §7).

Mandatory scenarios cover restart with an open session and restart mid-finalize, plus duplicate/
reordered phone requests, expired token, HEIC conversion, corrupt/empty image, bundle failure/retry,
wrong form/workflow binding, and attempts to reach a non-capture route through the phone origin.
The durable finalize-outbox fixture covers the publish/enqueue boundary without a restart-at-every-
state matrix. The dashboard shows session state, photo count/order, bundle digest/page count,
handoff run, expiry, and structured failure.

**As-built (D167, 2026-08-08) — the durable core landed; the phone surface is 2i.**
`CaptureSessionSchema` and `CaptureFinalizationOutboxSchema` land in `src/domain/capture.ts` as
sketched (tokenDigest only, contiguous ordinals, the handoff union, and a finalization
GENERATION — retry-finalize mints generation+1 over the SAME photo set); `capture_sessions` and
`capture_finalization_outboxes` became TYPED repositories over the v1 shells (version-CAS session
updates, `listActive` for restart reload, stable-key lookup and an idempotent `pending → done|
failed` settle on the outbox) while `capture_photo_order` stays opaque until 2i's history view
needs it. All seven command arms ACTIVATED in the kernel: mutations validate against CURRENT
state (version drift alone is never a CAS conflict), content-level repeats are no-ops, a
finalize from `open` atomically moves the session to `finalizing` and inserts ONE stable-keyed
outbox (`getByStableKey` is how a duplicate converges), and discard is refused mid-finalize. The
photo payload carries the WHOLE `ArtifactRef` (D161's rule — the sketched id+fingerprint pair
named bytes nobody could resolve). The finalize projector
(`src/infra/capture/finalize-projector.ts`) bundles through an INJECTED deterministic bundler,
publishes content-addressed, then ONE transaction runs the handoff enqueue seam and records
final artifact + outbox done + session finalized — a handoff throw rolls the whole settlement
back and lands durable `failed` on session AND outbox together. The photos→PDF library and the
intake-manifest/run enqueue wiring are deliberately seams: both belong to 2i's capture surface,
and the durability protocol is what this slice proves. Fixtures pin the exit criterion's core
(`tests/unit/capture-durability.test.ts`): an open session survives a restart, restart
mid-finalize replays to ONE artifact and ONE handoff, duplicate/reordered requests never
duplicate photos, and a failed handoff retries into generation 2 with exactly one final handoff.
The `capture-durability-and-scope` guard STAYS PLANNED until the phone-origin route enumeration
exists — half a guard would claim an invariant nothing enforces.

**As-built (D174, 2026-08-09) — the phone surface, the bundler, and the handoff.** 2i-F closes both
of D167's seams and adds the scope half the guard was waiting for.

**The token is a credential, so it never appears in a URL the server sees.** `CaptureTokenSchema` is
32 CSPRNG bytes as base64url (not a UUID — six fixed version/variant bits are the wrong shape for a
bearer secret). It rides the QR payload's **URL FRAGMENT** (`/capture.html#t=<token>`), which no
browser transmits and no proxy or access log can record, and reaches the API in the
`X-Capture-Token` **header** — never a path segment, never a query value (ref clock-config-secrets bans secret-bearing
URLs). Only `sha256("hrauto:capture-token:v1\0" + token)` is durable, and `captureSessions.
findByTokenDigest` is how a token becomes a session. Because the phone asset URL carries no token,
the ingress allowlist is a fixed set of paths with nothing interpolated into it.

**Enumeration is fail-closed and has exactly one answer.** `resolveToken` produces the SAME
`unknown-session` refusal — same status, same sentence — for a malformed token, an unknown digest,
an expired session, and a discarded one. A phone on a public origin that could tell "no such
session" from "not yours" is an existence oracle. Every OTHER refusal names itself
(`unsupported-media-type`, `empty-upload`, `upload-too-large`, `invalid-state`, `unknown-photo`),
because by then the caller has PROVEN it holds the session's token and a named reason is what tells
it what to do next.

**The closed route union is declared once and derived twice.** `src/domain/capture-surface.ts`'s
`CAPTURE_PHONE_ROUTES` is ref operator-trust §7's exception written down: session read, upload, photo read-back,
replace, delete, reorder, finalize, retry-finalize, discard. The BFF's registration and the
ingress allowlist both derive from it, and a request arriving on the configured ingress **Host** is
refused with a status and body **byte-identical to an unrouted path** — so the ingress cannot be
used to enumerate what the operator's dashboard serves. A `:param` matches exactly one segment, so
no path walks out of the prefix. The phone's own page is a SEPARATE Vite entry whose asset closure
comes from the build manifest; the operator SPA is never served over the ingress.

**Ingress resolution is a named configuration result, never a fallback.** `disabled` refuses
`ingress-disabled`; `forwarded` resolves to its explicit HTTPS URL; `on-demand-ngrok` refuses
`ingress-credential-missing` without a credential and **`ingress-not-built` with one** — the
on-demand tunnel launcher does not exist in this repository, and quietly serving a loopback QR
would scan perfectly and then fail on the phone with a network error that explains nothing. The
session stamps `{mode, originDigest}` — routing config never becomes authority — through an
**optional** leaf, so every row written before D174 still parses (D133: read forward, never
back-filled).

**Expiry is a durable transition and the active budget is set once.** A session past `expiresAt` is
written to `expired` before it is refused, so a restart cannot re-open a window the clock closed;
only `open` sessions expire, because a `finalizing` one is mid-flight and its outbox outlives any
clock. `preConnectTtlMs` runs from creation and `activeIdleTtlMs` from the phone's FIRST touch,
which is also the only moment `connectedAt` is stamped — a sliding budget would make every status
poll a write, which is a mutation wearing a read's clothes.

**The bundler is a deterministic, dependency-free PDF writer.** `src/infra/capture/pdf-bundler.ts`
reads each ordered photograph through the content-addressed writer, **re-verifies its digest and
length against the ref**, and embeds the bytes with no re-encode: JPEG through `/DCTDecode`, PNG
through `/FlateDecode` with `/Predictor 15` (PNG's own row filtering IS PDF predictor 15). It
refuses BY NAME what `DCTDecode` cannot decode or what would need real decoding — progressive JPEG,
12-bit precision, palette / alpha / 16-bit / interlaced PNG, a `tRNS` chunk — rather than shipping a
page that renders blank or loses transparency. An Adobe APP14 CMYK JPEG gets `/Decode [1 0 1 0 1 0
1 0]`, without which the page renders as its own photo-negative (verified visually, 2026-08-09).
There is no `/CreationDate`, no versioned `/Producer`, and `/ID` is folded from the ordered photo
digests, so the same ordered set produces byte-identical output forever — which is exactly what
makes D167's restart-mid-finalize convergence-by-digest true rather than hoped for.

**The handoff's identities are DERIVED, because the seam promised they would be.** D167 wrote that
the enqueue is "idempotent by the outbox's stable key — a replay returns the SAME identities". That
is unachievable with `ids.uuid()`, which returns something different on every call, so the manifest
id and the run id are `deriveStableUuid`d from `outbox.stableKey`. Same bundle, same generation,
same ids, on the first attempt and the fifth.

**The bundle's manifest is a real `IntakePlanManifest`, extended rather than imitated.** A capture
handoff produces one row in `intake_manifests`: `source` is the bundle (artifact id, digest, and a
name that states its ORIGIN — `capture-<sessionId>-g<generation>.pdf` — rather than pretending to be
a filename somebody typed), `sourceRows` is 1, and the three fingerprints are honest for a document
source: `intakeProjectionFingerprint` is the capture binding's declared identity,
`mappingSnapshotHash` folds the only two decisions a capture operator makes (workflow, form type)
plus that binding, and `mappingFingerprint` is the SOURCE's identity — the bundle digest and the
ordered photo digests. §5.1's capture-only facts (session id, ordered photo digests, generation)
live in a new **optional** `capture` block, which is also what makes "this manifest came from a
photograph" a fact rather than an inference; a manifest carrying it is refined to exactly one source
row with no corrections and no exclusions, because a bundle has no cells to correct and no rows to
exclude. `fanOutQueuedRuns` moved to `src/core/run-fan-out.ts` with its one command-shaped
dependency — how to refuse — as a callback, so capture is a THIRD caller of D171's one fan-out
rather than a copy of it, and the run it inserts is `single`/`interactive` (the operator is standing
there holding the phone) and never `dryRun`.

**No workflow can receive a handoff yet, and that is the honest state.** The bundle →
canonical-input step is a DECLARED, fingerprinted property of a workflow
(`defineCaptureIntakeBinding`, registered off the server module exactly as an intake projection is),
and `captureIntakeRegistry` refuses a hand-built binding or one over a COPY of the descriptor's
input schema. `person-lookup` is identified by an employee id or a name and `separations` by a
Kuali document number plus workflow constants; neither is derivable from a photograph without an
OCR-backed workflow that does not exist. So `CAPTURE_INTAKE_BINDINGS` is empty and the handoff
**refuses by name** — the same shape `INTAKE_PROJECTIONS` had between D170 and D172, and for the
same reason: an invented binding would put a plausible-but-wrong canonical input into a real run.
The refusal is not a dead end but the designed failure path: it throws inside the settlement
transaction, so session and outbox land durable `failed` together and the phone shows Retry Finalize
beside the reason. Fixtures prove the whole success path over a test workflow that declares one.

**A capture handoff failure records its OWN reason, because its `failureId` can never resolve.**
D167's projector minted a `failureId` and wrote no `failures` row anywhere — correctly, since a
`FailureRecord` binds a run and this failure happens before one exists — so the service's lookup of
that id could never succeed and fell through to a generic sentence. The projector's real message
(the one naming the missing binding) was returned in its in-memory report and thrown away, which is
the banned swallowed-fallback pattern sitting on this slice's headline path. `CaptureHandoff`'s
`failed` arm now carries an **optional** `message` (optional per D133; the `failureId` beside it is
a correlation id, not a reference), the projector writes the caught sentence onto the handoff it
already builds, and a stored failure with no reason makes the read **throw by name** rather than
substituting prose. The operator holding the phone is the person choosing between Retry Finalize and
Discard, and "something went wrong" decides nothing for them.

**Two residuals, recorded rather than papered over.** (1) A run the handoff enqueues emits **no
`run.queued` span**, because spans are emitted by the command service and this enqueue happens
inside the finalize projector — so a capture-started run would not appear on the dashboard's queue.
It is unreachable today (no workflow declares a binding) and the fixture asserting
`CAPTURE_INTAKE_BINDINGS` is empty is deliberately the thing that will fail the day one does, which
is the moment this must be closed. (2) `inspectSecret` returning `unknown` — a broken ngrok config
rather than a missing one — is read as "not present", so the refusal says
`ingress-credential-missing` when the honest diagnosis is "could not be read". Fail-closed in
direction, imprecise in wording; left as-is because the remediation it prints is correct either way.

**The surface is built; the BYTES have no delivery path (D189).** `CAPTURE_PHONE_ASSET_ENTRY` is
`/capture.html` (`src/domain/capture-surface.ts:83`) and the bundle behind it is real
(`src/dashboard/phone/`), but the production BFF **serves no frontend bytes at all** — there is no
static handler, so the one asset URL the QR points at 404s outside the vite dev server
(`src/core/runtime-composition.ts:140` names the gap; ref frontend-backend-integration §6.9 owns
it). Nothing about this section's model is wrong and nothing here needs rebuilding: the token, the
routes, the refusals and the outbox are all correct and tested, and a phone still cannot load the
page in production. Deferred on D189's own argument — those bytes would ride the one
internet-exposed path behind the Host gate, and the tunnel launcher is unbuilt anyway. Owner:
D294's retired Capture Mode record in doc 04, not this doc.

**`capture-durability-and-scope` is ACTIVE.** It enforces the closed union in both directions, the
`:param` segment bound, the byte-identical ingress refusal (driven through a real Hono app with a
no-ingress negative control), the token never becoming durable or wire state, the allowlist of who
may write `capture_sessions`, and that ONLY the finalize projector may declare a session
`finalized` — so nothing can report "Sent" without the outbox having settled. Every arm runs against
a violating fixture.

---

### 5.2 Phase-2i as-built — the enqueue: readiness, the manifest mint, the fan-out (D171)

<!-- roadmap: p2-2i -->

`enqueue-intake-manifest` is the sixth intake arm and the irreversible one: it turns a reviewed
mapping into N real HR runs. It activates here (2i-E2) over D170's durable session, and everything
below is normative.

**The command targets the SESSION.** Its original placeholder target named an operator-supplied
`intakeManifestId`, before any producer served one, so D171 amended it (D161/D167's rule: no producer
ever sent the old shape) to `{intakeSessionId, expectedVersion}`, the same target its five siblings
carry, plus an explicit `payload: {dryRun}`. As built after the 2026-08-25 Track F prerequisite, the
upload route has already reserved the manifest identity on that session; enqueue consumes it and
never accepts a caller claim or mints a replacement. `dryRun` is required rather than defaulted,
exactly as `StartPlanIngressSchema` requires it: a fan-out that silently chose one is a fan-out that
silently chose whether to touch a real system.

**It is the ONE intake arm that CASes.** The five mapping arms validate current authority and retain
the observed version for audit; this one refuses on version drift, because if anything moved since
the operator read the reject list they are enqueueing a plan they never saw. The other gates, in
order and each naming exactly what blocks: the session must exist; an already-`enqueued` session is
refused naming its manifest (`a manifest fans out exactly once`); a `mapping` or `discarded` session
is refused with §5's mandatory review named; the session must retain a source file name; the
session must retain its reserved manifest identity; the workflow must declare an intake projection
and a registered descriptor; and `dryRun` on a workflow with no dry-run boundary is
`policy-refused` — the same `dry-run-unsupported` rule `planStart` applies, evaluated through the
same `supportsDryRun`. A pre-reservation row remains readable but enqueue refuses it naming the
session; a fresh UUID fallback would make the session wire's reserved identity and committed
manifest different identities. This authority/API work is only the prerequisite for fidelity
finding IN125: IN125 remains OPEN until the Manifest UI renders `reservedManifestId`, so this commit
does not claim the operator can inspect that identity yet.

**Readiness is judged on the manifest that would be written.** `deriveIntakeEnqueuePlan`
(`src/domain/intake/enqueue.ts`) re-runs `validateIntakeRows`, builds the manifest and returns it
beside `enqueueReadiness(manifest)`, so there is no second count of "how many rows are still
rejected" that could disagree with the row the operator would be handed. The pass runs against the
session's RETAINED `readAt`, so a two-digit year resolves exactly as it did at review. A refusal
carries the readiness `message`, its `reason`, and the unresolved source rows.

**A correction's `original` is read from the source, never carried.** The session retains only the
corrected value, so the manifest's `IntakeCorrection.original` is looked up in the bound column of
the re-derived row and redacted through the canonical field's own declared
`(classification, transform)`. A correction whose field is unbound, whose column is absent, or whose
row is beyond the file THROWS: each means the session and its layout have become mutually
inconsistent, which no command sequence can produce, and recording a plausible blank would put a lie
in an immutable manifest.

**`mappingSnapshotHash` is the identity of the DECISIONS**, where `mappingFingerprint` is the
identity of the LAYOUT. `deriveMappingSnapshotHash` folds the workflow, sheet, settled header row,
layout fingerprint, confirmed bindings and run constants, sorted by target field id so two sessions
that reached the same mapping in a different order hash the same. It deliberately excludes
`confirmedAt` (a mapping is what it maps, not when it was clicked — folding the instant would make
`rerunDiff` report a change for a re-confirmed identical binding) and corrections/exclusions (the
manifest records those in full in their own arrays; §7 #11 asks whether the run was planned the same
WAY).

**Rerun membership vectors are a set difference over stable `itemId`; changed input is separate.**
`removed` carries the prior manifest's exact valid-row facts; `added` carries the current plan's
re-derived valid-row facts. `sourceRow` and `inputHash` are evidence about an item, not its identity:
a mapping change that preserves `itemId` leaves both membership vectors empty, while one that changes
`itemId` reports the old row as removed and the new row as added. A stable item whose canonical input
changes is never mislabeled `same-plan`: `changedInputs` carries only its `itemId` and safe
`beforeInputHash`/`afterInputHash` fingerprints, not the canonical input values. The current side is
revalidated from the immutable artifact and the session's durable
bindings/constants/corrections/exclusions. A validated or enqueued session
uses its retained validation `readAt`; a mapping session has no validation instant, so it uses its
durable `updatedAt`, the instant that exact decision snapshot committed. It never reads the current
clock or substitutes rows. Once a prior manifest exists, a missing current layout or prior/current
valid-row fact refuses by name instead of hiding the rerun view.

**The manifest must name its file, so the session retains one.** `source.originalName` is required
by the D159 schema and a content-addressed artifact has a digest, not a name — so
`POST /api/v1/intake/files` requires a `filename` query parameter and the session retains it as
`sourceName`. The leaf is OPTIONAL on the session record and required at the route: a row minted
before it existed must still parse (D133 — a stored record is read forward, never back-filled), and
enqueue refuses such a session by name rather than inventing a name the manifest would claim forever.

**The manifest identity is reserved at upload, not enqueue.** A new session stores
`reservedManifestId` in the same authority write that creates its immutable source binding, and the
session wire serves it before any mapping decision or run exists. That makes the identity available
to the API; the Manifest UI does not render it yet, so IN125 remains open. `IntakeSessionSchema`
keeps terminal `intakeManifestId` exclusive to `enqueued` and additionally requires it to equal the
reservation whenever the latter is present. The repository requires the reservation on create and
holds its exact optional value immutable on update: an older absent row can read and advance as
absent, but ordinary update cannot back-fill it. Enqueue passes the reservation into
`deriveIntakeEnqueuePlan`; `dependencies.ids.uuid()` is not an alternative path.

The wire keeps reservation and terminal authority separate. Before enqueue it serves only
`reservedManifestId`; after enqueue it additionally requires the committed `intakeManifestId` and
an immutable projection loaded by that exact id: all five plan fingerprints, creation instant,
derived totals, every source-row disposition and every valid row. Its field schemas and the shared
totals/disposition/row-coverage/unique-item refinement are owned beside the durable manifest; the
wire remains a reviewed redaction surface rather than exposing the manifest's additional free-text
and open-JSON leaves. The strict session wire refuses a terminal projection before enqueue, an
enqueued identity with no manifest, or any disagreement among reserved, committed,
projected-manifest and projected-rerun ids.

**The dashboard renders those as named stages, never one optimistic card.** The Manifest tab says
`reserved plan id` while the session is still preflight, explicitly stating that it is not committed;
only the enqueued arm renders the terminal id, all five fingerprints, derived totals and total
source-row disposition table. The Rerun diff tab names a no-prior-manifest empty state, or renders
changed axes, membership additions/removals and hash-only changed inputs. It does not synthesize an
item label for membership rows: the served `ValidRow` carries identity and input evidence, not an
operator label. Dense values keep their short scan form, while the full prior manifest id, hashes and
parsed input remain keyboard/touch reachable through the dashboard's Popover detail vocabulary.
Manifest dispositions, added/removed membership and changed-input evidence render in exact local
10-row pages; this is a surface bound, not D9's proposed shared virtualization primitive. IN144's
closing rerun copy/icon remains OPEN and is not part of Track F's autonomous IN123–IN143 row.
(Track F IN123–IN143, 2026-08-25.)

**One fan-out path.** `fanOutQueuedRuns` in the command kernel is the ONE place N queued runs are
inserted; `start-run` and this arm reach it with different plans and identical obligations — the
descriptor's enqueue policy is evaluated against live authority per item, `supersede-active`
supersedes, a `reject-active` collision refuses the WHOLE command, and a proposed run id that
already exists is a fault rather than an adoption.

**What an intake run's envelope carries.** `shape: "single"` and `priority: "bulk"` are server
stamps, not caller claims. Per row: a fresh `runId`, the row's `itemId` from the manifest, a
`traceId` derived from the descriptor code, the descriptor's current version/fingerprint, every
browser system resolved to `prod` through the same `resolveInstances` the planner uses,
`ingressSchemaHash` from the descriptor's input schema, and `input.parsed` bound to
`canonicalInputSchemaHash` after re-reading the manifest's stored `parsedInput` through the
descriptor's CURRENT canonical schema (D62 — never its ingress parser); a value that fails that
parse throws naming the source row and enqueues nothing. `input.raw` is the manifest's own stored
`parsedInput`: that value IS what intake submitted, and `validRows[].inputHash` pins its bytes.

**The config identity is injected and PROVED.** `start-run` copies it from the start plan and
`retry` from the run it retries; an intake fan-out has neither, so `CommandKernelDependencies`
carries a `configIdentity` supplied by the composition root — the same resolved fingerprint and
stored snapshot the start-plan service uses — and the arm reads the `config_snapshots` row back and
compares its fingerprint before stamping a single envelope. A caller-claimed identity would be an
unverified value; an unproved one would leave a run naming a snapshot nobody can read back.

**Everything commits together.** The reserved-id manifest insert, every run insert, and the session
CAS to `enqueued` (with its required `intakeManifestId` equal to `reservedManifestId`) run in the ONE
outer authority transaction, so a refusal on the last row of a file leaves no manifest, no run, no
state change and no generation advance. Partial fan-out is unrepresentable rather than merely
avoided.

**Deviation from §5's coordinator sentence, recorded.** §5 describes the fan-out as an `operation`
coordinator plus `operation-member` children. Nothing in the runtime mints an `operation` run — the
shape exists only in the queue projection's rendering, and doc 00 §Size model + delivery tiers assigns
`operation-member` fan-out to the oath-signature / emergency-contact tier — so intake enqueues N
independent `single` runs and the MANIFEST is what joins them.
That is the artefact §5 already relies on to make "42 rows ran" checkable, and its `validRows[].itemId`
joins to runs through `(workflow, itemId)`. Inventing a coordinator with no descriptor behind it
would be the fabrication this program bans; the coordinator receipt §5 describes lands with the
first workflow that genuinely needs one.

**The runs reach the queue like any others.** The dashboard command service emits one `run.queued`
span per enqueued run, joined to the manifest by `itemId` (unique in a file by
`duplicate-identity`), titled with the workflow's OWN `presentation.title` over the manifest's
stored `parsedInput`. A count mismatch between valid rows and reported runs throws rather than
filing a partial fan-out.

**`rerunDiff` is served, not just computable.** The session wire carries an optional `rerun`
`{intakeManifestId, createdAt, totals, diff}` on the upload response and on
`GET /api/v1/intake/:sessionId`, since both render from one `buildWire`. An enqueued session resolves
the exact `intakeManifestId` it committed even when newer same-source manifests exist. An open
session may resolve only the unique latest same-workflow manifest at or before that session's
creation; its reserved identity and later manifests are ineligible. Equal latest creation times
refuse, naming the session, timestamp and candidate manifest ids rather than selecting by repository
order. The source digest is the session's own,
so the `source-artifact` axis is equal by construction and the diff reports mapping, projection,
contract, canonical-schema, membership and changed-input facts.

This is the server/wire contract only. The existing intake UI continues to consume its already-built
manifest facts; displaying `changedInputs` and the newly served projection fingerprints belongs to
the next `/ui` unit, so this section makes no visual-completion claim for them.

**One more identity, closed.** `intakeProjectionRegistry` now refuses a module whose projection was
built over a COPY of its descriptor's input schema rather than the schema object itself. Everything
above rests on that identity: validation parses each assembled row through the PROJECTION's schema
and enqueue re-reads the stored value through the DESCRIPTOR's canonical schema. It is the same
identity-not-equivalence argument `defineIntakeProjection` already makes per target field, applied
to the whole input.

## 6. Rerun values from a prior run (charter §12)

<!-- roadmap: p2-2h -->
<!-- roadmap: p2-2i -->

**Current contract — D334/D335 (2026-09-05).** The operator-facing action is **Rerun** for failed,
interrupted and successful runs. It opens the ordinary Run modal at Steps, defaulting to failed and
unfinished steps for a failed/interrupted source and all steps, including previously omitted steps,
for a successful source. The operator may change any selection. The source run is read-only and remains byte-identical.

D335 permits explicit repetition of a completed transaction. On proceeding from Steps, a warning
about selected previously submitted transactions offers Cancel / Confirm. Cancel returns to Steps;
Confirm acknowledges and advances to Values without creating or submitting a run. The operator
edits Values, then the final modal submission authorizes another submission, not receipt reuse. Prior
completion alone never vetoes the operator's selection. The read model serves completion coordinates
and evidence identity for the warning; it cannot grant repeat authorization. The server retains the
acknowledgment with the exact values/selection and revalidates it at consumption. `ref write-safety`
§D335 owns execution, concurrency and recovery; §9.1 of `ref dashboard-surfaces` owns the interaction.

Completed-step values are candidates for prefill, not inherited authority. The operator controls
both dimensions independently: which eligible steps execute, and which prior values are copied,
changed or cleared. On submit, the modal's workflow input and omitted-step replacement values become
the new plan's authoritative typed values. Every supplied value is an operator assertion. When a
value was copied unchanged, its optional provenance may cite the exact source run, source version,
step/node and field path, but that citation does not turn a prior checkpoint into current authority.
An omitted step executes none of its entries. An omitted transaction creates no new intent, attempt,
commit or proof; downstream work may consume only the schema-valid operator assertion the workflow's
declared omission form admits. A parked or uncertain write still exposes only its evidence-resolution
actions and cannot enter Rerun.

The run service mints the new `runId`/`traceId` only when the confirmed server plan is consumed.
Planning and consumption revalidate the source id/version and descriptor/config/input/omission
fingerprints. A stale, deleted, malformed or ineligible source refuses before any new run or
`run.queued` publication exists. A submitted match key equal to the source item may retain
`retryOf`; a changed match key creates a fresh item and may not claim retry lineage. This preserves
D313's complete Run-modal authority and supersedes D166's in-place checkpoint mutation plus D314's
no-input/no-omission recovery surface.

**Historical implementation record.** §§6.1–6.4 below describe the D166/D168 in-place
`edit-checkpoint` implementation that 1.6.4 must remove before activating the lifecycle-writer guard.
They remain only to explain the code and tests being retired or repointed; they are not current
product authority.

### 6.1 Data source — fetch the snapshot, SSE only signals staleness

<!-- roadmap: p2-2i -->

**Decision: the editable checkpoint snapshot is FETCHED (request/response), not SSE-streamed; the
per-run SSE topic is consumed only as an invalidation signal.** Justification:

- Checkpoints are **SQLite system-of-record** (D14) — low-frequency, not a stream.
- An editable form must be a **consistent point-in-time snapshot**; a form whose values mutate under
  the operator's cursor (a live SSE feed) is a footgun.
- Ref dashboard-surfaces already keeps per-run detail as request/response + a per-run SSE topic. Edit Data fetches
  the checkpoint snapshot on open (carrying a **generation token** — the run's `attempt` + the
  latest span sequence it was loaded against). The per-run SSE topic's `run.claimed`/`gate.resolved`
  events are consumed **only** to warn "this run just resumed — your edit is stale" (drives the
  fail-closed reject in §6.4 *before* the operator wastes effort).

The snapshot reads checkpoint values plus descriptor/contract/implementation fingerprints and
field-level provenance `{ source, observedAt?, correctedAt?, supersedes? }`.

### 6.2 What is editable vs read-only

<!-- roadmap: p2-2i -->

| Run state | Edit Data |
|---|---|
| **Parked at a gate** (approval / await-signatures / identity-approval) | **Visible; explicitly declared fields editable.** Descriptor `capabilities.editData.fields` names node+field paths. Default is read-only, never "all checkpoint JSON." |
| **Stopped / failed** (terminal but resumable — `single`, real `operation-member`, D9) | Same explicit field policy; an accepted edit becomes `injected` on retry/resume. |
| **Running** (actively claimed, a live task owns a page) | **READ-ONLY** — the run's checkpoints are being written by the live task; editing not-yet-written state is meaningless and racy. Show live checkpoint state read-only. |
| **Terminal `done`** | **Read-only.** Correcting-and-rerunning a done item is the *separate* new-input path (§6.5 — the start-plan flow), not Edit Data. |
| **Display-only rows** (operation coordinators, i9 display-only members) & **OCR per-page internals** | **No checkpoint Data section in Context** — D9 excludes them (nothing to resume). |

### 6.3 Editing = typed field patches; editing is not freshness

<!-- roadmap: p2-2i -->

An edit is **not** a free-form blob write. Each editable path is explicitly declared on the
descriptor and checked against the producing contract's output schema. Stable item/match identity,
workflow input, idempotency-key inputs, write intent/proof/receipt fields, and provenance metadata are
structurally non-editable; changing identity or original input uses the separate new-input path.
Each edited step value is parsed against **the producing contract's full output schema after applying
the patch. A bad edit is
rejected loudly at save time. Changed fields receive operator-correction provenance and link to the
superseded fact. Untouched fields retain their original live-source `observedAt`; saving one edit
does not refresh the whole checkpoint. Operator-corrected values do not assert current external
truth. If a corrected/old fact reaches a commit beyond its source freshness limit, resume requires
the normal explicit, field-scoped audited freshness override **only if that field's contract permits
one**; identity/idempotency/proof fields always require a live read rerun.

This is why Edit Data is safe where the `prefilledData` hack was not: the hack edited stringified
`data` and re-injected it as accumulated strings *bypassing* schema parse (`splitPrefilled` strips
before validation); the new path parses every edit through the **same** contract schema that produced
the value, so a corrupt edit cannot enter the run.

### 6.4 Concurrency — edit-during-resume is fail-closed (loud), the resume wins

<!-- roadmap: p2-2i -->

A parked run holds no browser (D5), so normally no task executes while the operator edits. But a
resume can be triggered concurrently (a watcher gate resolving, an operator elsewhere clicking
Retry). **Rule: the resume claim is the fence; the Edit-Data save is a compare-and-swap against it.**

- The operator loads the snapshot at generation `G` (`attempt` + span-seq).
- On Save, the UI issues ref dashboard-surfaces's standard `edit-checkpoint` command. Its injected-checkpoint write
  is a **conditional SQLite transaction**: it commits only if
  the run is still in a non-executing state at generation `G` — i.e. **no `run.claimed` for a newer
  attempt** has landed and the gate has not resolved since load.
- If a resume claimed the run between load and save, the CAS **fails and the save is rejected
  loudly**: *"run `sp-0912-4c2e` resumed while you were editing — your edit was not applied; reload
  the current state."* The **resume wins**; the command is rejected and the proposed patch remains
  only in the local editor for copy/review, never silently merged into a
  now-executing run.
- Symmetrically, the resume path never blocks on an open editor — it just claims; the open editor
  discovers it is stale via the SSE `run.claimed` signal (§6.1) and disables Save before the operator
  even tries.

Fail-closed by construction: an unknown/raced state → reject, never last-writer-wins, never apply an
edit onto a run that has moved on. (Editing a *running* task's checkpoints is forbidden outright,
§6.2, so the only race is park/stop ↔ resume, which the CAS closes.)

#### 6.4.1 As-built — the rail wiring (2i-C, 2026-08-08, D168)

<!-- roadmap: p2-2i -->
<!-- roadmap: track-b -->

<!-- roadmap-status: p2-2i -->
- [x] 2i-C, the Edit Data rail: the `context-data` wire carries the policy, `authority.version` is the generation token, drafts re-parse into the recorded scalar's type, and all five save arms plus the three consume arms are pinned (`tests/unit/edit-data.test.ts`, `edit-data-field-policy` active)
- [x] 2i-E, the intake surface over schema v12: the durable session, the upload route, all six command arms and the first real projection (§2.7/§2.8/§5.2, D170–D172)
- [x] 2i-F, the token-scoped phone capture surface: the fragment token, the uniform refusal, the bundler and the derived handoff ids (§5.1, D174; `capture-durability-and-scope` active)
- [x] the rail's CAS-conflict arm — silently reported saved until B7/D253 fixed it — is now exhaustive at the discriminant and guarded (§6.4.1)
- [ ] the phone surface has no production delivery path: the BFF serves no frontend bytes, so `/capture.html` 404s outside the dev server (§5.1, D189)
- [ ] no workflow can receive a capture handoff — `CAPTURE_INTAKE_BINDINGS` is empty (§5.1); and saved-mapping reuse has no store, so every intake upload re-maps (§2.3)
> 2026-08-20 | docs-cohesion data-intake-and-edit-data | verified against `src/dashboard/{app/command-result.ts,surfaces/context-rail.tsx}`, `src/domain/intake/*`, `src/domain/capture*.ts` and `src/infra/sqlite/migrations.ts:904`; left: the two delivery gaps above
<!-- /roadmap-status -->

<!-- roadmap-status: track-b -->
- [x] B7's half of this doc is closed: the Data save's unhandled CAS `conflict` is fixed at the discriminant, not at the call site — `settleCommandResult` plus the `command-result-exhaustive` guard with a fixture carrying the exact shipped shape (D253)
- [ ] the rest of Track B is not this doc's — ref dashboard-surfaces and ref frontend-backend-integration own the surfaces; this section owns only the Edit Data model beneath the rail
> 2026-08-20 | docs-cohesion data-intake-and-edit-data | verified against `src/dashboard/app/command-result.ts` and the `command-result-exhaustive` guard entry in `docs/rebuild/guard-inventory.json`
<!-- /roadmap-status -->

The operator surface over the D166 core landed; where the build deviates from the sketches above,
the as-built shape is normative:

- **The `context-data` wire carries the edit policy** (`ContextDataSectionSchema`,
  `src/domain/dashboard/run-detail.ts`). Each entry serves either
  `{editable, nodeId, fieldPath, value, pendingCorrection}` — the patch identity and the raw
  recorded SCALAR off the latest compatible checkpoint — or `{locked, reason}` with the exact
  sentence the operator reads. The payload-level `editing` union is the run-level half, computed
  from RAW authority lifecycle plus the claim (the coarse queue status cannot distinguish
  `parked-gate` from an open gate on a claimed run), and its `expectedVersion` is the CAS basis
  for the values that same response served. Entries fold from TWO sources joined by
  `(nodeId, fieldPath)`: the descriptor's detail projections (display value from the span fold,
  label from the spec) and the `editData` field declarations (value from the checkpoint); a leaf
  in both is ONE row. A declared field whose step never recorded is omitted — the Data section
  lists what the run touched — while a recorded outcome that lacks the leaf (the absent arm of a
  present/absent union) renders locked with the reason. Serving a field's raw scalar is justified
  by the declaration itself: a descriptor that names a field correctable names it
  operator-visible, so no secret-bearing path may be declared.
- **§6.1's generation token is `authority.version`**, served as `editing.expectedVersion` — not
  the sketched `attempt` + span-seq pair; the run version is the one fence the kernel CASes
  (D166), so a second token would be a parallel truth. **§6.1's per-run SSE staleness signal is
  as-built the day stream's queue row**: no run-detail-topic client exists yet, and the row
  leaving `queued`/`awaiting-approval` is the same "this run just resumed" fact
  (`liveLockReasonOf`, `src/dashboard/surfaces/context-rail.tsx`), consumed exactly as §6.1
  intended — to disable Save with the reason BEFORE the CAS rejects.
- **`EditDataFieldSchema` grew a required `label`** — the declaration is operator-facing now —
  and the factory grew two refusals beside D166's: a field on an **always-rerun** node (its
  correction could never be replayed; the executor would refuse the leftover patch at resume, so
  the declaration refuses first), and path validation moved to the **offers** rule (one union arm
  owning the path is enough) because a correctable value routinely lives on the `present` arm and
  the save re-parses the whole stored output against reality anyway. `person-lookup` declares the
  three CRM dates (`crm-dates`: `invitedOn.value`, `startsOn.value`, `completedOn.value`) — the
  genuine misread-a-date correction §6 was designed for.
- **A staged correction renders beside the recorded value.** Until the resume replays
  `envelope.injected`, the checkpoint value and the pending value are both true, so the wire
  serves `pendingCorrection` and the rail shows "Corrected … — applies when the run resumes"
  under the value box. An applied save refetches the run detail at its bumped `rowRevision`, and
  every fetched section re-fetches through that revision, so the rail never shows a CAS basis the
  kernel already refused.
- **Editing is entered by focusing a value box** (the reason + Save footer appears and the rail
  widens before the first keystroke); drafts parse back into the recorded scalar's own type
  before any command is built, a rejection keeps the drafts and shows the kernel's sentence
  verbatim, and the per-save `reason` (required, non-empty) becomes every patch's
  `CheckpointPatch.reason`.
- **The CAS conflict arm was UNHANDLED until D253, so §6.4's whole rule was false in the rail.**
  `CommandResultSchema` has three arms and TWO are refusals — `rejected` and the CAS `conflict` —
  and this rail branched on `rejected` alone, so a conflict fell through to the SUCCESS path: the
  editor closed, the operator's drafts were discarded, and a correction the kernel had REFUSED was
  reported saved. That is exactly the state §6.4 exists to make loud, and it was reachable by
  ordinary use — a run's version moves whenever a worker claims it or the day stream folds a span
  under an open panel. The fix is structural: `settleCommandResult`
  (`src/dashboard/app/command-result.ts`) switches over the discriminant so a fourth arm is a
  compile error, and the `command-result-exhaustive` guard refuses any dashboard module naming one
  refusal arm without the other. The two refusals stay DISTINGUISHABLE in the sentence, because the
  operator does different things about them: a conflict carries the server's `currentVersion` and
  never the words "try again" — re-sending the same envelope carries the same stale
  `expectedVersion` and would be refused identically.

**Decision: the pre-first-start intake correction grid (§5) and checkpoint correction in the
Context rail's Data section are SEPARATE surfaces that share ONE pure per-cell coercion/validation
core.** Justification:

- They **parse against different schemas**: the intake grid parses each row against the *workflow
  input* schema (pre-run); Context Data correction parses each field against the *producing
  contract's output* schema (mid-run). Same UX ("loud per-cell error naming row/column/value"),
  different contract.
- They have **different lifecycles + endpoints**: ref workflow-model §5.6 #4 already mandates that new-input and
  injected are *separate endpoints* — "`injected` is rejected on a new-input run" so changed input
  can never silently ride stale context. Merging the two grids into one would blur exactly that
  boundary.
- Sharing the pure coercion/validation module (the successor of `validateEditField` +
  `mmddyyyyToYmd`) keeps the two surfaces consistent without coupling their contracts.

So: **intake grid** = correct cells before N inputs fan out (§5); **Context Data correction** =
correct a parked/stopped run's checkpoints before resume (§6.1–6.4). One validation core, two
surfaces, two endpoints. There is no separate Data/Edit Data tab or dialog.

**As-built (D166, 2026-08-08) — the core landed; the rail UI is 2i.** The save is the activated
`run/edit-checkpoint` command: version CAS first (`the resume claim is the fence` — a claim bumps
the row version, so a save loaded at generation G cannot land on a run that moved), then
refuse-if-claimed, then state ∈ {queued, parked-gate} only, then the descriptor's field
allowlist (`capabilities.editData` grew the object form `{ fields: [{nodeId, fieldPath}] }`;
boolean stays legal as view-only, and the factory refuses a declared path the producing READ
task's output schema does not own — a transaction node's output is a write proof and never
correctable), and finally the WHOLE post-patch output re-parses through the producing contract's
schema BEFORE anything durable moves. Accepted patches merge by `(nodeId, fieldPath)` into
`envelope.injected`; the pre-D166 rule tying `injected` to `startAt` was removed because its
fear — a re-running node silently discarding the correction — is now a structural refusal: the
executor consumes patches at REPLAY only, re-derives the corrected row through the same pure
applier (`src/core/checkpoint-patch.ts`), lands it at the resuming attempt with
`source:"operator"` provenance (`correctedAt`, `supersedes`, `originalObservedAt` NEVER
refreshed), and a patch naming a node the run will execute — or whose value fails the schema —
fails validation loudly. Two recorded bounds: an edit on a terminal-failed run is expressed as
retry-then-edit-the-queued-attempt (terminal rows are never mutated), and a retry-minted run
whose corrected node shares attempt 1 with an existing row refuses loudly at the byte-differ
insert — fail-closed pending the archive/attempt-model work. §6.5's new-input path remains the
start-plan flow. Proof: `tests/unit/edit-data.test.ts` (applier, all five save arms, and the
three consume arms) plus the activated `edit-data-field-policy` guard.

### 6.5 Rerun is the source-bound start-plan path

<!-- roadmap: p2-2i -->

Rerun submits through `src/services/start/plan.ts` and the `start-run` command. The source
coordinate and observed version bind the prefill/recovery context, while the ordinary raw input,
canonical snapshot, step selection and omission facts bind what the new run will actually execute.
The proposal carries no run identity. Confirmation consumes it once and the service returns the
newly committed identity.

The action is always Rerun. The source outcome chooses only the defaults: failed/interrupted runs
select failed and unfinished steps plus descriptor-required completed steps with a visible explanation,
under the [approved mandatory-step clarification](dashboard-surfaces.md#rerun-required-step-defaults--2026-09-19);
successful runs select all eligible steps, including previously omitted steps. The operator may
change any eligible optional selection, acknowledge the submitted-transaction warning to
advance to Values, and change any offered value before the final modal submission. Unselected
steps do not replay automatically. Changing an identity-bearing value is legal when the ordinary
workflow input schema accepts it; the planner derives the resulting item rather than forcing the
source item's identity onto different input.

Two neighbours remain separate. An intake-born item's rerun against an immutable manifest keeps its
manifest diff/revalidation path. An archived run's archive relaunch keeps its immutable archive
digest and lineage path. Neither is a shortcut around this modal or a way to mutate the source.

### 6.6 Explicit Rerun value mappings (operator-approved 2026-09-08)

Task 2.6.1-2 may add explicit descriptor mappings from completed node output fields
to existing operator-suppliable Run input or step-omission fields. This declaration
is separate from the retired checkpoint-edit policy. It neither makes old
checkpoints editable nor enlarges the ordinary input/omission schema.

Each mapping names the producing node, exact durable output field path, an
operator-facing label, and the target input field or omission step/field. The
descriptor compiler validates both ends. No field-name matching, inferred
mapping, inverse execution of a producer, or undeclared output exposure is
permitted. A transaction output may supply a schema-valid operator assertion;
its old proof is never installed as evidence that a new transaction occurred.

The read projection validates canonical source existence, version, eligibility
and descriptor identity. It offers only source-owned completed values with exact
node/step/field, execution and recorded provenance coordinates. Missing optional
values or provenance are reported explicitly; malformed source evidence refuses
instead of falling back to another attempt. Omitted-step assertions do not count
as observed completion. Values that the ordinary target schema does not admit,
or that contain protected source data, are withheld. Protection derives from
retained source identities, never the current private configuration.

The same response may report completed/failed/unfinished step facts and settled
transaction evidence coordinates for the existing warning protocol. It grants
no repeat consent and writes no run, checkpoint, plan, settings or modal state.
The existing source-bound planner still checks copied-value attribution, complete
submitted values/omissions and repeat acknowledgment at its own boundaries.
Task 3.1.11.2 (`dash-run-modal`, historical filename 11-2) continues to own modal selection, editing and submission.

---

## 7. Adversarial self-review — silent-fallback vectors and their guards

| # | Silent-fallback vector | Mechanical guard |
|---|---|---|
| 1 | **Fuzzy header auto-applies a wrong binding** (Name→fullName when Legal Name is the real one) | Suggestions are hints only; a guard asserts `ColumnMapping.bindings` is written ONLY by an operator action, never by the scorer. Fingerprint reuse pre-loads a *visible* mapping the operator still confirms (§2.3). **Held by `intake-mapping-boundary` (active)** — `suggestions.ts` may not name `confirmBinding`, and a `Suggestion` has no `confirmedAt` to acquire |
| 2 | **Coercion swallows a bad cell** (a malformed EID becomes `""` or a guessed value) | `field.coerce` throws a per-cell error naming row/column/value; the cell becomes a **row rejection** (§5), never a substituted default. **Held by the `fail-loud-catch-default` and `nullish-literal-data-fallback` ratchet arms** (`tests/unit/architecture/helpers/ratchet-arms.ts`), which scan the whole of `src/**` — there is no `src/intake`; the domain half is `src/domain/intake/` and the service half `src/server/intake/` |
| 3 | **Mapping reuse on a changed/duplicate layout** | unambiguous canonical-JSON fingerprint; bindings resolve by header+occurrence; missing columns unmap; duplicate headings require visible sample confirmation; index never silently binds. **Held by `intake-mapping-boundary` (active)** |
| 4 | **A rejected row silently vanishes (or a partial file launches)** | `Run` is disabled until the reject list is reviewed; only the `valid` set fans out; each reject carries row/column/value/reason and must be fixed or explicitly excluded (§5) — nothing half-launches. **Held by `IntakePlanManifestSchema`'s own refinements** (unique 1..n source-row coverage, exact derived totals, `valid > 0`), not by a named guard |
| 5 | **A Rerun plan silently adopts stale source values or mutates its source** | Plan and consume both bind the source run id/version; drift refuses before create. Prefill is copied into a new typed plan, never replayed from the source at execution, and the source record must remain byte-identical. Task 1.6.4 repoints the former Edit Data tests to this boundary; 2.6 Task 1-2 proves source value/provenance reads. |
| 6 | **An intake projection re-declares a regex looser than its canonical field** | Guard asserts every *mapped* input key points at the same `CanonicalField.schema` object; non-intake workflow fields remain legal. The full assembled input still parses through the workflow schema; every migrated legacy EID fixture is audited against canonical `Eid`, and a truly distinct identifier must get a separately named/validated domain type (§1). **Held by `intake-mapping-boundary` + `intake-canonical-field-registry` (both active)**, and by `defineIntakeProjection` refusing anything but the same schema OBJECT |
| 7 | **Roster match fabricates an EID on no-match** | `matchedEid` is `nullable`; `mismatch:"no-match"` is a first-class output; the caller falls through to person-lookup — the `nullish-literal-data-fallback` ratchet arm bans `?? "<eid-literal>"`-shaped fallbacks in the roster impl |
| 8 | **A stale roster match rides into a write on resume** | finite field freshness + declared DAG walk refuses stale facts feeding a commit; an unrelated Edit Data patch cannot reset their observed time |
| 9 | **Novel headers never reach mapping** | parser candidate generation is alias-independent; fixture with zero known aliases must reach header selection + mapping rather than throw |
| 10 | **Edit Data changes identity or write proof** | Default read-only; descriptor allowlists exact node+field paths. **Held by `edit-data-field-policy` (active)**: only a READ node's output is correctable, only a checkpoint-replayed node qualifies, a declared path must resolve through the producing task's own output schema, and the full patched output re-parses |
| 11 | **A rerun called “same data” actually uses a changed file, mapping, or workflow schema** | rerun references an immutable `IntakePlanManifest`; artifact/mapping/contract hashes are compared and any difference requires a visible new-plan diff + confirmation. **Held in SQL** — schema v11's `intake_manifests_immutable_update` / `_never_deleted` triggers ABORT, so the authority cannot be rewritten even by a bug |
| 12 | **A partial intake looks like all source rows completed** | coordinator/evidence receipt always shows source, valid, rejected, explicitly excluded, enqueued, and terminal counts; manifest/member insert is atomic and counts are invariant-checked by the manifest schema's refinements |
| 13 | **Two target fields sharing one canonical concept overwrite each other** | bindings key on the intake projection's stable target-field id and also record its canonical field id; duplicate targets, changed projection fingerprints, or canonical mismatch fail before validation (D66). **Held by `intake-mapping-boundary` (active)** |

Honest residual (no full mechanical guard): the redesigned roster *scoring* (0–1 confidence) is only
verified at order 3's live-verify (the first migration that runs a roster match; roster INGEST is order 9) — the *tiering* ports verbatim, the *scoring*
is new code and must be re-checked against real rosters, not assumed.

---

## 8. Worked example — a work-study spreadsheet, end to end


Operator uploads `WorkStudy_July.xlsx` targeting the work-study workflow. **This example is the
order-6 TARGET state, not a transcript**: `work-study` is not in the tree, and step 4's saved
mapping has no store (§2.3). Steps 1–3, 5 and 6 are each executable today against a workflow that
declares an intake projection — `person-lookup` is the one that does.

1. **Upload → parse.** `extraction/extract-spreadsheet` sniffs the header row and returns three columns:
   `"Employee ID#"`, `"Student Name"`, `"Dept"` (+ sample values per column). Fingerprint computed.
2. **Map.** No saved mapping for this fingerprint (first time). The grid shows the two required
   canonical fields — `eid`, and a name field — plus optional `department`. Fuzzy suggestions
   highlight `"Employee ID#"→eid`, `"Student Name"→fullName`, `"Dept"→department`; the operator
   accepts each with a click (never auto-applied). `effectiveDate` is a workflow constant typed once
   in the run panel (not a spreadsheet column) — a required *input* field with no column bound is a
   loud block until supplied.
3. **Validate.** 42 rows coerce. **40 pass**; **2 reject**, each named loudly:
   - row 17, column `"Employee ID#"` → `eid`: value `"10-4567"` — not a UCPath EID (must be 10xxxxxx).
   - row 31, column `"Employee ID#"` → `eid`: value `"TBD"` — not numeric.
4. **Fix in the intake grid.** The operator corrects row 17's cell to `10456712` (re-coerces live →
   valid) and row 31 to `10998801` (valid). Now **42 valid, 0 unresolved**; the immutable manifest
   still records two rejection events and two corrections linked to the original cells. The mapping would be saved under
   `config/column-mappings/work-study/<fingerprint>.json` for next week's identically-shaped export
   — **the one step of this example nothing implements**: the reuse logic exists and no writer
   does, so today week two re-maps from scratch (§2.3).
5. **Run.** `Run` enables; 42 inputs fan out as an `operation` coordinator + 42 `operation-member`
   rows, each input `WorkStudyInput`-valid by construction.
6. **A member parks / stops.** Member #12 (`emplId 10456712`) parks at a gate (or fails at a step).
   The operator opens **Edit Data**, sees the run's checkpoint state (typed, per step), and corrects
   `effectiveDate` on the relevant checkpoint — the edit parses against the producing contract's
   output schema (loud if wrong), and records correction provenance on that field. Other live facts
   retain their original observed times. If the corrected value reaches a commit, the operator
   explicitly confirms a field-scoped freshness override or reruns its source read. Had a concurrent resume claimed the run first, the save would
   have been rejected loudly and the resume would have won (§6.4).

---

## 9. Settled intake defaults

Cited elsewhere as **§9.1–§9.5** — the numbered items below, which are questions closed by
decision, not headings.

1. ~~Canonical EID width~~ — **resolved 2026-07-22:** adopt `/^10\d{6}$/` everywhere and audit the
   loose legacy consumers at migration. A genuinely different source identifier gets a distinct
   domain type and explicit conversion; there is no `legacyEid` escape hatch (§1).
2. ~~Mapping storage location~~ — **resolved 2026-07-21:** versioned, schema-validated JSON at
   `config/column-mappings/<workflow>/<fingerprint>.json`, written temp+fsync+rename. It is
   operator-greppable configuration, not run authority; malformed files fail loud and never fall
   back to a nearest mapping. *(The decision stands and is UNBUILT — §2.3 records what exists and
   who owns the writer. A settled question is not a shipped feature.)*
3. ~~Roster freshness budget~~ — **resolved 2026-07-22:** 24h is the conservative base maximum and
   consumers may narrow it. File mtime is not truth (copying a file changes it); freshness is the
   observation time of the immutable content-addressed roster artifact. Crossing the budget requires
   a new artifact/match or an allowed audited field override, never an mtime substitution (§4).
4. ~~Suggestion engine source of truth~~ — **resolved:** aliases live on `CanonicalField`; the
   suggestion engine consumes them but cannot write a mapping without operator action.
5. ~~Edit-Data on a `done` item~~ — **resolved:** read-only. Correction/rerun is always the separate
   new-input/new-item path; a done item's identity, proof, and checkpoints are never reopened.

## D273/D274/D275/D276 intake presentation boundary (2026-08-26)

The ratified ports preserve D173/D171's authority: coded Edit-Data refusals preserve drafts and may
show truthful Saving; Intake gets one demo-shaped correction/review flow, review-gated enqueue, and
Manifest/Rerun framing only over served facts. Capture's desktop viewer remains pointers-only.
The rejected B/C arms respectively flatten or hide refusals, advertise a known kernel refusal,
invent producer-owned fields, or defer already-served review states. Detailed item-by-item wording
and alternatives are in `ref dashboard-surfaces` §10; nothing here changes intake/edit authority or
claims a port is implemented.

## Artifact storage model

**2026-09-08 — approved, pending implementation.**
[Side task `side/artifacts`](../plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/artifacts.md) consolidates the artifact naming
and lifecycle decisions: `intake_sessions` plus `intake_manifests` become `imported_artifacts`,
`ocr_extractions` becomes `extracted_artifacts`, and `artifact_outbox` plus `artifact_sink_heads`
become `generated_artifacts`. Under the [parallel execution binding](../plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/README.md), prerequisite B
completes T1 and shared T2 storage; T2 publication/export then runs independently of provider accounting
and diagnostic resolution. Existing running plans remain unchanged.

Every imported-artifact row represents one whole import: mutable preparation then frozen submitted
data on the same row, atomically bound to enqueue. Preserve source versions, explicit row dispositions,
old session/manifest identities, command replay and run origins. Do not merge imports by source hash.
Extracted artifacts retain page/form admission and uniqueness without new OCR persistence wiring.

Every generated-artifact row represents one logical output file across creation and updates. Store
state, pending update identities, completion receipts and current/version-history references together;
multiple queued updates cannot overwrite each other. Preserve checkpoint/update atomicity, stable-key
upserts, exact replay, exclusive file-writer fences and file/DB failure handling. Old bytes remain
immutable and old run/import/export references never resolve to a newer head. File-write uncertainty
or external edits cannot be treated as a successful acknowledgement. Actual bytes stay in existing
artifact storage; no new queue/head table or automatic artifact GC.

T2 registers existing explicit XLSX outputs while retaining their export receipts and protected shape;
it does not activate I-9 projections or invent a workbook path/column layout. Internal diagnostic and
extraction file references retain their existing owners. Populated historical conversion requires
verified stopped DB/file source preservation and exact identity checks. This records approved design,
not implemented behavior, provider/workflow activation or permission to convert the operator database.

## C0 artifact and approval continuity — 2026-09-09

F owns the complete imported/extracted artifact conversion and working generated-file baseline;
G owns generated publication and explicit XLSX completion on frozen F interfaces. Each explicit
XLSX request has one generated_artifacts row containing request/status/verified file evidence,
with independent request identities, immutable previous versions and authenticated downloads.
Retire operator_xlsx_exports after populated conversion and compatibility proof; no dual writer
or second export receipt table. Preserve submitted import values, protected source bindings,
run origins, independent same-byte imports and checkpoint/update atomicity.

F's removal of unused gates/ocr_approvals projections does not remove durable checkpoint gate
answers or the future OCR acceptance/replay-safe child-dispatch requirement. New child snapshot
selection follows the C0 settings contract; it does not implement an otherwise absent dispatcher.
L/A take verified report and attachment custody before reference-aware live cleanup. Archive viewing
uses the saved generic report, not a dependency on live import or current workflow schemas.

This is the C0-admitted target contract, not a claim of implemented behavior. The [Phase 2.6 owner](../plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/README.md) binds sequential prerequisites, focused development proof and final 2.6.9 acceptance. Released evidence and migrations remain immutable.

### F implementation baseline — 2026-09-09

Schema47 F consolidates imported/extracted artifacts and generated queue/head/XLSX evidence. Exact historical evidence and unavailable file states are preserved; G still owns the remaining publication policy.

Implementation, frozen interfaces and focused evidence: [F execution owner](../plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/foundation.md#f-execution-record--2026-09-09).
This records implementation of the approved C0 contract, not a new decision or full-phase acceptance.
