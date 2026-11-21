import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { buildRunGate } from "../../../src/backend/runs/queries/run-detail/gate-park.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../src/backend/systems/ucpath/driver/fake.js";
import { deterministicPayPathOperations } from "../../../src/backend/systems/ucpath/driver/paypath-fake.js";
import { GateDecisionWireSchema } from "../../../src/models/dashboard/run-detail.js";
import { UcpathPayPathReadSchema } from "../../../src/models/ui/ucpath-paypath.js";
import { WorkStudyResultSchema } from "../../../src/models/workflows/work-study/result.js";
import { compileWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { workStudyWorkflow } from "../../../src/workflows/work-study/workflow.js";
import { createReferenceCheckWriteWorld } from "../../support/helpers/backend/reference-check-write-world.js";
import { sessionFactoryHarness } from "../../support/helpers/phase1f-executor-harness.js";

const world = createReferenceCheckWriteWorld();
afterEach(world.cleanup);
const { descriptor } = compileWorkflow(workStudyWorkflow);
const INPUT = { emplId: "10000001", effectiveDate: "08/03/2026" };
/** A name no fixture's PayPath read carries, so finding it anywhere in the run proves a row value leaked. */
const ROW_ONLY_NAME = "Zebedee Quillfeather";
const read = UcpathPayPathReadSchema.parse({
  pageStateId: "ucpath.paypath.position-data-ready", observedAt: "2026-08-01T12:00:00.000Z", emplId: "10000001", displayedName: "Lee, Jordan",
  position: { effectiveDate: "07/01/2026", positionChangeReason: "", positionPool: "", positionNumber: "40012345" },
});

async function fixture(options: Parameters<typeof deterministicPayPathOperations>[0] = {}) {
  const paypath = deterministicPayPathOperations({ read, ...options });
  const sessions = sessionFactoryHarness({ ucpath: () => ({ ...createDeterministicUcpathPersonOrgDriver(), ...paypath }) });
  const f = await world.fixture(descriptor, sessions);
  const commits = () => paypath.events.filter(event => event.startsWith("commit:")).length;
  const stages = () => paypath.events.filter(event => event.startsWith("prepare:")).length;
  const holding = () => f.spreadsheet("Fall roster", "Hires", ["eid", "fullName"], [["10000009", "Blair Example"], ["10000001", "Jordan Lee"]]);
  const missing = () => f.spreadsheet("Badge list", "Issued", ["eid"], [["10000009"]]);
  const renamed = () => f.spreadsheet("Fall roster", "Hires", ["fullName", "eid"], [[ROW_ONLY_NAME, "10000001"]]);
  const saved = (runId: string) => WorkStudyResultSchema.parse(f.database.authority.runResults.get(runId)?.result.value).state;
  const card = (run: Parameters<typeof f.current>[0]) => {
    const parked = f.current(run);
    const gate = GateDecisionWireSchema.parse(buildRunGate(f.gateDeps, parked.envelope.runId, undefined, parked));
    assert.ok(gate.state === "open" && gate.decision !== undefined);
    return gate.decision;
  };
  return { ...f, paypath, commits, stages, holding, missing, renamed, saved, card };
}

describe("Work-Study reference spreadsheet check", () => {
  it("skips the check with no spreadsheet picked and files as before", async () => {
    const f = await fixture(), run = await f.execute(f.start(INPUT, []));
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
    assert.deepEqual(f.nodeSpans(run, "reference-check"), [["skipped", "condition-false"]]);
    assert.deepEqual(f.nodeSpans(run, "reference-check-review"), [["skipped", "condition-false"]]);
    assert.deepEqual(f.checkLines(run), []);
    assert.equal(f.commits(), 1);
    assert.equal(f.saved(run.envelope.runId), "saved");
  });

  it("work-study/reference-check — files without asking when the picked spreadsheet holds the employee", async () => {
    const f = await fixture(), run = await f.execute(f.start(INPUT, [f.holding()]));
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
    assert.deepEqual(f.checkLines(run), ["Fall roster · Hires: found in row 3"]);
    assert.deepEqual(f.nodeSpans(run, "reference-check-review"), [["skipped", "condition-false"]]);
    assert.equal(f.commits(), 1);
  });

  it("stops before staging when the employee is missing, and Continue anyway files once", async () => {
    const f = await fixture(), started = f.start(INPUT, [f.missing()]);
    const parked = await f.execute(started);
    assert.ok(parked.lifecycle.state === "parked-gate" && String(parked.lifecycle.gateId) === "reference-check-review");
    assert.deepEqual(f.checkLines(parked), ["Badge list · Issued: not found"]);
    assert.deepEqual([f.stages(), f.commits()], [0, 0]);
    assert.deepEqual(f.database.authority.writeIntents.listByRun(started.envelope.runId), []);
    const decision = f.card(started);
    assert.equal(decision.type, "review-before-write");
    assert.deepEqual(decision.options.map(option => [option.id, option.label, option.send.via]), [["continue", "Continue anyway", "gate-arm"], ["cancel-run", "Cancel run", "row-action"]]);
    assert.equal(decision.context, "Badge list · Issued: not found · Compared: Employee ID, and name where the sheet has one.");

    assert.equal(f.continueAnyway(started).state, "applied");
    const done = await f.execute(started);
    assert.ok(done.lifecycle.state === "terminal" && done.lifecycle.outcome === "done");
    assert.equal(f.commits(), 1);
    assert.equal(f.saved(started.envelope.runId), "saved");
  });

  it("stops with the same card when the name differs, without recording any value from the row, and Cancel run files nothing", async () => {
    const f = await fixture(), started = f.start(INPUT, [f.renamed()]);
    const parked = await f.execute(started);
    assert.equal(parked.lifecycle.state, "parked-gate");
    assert.equal(f.card(started).context, "Fall roster · Hires: name differs in row 2 · Compared: Employee ID, and name where the sheet has one.");
    assert.equal(JSON.stringify([f.events(started), f.card(started)]).includes(ROW_ONLY_NAME), false);

    assert.equal(f.cancel(started).state, "applied");
    const cancelled = f.current(started);
    assert.ok(cancelled.lifecycle.state === "terminal" && cancelled.lifecycle.outcome === "cancelled");
    assert.deepEqual([f.stages(), f.commits()], [0, 0]);
    assert.deepEqual(f.database.authority.writeIntents.listByRun(started.envelope.runId), []);
  });

  it("stops before staging when a repeated name token has only one worksheet match", async () => {
    const f = await fixture({ read: { ...read, displayedName: "Lee Lee" } });
    const reference = f.spreadsheet("Fall roster", "Hires", ["eid", "fullName"], [["10000001", "Lee Thompson"]]);
    const parked = await f.execute(f.start(INPUT, [reference]));
    assert.ok(parked.lifecycle.state === "parked-gate" && String(parked.lifecycle.gateId) === "reference-check-review");
    assert.deepEqual(f.checkLines(parked), ["Fall roster · Hires: name differs in row 2"]);
    assert.deepEqual([f.stages(), f.commits()], [0, 0]);
    assert.deepEqual(f.database.authority.writeIntents.listByRun(parked.envelope.runId), []);
  });

  it("never stops a dry run for the check, and still records its line", async () => {
    const f = await fixture(), run = await f.execute(f.start(INPUT, [f.missing()], true));
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done", JSON.stringify(f.database.authority.failures.listByRun(run.envelope.runId)));
    assert.deepEqual(f.checkLines(run), ["Badge list · Issued: not found"]);
    assert.deepEqual(f.nodeSpans(run, "reference-check-review"), [["skipped", "condition-false"]]);
    assert.equal(f.commits(), 0);
  });

  it("keeps the answer across a restart; a Retry is a new run that asks again, and the person is filed once", async () => {
    /** PayPath drops the pool on the first staging only, so the run fails after the answer and its Retry can file. */
    const dropped: { positionPool?: string } = { positionPool: "" };
    const f = await fixture({ stagedValues: dropped }), started = f.start(INPUT, [f.missing()]);
    assert.equal((await f.execute(started)).lifecycle.state, "parked-gate");
    assert.equal(f.continueAnyway(started).state, "applied");
    const failed = await f.execute(f.current(started));
    assert.ok(failed.lifecycle.state === "terminal" && failed.lifecycle.outcome === "failed", "PayPath did not keep a value, so the staging fails after the answer");
    assert.equal(f.commits(), 0);
    delete dropped.positionPool;
    const retry = f.retry(started);
    assert.ok(retry.state === "applied");
    const successorId = retry.affectedTargets.flatMap(target => target.family === "run" && target.runId !== started.envelope.runId ? [target.runId] : [])[0];
    const successor = successorId === undefined ? undefined : f.database.authority.runs.get(successorId);
    assert.ok(successor !== undefined && successor.envelope.retryOf === started.envelope.runId);
    const asked = await f.execute(successor);
    assert.ok(asked.lifecycle.state === "parked-gate" && String(asked.lifecycle.gateId) === "reference-check-review", "a Retry is a new run, so it asks again before filing");
    assert.equal(f.commits(), 0);
    assert.equal(f.continueAnyway(successor).state, "applied");
    const filed = await f.execute(f.current(successor));
    assert.ok(filed.lifecycle.state === "terminal" && filed.lifecycle.outcome === "done");
    assert.equal(f.commits(), 1);
    assert.equal(f.saved(successor.envelope.runId), "saved");
  });
});
