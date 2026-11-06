import { ocrModule, ocrPageModule, ocrPageReadingModule, ocrSourcePagesModule } from "../../support/helpers/registered-workflows.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { auditWorkflowModuleRoles } from "../../../src/workflow-kit/validation/workflow-module-audit.js";
import { compileWorkflow, workflowExplorerDeclaration } from "../../../src/workflow-kit/workflow-definition.js";
import { descriptorRuntimeNodes, workflowTerminalResultExecution } from "../../../src/workflow-kit/workflow.js";
import { DESCRIPTORS, workflowModuleOf, childWorkflowModuleOf } from "../../../src/backend/app/registries/workflow-registry.js";
import { ocrWorkflow } from "../../../src/workflows/ocr/workflow.js";
import { OcrPageWorkflowInputSchema } from "../../../src/models/workflows/ocr-page/input.js";
import { ReadActiveStatus } from "../../../src/models/workflows/person-lookup/read-active-status.js";
import { OcrResultSchema, OcrWorkflowResultSchema } from "../../../src/models/workflows/ocr/result.js";
import { ReadOcrResult } from "../../../src/models/workflows/ocr/read-result.js";
import { readOcrResultTask } from "../../../src/workflows/ocr/tasks/read-result.js";
import { OcrInputSchema } from "../../../src/models/workflows/ocr/input.js";
import { ReadOcrSourcePages } from "../../../src/models/workflows/ocr/read-source-pages.js";
import { ReadOcrReviewSeed } from "../../../src/models/workflows/ocr/read-review-seed.js";
import { readOcrSourcePagesTask } from "../../../src/workflows/ocr/tasks/read-source-pages.js";
import { readOcrReviewSeedTask } from "../../../src/workflows/ocr/tasks/read-review-seed.js";
import { ocrLookupRequests, ocrLookupItemId, ocrPersonLookupRequests, ocrSignerLookupRequests } from "../../../src/models/workflows/ocr/lookup.js";
import { OcrPageOutcomeSchema, bindManualOcrPageReading, accountOcrPages } from "../../../src/models/workflows/ocr/page-accounting.js";
import { buildOcrReviewSeed } from "../../../src/models/workflows/ocr/review-seed.js";
import { OCR_FORMS } from "../../../src/models/ocr/form-registry.js";
import { I9ReadSection2Signer } from "../../../src/models/systems/i9/read-section2-signer.js";
import { ItemIdSchema } from "../../../src/rules/identity/ids.js";
import { sourceFixture, donePage, submittedPage, READING_ID, SOURCE_RUN_ID } from "../../support/fixtures/ocr/source-pages.js";
import { readOcrPageFixture } from "../../support/fixtures/ocr/read-page.js";
import { ocrTaskContext } from "../../support/fixtures/ocr/task-context.js";

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
  const bound = OcrPageWorkflowInputSchema.array().parse(children.bind({ input: request, outputs: { "read-source-pages": source } }));
  assert.equal(bound.length, pageCount);
  const outcomes = [];
  for (const [index, child] of bound.entries()) {
    const { reading } = await readOcrPageFixture(child);
    outcomes.push(OcrPageOutcomeSchema.parse({ ...donePage(inputs[index]), output: reading }));
  }
  const review = ReadOcrReviewSeed.output.parse(await readOcrReviewSeedTask.impl.run({ input: ReadOcrReviewSeed.input.parse(reviewNode.bind({ input: request,
    outputs: { "read-source-pages": source, "read-pages": outcomes } })), ctx: ocrTaskContext().ctx }));
  return { ...fixture, source, review, outcomes };
}

async function finishFixture(scope: Parameters<typeof completed.bind>[0]) {
  return OcrResultSchema.parse(await readOcrResultTask.impl.run({
    input: ReadOcrResult.input.parse(completed.bind(scope)), ctx: ocrTaskContext().ctx }));
}

describe("child-only OCR document graph", () => {
  it.each(["emergency-contact", "oath", "i9"] as const)("emits only the %s form's declared lookup and retains its typed outcome", formType => {
    const source = sourceFixture(2, formType);
    const review = buildOcrReviewSeed({ roster: null, accounting: accountOcrPages(source.manifest, READING_ID,
      source.inputs.map(input => donePage(input)), formType) });
    const person = ocrPersonLookupRequests(review), signer = ocrSignerLookupRequests(review);
    assert.equal(OCR_FORMS[formType].lookup, formType === "i9" ? "i9-lookup" : "person-lookup");
    assert.equal(person.length, formType === "i9" ? 0 : 1);
    assert.equal(signer.length, formType === "i9" ? 1 : 0);
    const signerNode = nodes.find(node => node.id === "lookup-signers");
    assert.ok(signerNode?.kind === "child-run");
    assert.deepEqual(signerNode.dependsOn, ["build-review"]);
    const input = OcrInputSchema.parse({ ...requestFixture().request, formType });
    assert.deepEqual(lookup.bind({ input, outputs: { "build-review": review } }), person.map(request => request.input));
    assert.deepEqual(lookup.sourceRecordIds?.({ input, outputs: { "build-review": review } }), person.map(request => request.recordIds));
    assert.deepEqual(signerNode.sourceRecordIds?.({ input, outputs: { "build-review": review, "lookup-identities": [] } }), signer.map(request => request.recordIds));
    assert.deepEqual(signerNode.bind({ input, outputs: { "build-review": review, "lookup-identities": [] } }), signer.map(request => request.input));
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
    assert.deepEqual(workflowTerminalResultExecution(descriptor).dependsOn, ["read-result", "approve-records"]);
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
    const { request, review } = await reviewFixture();
    assert.equal(review.records.length, 3);
    assert.equal(review.records.every(record => record.issues.includes("duplicate-subject")), true);
    const requests = ocrLookupRequests(review);
    const bound = lookup.bind({ input: request, outputs: { "build-review": review } });
    assert.deepEqual(bound, requests.map(request => request.input));
    assert.equal(bound.length, 1);
    const input = requests[0].input;
    const itemId = ItemIdSchema.parse(ocrLookupItemId(input));
    assert.equal(lookup.deriveChildItemId(input, { canonicalItemId: itemId }), itemId);
    const outcome = { state: "failed", itemId, runId: "00000000-0000-4000-8000-000000000801", failureId: "00000000-0000-4000-8000-000000000777" };
    const scope = { input: request, outputs: { "build-review": review, "lookup-identities": [outcome], "lookup-signers": [] } };
    const result = await finishFixture(scope);
    assert.deepEqual(OcrWorkflowResultSchema.parse(workflowTerminalResultExecution(descriptor).derive({ input: request,
      outputs: { "read-result": result } })), { ...result, approvedSnapshot: null });
    assert.deepEqual(result.identities[0].recordIds, review.records.map(record => record.recordId));
    assert.deepEqual(result.identities[0].outcome, outcome);
    const successful = await finishFixture({ ...scope,
      outputs: { ...scope.outputs, "lookup-identities": [{ state: "done", itemId, runId: outcome.runId,
        output: { activeStatus: ReadActiveStatus.example, crmDates: { state: "not-requested" } } }] } });
    assert.equal(successful.identities[0].outcome.state, "done");
    assert.equal(successful.review.records.every(record => record.issues.includes("identity-unverified")), true);
    assert.equal(result.review.records.every(record => record.issues.includes("identity-unverified")), true);
    await assert.rejects(finishFixture({ ...scope, outputs: { ...scope.outputs, "lookup-identities": [] } }), /do not match/);
    await assert.rejects(finishFixture({ ...scope, outputs: { ...scope.outputs,
      "lookup-identities": [{ ...outcome, itemId: READING_ID }] } }), /do not match/);
  });

  it("requires complete manual page assertions and refuses partial render windows or outcomes", async () => {
    const { request, rendered, inputs } = requestFixture(2);
    const assertions = inputs.map(input => ({ sourcePage: input.sourcePage, extraction: bindManualOcrPageReading(input, "local-operator", { ...submittedPage(input),
      source: { kind: "operator", actorId: "local-operator" } }).extraction }));
    const manual = OcrInputSchema.parse({ ...request, reading: { kind: "manual", actorId: "local-operator", assertions } });
    const output = await readOcrSourcePagesTask.impl.run({ input: { request: manual, rendered }, ctx: ocrTaskContext().ctx });
    assert.equal(output.pages.every(page => page.reading.kind === "manual"), true);
    for (const subset of [[assertions[0]], [assertions[0], assertions[0]], [assertions[0], { ...assertions[1], sourcePage: 3 }]]) {
      const refused = ocrTaskContext();
      await assert.rejects(readOcrSourcePagesTask.impl.run({ input: ReadOcrSourcePages.input.parse({ request: { ...manual,
        reading: { ...manual.reading, assertions: subset } }, rendered }), ctx: refused.ctx }), /do not match/);
      assert.deepEqual(refused.recorded, []);
    }
    await assert.rejects(readOcrSourcePagesTask.impl.run({ input: { request, rendered: { pageCount: 2, pages: [rendered.pages[0]] } }, ctx: ocrTaskContext().ctx }), /do not match/);
    await assert.rejects(readOcrReviewSeedTask.impl.run({ input: ReadOcrReviewSeed.input.parse({ sourceRunId: SOURCE_RUN_ID,
      roster: null, manifest: output.manifest, readingId: READING_ID, formType: "emergency-contact", outcomes: [donePage(inputs[0])] }), ctx: ocrTaskContext().ctx }), /do not account/);
  });

  it("retains all-failed page outcomes with an explicit empty lookup fanout", async () => {
    const { request, source, inputs } = await reviewFixture(1);
    const child = donePage(inputs[0]);
    const failed = OcrPageOutcomeSchema.parse({ runId: child.runId, itemId: child.itemId, state: "failed",
      failureId: "00000000-0000-4000-8000-000000000777" });
    const review = ReadOcrReviewSeed.output.parse(await readOcrReviewSeedTask.impl.run({ input: { sourceRunId: SOURCE_RUN_ID, roster: null,
      manifest: source.manifest, readingId: READING_ID, formType: "emergency-contact", outcomes: [failed] }, ctx: ocrTaskContext().ctx }));
    assert.deepEqual(review.pages, [{ sourcePage: 1, disposition: "failed" }]);
    assert.deepEqual(lookup.bind({ input: request, outputs: { "build-review": review } }), []);
    const result = await finishFixture({ input: request, outputs: { "build-review": review, "lookup-identities": [], "lookup-signers": [] } });
    assert.deepEqual(result.identities, []);
  });
});
