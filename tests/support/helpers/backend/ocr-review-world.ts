import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { SERVER_REGISTRY } from "../../../../src/backend/app/registries/workflow-registry.js";
import { createOcrCheckpointPublication } from "../../../../src/backend/runs/lifecycle/ocr-checkpoint-publication.js";
import { createOcrSourceService } from "../../../../src/backend/runs/commands/ocr-source-service.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createServerVerifiedArtifactReader } from "../../../../src/backend/storage/artifacts/server-verified-artifact-reader.js";
import { OcrInputSchema } from "../../../../src/models/workflows/ocr/input.js";
import { OcrApprovalReferenceSchema, OcrResultSchema } from "../../../../src/models/workflows/ocr/result.js";
import { OcrApprovedSnapshotSchema, ocrReviewDigest, ocrSnapshotDigest } from "../../../../src/models/ocr/review.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { bindManualOcrPageReading } from "../../../../src/models/workflows/ocr/page-accounting.js";
import { buildOcrSourceManifest, ocrPageInputs } from "../../../../src/models/workflows/ocr/source-manifest.js";
import { ExtractPdfPages, type ExtractPdfPagesOutputSchema } from "../../../../src/models/processing/extraction/extract-pdf-pages.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { defineServiceStore, defineTaskStoreRegistry, type RegisteredTaskStore } from "../../../../src/workflow-kit/task-registry.js";
import { UNREGISTERED_OCR_MODULES, UNREGISTERED_OCR_STORES } from "../../fixtures/ocr/unregistered-workflows.js";
import { submittedPage, READING_ID } from "../../fixtures/ocr/source-pages.js";
import { canonicalChildExecution } from "./canonical-child-execution.js";
import { createRunExecutorTestWorld } from "./run-executor-world.js";
import { boundProfileAdmission } from "../synthetic-database-admission.js";
import type { z } from "zod";

export function createOcrReviewWorld() {
  const world = createRunExecutorTestWorld();
  return {
    cleanup: world.cleanup,
    async fixture(options: Readonly<{ actorId?: string; record?: boolean; release?: boolean; pageCount?: number }> = {}) {
      const actorId = options.actorId ?? "local-operator";
      const rendered: { value?: z.output<typeof ExtractPdfPagesOutputSchema> } = {};
      const render = defineTask(ExtractPdfPages, { sessions: [], async run({ ctx }) {
        assert.ok(rendered.value);
        ctx.recordData([
          { direction: "read", field: "pageCount", value: rendered.value.pageCount },
          { direction: "read", field: "pages", value: rendered.value.pages },
        ]);
        return rendered.value;
      } });
      const entries: readonly RegisteredTaskStore[] = [...taskStoreRegistry.stores.filter(store => store.namespace !== "extraction"),
        defineServiceStore("extraction", { render }), ...UNREGISTERED_OCR_STORES];
      const tasks = entries.flatMap(store => Object.values(store.tasks));
      const stores = defineTaskStoreRegistry(entries, { scenarioIds: [...new Set(tasks.flatMap(task => task.contract.scenarios))],
        tasks: tasks.map(task => ({ id: task.contract.id, effect: task.contract.effect })) });
      const root = UNREGISTERED_OCR_MODULES.find(module => module.descriptor.id === "ocr"); assert.ok(root);
      const harness = await world.executorHarness({ descriptor: root.descriptor, stores });
      const { database, path, clock } = harness.authority;
      const admission = boundProfileAdmission(path);
      const artifacts = createContentAddressedArtifactWriter({ admission }); await artifacts.ready;
      const artifactReader = createServerVerifiedArtifactReader({ admission }); await artifactReader.ready;
      const resolve = (id: string) => (UNREGISTERED_OCR_MODULES.find(module => module.descriptor.id === id) ?? SERVER_REGISTRY[id])?.descriptor;
      const canonical = canonicalChildExecution({ ...harness.deps, artifacts }, database, path, resolve, createOcrCheckpointPublication);
      const sources = createOcrSourceService({ database, reader: canonical.lifecycle, clock, artifacts, artifactReader,
        assertCurrent: () => admission.assertProfileRuntime() });
      const upload = await sources.upload({ actorId: "local-operator", fileName: "source.pdf", mediaType: "application/pdf",
        bytes: new TextEncoder().encode("%PDF-1.7\nSynthetic renderer fixture\n%%EOF") });
      const pageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGvwAAAAASUVORK5CYII=", "base64");
      const image = await artifacts.put(pageBytes, { mediaType: "image/png" });
      rendered.value = { pageCount: options.pageCount ?? 1, pages: Array.from({ length: options.pageCount ?? 1 }, (_, index) => ({ sourcePage: index + 1, image })) };
      const manifest = buildOcrSourceManifest(upload.artifact, rendered.value);
      const readings = ocrPageInputs(manifest, READING_ID).map(page => {
        const original = submittedPage(page, "Example, Avery", options.record === true ? "emergency-contact" : "blank");
        const valid = { ...original, source: { kind: "operator" as const, actorId } };
        return { reading: bindManualOcrPageReading(page, actorId, { ...valid,
          record: valid.record === null ? null : { answers: { ...valid.record.answers, "employee.name": { state: "absent", reason: "blank" } } } }),
          corrected: bindManualOcrPageReading(page, actorId, valid).extraction.record };
      });
      const first = readings[0]; assert.ok(first);
      const { reading, corrected } = first;
      const run = canonical.start(root.descriptor, OcrInputSchema.parse({ document: upload.artifact, readingId: READING_ID,
        formType: "emergency-contact", roster: null, approval: options.release === true ? "release" : "review-only",
        reading: { kind: "manual", actorId, assertions: readings.map(({ reading }) => ({ sourcePage: reading.input.sourcePage, extraction: reading.extraction })) } }), { dryRun: false });
      const result = await canonical.execute(run, new AbortController().signal);
      if (actorId === "local-operator") {
        const failures = result.outcomes.filter(outcome => outcome.state === "failed").map(outcome => {
          const failure = database.authority.failures.get(outcome.failureId); assert.ok(failure);
          return { nodeId: failure.nodeId, taskId: failure.taskId, code: failure.code,
            causes: failure.causeChain.map(cause => cause.code),
            frames: [...(failure.debug?.stack ?? "").matchAll(/(?:src|tests)\/[A-Za-z0-9_./-]+\.ts:\d+:\d+/gu)]
              .map(match => match[0]).slice(0, 8) };
        });
        assert.deepEqual(failures, [], `OCR fixture execution failed: ${JSON.stringify(failures)}`);
        const lifecycle = result.run?.lifecycle;
        assert.ok(options.release === true ? lifecycle?.state === "parked-gate"
          : lifecycle?.state === "terminal" && lifecycle.outcome === "done",
        `OCR fixture stopped before review: ${JSON.stringify(result.outcomes.map(outcome => ({ state: outcome.state })))}`);
      }
      const command = (type: "correct-ocr-record" | "discard-ocr-record" | "restore-ocr-record", expectedRevision: number, recordIndex = 0) => {
        const review = database.authority.ocrReviews.latest(run.envelope.runId); assert.ok(review);
        const record = review.records[recordIndex]; assert.ok(record && corrected);
        return { commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
          family: "ocr-review" as const, type, target: { runId: run.envelope.runId, expectedRevision },
          payload: type === "correct-ocr-record" ? { recordId: record.recordId, fields: corrected, assertedEid: "10800000" } : { recordId: record.recordId } };
      };
      const approval = (selectedRecordIds?: readonly string[]) => {
        const review = database.authority.ocrReviews.latest(run.envelope.runId); assert.ok(review);
        const current = database.authority.runs.get(run.envelope.runId); assert.ok(current);
        const commandId = randomUUID();
        const snapshot = OcrApprovedSnapshotSchema.parse({ snapshotId: commandId, sourceRunId: current.envelope.runId,
          revision: review.revision, reviewDigest: ocrReviewDigest(review), selectedRecordIds: selectedRecordIds ?? review.records.map(record => record.recordId),
          records: selectedRecordIds === undefined ? review.records : selectedRecordIds.map(id => review.records.find(record => record.recordId === id)),
          approvedBy: "local-operator", approvedAt: clock.now().toISOString() });
        return { commandId, requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
          family: "gate", type: "resolve-gate", target: { runId: current.envelope.runId, gateId: "approve-records", expectedVersion: current.version },
          payload: { result: { schemaHash: deriveSchemaHash(OcrApprovalReferenceSchema, "output"), value: {
            snapshotId: commandId, sourceRunId: current.envelope.runId, revision: review.revision, digest: ocrSnapshotDigest(snapshot),
          } }, ocrApproval: { expectedRevision: review.revision, reviewDigest: ocrReviewDigest(review), selectedRecordIds: snapshot.selectedRecordIds } } };
      };
      return { harness, database, path, clock, admission, artifacts, artifactReader, sources, canonical, run, result, approval,
        reading, corrected, pageBytes, command, root, resolve, readResult: () => {
          const checkpoint = database.authority.runCheckpoints.listByAttempt(run.envelope.workflow, run.envelope.itemId,
            "read-result", run.envelope.attempt).at(-1); assert.ok(checkpoint);
          return OcrResultSchema.parse(checkpoint.output.value);
        } };
    },
  };
}
