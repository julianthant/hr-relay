import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { stepProofModuleOf } from "../../../src/backend/app/registries/step-proof-modules.js";
import { buildRunGate } from "../../../src/backend/runs/queries/run-detail/gate-park.js";
import { GateDecisionWireSchema } from "../../../src/models/dashboard/run-detail.js";
import type { RunRecord } from "../../../src/models/run/record.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { createReferenceCheckWriteWorld } from "../../support/helpers/backend/reference-check-write-world.js";
import { sessionFactoryHarness } from "../../support/helpers/phase1f-executor-harness.js";
import { separationsDescriptor } from "../../support/helpers/registered-workflows.js";

const world = createReferenceCheckWriteWorld();
afterEach(world.cleanup);
const proof = stepProofModuleOf("separations-reference-check");
assert.ok(proof);
const { descriptor } = proof;
const INPUT = { emplId: "10873698", employeeName: "Battistessa, Johnnie" };
/** A name the approved subject never carries, so finding it anywhere in the run proves a row value leaked. */
const ROW_ONLY_NAME = "Zebedee Quillfeather";
const nodes = descriptorRuntimeNodes(separationsDescriptor);
const node = (id: string) => { const found = nodes.find(candidate => String(candidate.id) === id); assert.ok(found, id); return found; };
/** Every node `id` waits for, directly or through another node. */
function upstreamOf(id: string): ReadonlySet<string> {
  const seen = new Set<string>();
  const visit = (next: string) => { for (const dependency of node(next).dependsOn.map(String)) if (!seen.has(dependency)) { seen.add(dependency); visit(dependency); } };
  visit(id);
  return seen;
}

async function fixture() {
  const f = await world.fixture(descriptor, sessionFactoryHarness({}));
  const holding = () => f.spreadsheet("Separations roster", "People", ["eid", "fullName"], [["10000009", "Blair Example"], [INPUT.emplId, "Johnnie Battistessa"]]);
  const missing = () => f.spreadsheet("Badge list", "Issued", ["eid"], [["10000009"]]);
  const renamed = () => f.spreadsheet("Separations roster", "People", ["fullName", "eid"], [[ROW_ONLY_NAME, INPUT.emplId]]);
  const card = (run: RunRecord) => {
    const parked = f.current(run);
    const gate = GateDecisionWireSchema.parse(buildRunGate(f.gateDeps, parked.envelope.runId, undefined, parked));
    assert.ok(gate.state === "open" && gate.decision !== undefined);
    return gate.decision;
  };
  return { ...f, holding, missing, renamed, card };
}

describe("Separations reference spreadsheet check", () => {
  it("checks the approved person after the identity check, and every write waits for the review", () => {
    const keys = separationsDescriptor.timeline.map(step => step.key);
    assert.ok(keys.indexOf("reference-check") > keys.indexOf("identity-check"));
    assert.ok(keys.indexOf("reference-check") < keys.indexOf("ucpath-transaction"));
    assert.deepEqual(node("reference-check").dependsOn.map(String), ["approval"]);
    assert.deepEqual(node("reference-check-review").when, { kind: "is-true", of: { from: "node", nodeId: "reference-stop", path: "ask" } });
    for (const write of nodes.filter(candidate => candidate.kind === "transaction")) {
      assert.ok(upstreamOf(String(write.id)).has("reference-check-review"), `${String(write.id)} waits for the reference review`);
    }
    assert.deepEqual(nodes.filter(candidate => candidate.kind === "transaction" && !upstreamOf(String(candidate.id)).has("reference-check-review")), []);
    assert.equal(upstreamOf("reference-check-review").has("clear-pending"), false, "the review comes before the first write");
  });

  it("skips the check with no spreadsheet picked and asks nothing", async () => {
    const f = await fixture(), run = await f.execute(f.start(INPUT, []));
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
    assert.deepEqual(f.nodeSpans(run, "reference-check"), [["skipped", "condition-false"]]);
    assert.deepEqual(f.nodeSpans(run, "reference-check-review"), [["skipped", "condition-false"]]);
    assert.deepEqual(f.checkLines(run), []);
  });

  it("separations/reference-check — goes on without asking when the picked spreadsheet holds the person", async () => {
    const f = await fixture(), run = await f.execute(f.start(INPUT, [f.holding()]));
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
    assert.deepEqual(f.checkLines(run), ["Separations roster · People: found in row 3"]);
    assert.deepEqual(f.nodeSpans(run, "reference-check-review"), [["skipped", "condition-false"]]);
  });

  it("separations-reference-check/reference-check — stops when the person is missing, and Continue anyway goes on", async () => {
    const f = await fixture(), started = f.start(INPUT, [f.missing()]);
    const parked = await f.execute(started);
    assert.ok(parked.lifecycle.state === "parked-gate" && String(parked.lifecycle.gateId) === "reference-check-review");
    const decision = f.card(started);
    assert.equal(decision.type, "review-before-write");
    assert.deepEqual(decision.options.map(option => [option.id, option.label, option.send.via]), [["continue", "Continue anyway", "gate-arm"], ["cancel-run", "Cancel run", "row-action"]]);
    assert.equal(decision.context, "Badge list · Issued: not found. Relay compared the Employee ID, and the name where the sheet has one.");
    assert.equal(f.continueAnyway(started).state, "applied");
    const done = await f.execute(started);
    assert.ok(done.lifecycle.state === "terminal" && done.lifecycle.outcome === "done");
  });

  it("stops with the same card when the name differs, without recording any value from the row, and Cancel run ends it", async () => {
    const f = await fixture(), started = f.start(INPUT, [f.renamed()]);
    assert.equal((await f.execute(started)).lifecycle.state, "parked-gate");
    assert.equal(f.card(started).context, "Separations roster · People: name differs in row 2. Relay compared the Employee ID, and the name where the sheet has one.");
    assert.equal(JSON.stringify([f.events(started), f.card(started)]).includes(ROW_ONLY_NAME), false);
    assert.equal(f.cancel(started).state, "applied");
    const cancelled = f.current(started);
    assert.ok(cancelled.lifecycle.state === "terminal" && cancelled.lifecycle.outcome === "cancelled");
  });

  it("never stops a dry run for the check, and still records its line", async () => {
    const f = await fixture(), run = await f.execute(f.start(INPUT, [f.missing()], true));
    assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "done", JSON.stringify(f.database.authority.failures.listByRun(run.envelope.runId)));
    assert.deepEqual(f.checkLines(run), ["Badge list · Issued: not found"]);
    assert.deepEqual(f.nodeSpans(run, "reference-check-review"), [["skipped", "condition-false"]]);
  });
});
