import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import readXlsxFile from "read-excel-file/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createI9CheckStartWorld } from "../../support/helpers/backend/i9-check-start-world.js";
import { I9CheckStartResultSchema } from "../../../src/models/workflows/i9-check/batch.js";
import { I9CheckRowSchema } from "../../../src/models/workflows/i9-check/check.js";
import { I9CheckCanonicalInput } from "../../../src/models/workflows/i9-check/input.js";
import { createReceiptService } from "../../../src/backend/runs/trust/receipt-service.js";
import { createOperatorProjection, createOperatorRunDetail } from "../../../src/backend/app/composition/dashboard/operator.js";
import { deriveRunEvidenceReceipt } from "../../../src/backend/runs/provenance/evidence-receipt.js";
import { buildRunDetail } from "../../../src/backend/runs/queries/run-detail.js";
import { buildRunLogsWhole } from "../../../src/backend/runs/queries/run-logs.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import { readDelegationEvidence } from "../../../src/backend/storage/sqlite/delegation-authority.js";
import { projectRunLogs } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { logPlainText } from "../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { deriveEvidenceEntryId } from "../../../src/models/trust/evidence-identity.js";
import { OcrPageWorkflowInputSchema } from "../../../src/models/workflows/ocr-page/input.js";
import { READ_AT } from "../../support/fixtures/ocr/source-pages.js";

describe("I-9 Start with typed OCR values", () => {
  const world = createI9CheckStartWorld();
  afterAll(world.cleanup);

  it("validates one original PDF before Start and admits manual readings for its exact pages", async () => {
    const f = await world.fixture();
    const descriptor = f.root.descriptor;
    const options = { dryRun: true, workbookReferences: [{ entry: 1, libraryId: f.referenceId, versionId: f.selectedReference.versionId,
      sheetId: "history", expectedVersion: f.library.read(f.referenceId).version }] };
    const first = { ...f.input.documents[0], readingId: randomUUID(), reading: { kind: "subscription" } };
    const input = { ...f.input, documents: [first] };
    const reading = (sourcePage: number, pageKind: string) => JSON.stringify({ sourcePage, pageKind, readAt: READ_AT, record: null });
    const entry = (readings: string[]) => ({ workflow: "ocr", step: "page-readings", facts: { readings } });
    const manual = entry([reading(1, "blank"), reading(2, "unrelated")]);
    assert.throws(() => f.canonical.start(descriptor, input, { ...options, stepOmissions: [entry([reading(1, "i9-section1")])] }),
      /omission facts are invalid at: readings/u);
    assert.throws(() => f.canonical.start(descriptor, { ...input, documents: [first, f.input.documents[1]] }, { ...options, stepOmissions: [manual] }),
      /Start with one document/u);
    const run = f.canonical.start(descriptor, input, { ...options, stepOmissions: [manual,
      { workflow: "ocr", step: "review-records", facts: { outcome: "leave unverified" } },
      { workflow: "ocr", step: "identity-lookups", facts: { outcome: "leave unverified" } },
      { workflow: "ocr", step: "signer-lookups", facts: { outcome: "leave unverified" } },
      { workflow: "ocr", step: "approval", facts: { release: "withhold" } },
    ] });
    await f.canonical.execute(run, new AbortController().signal);
    const authority = f.database.authority;
    const [child] = authority.runs.listChildren(run.envelope.runId);
    expect(child?.envelope.workflow).toBe("ocr");
    assert.ok(child?.lifecycle.state === "terminal" && child.lifecycle.outcome === "done");
    const pages = authority.runs.listChildren(child.envelope.runId);
    assert.ok(pages.every(page => page.lifecycle.state === "terminal" && page.lifecycle.outcome === "done"));
    expect(pages.map(page => OcrPageWorkflowInputSchema.parse(page.input.parsed.value)).map(({ page, reading: value }) =>
      [page.sourcePage, value.kind === "manual" ? value.extraction.source : null]).toSorted()).toEqual([
      [1, { kind: "operator", actorId: "local-operator" }], [2, { kind: "operator", actorId: "local-operator" }],
    ]);
    expect(f.publishCalls).toEqual([]);
  });
});

describe("one I-9 PDF Start through admitted children", () => {
  const world = createI9CheckStartWorld();
  let f: Awaited<ReturnType<typeof world.fixture>>;
  beforeAll(async () => { f = await world.fixture(); });
  afterAll(world.cleanup);

  it("i9-check-start/pdfs — admits two original PDFs as children of one parent", async () => {
    expect(f.input.documents).toHaveLength(2);
    const first = await f.canonical.step(f.run, new AbortController().signal);
    expect(first.outcome.state).toBe("yielded-delegation");
    const documents = f.database.authority.runs.listChildren(f.run.envelope.runId);
    expect(documents).toHaveLength(2);
    expect(documents.every(child => child.envelope.workflow === "ocr" && child.lifecycle.state === "queued")).toBe(true);
    expect(f.database.authority.delegationManifests.listByParentRun(f.run.envelope.runId)).toHaveLength(1);
  });
  it("admits each PDF's own page children before resolving any review", async () => {
    for (let document = 0; document < 2; document += 1) {
      const next = await f.canonical.step(f.run, new AbortController().signal);
      expect(next.run.envelope.workflow).toBe("ocr");
      expect(next.outcome.state).toBe("yielded-delegation");
      const pages = f.database.authority.runs.listChildren(next.run.envelope.runId);
      expect(pages).toHaveLength(2);
      expect(pages.every(page => page.envelope.workflow === "ocr-page")).toBe(true);
    }
  });
  it("reads the original pages and parks the first PDF for explicit review without publishing results", async () => {
    const result = await f.canonical.execute(f.run, new AbortController().signal);
    expect(result.run?.lifecycle.state, JSON.stringify(result.outcomes)).toBe("queued");
    const documents = f.database.authority.runs.listChildren(f.run.envelope.runId);
    expect(documents).toHaveLength(2);
    expect(documents.every(child => child.envelope.workflow === "ocr")).toBe(true);
    for (const child of documents) expect(child.input.parsed.value).toMatchObject({ roster: null });
    expect(documents.filter(child => child.lifecycle.state === "parked-gate"), JSON.stringify({ outcomes: result.outcomes, failures: result.outcomes.flatMap(outcome => outcome.state === "failed" ? [f.database.authority.failures.get(outcome.failureId)].map(failure => ({ nodeId: failure?.nodeId, taskId: failure?.taskId, code: failure?.code, summary: failure?.summary })) : []) })).toHaveLength(1);
    expect(f.database.authority.workbooks.list().filter(workbook => workbook.libraryId.startsWith("workflow:"))).toHaveLength(0);
  });
  it("resumes the same parent after the first exact OCR approval and parks the next original PDF", async () => {
    const changed = await f.changeReference();
    expect("versionId" in changed.master ? changed.master.versionId : undefined).not.toBe(f.selectedReference.versionId);
    expect(changed.master.rows[0].matches[0].values.ppsEid).toBe("999999999");
    expect(changed.otherSource.libraryId).not.toBe(f.referenceId);
    expect(changed.renamed.versionName).toBe("Renamed later");
    const first = f.approveNext();
    const result = await f.canonical.execute(f.run, new AbortController().signal);
    expect(result.run?.lifecycle.state).toBe("queued");
    const documents = f.database.authority.runs.listChildren(f.run.envelope.runId);
    expect(documents.find(child => child.envelope.runId === first)?.lifecycle).toMatchObject({ state: "terminal", outcome: "done" });
    expect(documents.filter(child => child.lifecycle.state === "parked-gate"), JSON.stringify({ outcomes: result.outcomes, failures: result.outcomes.flatMap(outcome => outcome.state === "failed" ? [f.database.authority.failures.get(outcome.failureId)].map(failure => ({ nodeId: failure?.nodeId, taskId: failure?.taskId, code: failure?.code, summary: failure?.summary })) : []) })).toHaveLength(1);
    expect(f.database.authority.runs.listChildren(f.run.envelope.runId).filter(child => child.envelope.workflow === "i9-check")).toHaveLength(0);
  });
  it("checks both corrected people and publishes one workbook and the configured tracker before completing", async () => {
    f.approveNext();
    const result = await f.canonical.execute(f.run, new AbortController().signal);
    const failures = result.outcomes.filter(outcome => outcome.state === "failed").map(outcome => f.database.authority.failures.get(outcome.failureId)?.summary);
    expect(result.run?.lifecycle, failures.join(", ")).toMatchObject({ state: "terminal", outcome: "done" });
    const terminal = f.database.authority.runResults.get(f.run.envelope.runId); assert.ok(terminal);
    const output = I9CheckStartResultSchema.parse(terminal.result.value);
    expect(output.personCount).toBe(2);
    expect(output.tracker.rows.map(row => [row.ucpathEmplId, row.action])).toEqual([["10000001", "Keep"], ["10000002", "Keep"]]);
    expect(output.tracker.rows.map(row => row.ppsEid)).toEqual(["000012345", "000012345"]);
    expect(output.reference.snapshot).toMatchObject({ libraryId: f.referenceId, version: f.selectedReference.version,
      versionId: f.selectedReference.versionId, versionName: "Fall review", worksheets: [{ sheetId: "history", name: "Action History" }] });
    expect(output.reference.snapshot.rows.map(row => row.matches.map(match => [match.sheetId, match.rowId]))).toEqual([[["history", "person-0"]], [["history", "person-1"]]]);
    expect(f.readRefusals).toEqual(new Set(["missing run", "foreign claim", "altered input", "foreign type", "altered fields"]));
    expect(output.people.map(person => person.sources.length)).toEqual([2, 2]);
    for (const document of f.database.authority.runs.listChildren(f.run.envelope.runId).filter(child => child.envelope.workflow === "ocr")) {
      const lookups = f.database.authority.runs.listChildren(document.envelope.runId).filter(child => child.envelope.workflow === "i9-lookup");
      expect(lookups.length).toBeGreaterThan(0);
      for (const lookup of lookups) {
        expect(lookup.lifecycle).toMatchObject({ state: "terminal", outcome: "done" });
        expect(f.database.authority.runResults.get(lookup.envelope.runId)?.result.value).toMatchObject({ i9Status: "not-found", signerName: "" });
      }
    }

    const workbooks = f.database.authority.workbooks.list().filter(workbook => workbook.libraryId.startsWith("workflow:"));
    expect(workbooks).toHaveLength(1);
    expect(workbooks[0].libraryId).toBe(output.workbook.libraryId);
    expect(workbooks[0].workbook.sheets[0].rows).toHaveLength(3);
    expect(f.library.catalog().find(entry => entry.libraryId === output.workbook.libraryId)?.state.origin).toMatchObject({
      kind: "workflow", workflowId: "i9-check-start", runId: f.run.envelope.runId, rowCount: 2, rowSubject: "person",
    });
    const config = f.database.authority.configSnapshots.get(f.run.envelope.configSnapshotId); assert.ok(config);
    const sheets = await readXlsxFile(readFileSync(config.config.paths.i9CheckTrackerPath));
    expect(sheets.find(sheet => sheet.sheet === "I-9 Check")?.data).toHaveLength(3);
    expect(f.database.authority.artifactOutbox.listPending()).toHaveLength(0);
    expect(f.publishCalls).toHaveLength(1);
    expect(f.projections).toHaveLength(1);
    expect(f.plan?.planned[0]?.outputs).toHaveLength(1);
    expect(f.database.readProfileResourceCustody().writeIntents).toHaveLength(0);
    const people = f.database.authority.runs.listChildren(f.run.envelope.runId).filter(child => child.envelope.workflow === "i9-check");
    expect(people).toHaveLength(2);
    expect(people.map(child => I9CheckCanonicalInput.parse(child.input.parsed.value).person.dob)).toEqual(["2001-02-03", "2001-02-03"]);
    expect(f.database.authority.delegationManifests.listByParentRun(f.run.envelope.runId)).toHaveLength(2);
  });
  it("derives the unchanged receipt format from the completed native parent and replays it exactly", () => {
    const service = createReceiptService({ database: f.database, runReader: f.canonical.lifecycle, descriptors: [f.root.descriptor] });
    const receipt = service.ensureReceipt(f.run.envelope.runId);
    expect(receipt.composition).toBe(5);
    expect(receipt.runId).toBe(f.run.envelope.runId);
    expect(receipt.output.find(fact => fact.field === "personCount")).toMatchObject({ state: "satisfied", value: { value: 2 } });
    expect(service.ensureReceipt(f.run.envelope.runId)).toEqual(receipt);
  });
});

describe("an I-9 dry run previews the workbook and leaves every local output untouched", () => {
  const world = createI9CheckStartWorld();
  let f: Awaited<ReturnType<typeof world.fixture>>;
  let trackerBefore: Buffer | null, workbooksBefore: number;
  const trackerBytes = () => {
    const config = f.database.authority.configSnapshots.get(f.run.envelope.configSnapshotId); assert.ok(config);
    const path = config.config.paths.i9CheckTrackerPath;
    return existsSync(path) ? readFileSync(path) : null;
  };
  const walk = (runId: string): ReturnType<typeof f.database.authority.runs.listChildren> =>
    f.database.authority.runs.listChildren(runId).flatMap(child => [child, ...walk(child.envelope.runId)]);
  const documents = () => f.database.authority.runs.listChildren(f.run.envelope.runId).filter(child => child.envelope.workflow === "ocr");
  beforeAll(async () => {
    f = await world.fixture({ dryRun: true });
    trackerBefore = trackerBytes();
    workbooksBefore = f.database.authority.workbooks.list().length;
  });
  afterAll(world.cleanup);

  it("i9-check-start/dry-run — plans no output and parks the first of two PDFs for review", async () => {
    expect(f.plan?.planned[0]?.outputs).toBeUndefined();
    const result = await f.canonical.execute(f.run, new AbortController().signal);
    expect(result.run?.lifecycle.state).toBe("queued");
    expect(documents()).toHaveLength(2);
    expect(documents().filter(child => child.lifecycle.state === "parked-gate")).toHaveLength(1);
    expect(walk(f.run.envelope.runId).every(child => child.envelope.dryRun === true)).toBe(true);
  });
  it("resumes after the first approval and parks the second PDF", async () => {
    const first = f.approveNext();
    const result = await f.canonical.execute(f.run, new AbortController().signal);
    expect(result.run?.lifecycle.state).toBe("queued");
    expect(documents().find(child => child.envelope.runId === first)?.lifecycle).toMatchObject({ state: "terminal", outcome: "done" });
    expect(documents().filter(child => child.lifecycle.state === "parked-gate")).toHaveLength(1);
    expect(walk(f.run.envelope.runId).every(child => child.envelope.dryRun === true)).toBe(true);
  });
  it("checks both people for real, previews the save and never starts the tracker", async () => {
    f.approveNext();
    const result = await f.canonical.execute(f.run, new AbortController().signal);
    expect(result.run?.lifecycle).toMatchObject({ state: "terminal", outcome: "done" });
    const descendants = walk(f.run.envelope.runId);
    expect(descendants.every(child => child.envelope.dryRun === true)).toBe(true);
    for (const child of descendants) expect(child.lifecycle).toMatchObject({ state: "terminal", outcome: "done" });
    for (const child of descendants) expect(f.database.authority.runResults.get(child.envelope.runId)?.result.value).not.toHaveProperty("kind", "publication-dry-run-preview");
    const people = f.database.authority.runs.listChildren(f.run.envelope.runId).filter(child => child.envelope.workflow === "i9-check");
    expect(people.map(child => I9CheckCanonicalInput.parse(child.input.parsed.value).ocrRunId).toSorted())
      .toEqual(documents().map(child => child.envelope.runId).toSorted());
    expect(people.map(child => {
      const row = I9CheckRowSchema.parse(Reflect.get(f.database.authority.runResults.get(child.envelope.runId)?.result.value as object, "row"));
      return [row.ucpathEmplId, row.action];
    }).toSorted()).toEqual([["10000001", "Keep"], ["10000002", "Keep"]]);
    for (const document of documents()) {
      const lookups = f.database.authority.runs.listChildren(document.envelope.runId).filter(child => child.envelope.workflow === "i9-lookup");
      expect(lookups.length).toBeGreaterThan(0);
      for (const lookup of lookups) expect(f.database.authority.runResults.get(lookup.envelope.runId)?.result.value).toMatchObject({ i9Status: "not-found", signerName: "" });
    }
    const terminal = f.database.authority.runResults.get(f.run.envelope.runId); assert.ok(terminal);
    expect(terminal.result.value).toMatchObject({ kind: "publication-dry-run-preview", externalCommit: "none", coverage: { state: "full" } });
    const steps = Reflect.get(terminal.result.value as object, "steps") as { nodeId: string; state: string; reason?: string }[];
    expect(steps.find(step => step.nodeId === "save-workbook")).toEqual({ nodeId: "save-workbook", state: "publication-preview" });
    expect(steps.find(step => step.nodeId === "publish-results")).toEqual({ nodeId: "publish-results", state: "unavailable", reason: "requires-unsubmitted-output" });
    expect(steps.filter(step => step.nodeId !== "save-workbook" && step.nodeId !== "publish-results").every(step => step.state === "exercised" || step.state === "not-run")).toBe(true);
    expect(f.publishCalls).toEqual([]);
    expect(f.database.authority.workbooks.list()).toHaveLength(workbooksBefore);
    expect(f.projections).toEqual([]);
    expect(f.database.authority.generatedArtifacts.list().flatMap(file => file.updates.filter(update => update.record.sourceRunId === f.run.envelope.runId))).toEqual([]);
    expect(trackerBytes()).toEqual(trackerBefore);
  });
});

describe("I-9 Check Start omissions", () => {
  const world = createI9CheckStartWorld();
  afterEach(world.cleanup);

  it("shows unavailable evidence in the stopped dry-run preview", async () => {
    const f = await world.fixture({ dryRun: true, selection: { selectedStepKeys: [],
      stepOmissions: ["documents", "roster-reference", "retention", "publication"].map(step => ({ step, facts: {} })) } });
    const { database, clock, root: { descriptor } } = f;
    const { run } = await f.canonical.execute(f.run, new AbortController().signal);
    assert.ok(run?.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
    const runId = run.envelope.runId, reader = f.canonical.lifecycle, stateRoot = f.harness.authority.stateRoot;
    const descriptors = { resolve: (id: string) => id === descriptor.id ? descriptor : undefined };
    const projection = createOperatorProjection({ database, stateRoot, clock, reader, appVersion: "0.1.0",
      descriptorSetHash: FingerprintSchema.parse("a".repeat(64)), ledger: createTransactionHistory(database.authority), descriptors });
    projection.ingestFromTimeline();
    const deps = createOperatorRunDetail({ database, stateRoot, projection, runReader: reader, canonical: { database, reader, descriptors } });
    const preview = buildRunLogsWhole(deps, runId, projection.runFold(runId), run).payload.dryRunPreview;
    assert.ok(preview?.state === "available");
    expect(preview.stages.find(stage => stage.id === "save-workbook")).toMatchObject({ state: "skipped", detail: "required-evidence-unavailable" });
  });

  it.each([
    { step: "documents", omitted: ["documents", "roster-reference", "retention", "publication"], review: false },
    { step: "roster-reference", omitted: ["roster-reference", "retention", "publication"], review: true },
    { step: "retention", omitted: ["retention", "publication"], review: true },
    { step: "publication", omitted: ["publication"], review: true },
  ])("settles the $step omission without saving or projecting the tracker", async ({ step, omitted, review }) => {
    const signal = new AbortController().signal;
    const f = await world.fixture({ selection: {
      selectedStepKeys: ["documents", "roster-reference", "retention", "publication"].filter(key => !omitted.includes(key)),
      stepOmissions: omitted.map(key => ({ step: key, facts: {} })),
    } });
    const { root: { descriptor }, database, run: queued, clock } = f;
    const runId = queued.envelope.runId;
    if (review) for (let i = 0; i < 2; i++) {
      const reviewing = await f.canonical.execute(queued, signal);
      const failures = reviewing.outcomes.flatMap(outcome => outcome.state === "failed"
        ? [database.authority.failures.get(outcome.failureId)?.summary] : []);
      expect(database.authority.runs.listChildren(runId).some(child => child.lifecycle.state === "parked-gate"), JSON.stringify(failures)).toBe(true);
      f.approveNext();
    }
    const { run } = await f.canonical.execute(queued, signal);
    assert.ok(run?.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
    const result = database.authority.runResults.get(runId);
    assert.ok(result);
    const publication = step === "publication";
    if (publication) expect(result.result.value).toMatchObject({ personCount: 2, workbook: { state: "omitted", step } });
    else expect(result.result.value).toEqual({ state: "stopped", reason: "retention-results-unavailable" });
    expect(f.plan?.planned[0]?.outputs).toBeUndefined();
    expect(f.publishCalls).toEqual([]);
    expect(f.projections).toEqual([]);
    expect(database.authority.writeIntents.listByRun(runId)).toEqual([]);
    expect(database.authority.runs.listChildren(runId).some(child => child.envelope.workflow === "i9-check")).toBe(publication);
    if (!review) expect(database.authority.runs.listChildren(runId)).toEqual([]);

    const { receipt } = deriveRunEvidenceReceipt({ descriptor, run, result,
      checkpoints: database.authority.runCheckpoints.listByItem(descriptor.id, run.envelope.itemId),
      delegations: result.dependencies.flatMap(entry => entry.state === "delegation-resolved" || entry.state === "child-resolved"
        ? [readDelegationEvidence(database.authority, entry.parentRunId, entry.nodeId)] : []),
    });
    const receiptEntry = deriveEvidenceEntryId(receipt.receiptId, "output", publication ? "workbook.step" : "reason");
    expect(receipt.output.find(fact => fact.id === receiptEntry))
      .toMatchObject({ state: "satisfied", value: { value: publication ? "publication" : "retention-results-unavailable" } });

    const reader = f.canonical.lifecycle;
    const descriptors = { resolve: (id: string) => id === descriptor.id ? descriptor : undefined };
    const stateRoot = f.harness.authority.stateRoot;
    const projection = createOperatorProjection({ database, stateRoot, clock, reader, appVersion: "0.1.0",
      descriptorSetHash: FingerprintSchema.parse("a".repeat(64)), ledger: createTransactionHistory(database.authority), descriptors });
    projection.ingestFromTimeline();
    const deps = createOperatorRunDetail({ database, stateRoot, projection, runReader: reader, canonical: { database, reader, descriptors } });
    const detail = buildRunDetail(deps, runId);
    const publicationStep = detail.timeline.steps?.find(entry => entry.key === "publication");
    assert.ok(publicationStep);
    expect(publicationStep.typedValues?.title).toBe(publication ? "Operator-entered values" : undefined);
    const section = buildRunLogsWhole(deps, runId, projection.runFold(runId), run);
    const log = projectRunLogs({ detail, logs: section.payload, sections: [], unavailableEvidence: [] }, { artifactUrl: () => "unused" });
    const publicationStage = log.timeline.find(stage => stage.id === "publication");
    const line = log.steps.find(entry => entry.id === publicationStage?.stepId);
    assert.ok(line, JSON.stringify(log.timeline));
    expect(logPlainText([line])).toContain(publication ? "Done outside Relay" : "Required evidence unavailable");
  });
});
