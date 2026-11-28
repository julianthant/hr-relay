import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { deriveRunEvidenceReceipt } from "../../../src/backend/runs/provenance/evidence-receipt.js";
import { projectTypedSteps } from "../../../src/backend/runs/queries/run-detail/typed-values.js";
import { OcrPageWorkflowInputSchema } from "../../../src/models/workflows/ocr-page/input.js";
import { OcrInputSchema } from "../../../src/models/workflows/ocr/input.js";
import { OcrWorkflowResultSchema } from "../../../src/models/workflows/ocr/result.js";
import { deriveEvidenceEntryId } from "../../../src/models/trust/evidence-identity.js";
import { createOcrReviewWorld } from "../../support/helpers/backend/ocr-review-world.js";
import { READ_AT, sourceFixture, submittedPage } from "../../support/fixtures/ocr/source-pages.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);

it("starts with operator readings for each original page and withholds release", async () => {
  const f = await world.fixture({ pageCount: 2, holdPages: true });
  const descriptor = f.root.descriptor;
  const input = OcrInputSchema.parse({ ...OcrInputSchema.parse(f.run.input.parsed.value), readingId: randomUUID(),
    approval: "release", reading: { kind: "subscription" } });
  const sample = sourceFixture(1).inputs[0];
  const original = submittedPage(sample, "Example, Avery", "emergency-contact");
  assert.ok(original.record);
  const record = { answers: { ...original.record.answers, "employee.name": { state: "absent", reason: "blank" },
    "contact.name": { state: "read", raw: "Omission Evidence Example", confidence: 1 } } };
  const readings = [JSON.stringify({ sourcePage: 1, pageKind: "emergency-contact", readAt: READ_AT, record }),
    JSON.stringify({ sourcePage: 2, pageKind: "unrelated", readAt: READ_AT, record: null })];
  const startOptions = { dryRun: false, selectedStepKeys: ["review-records", "identity-lookups", "signer-lookups"],
    ...(f.workbookReferences === undefined ? {} : { workbookReferences: f.workbookReferences }) };
  assert.throws(() => f.canonical.start(descriptor, input, { ...startOptions, stepOmissions: [
    { step: "source-pages", facts: { pageCount: 2 } },
    { step: "page-readings", facts: { readings: ["not a page reading"] } }, { step: "approval", facts: { release: "withhold" } },
  ] }), /omission facts are invalid at: readings/u);
  const run = f.canonical.start(descriptor, input, { ...startOptions, stepOmissions: [
    { step: "source-pages", facts: { pageCount: 2 } },
    { step: "page-readings", facts: { readings } }, { step: "approval", facts: { release: "withhold" } },
  ] });
  assert.equal(OcrInputSchema.parse(run.input.parsed.value).reading.kind, "manual");
  assert.deepEqual(f.canonical.plans.at(-1)?.omittedSteps, ["source-pages", "page-readings", "approval"]);

  const { run: settled } = await f.canonical.execute(run, new AbortController().signal);
  assert.ok(settled?.lifecycle.state === "terminal" && settled.lifecycle.outcome === "done");
  assert.deepEqual(f.pageReads.toSorted(), [1, 2]);
  assert.equal(f.ocrCalls(), 0);
  const authority = f.database.authority;
  const children = authority.runs.listChildren(run.envelope.runId).filter(child => child.envelope.workflow === "ocr-page");
  assert.deepEqual(children.map(child => OcrPageWorkflowInputSchema.parse(child.input.parsed.value)).map(({ page, reading }) =>
    [page.sourcePage, reading.kind === "manual" ? reading.extraction.source : null]).toSorted(),
  [[1, { kind: "operator", actorId: "local-operator" }], [2, { kind: "operator", actorId: "local-operator" }]]);
  const review = authority.ocrReviews.latest(run.envelope.runId);
  assert.ok(review);
  assert.deepEqual(review.seed.review.pages, [{ sourcePage: 1, disposition: "record" }, { sourcePage: 2, disposition: "unrelated" }]);
  const page = review.seed.review.accounting.outcomes[0];
  assert.ok(page?.state === "done");
  assert.partialDeepStrictEqual(page.output.extraction.record?.answers.find(answer => answer.path === "contact.name"),
    { raw: "Omission Evidence Example" });
  assert.equal(authority.gateResults.get(`${run.envelope.runId}:approve-records`), undefined);
  assert.deepEqual(authority.ocrReviews.snapshots(run.envelope.runId), []);
  const result = authority.runResults.get(run.envelope.runId);
  assert.ok(result);
  assert.equal(OcrWorkflowResultSchema.parse(result.result.value).approvedSnapshot, null);
  const { receipt } = deriveRunEvidenceReceipt({ descriptor, run: settled, result,
    checkpoints: authority.runCheckpoints.listByItem(descriptor.id, run.envelope.itemId) });
  const typed = projectTypedSteps(settled, descriptor).get("page-readings")?.typedValues;
  assert.partialDeepStrictEqual(typed, { fields: [{ key: "readings", withheld: true }] });
  assert.equal(JSON.stringify({ typed, receipt }).includes("Omission Evidence Example"), false);
});

it("settles with an omitted review when grouping and its dependent rows are off", async () => {
  const f = await world.fixture({ holdPages: true });
  const descriptor = f.root.descriptor;
  const run = f.canonical.start(descriptor, { ...OcrInputSchema.parse(f.run.input.parsed.value), readingId: randomUUID(), approval: "release" }, {
    dryRun: false, selectedStepKeys: ["source-pages", "page-readings"],
    ...(f.workbookReferences === undefined ? {} : { workbookReferences: f.workbookReferences }),
    stepOmissions: [
      { step: "review-records", facts: { outcome: "leave unverified" } },
      { step: "identity-lookups", facts: { outcome: "leave unverified" } },
      { step: "signer-lookups", facts: { outcome: "leave unverified" } },
      { step: "approval", facts: { release: "withhold" } },
    ],
  });
  const { run: settled } = await f.canonical.execute(run, new AbortController().signal);
  assert.ok(settled?.lifecycle.state === "terminal" && settled.lifecycle.outcome === "done");
  const authority = f.database.authority;
  const result = authority.runResults.get(run.envelope.runId);
  assert.ok(result);
  assert.deepEqual(OcrWorkflowResultSchema.parse(result.result.value), {
    review: { state: "omitted", step: "review-records" }, identities: [], approvedSnapshot: null,
  });
  assert.equal(authority.ocrReviews.latest(run.envelope.runId), undefined);
  assert.deepEqual(authority.gateResults.listByRun(run.envelope.runId), []);
  const { receipt } = deriveRunEvidenceReceipt({ descriptor, run: settled, result,
    checkpoints: authority.runCheckpoints.listByItem(descriptor.id, run.envelope.itemId) });
  assert.partialDeepStrictEqual(receipt.output.find(entry => entry.id === deriveEvidenceEntryId(receipt.receiptId, "output", "review.step")),
    { value: { value: "review-records" } });
});
