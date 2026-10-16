
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
CellCoercionError,
displayPersonName,
isCellCoercionError,
parseUsOrIsoDate,
parseUsStateCode,
} from "../../../src/models/fields/cell-coercion.js";
import {
CANONICAL_FIELDS,
CANONICAL_FIELD_IDS
} from "../../../src/models/fields/registry.js";
import { IntakeTargetFieldIdSchema,WorkflowIdSchema } from "../../../src/rules/identity/ids.js";

const REF = "2026-08-06T00:00:00.000Z";

const location = {
  workflow: WorkflowIdSchema.parse("work-study"),
  readAt: "2026-08-06T00:00:00.000Z",
  sourceRow: 12,
  header: "Employee ID#",
  targetFieldId: IntakeTargetFieldIdSchema.parse("emplId"),
};

function coerceAndParse(id: (typeof CANONICAL_FIELD_IDS)[number], raw: string): unknown {
  const field = CANONICAL_FIELDS[id];
  return field.schema.parse(field.coerce(raw, location));
}

function coercionFailure(id: (typeof CANONICAL_FIELD_IDS)[number], raw: string): CellCoercionError {
  try {
    CANONICAL_FIELDS[id].coerce(raw, location);
  } catch (error) {
    if (isCellCoercionError(error)) return error;
    throw error;
  }
  throw new Error(`${id} accepted ${JSON.stringify(raw)} when it should have refused`);
}

describe("ref data-intake-and-edit-data §2.4 per-cell coercion", () => {
  it("names the row, column, field and value in the message", () => {
    const failure = coercionFailure("eid", "10-4567");
    assert.equal(
      failure.message,
      'work-study intake, row 12, column "Employee ID#" (→ eid):\n'
        + '  value "10-4567" is not a UCPath EID (must be 10xxxxxx, 8 digits).',
    );
    assert.equal(failure.raw, "10-4567");
    assert.equal(failure.location.sourceRow, 12);
  });

  it("strips punctuation from an EID but refuses one that is not a UCPath id", () => {
    assert.equal(coerceAndParse("eid", " 10 456 712 "), "10456712");
    // The dangerous case: stripping punctuation from "10-4567" yields "104567",
    // which is a plausible-looking number and a DIFFERENT person if padded.
    assert.equal(coercionFailure("eid", "10-4567").reason.includes("not a UCPath EID"), true);
    assert.equal(coercionFailure("eid", "TBD").reason, "contains no digits");
    assert.equal(coercionFailure("eid", "20456712").reason.includes("not a UCPath EID"), true);
  });

  it("resolves a two-digit year against WHEN the value was read", () => {

    assert.equal(parseUsOrIsoDate("11/3/21", REF), "2021-11-03");
    assert.equal(parseUsOrIsoDate("4-23-26", REF), "2026-04-23");
    assert.equal(coerceAndParse("signatureDate", "11/3/21"), "2021-11-03");
    assert.equal(coerceAndParse("signatureDate", "4-23-26"), "2026-04-23");

    // Resolve two-digit years against observation time, allowing at most one year ahead.
    assert.equal(parseUsOrIsoDate("1/2/27", REF), "2027-01-02");
    assert.equal(parseUsOrIsoDate("1/2/28", REF), "1928-01-02");
    assert.equal(parseUsOrIsoDate("1/2/98", REF), "1998-01-02");
  });

  it("resolves the same value the same way whenever it is re-read", () => {
    // Bound to the OBSERVATION instant, not to `now`, so re-admitting a stored
    // submission years later cannot silently reinterpret its dates.
    const readIn2026 = parseUsOrIsoDate("1/2/27", "2026-08-06T00:00:00.000Z");
    const rereadIn2040 = parseUsOrIsoDate("1/2/27", "2026-08-06T00:00:00.000Z");
    assert.equal(readIn2026, rereadIn2040);
    // …and a value genuinely read in a different year may resolve differently,
    // which is correct: the century depends on when somebody looked at it.
    assert.equal(parseUsOrIsoDate("1/2/28", "2029-01-01T00:00:00.000Z"), "2028-01-02");
  });

  it("refuses a date that is not a real calendar day", () => {
    assert.equal(parseUsOrIsoDate("02/30/2026", REF), null);
    assert.equal(parseUsOrIsoDate("2026-02-29", REF), null);
    assert.equal(parseUsOrIsoDate("2024-02-29", REF), "2024-02-29");
    assert.equal(parseUsOrIsoDate("13/01/2026", REF), null);
  });

  it("refuses an unconverted Excel serial rather than reading it as a day", () => {
    assert.equal(parseUsOrIsoDate("45678", REF), null);
    assert.equal(coercionFailure("effectiveDate", "45678").raw, "45678");
  });

  it("accepts both the legacy MM/DD/YYYY wire form and ISO, normalizing to ISO", () => {
    assert.equal(coerceAndParse("effectiveDate", "07/01/2026"), "2026-07-01");
    assert.equal(coerceAndParse("effectiveDate", "7/1/2026"), "2026-07-01");
    assert.equal(coerceAndParse("effectiveDate", "2026-07-01"), "2026-07-01");
  });

  it("title-cases names and keeps the Last, First comma form", () => {
    assert.equal(displayPersonName("  battistessa,  johnnie r. "), "Battistessa, Johnnie R");
    assert.equal(displayPersonName("MARY-JANE o'brien"), "Mary-Jane O'Brien");
    assert.equal(coerceAndParse("fullName", "johnnie battistessa"), "Johnnie Battistessa");
    assert.equal(coercionFailure("fullName", "   ").reason, "is not a person name");
  });

  it("resolves a state name or code, and refuses anything else", () => {
    assert.equal(parseUsStateCode("California"), "CA");
    assert.equal(parseUsStateCode("ca"), "CA");
    assert.equal(parseUsStateCode("PR"), "PR");
    // No prefix or fuzzy matching: "Cal" is not a state, and guessing would put
    // a wrong address on a real record.
    assert.equal(parseUsStateCode("Cal"), null);
    assert.equal(parseUsStateCode("Californiaa"), null);
    assert.equal(coercionFailure("state", "Cal").reason.includes("not a US state"), true);
  });

  it("refuses a partial ZIP and an over-long one", () => {
    assert.equal(coerceAndParse("postalCode", "92093"), "92093");
    assert.equal(coerceAndParse("postalCode", "92093-0021"), "92093-0021");
    assert.equal(coercionFailure("postalCode", "9209").reason.includes("not a US ZIP"), true);
    assert.equal(coercionFailure("postalCode", "920931").reason.includes("not a US ZIP"), true);
  });

  it("keeps SSN digits exact rather than padding or truncating", () => {
    assert.equal(coerceAndParse("ssn", "920-74-1459"), "920741459");
    assert.equal(coercionFailure("ssn", "12345678").reason.includes("nine-digit"), true);
    assert.equal(coercionFailure("ssn", "1234567890").reason.includes("nine-digit"), true);
  });

  it("normalizes a phone to digits and refuses a cell with none", () => {
    assert.equal(coerceAndParse("cellPhone", "(858) 555-0134"), "8585550134");
    assert.equal(coercionFailure("cellPhone", "n/a").reason, "contains no digits");
  });

  it("treats a PPS id as its own identifier, never as an EID", () => {
    assert.equal(coerceAndParse("ppsEid", "00123456"), "00123456");
    // The same digits are NOT a UCPath EID, and nothing converts between them.
    assert.equal(coercionFailure("eid", "00123456").reason.includes("not a UCPath EID"), true);
  });
});
