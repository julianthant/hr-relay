/**
 * The intake corpus for parity adapter #1 (doc 13 §7.2, 2i-E3).
 *
 * Nothing here is a hand-typed wire payload. A grid of cells goes in, and the
 * REAL domain functions produce every derived fact on the way out — the ranked
 * header candidates, the column ids and their layout fingerprint, the
 * suggestion scores and their reasons, and the per-row dispositions from the
 * one validation pipeline the kernel itself runs. That is what makes these
 * references evidence: a screenshot of a suggestion score is a screenshot of
 * what the scorer actually returns, and a change to the scorer moves the
 * picture rather than quietly disagreeing with it.
 *
 * The grid is deliberately awkward in the ways real exports are — a title row
 * and a blank row above the headers, an EID with a dash in it, one person
 * listed twice, and a row with neither identifier — because the states worth
 * photographing are the ones where the operator has to decide something.
 */
import { CANONICAL_FIELDS } from "../../../src/domain/fields/registry.js";
import { deriveItemId } from "../../../src/domain/identifiers.js";
import { ItemIdSchema } from "../../../src/domain/ids.js";
import { canonicalAliasIndex, rankHeaderRows } from "../../../src/domain/intake/header-discovery.js";
import {
  ColumnBindingSchema,
  detectColumns,
  headerFingerprint,
  type ColumnBinding,
} from "../../../src/domain/intake/mapping.js";
import { suggestBindings } from "../../../src/domain/intake/suggestions.js";
import { validateIntakeRows } from "../../../src/domain/intake/validate.js";
import { IntakeSessionWireSchema, type IntakeSessionWire } from "../../../src/domain/intake/wire.js";
import { workflowPlanning } from "../../../src/base/workflow.js";
import { personLookupDescriptor } from "../../../src/workflows/person-lookup/descriptor.js";
import { personLookupIntake } from "../../../src/workflows/person-lookup/module.js";

/**
 * Two sessions, because the two states worth photographing are two POINTS IN
 * ONE FLOW and the workspace addresses a session by id. Giving them one id and
 * a hidden toggle would have made the reference set depend on a control the
 * product does not have.
 */
export const FIXTURE_INTAKE_IDS = Object.freeze({
  mapping: "7f1c9d20-4b6e-4a51-9c33-0b21d7e5a840",
  validated: "9a34be71-2c08-4d19-88f5-6e0b7c214d95",
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
        rejected: VALIDATION.rejected,
        excluded: VALIDATION.excluded,
      }
      : { state: "none" },
  });
}

/**
 * Mid-mapping: `emplId` is bound, `name` is not, and the scorer's proposal for
 * it sits beside the empty control. This is the state the whole design exists
 * for — a decision and a proposal on one row, told apart by where they are.
 */
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

export const FIXTURE_INTAKE_SESSIONS: Readonly<Record<string, IntakeSessionWire>> = Object.freeze({
  [FIXTURE_INTAKE_IDS.mapping]: FIXTURE_INTAKE_MAPPING,
  [FIXTURE_INTAKE_IDS.validated]: FIXTURE_INTAKE_VALIDATED,
});
