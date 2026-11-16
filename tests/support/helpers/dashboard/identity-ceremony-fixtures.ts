

import { deriveJobRowFromCells } from "../../../../src/backend/systems/ucpath/driver/person-org-operation.js";

import {
type IdentityGateDetail
} from "../../../../src/dashboard/surfaces/run-detail/identity/identity-ceremony.js";
import type { CommandAction } from "../../../../src/dashboard/app/commands/command-dispatch.js";
import { identityReviewWire } from "./identity-review-wire.js";
import type { ActionDescriptorWire } from "../../../../src/models/dashboard/actions.js";



import type { IdentityEvidencePacket } from "../../../../src/rules/separations/identity-evidence.js";
import {
buildIdentityEvidencePacket,
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
    const { actions, ...rest } = overrides;
    return identityReviewWire(packet, {
      runId: runId(1),
      label: "Identity Approval",
      parkedAt: NOW,
      expectedVersion: 3,
      actions: (actions as ActionDescriptorWire[] | undefined) ?? [identityApprovalAction("Approve the chosen person")],
      overrides: rest,
    });
  }
  return { jobRows, packetOf, ONE_CLICK, CHOOSE, NAME_MISMATCH, gateDetail };
}
