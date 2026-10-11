import { FingerprintSchema } from "../../../src/rules/identity/ids.js";

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { deriveJobRowFromCells } from "../../../src/backend/systems/ucpath/driver/person-org-operation.js";
import { IdentityApprovalResultSchema, verifyIdentityApproval } from "../../../src/rules/separations/identity-approval.js";
import { type IdentityEvidencePacket } from "../../../src/rules/separations/identity-evidence.js";
import { buildIdentityEvidencePacket, deriveIdentityEvidenceDigest } from "../../../src/rules/separations/identity-evidence.js";
import { SeparationWritePlanSchema } from "../../../src/rules/separations/write-plan.js";
import { uuidOf } from "../../support/helpers/backend/dashboard-harness.js";
const EID = "10873698";
const GATE_NOW = "2026-08-14T18:00:00.000Z";

function packetWithPlan(): IdentityEvidencePacket {
  const rows = [deriveJobRowFromCells([
    "0", "07/01/2025", "Active", "SDCMP", "40012345", "000412",
    "HOUSING/DINING/HOSPITALITY", "004921", "STDT 2", "", "0.500000", "Student",
  ], 0)];
  return buildIdentityEvidencePacket({
    documentNumber: "4510",
    documentName: "Battistessa, Johnnie",
    documentEidText: "blank (the document supplied no EID)",
    emplIdSource: "name-resolved",
    documentEidConflicts: false,
    jobSummary: {
      pageStateId: "ucpath.person-org.detail-ready",
      emplId: EID as never,
      displayedName: "Battistessa, Johnnie",
      jobRows: rows,
      rowCount: rows.length,
      renderContext: { entry: "auto-detail", searchResultRows: 0, employmentInstances: "already-complete" },
      observedAt: GATE_NOW as never,
    },
    nameSelection: {
      status: "resolved",
      selected: {
        emplId: EID as never,
        name: "Battistessa, Johnnie",
        department: "Housing Dining Hospitality",
        jobTitle: "STDT 2",
        employeeStatus: "active",
        hdh: true,
      },
      candidateEids: [EID as never],
    },
    plan: SeparationWritePlanSchema.parse({
      state: "planned",
      termination: {
        terminationType: "Graduated/No longer a Student",
        classification: "involuntary",
        template: "UC_INVOL_TERM",
        reasonCode: "No Longer Student",
        emplRecord: "0",
        effectiveDate: "06/20/2026",
        lastDateWorked: "06/12/2026",
        initiatorComments: "Termination eff 06/20/2026. Last Day Worked 06/12/2026. "
          + "Holiday Pay on 06/19/2026. Kuali form #4510.",
      },
      document: {
        documentNumber: "4510",
        department: "000412 - Housing/Dining/Hospitality",
        departmentCode: "000412",
        ucpathDepartment: "HOUSING/DINING/HOSPITALITY",
        payrollTitleCode: "004921",
        payrollTitle: "STDT 2",
        terminationEffectiveDate: "06/20/2026",
        timekeeperName: { kind: "protected-store", inputPath: "timekeeperName", name: "timekeeperName", valueId: uuidOf(91) },
      },
      dates: {
        kualiLastDayWorked: "06/12/2026",
        lastDayWorked: "06/12/2026",
        lastDayWorkedChanged: false,
        kualiSeparationDate: "06/12/2026",
        separationDate: "06/19/2026",
        separationDateChanged: true,
        separationDeterminingLeave: "holiday",
        unclassifiedPayCodes: ["Independence Day Observed", "Juneteenth Observed"],
        source: "kronos-timesheet",
      },
    }),
  });
}

describe("separations — the identity-gate wire", () => {

  it("binds approval to retained value identity and keeps protected bytes and invalid digests private", () => {
    const packet = packetWithPlan();
    assert.equal(JSON.stringify(packet).includes("Julian Zaw"), false);
    assert.equal(packet.plan.state, "planned");
    if (packet.plan.state !== "planned") throw new Error("fixture must carry a plan");
    const plannedPacket = packet.plan;
    const bind = (valueId: string) => ({ ...packet, plan: SeparationWritePlanSchema.parse({
      ...plannedPacket,
      document: { ...plannedPacket.document, timekeeperName: {
        kind: "protected-store", name: "timekeeperName", inputPath: "timekeeperName", valueId,
      } },
    }) });
    const first = bind(uuidOf(40));
    const rotated = bind(uuidOf(41));
    const digest = deriveIdentityEvidenceDigest(first);
    assert.notEqual(digest, deriveIdentityEvidenceDigest(rotated));
    const result = IdentityApprovalResultSchema.parse({ decision: "approved", eid: first.emplId,
      chosenFrom: "checked", evidenceDigest: digest });
    assert.equal(verifyIdentityApproval(first, result).state, "approved");
    assert.equal(verifyIdentityApproval(rotated, result).state, "refused");
    const invalidDigest = FingerprintSchema.parse("e".repeat(64));
    const refusal = verifyIdentityApproval(first, result, invalidDigest);
    assert.equal(refusal.state, "refused");
    assert.equal(JSON.stringify(refusal).includes(invalidDigest.slice(0, 12)), false);
  });
});
