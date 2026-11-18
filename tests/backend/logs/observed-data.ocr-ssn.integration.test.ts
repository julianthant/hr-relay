import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { extractFormPageTask } from "../../../src/backend/processing/ocr/tasks/extract-form-page.js";
import { redactObservedDataPoints } from "../../../src/backend/logs/observed-data.js";
import { buildRunLogsSection } from "../../../src/backend/runs/queries/run-logs.js";
import { buildDataSection } from "../../../src/backend/runs/queries/data.js";
import { dataOriginViewsOf } from "../../../src/backend/app/composition/dashboard/run-detail-descriptors.js";
import { ArtifactRefSchema } from "../../../src/models/artifacts/artifacts.js";
import { ExtractFormPage, OCR_EXTRACTION_RESPONSE_HASH } from "../../../src/models/processing/ocr/extract-form-page.js";
import { evidenceLeaves, redactEvidenceLeaf } from "../../../src/models/trust/evidence-classification.js";
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

type Recorded = Awaited<ReturnType<typeof extractI9Section1>>["recorded"];
const scope = { kind: "task-output", taskId: ExtractFormPage.id } as const;
const observationPaths = {
  "written by the current observation path": (recorded: Recorded, stamp: (point: unknown) => Parameters<typeof redactObservedDataPoints>[1][number]) =>
    redactObservedDataPoints(ExtractFormPage.id, recorded.map(stamp)),
  "retained from before the OCR SSN rule": (recorded: Recorded) => recorded.map(point => {
    const { direction, field, value } = point as { direction: "read"; field: string; value: unknown };
    return { direction, field, values: evidenceLeaves(value, field).map(leaf => redactEvidenceLeaf(scope, leaf)) };
  }),
};

for (const [label, observe] of Object.entries(observationPaths)) it(`serves no I-9 SSN in Context Data or Logs for an observation ${label}`, async () => {
  const { output, recorded } = await extractI9Section1();
  const ssn = output.record?.answers.find(answer => answer.path === "ssn");
  assert.ok(ssn?.state === "read");
  assert.equal(ssn.raw, SSN_RAW, "OCR authority keeps the original");
  assert.equal(ssn.value, SSN_CANONICAL);

  const w = await world();
  queuedEventOf(w, { seed: 91, descriptor: ocrPageModule.descriptor });
  const run = w.authority.records.get(uuidOf(91));
  assert.ok(run);
  const at = w.clock.now().toISOString();
  const identity = { runId: run.envelope.runId, attempt: 1, spanPath: `${run.envelope.traceId}/extract#1.1`, nodeId: "extract", taskId: ExtractFormPage.id };
  const execution = { runId: run.envelope.runId, traceId: run.envelope.traceId, attempt: 1, workflowId: run.envelope.workflow, nodeId: "extract", taskId: ExtractFormPage.id };
  const points = observe(recorded, point => RecordedDataPointSchema.parse({ ...(point as object), execution, recordedAt: at }));
  if (observe === observationPaths["written by the current observation path"]) {
    for (const leak of [SSN_RAW, SSN_CANONICAL]) assert.equal(JSON.stringify(points).includes(leak), false, `observation carries ${leak}`);
  }
  w.writer.emit({ t: "data.observed", ts: at, observedAt: at, workflow: run.envelope.workflow, traceId: run.envelope.traceId, ...identity, points });
  w.projection.ingestFromTimeline();

  const dataOrigins = dataOriginViewsOf(ocrPageModule).map(origin => origin.nodeId === "extract"
    ? { ...origin, operatorFields: [{ label: "Answer", kind: "output" as const, fieldPath: "record.answers.raw" }] } : origin);
  const deps = { runReader: w.runReader, timeline: w.timeline, stateRoot: w.stateRoot, projection: w.projection, authority: w.authority,
    descriptors: { resolve: () => ({ dataOrigins }) } };
  const contextData = buildDataSection(deps as never, run.envelope.runId, "context-data");
  assert.ok(contextData.section === "context-data");
  const logs = buildRunLogsSection(deps as never, run.envelope.runId, undefined, run);
  assert.ok(logs.section === "logs");
  const answers = logs.payload.rows?.flatMap(row => row.kind === "observed" ? row.displayFields ?? [] : [])
    .filter(field => field.label === "Answer").map(field => "value" in field ? field.value : undefined);
  assert.ok(answers?.includes("Avery"), "Logs serve the observed OCR answers");
  assert.ok(JSON.stringify(contextData).includes("Avery"), "Context Data serves the observed OCR record");
  for (const served of [JSON.stringify(contextData), JSON.stringify(logs)]) {
    for (const leak of [SSN_RAW, SSN_CANONICAL]) assert.equal(served.includes(leak), false, `served payload carries ${leak}`);
  }
});
