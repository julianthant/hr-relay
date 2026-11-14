import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { redactObservedDataPoints } from "../../../../src/backend/logs/observed-data.js";
import { ExecutorSpanEventSchema, runSpanPath, taskSpanPath } from "../../../../src/backend/logs/span-emitter.js";
import { createTaskProvenanceCollector } from "../../../../src/backend/runs/provenance/task-provenance.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { createTimelineRepository } from "../../../../src/backend/storage/sqlite/timeline-repository.js";
import { observationLeafPaths } from "../../../../src/models/events/data-observation-origin.js";
import { TimelineAppendSchema, type TimelineRepository } from "../../../../src/models/events/timeline.js";
import { ExtractPdfPages } from "../../../../src/models/processing/extraction/extract-pdf-pages.js";
import { evidenceLeaves } from "../../../../src/models/trust/evidence-classification.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { OcrInputSchema } from "../../../../src/models/workflows/ocr/input.js";
import { ReadOcrSourcePages, ocrPageWorkInputs } from "../../../../src/models/workflows/ocr/read-source-pages.js";
import { canonicalJsonStringify, JsonValueSchema } from "../../../../src/rules/validation/canonical-json.js";
import { RedactedFieldSchema, retainLocalEvidenceValue } from "../../../../src/rules/redaction/redaction.js";
import { TraceIdSchema, type NodeId } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { RecordedDataPointSchema, type RecordedDataPoint } from "../../../../src/rules/workflow/task-provenance.js";
import { taskImplFingerprint } from "../../../../src/workflow-kit/fingerprints.js";
import { compileWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { descriptorRuntimeNodes } from "../../../../src/workflow-kit/workflow.js";
import { readOcrSourcePagesTask } from "../../../../src/workflows/ocr/tasks/read-source-pages.js";
import { ocrWorkflow } from "../../../../src/workflows/ocr/workflow.js";
import { ocrTaskContext } from "../../../support/fixtures/ocr/task-context.js";
import { READING_ID, SOURCE_RUN_ID, sourceFixture } from "../../../support/fixtures/ocr/source-pages.js";

const LIMIT = 256 * 1024;
const recordedAt = "2026-11-09T01:59:00.000Z";
const traceId = TraceIdSchema.parse("oc-000053-0120");
const descriptor = compileWorkflow(ocrWorkflow).descriptor;
const nodes = descriptorRuntimeNodes(descriptor);
function taskNode(id: string) {
  const node = nodes.find(entry => entry.id === id);
  if (node === undefined || node.kind !== "task") throw new Error(`OCR node ${id} is missing`);
  return node;
}
const sourceNode = taskNode("read-source-pages");
const renderNode = taskNode("render-pages");

function openRepository(): Readonly<{ database: DatabaseSync; repository: TimelineRepository }> {
  const database = new DatabaseSync(":memory:");
  for (const migration of SQLITE_MIGRATIONS) for (const statement of migration.statements) database.exec(statement);
  database.exec("PRAGMA foreign_keys = OFF");
  database.prepare(`INSERT INTO runs (id, workflow, item_id, attempt, state, priority, claim_generation, version,
    settings_snapshot_id, descriptor_version, contract_fingerprint, trace_id, dry_run, local_day, enqueued_at,
    envelope_json, lifecycle_json, created_at, updated_at)
    VALUES (?, 'ocr', ?, 1, 'queued', 'interactive', 0, 1, 'synthetic-snapshot', 1, ?, ?, 0, '2026-11-09', ?, '{}', '{}', ?, ?)`).run(
    SOURCE_RUN_ID, READING_ID, "a".repeat(64), traceId, recordedAt, recordedAt, recordedAt);
  database.exec("PRAGMA foreign_keys = ON");
  return { database, repository: createTimelineRepository({ database, assertOwner: () => {}, read: work => work(),
    mutate: work => {
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = work();
        database.exec("COMMIT");
        return result.result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    } }) };
}

function retainedPagePoint(field: string, value: unknown) {
  const spanPath = taskSpanPath(traceId, sourceNode.id, 1, 1);
  const parsed = JsonValueSchema.parse(value);
  return {
    direction: "read" as const,
    field,
    values: evidenceLeaves(parsed, field).map(leaf => RedactedFieldSchema.parse({
      key: leaf.path, ...retainLocalEvidenceValue("sensitive-hr", "drop", leaf.value),
    })),
    origins: observationLeafPaths(parsed).map(path => ({ path: [...path], origin: {
      runId: SOURCE_RUN_ID, attempt: 1, spanPath, nodeId: "read-source-pages", taskId: sourceNode.uses.id, field, path: [...path],
    } })),
  };
}

function send(store: TimelineRepository, nodeId: NodeId, taskId: string, points: readonly unknown[]) {
  let bytes = 0;
  const wrapped: TimelineRepository = { ...store, append(input: unknown) {
    const record = TimelineAppendSchema.parse(input);
    bytes = Buffer.byteLength(canonicalJsonStringify(record), "utf8");
    return store.append(record);
  } };
  let error: unknown;
  try {
    createTimelineEmitter({ repository: wrapped, clock: manualClock(new Date(recordedAt)), pid: 1 }).emit(ExecutorSpanEventSchema.parse({
      t: "data.observed", ts: recordedAt, workflow: descriptor.id, runId: SOURCE_RUN_ID, attempt: 1, traceId,
      spanPath: taskSpanPath(traceId, nodeId, 1, 1), parentSpanPath: runSpanPath(traceId), nodeId, taskId, observedAt: recordedAt, points,
    }));
  } catch (caught) { error = caught; }
  return { bytes, error };
}

describe("read-source-pages timeline events", () => {
  it("stores a 120-page binding and rejects the page-list observation that exceeded 256 KiB", async () => {
    const opened = openRepository();
    const store = opened.repository;
    const sizes: Record<string, number> = {};
    try {
      for (const pageCount of [53, 120]) {
        const source = sourceFixture(pageCount);
        const request = OcrInputSchema.parse({ sourceRunId: SOURCE_RUN_ID, document: source.manifest.document,
          formType: "emergency-contact", readingId: READING_ID, roster: null, reading: { kind: "subscription" } });
        const rendered = { pageCount, pages: source.manifest.pages };
        const batches: RecordedDataPoint[][] = [];
        const collector = createTaskProvenanceCollector({
          descriptor,
          execution: { runId: SOURCE_RUN_ID, traceId, attempt: 1, workflowId: descriptor.id, nodeId: "read-source-pages", taskId: ReadOcrSourcePages.id },
          observationSpanPath: taskSpanPath(traceId, sourceNode.id, 1, 1),
          upstreamEvidence: { checkpoints: [RunCheckpointRecordSchema.parse({
            workflowId: descriptor.id, itemId: READING_ID, nodeId: "render-pages", attempt: 1, claimGeneration: 1, runId: SOURCE_RUN_ID,
            output: { schemaHash: deriveSchemaHash(ExtractPdfPages.output, "output"), value: JsonValueSchema.parse(rendered) },
            descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint, implFingerprint: taskImplFingerprint(renderNode.uses),
            provenance: ["pageCount", "pages"].map(path => ({ path, source: "live", observedAt: recordedAt, originalObservedAt: recordedAt })),
            writtenAt: recordedAt,
          })] },
          clock: manualClock(new Date(recordedAt)),
          onRecord: batch => batches.push([...batch.points]),
        });
        const output = await readOcrSourcePagesTask.impl.run({ input: { request, rendered }, ctx: { ...ocrTaskContext().ctx, recordData: collector.recordData } });
        assert.deepEqual(output, { manifest: { document: source.manifest.document, pageCount, fingerprint: source.manifest.fingerprint } });
        assert.equal(batches.length, 1);
        assert.equal(batches[0]?.every(point => point.origins === undefined), true);
        const recorded = batches[0];
        assert.ok(recorded !== undefined);
        const current = send(store, sourceNode.id, sourceNode.uses.id, redactObservedDataPoints(ReadOcrSourcePages.id, recorded));
        assert.equal(current.error, undefined, `${String(pageCount)} pages: ${String(current.bytes)} bytes`);
        assert.ok(current.bytes < 8 * 1024, `${String(pageCount)} bound: ${String(current.bytes)} bytes`);
        sizes[`current-${String(pageCount)}`] = current.bytes;
        const stored = store.page({ runId: SOURCE_RUN_ID }).at(-1);
        assert.ok(stored?.payload.kind === "span" && stored.payload.event.t === "data.observed");
        if (stored.payload.kind !== "span" || stored.payload.event.t !== "data.observed") throw new Error("observed event missing");
        assert.deepEqual(stored.payload.event.points.map(point => point.field), ["manifest"]);
        assert.equal(stored.payload.event.points.every(point => point.origins === undefined), true);
        assert.equal(stored.payload.event.points[0]?.values.some(value => value.key === "manifest.pageCount" && value.state === "allowed" && value.value === pageCount), true);

        const { manifest, pages } = ocrPageWorkInputs(request, rendered);
        const old = send(store, sourceNode.id, sourceNode.uses.id, [retainedPagePoint("manifest", manifest), retainedPagePoint("pages", pages)]);
        assert.ok(old.bytes > LIMIT, `${String(pageCount)} old event: ${String(old.bytes)} bytes`);
        assert.equal(old.error instanceof Error ? old.error.message : undefined, "timeline-event-size-exceeded");
        sizes[`old-${String(pageCount)}`] = old.bytes;
      const pagesOnly = send(store, sourceNode.id, sourceNode.uses.id, [retainedPagePoint("pages", pages)]);
      const manifestOnly = send(store, sourceNode.id, sourceNode.uses.id, [retainedPagePoint("manifest", manifest)]);
        sizes[`pages-${String(pageCount)}`] = pagesOnly.bytes;
        sizes[`manifest-${String(pageCount)}`] = manifestOnly.bytes;
        if (pageCount === 120) {
          assert.equal(pagesOnly.error instanceof Error ? pagesOnly.error.message : undefined, "timeline-event-size-exceeded");
          assert.equal(manifestOnly.error, undefined, `manifest origins: ${String(manifestOnly.bytes)} bytes`);
        } else {
          assert.equal(pagesOnly.error, undefined, `53 page inputs: ${String(pagesOnly.bytes)} bytes`);
          assert.ok(pagesOnly.bytes < LIMIT);
        }
        const renderIdentity = { runId: SOURCE_RUN_ID, traceId, attempt: 1, workflowId: descriptor.id, nodeId: "render-pages", taskId: renderNode.uses.id };
        const render = send(store, renderNode.id, renderNode.uses.id, redactObservedDataPoints(renderNode.uses.id, [
          RecordedDataPointSchema.parse({ direction: "read", field: "pageCount", value: pageCount, execution: renderIdentity, recordedAt }),
          RecordedDataPointSchema.parse({ direction: "read", field: "pages", value: rendered.pages, execution: renderIdentity, recordedAt }),
        ]));
        assert.equal(render.error, undefined, `${String(pageCount)} rendered pages: ${String(render.bytes)} bytes`);
        assert.ok(render.bytes < LIMIT);
        sizes[`render-${String(pageCount)}`] = render.bytes;
      }
      assert.ok(sizes["old-120"] > sizes["old-53"]);
      assert.ok(sizes["pages-120"] > sizes["pages-53"]);
      assert.ok(sizes["manifest-120"] > sizes["manifest-53"]);
      assert.ok(sizes["current-120"] - sizes["current-53"] < 16);
      assert.ok(sizes["render-120"] < LIMIT && sizes["render-120"] > sizes["render-53"]);
    } finally { opened.database.close(); }
  });
});
