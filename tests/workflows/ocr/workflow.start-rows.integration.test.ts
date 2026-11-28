import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { deriveRunEvidenceReceipt } from "../../../src/backend/runs/provenance/evidence-receipt.js";
import { projectTypedSteps } from "../../../src/backend/runs/queries/run-detail/typed-values.js";
import { readRerunValues } from "../../../src/backend/runs/start/rerun-values.js";
import { OcrPageWorkflowInputSchema } from "../../../src/models/workflows/ocr-page/input.js";
import { EmergencyContactInputSchema } from "../../../src/models/workflows/emergency-contact/input.js";
import { OcrInputSchema } from "../../../src/models/workflows/ocr/input.js";
import { OcrWorkflowResultSchema } from "../../../src/models/workflows/ocr/result.js";
import { deriveEvidenceEntryId } from "../../../src/models/trust/evidence-identity.js";
import { createOcrReviewWorld } from "../../support/helpers/backend/ocr-review-world.js";
import { READ_AT, sourceFixture, submittedPage } from "../../support/fixtures/ocr/source-pages.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);

it("admits a manual original page through Emergency Contact Start without the OCR account", async () => {
  let available = true;
  const f = await world.fixture({ coordinator: true, holdPages: true, ocrProviderAvailable: () => available });
  const descriptor = f.root.descriptor, authority = f.database.authority;
  available = false;
  const input = EmergencyContactInputSchema.parse({ ...EmergencyContactInputSchema.parse(f.parentRun.input.parsed.value),
    readingId: randomUUID(), onbaseFiling: "skip" });
  assert.equal(input.reading.kind, "subscription");
  const options = { dryRun: false, ...(f.workbookReferences === undefined ? {} : { workbookReferences: f.workbookReferences }) };
  const entry = (pageKind: string) => ({ workflow: "ocr", step: "page-readings", facts: {
    readings: [JSON.stringify({ sourcePage: 1, pageKind, readAt: READ_AT, record: null })],
  } });
  assert.throws(() => f.canonical.start(descriptor, input, { ...options, stepOmissions: [entry("emergency-contact")] }),
    /omission facts are invalid at: readings/u);
  const run = f.canonical.start(descriptor, input, { ...options, stepOmissions: [entry("blank"),
    { workflow: "ocr", step: "review-records", facts: { outcome: "leave unverified" } },
    { workflow: "ocr", step: "identity-lookups", facts: { outcome: "leave unverified" } },
    { workflow: "ocr", step: "signer-lookups", facts: { outcome: "leave unverified" } },
    { workflow: "ocr", step: "approval", facts: { release: "withhold" } },
  ] });
  await f.canonical.execute(run, new AbortController().signal);
  const child = authority.runs.listChildren(run.envelope.runId).find(candidate => candidate.envelope.workflow === "ocr");
  assert.ok(child?.lifecycle.state === "terminal" && child.lifecycle.outcome === "done");
  const [page] = authority.runs.listChildren(child.envelope.runId);
  assert.ok(page?.lifecycle.state === "terminal" && page.lifecycle.outcome === "done");
  const { reading } = OcrPageWorkflowInputSchema.parse(page.input.parsed.value);
  assert.ok(reading.kind === "manual");
  assert.deepEqual(reading.extraction.source, { kind: "operator", actorId: "local-operator" });
  assert.equal(f.ocrCalls(), 0);
  assert.deepEqual(authority.ocrReviews.snapshots(child.envelope.runId), []);
});

it("starts with operator readings for each original page and withholds release", async () => {
  const f = await world.fixture({ pageCount: 2, holdPages: true });
  const descriptor = f.root.descriptor;
  const input = OcrInputSchema.parse({ ...OcrInputSchema.parse(f.run.input.parsed.value), readingId: randomUUID(),
    approval: "release", roster: null, reading: { kind: "subscription" } });
  const sample = sourceFixture(1).inputs[0];
  const original = submittedPage(sample, "Example, Avery", "emergency-contact");
  assert.ok(original.record);
  const answers = { ...original.record.answers, "employee.name": { state: "absent", reason: "blank" },
    "contact.name": { state: "read", raw: "Omission Evidence Example", confidence: 1 } };
  const record = { answers: Object.entries(answers).map(([path, answer]) => ({ path, answer })) };
  const readings = [JSON.stringify({ sourcePage: 1, pageKind: "emergency-contact", readAt: READ_AT, record }),
    JSON.stringify({ sourcePage: 2, pageKind: "unrelated", readAt: READ_AT, record: null })];
  const startOptions = { dryRun: false, selectedStepKeys: ["review-records", "identity-lookups", "signer-lookups"],
    ...(f.workbookReferences === undefined ? {} : { workbookReferences: f.workbookReferences }) };
  assert.throws(() => f.canonical.start(descriptor, input, { ...startOptions, stepOmissions: [
    { step: "source-pages", facts: { pageCount: 2 } },
    { step: "page-readings", facts: { readings: ["not a page reading"] } }, { step: "approval", facts: { release: "withhold" } },
  ] }), /omission facts are invalid at: readings/u);
  assert.throws(() => f.canonical.start(descriptor, input, { ...startOptions, stepOmissions: [
    { step: "source-pages", facts: { pageCount: 2 } },
    { step: "page-readings", facts: { readings: [JSON.stringify({ sourcePage: 1, pageKind: "emergency-contact", readAt: READ_AT, record: null })] } },
    { step: "approval", facts: { release: "withhold" } },
  ] }), /omission facts are invalid at: readings/u);
  const run = f.canonical.start(descriptor, input, { ...startOptions, stepOmissions: [
    { step: "source-pages", facts: { pageCount: 2 } },
    { step: "page-readings", facts: { readings } }, { step: "approval", facts: { release: "withhold" } },
  ] });
  assert.equal(OcrInputSchema.parse(run.input.parsed.value).reading.kind, "manual");
  assert.deepEqual(f.canonical.plans.at(-1)?.omittedSteps, ["source-pages", "page-readings", "approval"]);

  const { run: settled } = await f.canonical.execute(run, new AbortController().signal);
  assert.ok(settled?.lifecycle.state === "terminal" && settled.lifecycle.outcome === "done");
  assert.equal(f.ocrCalls(), 0);
  const authority = f.database.authority;
  const children = authority.runs.listChildren(run.envelope.runId).filter(child => child.envelope.workflow === "ocr-page");
  assert.equal(children.every(child => child.lifecycle.state === "terminal" && child.lifecycle.outcome === "done"), true);
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
  const receiptInput = { descriptor, run: settled, result,
    checkpoints: authority.runCheckpoints.listByItem(descriptor.id, run.envelope.itemId),
    delegations: result.dependencies.flatMap(dependency => dependency.state === "delegation-resolved"
      ? [authority.dependencies.evidence(run.envelope.runId, dependency.nodeId)] : []) };
  const { receipt } = deriveRunEvidenceReceipt(receiptInput);
  assert.equal(receipt.decisions.some(decision => decision.kind === "gate"), false);
  assert.throws(() => deriveRunEvidenceReceipt({ ...receiptInput, run: { ...settled, envelope: { ...settled.envelope,
    stepOmissions: settled.envelope.stepOmissions?.filter(({ step }) => step !== "approval") } } }), /OCR_REVIEW_REFUSED/u);
  const typed = projectTypedSteps(settled, descriptor).get("page-readings")?.typedValues;
  assert.partialDeepStrictEqual(typed, { fields: [{ key: "readings", withheld: true }] });
  const rerun = readRerunValues({ database: f.database, reader: f.canonical.lifecycle, descriptors: { resolve: f.resolve } },
    { runId: run.envelope.runId, expectedVersion: settled.version });
  assert.equal(rerun.state, "available");
  assert.deepEqual(rerun.snapshot.sourceInput, { state: "unavailable", reason: "protected" });
  assert.equal(rerun.snapshot.typed?.some(entry => entry.step === "page-readings"), false);
  assert.equal(JSON.stringify(typed).includes("Omission Evidence Example"), false, "typed Logs values must be withheld");
  assert.equal(JSON.stringify(rerun).includes("Omission Evidence Example"), false, "Rerun must withhold the manual reading");
});

it("settles with an omitted review when grouping and its dependent rows are off", async () => {
  const f = await world.fixture({ holdPages: true });
  const descriptor = f.root.descriptor;
  const run = f.canonical.start(descriptor, { ...OcrInputSchema.parse(f.run.input.parsed.value), readingId: randomUUID(), approval: "release", roster: null }, {
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
    checkpoints: authority.runCheckpoints.listByItem(descriptor.id, run.envelope.itemId),
    delegations: result.dependencies.flatMap(dependency => dependency.state === "delegation-resolved"
      ? [authority.dependencies.evidence(run.envelope.runId, dependency.nodeId)] : []) });
  assert.partialDeepStrictEqual(receipt.output.find(entry => entry.id === deriveEvidenceEntryId(receipt.receiptId, "output", "review.step")),
    { value: { value: "review-records" } });
});
