import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { readOcrReviewAuthority } from "../../../../src/backend/runs/lifecycle/ocr-review-authority.js";
import { ExtractFormPage } from "../../../../src/models/processing/ocr/extract-form-page.js";
import { ReadManualOcrReading } from "../../../../src/models/workflows/ocr-page/read-manual-reading.js";
import { ReadOcrPageReading } from "../../../../src/models/workflows/ocr-page/read-page-reading.js";
import { OcrPageReadingSchema } from "../../../../src/models/workflows/ocr/page-accounting.js";
import { ReadOcrResult } from "../../../../src/models/workflows/ocr/read-result.js";
import { OcrApprovalReferenceSchema } from "../../../../src/models/workflows/ocr/result.js";
import { hydrateOcrReviewSeed } from "../../../../src/models/workflows/ocr/review-seed.js";
import { compileWorkflow, composeWorkflowModule, defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { ocrPageWorkflow } from "../../../../src/workflows/ocr-page/workflow.js";
import { buildOcr } from "../../../../src/workflows/ocr/steps/source-pages/step.js";
import { ocrWorkflow } from "../../../../src/workflows/ocr/workflow.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { ocrModule, ocrPageModule } from "../../../support/helpers/registered-workflows.js";

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

it("reads the canonical review published by a renamed parent result node", async () => {
  const ocr = composeWorkflowModule(compileWorkflow(defineWorkflow({ ...ocrWorkflow,
    steps: author => {
      const original = buildOcr(author);
      const [sourcePages, pageReadings, reviewRecords, identityLookups, signerLookups, approvalStep] = original.steps;
      const [pages] = pageReadings[1], [review] = reviewRecords[1], [identities] = identityLookups[1], [signers] = signerLookups[1];
      const completed = author.task({ id: "collect-review-result", contract: ReadOcrResult, replay: "always-rerun" },
        [review, pages, identities, signers], ({ input, outputs }) => ({
          review: hydrateOcrReviewSeed(outputs["build-review"], extractionId => {
            const page = outputs["read-pages"].find(entry => entry.state === "done" && entry.output.extractionId === extractionId);
            return page?.state === "done" ? page.output : undefined;
          }, input.roster),
          outcomes: [...outputs["lookup-identities"], ...outputs["lookup-signers"]],
        }));
      const approval = author.gate({ id: "approve-records", label: "Approve selected records", resolvedBy: "operator",
        result: OcrApprovalReferenceSchema, when: { kind: "equals", of: { from: "input", path: "approval" }, value: "release" },
      }, [completed]);
      const signerStep = signerLookups[0];
      assert.ok(signerStep.manual);
      const renamedSignerStep = author.group(signerStep, { manual: { ...signerStep.manual, skips: [signers.id, completed.id] } });
      return {
        steps: [sourcePages, pageReadings, reviewRecords, identityLookups, [renamedSignerStep, [signers, completed]], [approvalStep[0], [approval]]],
        result: author.result(original.result.schema, [completed, approval, review], ({ input, outputs }) =>
          original.result.derive({ input, outputs: { ...outputs, "read-result": outputs["collect-review-result"] } })),
      };
    },
  })), ocrModule.stores);
  const f = await world.fixture({ ocr });
  const runId = f.run.envelope.runId;
  const published = f.database.authority.ocrReviews.latest(runId);
  assert.ok(published?.origin.kind === "checkpoint");
  assert.equal(published.origin.checkpoint.nodeId, "collect-review-result");
  const canonical = f.database.withAuthorityReadSnapshot(() => readOcrReviewAuthority(f.database.authority, f.canonical.lifecycle, runId));
  assert.deepEqual(canonical?.revision, published);
});
