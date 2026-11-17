import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, it } from "vitest";
import type { RunDetailQueryDeps } from "../../../src/backend/runs/queries/run-detail.js";
import { buildRunGate, resolveGateArmAnswer } from "../../../src/backend/runs/queries/run-detail/gate-park.js";
import { GateDecisionWireSchema } from "../../../src/models/dashboard/run-detail.js";
import { REFERENCE_CHECK_REVIEW_GATE } from "../../../src/models/processing/workbooks/reference-check-stop.js";
import { VerifyWorkbookPerson } from "../../../src/models/processing/workbooks/verify-person.js";
import type { RunRecord } from "../../../src/models/run/record.js";
import { ONBOARDING_WRITE_REVIEW_GATE } from "../../../src/models/workflows/onboarding/read-write-plan.js";
import { OnboardingResultSchema } from "../../../src/models/workflows/onboarding/result.js";
import { CommandRequestSchema, GateArmAnswerRequestSchema } from "../../../src/rules/commands/commands.js";
import { EidSchema } from "../../../src/rules/identity/ids.js";
import { compileWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { onboardingWorkflow } from "../../../src/workflows/onboarding/workflow.js";
import { testRunService } from "../../support/fixtures/run-lifecycle-fixtures.js";
import { createOnboardingRunWorld } from "../../support/helpers/backend/onboarding-run-world.js";
import { CANCEL_ROW_ACTION } from "../../support/helpers/backend/reference-check-write-world.js";

const world = createOnboardingRunWorld();
afterAll(world.close);
afterEach(world.cleanup);
const signal = () => new AbortController().signal;
const { descriptor } = compileWorkflow(onboardingWorkflow);
const CheckLines = VerifyWorkbookPerson.output.shape.checks;
/** An existing employee UCPath confirms by Person Org; the CRM hire is "Fixture Hire". */
const PERSON = { emplId: EidSchema.parse("10800000"), name: "Hire, Fixture" };
/** A name no fixture carries, so finding it anywhere in the run proves a row value leaked. */
const ROW_ONLY_NAME = "Zebedee Quillfeather";

async function fixture(options: { dryRun?: boolean; mode?: "new-hire" | "rehire" } = {}) {
  const mode = options.mode ?? "rehire";
  const h = await world.executionFixture(false, { match: "unique", selectedRow: true, mode, ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
    ...(mode === "rehire" ? { personMatch: { hits: [PERSON], confirmed: [PERSON], dropped: [] } } : {}) });
  const current = (run: RunRecord) => { const stored = h.database.authority.runs.get(run.envelope.runId); assert.ok(stored); return stored; };
  const holding = () => h.checkSheet("Fall roster", "Hires", ["eid", "fullName"], [["10000009", "Blair Example"], [PERSON.emplId, "Fixture Hire"]]);
  const missing = () => h.checkSheet("Badge list", "Issued", ["eid"], [["10000009"]]);
  const renamed = () => h.checkSheet("Fall roster", "Hires", ["fullName", "eid"], [[ROW_ONLY_NAME, PERSON.emplId]]);
  const start = (picks: readonly ReturnType<typeof holding>[]) => h.start(picks.length === 0 ? h.request : h.withChecks(picks));
  /** Runs to the hire review, answers it as the operator does, then runs on to the next stop. */
  const reviewThenRun = async (root: RunRecord) => {
    const review = await h.rawExecution.execute(root, signal());
    assert.ok(review.run?.lifecycle.state === "parked-gate" && review.run.lifecycle.gateId === ONBOARDING_WRITE_REVIEW_GATE,
      JSON.stringify(h.database.authority.failures.listByRun(root.envelope.runId)));
    const decision = mode === "rehire" ? { decision: "existing-person" as const, emplId: PERSON.emplId, confirmedBy: "person-org" as const }
      : { decision: "new-hire" as const, ruledOut: [] };
    assert.equal(h.approve(root, decision).state, "applied");
    const next = await h.rawExecution.execute(current(root), signal());
    assert.ok(next.run);
    return next.run;
  };
  const events = (run: RunRecord) => h.database.authority.timelineEvents.page({}).filter(event => event.scope.kind === "run" && event.scope.runId === run.envelope.runId);
  const checkLines = (run: RunRecord) => events(run).flatMap(event => event.payload.kind === "span" && event.payload.event.t === "data.observed" && event.payload.event.nodeId === "reference-check"
    ? event.payload.event.points.flatMap(point => point.field !== "checks" ? [] : point.values.flatMap(value => value.state === "allowed" ? CheckLines.parse(value.value).map(check => check.line) : [value.state]))
    : []);
  const nodeSpans = (run: RunRecord, nodeId: string) => events(run).flatMap(event => event.payload.kind === "span" && event.payload.event.t === "span.ended"
    && event.payload.event.spanPath.includes(`/${nodeId}#`) ? [[event.payload.event.outcome, "notRunReason" in event.payload.event ? event.payload.event.notRunReason : undefined]] : []);
  const commits = () => h.hire.events.filter(event => event === "commit:hire").length + h.i9.events.filter(event => event.startsWith("commit:")).length;
  const reader = testRunService(h.database, h.clock);
  const gateDeps = { runReader: reader, authority: { listGateResults: (runId: string) => h.database.authority.gateResults.listByRun(runId) },
    projection: { queueSurface: () => ({ actions: [CANCEL_ROW_ACTION] }) },
    canonical: { reader, database: h.database, descriptors: { resolve: (id: string) => id === descriptor.id ? descriptor : undefined } } } as unknown as RunDetailQueryDeps;
  const card = (run: RunRecord) => {
    const parked = current(run);
    const gate = GateDecisionWireSchema.parse(buildRunGate(gateDeps, parked.envelope.runId, undefined, parked));
    assert.ok(gate.state === "open" && gate.decision !== undefined);
    return gate.decision;
  };
  const continueAnyway = (run: RunRecord) => {
    const answer = GateArmAnswerRequestSchema.parse({ commandId: randomUUID(), requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
      family: "gate", type: "answer-gate-arm", target: { runId: run.envelope.runId, gateId: REFERENCE_CHECK_REVIEW_GATE, expectedVersion: current(run).version }, payload: { arm: "continue" } });
    const resolution = resolveGateArmAnswer(gateDeps, answer, undefined);
    assert.ok(resolution.state === "accepted", JSON.stringify(resolution));
    return h.rawExecution.kernel.execute(resolution.request);
  };
  const cancel = (run: RunRecord) => h.rawExecution.kernel.execute(CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: h.clock.now().toISOString(),
    requestedBy: "local-operator", source: "queue-row", family: "run", type: "cancel", target: { runId: run.envelope.runId, expectedVersion: current(run).version } }));
  const result = (run: RunRecord) => OnboardingResultSchema.parse(h.database.authority.runResults.get(run.envelope.runId)?.result.value);
  return { ...h, current, holding, missing, renamed, start, reviewThenRun, events, checkLines, nodeSpans, commits, card, continueAnyway, cancel, result };
}

describe("Onboarding reference spreadsheet check", () => {
  it("skips the check with only the required roster picked and files as before", async () => {
    const f = await fixture(), root = f.start([]);
    const done = await f.reviewThenRun(root);
    assert.ok(done.lifecycle.state === "terminal" && done.lifecycle.outcome === "done", JSON.stringify(done.lifecycle));
    assert.deepEqual(f.nodeSpans(root, "reference-check"), [["skipped", "condition-false"]]);
    assert.deepEqual(f.nodeSpans(root, "reference-check-review"), [["skipped", "condition-false"]]);
    assert.deepEqual(f.checkLines(root), []);
    assert.equal(f.commits(), 1);
    assert.equal(f.result(root).state, "filed");
  });

  it("onboarding/reference-check — files without asking when the extra spreadsheet holds the reviewed employee", async () => {
    const f = await fixture(), root = f.start([f.holding()]);
    const done = await f.reviewThenRun(root);
    assert.ok(done.lifecycle.state === "terminal" && done.lifecycle.outcome === "done", JSON.stringify(done.lifecycle));
    assert.deepEqual(f.checkLines(root), ["Fall roster · Hires: found in row 3"]);
    assert.deepEqual(f.nodeSpans(root, "reference-check-review"), [["skipped", "condition-false"]]);
    assert.equal(f.commits(), 1);
  });

  it("stops before the first save when the employee is missing, and Continue anyway files once", async () => {
    const f = await fixture(), root = f.start([f.missing()]);
    const parked = await f.reviewThenRun(root);
    assert.ok(parked.lifecycle.state === "parked-gate" && String(parked.lifecycle.gateId) === REFERENCE_CHECK_REVIEW_GATE, JSON.stringify(parked.lifecycle));
    assert.deepEqual(f.checkLines(root), ["Badge list · Issued: not found"]);
    assert.equal(f.commits(), 0);
    assert.deepEqual(f.database.authority.writeIntents.listByRun(root.envelope.runId), []);
    assert.deepEqual(f.repository.runOperations(root.envelope.runId), []);
    const decision = f.card(root);
    assert.equal(decision.type, "review-before-write");
    assert.deepEqual(decision.options.map(option => [option.id, option.label, option.send.via]), [["continue", "Continue anyway", "gate-arm"], ["cancel-run", "Cancel run", "row-action"]]);
    assert.equal(decision.context, "Badge list · Issued: not found. Relay compared the Employee ID, and the name where the sheet has one.");

    assert.equal(f.continueAnyway(root).state, "applied");
    const done = await f.rawExecution.execute(f.current(root), signal());
    assert.ok(done.run?.lifecycle.state === "terminal" && done.run.lifecycle.outcome === "done", JSON.stringify(done.run?.lifecycle));
    assert.equal(f.commits(), 1);
    assert.equal(f.result(root).state, "filed");
  });

  it("stops with the same card when the name differs, records no value from the row, and Cancel run saves nothing", async () => {
    const f = await fixture(), root = f.start([f.renamed()]);
    const parked = await f.reviewThenRun(root);
    assert.equal(parked.lifecycle.state, "parked-gate");
    assert.equal(f.card(root).context, "Fall roster · Hires: name differs in row 2. Relay compared the Employee ID, and the name where the sheet has one.");
    assert.equal(JSON.stringify([f.events(root), f.card(root)]).includes(ROW_ONLY_NAME), false);

    assert.equal(f.cancel(root).state, "applied");
    const cancelled = f.current(root);
    assert.ok(cancelled.lifecycle.state === "terminal" && cancelled.lifecycle.outcome === "cancelled");
    assert.equal(f.commits(), 0);
    assert.deepEqual(f.database.authority.writeIntents.listByRun(root.envelope.runId), []);
    assert.deepEqual(f.repository.runOperations(root.envelope.runId), []);
  });

  it("never stops a dry run for the check, and still records its line", async () => {
    const f = await fixture({ dryRun: true }), root = f.start([f.missing()]);
    const done = await f.reviewThenRun(root);
    assert.ok(done.lifecycle.state === "terminal" && done.lifecycle.outcome === "done", JSON.stringify(f.database.authority.failures.listByRun(root.envelope.runId)));
    assert.deepEqual(f.checkLines(root), ["Badge list · Issued: not found"]);
    assert.deepEqual(f.nodeSpans(root, "reference-check-review"), [["skipped", "condition-false"]]);
    assert.equal(f.commits(), 0);
  });

  it("checks no one for a new hire, who has no Employee ID yet, and files without asking", async () => {
    const f = await fixture({ mode: "new-hire" }), root = f.start([f.missing()]);
    const done = await f.reviewThenRun(root);
    assert.ok(done.lifecycle.state === "terminal" && done.lifecycle.outcome === "done", JSON.stringify(done.lifecycle));
    assert.deepEqual(f.nodeSpans(root, "reference-check"), [["done", undefined]]);
    assert.deepEqual(f.checkLines(root), []);
    assert.deepEqual(f.nodeSpans(root, "reference-check-review"), [["skipped", "condition-false"]]);
    assert.equal(f.result(root).state, "filed");
  });
});
