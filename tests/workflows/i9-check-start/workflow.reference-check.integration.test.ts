import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { referenceCheckLines } from "../../support/helpers/backend/reference-check-lines.js";
import { REFERENCE_CHECK_ID, ReferenceReviewSchema } from "../../../src/models/processing/workbooks/reference-fields.js";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { parseRunWorkbookReference } from "../../../src/models/dashboard/workbooks.js";
import type { RunRecord } from "../../../src/models/run/record.js";
import { I9CheckStartResultSchema } from "../../../src/models/workflows/i9-check/batch.js";
import { I9IdentitySchema } from "../../../src/models/workflows/i9-check/check.js";
import { createI9CheckStartWorld } from "../../support/helpers/backend/i9-check-start-world.js";
import { createOperatorProjection, createOperatorRunDetail } from "../../../src/backend/app/composition/dashboard/operator.js";
import { readRunDetail } from "../../../src/backend/runs/queries/run-detail.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import { PersonLookupResultSchema } from "../../../src/models/workflows/person-lookup/result.js";
import { descriptorSetHash, SERVER_REGISTRY } from "../../../src/backend/app/registries/workflow-registry.js";
import { testRunService } from "../../support/fixtures/run-lifecycle-fixtures.js";

const world = createI9CheckStartWorld();
afterEach(world.cleanup);
/** A person child's result; only the identity UCPath found is read here. */
const ChildResultSchema = z.looseObject({ identity: I9IdentitySchema });
/** A name no fixture carries, so finding it anywhere in a run proves a row value leaked. */
const ROW_ONLY_NAME = "Zebedee Quillfeather";
/** Holds both people; Blair's row carries another name. */
const ROSTER = { name: "Fall roster", sheet: "Hires", fields: ["eid", "fullName", "dob"],
  rows: [["10000001", "Avery Example", "2000-01-15"], ["10000002", ROW_ONLY_NAME, "2000-01-15"]] };
/** Holds Avery only and has no name column. */
const BADGES = { name: "Badge list", sheet: "Issued", fields: ["eid"], rows: [["10000001"]] };

async function fixture(options: Parameters<typeof world.fixture>[0] = {}) {
  const f = await world.fixture(options);
  /** Runs the Start through both PDF reviews to its end. */
  const runToEnd = async () => {
    await f.canonical.execute(f.run, new AbortController().signal);
    f.approveNext();
    await f.canonical.execute(f.run, new AbortController().signal);
    f.approveNext();
    const result = await f.canonical.execute(f.run, new AbortController().signal);
    return result.run;
  };
  const people = () => f.database.authority.runs.listChildren(f.run.envelope.runId).filter(child => child.envelope.workflow === "i9-check");
  const events = (run: RunRecord) => f.database.authority.timelineEvents.page({ runId: run.envelope.runId, limit: 1_000 });
  const checkLines = (run: RunRecord) => referenceCheckLines(events(run));
  const nodeSpans = (run: RunRecord, nodeId: string) => events(run).flatMap(event => event.payload.kind === "span" && event.payload.event.t === "span.ended"
    && event.payload.event.spanPath.includes(`/${nodeId}#`) ? [[event.payload.event.outcome, "notRunReason" in event.payload.event ? event.payload.event.notRunReason : undefined]] : []);
  /** Each person child's check lines, keyed by the Employee ID UCPath found. */
  const linesByPerson = () => Object.fromEntries(people().map(child => {
    const { identity } = ChildResultSchema.parse(f.database.authority.runResults.get(child.envelope.runId)?.result.value);
    assert.ok(identity.status === "found", JSON.stringify(identity));
    return [identity.eid, checkLines(child)] as const;
  }));
  /** Results workbooks the run saved to the library. */
  const savedResults = () => f.database.authority.workbooks.list().filter(workbook => workbook.libraryId.startsWith("workflow:")).length;
  const cardContext = async (run: RunRecord) => {
    const { stateRoot } = f.admission;
    const reader = testRunService(f.database, f.clock);
    const descriptors = { resolve: (id: string) => SERVER_REGISTRY[id]?.descriptor };
    const projection = createOperatorProjection({ database: f.database, stateRoot, clock: f.clock, reader, appVersion: "0.1.0",
      descriptorSetHash: descriptorSetHash([run.envelope.contractFingerprint]), ledger: createTransactionHistory(f.database.authority), descriptors });
    projection.ingestFromTimeline();
    const { gate } = await readRunDetail(createOperatorRunDetail({ database: f.database, stateRoot, projection, runReader: reader,
      canonical: { database: f.database, reader, descriptors } }), run.envelope.runId, new AbortController().signal);
    assert.ok(gate.state === "open" && gate.decision !== undefined);
    return gate.decision.context;
  };
  return { ...f, runToEnd, people, events, checkLines, nodeSpans, linesByPerson, savedResults, cardContext };
}

describe("I-9 Check reference spreadsheet check", () => {
  it("skips the check in every person child with only the required roster picked", async () => {
    const f = await fixture();
    await f.runToEnd();
    assert.equal(f.people().length, 2);
    for (const child of f.people()) {
      assert.equal(child.input.workbookReferences, undefined);
      assert.deepEqual(f.nodeSpans(child, "reference-fields-start"), [["skipped", "condition-false"]]);
      assert.deepEqual(f.checkLines(child), []);
    }
    assert.equal(I9CheckStartResultSchema.parse(f.database.authority.runResults.get(f.run.envelope.runId)?.result.value).personCount, 2);
  });

  it("i9-check/reference-check — reads once after the delegated lookup, compares earlier fields and waits for the differing name", async () => {
    const f = await fixture({ checks: [ROSTER, BADGES] });
    await f.runToEnd();
    const parked = f.people().find(child => child.lifecycle.state === "parked-gate");
    assert.ok(parked?.lifecycle.state === "parked-gate");
    assert.equal(parked.lifecycle.gateId, "reference-field-review-reference-person-lookup");
    assert.equal(await f.cardContext(parked), `Hires, row 3 · Legal name: spreadsheet “${ROW_ONLY_NAME}”, workflow “Example, Blair”`);
    const lookups = f.database.authority.runs.listChildren(parked.envelope.runId);
    assert.equal(lookups.length, 1);
    assert.equal(lookups[0]?.envelope.workflow, "person-lookup");
    assert.equal(lookups[0]?.input.workbookReferences, undefined);
    assert.deepEqual(f.fieldReads.filter(read => read.runId === parked.envelope.runId), [{ runId: parked.envelope.runId, key: "10000002" }]);
    assert.equal(f.savedResults(), 0);
    assert.equal(f.canonical.kernel.execute({ commandId: randomUUID(), requestedAt: f.clock.now().toISOString(),
      requestedBy: "local-operator", source: "dashboard", family: "gate", type: "resolve-gate",
      target: { runId: parked.envelope.runId, gateId: parked.lifecycle.gateId, expectedVersion: parked.version },
      payload: { result: { schemaHash: deriveSchemaHash(ReferenceReviewSchema, "output"), value: { decision: "continue" } } },
    }).state, "applied");
    const settled = (await f.canonical.execute(f.run, new AbortController().signal)).run;
    assert.ok(settled?.lifecycle.state === "terminal" && settled.lifecycle.outcome === "done");
    assert.equal(f.fieldReads.length, 2);
    for (const child of f.people()) {
      const typeIds = (child.input.workbookReferences ?? []).map(bound => parseRunWorkbookReference(bound).request.typeId);
      assert.deepEqual(typeIds, [REFERENCE_CHECK_ID, REFERENCE_CHECK_ID], "a person child gets the extra picks, never the required roster");
      assert.equal(child.lifecycle.state === "terminal" && child.lifecycle.outcome, "done");
    }
    for (const document of f.database.authority.runs.listChildren(f.run.envelope.runId).filter(child => child.envelope.workflow === "ocr")) {
      assert.equal(document.input.workbookReferences, undefined, "OCR declares no second check");
    }
    assert.deepEqual(f.linesByPerson(), {
      "10000001": ["Hires, row 2: Legal name matches", "Hires, row 2: Date of Birth matches", "Hires, row 2: Employee ID matches", "Issued, row 2: Employee ID matches"],
      "10000002": ["Not in Issued", "Hires, row 3: Date of Birth matches", "Hires, row 3: Employee ID matches", "Hires, row 3: Legal name differs"],
    });
    const output = I9CheckStartResultSchema.parse(f.database.authority.runResults.get(f.run.envelope.runId)?.result.value);
    assert.deepEqual(output.tracker.rows.map(row => [row.ucpathEmplId, row.action]), [["10000001", "Keep"], ["10000002", "Keep"]]);
    assert.equal(f.savedResults(), 1);
    assert.equal(JSON.stringify(f.people().map(child => f.events(child))).includes(ROW_ONLY_NAME), false);
  });

  it("compares the earlier DOB at lookup and stops a dry run at the later Action History separation date", async () => {
    const f = await fixture({ dryRun: true, checks: [{ ...ROSTER, fields: ["eid", "dob", "separationDate"],
      rows: [["10000001", "2000-01-15", "2024-01-01"], ["10000002", "2000-01-15", "2024-01-02"]] }] });
    await f.runToEnd();
    const parked = f.people().find(child => child.lifecycle.state === "parked-gate");
    assert.ok(parked?.lifecycle.state === "parked-gate");
    assert.equal(parked.lifecycle.gateId, "reference-field-review-retention-row");
    assert.equal(await f.cardContext(parked), "Hires, row 3 · Separation Date: spreadsheet “2024-01-02”, workflow “2024-01-01”");
    assert.deepEqual(f.checkLines(parked), ["Hires, row 3: Date of Birth matches", "Hires, row 3: Employee ID matches", "Hires, row 3: Separation Date differs"]);
    assert.deepEqual(f.fieldReads.filter(read => read.runId === parked.envelope.runId), [{ runId: parked.envelope.runId, key: "10000002" }]);
    assert.equal(f.savedResults(), 0);
  });

  it.each([["none", "not-found"], ["multiple", "multiple-matches"]] as const)(
    "finishes when the delegated lookup returns %s and logs that there was no key",
    async (nameSearch, outcome) => {
      const f = await fixture({ nameSearch, checks: [ROSTER] });
      const settled = await f.runToEnd();
      assert.ok(settled?.lifecycle.state === "terminal" && settled.lifecycle.outcome === "done");
      assert.equal(f.people().length, 2);
      for (const child of f.people()) {
        assert.ok(child.lifecycle.state === "terminal" && child.lifecycle.outcome === "done");
        const [lookup] = f.database.authority.runs.listChildren(child.envelope.runId);
        assert.ok(lookup?.envelope.workflow === "person-lookup");
        const result = PersonLookupResultSchema.parse(f.database.authority.runResults.get(lookup.envelope.runId)?.result.value);
        assert.equal(result.activeStatus.state, outcome);
        assert.deepEqual(f.checkLines(child), ["Reference not checked: no Employee ID"]);
        assert.deepEqual(f.database.authority.gateResults.listByRun(child.envelope.runId), []);
      }
      assert.deepEqual(f.fieldReads, []);
    },
  );

  it("continues a dry run with missing rows", async () => {
    const f = await fixture({ dryRun: true, checks: [BADGES] });
    await f.runToEnd();
    assert.deepEqual(f.linesByPerson(), { "10000001": ["Issued, row 2: Employee ID matches"], "10000002": ["Not in Issued"] });
    assert.equal(f.savedResults(), 0);
  });
});
