import assert from "node:assert/strict";
import { describe,it } from "vitest";
import type { UcpathPersonSelection } from "../../../../src/models/systems/ucpath/search-person-org.js";
import type { UcpathJobRow,UcpathJobSummary } from "../../../../src/models/ui/ucpath-job-summary.js";
import { UcpathJobSummarySchema } from "../../../../src/models/ui/ucpath-job-summary.js";
import { EidSchema,IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { noSeparationWritePlan } from "../../../../src/rules/separations/write-plan.js";
import type { DataPoint } from "../../../../src/rules/workflow/task-provenance.js";
import { matchIdentityTask } from "../../../../src/workflows/separations/tasks/match-identity.js";

const DOCUMENT = "4444";
const EID = EidSchema.parse("10800000");
const OTHER_EID = EidSchema.parse("10800001");
const NAME = "Person, Deterministic";
const NOW = IsoInstantSchema.parse("2026-08-14T19:00:00.000Z");

class TaskRefusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function taskContext() {
  const records: DataPoint[] = [];
  const ctx = {
    signal: new AbortController().signal,
    log: Object.freeze({ debug: () => undefined, info: () => undefined, warn: () => undefined }),
    fail: (code: string, message: string): never => {
      throw new TaskRefusal(code, message);
    },
    recordData(input: DataPoint | readonly DataPoint[]): void {
      records.push(...(Array.isArray(input) ? input : [input]) as DataPoint[]);
    },
  };
  return { ctx: ctx as never, records };
}

function assertRecordedOutput(records: readonly DataPoint[], output: object): void {
  const entries = Object.entries(output);
  assert.deepEqual(records.map(({ direction, field }) => ({ direction, field })), entries.map(([field]) => ({
    direction: "read",
    field,
  })));
  assert.deepEqual(Object.fromEntries(records.map(({ field, value }) => [field, value])), output);
}

function cell(value: string) {
  return { state: "present" as const, value };
}

function absentCell(reason: string) {
  return { state: "absent" as const, reason };
}

function jobRow(overrides: Partial<UcpathJobRow> = {}): UcpathJobRow {
  return {
    rowIndex: 0,
    emplRecord: "0",
    hrStatus: "Active",
    businessUnit: "SDCMP",
    effectiveDate: cell("07/01/2025"),
    positionNumber: cell("40012345"),
    deptId: cell("000412"),
    department: cell("HOUSING/DINING/HOSPITALITY"),
    jobCode: cell("004921"),
    jobTitle: cell("STDT 2"),
    expectedJobEndDate: absentCell("the grid rendered this cell empty"),
    fte: cell("0.500000"),
    emplClass: cell("Student"),
    ...overrides,
  };
}

function jobSummary(rows: readonly UcpathJobRow[] = [jobRow()], emplId = EID): UcpathJobSummary {
  return UcpathJobSummarySchema.parse({
    pageStateId: "ucpath.person-org.detail-ready",
    emplId,
    displayedName: NAME,
    jobRows: [...rows],
    rowCount: rows.length,
    renderContext: {
      entry: "auto-detail",
      searchResultRows: 0,
      employmentInstances: "already-complete",
    },
    observedAt: NOW,
  });
}

const nameSelection: UcpathPersonSelection = {
  status: "resolved",
  selected: {
    emplId: EID,
    name: NAME,
    department: "Housing Dining Hospitality",
    jobTitle: "STDT 2",
    employeeStatus: "active",
    hdh: true,
  },
  candidateEids: [EID],
};

const writePlan = noSeparationWritePlan("this focused unit composes no separation write plan");

function identityInput() {
  return {
    documentNumber: DOCUMENT,
    documentName: NAME,
    documentEid: { state: "present" as const, value: EID },
    emplId: EID,
    emplIdSource: "document-eid" as const,
    jobSummary: jobSummary(),
    nameSelection,
    plan: writePlan,
  };
}

async function expectRefusal(run: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(run, (error: unknown) => error instanceof TaskRefusal && error.code === code);
}

describe("separations workflow task wrappers", () => {

  it("records the identity packet and names both wrapper refusals", async () => {
    const success = taskContext();
    const output = await matchIdentityTask.impl.run({
      input: identityInput(),
      ctx: success.ctx,
    });
    assert.deepEqual({
      documentNumber: output.packet.documentNumber,
      emplId: output.packet.emplId,
      emplIdSource: output.packet.emplIdSource,
      documentEidText: output.packet.documentEidText,
      documentName: output.packet.documentName,
      ucpathName: output.packet.ucpathName,
      nameTier: output.packet.nameTier,
      nameSearch: output.packet.nameSearch,
      jobs: output.packet.jobs,
      plan: output.packet.plan,
      approvableEids: output.packet.approvableEids,
      approvalShape: output.packet.approvalShape,
      observedAt: output.packet.observedAt,
      comparisonDecisions: output.packet.comparisons.map(({ field, agrees }) => [field, agrees]),
    }, {
      documentNumber: DOCUMENT,
      emplId: EID,
      emplIdSource: "document-eid",
      documentEidText: EID,
      documentName: NAME,
      ucpathName: NAME,
      nameTier: "same",
      nameSearch: {
        status: "resolved",
        candidate: {
          eid: EID,
          name: NAME,
          department: "Housing Dining Hospitality",
          jobTitle: "STDT 2",
          employeeStatus: "active",
        },
        candidateEids: [EID],
      },
      jobs: {
        disposition: "single-active-job",
        rowCount: 1,
        activeRowCount: 1,
        inactiveRowCount: 0,
        unknownRowCount: 0,
        rows: [{
          rowIndex: 0,
          emplRecord: "0",
          hrStatus: "Active",
          tier: "active",
          department: "HOUSING/DINING/HOSPITALITY",
          jobTitle: "STDT 2",
          effectiveDate: "07/01/2025",
        }],
        unreadableCells: ["row 0 (empl record 0): Expected Job End Date"],
      },
      plan: writePlan,
      approvableEids: [EID],
      approvalShape: "one-click",
      observedAt: NOW,
      comparisonDecisions: [["name", true], ["eid", true], ["employment", true], ["name-search", true]],
    });
    assert.match(output.evidenceDigest, /^[0-9a-f]{64}$/u);
    assertRecordedOutput(success.records, output);

    const subjectMismatch = taskContext();
    await expectRefusal(() => matchIdentityTask.impl.run({
      input: { ...identityInput(), jobSummary: jobSummary([jobRow()], OTHER_EID) },
      ctx: subjectMismatch.ctx,
    }), "identity-subject-mismatch");
    assert.deepEqual(subjectMismatch.records, []);

    const sourceMismatch = taskContext();
    await expectRefusal(() => matchIdentityTask.impl.run({
      input: { ...identityInput(), emplIdSource: "name-resolved" },
      ctx: sourceMismatch.ctx,
    }), "identity-source-inconsistent");
    assert.deepEqual(sourceMismatch.records, []);
  });
});
