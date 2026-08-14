/**
 * The three folds the COMPOSITION needs and no chunk owned: which person the
 * separation is about (S18/S19), which employment it is filed against
 * (S23/S24), and whether the UCPath receipt may be written onto the Kuali
 * document (D130).
 *
 * Each is a decision legacy makes somewhere else or not at all:
 *
 * - the subject fork is legacy's conditional person-lookup delegation, which §5
 *   item 10's answer replaces with an inline resolution handed to the gate;
 * - the employment selection is legacy's two THROWS inside its Job Summary page
 *   module, which D201 moved out of the read and this fold turns into refusals;
 * - the receipt check is nowhere in legacy — its `interpretPostSubmitTxnReadback`
 *   tests only `/^T\d{6,}$/`, which is exactly why D130 exists.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { EidSchema } from "../../src/domain/ids.js";
import { selectSeparationEmployment } from "../../src/domain/separations/employment-selection.js";
import { resolveSeparationSubject } from "../../src/domain/separations/separation-subject.js";
import { verifyTerminationReceipt } from "../../src/domain/separations/termination-receipt.js";
import type { UcpathPersonSelection } from "../../src/domain/contracts/ucpath/search-person-org.js";
import type { KualiEidField } from "../../src/domain/ui/kuali-separation-document.js";
import type { UcpathJobRow } from "../../src/domain/ui/ucpath-job-summary.js";
import type { UcpathTerminationProof } from "../../src/domain/ui/ucpath-smart-hr-termination.js";

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

describe("the separation SUBJECT fork (S18/S19)", () => {
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
    // `deriveApprovalShape` turns `name-resolved` into a `type-the-eid` gate,
    // which is the whole safety property: an EID nobody wrote on the form can
    // never be approved by one click.
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
    // The disagreement is not resolved here — it is the packet's job to show it
    // (`documentEidConflicts`, and the `name-search` comparison row). This fold
    // only says which EID the run is CHECKING.
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

describe("the EMPLOYMENT selection (S23/S24)", () => {
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

  it("refuses an unreadable job code or title, because both are STAGED into Kuali (S24)", () => {
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

describe("the termination RECEIPT check (D130)", () => {
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

  it("REFUSES a Denied receipt, which is the whole of D130", () => {
    // The live proof: `T002204014` is a perfectly well-formed T-number on a
    // transaction UCPath refused. It reaches here through the `already-present`
    // arm — `ucpathTerminationVerdict` returns whatever status the row carried.
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
    // UCPath's own schema is `T\d{6,}`; the Kuali *Transaction Number* control
    // is `T\d{6,12}`. The two genuinely disagree, and truncating would file a
    // number that names no transaction.
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
