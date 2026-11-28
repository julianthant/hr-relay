import assert from "node:assert/strict";
import { referenceCheckLines } from "../../support/helpers/backend/reference-check-lines.js";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, it } from "vitest";
import type { RunDetailQueryDeps } from "../../../src/backend/runs/queries/run-detail.js";
import { buildRunGate } from "../../../src/backend/runs/queries/run-detail/gate-park.js";
import { GateDecisionWireSchema } from "../../../src/models/dashboard/run-detail.js";
import type { RunRecord } from "../../../src/models/run/record.js";
import { ReferenceReviewSchema } from "../../../src/models/processing/workbooks/reference-fields.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { ONBOARDING_WRITE_REVIEW_GATE } from "../../../src/models/workflows/onboarding/read-write-plan.js";
import { OnboardingResultSchema } from "../../../src/models/workflows/onboarding/result.js";
import { CommandRequestSchema } from "../../../src/rules/commands/commands.js";
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
/** An existing employee UCPath confirms by Person Org; the CRM hire is "Fixture Hire". */
const PERSON = { emplId: EidSchema.parse("10800000"), name: "Hire, Fixture" };
/** A name no fixture carries, so finding it anywhere in the run proves a row value leaked. */
const ROW_ONLY_NAME = "Zebedee Quillfeather";

async function fixture(options: { dryRun?: boolean; mode?: "new-hire" | "rehire"; newHireReceiptEid?: typeof PERSON.emplId } = {}) {
  const mode = options.mode ?? "rehire";
  const h = await world.executionFixture(false, { match: "unique", selectedRow: true, mode, ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
    ...(options.newHireReceiptEid === undefined ? {} : { newHireReceiptEid: options.newHireReceiptEid }),
    ...(mode === "rehire" ? { personMatch: { hits: [PERSON], confirmed: [PERSON], dropped: [] } } : {}) });
  const current = (run: RunRecord) => { const stored = h.database.authority.runs.get(run.envelope.runId); assert.ok(stored); return stored; };
  const holding = () => h.checkSheet("Fall roster", "Hires", ["email", "fullName"], [["other@example.test", "Blair Example"], [h.key.toUpperCase(), "Fixture Hire"]]);
  const missing = () => h.checkSheet("Badge list", "Issued", ["email"], [["other@example.test"]]);
  const renamed = () => h.checkSheet("Fall roster", "Hires", ["fullName", "email"], [[ROW_ONLY_NAME, h.key]]);
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
  const checkLines = (run: RunRecord) => referenceCheckLines(events(run));
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
  const cancel = (run: RunRecord) => h.rawExecution.kernel.execute(CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: h.clock.now().toISOString(),
    requestedBy: "local-operator", source: "queue-row", family: "run", type: "cancel", target: { runId: run.envelope.runId, expectedVersion: current(run).version } }));
  const result = (run: RunRecord) => OnboardingResultSchema.parse(h.database.authority.runResults.get(run.envelope.runId)?.result.value);
  const continueReference = (run: RunRecord) => {
    const parked = current(run);
    assert.ok(parked.lifecycle.state === "parked-gate");
    return h.rawExecution.kernel.execute(CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: h.clock.now().toISOString(),
      requestedBy: "local-operator", source: "dashboard", family: "gate", type: "resolve-gate",
      target: { runId: run.envelope.runId, gateId: parked.lifecycle.gateId, expectedVersion: parked.version },
      payload: { result: { schemaHash: deriveSchemaHash(ReferenceReviewSchema, "output"), value: { decision: "continue" } } } }));
  };
  return { ...h, current, holding, missing, renamed, start, reviewThenRun, events, checkLines, nodeSpans, commits, card, cancel, result, continueReference };
}

describe("Onboarding reference spreadsheet check", () => {
  it("skips the check with only the required roster picked and files as before", async () => {
    const f = await fixture(), root = f.start([]);
    const done = await f.reviewThenRun(root);
    assert.ok(done.lifecycle.state === "terminal" && done.lifecycle.outcome === "done", JSON.stringify(done.lifecycle));
    assert.deepEqual(f.nodeSpans(root, "reference-fields-start"), [["skipped", "condition-false"]]);
    assert.deepEqual(f.nodeSpans(root, "reference-field-review-write-plan"), [["skipped", "condition-false"]]);
    assert.deepEqual(f.checkLines(root), []);
    assert.equal(f.commits(), 1);
    assert.equal(f.result(root).state, "filed");
  });

  it("onboarding/reference-check — files without asking when the extra spreadsheet holds the reviewed employee", async () => {
    const f = await fixture(), root = f.start([f.holding()]);
    const done = await f.reviewThenRun(root);
    assert.ok(done.lifecycle.state === "terminal" && done.lifecycle.outcome === "done", JSON.stringify(done.lifecycle));
    assert.deepEqual(f.checkLines(root), ["Hires, row 3: Email matches", "Hires, row 3: Legal name matches"]);
    assert.deepEqual(f.nodeSpans(root, "reference-field-review-write-plan"), [["skipped", "condition-false"]]);
    assert.equal(f.commits(), 1);
  });

  it("logs a missing email and files once after hire review", async () => {
    const f = await fixture(), root = f.start([f.missing()]);
    const done = await f.reviewThenRun(root);
    assert.ok(done.lifecycle.state === "terminal" && done.lifecycle.outcome === "done", JSON.stringify(done.lifecycle));
    assert.deepEqual(f.checkLines(root), ["Not in Issued"]);
    assert.equal(f.commits(), 1);
    assert.equal(f.result(root).state, "filed");
  });

  it("shows both names before hire review, keeps the row value out of Logs, and Cancel run saves nothing", async () => {
    const f = await fixture(), root = f.start([f.renamed()]);
    const parked = (await f.rawExecution.execute(root, signal())).run;
    assert.ok(parked?.lifecycle.state === "parked-gate" && parked.lifecycle.gateId === "reference-field-review-crm-source");
    assert.equal(f.commits(), 0);
    const decision = f.card(root);
    assert.deepEqual(decision.options.map(option => [option.id, option.label, option.send.via]), [["continue", "Continue anyway", "gate-arm"], ["cancel-run", "Cancel run", "row-action"]]);
    assert.equal(decision.context, `Hires, row 2 · Legal name: spreadsheet “${ROW_ONLY_NAME}”, workflow “Fixture Hire”`);
    assert.equal(JSON.stringify(f.events(root)).includes(ROW_ONLY_NAME), false);

    assert.equal(f.cancel(root).state, "applied");
    const cancelled = f.current(root);
    assert.ok(cancelled.lifecycle.state === "terminal" && cancelled.lifecycle.outcome === "cancelled");
    assert.equal(f.commits(), 0);
    assert.deepEqual(f.database.authority.writeIntents.listByRun(root.envelope.runId), []);
    assert.deepEqual(f.repository.runOperations(root.envelope.runId), []);
  });

  it("continues a dry run with a missing row and records its line", async () => {
    const f = await fixture({ dryRun: true }), root = f.start([f.missing()]);
    const done = await f.reviewThenRun(root);
    assert.ok(done.lifecycle.state === "terminal" && done.lifecycle.outcome === "done", JSON.stringify(f.database.authority.failures.listByRun(root.envelope.runId)));
    assert.deepEqual(f.checkLines(root), ["Not in Issued"]);
    assert.deepEqual(f.nodeSpans(root, "reference-field-review-write-plan"), [["skipped", "condition-false"]]);
    assert.equal(f.commits(), 0);
  });

  it("matches a native worksheet DOB and reviews a differing confirmed Employee ID before hire review", async () => {
    const f = await fixture();
    const root = f.start([f.checkSheet("Reference roster", "Hires", ["email", "dob", "eid"],
      [[f.key, new Date("2000-01-14T00:00:00.000Z"), "10000009"]])]);
    const parked = (await f.rawExecution.execute(root, signal())).run;
    assert.ok(parked?.lifecycle.state === "parked-gate");
    assert.equal(parked.lifecycle.gateId, "reference-field-review-ucpath-source");
    assert.ok(f.checkLines(root).includes("Hires, row 2: Date of Birth matches"));
    assert.equal(f.commits(), 0);
    assert.equal(f.card(root).context, `Hires, row 2 · Employee ID: spreadsheet “10000009”, workflow “${PERSON.emplId}”`);
    assert.equal(f.continueReference(root).state, "applied");
    const done = await f.reviewThenRun(f.current(root));
    assert.ok(done.lifecycle.state === "terminal" && done.lifecycle.outcome === "done");
    assert.equal(f.commits(), 1);
  });

  it("reviews the assigned Employee ID from the hire receipt and resumes without resubmitting", async () => {
    const f = await fixture({ mode: "new-hire", newHireReceiptEid: PERSON.emplId });
    const root = f.start([f.checkSheet("Reference roster", "Hires", ["email", "eid"], [[f.key, "10000009"]])]);
    const parked = await f.reviewThenRun(root);
    assert.ok(parked.lifecycle.state === "parked-gate", JSON.stringify({
      lifecycle: parked.lifecycle, failures: f.database.authority.failures.listByRun(root.envelope.runId), checks: f.checkLines(root),
    }));
    assert.equal(parked.lifecycle.gateId, "reference-field-review-hire-receipt");
    assert.equal(f.card(root).context, `Hires, row 2 · Employee ID: spreadsheet “10000009”, workflow “${PERSON.emplId}”`);
    assert.deepEqual(f.repository.runOperations(root.envelope.runId), []);
    assert.equal(f.hire.events.filter(event => event === "commit:hire").length, 1);
    f.clock.advanceWall(60_000);
    assert.equal(f.continueReference(root).state, "applied");
    const done = (await f.rawExecution.execute(f.current(root), signal())).run;
    assert.ok(done?.lifecycle.state === "terminal" && done.lifecycle.outcome === "done", JSON.stringify(f.database.authority.failures.listByRun(root.envelope.runId)));
    assert.equal(f.hire.events.filter(event => event === "commit:hire").length, 1);
    assert.equal(f.repository.runOperations(root.envelope.runId).length, 1);
  });

  it("checks a new hire by email without an Employee ID", async () => {
    const f = await fixture({ mode: "new-hire" }), root = f.start([f.holding()]);
    const done = await f.reviewThenRun(root);
    assert.ok(done.lifecycle.state === "terminal" && done.lifecycle.outcome === "done", JSON.stringify(done.lifecycle));
    assert.deepEqual(f.nodeSpans(root, "reference-fields-start"), [["done", undefined]]);
    assert.ok(f.checkLines(root).includes("Hires, row 3: Email matches"));
    assert.deepEqual(f.nodeSpans(root, "reference-field-review-write-plan"), [["skipped", "condition-false"]]);
    assert.equal(f.result(root).state, "filed");
  });
});
