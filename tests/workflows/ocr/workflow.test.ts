import { ocrModule, ocrPageModule, ocrPageReadingModule, ocrSourcePagesModule } from "../../support/helpers/registered-workflows.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { auditWorkflowModuleRoles } from "../../../src/workflow-kit/validation/workflow-module-audit.js";
import { compileWorkflow, workflowExplorerDeclaration } from "../../../src/workflow-kit/workflow-definition.js";
import { descriptorRuntimeNodes, workflowPlanning, workflowTerminalResultExecution } from "../../../src/workflow-kit/workflow.js";
import { DESCRIPTORS, workflowModuleOf, childWorkflowModuleOf } from "../../../src/backend/app/registries/workflow-registry.js";
import { ocrWorkflow } from "../../../src/workflows/ocr/workflow.js";
import { OcrPageWorkflowInputSchema } from "../../../src/models/workflows/ocr-page/input.js";
import { ReadActiveStatus } from "../../../src/models/workflows/person-lookup/read-active-status.js";
import { OcrResultSchema, OcrWorkflowResultSchema, compactOcrResult } from "../../../src/models/workflows/ocr/result.js";
import { ReadOcrResult } from "../../../src/models/workflows/ocr/read-result.js";
import { readOcrResultTask } from "../../../src/workflows/ocr/tasks/read-result.js";
import { OcrInputSchema, OCR_INPUT_EXAMPLE } from "../../../src/models/workflows/ocr/input.js";
import { ReadOcrSourcePages } from "../../../src/models/workflows/ocr/read-source-pages.js";
import { ReadOcrReviewSeed } from "../../../src/models/workflows/ocr/read-review-seed.js";
import { readOcrSourcePagesTask } from "../../../src/workflows/ocr/tasks/read-source-pages.js";
import { readOcrReviewSeedTask } from "../../../src/workflows/ocr/tasks/read-review-seed.js";
import { ocrLookupRequests, ocrLookupItemId, ocrPersonLookupRequests, ocrSignerLookupRequests } from "../../../src/models/workflows/ocr/lookup.js";
import { OcrPageOutcomeSchema, bindManualOcrPageReading, accountOcrPages } from "../../../src/models/workflows/ocr/page-accounting.js";
import { buildOcrReviewSeed, compactOcrReviewSeed } from "../../../src/models/workflows/ocr/review-seed.js";
import { OCR_FORMS } from "../../../src/models/ocr/form-registry.js";
import { I9ReadSection2Signer } from "../../../src/models/systems/i9/read-section2-signer.js";
import { ItemIdSchema, TraceIdSchema } from "../../../src/rules/identity/ids.js";
import { sourceFixture, donePage, submittedPage, READING_ID, SOURCE_RUN_ID } from "../../support/fixtures/ocr/source-pages.js";
import { readOcrPageFixture } from "../../support/fixtures/ocr/read-page.js";
import { ocrTaskContext } from "../../support/fixtures/ocr/task-context.js";
import { Buffer } from "node:buffer";
import { DataPointSchema, RecordedDataPointSchema } from "../../../src/rules/workflow/task-provenance.js";
import { observationLeafPaths } from "../../../src/models/events/data-observation-origin.js";
import { redactObservedDataPoints } from "../../../src/backend/logs/observed-data.js";
import { ExecutorSpanEventSchema, runSpanPath, taskSpanPath } from "../../../src/backend/logs/span-emitter.js";
import { createTimelineEmitter } from "../../../src/backend/storage/events/timeline-emitter.js";
import { TimelineAppendSchema } from "../../../src/models/events/timeline.js";
import { PDF_PAGE_LIMIT } from "../../../src/models/processing/extraction/extract-pdf-pages.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../src/rules/validation/sha256.js";
import { manualClock } from "../../../src/rules/time/clock.js";

const descriptor = compileWorkflow(ocrWorkflow).descriptor;
const nodes = descriptorRuntimeNodes(descriptor);
const prepareCandidate = nodes.find(node => node.id === "read-source-pages");
const childrenCandidate = nodes.find(node => node.id === "read-pages");
const reviewCandidate = nodes.find(node => node.id === "build-review");
const resultCandidate = nodes.find(node => node.id === "read-result");
const lookupCandidate = nodes.find(node => node.id === "lookup-identities");
assert.ok(prepareCandidate?.kind === "task" && childrenCandidate?.kind === "child-run" && childrenCandidate.cardinality === "many"
  && reviewCandidate?.kind === "task" && lookupCandidate?.kind === "child-run" && lookupCandidate.cardinality === "many" && resultCandidate?.kind === "task");
const prepare = prepareCandidate, children = childrenCandidate, reviewNode = reviewCandidate, lookup = lookupCandidate, completed = resultCandidate;

function requestFixture(pageCount = 3) {
  const source = sourceFixture(pageCount);
  const request = OcrInputSchema.parse({ sourceRunId: SOURCE_RUN_ID, document: source.manifest.document,
    formType: "emergency-contact", readingId: READING_ID, roster: null, reading: { kind: "subscription" } });
  return { ...source, request, rendered: { pageCount, pages: source.manifest.pages } };
}

async function reviewFixture(pageCount = 3) {
  const fixture = requestFixture(pageCount);
  const { request, rendered, inputs } = fixture;
  const source = ReadOcrSourcePages.output.parse(await readOcrSourcePagesTask.impl.run({ input: ReadOcrSourcePages.input.parse(prepare.bind({ input: request, outputs: { "render-pages": rendered } })), ctx: ocrTaskContext().ctx }));
  const bound = OcrPageWorkflowInputSchema.array().parse(children.bind({ input: request, outputs: { "render-pages": rendered, "read-source-pages": source } }));
  assert.equal(bound.length, pageCount);
  const outcomes = [];
  for (const [index, child] of bound.entries()) {
    const { reading } = await readOcrPageFixture(child);
    outcomes.push(OcrPageOutcomeSchema.parse({ ...donePage(inputs[index]), output: reading }));
  }
  const recorded = ocrTaskContext();
  const review = ReadOcrReviewSeed.output.parse(await readOcrReviewSeedTask.impl.run({ input: ReadOcrReviewSeed.input.parse(reviewNode.bind({ input: request,
    outputs: { "render-pages": rendered, "read-source-pages": source, "read-pages": outcomes } })), ctx: recorded.ctx }));
  const seed = buildOcrReviewSeed({ sourceRunId: SOURCE_RUN_ID, roster: null, accounting: accountOcrPages(fixture.manifest, READING_ID, outcomes) });
  return { ...fixture, source, review, seed, outcomes, recorded: recorded.recorded };
}

/** Bytes of the data.observed timeline record for one recorded batch, with one origin per scalar leaf as task provenance assigns them. */
function observedEventBytes(nodeId: string, points: readonly unknown[]) {
  const node = nodes.find(entry => entry.id === nodeId);
  assert.ok(node?.kind === "task");
  const traceId = TraceIdSchema.parse("oc-000000-1111"), spanPath = taskSpanPath(traceId, node.id, 1, 1), recordedAt = "2026-11-08T00:00:00.000Z";
  const execution = { runId: "11111111-2222-4333-8444-555555555555", traceId, attempt: 1, workflowId: descriptor.id, nodeId: node.id, taskId: node.uses.id };
  const recorded = DataPointSchema.array().parse(points).map(point => RecordedDataPointSchema.parse({ ...point, execution, recordedAt,
    origins: observationLeafPaths(point.value).map(path => ({ path: [...path], origin: { runId: execution.runId, attempt: 1, spanPath,
      nodeId: node.id, taskId: node.uses.id, field: point.field, path: [...path] } })) }));
  let bytes = 0;
  createTimelineEmitter({ clock: manualClock(new Date(recordedAt)), pid: 1, repository: { append: (input: unknown) => {
    const record = TimelineAppendSchema.parse(input);
    bytes = Buffer.byteLength(canonicalJsonStringify(record), "utf8");
    return { state: "inserted", record };
  } } as never }).emit(ExecutorSpanEventSchema.parse({ t: "data.observed", ts: recordedAt, workflow: descriptor.id, runId: execution.runId,
    attempt: 1, traceId, spanPath, parentSpanPath: runSpanPath(traceId), nodeId: node.id, taskId: node.uses.id, observedAt: recordedAt,
    points: redactObservedDataPoints(node.uses.id, recorded) }));
  return bytes;
}

async function finishFixture(scope: Parameters<typeof completed.bind>[0], recorded = ocrTaskContext()) {
  return ReadOcrResult.output.parse(await readOcrResultTask.impl.run({
    input: ReadOcrResult.input.parse(completed.bind(scope)), ctx: recorded.ctx }));
}

describe("child-only OCR document graph", () => {
  it.each(["emergency-contact", "oath", "i9"] as const)("emits only the %s form's declared lookup and retains its typed outcome", formType => {
    const source = sourceFixture(2, formType);
    const pages = source.inputs.map(input => donePage(input));
    const review = buildOcrReviewSeed({ roster: null, accounting: accountOcrPages(source.manifest, READING_ID, pages, formType) });
    const outputs = { "build-review": compactOcrReviewSeed(review), "read-pages": pages };
    const person = ocrPersonLookupRequests(review), signer = ocrSignerLookupRequests(review);
    assert.equal(OCR_FORMS[formType].lookup, formType === "i9" ? "i9-lookup" : "person-lookup");
    assert.equal(person.length, formType === "i9" ? 0 : 1);
    assert.equal(signer.length, formType === "i9" ? 1 : 0);
    const signerNode = nodes.find(node => node.id === "lookup-signers");
    assert.ok(signerNode?.kind === "child-run");
    assert.deepEqual(signerNode.dependsOn, ["build-review", "read-pages"]);
    assert.deepEqual(lookup.dependsOn, ["build-review", "read-pages"]);
    const input = OcrInputSchema.parse({ ...requestFixture().request, formType });
    assert.deepEqual(lookup.bind({ input, outputs }), person.map(request => request.input));
    assert.deepEqual(lookup.sourceRecordIds?.({ input, outputs }), person.map(request => request.recordIds));
    assert.deepEqual(signerNode.sourceRecordIds?.({ input, outputs }), signer.map(request => request.recordIds));
    assert.deepEqual(signerNode.bind({ input, outputs }), signer.map(request => request.input));
    assert.throws(() => signerNode.bind({ input, outputs: { ...outputs, "read-pages": pages.slice(1) } }), /page reading that is not retained/u);
    assert.equal(signerNode.policy.visibility, "inline");
    assert.equal(nodes.some(node => node.kind === "parallel"), false);
    if (formType !== "i9") return;
    const request = signer[0]; assert.ok(request);
    assert.deepEqual(request.recordIds, review.records.map(record => record.recordId));
    const outcome = { state: "done", itemId: ocrLookupItemId(request.input),
      runId: "00000000-0000-4000-8000-000000000801", output: I9ReadSection2Signer.example };
    const result = OcrResultSchema.parse({ review, identities: [{ ...request, outcome }] });
    assert.deepEqual(result.identities[0]?.outcome, outcome);
    assert.equal(OcrResultSchema.safeParse({ review, identities: [{ ...request, outcome: { ...outcome,
      output: { activeStatus: ReadActiveStatus.example, crmDates: { state: "not-requested" } } } }] }).success, false);
  });

  it("compiles complete exact stores and generated timelines without public registration", () => {
    const modules = [ocrModule, ocrPageModule, ocrSourcePagesModule, ocrPageReadingModule];
    assert.deepEqual(modules.map(module => String(module.descriptor.id)), ["ocr", "ocr-page", "ocr-source-pages", "ocr-page-reading"]);
    assert.deepEqual(auditWorkflowModuleRoles(modules), []);
    assert.equal(children.join, "all-settled");
    assert.equal(children.policy.cascadeCancel, "cascade");
    assert.equal(lookup.join, "all-settled");
    assert.deepEqual(workflowTerminalResultExecution(descriptor).dependsOn, ["read-result", "approve-records", "build-review"]);
    assert.deepEqual(completed.dependsOn, ["build-review", "read-pages", "lookup-identities", "lookup-signers"]);
    assert.deepEqual(descriptor.timeline.map(step => step.key), ["source-pages", "page-readings", "review-records", "identity-lookups", "signer-lookups", "approval"]);
    assert.equal(children.policy.visibility, "hidden-unless-failed");
    assert.equal(lookup.policy.visibility, "inline");
    assert.equal(reviewNode.replay, "always-rerun");
    assert.equal(completed.replay, "always-rerun");
    assert.equal(children.policy.afterChildRetry, "resume-parent");
    assert.equal(lookup.policy.afterChildRetry, "resume-parent");
    assert.ok(workflowExplorerDeclaration(ocrWorkflow));
    for (const id of ["ocr", "ocr-page"]) {
      assert.throws(() => workflowModuleOf(id));
      assert.equal(DESCRIPTORS.some(descriptor => descriptor.id === id), false);
      assert.throws(() => childWorkflowModuleOf("person-lookup", id));
    }
    assert.equal(nodes.some(node => node.kind === "transaction"), false);
    assert.deepEqual(nodes.filter(node => node.kind === "gate").map(node => ({ id: node.id, resolvedBy: node.resolvedBy })),
      [{ id: "approve-records", resolvedBy: "operator" }]);
    const approval = nodes.find(node => node.id === "approve-records");
    assert.ok(approval?.kind === "gate" && approval.resolvedBy === "operator");
    assert.deepEqual(approval.when, { kind: "equals", of: { from: "input", path: "approval" }, value: "release" });
  });

  it("retains three duplicate records while looking up their common identity once", async () => {
    const { request, review, seed, outcomes } = await reviewFixture();
    assert.equal(review.records.length, 3);
    assert.equal(review.records.every(record => record.issues.includes("duplicate-subject")), true);
    const requests = ocrLookupRequests(seed);
    const bound = lookup.bind({ input: request, outputs: { "build-review": review, "read-pages": outcomes } });
    assert.deepEqual(bound, requests.map(request => request.input));
    assert.equal(bound.length, 1);
    const input = requests[0].input;
    const itemId = ItemIdSchema.parse(ocrLookupItemId(input));
    assert.equal(lookup.deriveChildItemId(input, { canonicalItemId: itemId }), itemId);
    const outcome = { state: "failed", itemId, runId: "00000000-0000-4000-8000-000000000801", failureId: "00000000-0000-4000-8000-000000000777" };
    const scope = { input: request, outputs: { "build-review": review, "read-pages": outcomes, "lookup-identities": [outcome], "lookup-signers": [] } };
    const recorded = ocrTaskContext();
    const result = await finishFixture(scope, recorded);
    assert.deepEqual(result, compactOcrResult(OcrResultSchema.parse({ review: seed, identities: result.identities })));
    assert.deepEqual(result.review, { digest: sha256Hex(canonicalJsonStringify(review)) });
    assert.deepEqual(recorded.recorded, Object.entries(result).map(([field, value]) => ({ direction: "read", field, value })));
    const derive = (readResult: unknown) => workflowTerminalResultExecution(descriptor).derive({ input: request,
      outputs: { "read-result": readResult, "build-review": review } });
    assert.deepEqual(OcrWorkflowResultSchema.parse(derive(result)), { review, identities: result.identities, approvedSnapshot: null });
    assert.throws(() => derive({ ...result, review: { digest: "f".repeat(64) } }), /does not match its review checkpoint/u);
    assert.deepEqual(result.identities[0].recordIds, review.records.map(record => record.recordId));
    assert.deepEqual(result.identities[0].outcome, outcome);
    const successful = await finishFixture({ ...scope,
      outputs: { ...scope.outputs, "lookup-identities": [{ state: "done", itemId, runId: outcome.runId,
        output: { activeStatus: ReadActiveStatus.example, crmDates: { state: "not-requested" } } }] } });
    assert.equal(successful.identities[0].outcome.state, "done");
    assert.deepEqual(successful.review, result.review);
    assert.equal(seed.records.every(record => record.issues.includes("identity-unverified")), true);
    await assert.rejects(finishFixture({ ...scope, outputs: { ...scope.outputs, "lookup-identities": [] } }), /do not match/);
    await assert.rejects(finishFixture({ ...scope, outputs: { ...scope.outputs,
      "lookup-identities": [{ ...outcome, itemId: READING_ID }] } }), /do not match/);
  });

  it("records only the manifest head and binds page work from the rendered pages", async () => {
    const { request, rendered, inputs, manifest } = requestFixture(3);
    const recorded = ocrTaskContext();
    const source = await readOcrSourcePagesTask.impl.run({ input: { request, rendered }, ctx: recorded.ctx });
    const head = { document: manifest.document, pageCount: 3, fingerprint: manifest.fingerprint };
    assert.deepEqual(source, { manifest: head });
    assert.deepEqual(recorded.recorded, [{ direction: "read", field: "manifest", value: head }]);
    assert.deepEqual(children.dependsOn, ["render-pages", "read-source-pages"]);
    assert.deepEqual(children.bind({ input: request, outputs: { "render-pages": rendered, "read-source-pages": source } }),
      inputs.map(page => ({ page, reading: { kind: "subscription" } })));
    assert.throws(() => children.bind({ input: request, outputs: { "render-pages": rendered,
      "read-source-pages": { manifest: { ...head, fingerprint: "f".repeat(64) } } } }), /changed after they were bound/u);
    const reviewed = await reviewFixture(3);
    assert.deepEqual(reviewed.review.accounting.manifest, reviewed.manifest);
    assert.deepEqual(reviewed.review, compactOcrReviewSeed(reviewed.seed));
    assert.deepEqual(reviewed.recorded, Object.entries(reviewed.review).map(([field, value]) => ({ direction: "read", field, value })));
    assert.equal(reviewed.review.records.some(record => "fields" in record), false);
    assert.equal(reviewed.review.accounting.outcomes.some(outcome => "output" in outcome), false);
  });

  it("keeps the rendered pages and the source binding inside one timeline event up to the page limit", async () => {
    for (const pageCount of [62, PDF_PAGE_LIMIT]) {
      const { request, rendered } = requestFixture(pageCount);
      const renderBytes = observedEventBytes("render-pages", [
        { direction: "read", field: "pageCount", value: rendered.pageCount }, { direction: "read", field: "pages", value: rendered.pages }]);
      const source = ocrTaskContext();
      await readOcrSourcePagesTask.impl.run({ input: { request, rendered }, ctx: source.ctx });
      const sourceBytes = observedEventBytes("read-source-pages", source.recorded);
      assert.ok(renderBytes < 256 * 1024, `${String(pageCount)} rendered pages: ${String(renderBytes)} bytes`);
      assert.ok(sourceBytes < 8 * 1024, `${String(pageCount)} pages bound: ${String(sourceBytes)} bytes`);
    }
  });

  it("requires complete manual page assertions and refuses partial render windows or outcomes", async () => {
    const { request, rendered, inputs, manifest } = requestFixture(2);
    const assertions = inputs.map(input => ({ sourcePage: input.sourcePage, extraction: bindManualOcrPageReading(input, "local-operator", { ...submittedPage(input),
      source: { kind: "operator", actorId: "local-operator" } }).extraction }));
    const manual = OcrInputSchema.parse({ ...request, reading: { kind: "manual", actorId: "local-operator", assertions } });
    const output = await readOcrSourcePagesTask.impl.run({ input: { request: manual, rendered }, ctx: ocrTaskContext().ctx });
    const bound = OcrPageWorkflowInputSchema.array().parse(children.bind({ input: manual, outputs: { "render-pages": rendered, "read-source-pages": output } }));
    assert.equal(bound.every(page => page.reading.kind === "manual"), true);
    for (const subset of [[assertions[0]], [assertions[0], assertions[0]], [assertions[0], { ...assertions[1], sourcePage: 3 }]]) {
      const refused = ocrTaskContext();
      await assert.rejects(readOcrSourcePagesTask.impl.run({ input: ReadOcrSourcePages.input.parse({ request: { ...manual,
        reading: { ...manual.reading, assertions: subset } }, rendered }), ctx: refused.ctx }), /do not match/);
      assert.deepEqual(refused.recorded, []);
    }
    await assert.rejects(readOcrSourcePagesTask.impl.run({ input: { request, rendered: { pageCount: 2, pages: [rendered.pages[0]] } }, ctx: ocrTaskContext().ctx }), /do not match/);
    await assert.rejects(readOcrReviewSeedTask.impl.run({ input: ReadOcrReviewSeed.input.parse({ sourceRunId: SOURCE_RUN_ID,
      roster: null, manifest, readingId: READING_ID, formType: "emergency-contact", outcomes: [donePage(inputs[0])] }), ctx: ocrTaskContext().ctx }), /do not account/);
  });

  it("retains all-failed page outcomes with an explicit empty lookup fanout", async () => {
    const { request, manifest, inputs } = await reviewFixture(1);
    const child = donePage(inputs[0]);
    const failed = OcrPageOutcomeSchema.parse({ runId: child.runId, itemId: child.itemId, state: "failed",
      failureId: "00000000-0000-4000-8000-000000000777" });
    const review = ReadOcrReviewSeed.output.parse(await readOcrReviewSeedTask.impl.run({ input: { sourceRunId: SOURCE_RUN_ID, roster: null,
      manifest, readingId: READING_ID, formType: "emergency-contact", outcomes: [failed] }, ctx: ocrTaskContext().ctx }));
    assert.deepEqual(review.pages, [{ sourcePage: 1, disposition: "failed" }]);
    assert.deepEqual(lookup.bind({ input: request, outputs: { "build-review": review, "read-pages": [failed] } }), []);
    const result = await finishFixture({ input: request, outputs: { "build-review": review, "read-pages": [failed], "lookup-identities": [], "lookup-signers": [] } });
    assert.deepEqual(result.identities, []);
  });
});

it("titles an OCR run by its PDF name, else its form type", () => {
  const { title } = workflowPlanning(descriptor);
  assert.equal(title({ ...OCR_INPUT_EXAMPLE, fileName: "Scan_0042.pdf" }), "Scan_0042.pdf");
  assert.equal(title(OCR_INPUT_EXAMPLE), OCR_INPUT_EXAMPLE.formType);
});
