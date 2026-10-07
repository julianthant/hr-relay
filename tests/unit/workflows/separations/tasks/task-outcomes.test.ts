import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { DataPoint } from "../../../../../src/rules/workflow/task-provenance.js";
import { DateOnlySchema, EidSchema, FingerprintSchema, IsoInstantSchema } from "../../../../../src/rules/identity/ids.js";
import type { UcpathJobRow, UcpathJobSummary } from "../../../../../src/models/ui/ucpath-job-summary.js";
import { UcpathJobSummarySchema } from "../../../../../src/models/ui/ucpath-job-summary.js";
import type { UcpathPersonSelection } from "../../../../../src/models/systems/ucpath/search-person-org.js";
import type { UcpathTerminationProof } from "../../../../../src/models/ui/ucpath-smart-hr-termination.js";
import { noSeparationWritePlan } from "../../../../../src/rules/separations/write-plan.js";
import { IdentityEvidencePacketSchema } from "../../../../../src/rules/separations/identity-evidence.js";
import { KUALI_TERMINATION_TYPE_OPTIONS } from "../../../../../src/rules/separations/termination-type.js";
import { matchActiveEmploymentTask } from "../../../../../src/workflows/separations/tasks/match-active-employment.js";
import { matchDepartmentOptionTask } from "../../../../../src/workflows/separations/tasks/match-department-option.js";
import { matchIdentityTask } from "../../../../../src/workflows/separations/tasks/match-identity.js";
import { matchSeparationSubjectTask } from "../../../../../src/workflows/separations/tasks/match-separation-subject.js";
import { matchTerminationTypeTask } from "../../../../../src/workflows/separations/tasks/match-termination-type.js";
import { readSeparationPlanTask } from "../../../../../src/workflows/separations/tasks/read-separation-plan.js";
import { verifyIdentityApprovalTask } from "../../../../../src/workflows/separations/tasks/verify-identity-approval.js";
import { verifyTerminationReceiptTask } from "../../../../../src/workflows/separations/tasks/verify-termination-receipt.js";

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

function assertExpectedOutput(
  records: readonly DataPoint[],
  output: object,
  expected: object,
): void {
  assert.deepEqual(output, expected);
  assertRecordedOutput(records, expected);
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

const LIVE_DEPARTMENT_OPTIONS = [
  "- - -",
  "000141 - Early Childhood Education Center",
  "000412 - Housing/Dining/Hospitality",
  "000414 - Bookstore",
  "000422 - Triton Print & Digital Media",
  "000719 -  Supply Chain Services",
];

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

function formDate(raw: string) {
  const [month, day, year] = raw.split("/");
  return {
    state: "present" as const,
    raw,
    value: DateOnlySchema.parse(year + "-" + month + "-" + day),
  };
}

function terminationProof(overrides: Partial<UcpathTerminationProof> = {}): UcpathTerminationProof {
  return {
    kind: "ucpath-termination",
    emplId: EID,
    effectiveDate: "06/20/2026",
    transactionId: "T009000001",
    approvalStatus: "Pending",
    displayedName: NAME,
    source: "ss-smart-hr-detail-read",
    ...overrides,
  };
}

const APPROVAL_EID = EidSchema.parse("10873698");
const APPROVAL_PACKET_JOBS = {
  disposition: "single-active-job" as const,
  rowCount: 1,
  activeRowCount: 1,
  inactiveRowCount: 0,
  unknownRowCount: 0,
  rows: [{
    rowIndex: 0,
    emplRecord: "0",
    hrStatus: "Active",
    tier: "active" as const,
    department: "Housing Dining Hospitality",
    jobTitle: "Dining Assistant",
    effectiveDate: "07/01/2025",
  }],
  unreadableCells: [],
};
const APPROVAL_PACKET = IdentityEvidencePacketSchema.parse({
  documentNumber: "4510",
  emplId: APPROVAL_EID,
  emplIdSource: "document-eid",
  documentEidText: "10873698",
  documentName: "Battistessa, Johnnie",
  ucpathName: "Battistessa, Johnnie",
  nameTier: "same",
  comparisons: [{
    field: "name",
    documentValue: "Battistessa, Johnnie",
    ucpathValue: "Battistessa, Johnnie",
    agrees: true,
    note: "the fixture names agree",
  }],
  nameSearch: {
    status: "resolved",
    candidate: {
      eid: APPROVAL_EID,
      name: "Battistessa, Johnnie",
      department: "Housing Dining Hospitality",
      jobTitle: "Dining Assistant",
      employeeStatus: "active",
    },
    candidateEids: [APPROVAL_EID],
  },
  jobs: APPROVAL_PACKET_JOBS,
  plan: { state: "not-composed", reason: "the sealed approval fixture composes no separation write plan" },
  approvableEids: [APPROVAL_EID],
  approvalShape: "one-click",
  observedAt: "2026-08-14T19:00:00.000Z",
});
// Fixed from this packet fixture's canonical JSON and SHA-256, not derived from a task output.
const APPROVAL_PACKET_DIGEST = FingerprintSchema.parse(
  "0377fa1d08d77585e03e2f6d9b5f2e8e312d849db69e5ffa18925a7beb8c5797",
);

async function expectRefusal(run: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(run, (error: unknown) => error instanceof TaskRefusal && error.code === code);
}

describe("separations workflow task wrappers", () => {
  it("records selected employment facts and keeps the named refusal", async () => {
    const success = taskContext();
    const output = await matchActiveEmploymentTask.impl.run({
      input: { documentNumber: DOCUMENT, jobSummary: jobSummary() },
      ctx: success.ctx,
    });
    assertExpectedOutput(success.records, output, {
      rowIndex: 0,
      emplRecord: "0",
      hrStatus: "Active",
      businessUnit: "SDCMP",
      deptId: cell("000412"),
      department: cell("HOUSING/DINING/HOSPITALITY"),
      payrollTitleCode: "004921",
      payrollTitle: "STDT 2",
      effectiveDate: cell("07/01/2025"),
      rowCount: 1,
    });

    const refusal = taskContext();
    await expectRefusal(() => matchActiveEmploymentTask.impl.run({
      input: {
        documentNumber: DOCUMENT,
        jobSummary: jobSummary([jobRow({ hrStatus: "Terminated" })]),
      },
      ctx: refusal.ctx,
    }), "no-active-employment");
    assert.deepEqual(refusal.records, []);
  });

  it("records the exact department option and refuses an option the control did not offer", async () => {
    const input = {
      documentNumber: DOCUMENT,
      deptId: cell("000412"),
      department: cell("HOUSING/DINING/HOSPITALITY"),
      observedOptions: LIVE_DEPARTMENT_OPTIONS,
    };
    const success = taskContext();
    const output = await matchDepartmentOptionTask.impl.run({ input, ctx: success.ctx });
    assertExpectedOutput(success.records, output, {
      option: "000412 - Housing/Dining/Hospitality",
      departmentCode: "000412",
      optionDescription: "Housing/Dining/Hospitality",
      ucpathDepartment: "HOUSING/DINING/HOSPITALITY",
      observedOptionCount: 6,
    });

    const refusal = taskContext();
    await expectRefusal(() => matchDepartmentOptionTask.impl.run({
      input: { ...input, deptId: cell("000999") },
      ctx: refusal.ctx,
    }), "department-code-not-offered");
    assert.deepEqual(refusal.records, []);
  });

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

  it("records the document EID and refuses an unresolved name-only subject", async () => {
    const success = taskContext();
    const output = await matchSeparationSubjectTask.impl.run({
      input: {
        documentNumber: DOCUMENT,
        employeeName: NAME,
        documentEid: { state: "present", value: EID },
        nameSelection,
      },
      ctx: success.ctx,
    });
    assertExpectedOutput(success.records, output, {
      emplId: EID,
      emplIdSource: "document-eid",
      searchedName: NAME,
      candidateCount: 1,
    });

    const refusal = taskContext();
    await expectRefusal(() => matchSeparationSubjectTask.impl.run({
      input: {
        documentNumber: DOCUMENT,
        employeeName: NAME,
        documentEid: { state: "absent", reason: "the EID control was empty" },
        nameSelection: {
          status: "not-found",
          selected: null,
          candidateEids: [],
          searchName: NAME,
        },
      },
      ctx: refusal.ctx,
    }), "subject-not-resolvable");
    assert.deepEqual(refusal.records, []);
  });

  it("records the termination mapping and refuses a blank selected type", async () => {
    const success = taskContext();
    const output = await matchTerminationTypeTask.impl.run({
      input: {
        documentNumber: DOCUMENT,
        terminationType: { state: "present", value: "Graduated/No longer a Student" },
        observedOptions: [...KUALI_TERMINATION_TYPE_OPTIONS],
      },
      ctx: success.ctx,
    });
    assertExpectedOutput(success.records, output, {
      terminationType: "Graduated/No longer a Student",
      classification: "involuntary",
      template: "UC_INVOL_TERM",
      reasonCode: "No Longer Student",
      observedOptionCount: 17,
    });

    const refusal = taskContext();
    await expectRefusal(() => matchTerminationTypeTask.impl.run({
      input: {
        documentNumber: DOCUMENT,
        terminationType: { state: "absent", reason: "the control was empty" },
        observedOptions: [...KUALI_TERMINATION_TYPE_OPTIONS],
      },
      ctx: refusal.ctx,
    }), "blank-termination-type");
    assert.deepEqual(refusal.records, []);
  });

  it("records the form plan and refuses a missing employee name", async () => {
    const input = {
      documentNumber: DOCUMENT,
      employeeName: { state: "present" as const, value: NAME },
      lastDayWorked: formDate("06/12/2026"),
      separationDate: formDate("06/12/2026"),
      observedAt: NOW,
    };
    const success = taskContext();
    const output = await readSeparationPlanTask.impl.run({ input, ctx: success.ctx });
    assertExpectedOutput(success.records, output, {
      documentNumber: DOCUMENT,
      employeeName: NAME,
      kualiLastDayWorked: "06/12/2026",
      kualiSeparationDate: "06/12/2026",
      asOfDate: "08/14/2026",
      timecardWindow: { start: "05/12/2026", end: "07/12/2026" },
    });

    const refusal = taskContext();
    await expectRefusal(() => readSeparationPlanTask.impl.run({
      input: { ...input, employeeName: { state: "absent", reason: "the control was empty" } },
      ctx: refusal.ctx,
    }), "employee-name-absent");
    assert.deepEqual(refusal.records, []);
  });

  it("verifies a sealed supplied-EID packet and refuses a moved digest", async () => {
    const success = taskContext();
    const output = await verifyIdentityApprovalTask.impl.run({
      input: { packet: APPROVAL_PACKET, evidenceDigest: APPROVAL_PACKET_DIGEST },
      ctx: success.ctx,
    });
    assertExpectedOutput(success.records, output, {
      documentNumber: "4510",
      approved: {
        authority: "machine-verification",
        source: "document-eid",
        emplId: APPROVAL_EID,
        evidenceDigest: APPROVAL_PACKET_DIGEST,
        ucpathName: "Battistessa, Johnnie",
        nameTier: "same",
      },
      jobs: APPROVAL_PACKET_JOBS,
    });

    const refusal = taskContext();
    await expectRefusal(() => verifyIdentityApprovalTask.impl.run({
      input: {
        packet: APPROVAL_PACKET,
        evidenceDigest: FingerprintSchema.parse("f".repeat(64)),
      },
      ctx: refusal.ctx,
    }), "identity-approval-evidence-moved");
    assert.deepEqual(refusal.records, []);
  });

  it("records a settled receipt pair and refuses a denied transaction", async () => {
    const input = {
      proof: terminationProof(),
      disposition: "committed" as const,
      approvedEmplId: EID,
      expectedEffectiveDate: "06/20/2026",
    };
    const success = taskContext();
    const output = await verifyTerminationReceiptTask.impl.run({ input, ctx: success.ctx });
    assertExpectedOutput(success.records, output, {
      transactionNumber: "T009000001",
      approvalStatus: "Pending",
      effectiveDate: "06/20/2026",
      emplId: EID,
      displayedName: NAME,
      disposition: "committed",
    });

    const refusal = taskContext();
    await expectRefusal(() => verifyTerminationReceiptTask.impl.run({
      input: { ...input, proof: terminationProof({ approvalStatus: "Denied" }) },
      ctx: refusal.ctx,
    }), "termination-not-in-effect");
    assert.deepEqual(refusal.records, []);
  });
});
