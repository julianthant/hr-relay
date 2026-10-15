
import assert_m0 from "node:assert/strict";
import { describe as describe_m0,it as it_m0 } from "vitest";
import type { UcpathPersonSelection as UcpathPersonSelection_m0 } from "../../../src/models/systems/ucpath/search-person-org.js";
import type { KualiEidField as KualiEidField_m0 } from "../../../src/models/ui/kuali-separation-document.js";
import type { UcpathTerminationProof as UcpathTerminationProof_m0 } from "../../../src/models/ui/ucpath-smart-hr-termination.js";
import { EidSchema as EidSchema_m0 } from "../../../src/rules/identity/ids.js";
import { resolveSeparationSubject as resolveSeparationSubject_m0 } from "../../../src/rules/separations/separation-subject.js";
import { verifyTerminationReceipt as verifyTerminationReceipt_m0 } from "../../../src/rules/separations/termination-receipt.js";

import assert_m1 from "node:assert/strict";
import { describe as describe_m1,it as it_m1 } from "vitest";
import { assertTerminationReceipt as assertTerminationReceipt_m1 } from "../../../src/rules/separations/termination-receipt.js";


{


const DOCUMENT_EID = EidSchema_m0.parse("10873698");
const OTHER_EID = EidSchema_m0.parse("10401814");
const noCell = (reason: string) => ({ state: "absent" as const, reason });
const eidCell = (value: string): KualiEidField_m0 =>
  ({ state: "present", value: EidSchema_m0.parse(value) });

const CANDIDATE = {
  emplId: OTHER_EID,
  name: "Hernandez, Jose Santos",
  department: "Facilities",
  jobTitle: "Maintenance Worker",
  employeeStatus: "active" as const,
  hrStatus: 'Active', startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "",
hdh: false,
};

function proof(overrides: Partial<UcpathTerminationProof_m0> = {}): UcpathTerminationProof_m0 {
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
  documentEid: KualiEidField_m0,
  nameSelection: UcpathPersonSelection_m0,
) {
  return resolveSeparationSubject_m0({
    documentNumber: "4510",
    employeeName: "Battistessa, Johnnie",
    documentEid,
    nameSelection,
  });
}

describe_m0("the separation SUBJECT fork", () => {
  it_m0("takes the document's own EID and says so — the one-click-eligible shape", () => {
    const resolution = resolveSubject(eidCell(DOCUMENT_EID), {
      status: "resolved",
      selected: { ...CANDIDATE, emplId: DOCUMENT_EID },
      candidateEids: [DOCUMENT_EID],
    });
    assert_m0.equal(resolution.state, "resolved");
    if (resolution.state !== "resolved") return;
    assert_m0.equal(resolution.subject.emplId, DOCUMENT_EID);
    assert_m0.equal(resolution.subject.emplIdSource, "document-eid");
    assert_m0.equal(resolution.subject.candidateCount, 1);
  });

  it_m0("takes the NAME SEARCH when the document names nobody, and labels it so", () => {

    const resolution = resolveSubject(noCell("the EID control was empty"), {
      status: "resolved",
      selected: CANDIDATE,
      candidateEids: [OTHER_EID],
    });
    assert_m0.equal(resolution.state, "resolved");
    if (resolution.state !== "resolved") return;
    assert_m0.equal(resolution.subject.emplId, OTHER_EID);
    assert_m0.equal(resolution.subject.emplIdSource, "name-resolved");
  });

  it_m0("prefers the DOCUMENT's EID even when the name resolves somebody else", () => {

    const resolution = resolveSubject(eidCell(DOCUMENT_EID), {
      status: "resolved",
      selected: CANDIDATE,
      candidateEids: [OTHER_EID],
    });
    assert_m0.equal(resolution.state, "resolved");
    if (resolution.state !== "resolved") return;
    assert_m0.equal(resolution.subject.emplId, DOCUMENT_EID);
  });

  it_m0("refuses a blank EID whose name resolves nobody", () => {
    const resolution = resolveSubject(noCell("the EID control was empty"), {
      status: "not-found",
      selected: null,
      candidateEids: [],
      searchName: "Battistessa, Johnnie",
    });
    assert_m0.equal(resolution.state, "refused");
    if (resolution.state !== "refused") return;
    assert_m0.equal(resolution.code, "subject-not-resolvable");
  });
});

describe_m0("the termination RECEIPT check", () => {
  it_m0("accepts a Pending receipt — the ordinary state of a transaction just filed", () => {
    const verification = verifyTerminationReceipt_m0({
      proof: proof(),
      disposition: "committed",
      approvedEmplId: DOCUMENT_EID,
      expectedEffectiveDate: "06/20/2026",
    });
    assert_m0.equal(verification.state, "accepted");
    if (verification.state !== "accepted") return;
    assert_m0.equal(verification.receipt.transactionNumber, "T002209631");
    assert_m0.equal(verification.receipt.approvalStatus, "Pending");
  });

  it_m0("refuses a Denied termination receipt", () => {

    for (const status of ["Denied", "Error", "Pushed Back"] as const) {
      const verification = verifyTerminationReceipt_m0({
        proof: proof({ approvalStatus: status, transactionId: "T002204014" }),
        disposition: "already-present",
        approvedEmplId: DOCUMENT_EID,
        expectedEffectiveDate: "06/20/2026",
      });
      assert_m0.equal(verification.state, "refused", status);
      if (verification.state !== "refused") continue;
      assert_m0.equal(verification.code, "termination-not-in-effect");
    }
  });

  it_m0("accepts the two settled successes", () => {
    for (const status of ["Approved", "Manually Processed"] as const) {
      const verification = verifyTerminationReceipt_m0({
        proof: proof({ approvalStatus: status }),
        disposition: "already-present",
        approvedEmplId: DOCUMENT_EID,
        expectedEffectiveDate: "06/20/2026",
      });
      assert_m0.equal(verification.state, "accepted", status);
    }
  });

  it_m0("refuses a receipt about a different person or a different effective date", () => {
    const wrongPerson = verifyTerminationReceipt_m0({
      proof: proof({ emplId: OTHER_EID }),
      disposition: "already-present",
      approvedEmplId: DOCUMENT_EID,
      expectedEffectiveDate: "06/20/2026",
    });
    assert_m0.equal(wrongPerson.state, "refused");
    if (wrongPerson.state === "refused") {
      assert_m0.equal(wrongPerson.code, "termination-receipt-subject-mismatch");
    }

    const wrongDate = verifyTerminationReceipt_m0({
      proof: proof({ effectiveDate: "06/11/2026" }),
      disposition: "already-present",
      approvedEmplId: DOCUMENT_EID,
      expectedEffectiveDate: "06/20/2026",
    });
    assert_m0.equal(wrongDate.state, "refused");
    if (wrongDate.state === "refused") {
      assert_m0.equal(wrongDate.code, "termination-receipt-date-mismatch");
    }
  });

  it_m0("refuses a T-number UCPath accepts that the Kuali control cannot hold", () => {
    // UCPath accepts unbounded T-number digits; Kuali caps them at twelve, so incompatible values must refuse.
    const verification = verifyTerminationReceipt_m0({
      proof: proof({ transactionId: "T0022096311234" }),
      disposition: "committed",
      approvedEmplId: DOCUMENT_EID,
      expectedEffectiveDate: "06/20/2026",
    });
    assert_m0.equal(verification.state, "refused");
    if (verification.state !== "refused") return;
    assert_m0.equal(verification.code, "termination-receipt-unusable");
  });
});
}

{


describe_m1("separations omittable write steps", () => {

  it_m1("rebuilds a receipt from a typed number and status, and refuses what a live receipt would refuse", () => {
    const receipt = assertTerminationReceipt_m1({
      transactionNumber: "T002204014", approvalStatus: "Approved",
      approvedEmplId: "10800000", approvedName: "Deterministic Person", expectedEffectiveDate: "06/20/2026",
    });
    assert_m1.equal(receipt.disposition, "operator-asserted");
    assert_m1.equal(receipt.effectiveDate, "06/20/2026");
    assert_m1.throws(
      () => assertTerminationReceipt_m1({ transactionNumber: "2204014", approvalStatus: "Approved", approvedEmplId: "10800000", approvedName: "x", expectedEffectiveDate: "06/20/2026" }),
      /T followed by 6–12 digits/u,
    );
    assert_m1.throws(
      () => assertTerminationReceipt_m1({ transactionNumber: "T002204014", approvalStatus: "Denied", approvedEmplId: "10800000", approvedName: "x", expectedEffectiveDate: "06/20/2026" }),
      /termination-not-in-effect/u,
    );
  });
});
}
