import { IdentityGateDetailWireSchema, type IdentityGateDetailWire } from "../../../../../src/models/dashboard/run-detail.js";
import { deriveSchemaHash } from "../../../../../src/models/validation/schema-bound-value.js";
import { IdentityApprovalResultSchema } from "../../../../../src/rules/separations/identity-approval.js";
import { buildIdentityEvidencePacket, deriveIdentityEvidenceDigest } from "../../../../../src/rules/separations/identity-evidence.js";
import type { IdentityEvidencePacket } from "../../../../../src/rules/separations/identity-evidence.js";
import { noSeparationWritePlan } from "../../../../../src/rules/separations/write-plan.js";
import { deriveJobRowFromCells } from "../../../../../src/backend/systems/ucpath/driver/person-org-operation.js";

export function createFixtureGateSetup() {
  const FIXTURE_GATE_CHECKED_EID = "10688204";

  const FIXTURE_GATE_RESULT_SCHEMA_HASH = deriveSchemaHash(IdentityApprovalResultSchema, "output");

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

  function optionsOf(packet: IdentityEvidencePacket): unknown[] {
    const nameSearchEid = packet.nameSearch.status === "resolved" ? packet.nameSearch.candidate.eid : undefined;
    return packet.approvableEids.map((eid) => ({
      eid: String(eid),
      chosenFrom: String(eid) === String(packet.emplId)
        ? "checked"
        : String(eid) === String(nameSearchEid) ? "name-search" : "manual",
      displayName: String(eid) === String(packet.emplId)
        ? packet.ucpathName
        : String(eid) === String(nameSearchEid) && packet.nameSearch.status === "resolved"
          ? packet.nameSearch.candidate.name
          : `EID ${String(eid)}`,
      origin: String(eid) === String(packet.emplId)
        ? `the EID this run checked (${packet.emplIdSource})`
        : String(eid) === String(nameSearchEid)
          ? `a UCPath search on the document's name "${packet.documentName}" resolved this person`
          : `a UCPath search on the document's name "${packet.documentName}" listed this EID among its candidates`,
    }));
  }

  function fixtureIdentityGateActions(
    packet: IdentityEvidencePacket,
    expectedVersion: number,
  ): unknown[] {
    const disagreements = packet.comparisons.filter(({ agrees }) => !agrees);
    return [
      {
        key: "resolve-gate-approved",
        label: packet.approvableEids.length === 1 ? "Approve this person" : "Approve the chosen EID",
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
          body: disagreements.length === 0
            ? `Every compared field agreed for ${packet.documentName} on separation document `
              + `${packet.documentNumber}. Approving binds the rest of this separation to this person.`
            : `${String(disagreements.length)} field(s) DISAGREE: ${
              disagreements.map(({ field }) => field).join(", ")
            }. Approving files the rest of this separation against this person anyway.`,
          confirmLabel: "Approve",
          tone: disagreements.length === 0 ? "neutral" : "destructive",
        },
      },
    ];
  }

  function buildFixtureIdentityGate(input: Readonly<{
    runId: string;
    gateId: string;
    label: string;
    parkedAt: string;
    resumeAt: string;
    expectedVersion: number;
    observedAt: string;
    /** the document's own spelling of the name — what decides the ceremony */
    documentName: string;
  }>): IdentityGateDetailWire {
    const packet = packetOf({ documentName: input.documentName, observedAt: input.observedAt });
    return IdentityGateDetailWireSchema.parse({
      runId: input.runId,
      gateId: input.gateId,
      label: input.label,
      parkedAt: input.parkedAt,
      resumeAt: input.resumeAt,
      expectedVersion: input.expectedVersion,
      resultSchemaHash: FIXTURE_GATE_RESULT_SCHEMA_HASH,
      evidenceDigest: deriveIdentityEvidenceDigest(packet),
      packet,
      options: optionsOf(packet),
      approvalShape: packet.approvableEids.length > 1 ? "choose-a-candidate" : "one-click",
      actions: fixtureIdentityGateActions(packet, input.expectedVersion),
    });
  }

  return { FIXTURE_GATE_CHECKED_EID, FIXTURE_GATE_RESULT_SCHEMA_HASH, fixtureIdentityGateActions, buildFixtureIdentityGate };
}
