import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { workflowModuleOf, childWorkflowModuleOf, READABLE_WORKFLOW_MODULES } from "../../../../src/backend/app/registries/workflow-registry.js";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { createOperatorRunDetail } from "../../../../src/backend/app/composition/dashboard/run-detail.js";
import { createReceiptService } from "../../../../src/backend/runs/trust/receipt-service.js";
import { buildRunLogsSection } from "../../../../src/backend/runs/queries/run-logs.js";
import { createDeterministicUcpathContactPage } from "../../../../src/backend/systems/ucpath/driver/contact-fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/backend/systems/ucpath/driver/fake.js";
import { UcpathContactPageSnapshotSchema } from "../../../../src/models/ui/ucpath-emergency-contact.js";
import { sessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import contactPage from "../../../support/fixtures/ui/ucpath/emergency-contact.fixture.json";

const world = createOcrReviewWorld();
afterEach(world.cleanup);

it("serves parent and child preview receipts and Logs while preserving ordinary read-only OCR output", async () => {
  const port = createDeterministicUcpathContactPage({ initial: UcpathContactPageSnapshotSchema.parse({ ...contactPage.page,
    displayedEid: "10800000", displayedName: "Example, Avery" }) });
  const sessions = sessionFactoryHarness({ ucpath: () => createDeterministicUcpathPersonOrgDriver(undefined, undefined, port) });
  const f = await world.fixture({ coordinator: true, record: true, dryRun: true, sessions,
    screenshotCapture: { capture: async context => { assert.equal(context.screenshot.state, "available"); await port.snapshot(); } } });
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
  assert.equal(f.canonical.kernel.execute(f.approval()).state, "applied");
  const completed = await f.canonical.execute(f.parentRun, new AbortController().signal);
  assert.ok(completed.run?.lifecycle.state === "terminal" && completed.run.lifecycle.outcome === "done");
  const children = f.database.authority.runs.listChildren(f.parentRun.envelope.runId);
  const member = children.find(run => run.envelope.workflow === "emergency-contact-member"); assert.ok(member);
  assert.equal(member.lifecycle.state === "terminal" ? member.lifecycle.outcome : member.lifecycle.state, "done");
  const modules = [workflowModuleOf("emergency-contact"), childWorkflowModuleOf("emergency-contact", "ocr"), childWorkflowModuleOf("emergency-contact", "emergency-contact-member")];
  const receipts = createReceiptService({ database: f.database, runReader: f.canonical.lifecycle,
    descriptors: modules.map(module => module.descriptor) });
  for (const run of [completed.run, member]) {
    const receipt = receipts.ensureReceipt(run.envelope.runId);
    assert.deepEqual(receipt.output, []);
    assert.equal(receipt.warnings.some(warning => warning.code === "DRY_RUN_PREVIEW"), true);
    assert.deepEqual(receipts.ensureReceipt(run.envelope.runId), receipt);
  }
  assert.equal(receipts.ensureReceipt(f.run.envelope.runId).warnings.some(warning => warning.code === "DRY_RUN_PREVIEW"), false);
  const descriptors = { resolve: (id: string) => READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === id)?.descriptor };
  const projection = createOperatorProjection({ database: f.database, reader: f.canonical.lifecycle, descriptors,
    stateRoot: f.harness.authority.stateRoot, clock: f.clock, appVersion: "0.1.0", descriptorSetHash: f.parentRun.envelope.contractFingerprint,
    ledger: { foldActivityRange: () => { throw new Error("unrequested activity"); } } });
  projection.rebuildFromTimeline();
  const detail = createOperatorRunDetail({ database: f.database, runReader: f.canonical.lifecycle, projection,
    stateRoot: f.harness.authority.stateRoot, canonical: { database: f.database, reader: f.canonical.lifecycle, descriptors } });
  assert.ok(detail.descriptors.resolve("ocr")?.dataOrigins?.length);
  assert.ok(detail.descriptors.resolve("emergency-contact-member")?.dataOrigins?.length);
  for (const run of [completed.run, member, f.database.authority.runs.get(f.run.envelope.runId)]) {
    assert.ok(run);
    const logs = buildRunLogsSection(detail, run.envelope.runId, projection.runFold(run.envelope.runId), run);
    assert.equal(logs.section, "logs"); if (logs.section !== "logs") throw new Error("logs required");
    if (run.envelope.workflow === "ocr") assert.equal(logs.payload.dryRunPreview, undefined);
    else {
      assert.equal(logs.payload.dryRunPreview?.state, "available");
      const preview = logs.payload.dryRunPreview; assert.ok(preview?.state === "available");
      assert.equal(preview.coverage, "full");
      assert.ok(preview.stages.some(stage => /without (saving|submitting)/u.test(stage.detail)));
    }
  }
  assert.equal(port.actions.some(action => action.startsWith("save")), false);
});
