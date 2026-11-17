import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createOperatorProjection, createOperatorRunDetail } from "../../../src/backend/app/composition/dashboard/operator.js";
import { buildRunDetail, buildRunSection } from "../../../src/backend/runs/queries/run-detail.js";
import { projectStartRows } from "../../../src/backend/runs/start/step-selection.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import type { StepOmissions } from "../../../src/models/workflow/step-omission.js";
import { PersonLookupResultSchema } from "../../../src/models/workflows/person-lookup/result.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { testRunService } from "../../support/fixtures/run-lifecycle-fixtures.js";
import { createPersonLookupReferenceWorld, REFERENCE_PERSON } from "../../support/helpers/backend/person-lookup-reference-world.js";

const world = createPersonLookupReferenceWorld();
afterEach(world.cleanup);

type Fixture = Awaited<ReturnType<typeof world.fixture>>;
const SEARCH = { emplId: REFERENCE_PERSON.emplId };
const STEPS = ["searching", "cross-verify", "active-status", "crm-dates", "reference-check"] as const;
const except = (...off: readonly string[]) => STEPS.filter(step => !off.includes(step));

/** Runs one Search through the real start plan with the named steps switched off and the given typed values. */
async function typedRun(f: Fixture, off: readonly string[], stepOmissions?: StepOmissions) {
  const settled = await f.run(SEARCH, [], except(...off), stepOmissions);
  const run = settled.run;
  assert.equal(run.lifecycle.state, "terminal");
  assert.deepEqual(f.database.authority.failures.listByRun(run.envelope.runId).map(failure => `${failure.code}: ${failure.summary}`), []);
  const stored = f.database.authority.runResults.get(run.envelope.runId);
  assert.ok(stored);
  const checkpoint = (nodeId: string) => {
    const rows = f.database.authority.runCheckpoints.listByAttempt(run.envelope.workflow, run.envelope.itemId, nodeId, run.envelope.attempt)
      .filter(row => row.runId === run.envelope.runId);
    return rows.at(-1);
  };
  return { settled, run, stored, result: PersonLookupResultSchema.parse(stored.result.value), checkpoint };
}

/** The checkpoint leaves the operator typed: each carries `source: "operator"` under the step's assertion. */
function typedLeaves(row: ReturnType<Awaited<ReturnType<typeof typedRun>>["checkpoint"]>) {
  assert.ok(row);
  return { step: row.assertion?.step, operator: row.provenance.filter(point => point.source === "operator").map(point => String(point.path)) };
}

/** The served run detail and Run data of one run, as the dashboard reads them. */
function served(f: Fixture, runId: string) {
  const reader = testRunService(f.database, f.harness.authority.clock);
  const descriptors = { resolve: (id: string) => id === f.descriptor.id ? f.descriptor : undefined };
  const projection = createOperatorProjection({ database: f.database, stateRoot: f.harness.authority.stateRoot, clock: f.harness.authority.clock, reader, appVersion: "0.1.0",
    descriptorSetHash: FingerprintSchema.parse("a".repeat(64)), ledger: createTransactionHistory(f.database.authority), descriptors });
  projection.ingestFromTimeline();
  const deps = createOperatorRunDetail({ database: f.database, stateRoot: f.harness.authority.stateRoot, projection, runReader: reader,
    canonical: { database: f.database, reader, descriptors } });
  const detail = buildRunDetail(deps, runId);
  const data = buildRunSection(deps, runId, "context-data");
  return {
    members: (step: string) => detail.timeline.steps?.find(entry => entry.key === step)?.members.map(member => [member.nodeId, member.state, member.notRunReason]),
    omittedSteps: detail.omittedSteps,
    data: data.section === "context-data" && data.payload.state === "available"
      ? data.payload.entries.map(entry => [String(entry.coordinate.nodeId), String(entry.coordinate.fieldPath), entry.valueRedacted, entry.source, entry.assertedStep])
      : data,
  };
}

describe("Person Lookup Read CRM dates typed by hand", () => {
  const DATES = { employmentDate: "2031-03-14", oathDate: "2031-03-10" };

  it("uses the typed employment and oath dates in the result and records each as typed by hand", async () => {
    const f = await world.fixture();
    const typed = await typedRun(f, ["crm-dates"], [{ step: "crm-dates", facts: DATES }]);
    assert.deepEqual(typed.result.crmDates, { state: "included", dates: { state: "read", emplId: REFERENCE_PERSON.emplId, ...DATES, reason: "" } });
    assert.deepEqual(typedLeaves(typed.checkpoint("crm-dates")), { step: "crm-dates", operator: ["emplId", "employmentDate", "oathDate", "reason", "state"] });
    assert.deepEqual(typed.stored.dependencies.filter(entry => entry.state === "asserted").map(entry => [entry.nodeId, entry.state === "asserted" ? entry.step : undefined]),
      [["crm-dates", "crm-dates"]]);
    const wire = served(f, typed.run.envelope.runId);
    assert.deepEqual(wire.members("crm-dates"), [["crm-dates", "skipped", "operator-asserted"]]);
    assert.deepEqual(wire.data, [
      ["crm-dates", "employmentDate", DATES.employmentDate, "operator", "crm-dates"],
      ["crm-dates", "oathDate", DATES.oathDate, "operator", "crm-dates"],
    ]);
  });

  it("skips the read, as today, when switched off with nothing typed", async () => {
    const f = await world.fixture();
    const typed = await typedRun(f, ["crm-dates"]);
    assert.deepEqual(typed.result.crmDates, { state: "not-requested" });
    assert.equal(typed.checkpoint("crm-dates"), undefined);
    assert.deepEqual(served(f, typed.run.envelope.runId).members("crm-dates"), [["crm-dates", "skipped", "condition-false"]]);
  });
});

describe("Person Lookup Read employment status typed by hand", () => {
  const STATUS = { state: "inactive", hrStatus: "Terminated", startDate: "06/15/2026", endDate: "04/25/2031", terminationReason: "Appointment ended", ucpath: "Found" };

  it("uses the typed status and details in the result and in the CRM dates read, and records each as typed by hand", async () => {
    const f = await world.fixture();
    const typed = await typedRun(f, ["active-status"], [{ step: "active-status", facts: STATUS }]);
    const { activeStatus } = typed.result;
    assert.equal(activeStatus.state, "inactive");
    assert.equal(activeStatus.reason, "");
    assert.deepEqual([activeStatus.details.hrStatus, activeStatus.details.startDate, activeStatus.details.endDate, activeStatus.details.terminationReason,
      activeStatus.details.ucpath, activeStatus.details.foundInUcpath], ["Terminated", "06/15/2026", "04/25/2031", "Appointment ended", "Found", true]);
    // The run's own identity reads still name the person, and the CRM dates read is keyed by it.
    assert.deepEqual([activeStatus.details.eid, activeStatus.details.name, activeStatus.datesEid], [REFERENCE_PERSON.emplId, REFERENCE_PERSON.name, REFERENCE_PERSON.emplId]);
    assert.equal(typed.result.crmDates.state, "included");
    const leaves = typedLeaves(typed.checkpoint("active-status"));
    assert.equal(leaves.step, "active-status");
    for (const path of ["state", "details.hrStatus", "details.startDate", "details.endDate", "details.terminationReason", "details.ucpath", "details.foundInUcpath"]) {
      assert.ok(leaves.operator.includes(path), path);
    }
    assert.equal(typed.checkpoint("active-status")?.provenance.every(point => point.source === "operator"), true);
    assert.equal(typed.checkpoint("crm-only-recovery"), undefined);
    assert.deepEqual(typed.stored.dependencies.filter(entry => entry.state === "asserted").map(entry => entry.nodeId), ["active-status"]);
    assert.deepEqual(served(f, typed.run.envelope.runId).members("active-status"), [["crm-only-recovery", "skipped", "step-omitted"], ["active-status", "skipped", "operator-asserted"]]);
  });

  it("stores a blank optional detail as null", async () => {
    const f = await world.fixture();
    const typed = await typedRun(f, ["active-status"], [{ step: "active-status", facts: { ...STATUS, state: "active", hrStatus: null, startDate: null, endDate: null, terminationReason: null } }]);
    const { details } = typed.result.activeStatus;
    assert.deepEqual([typed.result.activeStatus.state, details.hrStatus, details.startDate, details.endDate, details.terminationReason], ["active", null, null, null, null]);
  });
});

describe("Person Lookup Cross-check identity typed by hand", () => {
  const CRM = { name: "Example, Avery Jo", firstDayOfService: "07/01/2026" };

  it("uses the typed CRM name and start date in the result and records each as typed by hand", async () => {
    const f = await world.fixture();
    const typed = await typedRun(f, ["cross-verify"], [{ step: "cross-verify", facts: CRM }]);
    const { details } = typed.result.activeStatus;
    assert.deepEqual([typed.result.activeStatus.state, details.crm, details.startDate], ["active", "Found", CRM.firstDayOfService]);
    const identity = typed.checkpoint("crm-identity");
    assert.deepEqual(identity?.output.value && (identity.output.value as { crmIdentity: unknown }).crmIdentity,
      { emplId: REFERENCE_PERSON.emplId, name: CRM.name, department: null, firstDayOfService: CRM.firstDayOfService });
    const leaves = typedLeaves(identity);
    assert.equal(leaves.step, "cross-verify");
    for (const path of ["crmIdentity.name", "crmIdentity.firstDayOfService"]) assert.ok(leaves.operator.includes(path), path);
    assert.deepEqual(typed.stored.dependencies.filter(entry => entry.state === "asserted").map(entry => entry.nodeId), ["crm-identity"]);
    assert.deepEqual(served(f, typed.run.envelope.runId).members("cross-verify"), [
      ["cross-verify", "skipped", "step-omitted"], ["crm-identity", "skipped", "operator-asserted"],
      ["crm-selected-record", "skipped", "condition-false"], ["crm-results", "skipped", "condition-false"],
    ]);
  });

  it("names the person by the typed CRM name when UCPath does not hold the searched Employee ID", async () => {
    const f = await world.fixture();
    const settled = await f.run({ emplId: "10000002" }, [], except("cross-verify", "crm-dates"), [{ step: "cross-verify", facts: CRM }]);
    const stored = f.database.authority.runResults.get(settled.run.envelope.runId);
    assert.ok(stored);
    const { activeStatus } = PersonLookupResultSchema.parse(stored.result.value);
    assert.deepEqual([activeStatus.state, activeStatus.details.eid, activeStatus.details.name, activeStatus.details.crm], ["crm-only", "10000002", CRM.name, "Found"]);
  });

  it("skips the CRM check, as today, when switched off with nothing typed", async () => {
    const f = await world.fixture();
    const typed = await typedRun(f, ["cross-verify", "crm-dates"]);
    assert.equal(typed.result.activeStatus.details.crm, "Not checked");
    assert.equal(typed.checkpoint("crm-identity"), undefined);
    assert.deepEqual(served(f, typed.run.envelope.runId).members("cross-verify")?.map(([, state, reason]) => [state, reason]),
      [["skipped", "condition-false"], ["skipped", "condition-false"], ["skipped", "condition-false"], ["skipped", "condition-false"]]);
  });
});

describe("Person Lookup Search for person typed by hand", () => {
  const PERSON = { emplId: REFERENCE_PERSON.emplId, name: "Typed, Robin", department: "Typed Department", jobTitle: "Typed Title",
    hrStatus: "Leave of Absence", employeeStatus: "inactive", hdh: false };
  const SELECTED = ["emplId", "name", "department", "jobTitle", "hrStatus", "employeeStatus", "hdh"].map(path => `selected.${path}`);

  it("uses the typed person in the CRM check and the result in Search mode, and records each as typed by hand", async () => {
    const f = await world.fixture();
    const typed = await typedRun(f, ["searching"], [{ step: "searching", facts: PERSON }]);
    const { activeStatus } = typed.result;
    assert.deepEqual([activeStatus.state, activeStatus.reason, activeStatus.hdh], ["inactive", "UCPath reports Leave of Absence", false]);
    assert.deepEqual([activeStatus.details.eid, activeStatus.details.name, activeStatus.details.department, activeStatus.details.hrStatus, activeStatus.details.ucpath],
      [PERSON.emplId, PERSON.name, PERSON.department, PERSON.hrStatus, "Found"]);
    // The CRM search still ran under the typed Employee ID and found its record.
    assert.equal(activeStatus.details.crm, "Found");
    const identity = typed.checkpoint("search-identity");
    assert.deepEqual((identity?.output.value as { selected: unknown }).selected,
      { ...PERSON, startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "" });
    const leaves = typedLeaves(identity);
    assert.equal(leaves.step, "searching");
    for (const path of SELECTED) assert.ok(leaves.operator.includes(path), path);
    assert.equal(typedLeaves(typed.checkpoint("searching")).step, "searching");
    // The CRM check resolved over the typed person: no UCPath read span is credited for the typed leaves.
    const crmIdentity = typed.checkpoint("crm-identity");
    const selectedOrigins = crmIdentity?.observationOrigins?.filter(entry => entry.path[0] === "selected") ?? [];
    assert.equal(selectedOrigins.length, SELECTED.length + 4);
    assert.deepEqual([...new Set(selectedOrigins.map(entry => entry.origin.nodeId))], ["crm-identity"]);
    assert.equal(typed.checkpoint("matching"), undefined);
    assert.deepEqual(typed.stored.dependencies.filter(entry => entry.state === "asserted").map(entry => entry.nodeId), ["search-identity"]);
    assert.deepEqual(served(f, typed.run.envelope.runId).members("searching"), [
      ["searching", "skipped", "operator-asserted"], ["matching", "skipped", "condition-false"], ["search-identity", "skipped", "operator-asserted"],
    ]);
  });

  it("takes the typed Employee ID as the person when the search is by name", async () => {
    const f = await world.fixture();
    const settled = await f.run({ name: "Someone, Else" }, [], except("searching"), [{ step: "searching", facts: PERSON }]);
    const stored = f.database.authority.runResults.get(settled.run.envelope.runId);
    assert.ok(stored);
    const { activeStatus } = PersonLookupResultSchema.parse(stored.result.value);
    assert.deepEqual([activeStatus.state, activeStatus.details.eid, activeStatus.details.name, activeStatus.details.crm], ["inactive", PERSON.emplId, PERSON.name, "Found"]);
  });

  it("records the typed person as the Match mode identity without reading UCPath", async () => {
    const f = await world.fixture();
    const settled = await f.run({ mode: "match", lastName: "Nobody", firstName: "Here", dob: "01/15/2000", includeCrmDates: false }, [], except("searching", "crm-dates"), [{ step: "searching", facts: PERSON }]);
    assert.equal(settled.run.lifecycle.state, "terminal");
    const rows = (nodeId: string) => f.database.authority.runCheckpoints.listByAttempt(settled.run.envelope.workflow, settled.run.envelope.itemId, nodeId, settled.run.envelope.attempt)
      .filter(row => row.runId === settled.run.envelope.runId);
    assert.deepEqual(rows("searching"), []);
    assert.deepEqual(rows("matching").at(-1)?.output.value, { hits: [{ emplId: PERSON.emplId, name: PERSON.name }], confirmed: [{ emplId: PERSON.emplId, name: PERSON.name }], dropped: [] });
    const identity = rows("search-identity").at(-1);
    assert.equal((identity?.output.value as { selected: { name: string } }).selected.name, PERSON.name);
    assert.equal(typedLeaves(identity).step, "searching");
  });

  it("refuses a typed Employee ID that is not the one searched", async () => {
    const f = await world.fixture();
    const settled = await f.run(SEARCH, [], except("searching"), [{ step: "searching", facts: { ...PERSON, emplId: "10000002" } }]);
    assert.deepEqual(f.database.authority.failures.listByRun(settled.run.envelope.runId).map(failure => failure.summary),
      ["The typed Employee ID 10000002 is not the searched Employee ID 10000001"]);
  });
});

describe("Person Lookup Start run rows", () => {
  it("serves the four rows as switches with the typed fields of each, Read CRM dates on by default", async () => {
    const f = await world.fixture();
    const rows = projectStartRows(f.descriptor).map(row => ({ key: row.key, label: row.label, kind: row.kind, on: row.includedByDefault,
      members: row.members.map(member => member.step), target: row.target?.step, selection: row.selection?.inputField,
      fields: row.manual?.form.fields.map(field => [field.key, field.kind, field.optional === true, field.replaces === undefined ? null : `${field.replaces.nodeId}.${field.replaces.path}`]) }));
    assert.deepEqual(rows, [
      { key: "searching", label: "Search for person", kind: "switch", on: true, members: ["searching", "reference-check"], target: "searching", selection: undefined, fields: [
        ["emplId", "eid", false, "search-identity.selected.emplId"], ["name", "text", false, "search-identity.selected.name"],
        ["department", "text", false, "search-identity.selected.department"], ["jobTitle", "text", false, "search-identity.selected.jobTitle"],
        ["hrStatus", "text", false, "search-identity.selected.hrStatus"], ["employeeStatus", "enum", false, "search-identity.selected.employeeStatus"],
        ["hdh", "boolean", false, "search-identity.selected.hdh"]] },
      { key: "cross-verify", label: "Cross-check identity", kind: "switch", on: true, members: ["cross-verify"], target: "cross-verify", selection: "crmCheck", fields: [
        ["name", "text", false, "crm-identity.crmIdentity.name"], ["firstDayOfService", "us-date", false, "crm-identity.crmIdentity.firstDayOfService"]] },
      { key: "active-status", label: "Read employment status", kind: "switch", on: true, members: ["active-status"], target: "active-status", selection: undefined, fields: [
        ["state", "enum", false, "active-status.state"], ["hrStatus", "text", true, "active-status.details.hrStatus"],
        ["startDate", "us-date", true, "active-status.details.startDate"], ["endDate", "us-date", true, "active-status.details.endDate"],
        ["terminationReason", "text", true, "active-status.details.terminationReason"], ["ucpath", "enum", false, "active-status.details.ucpath"]] },
      { key: "crm-dates", label: "Read CRM dates", kind: "switch", on: true, members: ["crm-dates"], target: "crm-dates", selection: "includeCrmDates", fields: [
        ["employmentDate", "iso-date", false, "crm-dates.employmentDate"], ["oathDate", "iso-date", false, "crm-dates.oathDate"]] },
    ]);
    const enums = projectStartRows(f.descriptor).flatMap(row => row.manual?.form.fields.flatMap(field => field.kind === "enum" ? [[row.key, field.key, field.values]] : []) ?? []);
    assert.deepEqual(enums, [["searching", "employeeStatus", ["active", "inactive", "terminated", "unknown"]], ["active-status", "state", ["active", "inactive"]],
      ["active-status", "ucpath", ["Found", "Not found"]]]);
  });

  it("with every switch on reads every step as today and records nothing as typed by hand", async () => {
    const f = await world.fixture();
    const typed = await typedRun(f, []);
    const wire = served(f, typed.run.envelope.runId);
    assert.deepEqual(STEPS.map(step => [step, wire.members(step)]), [
      ["searching", [["searching", "done", undefined], ["matching", "skipped", "condition-false"], ["search-identity", "done", undefined]]],
      ["cross-verify", [["cross-verify", "done", undefined], ["crm-identity", "done", undefined], ["crm-selected-record", "done", undefined], ["crm-results", "skipped", "condition-false"]]],
      ["active-status", [["crm-only-recovery", "skipped", "condition-false"], ["active-status", "done", undefined]]],
      ["crm-dates", [["crm-dates", "done", undefined]]],
      ["reference-check", [["reference-check", "skipped", "condition-false"]]],
    ]);
    assert.equal(wire.omittedSteps, undefined);
    assert.equal(typed.run.envelope.stepOmissions, undefined);
    assert.equal(typed.result.crmDates.state, "included");
  });
});
