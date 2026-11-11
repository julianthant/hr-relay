import assert from "node:assert/strict";
import { workflowModuleOf, childWorkflowModuleOf, READABLE_WORKFLOW_MODULES } from "../../../../src/backend/app/registries/workflow-registry.js";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { createOperatorRunDetail } from "../../../../src/backend/app/composition/dashboard/run-detail.js";
import { createReceiptService } from "../../../../src/backend/runs/trust/receipt-service.js";
import { buildRunLogsSection } from "../../../../src/backend/runs/queries/run-logs.js";
import { createDeterministicUcpathContactPage } from "../../../../src/backend/systems/ucpath/driver/contact-fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/backend/systems/ucpath/driver/fake.js";
import { UcpathContactPageSnapshotSchema } from "../../../../src/models/ui/ucpath-emergency-contact.js";
import { sessionFactoryHarness } from "../phase1f-executor-harness.js";
import { createOcrReviewWorld } from "./ocr-review-world.js";
import { onbaseOcrWorldChild } from "./onbase-child-fixture.js";
import contactPage from "../../fixtures/ui/ucpath/emergency-contact.fixture.json";

import type { BoundProfileStorageFixture } from "../admission-fixture.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";
import { testRunService } from "../../fixtures/run-lifecycle-fixtures.js";
import { deriveRunResultDigest, deriveTerminalDependencyDigest, readRunPreviewResult } from "../../../../src/models/run/result.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";

export async function verifyRetainedDelegatedPreviewEvidence(
  beforeReopen?: (profile: BoundProfileStorageFixture) => Promise<"upgraded" | "refused">,
): Promise<void> {
  const world = createOcrReviewWorld();
  let reopened: AuthorityDatabase | undefined;
  try {
    const port = createDeterministicUcpathContactPage({ initial: UcpathContactPageSnapshotSchema.parse({ ...contactPage.page,
      displayedEid: "10800000", displayedName: "Example, Avery" }) });
    const onbaseChild = onbaseOcrWorldChild();
    const sessions = sessionFactoryHarness({ ucpath: () => createDeterministicUcpathPersonOrgDriver(undefined, undefined, port), onbase: onbaseChild.session });
    const f = await world.fixture({ coordinator: true, record: true, dryRun: true, sessions, ...onbaseChild.fixture,
      screenshotCapture: { capture: async context => { assert.equal(context.screenshot.state, "available"); await port.snapshot(); } } });
    assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
    assert.equal(f.canonical.kernel.execute(f.approval()).state, "applied");
    const completed = await f.canonical.execute(f.parentRun, new AbortController().signal);
    assert.ok(completed.run?.lifecycle.state === "terminal" && completed.run.lifecycle.outcome === "done");
    const children = f.database.authority.runs.listChildren(f.parentRun.envelope.runId);
    const member = children.find(run => run.envelope.workflow === "emergency-contact-member"); assert.ok(member);
    assert.equal(member.lifecycle.state === "terminal" ? member.lifecycle.outcome : member.lifecycle.state, "done");
    const previews = [completed.run, member].map(run => {
      const result = f.database.authority.runResults.get(run.envelope.runId); assert.ok(result);
      const hash = run.envelope.workflow === "emergency-contact"
        ? "06bdc474498e86c00a7982fce5a5b223704504ccd91f8c4ed2f9fb5384c6984f"
        : "56c14ccc71d195b045352f4a0c198b9fa0b87245ff4e399ff6f9ad4fe1589a1c";
      assert.equal(result.resultSchemaHash, hash);
      assert.equal(result.result.schemaHash, hash);
      assert.ok(readRunPreviewResult(result));
      assert.equal(deriveRunResultDigest(result.result), result.resultDigest);
      assert.equal(deriveTerminalDependencyDigest(result.dependencies), result.dependencyDigest);
      assert.ok(run.completion?.kind === "done");
      assert.equal(run.completion.resultDigest, result.resultDigest);
      return { run, result, bytes: canonicalJsonStringify(result) };
    });
    const parent = previews[0]; const child = previews[1]; assert.ok(parent && child);
    const dependency = parent.result.dependencies.find(entry => entry.state === "delegation-resolved"
      && entry.members.some(entry => entry.runId === member.envelope.runId));
    assert.ok(dependency?.state === "delegation-resolved");
    assert.equal(dependency.members.find(entry => entry.runId === member.envelope.runId)?.resultDigest, child.result.resultDigest);
    const modules = [workflowModuleOf("emergency-contact"), childWorkflowModuleOf("emergency-contact", "ocr"), childWorkflowModuleOf("emergency-contact", "emergency-contact-member"), childWorkflowModuleOf("emergency-contact-member", "onbase")];
    const beforeReceipts = createReceiptService({ database: f.database, runReader: f.canonical.lifecycle,
      descriptors: modules.map(module => module.descriptor) });
    const originalReceipts = previews.map(({ run }) => beforeReceipts.ensureReceipt(run.envelope.runId));
    await f.harness.manager.closeAll("worker-stop");
    f.harness.authority.closeDatabase();
    if (beforeReopen !== undefined && await beforeReopen(f.harness.authority.profile) === "refused") return;
    reopened = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "retained-preview-reopen" }, f.clock);
    const database = reopened, reader = testRunService(database, f.clock);
    for (const [index, saved] of previews.entries()) {
      const result = database.authority.runResults.get(saved.run.envelope.runId); assert.ok(result);
      assert.equal(canonicalJsonStringify(result), saved.bytes);
      assert.deepEqual(database.authority.runs.get(saved.run.envelope.runId)?.completion, saved.run.completion);
      assert.deepEqual(createReceiptService({ database, runReader: reader, descriptors: modules.map(module => module.descriptor) })
        .ensureReceipt(saved.run.envelope.runId), originalReceipts[index]);
    }
    const receipts = createReceiptService({ database, runReader: reader,
      descriptors: modules.map(module => module.descriptor) });
    for (const run of [completed.run, member]) {
      const receipt = receipts.ensureReceipt(run.envelope.runId);
      assert.deepEqual(receipt.output, []);
      assert.equal(receipt.warnings.some(warning => warning.code === "DRY_RUN_PREVIEW"), true);
      assert.deepEqual(receipts.ensureReceipt(run.envelope.runId), receipt);
    }
    assert.equal(receipts.ensureReceipt(f.run.envelope.runId).warnings.some(warning => warning.code === "DRY_RUN_PREVIEW"), false);
    const descriptors = { resolve: (id: string) => READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === id)?.descriptor };
    const projection = createOperatorProjection({ database, reader, descriptors,
      stateRoot: f.harness.authority.stateRoot, clock: f.clock, appVersion: "0.1.0", descriptorSetHash: f.parentRun.envelope.contractFingerprint,
      ledger: { foldActivityRange: () => { throw new Error("unrequested activity"); } } });
    projection.rebuildFromTimeline();
    const detail = createOperatorRunDetail({ database, runReader: reader, projection,
      stateRoot: f.harness.authority.stateRoot, canonical: { database, reader, descriptors } });
    assert.ok(detail.descriptors.resolve("ocr")?.dataOrigins?.length);
    assert.ok(detail.descriptors.resolve("emergency-contact-member")?.dataOrigins?.length);
    for (const run of [completed.run, member, database.authority.runs.get(f.run.envelope.runId)]) {
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

  } finally { reopened?.close(); await world.cleanup(); }
}
