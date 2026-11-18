import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { extractFormPageTask } from "../../../src/backend/processing/ocr/tasks/extract-form-page.js";
import { redactObservedDataPoints } from "../../../src/backend/logs/observed-data.js";
import { buildRunLogsSection, runDataObservationsForRun } from "../../../src/backend/runs/queries/run-logs.js";
import { dataOriginViewsOf } from "../../../src/backend/app/composition/dashboard/run-detail-descriptors.js";
import { ArtifactRefSchema } from "../../../src/models/artifacts/artifacts.js";
import { ExtractFormPage, OCR_EXTRACTION_RESPONSE_HASH } from "../../../src/models/processing/ocr/extract-form-page.js";
import { RecordedDataPointSchema } from "../../../src/rules/workflow/task-provenance.js";
import { sha256Hex } from "../../../src/rules/validation/sha256.js";
import { ocrTaskContext } from "../../support/fixtures/ocr/task-context.js";
import { createRunQueueProjectionTestWorld } from "../../support/helpers/backend/run-queue-projection-world.js";
import { ocrPageModule } from "../../support/helpers/registered-workflows.js";
import { uuidOf } from "../../support/helpers/backend/dashboard-harness.js";

const { world, queuedEventOf, cleanup } = createRunQueueProjectionTestWorld();
afterEach(cleanup);

const SSN_RAW = "902-48-1357";
const SSN_CANONICAL = "902481357";
const page = ArtifactRefSchema.parse({ id: "11111111-2222-4333-8444-555555555555", sha256: sha256Hex("synthetic i9 page"), bytes: 17, mediaType: "image/png" });

async function extractI9Section1() {
  const { ctx, recorded } = ocrTaskContext();
  const output = await extractFormPageTask.impl.run({
    input: ExtractFormPage.input.parse({ formType: "i9", page, sourcePage: 1 }),
    ctx: { ...ctx, artifacts: {
      put: async () => { throw new Error("OCR extraction writes no artifact"); },
      open: async () => { throw new Error("the provider reads the source artifact"); },
    }, providers: { "ocr.extract": { capability: "ocr.extract", call: async () => ({ state: "produced" as const, value: {
      schemaHash: OCR_EXTRACTION_RESPONSE_HASH, value: {
        formType: "i9", source: { kind: "provider", providerId: "chatgpt-subscription", modelId: "synthetic-test-model" },
        readAt: "2026-11-18T00:00:00.000Z", sourceSha256: page.sha256, sourcePage: 1, pageKind: "i9-section1",
        record: { answers: {
          lastName: { state: "read", raw: "Example", confidence: 0.95 },
          firstName: { state: "read", raw: "Avery", confidence: 0.95 },
          middleInitial: { state: "absent", reason: "blank" },
          dateOfBirth: { state: "read", raw: "01/02/1990", confidence: 0.95 },
          ssn: { state: "read", raw: SSN_RAW, confidence: 0.92 },
          hireDate: { state: "absent", reason: "not-on-form" },
        } },
      },
    } }) } } } as never,
  });
  return { output, recorded };
}

it("keeps a read I-9 SSN in the OCR output and out of the observation, Context Data and Logs", async () => {
  const { output, recorded } = await extractI9Section1();
  const ssn = output.record?.answers.find(answer => answer.path === "ssn");
  assert.ok(ssn?.state === "read");
  assert.equal(ssn.raw, SSN_RAW);
  assert.equal(ssn.value, SSN_CANONICAL);

  const w = await world();
  queuedEventOf(w, { seed: 91, descriptor: ocrPageModule.descriptor });
  const run = w.authority.records.get(uuidOf(91));
  assert.ok(run);
  const at = w.clock.now().toISOString();
  const identity = { runId: run.envelope.runId, attempt: 1, spanPath: `${run.envelope.traceId}/extract#1.1`, nodeId: "extract", taskId: ExtractFormPage.id };
  const execution = { runId: run.envelope.runId, traceId: run.envelope.traceId, attempt: 1, workflowId: run.envelope.workflow, nodeId: "extract", taskId: ExtractFormPage.id };
  const points = redactObservedDataPoints(ExtractFormPage.id,
    recorded.map(point => RecordedDataPointSchema.parse({ ...(point as object), execution, recordedAt: at })));
  const observed = JSON.stringify(points);
  assert.ok(observed.includes("Avery"), "the observation keeps the rest of the record");
  assert.ok(observed.includes(`"path":"ssn"`), "the observation still names the SSN answer");
  for (const leak of [SSN_RAW, SSN_CANONICAL]) assert.equal(observed.includes(leak), false, `observation carries ${leak}`);

  w.writer.emit({ t: "data.observed", ts: at, observedAt: at, workflow: run.envelope.workflow, traceId: run.envelope.traceId, ...identity, points });
  w.projection.ingestFromTimeline();
  const deps = { runReader: w.runReader, timeline: w.timeline, stateRoot: w.stateRoot, projection: w.projection, authority: w.authority,
    descriptors: { resolve: () => ({ dataOrigins: dataOriginViewsOf(ocrPageModule) }) } };
  const contextData = JSON.stringify(runDataObservationsForRun(deps as never, run, run.envelope.runId));
  const logs = JSON.stringify(buildRunLogsSection(deps as never, run.envelope.runId, undefined, run));
  assert.ok(contextData.includes("Avery"));
  for (const served of [contextData, logs]) {
    for (const leak of [SSN_RAW, SSN_CANONICAL]) assert.equal(served.includes(leak), false, `served payload carries ${leak}`);
  }
});
