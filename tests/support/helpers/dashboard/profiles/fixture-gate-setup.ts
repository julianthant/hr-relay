import { identityReviewReason, identityReviewWire } from "../identity-review-wire.js";
import { IDENTITY_REVIEW_TEXT } from "../../../../../src/backend/runs/decisions/decision-catalog.js";
import { ActionDescriptorWireSchema } from "../../../../../src/models/dashboard/actions.js";
import type { IdentityGateDetailWire } from "../../../../../src/models/dashboard/run-detail.js";
import { buildIdentityEvidencePacket } from "../../../../../src/rules/separations/identity-evidence.js";
import type { IdentityEvidencePacket } from "../../../../../src/rules/separations/identity-evidence.js";
import { noSeparationWritePlan } from "../../../../../src/rules/separations/write-plan.js";
import { deriveJobRowFromCells } from "../../../../../src/backend/systems/ucpath/driver/person-org-operation.js";

export function createFixtureGateSetup() {
  const FIXTURE_GATE_CHECKED_EID = "10688204";

  function packetOf(input: Readonly<{ documentName: string; observedAt: string }>): IdentityEvidencePacket {
    const rows = [deriveJobRowFromCells([
      "0", "07/01/2025", "Active", "SDCMP", "40012345", "000414",
      "Housing Dining Hospitality", "004920", "STDT 3", "", "0.500000", "Student",
    ], 0)];
    return buildIdentityEvidencePacket({
      documentNumber: "4502",
      documentName: input.documentName,
      documentEidText: "the separation document carried no EID",
      emplIdSource: "name-resolved",
      documentEidConflicts: false,
      jobSummary: {
        pageStateId: "ucpath.person-org.detail-ready",
        emplId: FIXTURE_GATE_CHECKED_EID as never,
        displayedName: "Morrow, Bea",
        jobRows: rows,
        rowCount: rows.length,
        renderContext: { entry: "auto-detail", searchResultRows: 0, employmentInstances: "already-complete" },
        observedAt: input.observedAt as never,
      },
      nameSelection: {
        status: "resolved",
        selected: {
          emplId: FIXTURE_GATE_CHECKED_EID as never,
          name: "Morrow, Bea",
          department: "Facilities Management",
          jobTitle: "BLDG MAINT WORKER SR",
          employeeStatus: "active",
          hrStatus: 'Active', startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "",
hdh: false,
        },
        candidateEids: [FIXTURE_GATE_CHECKED_EID as never],
      },
      plan: noSeparationWritePlan(
        "this workflow reads an identity and files nothing, so it composes no separation write plan",
      ),
    });
  }

  function fixtureIdentityGateActions(
    packet: IdentityEvidencePacket,
    expectedVersion: number,
  ): unknown[] {
    const disagreements = packet.comparisons.filter(({ agrees }) => !agrees);
    return [
      {
        key: "resolve-gate-approved",
        label: packet.approvableEids.length === 1 ? "Approve this person" : "Approve the chosen person",
        detail: packet.approvableEids.length > 1
          ? "Choose which candidate the separation document means."
          : "Confirm the one candidate the separation document means.",
        intent: "primary",
        icon: "resolve",
        placement: ["banner", "footer"],
        kind: "command",
        command: "resolve-gate",
        expectedVersion,
        resolution: "approved",
        confirm: {
          title: "Approve this identity",
          body: disagreements.length === 0 ? IDENTITY_REVIEW_TEXT.confirm.agreed
            : `${identityReviewReason(packet)} ${IDENTITY_REVIEW_TEXT.confirm.disagreed}`,
          confirmLabel: "Approve",
          tone: disagreements.length === 0 ? "neutral" : "destructive",
        },
      },
      {
        key: "resolve-gate-rejected",
        label: "Reject match",
        detail: "This is not the right person. The run stops.",
        intent: "destructive",
        icon: "cancel",
        placement: ["footer"],
        kind: "command",
        command: "resolve-gate",
        expectedVersion,
        resolution: "rejected",
      },
    ];
  }

  function buildFixtureIdentityGate(input: Readonly<{
    runId: string;
    label: string;
    parkedAt: string;
    /** the log cursor of the gate.opened timeline event */
    order: number;
    expectedVersion: number;
    observedAt: string;
    /** the document's own spelling of the name — what decides the ceremony */
    documentName: string;
  }>): IdentityGateDetailWire {
    const packet = packetOf({ documentName: input.documentName, observedAt: input.observedAt });
    return identityReviewWire(packet, {
      runId: input.runId,
      label: input.label,
      parkedAt: input.parkedAt,
      expectedVersion: input.expectedVersion,
      order: input.order,
      actions: ActionDescriptorWireSchema.array().parse(fixtureIdentityGateActions(packet, input.expectedVersion)),
    });
  }

  return { FIXTURE_GATE_CHECKED_EID, fixtureIdentityGateActions, buildFixtureIdentityGate };
}
