import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { buildRunWorkbookSection } from "../../../src/backend/runs/workbooks.js";
import { VerifyWorkbookPerson } from "../../../src/models/processing/workbooks/verify-person.js";
import { PersonLookupResultSchema } from "../../../src/models/workflows/person-lookup/result.js";
import { createPersonLookupReferenceWorld, REFERENCE_PERSON } from "../../support/helpers/backend/person-lookup-reference-world.js";

const CheckWorkbookPersonChecks = VerifyWorkbookPerson.output.shape.checks;
const world = createPersonLookupReferenceWorld();
afterEach(world.cleanup);

type Fixture = Awaited<ReturnType<typeof world.fixture>>;
type Settled = Awaited<ReturnType<Fixture["run"]>>;
const SEARCH = { emplId: REFERENCE_PERSON.emplId };
/** A name no other fixture carries, so finding it anywhere in the timeline proves a row value leaked. */
const ROW_ONLY_NAME = "Zebedee Quillfeather";

function checkSpans(settled: Settled) {
  return settled.events.flatMap(event => event.payload.kind === "span" && event.payload.event.t === "span.ended" && event.payload.event.kind === "task"
    && event.payload.event.spanPath.includes("/reference-check#") ? [[event.payload.event.outcome, event.payload.event.notRunReason]] : []);
}
/** The check's observed Logs values, in the order the run recorded them. */
function checkLines(settled: Settled): readonly (readonly (string | undefined)[])[] {
  const lines: (string | undefined)[][] = [];
  for (const event of settled.events) {
    if (event.payload.kind !== "span" || event.payload.event.t !== "data.observed" || event.payload.event.nodeId !== "reference-check") continue;
    for (const point of event.payload.event.points) for (const value of point.values) {
      if (point.field !== "checks") continue;
      if (value.state !== "allowed") lines.push([value.state, undefined]);
      else for (const check of CheckWorkbookPersonChecks.parse(value.value)) lines.push([value.state, check.line]);
    }
  }
  return lines;
}
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
    assert.deepEqual(checkLines(settled), [["allowed", "Fall roster · Hires: found in row 3"]]);
    const served = buildRunWorkbookSection(f.database.authority, settled.run);
    assert.deepEqual([served.operations, served.referenceChoices ?? []], [[], []]);
  });

  it("reports a spreadsheet that does not hold the person and still finishes the lookup", async () => {
    const f = await world.fixture();
    const settled = await f.run(SEARCH, [f.spreadsheet("Badge list", "Issued", ["eid"], [["10000009"]])]);
    assert.equal(outcome(f, settled).state, "active");
    assert.deepEqual(checkLines(settled), [["allowed", "Badge list · Issued: not found"]]);
  });

  it("reports a different name on the person's row without recording any value from that row", async () => {
    const f = await world.fixture();
    const settled = await f.run(SEARCH, [f.spreadsheet("Fall roster", "Hires", ["fullName", "eid"], [[ROW_ONLY_NAME, REFERENCE_PERSON.emplId]])]);
    assert.equal(outcome(f, settled).state, "active");
    assert.deepEqual(checkLines(settled), [["allowed", "Fall roster · Hires: name differs in row 2"]]);
    assert.equal(JSON.stringify(settled.events).includes(ROW_ONLY_NAME), false);
    assert.equal(JSON.stringify(f.database.authority.runCheckpoints.listByItem(f.descriptor.id, settled.run.envelope.itemId)).includes(ROW_ONLY_NAME), false);
  });

  it("reports a name difference when the name column's cell is blank or not text", async () => {
    const f = await world.fixture();
    const settled = await f.run(SEARCH, [
      f.spreadsheet("Fall roster", "Hires", ["eid", "fullName"], [[REFERENCE_PERSON.emplId, ""]]),
      f.spreadsheet("Spring roster", "Hires", ["eid", "fullName"], [["10000009", "Blair Example"], [REFERENCE_PERSON.emplId, 20260101]]),
    ]);
    assert.equal(outcome(f, settled).state, "active");
    assert.deepEqual(checkLines(settled), [["allowed", "Fall roster · Hires: name differs in row 2"], ["allowed", "Spring roster · Hires: name differs in row 3"]]);
  });

  it("writes one line per picked spreadsheet, in pick order", async () => {
    const f = await world.fixture();
    const settled = await f.run(SEARCH, [
      f.spreadsheet("Badge list", "Issued", ["eid"], [["10000009"], ["10000003"]]),
      f.spreadsheet("Fall roster", "Hires", ["eid", "fullName"], [[Number(REFERENCE_PERSON.emplId), "Example, Avery"]]),
    ]);
    assert.deepEqual(checkLines(settled), [["allowed", "Badge list · Issued: not found"], ["allowed", "Fall roster · Hires: found in row 2"]]);
  });

  it("checks the person a Match run confirmed", async () => {
    const f = await world.fixture();
    const settled = await f.run({ mode: "match", lastName: "Example", firstName: "Avery", dob: "01/15/2000", ssn: "123456789" },
      [f.spreadsheet("Fall roster", "Hires", ["eid", "fullName"], [[REFERENCE_PERSON.emplId, "Avery Example"]])],
      ["searching", "active-status", "reference-check"]);
    assert.equal(outcome(f, settled).state, "found");
    assert.deepEqual(checkLines(settled), [["allowed", "Fall roster · Hires: found in row 2"]]);
  });

  it("has nothing to look up when the run found no person", async () => {
    const f = await world.fixture();
    const settled = await f.run({ emplId: "10000077" }, [f.spreadsheet("Fall roster", "Hires", ["eid"], [[REFERENCE_PERSON.emplId]])]);
    assert.equal(outcome(f, settled).state, "not-found");
    assert.deepEqual(checkSpans(settled), [["done", undefined]]);
    assert.deepEqual(checkLines(settled), []);
  });
});
