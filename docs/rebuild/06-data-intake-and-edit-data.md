# 06 — Data Intake (operator column mapping) & Edit Data over checkpoints

Status: **revised 2026-07-22 after the whole-plan/legacy-code review; amended 2026-07-26
(Round 8, §5.1 — the mobile-capture durability trim, D79d) and 2026-07-31 (Round 11 — standalone
rebuild repo, D93: the rebuild lives in its own `hr-automation-rebuild` repo at plain `src/`).**
Intake now produces a durable, replayable admission manifest; every data boundary is strict;
scenario coverage and evidence make partial/excluded rows impossible to mistake for silently
completed work.

## Ownership (D1 — this doc owns / this doc references)

| This doc **owns** (siblings reference, never redefine) |
|---|
| The **operator column-mapping design** — the mapping object, per-source persistence + header fingerprint, the upload→map→validate→run UI flow, per-cell coercion, the unmapped-required block, fuzzy-suggestion policy |
| The **extraction** intake task designs (`extraction/parse-csv`, `extraction/parse-pdf-fields`), **roster** matching (`roster/match-spreadsheet`), and typed **normalization** service outcomes — their contract shapes + intake semantics |
| The **intake pipeline**: how a parsed+mapped dataset becomes N workflow inputs, and the pre-run per-row rejection review (nothing half-launches) |
| Durable mobile-photo capture intake: session/photo/finalization state, bundle outbox, artifact handoff, expiry, restart recovery, and phone-scope lifecycle (network exposure policy remains doc 12) |
| The **Edit-Data surface** — its data source, editable/read-only rules, the edit-during-resume concurrency rule |
| Roster/retention projection semantics: typed stable-key record, blocking outbox, idempotent xlsx upsert, and concurrent-edit conflict policy (storage/projector authority remains doc 03) |

| This doc **references** (owner) |
|---|
| **Canonical field definitions** — the field vocabulary + zod schemas live in the rebuild repo's `src/domain/` (defined THERE). This doc owns the *mapping/intake semantics onto* those fields, not the vocabulary itself |
| Task contract/impl split (`defineTaskContract`/`defineTask`), service stores (D4), `freshness` field, error taxonomy → **doc 01** |
| The **injected-data mechanism** (`RunEnvelope.injected`, §5.6 #3), checkpoint store + resume scope (D9), freshness walk (D8), the "Live Edit Data over checkpoints" subsection → **doc 02** |
| SSE wire shapes (`detailSurfaces` incl. the Context-rail `data` section), `span.patched`, notes stream, SQLite projection role (D14) → **doc 03** |
| Standard CAS command path for Edit Data → **doc 03** |
| Scenario manifests, evidence receipts, run explanation, knowledge/fix records → **doc 12** |

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
Data a **typed view of the run's checkpoints** edited through doc 02's `injected` mechanism.

---

## 1. Canonical field registry (vocabulary lives in the rebuild repo's `src/domain/`, referenced here)

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
`z.string().regex(/^10\d{6}$/)` (doc 01 §9.1 `SearchPersonOrg` + `isUcpathEmployeeId`).
`firstName`/`lastName`/`fullName` port the canonical `ocr-person-name.ts` shapes (title-cased
"Last, First"). `effectiveDate`/date fields coerce `MM/DD/YYYY` via the ported `dates.ts` helpers.

**The load-bearing invariant—each mapped field uses the target field's exact schema.** A
spreadsheet-capable workflow declares an `intake` projection naming which input fields are mappable;
those field schemas reuse canonical schema objects rather than parallel regexes:

```ts
// src/workflows/work-study/input.ts
export const WorkStudyInput = z.strictObject({
  emplId:        fields.eid.schema,            // same object the mapper coerces to
  effectiveDate: fields.effectiveDate.schema,
});
export const WorkStudyIntake = defineIntakeProjection(WorkStudyInput, {
  emplId: fields.eid, effectiveDate: fields.effectiveDate,
});
```

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

**Naming reconciliation.** `src/domain/ids.ts` already owned `IntakeManifestId`, and doc 03's D67
command union already binds `enqueue-intake-manifest` to it. That id is THE manifest identity;
§5's `IntakePlanIdSchema` is the same thing under an earlier name and no second id is minted.

---

## 2. Operator-defined column mapping

### 2.1 The mapping object (zod-typed)

```ts
// src/domain/intake/mapping.ts  (domain — bundle-safe, zod only)
export const ColumnMapping = z.strictObject({
  workflow:       WorkflowIdSchema,
  /** Exact target-field set/schema this map was built against (D66). */
  intakeProjectionFingerprint: FingerprintSchema,
  /** header fingerprint of the source this mapping was built for (§2.3). */
  fingerprint:    Sha256Schema,
  savedAt:        IsoInstantSchema,         // provenance, drives stale display
  headerRowIndex: z.number().int(),        // which sniffed row is the header (parsers agree on this)
  /** Stable within one parsed layout: normalized header + duplicate occurrence. */
  columns:        z.array(z.strictObject({
    sourceColumnId: z.string(), header: z.string(), normalizedHeader: z.string(),
    occurrence: z.number().int().positive(), currentIndex: z.number().int(),
  })),
  /** Target-field binding, not canonical-concept binding (D66). Two target paths may intentionally
   * use the same canonical field, e.g. homeCity and mailingCity. */
  bindings: z.array(z.strictObject({
    targetFieldId: IntakeTargetFieldIdSchema,
    canonicalFieldId: CanonicalFieldIdSchema,
    sourceColumnId: SourceColumnIdSchema,
    confirmedAt: IsoInstantSchema,
  })),
});
export type ColumnMapping = z.infer<typeof ColumnMapping>;
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

1. **Upload.** Operator uploads a `.csv`/`.xlsx`. `extraction/parse-csv`|`parse-pdf-fields` (§3)
   returns the **detected columns + a few sample values per column** (never the whole file to the
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

### 2.3 Per-source persistence — header fingerprint (recommended scheme)

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
`config/settings.json`).

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

The suggestion engine scores each detected header against every target field's referenced canonical
field `aliases` + `label` (the redesigned successor of `COLUMN_PATTERNS`). It **proposes** a binding (a highlighted
dropdown default the operator can accept in one click) but **never applies it** — the grid starts
with the field *unbound* and the suggestion shown as a hint. Rationale (charter fail-loud): a
confident-but-wrong header guess ("Name" → `fullName` when the file's real name is in "Legal Name")
is exactly the silent-substitution class we ban. Mechanically enforced: the mapping is only
`bindings`-populated by an operator action (accept-suggestion or manual pick); a guard (§7 #1)
asserts no code path writes `bindings` from the suggestion scorer directly.

### 2.6 Phase-2h as-built — projection, mapping and suggestions (D147)

`src/domain/intake/` holds the three pieces, deliberately separate because that separation is what
makes reuse fail closed. The whole tree is bundle-safe (no Node built-in) since the mapping grid is a
browser surface — doc 13 §8.13's lesson applies to every new domain module, not only the ones that
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

---

## 3. Extraction store tasks (service store — D4)

`extraction` is a service store (`sessions: []`, no browser, no `page` ctx). Contracts live in
`src/domain/contracts/extraction/`; impls in `src/stores/extraction/tasks/` (doc 01 §3.4).

```ts
// src/domain/contracts/extraction/parse-csv.ts   (effect: "read")
export const ParseCsv = defineTaskContract({
  id: "extraction/parse-csv",
  title: "Parse CSV/XLSX into rows + detected columns",
  effect: "read",
  provenance: { default: "live" }, // observes these content-addressed bytes now
  freshness: { defaultMaxAgeMs: Infinity }, // content-addressed bytes do not age;
                                       // justified: re-parsing the same bytes is deterministic (grep ratchet).
  subject: { kind: "none", reason: "deterministic local artifact parsing" },
  scenarios: ["intake/csv/happy", "intake/csv/no-header", "intake/csv/duplicate-headers",
              "intake/csv/unreadable"],
  input:  z.strictObject({ fileRef: FileRefSchema, sheet: z.string().min(1).optional() }),
  output: z.strictObject({
    headerRowIndex: z.number().int().nullable(), // null means operator selection required
    headerCandidates: z.array(z.strictObject({ rowIndex:z.number().int(), cells:z.array(z.string()),
                                               confidence:z.number().min(0).max(1) })),
    columns: z.array(z.strictObject({ header: z.string(), index: z.number().int(),
                                      samples: z.array(z.string()) })), // sample values for the grid
    rows:    z.array(z.array(z.string())),                          // raw cell matrix, header-relative
  }),
  errorCodes: ["unreadable-file", "empty-sheet", "invalid-header-selection"],
  example: { /* … */ },
});
// parse-pdf-fields: same shape for a fielded PDF (onboarding's extraction step ports here).
```

- **Header discovery does not require a known alias.** The first 20 rows are ranked using generic
  structure (non-empty cell density, mostly-string cells, uniqueness, data rows beneath). Existing
  recognizable-header logic contributes confidence but is not a precondition. High confidence may
  preselect visibly; otherwise `headerRowIndex:null` and the operator chooses from candidate rows.
  The chosen row is re-parsed and validated before mapping.
- **Fail-loud stays.** Empty/unreadable sheets throw. If no plausible row exists, the UI requires an
  explicit row selection or rejects it; novel headings never abort before the mapping grid.
- The task is pure/deterministic; its output feeds §5's mapping+fan-out, never a write directly.

### 3.1 Phase-2h as-built — `extraction/extract-spreadsheet` (D149)

**The id is `extraction/extract-spreadsheet`, not `parse-csv`.** Doc 01 owns the id grammar and its
read verbs are `read|search|list|extract|match|verify`; `parse-` is not among them, and doc 01 §3.4's
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

`roster` matches one dataset against another (a mapped spreadsheet against extracted OCR records, or
two rosters), producing per-subject matches with confidence.

```ts
// src/domain/contracts/roster/match-spreadsheet.ts   (effect: "read")
export const MatchSpreadsheet = defineTaskContract({
  id: "roster/match-spreadsheet",
  title: "Match subjects against a roster",
  effect: "read",
  provenance: { default: "derived" }, // carries subject+roster sources/oldest observedAt
  /** D8: a roster match may feed a WRITE (an OnBase upload keyed on the matched
   *  EID). A stale match must not silently ride into that write on resume. The base maximum is 24h;
   *  a consuming workflow may narrow it, never widen it without a reviewed policy change. */
  freshness: { defaultMaxAgeMs: 24 * 60 * 60_000 },
  subject: { kind: "none", reason: "pure cross-source roster matching" },
  scenarios: ["roster/match/exact-eid", "roster/match/name-only", "roster/match/ambiguous",
              "roster/match/name-eid-conflict", "roster/match/no-match"],
  input:  z.strictObject({
    subjects: z.array(z.strictObject({ subjectId: StableItemIdSchema,
                                 name: fields.fullName.schema.optional(),
                                 eid:  fields.eid.schema.optional() })),
    rosterFileRef: FileRefSchema,
    mapping: ColumnMapping,                     // the roster is operator-mapped too (§2)
  }),
  output: z.array(z.strictObject({
    subjectId:       StableItemIdSchema,
    matchedEid:      fields.eid.schema.nullable(),
    matchConfidence: z.number().min(0).max(1),  // 0–1 — same axis as today
    tier:            z.enum(["high", "medium", "low"]),   // ported bucketing (below)
    mismatch:        z.enum(["none", "name-eid-conflict", "no-match", "ambiguous"]),
  })),
  errorCodes: ["roster-unreadable", "no-name-column"],
  example: { /* … */ },
});
```

- **Match confidence ports `match-confidence.ts` HONESTLY.** The confidence→tier thresholds
  (`high ≥ 0.6` = the backend `LLM_HIGH_CONFIDENCE` cutoff, `low < 0.4`, non-finite → `low`) are a
  **live-verified pure mapping** — they port **verbatim** into a domain module both the roster task
  and the dashboard badge import (no re-implementation). The *scoring* that produces the 0–1
  confidence (name/address/EID alignment) is **redesigned** onto the canonical fields and must be
  **re-verified** at the roster migration (order 3) — flagged as redesigned, not claimed
  live-verified.
- **Mismatch surfacing.** A `name-eid-conflict` (the roster's name and EID point at different people)
  or `ambiguous` (multiple candidates) is a **first-class output field**, not a swallowed default —
  the intake review (§5) and the OCR approval cards surface it exactly like today's `warnings` +
  `MatchConfidenceBadge`. A match the roster cannot make is `matchedEid: null` + `mismatch:"no-match"`
  (the caller then falls through to person-lookup), **never** a fabricated EID.
- **Freshness (D8).** Because a roster match can feed a write, the contract declares a finite
  `maxAgeMs`; the resume freshness walk (doc 02 §5.5) refuses a stale replayed match feeding a
  commit transaction, naming the roster + age + limit.

### 4.1 Mutable retention workbooks are serialized projections, not read-task side effects

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
doc 01's atomic writer, not arbitrary mutable paths.

### 4.2 Contact/address normalization is typed advice, not a silent fallback

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
                     fields: z.array(ContactFieldIdSchema).nonempty() }),
  ]),
});
```

Deterministic rules execute first. Provider-backed paths are individually observed and recorded;
one provider may try the next provider only through a declared, scenario-pinned provider policy.
Exhaustion is `advisory-unavailable`, not an empty change list. AI/geocoder values never overwrite
OCR/input silently: the review gate shows before/after/source/confidence and accepted changes become
operator-correction provenance. Ambiguous or unavailable **mandatory** fields block approval; truly
optional suggestions may yield `done-with-warnings` only under doc 12's evidence rule. The contract
uses a finite freshness budget for provider-derived facts and registers rule-only, each-provider,
rate-limit/failure, malformed-model-output, ambiguous, and approval/rejection scenarios.

---

### 4.3 Phase-2h as-built — OCR extraction admits three producers identically (D151)

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
each form HAS; `buildExtractionInstruction` derives the field list, per-field prompt, expected shape
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

**Routes 2 and 3 are usable now**, through `rebuild:cli ocr`:

```
rebuild:cli ocr forms                      which forms exist, and how many fields each demands
rebuild:cli ocr instruction <form-type>    the exact brief EVERY route receives
rebuild:cli ocr admit <submission.json>    run the gate; print the record or the problems
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

## 5. Intake pipeline: mapped dataset → N inputs, with a pre-run rejection review

The mapping (§2) + the parsed rows (§3) + any roster match (§4) compose into **N workflow inputs,
one per valid row**, feeding the run-surface fan-out (the multi-subject `operation` coordinator +
`operation-member` children, doc 02):

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

export const IntakePlanManifestSchema = z.strictObject({
  version: z.literal(1),
  planId: IntakePlanIdSchema,
  workflow: WorkflowIdSchema,
  source: z.strictObject({ artifactId: ArtifactIdSchema, sha256: Sha256Schema,
                           originalName: z.string().min(1) }),
  mappingFingerprint: Sha256Schema,
  mappingSnapshotHash: Sha256Schema,
  workflowContractFingerprint: FingerprintSchema,
  createdAt: IsoInstantSchema,
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

### 5.1 Mobile photo capture is a recoverable artifact-intake source

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
  CAS conflict. These are doc 03 D67 `CaptureCommandRequest` arms, not route-local mutations. Only
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
  queue, files, settings, evidence, and commands remain loopback-only (doc 12 §7).

Mandatory scenarios cover restart with an open session and restart mid-finalize, plus duplicate/
reordered phone requests, expired token, HEIC conversion, corrupt/empty image, bundle failure/retry,
wrong form/workflow binding, and attempts to reach a non-capture route through the phone origin.
The durable finalize-outbox fixture covers the publish/enqueue boundary without a restart-at-every-
state matrix. The dashboard shows session state, photo count/order, bundle digest/page count,
handoff run, expiry, and structured failure.

---

## 6. The Edit-Data surface (charter §12)

Edit Data is a **typed view of a run's checkpoint state**, edited through doc 02's `injected`
mechanism. It replaces the `prefilledData`/`splitPrefilled`/`save-data` side channel entirely.

### 6.1 Data source — fetch the snapshot, SSE only signals staleness

**Decision: the editable checkpoint snapshot is FETCHED (request/response), not SSE-streamed; the
per-run SSE topic is consumed only as an invalidation signal.** Justification:

- Checkpoints are **SQLite system-of-record** (D14) — low-frequency, not a stream.
- An editable form must be a **consistent point-in-time snapshot**; a form whose values mutate under
  the operator's cursor (a live SSE feed) is a footgun.
- Doc 03 already keeps per-run detail as request/response + a per-run SSE topic. Edit Data fetches
  the checkpoint snapshot on open (carrying a **generation token** — the run's `attempt` + the
  latest span sequence it was loaded against). The per-run SSE topic's `run.claimed`/`gate.resolved`
  events are consumed **only** to warn "this run just resumed — your edit is stale" (drives the
  fail-closed reject in §6.4 *before* the operator wastes effort).

The snapshot reads checkpoint values plus descriptor/contract/implementation fingerprints and
field-level provenance `{ source, observedAt?, correctedAt?, supersedes? }`.

### 6.2 What is editable vs read-only

| Run state | Edit Data |
|---|---|
| **Parked at a gate** (approval / await-signatures / identity-approval) | **Visible; explicitly declared fields editable.** Descriptor `capabilities.editData.fields` names node+field paths. Default is read-only, never "all checkpoint JSON." |
| **Stopped / failed** (terminal but resumable — `single`, real `operation-member`, D9) | Same explicit field policy; an accepted edit becomes `injected` on retry/resume. |
| **Running** (actively claimed, a live task owns a page) | **READ-ONLY** — the run's checkpoints are being written by the live task; editing not-yet-written state is meaningless and racy. Show live checkpoint state read-only. |
| **Terminal `done`** | **Read-only.** Correcting-and-rerunning a done item is the *separate* new-input path (§6.5), not Edit Data. |
| **Display-only rows** (operation coordinators, i9 display-only members) & **OCR per-page internals** | **No checkpoint Data section in Context** — D9 excludes them (nothing to resume). |

### 6.3 Editing = typed field patches; editing is not freshness

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

A parked run holds no browser (D5), so normally no task executes while the operator edits. But a
resume can be triggered concurrently (a watcher gate resolving, an operator elsewhere clicking
Retry). **Rule: the resume claim is the fence; the Edit-Data save is a compare-and-swap against it.**

- The operator loads the snapshot at generation `G` (`attempt` + span-seq).
- On Save, the UI issues doc 03's standard `edit-checkpoint` command. Its injected-checkpoint write
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

### 6.5 Edit Data before first start — the intake grid is a SEPARATE surface (shared core)

**Decision: the pre-first-start intake correction grid (§5) and checkpoint correction in the
Context rail's Data section are SEPARATE surfaces that share ONE pure per-cell coercion/validation
core.** Justification:

- They **parse against different schemas**: the intake grid parses each row against the *workflow
  input* schema (pre-run); Context Data correction parses each field against the *producing
  contract's output* schema (mid-run). Same UX ("loud per-cell error naming row/column/value"),
  different contract.
- They have **different lifecycles + endpoints**: doc 02 §5.6 #4 already mandates that new-input and
  injected are *separate endpoints* — "`injected` is rejected on a new-input run" so changed input
  can never silently ride stale context. Merging the two grids into one would blur exactly that
  boundary.
- Sharing the pure coercion/validation module (the successor of `validateEditField` +
  `mmddyyyyToYmd`) keeps the two surfaces consistent without coupling their contracts.

So: **intake grid** = correct cells before N inputs fan out (§5); **Context Data correction** =
correct a parked/stopped run's checkpoints before resume (§6.1–6.4). One validation core, two
surfaces, two endpoints. There is no separate Data/Edit Data tab or dialog.

---

## 7. Adversarial self-review — silent-fallback vectors and their guards

| # | Silent-fallback vector | Mechanical guard |
|---|---|---|
| 1 | **Fuzzy header auto-applies a wrong binding** (Name→fullName when Legal Name is the real one) | Suggestions are hints only; a guard asserts `ColumnMapping.bindings` is written ONLY by an operator action, never by the scorer. Fingerprint reuse pre-loads a *visible* mapping the operator still confirms (§2.3) |
| 2 | **Coercion swallows a bad cell** (a malformed EID becomes `""` or a guessed value) | `field.coerce` throws a per-cell error naming row/column/value; the cell becomes a **row rejection** (§5), never a substituted default. The `fail-loud-catch-default` + `nullish-literal-data-fallback` ratchets are re-implemented in the rebuild repo over its own `src/intake` from day one |
| 3 | **Mapping reuse on a changed/duplicate layout** | unambiguous canonical-JSON fingerprint; bindings resolve by header+occurrence; missing columns unmap; duplicate headings require visible sample confirmation; index never silently binds |
| 4 | **A rejected row silently vanishes (or a partial file launches)** | `Run` is disabled until the reject list is reviewed; only the `valid` set fans out; each reject carries row/column/value/reason and must be fixed or explicitly excluded (§5) — nothing half-launches |
| 5 | **An Edit-Data save races a resume and clobbers a running item** | The save is a CAS against the resume-claim fence at generation `G`; a concurrent claim → **loud reject, resume wins** (§6.4). Running-task checkpoints are read-only outright (§6.2) |
| 6 | **An intake projection re-declares a regex looser than its canonical field** | Guard asserts every *mapped* input key points at the same `CanonicalField.schema` object; non-intake workflow fields remain legal. The full assembled input still parses through the workflow schema; every migrated legacy EID fixture is audited against canonical `Eid`, and a truly distinct identifier must get a separately named/validated domain type (§1) |
| 7 | **Roster match fabricates an EID on no-match** | `matchedEid` is `nullable`; `mismatch:"no-match"` is a first-class output; the caller falls through to person-lookup — a guard bans `?? "<eid-literal>"`-shaped fallbacks in the roster impl |
| 8 | **A stale roster match rides into a write on resume** | finite field freshness + declared DAG walk refuses stale facts feeding a commit; an unrelated Edit Data patch cannot reset their observed time |
| 9 | **Novel headers never reach mapping** | parser candidate generation is alias-independent; fixture with zero known aliases must reach header selection + mapping rather than throw |
| 10 | **Edit Data changes identity or write proof** | Default read-only; descriptor allowlists exact node+field paths. Guard rejects item/match/idempotency/proof/provenance paths and paths absent from the producing schema; the full patched output re-parses |
| 11 | **A rerun called “same data” actually uses a changed file, mapping, or workflow schema** | rerun references an immutable `IntakePlanManifest`; artifact/mapping/contract hashes are compared and any difference requires a visible new-plan diff + confirmation |
| 12 | **A partial intake looks like all source rows completed** | coordinator/evidence receipt always shows source, valid, rejected, explicitly excluded, enqueued, and terminal counts; manifest/member insert is atomic and counts are invariant-checked |
| 13 | **Two target fields sharing one canonical concept overwrite each other** | bindings key on the intake projection's stable target-field id and also record its canonical field id; duplicate targets, changed projection fingerprints, or canonical mismatch fail before validation (D66) |

Honest residual (no full mechanical guard): the redesigned roster *scoring* (0–1 confidence) is only
verified at the roster migration (order 3) live-verify — the *tiering* ports verbatim, the *scoring*
is new code and must be re-checked against real rosters, not assumed.

---

## 8. Worked example — a work-study spreadsheet, end to end

Operator uploads `WorkStudy_July.xlsx` targeting the work-study workflow.

1. **Upload → parse.** `extraction/parse-csv` sniffs the header row and returns three columns:
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
   still records two rejection events and two corrections linked to the original cells. The mapping is saved under
   `config/column-mappings/work-study/<fingerprint>.json` for next week's identically-shaped export.
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

1. ~~Canonical EID width~~ — **resolved 2026-07-22:** adopt `/^10\d{6}$/` everywhere and audit the
   loose legacy consumers at migration. A genuinely different source identifier gets a distinct
   domain type and explicit conversion; there is no `legacyEid` escape hatch (§1).
2. ~~Mapping storage location~~ — **resolved 2026-07-21:** versioned, schema-validated JSON at
   `config/column-mappings/<workflow>/<fingerprint>.json`, written temp+fsync+rename. It is
   operator-greppable configuration, not run authority; malformed files fail loud and never fall
   back to a nearest mapping.
3. ~~Roster freshness budget~~ — **resolved 2026-07-22:** 24h is the conservative base maximum and
   consumers may narrow it. File mtime is not truth (copying a file changes it); freshness is the
   observation time of the immutable content-addressed roster artifact. Crossing the budget requires
   a new artifact/match or an allowed audited field override, never an mtime substitution (§4).
4. ~~Suggestion engine source of truth~~ — **resolved:** aliases live on `CanonicalField`; the
   suggestion engine consumes them but cannot write a mapping without operator action.
5. ~~Edit-Data on a `done` item~~ — **resolved:** read-only. Correction/rerun is always the separate
   new-input/new-item path; a done item's identity, proof, and checkpoints are never reopened.
