
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { EidSchema } from "../../../../../src/rules/identity/ids.js";
import { directIdentifierDisplay } from "../../../../../src/rules/redaction/redaction.js";
import { selectSeparationEmployment } from "../../../../../src/rules/separations/employment-selection.js";
import { resolveSeparationSubject } from "../../../../../src/rules/separations/separation-subject.js";
import { verifyTerminationReceipt } from "../../../../../src/rules/separations/termination-receipt.js";
import type { UcpathPersonSelection } from "../../../../../src/models/systems/ucpath/search-person-org.js";
import type { KualiEidField } from "../../../../../src/models/ui/kuali-separation-document.js";
import type { UcpathJobRow } from "../../../../../src/models/ui/ucpath-job-summary.js";
import type { UcpathTerminationProof } from "../../../../../src/models/ui/ucpath-smart-hr-termination.js";

const DOCUMENT_EID = EidSchema.parse("10873698");
const OTHER_EID = EidSchema.parse("10401814");

const cell = (value: string) => ({ state: "present" as const, value });
const noCell = (reason: string) => ({ state: "absent" as const, reason });
const eidCell = (value: string): KualiEidField =>
  ({ state: "present", value: EidSchema.parse(value) });

const CANDIDATE = {
  emplId: OTHER_EID,
  name: "Hernandez, Jose Santos",
  department: "Facilities",
  jobTitle: "Maintenance Worker",
  employeeStatus: "active" as const,
  hdh: false,
};

function row(overrides: Partial<UcpathJobRow> = {}): UcpathJobRow {
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
    expectedJobEndDate: noCell("the grid rendered this cell empty"),
    fte: cell("0.500000"),
    emplClass: cell("Student"),
    ...overrides,
  };
}

function proof(overrides: Partial<UcpathTerminationProof> = {}): UcpathTerminationProof {
  return {
    kind: "ucpath-termination",
    emplId: DOCUMENT_EID,
    effectiveDate: "06/20/2026",
    transactionId: "T002209631",
    approvalStatus: "Pending",
    displayedName: "Battistessa, Johnnie",
    source: "ss-smart-hr-detail-read",
    ...overrides,
  };
}

function resolveSubject(
  documentEid: KualiEidField,
  nameSelection: UcpathPersonSelection,
) {
  return resolveSeparationSubject({
    documentNumber: "4510",
    employeeName: "Battistessa, Johnnie",
    documentEid,
    nameSelection,
  });
}

describe("the separation SUBJECT fork", () => {
  it("takes the document's own EID and says so — the one-click-eligible shape", () => {
    const resolution = resolveSubject(eidCell(DOCUMENT_EID), {
      status: "resolved",
      selected: { ...CANDIDATE, emplId: DOCUMENT_EID },
      candidateEids: [DOCUMENT_EID],
    });
    assert.equal(resolution.state, "resolved");
    if (resolution.state !== "resolved") return;
    assert.equal(resolution.subject.emplId, DOCUMENT_EID);
    assert.equal(resolution.subject.emplIdSource, "document-eid");
    assert.equal(resolution.subject.candidateCount, 1);
  });

  it("takes the NAME SEARCH when the document names nobody, and labels it so", () => {

    const resolution = resolveSubject(noCell("the EID control was empty"), {
      status: "resolved",
      selected: CANDIDATE,
      candidateEids: [OTHER_EID],
    });
    assert.equal(resolution.state, "resolved");
    if (resolution.state !== "resolved") return;
    assert.equal(resolution.subject.emplId, OTHER_EID);
    assert.equal(resolution.subject.emplIdSource, "name-resolved");
  });

  it("prefers the DOCUMENT's EID even when the name resolves somebody else", () => {

    const resolution = resolveSubject(eidCell(DOCUMENT_EID), {
      status: "resolved",
      selected: CANDIDATE,
      candidateEids: [OTHER_EID],
    });
    assert.equal(resolution.state, "resolved");
    if (resolution.state !== "resolved") return;
    assert.equal(resolution.subject.emplId, DOCUMENT_EID);
  });

  it("refuses a blank EID whose name resolves several people, naming them", () => {
    const resolution = resolveSubject(noCell("the EID control was empty"), {
      status: "ambiguous",
      selected: null,
      candidateEids: [DOCUMENT_EID, OTHER_EID],
      searchName: "Battistessa, Johnnie",
    });
    assert.equal(resolution.state, "refused");
    if (resolution.state !== "refused") return;
    assert.equal(resolution.code, "subject-ambiguous");
    assert.match(
      resolution.reason,
      new RegExp(`${directIdentifierDisplay(DOCUMENT_EID)}, ${directIdentifierDisplay(OTHER_EID)}`, "u"),
    );
    assert.match(resolution.reason, /10873698, 10401814/u);
  });

  it("refuses a blank EID whose name resolves nobody", () => {
    const resolution = resolveSubject(noCell("the EID control was empty"), {
      status: "not-found",
      selected: null,
      candidateEids: [],
      searchName: "Battistessa, Johnnie",
    });
    assert.equal(resolution.state, "refused");
    if (resolution.state !== "refused") return;
    assert.equal(resolution.code, "subject-not-resolvable");
  });
});

describe("the EMPLOYMENT selection", () => {
  it("selects the single active row and passes its dept cells through untouched", () => {
    const selection = selectSeparationEmployment([
      row({ rowIndex: 0, emplRecord: "1", hrStatus: "Terminated" }),
      row({ rowIndex: 1, emplRecord: "0" }),
    ]);
    assert.equal(selection.state, "selected");
    if (selection.state !== "selected") return;
    assert.equal(selection.employment.emplRecord, "0");
    assert.equal(selection.employment.payrollTitleCode, "004921");
    assert.equal(selection.employment.payrollTitle, "STDT 2");
    assert.equal(selection.employment.rowCount, 2);
    // The department cells are NOT refused here — `match-department-option`
    // owns that refusal, and one fact with two durable codes is worse than one.
    assert.deepEqual(selection.employment.deptId, cell("000412"));
  });

  it("refuses no-active / concurrent / indeterminate, each by its own code", () => {
    for (const [code, rows] of [
      ["no-active-employment", [row({ hrStatus: "Terminated" })]],
      ["concurrent-active-employments", [row({ rowIndex: 0 }), row({ rowIndex: 1, emplRecord: "1" })]],
      ["indeterminate-employment-status", [row({ hrStatus: "Suspended-Pending Review" })]],
    ] as const) {
      const selection = selectSeparationEmployment(rows);
      assert.equal(selection.state, "refused", code);
      if (selection.state !== "refused") continue;
      assert.equal(selection.code, code);
    }
  });

  it("refuses an unreadable job code or title, because both are STAGED into Kuali", () => {
    for (const [code, overrides] of [
      ["payroll-title-code-unreadable", { jobCode: noCell("the grid rendered this cell empty") }],
      ["payroll-title-unreadable", { jobTitle: noCell("the grid rendered this cell empty") }],
    ] as const) {
      const selection = selectSeparationEmployment([row(overrides)]);
      assert.equal(selection.state, "refused", code);
      if (selection.state !== "refused") continue;
      assert.equal(selection.code, code);
    }
  });

  it("names the rows it refused over, verbatim, so the operator reads UCPath's own words", () => {
    const selection = selectSeparationEmployment([row({ hrStatus: "Terminated" })]);
    assert.equal(selection.state, "refused");
    if (selection.state !== "refused") return;
    assert.match(selection.reason, /empl record 0 — Terminated/u);
  });
});

describe("the termination RECEIPT check", () => {
  it("accepts a Pending receipt — the ordinary state of a transaction just filed", () => {
    const verification = verifyTerminationReceipt({
      proof: proof(),
      disposition: "committed",
      approvedEmplId: DOCUMENT_EID,
      expectedEffectiveDate: "06/20/2026",
    });
    assert.equal(verification.state, "accepted");
    if (verification.state !== "accepted") return;
    assert.equal(verification.receipt.transactionNumber, "T002209631");
    assert.equal(verification.receipt.approvalStatus, "Pending");
  });

  it("refuses a Denied termination receipt", () => {

    for (const status of ["Denied", "Error", "Pushed Back"] as const) {
      const verification = verifyTerminationReceipt({
        proof: proof({ approvalStatus: status, transactionId: "T002204014" }),
        disposition: "already-present",
        approvedEmplId: DOCUMENT_EID,
        expectedEffectiveDate: "06/20/2026",
      });
      assert.equal(verification.state, "refused", status);
      if (verification.state !== "refused") continue;
      assert.equal(verification.code, "termination-not-in-effect");
    }
  });

  it("accepts the two settled successes", () => {
    for (const status of ["Approved", "Manually Processed"] as const) {
      const verification = verifyTerminationReceipt({
        proof: proof({ approvalStatus: status }),
        disposition: "already-present",
        approvedEmplId: DOCUMENT_EID,
        expectedEffectiveDate: "06/20/2026",
      });
      assert.equal(verification.state, "accepted", status);
    }
  });

  it("refuses a receipt about a different person or a different effective date", () => {
    const wrongPerson = verifyTerminationReceipt({
      proof: proof({ emplId: OTHER_EID }),
      disposition: "already-present",
      approvedEmplId: DOCUMENT_EID,
      expectedEffectiveDate: "06/20/2026",
    });
    assert.equal(wrongPerson.state, "refused");
    if (wrongPerson.state === "refused") {
      assert.equal(wrongPerson.code, "termination-receipt-subject-mismatch");
    }

    const wrongDate = verifyTerminationReceipt({
      proof: proof({ effectiveDate: "06/11/2026" }),
      disposition: "already-present",
      approvedEmplId: DOCUMENT_EID,
      expectedEffectiveDate: "06/20/2026",
    });
    assert.equal(wrongDate.state, "refused");
    if (wrongDate.state === "refused") {
      assert.equal(wrongDate.code, "termination-receipt-date-mismatch");
    }
  });

  it("refuses a T-number UCPath accepts that the Kuali control cannot hold", () => {
    // UCPath accepts unbounded T-number digits; Kuali caps them at twelve, so incompatible values must refuse.
    const verification = verifyTerminationReceipt({
      proof: proof({ transactionId: "T0022096311234" }),
      disposition: "committed",
      approvedEmplId: DOCUMENT_EID,
      expectedEffectiveDate: "06/20/2026",
    });
    assert.equal(verification.state, "refused");
    if (verification.state !== "refused") return;
    assert.equal(verification.code, "termination-receipt-unusable");
  });
});
