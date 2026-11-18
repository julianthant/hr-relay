import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { ExtractFormPage } from "../../../../src/models/processing/ocr/extract-form-page.js";
import { ReadManualOcrReading } from "../../../../src/models/workflows/ocr-page/read-manual-reading.js";
import { ReadOcrPageReading } from "../../../../src/models/workflows/ocr-page/read-page-reading.js";
import { OcrPageReadingSchema } from "../../../../src/models/workflows/ocr/page-accounting.js";
import { compileWorkflow, composeWorkflowModule, defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { ocrPageWorkflow } from "../../../../src/workflows/ocr-page/workflow.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { ocrPageModule } from "../../../support/helpers/registered-workflows.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);
for (const actorId of ["local-operator", "foreign-operator"]) {
  it(`publishes manual page evidence only for the authenticated actor (${actorId})`, async () => {
    const f = await world.fixture({ actorId });
    const child = f.database.authority.runs.listChildren(f.run.envelope.runId)[0]; assert.ok(child);
    const checkpoints = f.database.authority.runCheckpoints.listByAttempt(child.envelope.workflow,
      child.envelope.itemId, "manual-reading", child.envelope.attempt).filter(row => row.runId === child.envelope.runId);
    if (actorId === "local-operator") {
      assert.ok(f.result.run?.lifecycle.state === "terminal" && f.result.run.lifecycle.outcome === "done");
      assert.equal(checkpoints.length, 1);
      assert.deepEqual(OcrPageReadingSchema.parse(checkpoints[0]?.output.value), f.reading);
      assert.deepEqual(f.database.authority.ocrExtractions.get(f.reading.extractionId), { ...f.reading, binding: "source-bound" });
      assert.equal(f.database.authority.ocrReviews.latest(f.run.envelope.runId)?.sourceRunId, f.run.envelope.runId);
    } else {
      assert.equal(checkpoints.length, 0);
      assert.equal(f.database.authority.ocrExtractions.get(f.reading.extractionId), undefined);
      assert.ok(child.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed");
    }
    assert.equal(f.database.readProfileResourceCustody().writeIntents.length, 0);
  });
}

it("publishes the reading and parent review when the manual checkpoint node is renamed", async () => {
  const ocrPage = composeWorkflowModule(compileWorkflow(defineWorkflow({ ...ocrPageWorkflow,
    steps: ({ task, result }) => {
      const extract = task({ id: "extract", contract: ExtractFormPage, replay: "checkpoint",
        when: { kind: "equals", of: { from: "input", path: "reading.kind" }, value: "subscription" },
      }, [], ({ input }) => ({ formType: input.page.formType, page: input.page.image, sourcePage: input.page.sourcePage }));
      const subscription = task({ id: "read-page-reading", contract: ReadOcrPageReading, replay: "checkpoint",
        when: { kind: "equals", of: { from: "input", path: "reading.kind" }, value: "subscription" },
      }, [extract], ({ input, outputs }) => ({ request: input, extraction: outputs.extract ?? null }));
      const manual = task({ id: "capture-assertion", contract: ReadManualOcrReading, replay: "checkpoint",
        when: { kind: "equals", of: { from: "input", path: "reading.kind" }, value: "manual" },
      }, [], ({ input }) => input);
      return {
        steps: [[{ key: "read-page", label: "Read source page" }, [extract, subscription, manual]]],
        result: result(OcrPageReadingSchema, [subscription, manual], ({ outputs }) => {
          const reading = outputs["capture-assertion"] ?? outputs["read-page-reading"];
          assert.ok(reading);
          return reading;
        }),
      };
    },
  })), ocrPageModule.stores);
  const f = await world.fixture({ ocrPage });
  const authority = f.database.authority;
  const child = authority.runs.listChildren(f.run.envelope.runId)[0];
  assert.ok(child);
  assert.equal(authority.runCheckpoints.listByAttempt(child.envelope.workflow,
    child.envelope.itemId, "capture-assertion", child.envelope.attempt).filter(row => row.runId === child.envelope.runId).length, 1);
  assert.deepEqual(authority.ocrExtractions.get(f.reading.extractionId), { ...f.reading, binding: "source-bound" });
  assert.equal(authority.ocrReviews.latest(f.run.envelope.runId)?.sourceRunId, f.run.envelope.runId);
  assert.ok(f.result.run?.lifecycle.state === "terminal" && f.result.run.lifecycle.outcome === "done");
});
