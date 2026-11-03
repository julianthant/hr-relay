import { compileWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { emergencyContactWorkflow } from "../../../../src/workflows/emergency-contact/workflow.js";
import { emergencyContactMemberWorkflow } from "../../../../src/workflows/emergency-contact-member/workflow.js";
import { EmergencyContactInputSchema } from "../../../../src/models/workflows/emergency-contact/input.js";
import { createOcrApprovedSnapshotAdapter } from "../../../../src/backend/processing/providers/ocr-approved-snapshot-adapter.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { ocrModule, CHILD_ONLY_WORKFLOW_MODULES, SERVER_REGISTRY } from "../../../../src/backend/app/registries/workflow-registry.js";
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
import { submittedPage, READING_ID } from "../../fixtures/ocr/source-pages.js";
import { canonicalChildExecution } from "./canonical-child-execution.js";
import { createRunExecutorTestWorld } from "./run-executor-world.js";
import { boundProfileAdmission } from "../synthetic-database-admission.js";
import type { z } from "zod";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { unexpectedWorkbookSync } from "./workbook-sync.js";
import { retainedOcrModule, retainedOcrStore, retainedOcrCheckpointPublication } from "../../fixtures/ocr/retained-review-producer.js";
import { ocrWorkflowStore } from "../../../../src/workflows/ocr/task-registry.js";

export function createOcrReviewWorld() {
  const world = createRunExecutorTestWorld();
  return {
    cleanup: world.cleanup,
    async fixture(options: Readonly<{ actorId?: string; record?: boolean; release?: boolean; pageCount?: number; retainedProducer?: boolean; coordinator?: boolean }> = {}) {
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
      const ocrRoot = options.retainedProducer === true ? retainedOcrModule : ocrModule;
      const coordinator = options.coordinator === true ? compileWorkflow(emergencyContactWorkflow) : undefined;
      const member = options.coordinator === true ? compileWorkflow(emergencyContactMemberWorkflow) : undefined;
      const root = coordinator ?? ocrRoot;
      const entries: readonly RegisteredTaskStore[] = [...taskStoreRegistry.stores.filter(store => store.namespace !== "extraction" && store.namespace !== "workflow:ocr"),
        defineServiceStore("extraction", { render }), options.retainedProducer === true ? retainedOcrStore : ocrWorkflowStore];
      const tasks = entries.flatMap(store => Object.values(store.tasks));
      const stores = defineTaskStoreRegistry(entries, { scenarioIds: [...new Set(tasks.flatMap(task => task.contract.scenarios))],
        tasks: tasks.map(task => ({ id: task.contract.id, effect: task.contract.effect })) });
      const harness = await world.executorHarness({ descriptor: root.descriptor, stores });
      const { database, path, clock } = harness.authority;
      const workbooks = createWorkbookLibraryService({ repository: database.authority.workbooks, clock, sync: unexpectedWorkbookSync });
      const roster = workbooks.create({ name: "OCR roster", themes: [], hasFormulas: false, sheets: [{
        id: "people", name: "People", width: 2, hidden: [], headerRow: 1,
        columnBindings: ["eid", "fullName"].map((fieldId, index) => ({ id: fieldId, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: "manual" })),
        rows: [{ id: "header", cells: [{ value: "EID" }, { value: "Name" }] }],
      }] });
      database.authority.workbooks.putType({ id: "ocr-roster", name: "OCR roster", keyFieldId: "eid", fields: ["eid", "fullName"], defaultWorkbookId: null });
      workbooks.operatorOperation(roster.libraryId, "set-roster-type", { kind: "metadata", expectedVersion: 1, metadata: { typeId: "ocr-roster", sharePoint: null } });
      const admission = boundProfileAdmission(path);
      const artifacts = createContentAddressedArtifactWriter({ admission }); await artifacts.ready;
      const artifactReader = createServerVerifiedArtifactReader({ admission }); await artifactReader.ready;
      const resolve = (id: string) => id === "ocr" ? ocrRoot.descriptor : id === coordinator?.descriptor.id ? coordinator.descriptor : id === member?.descriptor.id ? member.descriptor
        : (CHILD_ONLY_WORKFLOW_MODULES.find(module => module.descriptor.id === id) ?? SERVER_REGISTRY[id])?.descriptor;
      const canonical = canonicalChildExecution({ ...harness.deps, artifacts }, database, path, resolve,
        options.retainedProducer === true ? retainedOcrCheckpointPublication : createOcrCheckpointPublication,
        coordinator === undefined ? undefined : (run, reader) => ({ configSnapshots: database.authority.configSnapshots,
          idFactory: { next: () => randomUUID() }, adapters: { "ocr.approved-snapshot": createOcrApprovedSnapshotAdapter({
            database, run, reader, clock, resolveDescriptor: resolve, assertCurrent: () => admission.assertProfileRuntime(),
          }) } }));
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
      const request = OcrInputSchema.parse({ document: upload.artifact, readingId: READING_ID,
        formType: "emergency-contact", roster: null, approval: options.release === true ? "release" : "review-only",
        reading: { kind: "manual", actorId, assertions: readings.map(({ reading }) => ({ sourcePage: reading.input.sourcePage, extraction: reading.extraction })) } });
      const parentRun = canonical.start(root.descriptor, coordinator === undefined ? request : EmergencyContactInputSchema.parse({ document: request.document, readingId: request.readingId, roster: request.roster, reading: request.reading }), { dryRun: false,
          ...(options.retainedProducer === true ? {} : { workbooks, workbookReferences: [{ entry: 1, typeId: "ocr-roster", libraryId: roster.libraryId }] }) });
      const result = await canonical.execute(parentRun, new AbortController().signal);
      const run = coordinator === undefined ? parentRun : database.authority.runs.listChildren(parentRun.envelope.runId).find(child => child.envelope.workflow === "ocr");
      assert.ok(run);
      if (actorId === "local-operator") {
        const failures = result.outcomes.filter(outcome => outcome.state === "failed").map(outcome => {
          const failure = database.authority.failures.get(outcome.failureId); assert.ok(failure);
          return { nodeId: failure.nodeId, taskId: failure.taskId, code: failure.code,
            causes: failure.causeChain.map(cause => cause.code),
            frames: [...(failure.debug?.stack ?? "").matchAll(/(?:src|tests)\/[A-Za-z0-9_./-]+\.ts:\d+:\d+/gu)]
              .map(match => match[0]).slice(0, 8) };
        });
        assert.deepEqual(failures, [], `OCR fixture execution failed: ${JSON.stringify(failures)}`);
        const lifecycle = coordinator === undefined ? result.run?.lifecycle : database.authority.runs.get(run.envelope.runId)?.lifecycle;
        assert.ok((options.release === true || coordinator !== undefined) ? lifecycle?.state === "parked-gate"
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
      return { harness, database, path, clock, admission, artifacts, artifactReader, sources, canonical, run, parentRun, result, approval,
        reading, corrected, pageBytes, command, root, resolve, readResult: () => {
          const checkpoint = database.authority.runCheckpoints.listByAttempt(run.envelope.workflow, run.envelope.itemId,
            "read-result", run.envelope.attempt).at(-1); assert.ok(checkpoint);
          return OcrResultSchema.parse(checkpoint.output.value);
        } };
    },
  };
}
