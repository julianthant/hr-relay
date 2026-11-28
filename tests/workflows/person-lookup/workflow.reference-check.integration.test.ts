import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { buildRunWorkbookSection } from "../../../src/backend/runs/workbooks.js";
import { referenceCheckLines } from "../../support/helpers/backend/reference-check-lines.js";
import { PersonLookupResultSchema } from "../../../src/models/workflows/person-lookup/result.js";
import { createPersonLookupReferenceWorld, REFERENCE_PERSON } from "../../support/helpers/backend/person-lookup-reference-world.js";

const world = createPersonLookupReferenceWorld();
afterEach(world.cleanup);

type Fixture = Awaited<ReturnType<typeof world.fixture>>;
type Settled = Awaited<ReturnType<Fixture["run"]>>;
const SEARCH = { emplId: REFERENCE_PERSON.emplId };
/** A name no other fixture carries, so finding it anywhere in the timeline proves a row value leaked. */
const ROW_ONLY_NAME = "Zebedee Quillfeather";

function checkSpans(settled: Settled) {
  return settled.events.flatMap(event => event.payload.kind === "span" && event.payload.event.t === "span.ended" && event.payload.event.kind === "task"
    && event.payload.event.spanPath.includes("/reference-fields-start#") ? [[event.payload.event.outcome, event.payload.event.notRunReason]] : []);
}
const checkLines = (settled: Settled) => referenceCheckLines(settled.events);
function outcome(f: Fixture, settled: Settled) {
  assert.equal(settled.run.lifecycle.state, "terminal");
  assert.deepEqual(f.database.authority.failures.listByRun(settled.run.envelope.runId).map(failure => `${failure.code}: ${failure.summary}`), []);
  const result = f.database.authority.runResults.get(settled.run.envelope.runId); assert.ok(result);
  return PersonLookupResultSchema.parse(result.result.value).activeStatus;
}

describe("Person Lookup reference spreadsheet check", () => {
  it("skips the check and changes nothing else when no spreadsheet is picked", async () => {
    const f = await world.fixture(), settled = await f.run(SEARCH, []);
    assert.equal(outcome(f, settled).state, "active");
    assert.equal(settled.run.input.workbookReferences, undefined);
    assert.deepEqual(checkSpans(settled), [["skipped", "condition-false"]]);
    assert.deepEqual(checkLines(settled), []);
  });

  it("workbooks/verify-person — reports the row of a spreadsheet that holds the person", async () => {
    const f = await world.fixture();
    const settled = await f.run(SEARCH, [f.spreadsheet("Fall roster", "Hires", ["eid", "fullName"], [["10000009", "Blair Example"], [REFERENCE_PERSON.emplId, "Avery Example"]])]);
    assert.equal(outcome(f, settled).state, "active");
    assert.deepEqual(checkSpans(settled), [["done", undefined]]);
    assert.deepEqual(checkLines(settled), ["Hires, row 3: Employee ID matches", "Hires, row 3: Legal name matches"]);
    const served = buildRunWorkbookSection(f.database.authority, settled.run);
    assert.deepEqual([served.operations, served.referenceChoices ?? []], [[], []]);
  });

  it("reports a spreadsheet that does not hold the person and still finishes the lookup", async () => {
    const f = await world.fixture();
    const settled = await f.run(SEARCH, [f.spreadsheet("Badge list", "Issued", ["eid"], [["10000009"]])]);
    assert.equal(outcome(f, settled).state, "active");
    assert.deepEqual(checkLines(settled), ["Not in Issued"]);
  });

  it("parks at the later name mismatch and keeps the row value out of the timeline", async () => {
    const f = await world.fixture();
    const settled = await f.run(SEARCH, [f.spreadsheet("Fall roster", "Hires", ["fullName", "eid"], [[ROW_ONLY_NAME, REFERENCE_PERSON.emplId]])]);
    assert.ok(settled.run.lifecycle.state === "parked-gate" && settled.run.lifecycle.gateId === "reference-field-review-search-identity");
    assert.deepEqual(checkLines(settled), ["Hires, row 2: Employee ID matches", "Hires, row 2: Legal name differs"]);
    assert.equal(JSON.stringify(settled.events).includes(ROW_ONLY_NAME), false);
  });

  it("reports a name difference when the name column's cell is blank or not text", async () => {
    const f = await world.fixture();
    const settled = await f.run(SEARCH, [
      f.spreadsheet("Fall roster", "Hires", ["eid", "fullName"], [[REFERENCE_PERSON.emplId, ""]]),
      f.spreadsheet("Spring roster", "Hires", ["eid", "fullName"], [["10000009", "Blair Example"], [REFERENCE_PERSON.emplId, 20260101]]),
    ]);
    assert.equal(settled.run.lifecycle.state, "parked-gate");
    assert.deepEqual(checkLines(settled), ["Hires, row 2: Employee ID matches", "Hires, row 3: Employee ID matches", "Hires, row 2: Legal name differs", "Hires, row 3: Legal name differs"]);
  });

  it("compares both picks and logs the missing sheet once", async () => {
    const f = await world.fixture();
    const settled = await f.run(SEARCH, [
      f.spreadsheet("Badge list", "Issued", ["eid"], [["10000009"], ["10000003"]]),
      f.spreadsheet("Fall roster", "Hires", ["eid", "fullName"], [[Number(REFERENCE_PERSON.emplId), "Example, Avery"]]),
    ]);
    assert.deepEqual(checkLines(settled), ["Not in Issued", "Hires, row 2: Employee ID matches", "Hires, row 2: Legal name matches"]);
  });

  it("checks the person a Match run confirmed", async () => {
    const f = await world.fixture();
    const settled = await f.run({ mode: "match", lastName: "Example", firstName: "Avery", dob: "01/15/2000", ssn: "123456789" },
      [f.spreadsheet("Fall roster", "Hires", ["eid", "fullName"], [[REFERENCE_PERSON.emplId, "Avery Example"]])],
      ["searching", "active-status", "reference-check"]);
    assert.equal(outcome(f, settled).state, "found");
    assert.deepEqual(checkLines(settled), ["Hires, row 2: Employee ID matches", "Hires, row 2: Legal name matches"]);
  });

  it("does not use a matching name as a workbook key", async () => {
    const f = await world.fixture();
    const settled = await f.run({ name: "Example, Unresolved" }, [
      f.spreadsheet("Fall roster", "Hires", ["eid", "fullName"], [[REFERENCE_PERSON.emplId, "Example, Unresolved"]]),
    ]);
    assert.equal(outcome(f, settled).state, "not-found");
    assert.deepEqual(checkSpans(settled), [["done", undefined]]);
    assert.deepEqual(checkLines(settled), ["Reference not checked: no Employee ID"]);
  });

  it("resolves an Employee ID from a name-first search and compares both fields once", async () => {
    const f = await world.fixture();
    const settled = await f.run({ name: REFERENCE_PERSON.name }, [
      f.spreadsheet("Fall roster", "Hires", ["eid", "fullName"], [[REFERENCE_PERSON.emplId, "Avery Example"]]),
    ]);
    assert.equal(outcome(f, settled).state, "active");
    assert.deepEqual(checkLines(settled), ["Hires, row 2: Legal name matches", "Hires, row 2: Employee ID matches"]);
  });
});
