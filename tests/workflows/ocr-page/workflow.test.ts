import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DataPointSchema } from "../../../src/rules/workflow/task-provenance.js";
import { compileWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { descriptorRuntimeNodes, workflowTerminalResultExecution, workflowPlanning } from "../../../src/workflow-kit/workflow.js";
import { evaluateNodeCondition } from "../../../src/models/workflow/node-condition.js";
import { OcrPageWorkflowInputSchema } from "../../../src/models/workflows/ocr-page/input.js";
import { ReadOcrPageReading } from "../../../src/models/workflows/ocr-page/read-page-reading.js";
import { ReadManualOcrReading } from "../../../src/models/workflows/ocr-page/read-manual-reading.js";
import { OcrPageReadingSchema, ocrExtractionItemId, bindManualOcrPageReading } from "../../../src/models/workflows/ocr/page-accounting.js";
import { readManualOcrReadingTask } from "../../../src/workflows/ocr-page/tasks/read-manual-reading.js";
import { createTaskProvenanceCollector } from "../../../src/backend/runs/provenance/task-provenance.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { JsonValueSchema } from "../../../src/rules/validation/canonical-json.js";
import { readOcrPageReadingTask } from "../../../src/workflows/ocr-page/tasks/read-page-reading.js";
import { ocrPageWorkflow } from "../../../src/workflows/ocr-page/workflow.js";
import { deriveItemId } from "../../../src/rules/identity/identifiers.js";
import { admittedPage, sourceFixture, submittedPage, SOURCE_RUN_ID, READ_AT } from "../../support/fixtures/ocr/source-pages.js";
import { readOcrPageFixture } from "../../support/fixtures/ocr/read-page.js";
import { ocrTaskContext } from "../../support/fixtures/ocr/task-context.js";

const descriptor = compileWorkflow(ocrPageWorkflow).descriptor;
const extract = descriptorRuntimeNodes(descriptor).find(node => node.id === "extract");
const bind = descriptorRuntimeNodes(descriptor).find(node => node.id === "read-page-reading");
assert.ok(extract?.kind === "task" && bind?.kind === "task" && extract.when !== undefined);
const extractionCondition = extract.when;

describe("unregistered OCR page graph", () => {
  it.each(["emergency-contact", "oath", "i9"] as const)("calls the existing subscription task for %s and retains canonical child identity", async formType => {
    const { inputs } = sourceFixture(1, formType);
    const input = OcrPageWorkflowInputSchema.parse({ page: inputs[0], reading: { kind: "subscription" } });
    assert.equal(evaluateNodeCondition(extractionCondition, { input, outputs: {} }), true);
    const { reading: output, requests, recorded } = await readOcrPageFixture(input);
    assert.deepEqual(OcrPageReadingSchema.parse(workflowTerminalResultExecution(descriptor).derive({ input, outputs: { "read-page-reading": output } })), output);
    assert.equal(requests.length, 1);
    assert.equal(output.input.formType, formType);
    assert.equal(ocrExtractionItemId(input.page), deriveItemId("ocr-page", workflowPlanning(descriptor).matchKey(input)));
    assert.deepEqual(recorded.slice(-3).map(point => DataPointSchema.parse(point).field), ["input", "extractionId", "extraction"]);
  });

  it("skips the provider for manual assertions and rejects absent, foreign or mixed readings", async () => {
    const { inputs } = sourceFixture(1);
    const page = inputs[0];
    const input = OcrPageWorkflowInputSchema.parse({ page, reading: { kind: "manual", actorId: "local-operator",
      extraction: bindManualOcrPageReading(page, "local-operator", { ...submittedPage(page),
        source: { kind: "operator", actorId: "local-operator" } }).extraction } });
    assert.equal(evaluateNodeCondition(extractionCondition, { input, outputs: {} }), false);
    const { reading: output, requests, recorded } = await readOcrPageFixture(input);
    assert.deepEqual(requests, []);
    assert.deepEqual(output.extraction.source, { kind: "operator", actorId: "local-operator" });
    assert.equal(recorded.length, 3);
    const collector = createTaskProvenanceCollector({ descriptor, execution: { runId: SOURCE_RUN_ID,
      traceId: "op-100000-0000", attempt: 1, workflowId: "ocr-page", nodeId: "manual-reading", taskId: ReadManualOcrReading.id },
      upstreamEvidence: { checkpoints: [] }, clock: manualClock(new Date(READ_AT)), canonicalInput: JsonValueSchema.parse(input), onRecord: () => undefined });
    const retained = await readManualOcrReadingTask.impl.run({ input, ctx: { ...ocrTaskContext().ctx, recordData: collector.recordData } });
    assert.ok(collector.finalizeRead(retained).provenance.length > 0);
    for (const candidate of [
      { ...input, reading: { ...input.reading, actorId: "foreign-operator" } },
      { ...input, reading: { ...input.reading, extraction: { ...output.extraction, pageFingerprint: "f".repeat(64) } } },
    ]) {
      const refused = ocrTaskContext();
      await assert.rejects(readManualOcrReadingTask.impl.run({ input: ReadManualOcrReading.input.parse(candidate), ctx: refused.ctx }), /does not match/);
      assert.deepEqual(refused.recorded, []);
    }
    const variants = [
      { request: { ...input, reading: { kind: "subscription" } }, extraction: null },
      { request: input, extraction: admittedPage(page) },
      { request: { ...input, reading: { ...input.reading, actorId: "foreign-operator" } }, extraction: null },
    ];
    for (const variant of variants) {
      const refused = ocrTaskContext();
      await assert.rejects(readOcrPageReadingTask.impl.run({ input: ReadOcrPageReading.input.parse(variant), ctx: refused.ctx }), /exact source request/);
      assert.deepEqual(refused.recorded, []);
    }
  });
});
