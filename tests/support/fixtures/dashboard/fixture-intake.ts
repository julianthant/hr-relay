
import { CANONICAL_FIELDS } from "../../../../src/models/fields/registry.js";
import { deriveItemId } from "../../../../src/rules/identity/identifiers.js";
import { ItemIdSchema } from "../../../../src/rules/identity/ids.js";
import { canonicalAliasIndex, rankHeaderRows } from "../../../../src/rules/intake/header-discovery.js";
import {
  ColumnBindingSchema,
  detectColumns,
  headerFingerprint,
  type ColumnBinding,
} from "../../../../src/models/intake/mapping.js";
import { suggestBindings } from "../../../../src/models/intake/suggestions.js";
import { validateIntakeRows } from "../../../../src/models/intake/validate.js";
import { IntakeSessionWireSchema, type IntakeSessionWire } from "../../../../src/models/intake/wire.js";
import { workflowPlanning } from "../../../../src/workflow-kit/workflow.js";
import { personLookupIntake } from "../../../../src/workflows/person-lookup/workflow.js";
import { personLookupDescriptor } from "../../helpers/registered-workflows.js";

// Use separate session ids for separate flow states; a hidden phase switch would not model the real route.
export const FIXTURE_INTAKE_IDS = Object.freeze({
  mapping: "7f1c9d20-4b6e-4a51-9c33-0b21d7e5a840",
  validated: "9a34be71-2c08-4d19-88f5-6e0b7c214d95",
  manifest: "0cda04a1-7fd8-4a3f-8a18-1f986c718d84",
  rerun: "55b3413d-1e04-47bb-b7cf-22e0371bbd99",
});
const FIXTURE_INTAKE_SHA256 = "3c9a71e0f2b84d5619ac7e0d5f4b2a18c6d3e9074b1f8a25c0e6d3b97a54f281";
const FIXTURE_INTAKE_ARTIFACT_ID = "b48e2c17-9d05-4e63-8a72-1f5c0d9b4e33";
const READ_AT = "2026-08-03T10:02:00.000-07:00";
const UPLOADED_AT = "2026-08-03T10:01:12.000-07:00";
const CONFIRMED_AT = "2026-08-03T10:02:40.000-07:00";

/** The whole sheet, header discovery included — row 0 is the export's title. */
const SHEET_ROWS: readonly (readonly string[])[] = [
  ["Onboarding roster — Cohort 7", "", "", ""],
  ["", "", "", ""],
  ["UCPath ID", "Employee Name", "Department", "Start Date"],
  ["10873698", "Battistessa, Johnnie", "Housing Dining Hospitality", "07/14/2026"],
  ["10001573", "Blirea, Glaundi", "Housing Dining Hospitality", "07/14/2026"],
  ["10-4567", "Okafor, Chidi", "Campus Recreation", "07/21/2026"],
  ["10554120", "Ramirez, Sofia", "Student Health", "07/21/2026"],
  ["10873698", "Battistessa, Johnnie", "Housing Dining Hospitality", "08/04/2026"],
  ["", "", "Facilities Management", "08/04/2026"],
  ["10221844", "Okonkwo, Amara", "Facilities Management", "08/11/2026"],
];

const HEADER_ROW_INDEX = 2;
const HEADER_CELLS = SHEET_ROWS[HEADER_ROW_INDEX];
const DATA_ROWS = SHEET_ROWS.slice(HEADER_ROW_INDEX + 1);

const SAMPLES_BY_INDEX = HEADER_CELLS.map((_header, index) =>
  DATA_ROWS.map((row) => row[index] ?? "").filter((cell) => cell.trim().length > 0).slice(0, 3));

const COLUMNS = detectColumns([...HEADER_CELLS], SAMPLES_BY_INDEX);
const LAYOUT_FINGERPRINT = headerFingerprint(COLUMNS);
const DISCOVERY = rankHeaderRows(SHEET_ROWS, canonicalAliasIndex(Object.values(CANONICAL_FIELDS)));

const EID_COLUMN = COLUMNS[0];
const NAME_COLUMN = COLUMNS[1];

const planning = workflowPlanning(personLookupDescriptor);

/** The one binding the operator has confirmed — `name` is left for the grid. */
const BINDINGS: readonly ColumnBinding[] = [
  ColumnBindingSchema.parse({
    targetFieldId: "emplId",
    canonicalFieldId: CANONICAL_FIELDS.eid.id,
    sourceColumnId: EID_COLUMN.sourceColumnId,
    confirmedAt: CONFIRMED_AT,
  }),
  ColumnBindingSchema.parse({
    targetFieldId: "name",
    canonicalFieldId: CANONICAL_FIELDS.fullName.id,
    sourceColumnId: NAME_COLUMN.sourceColumnId,
    confirmedAt: CONFIRMED_AT,
  }),
];

const VALIDATION = validateIntakeRows({
  workflow: String(personLookupDescriptor.id),
  sourceSha256: FIXTURE_INTAKE_SHA256,
  projection: personLookupIntake,
  detected: COLUMNS,
  bindings: BINDINGS,
  rows: DATA_ROWS,
  readAt: READ_AT,
  deriveItemId: (parsedInput) =>
    ItemIdSchema.parse(deriveItemId(String(personLookupDescriptor.id), planning.matchKey(parsedInput))),
});

const SUGGESTIONS = suggestBindings({
  workflow: String(personLookupDescriptor.id),
  detected: COLUMNS,
  projection: personLookupIntake,
  readAt: READ_AT,
});

function sessionWire(input: Readonly<{
  intakeSessionId: string;
  bindings: readonly ColumnBinding[];
  validated: boolean;
}>): IntakeSessionWire {
  return IntakeSessionWireSchema.parse({
    wireVersion: 1,
    intakeSessionId: input.intakeSessionId,
    workflow: String(personLookupDescriptor.id),
    artifact: {
      id: FIXTURE_INTAKE_ARTIFACT_ID,
      sha256: FIXTURE_INTAKE_SHA256,
      bytes: 612,
      mediaType: "text/csv",
    },
    sourceName: "cohort-7-onboarding.csv",
    state: input.validated ? "validated" : "mapping",
    expectedVersion: input.validated ? 4 : 3,
    createdAt: UPLOADED_AT,
    updatedAt: CONFIRMED_AT,
    sheets: ["Cohort 7"],
    sheet: "Cohort 7",
    headerCandidates: DISCOVERY.candidates.map(({ signals: _signals, ...rest }) => rest),
    headerDiscoveryReason: DISCOVERY.reason,
    headerRowIndex: HEADER_ROW_INDEX,
    headerFingerprint: LAYOUT_FINGERPRINT,
    columns: COLUMNS,
    rowCount: DATA_ROWS.length,
    targets: personLookupIntake.targets,
    bindings: input.bindings,
    constants: [],
    corrections: [],
    exclusions: [],
    suggestions: SUGGESTIONS,
    validation: input.validated
      ? {
        state: "validated",
        validatedAt: READ_AT,
        readAt: READ_AT,
        validRows: VALIDATION.valid.length,
        unresolvedRows: [...VALIDATION.currentRejects].filter(([row, rejects]) => rejects.length > 0 && !VALIDATION.excluded.includes(row)).map(([row]) => row).sort((a, b) => a - b),
        rejected: VALIDATION.rejected,
        excluded: VALIDATION.excluded,
      }
      : { state: "none" },
  });
}


export const FIXTURE_INTAKE_MAPPING = sessionWire({
  intakeSessionId: FIXTURE_INTAKE_IDS.mapping,
  bindings: [BINDINGS[0]],
  validated: false,
});

/** Post-validation: the rejection review over the real pipeline's verdicts. */
export const FIXTURE_INTAKE_VALIDATED = sessionWire({
  intakeSessionId: FIXTURE_INTAKE_IDS.validated,
  bindings: BINDINGS,
  validated: true,
});

const FIXTURE_MANIFEST_ID = "7b92095b-bb90-4ca2-b373-8402790fb7f8";
const FIXTURE_MANIFEST_CREATED_AT = "2026-08-03T10:04:00.000-07:00";
const [FIRST_VALID, SECOND_VALID, THIRD_VALID] = VALIDATION.valid;
if (FIRST_VALID === undefined || SECOND_VALID === undefined || THIRD_VALID === undefined) {
  throw new Error("the intake parity fixture requires three valid rows for the manifest and rerun stages");
}

const FIXTURE_MANIFEST = {
  manifestId: FIXTURE_MANIFEST_ID,
  mappingFingerprint: LAYOUT_FINGERPRINT,
  mappingSnapshotHash: FIXTURE_INTAKE_SHA256,
  intakeProjectionFingerprint: FIXTURE_INTAKE_SHA256,
  workflowContractFingerprint: FIXTURE_INTAKE_SHA256,
  canonicalInputSchemaHash: FIXTURE_INTAKE_SHA256,
  createdAt: FIXTURE_MANIFEST_CREATED_AT,
  totals: {
    sourceRows: DATA_ROWS.length,
    valid: VALIDATION.valid.length,
    rejected: DATA_ROWS.length - VALIDATION.valid.length,
    rejectionEvents: VALIDATION.rejected.length,
    excluded: 0,
    corrected: 0,
  },
  sourceRowDispositions: DATA_ROWS.map((_, index) => {
    const sourceRow = index + 1;
    const valid = VALIDATION.valid.find((row) => row.sourceRow === sourceRow);
    return valid === undefined
      ? { sourceRow, disposition: "rejected" as const, currentRejectIds: [...(VALIDATION.currentRejects.get(sourceRow) ?? [])] }
      : { sourceRow, disposition: "valid" as const, itemId: valid.itemId, currentRejectIds: [] };
  }),
  validRows: VALIDATION.valid,
};

/** A committed identity and immutable terminal projection for the Manifest tab. */
export const FIXTURE_INTAKE_MANIFEST = IntakeSessionWireSchema.parse({
  ...FIXTURE_INTAKE_VALIDATED,
  intakeSessionId: FIXTURE_INTAKE_IDS.manifest,
  state: "enqueued",
  expectedVersion: 5,
  reservedManifestId: FIXTURE_MANIFEST_ID,
  intakeManifestId: FIXTURE_MANIFEST_ID,
  manifest: FIXTURE_MANIFEST,
  rerun: {
    intakeManifestId: FIXTURE_MANIFEST_ID,
    createdAt: FIXTURE_MANIFEST_CREATED_AT,
    totals: FIXTURE_MANIFEST.totals,
    diff: { kind: "same-plan" },
  },
});


export const FIXTURE_INTAKE_RERUN = IntakeSessionWireSchema.parse({
  ...FIXTURE_INTAKE_VALIDATED,
  intakeSessionId: FIXTURE_INTAKE_IDS.rerun,
  reservedManifestId: "d94663c1-8b04-48d7-abfa-d78fa46fd2cf",
  rerun: {
    intakeManifestId: FIXTURE_MANIFEST_ID,
    createdAt: FIXTURE_MANIFEST_CREATED_AT,
    totals: FIXTURE_MANIFEST.totals,
    diff: {
      kind: "changed",
      changes: [{ what: "mapping", was: "a".repeat(64), now: "b".repeat(64) }],
      added: [{ ...FIRST_VALID, inputHash: "638250505a35ab6673f79f1d17bb61766c820f10356d0d26f5b6dd75dfa38f15" }],
      removed: [{ ...SECOND_VALID, inputHash: "19a6750440132371e5250611020b20f39659744004927b35b8b699a1d98c6904" }],
      changedInputs: [{
        itemId: THIRD_VALID.itemId,
        beforeInputHash: "c".repeat(64),
        afterInputHash: "d".repeat(64),
      }],
    },
  },
});

export const FIXTURE_INTAKE_SESSIONS: Readonly<Record<string, IntakeSessionWire>> = Object.freeze({
  [FIXTURE_INTAKE_IDS.mapping]: FIXTURE_INTAKE_MAPPING,
  [FIXTURE_INTAKE_IDS.validated]: FIXTURE_INTAKE_VALIDATED,
  [FIXTURE_INTAKE_IDS.manifest]: FIXTURE_INTAKE_MANIFEST,
  [FIXTURE_INTAKE_IDS.rerun]: FIXTURE_INTAKE_RERUN,
});
