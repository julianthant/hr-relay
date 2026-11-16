import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import readXlsxFile from "read-excel-file/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createI9CheckStartWorld } from "../../support/helpers/backend/i9-check-start-world.js";
import { I9CheckStartResultSchema } from "../../../src/models/workflows/i9-check/batch.js";
import { I9CheckRowSchema } from "../../../src/models/workflows/i9-check/check.js";
import { I9CheckCanonicalInput } from "../../../src/models/workflows/i9-check/input.js";
import { createReceiptService } from "../../../src/backend/runs/trust/receipt-service.js";

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
