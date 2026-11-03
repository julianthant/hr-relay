import { RunWorkbookSelectedRowReferenceSchema } from "../../../src/models/dashboard/workbooks.js";
import { I9SignerOutputSchema } from "../../../src/models/systems/i9/read-section2-signer.js";
import { EidSchema } from "../../../src/rules/identity/ids.js";
import assert from "node:assert/strict";
import { afterAll, afterEach, describe, it } from "vitest";
import { createOnboardingRunWorld } from "../../support/helpers/backend/onboarding-run-world.js";
import { OnboardingResultSchema } from "../../../src/models/workflows/onboarding/result.js";
import { RunDryRunPreviewResultSchema } from "../../../src/models/run/result.js";
import { DRY_RUN_I9_PROFILE_ID, containsDryRunSample } from "../../../src/models/workflow/dry-run.js";
import { ONBOARDING_WRITE_REVIEW_GATE } from "../../../src/models/workflows/onboarding/read-write-plan.js";

const world = createOnboardingRunWorld();
afterAll(world.close);
afterEach(world.cleanup);
const signal = () => new AbortController().signal;
function terminal(result: Awaited<ReturnType<Awaited<ReturnType<typeof world.executionFixture>>["rawExecution"]["execute"]>>) {
  assert.ok(result.run?.lifecycle.state === "terminal" && result.run.lifecycle.outcome === "done", JSON.stringify(result.run?.lifecycle));
  return result.run;
}

describe("public onboarding write execution", () => {
  it("starts from the selected saved row, parks before all writes, then files three fenced receipts and patches only the captured live master", async () => {
    const h = await world.executionFixture(false, { match: "unique", selectedRow: true }), root = h.start();
    assert.deepEqual(RunWorkbookSelectedRowReferenceSchema.parse(root.input.workbookReferences?.[0].value).request.selectedRow, { sheetId: "people", rowId: "people-person" });
    const review = await h.rawExecution.execute(root, signal());
    assert.equal(review.run?.lifecycle.state, "parked-gate", JSON.stringify(h.database.authority.failures.listByRun(root.envelope.runId)));
    assert.equal(review.run.lifecycle.state === "parked-gate" && review.run.lifecycle.gateId, ONBOARDING_WRITE_REVIEW_GATE);
    assert.equal(h.i9.events.some(event => event.startsWith("commit:")), false); assert.equal(h.hire.events.includes("commit:hire"), false);
    assert.deepEqual(h.database.authority.writeIntents.listByRun(root.envelope.runId), []);
    assert.deepEqual(h.repository.runOperations(root.envelope.runId), []);
    assert.equal(h.approve(root, { decision: "new-hire" }).state, "applied");
    terminal(await h.rawExecution.execute(root, signal()));
    const stored = h.database.authority.runResults.get(root.envelope.runId); assert.ok(stored);
    const output = OnboardingResultSchema.parse(stored.result.value);
    assert.equal(output.state, "filed"); assert.equal(output.i9.state, "verified"); assert.equal(output.hireWrite.state, "verified");
    assert.equal(h.database.authority.writeIntents.listByRun(root.envelope.runId).filter(intent => intent.status === "committed").length, 3);
    assert.deepEqual(h.i9.events.filter(event => event.startsWith("commit:")), ["commit:profile", "commit:remote"]);
    assert.equal(h.hire.events.filter(event => event === "commit:hire").length, 1);
    assert.equal(h.hire.events.at(-1), "probe:hire");
    const master = h.library.read(h.id); assert.ok(master);
    assert.deepEqual(master.workbook.sheets[0].rows[1].cells.slice(7).map(cell => cell.value), [null, "900001", "T009000001", "Pending"]);
    assert.equal(h.repository.runOperations(root.envelope.runId).length, 1);
    assert.equal(h.repository.list().length, 1);
  });

  it("skips both I-9 transactions for a reviewed independently confirmed existing employee", async () => {
    const person = { emplId: EidSchema.parse("10800000"), name: "Hire, Fixture" };
    const h = await world.executionFixture(false, { match: "unique", selectedRow: true, mode: "rehire", personMatch: { hits: [person], confirmed: [person], dropped: [] } });
    const root = h.start();
    const review = await h.rawExecution.execute(root, signal()); assert.equal(review.run?.lifecycle.state, "parked-gate", JSON.stringify(h.database.authority.failures.listByRun(root.envelope.runId)));
    assert.equal(h.approve(root, { decision: "existing-person", emplId: person.emplId }).state, "applied");
    terminal(await h.rawExecution.execute(root, signal()));
    assert.deepEqual(h.i9.events, []); assert.equal(h.hire.events.filter(event => event === "commit:hire").length, 1);
    assert.equal(h.database.authority.runs.listChildren(root.envelope.runId).length, 0);
    const intents = h.database.authority.writeIntents.listByRun(root.envelope.runId); assert.equal(intents.length, 1); assert.equal(intents[0]?.status, "committed");
    const stored = h.database.authority.runResults.get(root.envelope.runId); assert.ok(stored);
    const output = OnboardingResultSchema.parse(stored.result.value); assert.deepEqual(output.i9, { state: "not-required" });
    assert.equal(output.hireWrite.receipt.emplId, person.emplId);
    const master = h.library.read(h.id); assert.ok(master);
    assert.deepEqual(master.workbook.sheets[0].rows[1].cells.slice(7).map(cell => cell.value), [person.emplId, null, "T009000001", "Pending"]);
  });

  it("fills the full public preview with labelled samples and no intents, receipts or master writes", async () => {
    const h = await world.executionFixture(false, { match: "unique", selectedRow: true, dryRun: true }), root = h.start();
    const review = await h.rawExecution.execute(root, signal());
    assert.ok(review.run?.lifecycle.state === "parked-gate" && review.run.lifecycle.gateId === ONBOARDING_WRITE_REVIEW_GATE, JSON.stringify(review.run?.lifecycle));
    const children = h.database.authority.runs.listChildren(root.envelope.runId);
    assert.equal(children.length, 1); const child = children[0];
    assert.equal(child.envelope.dryRun, true);
    assert.ok(child.lifecycle.state === "terminal" && child.lifecycle.outcome === "done");
    const observation = h.database.authority.runResults.get(child.envelope.runId); assert.ok(observation);
    assert.deepEqual(I9SignerOutputSchema.parse(observation.result.value), { i9Status: "not-found", signerName: "" });
    assert.deepEqual(h.database.authority.writeIntents.listByRun(root.envelope.runId), []);
    assert.equal(h.approve(root, { decision: "new-hire" }).state, "applied");
    const resumed = await h.rawExecution.execute(root, signal());
    assert.deepEqual(h.database.authority.writeIntents.countDryRunEvidenceByRun(root.envelope.runId), { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
    assert.equal(h.i9.events.some(event => event.startsWith("commit:")), false); assert.equal(h.hire.events.includes("commit:hire"), false);
    assert.deepEqual(h.i9.profiles, []); assert.deepEqual(h.i9.records, []); assert.deepEqual(h.hire.rows, []);
    assert.deepEqual(h.repository.runOperations(root.envelope.runId), []);
    terminal(resumed);
    const stored = h.database.authority.runResults.get(root.envelope.runId); assert.ok(stored);
    const output = RunDryRunPreviewResultSchema.parse(stored.result.value);
    const transactions = output.steps.filter(step => step.state === "transaction-preview");
    assert.deepEqual(transactions.map(step => step.nodeId), ["i9-profile-save", "i9-remote-create", "hire-create"]);
    assert.equal(transactions[2]?.samples[0]?.value, DRY_RUN_I9_PROFILE_ID);
    for (const run of [root, ...h.database.authority.runs.listChildren(root.envelope.runId)]) {
      assert.equal(h.database.authority.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId)
        .some(checkpoint => containsDryRunSample(checkpoint.output.value)), false);
      assert.equal(h.database.authority.evidenceReceipts.findByRun(run.envelope.runId), undefined);
    }
    assert.deepEqual(h.library.read(h.id)?.workbook.sheets[0].rows[1].cells.slice(7).map(cell => cell.value), [null, null, null, null]);
  });

  it("previews a reviewed concurrent hire with an authenticated empty I-9 delegation and no effects", async () => {
    const person = { emplId: EidSchema.parse("10800000"), name: "Hire, Fixture" };
    const h = await world.executionFixture(false, { match: "unique", dryRun: true, mode: "rehire", personMatch: { hits: [person], confirmed: [person], dropped: [] } });
    const root = h.start();
    const review = await h.rawExecution.execute(root, signal());
    assert.ok(review.run?.lifecycle.state === "parked-gate" && review.run.lifecycle.gateId === ONBOARDING_WRITE_REVIEW_GATE);
    assert.equal(h.approve(root, { decision: "existing-person", emplId: person.emplId }).state, "applied");
    terminal(await h.rawExecution.execute(root, signal()));
    const stored = h.database.authority.runResults.get(root.envelope.runId); assert.ok(stored);
    const preview = RunDryRunPreviewResultSchema.parse(stored.result.value);
    const writes = preview.steps.filter(step => step.state === "transaction-preview");
    assert.deepEqual(writes.map(step => step.nodeId), ["concurrent-hire-create"]);
    assert.deepEqual(writes.flatMap(step => step.samples), []);
    assert.ok(stored.dependencies.some(dependency => dependency.nodeId === "i9-lookup-child" && dependency.state === "delegation-resolved" && dependency.members.length === 0));
    assert.deepEqual(h.database.authority.runs.listChildren(root.envelope.runId), []);
    assert.deepEqual(h.database.authority.writeIntents.countDryRunEvidenceByRun(root.envelope.runId), { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
    assert.deepEqual(h.i9.events, []); assert.equal(h.hire.events.includes("commit:hire"), false);
    assert.deepEqual(h.hire.rows, []); assert.deepEqual(h.repository.runOperations(root.envelope.runId), []);
    assert.equal(h.database.authority.evidenceReceipts.findByRun(root.envelope.runId), undefined);
    assert.deepEqual(h.library.read(h.id)?.workbook.sheets[0].rows[1].cells.slice(7).map(cell => cell.value), [null, null, null, null]);
  });

  it("refuses a chosen EID absent from the independent match before creating any effect", async () => {
    const h = await world.executionFixture(false, { match: "unique" }), root = h.start();
    await h.rawExecution.execute(root, signal()); assert.equal(h.approve(root, { decision: "existing-person", emplId: "10800000" }).state, "applied");
    const refused = await h.rawExecution.execute(root, signal());
    assert.ok(refused.run?.lifecycle.state === "terminal" && refused.run.lifecycle.outcome === "failed");
    assert.equal(h.database.authority.failures.listByRun(root.envelope.runId)[0]?.code, "ONBOARDING_WRITE_REVIEW_REFUSED");
    assert.deepEqual(h.database.authority.writeIntents.listByRun(root.envelope.runId), []); assert.deepEqual(h.repository.runOperations(root.envelope.runId), []);
    assert.equal(h.i9.events.some(event => event.startsWith("commit:")), false); assert.equal(h.hire.events.includes("commit:hire"), false);
  });
  it("retains operator-owned master edits as a resolve-required receipt without overwriting them", async () => {
    const h = await world.executionFixture(false, { match: "unique" }), root = h.start();
    await h.rawExecution.execute(root, signal());
    h.edit(workbook => { workbook.sheets[0].rows[1].cells[8].value = "900007"; });
    assert.equal(h.approve(root, { decision: "new-hire" }).state, "applied");
    terminal(await h.rawExecution.execute(root, signal()));
    const stored = h.database.authority.runResults.get(root.envelope.runId); assert.ok(stored);
    const output = OnboardingResultSchema.parse(stored.result.value);
    assert.equal(output.state, "master-review-required");
    assert.ok(output.rosterAccess.state === "recorded" && output.rosterAccess.receiptState === "resolve-required");
    assert.deepEqual(h.library.read(h.id)?.workbook.sheets[0].rows[1].cells.slice(7).map(cell => cell.value), [null, "900007", null, null]);
    assert.equal(h.repository.runOperations(root.envelope.runId).length, 1);
  });

  it("refuses changed current filing status before publishing any master results", async () => {
    const h = await world.executionFixture(false, { match: "unique" }), root = h.start();
    const read = h.hire.scanHireTransactions.bind(h.hire); let savedReads = 0;
    h.hire.scanHireTransactions = async input => {
      if (h.hire.rows.length > 0 && ++savedReads === 2) h.hire.rows[0].approvalStatus = "Denied";
      return read(input);
    };
    const outcome = await h.execution.execute(root, signal());
    assert.ok(outcome.run?.lifecycle.state === "terminal" && outcome.run.lifecycle.outcome === "failed");
    assert.equal(h.database.authority.failures.listByRun(root.envelope.runId)[0]?.nodeId, "hire-receipt");
    assert.equal(h.database.authority.failures.listByRun(root.envelope.runId)[0]?.code, "UCPATH_HIRE_REFUSED");
    assert.equal(h.database.authority.writeIntents.listByRun(root.envelope.runId).filter(intent => intent.status === "committed").length, 3);
    assert.deepEqual(h.repository.runOperations(root.envelope.runId), []);
  });

  for (const role of ["profile", "remote", "hire"] as const) it(`parks an UNKNOWN public ${role} write before any master fill`, async () => {
    const failure = new Error("Synthetic lost submit response");
    const h = await world.executionFixture(false, { match: "unique",
      ...(role === "hire" ? { hire: { submitFailure: failure } } : { i9: { [role === "profile" ? "profileSubmitFailure" : "remoteSubmitFailure"]: failure } }) });
    const root = h.start(), outcome = await h.execution.execute(root, signal());
    assert.equal(outcome.run?.lifecycle.state, "parked-write");
    const parked = h.database.authority.writeIntents.listByRun(root.envelope.runId).filter(intent => intent.status === "parked");
    assert.equal(parked.length, 1); assert.equal(parked[0].generation, 1);
    assert.equal((role === "hire" ? h.hire.events : h.i9.events).filter(event => event === `commit:${role}`).length, 1);
    assert.deepEqual(h.repository.runOperations(root.envelope.runId), []);
  });

});
