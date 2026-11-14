import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { z } from "zod";
import { createTaskProvenanceCollector, jsonLeafPaths } from "../../../../src/backend/runs/provenance/task-provenance.js";
import { redactObservedDataPoints } from "../../../../src/backend/logs/observed-data.js";
import { ExecutorSpanEventSchema, runSpanPath, taskSpanPath } from "../../../../src/backend/logs/span-emitter.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { observationLeafPaths, resolveObservationOrigin } from "../../../../src/models/events/data-observation-origin.js";
import { TimelineAppendSchema } from "../../../../src/models/events/timeline.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { defineTaskContract } from "../../../../src/models/task/task-contract.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { ocrForm } from "../../../../src/models/ocr/form-registry.js";
import { admitOcrExtraction } from "../../../../src/models/ocr/extraction.js";
import { ReadOcrReviewSeed } from "../../../../src/models/workflows/ocr/read-review-seed.js";
import { PersonLookupResultSchema } from "../../../../src/models/workflows/person-lookup/result.js";
import { ReadOcrResult } from "../../../../src/models/workflows/ocr/read-result.js";
import { buildOcrReviewSeed, compactOcrReviewSeed, OcrRosterEvidenceSchema } from "../../../../src/models/workflows/ocr/review-seed.js";
import { ocrPersonLookupRequests, ocrLookupItemId } from "../../../../src/models/workflows/ocr/lookup.js";
import { bindOcrPageReading, accountOcrPages, ocrExtractionItemId, OcrPageOutcomeSchema } from "../../../../src/models/workflows/ocr/page-accounting.js";
import { readOcrReviewSeedTask } from "../../../../src/workflows/ocr/tasks/read-review-seed.js";
import { readOcrResultTask } from "../../../../src/workflows/ocr/tasks/read-result.js";
import { taskId, TraceIdSchema } from "../../../../src/rules/identity/ids.js";
import { canonicalJsonStringify, JsonValueSchema } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { RecordedDataPointSchema, type RecordedDataPoint } from "../../../../src/rules/workflow/task-provenance.js";
import { defineWorkflow, compileWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { debugTimelineFixture } from "../../helpers/backend/debug-timeline-fixture.js";
import { ocrTaskContext } from "./task-context.js";
import { sourceFixture, READING_ID, SOURCE_RUN_ID, READ_AT } from "./source-pages.js";

const LIMIT = 262_144;
const captureSchema = z.strictObject({ review: ReadOcrReviewSeed.input, result: ReadOcrResult.input });
const employee = (index: number) => ({ name: `Example${String.fromCharCode(65 + Math.floor(index / 26), 65 + index % 26)}, Avery`, eid: String(10800000 + index) });

function filledPages(pageCount: number) {
  const source = sourceFixture(pageCount);
  const outcomes = source.inputs.map((input, index) => {
    const person = employee(index);
    const values: Readonly<Record<string, string>> = {
      "employee.employeeId": person.eid, "employee.name": person.name, "employee.dateCompleted": "11/03/2026",
      "employee.address1": "123 Example Avenue, Apartment 45", "employee.cellPhone": "530-555-0102", "employee.homePhone": "530-555-0101",
      "employee.city": "Davis", "employee.state": "CA", "employee.postalCode": "95616",
      "contact.name": "Example, Robin", "contact.relationship": "Spouse", "contact.cellPhone": "530-555-0103",
      "contact.homePhone": "530-555-0104", "contact.workPhone": "530-555-0105", "contact.address1": "456 Example Avenue",
      "contact.city": "Davis", "contact.state": "CA", "contact.postalCode": "95616",
    };
    const admitted = admitOcrExtraction({ formType: "emergency-contact", pageKind: "emergency-contact", sourcePage: input.sourcePage,
      sourceSha256: input.image.sha256, readAt: READ_AT, source: { kind: "provider", providerId: "chatgpt-subscription", modelId: "synthetic-test-model" },
      record: { answers: Object.fromEntries(ocrForm("emergency-contact").fields.map(field => {
        const raw = values[field.path];
        assert.ok(raw !== undefined, `Missing filled synthetic field ${field.path}`);
        return [field.path, { state: "read", raw, confidence: 0.93 }];
      })) } });
    if (!admitted.admitted) throw new Error(admitted.problems.join("; "));
    return OcrPageOutcomeSchema.parse({ state: "done", runId: `00000000-0000-4000-8000-${String(index + 300).padStart(12, "0")}`,
      itemId: ocrExtractionItemId(input), output: bindOcrPageReading(input, admitted.extraction) });
  });
  return { ...source, outcomes };
}

function sizingDescriptor(capture: z.output<typeof captureSchema>) {
  const contract = defineTaskContract({ id: taskId("ocr/read-size-capture"), title: "Capture synthetic OCR sizing inputs", effect: "read",
    input: captureSchema, output: captureSchema, subject: { kind: "none", reason: "Deterministic synthetic byte measurement" }, errorCodes: ["INCONSISTENT_INPUTS"],
    scenarios: ["ocr/observed-size"], freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "live" }, example: capture });
  return compileWorkflow(defineWorkflow({ id: "ocr", version: 1, code: "oc", label: "OCR size fixture", icon: "FileScan", category: "documents",
    input: captureSchema, canonicalInput: defineCanonicalInput(captureSchema, captureSchema, [capture]), inputSubject: "document",
    surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [], scenarios: ["ocr/observed-size"],
    identity: { matchKey: input => input.review.readingId }, presentation: { title: () => "Synthetic OCR size fixture" },
    role: defineWorkflowRole({ kind: "standalone" }), steps: ({ task, result }) => {
      const source = task({ id: "capture", contract, replay: "checkpoint" }, [], ({ input }) => input);
      const review = task({ id: "build-review", contract: ReadOcrReviewSeed, replay: "checkpoint" }, [source], ({ outputs }) => outputs.capture.review);
      const completed = task({ id: "read-result", contract: ReadOcrResult, replay: "checkpoint" }, [source], ({ outputs }) => outputs.capture.result);
      return { steps: [[{ key: "capture", label: "Capture" }, [source]], [{ key: "review", label: "Review" }, [review, completed]]],
        result: result(ReadOcrResult.output, [completed], ({ outputs }) => outputs["read-result"]) };
    } })).descriptor;
}

function eventBytes(nodeId: string, descriptor: AnyWorkflowDescriptor, points: readonly RecordedDataPoint[], materializeDefaults: boolean) {
  const timeline = debugTimelineFixture(), bytes: number[] = [];
  const traceId = TraceIdSchema.parse("oc-101532-1111");
  const node = descriptorRuntimeNodes(descriptor).find(node => node.id === nodeId); assert.ok(node?.kind === "task");
  const spanPath = taskSpanPath(traceId, node.id, 1, 1);
  const identity = { runId: SOURCE_RUN_ID, attempt: 1, spanPath, nodeId, taskId: node.uses.id };
  const recorded = materializeDefaults ? points.map(point => RecordedDataPointSchema.parse({ ...point,
    origins: observationLeafPaths(point.value).map(path => ({ path: [...path], origin: resolveObservationOrigin(identity, point, path) })) })) : points;
  createTimelineEmitter({ clock: manualClock(new Date(READ_AT)), pid: 48213, uuid: () => "00000000-0000-4000-8000-000000009999",
    repository: { ...timeline.repository, append(input) {
      const content = TimelineAppendSchema.parse(input);
      bytes.push(Buffer.byteLength(canonicalJsonStringify(content), "utf8"));
      return timeline.repository.append(content);
    } } }).emit(ExecutorSpanEventSchema.parse({ t: "data.observed", ts: READ_AT, workflow: descriptor.id, ...identity,
    traceId, parentSpanPath: runSpanPath(traceId), observedAt: READ_AT, points: redactObservedDataPoints(node.uses.id, recorded) }));
  assert.equal(bytes.length, 1);
  assert.equal(timeline.records.length, 1);
  const record = timeline.records[0];
  assert.ok(record?.payload.kind === "span" && record.payload.event.t === "data.observed");
  assert.deepEqual(timeline.repository.get(record.eventId), record);
  return bytes[0];
}

function observation(nodeId: string, descriptor: AnyWorkflowDescriptor, checkpoint: z.output<typeof RunCheckpointRecordSchema>) {
  const node = descriptorRuntimeNodes(descriptor).find(node => node.id === nodeId); assert.ok(node?.kind === "task");
  const batches: (readonly RecordedDataPoint[])[] = [], traceId = TraceIdSchema.parse("oc-101532-1111");
  const collector = createTaskProvenanceCollector({ descriptor, execution: { runId: SOURCE_RUN_ID, attempt: 1, traceId,
    workflowId: descriptor.id, nodeId, taskId: node.uses.id }, observationSpanPath: taskSpanPath(traceId, node.id, 1, 1),
    upstreamEvidence: { checkpoints: [checkpoint] }, clock: manualClock(new Date(READ_AT)), onRecord: batch => batches.push(batch.points) });
  return { ctx: { ...ocrTaskContext().ctx, recordData: collector.recordData }, finish(output: unknown) {
    const finalized = collector.finalizeRead(output);
    assert.equal(batches.length, 1, `${nodeId} must emit one complete task batch`);
    assert.deepEqual(batches[0], finalized.points);
    assert.ok(finalized.provenance.length > 0);
    assert.ok(finalized.points.every(point => point.origins === undefined), "D must compact default origins in the real collector");
    const bytes = eventBytes(nodeId, descriptor, finalized.points, false);
    const fullOriginBytes = eventBytes(nodeId, descriptor, finalized.points, true);
    assert.ok(bytes <= LIMIT, `${nodeId}: ${String(bytes)} bytes exceeds ${String(LIMIT)}`);
    assert.ok(fullOriginBytes > LIMIT, `${nodeId} negative control must exceed the timeline bound`);
    return { bytes, eventCount: batches.length, fullOriginBytes };
  } };
}

export async function measureOcrObservedSizes(pageCount: number, rosterRowCount: number) {
  const { manifest, outcomes } = filledPages(pageCount);
  const rows = Array.from({ length: rosterRowCount }, (_, index) => ({ sourceRow: index + 1, sheetId: "people", rowId: `row-${String(index + 1)}`, ...employee(index) }));
  const roster = rosterRowCount === 0 ? null : OcrRosterEvidenceSchema.parse({ workbookType: "ocr-roster", workbookId: "synthetic-roster",
    workbookVersion: 1, referenceDigest: sha256Hex(canonicalJsonStringify(rows)), readAt: READ_AT, rows });
  assert.equal(roster?.rows.length ?? 0, rosterRowCount);
  const reviewInput = ReadOcrReviewSeed.input.parse({ sourceRunId: SOURCE_RUN_ID, roster, formType: "emergency-contact", manifest, readingId: READING_ID, outcomes });
  const seed = buildOcrReviewSeed({ sourceRunId: SOURCE_RUN_ID, roster, accounting: accountOcrPages(manifest, READING_ID, outcomes) });
  const requests = ocrPersonLookupRequests(seed);
  assert.equal(outcomes.length, pageCount); assert.equal(seed.records.length, pageCount); assert.equal(requests.length, pageCount);
  assert.equal(new Set(seed.records.map(record => record.assertedEid)).size, pageCount);
  assert.ok(outcomes.every(outcome => outcome.state === "done" && outcome.output.extraction.record?.answers.every(answer => answer.state === "read")));
  const lookups = requests.map((request, index) => {
    const person = employee(index);
    return { state: "done", itemId: ocrLookupItemId(request.input), runId: `00000000-0000-4000-8000-${String(index + 1000).padStart(12, "0")}`,
      output: { crmDates: { state: "not-requested" }, activeStatus: { ucpathSelection: "resolved", datesEid: person.eid, state: "active",
        reason: "Active in UCPath with a current HDH job.", code: null, hdh: true, candidateEids: [person.eid],
        details: { search: person.eid, name: person.name, eid: person.eid, department: "HDH Dining Services - Example Unit", hrStatus: "Active",
          ucpath: "Found", crm: "Found", startDate: "2025-09-15", endDate: null, terminationReason: null,
          foundInUcpath: true, matchedEid: person.eid, matchedName: person.name } } } };
  });
  const capture = captureSchema.parse({ review: reviewInput, result: { review: seed, outcomes: lookups } });
  const descriptor = sizingDescriptor(capture), value = JsonValueSchema.parse(capture);
  const checkpoint = RunCheckpointRecordSchema.parse({ runId: SOURCE_RUN_ID, workflowId: descriptor.id, itemId: READING_ID, nodeId: "capture",
    attempt: 1, claimGeneration: 1, descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint,
    implFingerprint: sha256Hex("synthetic captured input"), output: { schemaHash: deriveSchemaHash(captureSchema, "output"), value },
    provenance: jsonLeafPaths(value).map(path => ({ path, source: "live", observedAt: READ_AT, originalObservedAt: READ_AT })), writtenAt: READ_AT });
  const reviewing = observation("build-review", descriptor, checkpoint);
  const review = ReadOcrReviewSeed.output.parse(await readOcrReviewSeedTask.impl.run({ input: capture.review, ctx: reviewing.ctx }));
  assert.deepEqual(review, compactOcrReviewSeed(seed));
  assert.equal(review.records.length, pageCount);
  assert.ok(review.records.every(record => !("fields" in record)));
  assert.ok(review.accounting.outcomes.every(outcome => !("output" in outcome)));
  assert.ok(review.roster === null || !("rows" in review.roster));
  const buildReview = reviewing.finish(review);
  const completing = observation("read-result", descriptor, checkpoint);
  const result = ReadOcrResult.output.parse(await readOcrResultTask.impl.run({ input: capture.result, ctx: completing.ctx }));
  assert.deepEqual(Object.keys(result.review), ["digest"]);
  assert.equal(result.identities.length, pageCount);
  for (const identity of result.identities) {
    assert.ok(identity.outcome.state === "done");
    const found = PersonLookupResultSchema.parse(identity.outcome.output);
    assert.equal(found.activeStatus.ucpathSelection, "resolved");
    assert.equal(found.activeStatus.state, "active");
  }
  assert.deepEqual(result.identities.flatMap(identity => identity.recordIds), review.records.map(record => record.recordId));
  const readResult = completing.finish(result);
  return { pageCount, recordCount: review.records.length, successfulLookupCount: result.identities.length, rosterRowCount, buildReview, readResult };
}
