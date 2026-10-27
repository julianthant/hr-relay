

import { deriveJobRowFromCells } from "../../../../src/backend/systems/ucpath/driver/person-org-operation.js";

import {
type IdentityGateDetail
} from "../../../../src/dashboard/surfaces/run-detail/identity/identity-ceremony.js";
import type { CommandAction } from "../../../../src/dashboard/app/commands/command-dispatch.js";
import { IdentityGateDetailWireSchema } from "../../../../src/models/dashboard/run-detail.js";



import type { IdentityEvidencePacket } from "../../../../src/rules/separations/identity-evidence.js";
import {
buildIdentityEvidencePacket,
deriveIdentityEvidenceDigest,
} from "../../../../src/rules/separations/identity-evidence.js";
import { noSeparationWritePlan } from "../../../../src/rules/separations/write-plan.js";

export function identityApprovalAction(label: string): CommandAction {
  return {
    key: "resolve-gate-approved",
    label,
    intent: "primary",
    placement: ["banner"],
    kind: "command",
    command: "resolve-gate",
    expectedVersion: 3,
    resolution: "approved",
  };
}

export function createIdentityCeremonyFixtures(
  NOW: string,
  CHECKED: string,
  NAME_SEARCH: string,
  RESULT_SCHEMA_HASH: string,
  runId: (n: number) => string,
) {
  function jobRows() {
    return [deriveJobRowFromCells([
      "0", "07/01/2025", "Active", "SDCMP", "40012345", "000414",
      "Housing Dining Hospitality", "004920", "STDT 3", "", "0.500000", "Student",
    ], 0)];
  }

  function packetOf(input: {
    readonly documentName: string;
    readonly searchResolvesEid: string;
  }): IdentityEvidencePacket {
    const rows = jobRows();
    return buildIdentityEvidencePacket({
      documentNumber: "4510",
      documentName: input.documentName,
      documentEidText: CHECKED,
      emplIdSource: "document-eid",
      documentEidConflicts: false,
      jobSummary: {
        pageStateId: "ucpath.person-org.detail-ready",
        emplId: CHECKED as never,
        displayedName: "Hernandez, Jose Santos",
        jobRows: rows,
        rowCount: rows.length,
        renderContext: { entry: "auto-detail", searchResultRows: 0, employmentInstances: "already-complete" },
        observedAt: NOW as never,
      },
      nameSelection: {
        status: "resolved",
        selected: {
          emplId: input.searchResolvesEid as never,
          name: input.searchResolvesEid === CHECKED ? "Hernandez, Jose Santos" : "Hernandez, Jose",
          department: "Housing Dining Hospitality",
          jobTitle: "STDT 3",
          employeeStatus: "active",
          hrStatus: 'Active', startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "",
hdh: true,
        },
        candidateEids: [input.searchResolvesEid as never],
      },
      plan: noSeparationWritePlan("this fixture composes no separation write plan"),
    });
  }

  const ONE_CLICK = packetOf({ documentName: "Hernandez, Jose Santos", searchResolvesEid: CHECKED });

  const CHOOSE = packetOf({ documentName: "Hernandez, Jose Santos", searchResolvesEid: NAME_SEARCH });

  const NAME_MISMATCH = packetOf({ documentName: "Okonkwo, Adaeze", searchResolvesEid: NAME_SEARCH });

  function gateDetail(packet: IdentityEvidencePacket, overrides: Record<string, unknown> = {}): IdentityGateDetail {
    const nameSearchEid = packet.nameSearch.status === "resolved" ? packet.nameSearch.candidate.eid : undefined;
    return IdentityGateDetailWireSchema.parse({
      runId: runId(1),
      gateId: "identity-approval",
      label: "Identity Approval",
      parkedAt: NOW,
      resumeAt: "approval",
      expectedVersion: 3,
      resultSchemaHash: RESULT_SCHEMA_HASH,
      evidenceDigest: deriveIdentityEvidenceDigest(packet),
      packet,

      options: packet.approvableEids.map((eid) => ({
        eid: String(eid),
        chosenFrom: String(eid) === String(packet.emplId)
          ? "checked"
          : String(eid) === String(nameSearchEid) ? "name-search" : "manual",
        displayName: String(eid) === String(packet.emplId) ? packet.ucpathName : `EID ${String(eid)}`,
        origin: "a UCPath search on the document's name listed this EID",
      })),
      approvalShape: packet.approvalShape,
      actions: [identityApprovalAction("Approve the chosen EID")],
      ...overrides,
    });
  }
  return { jobRows, packetOf, ONE_CLICK, CHOOSE, NAME_MISMATCH, gateDetail };
}
