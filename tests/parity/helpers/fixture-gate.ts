/**
 * THE GATED RUN, for adapter #1 (ref write-safety §14.4/§14.6, D226).
 *
 * The corpus has photographed an open gate since it was written and had never
 * once served the `identity-gate` SECTION behind it — so every `run-open-gate`
 * reference showed a decision card with no way to answer it, and the three
 * ceremonies §14.6 risk 1 exists to enforce were unphotographed on a surface
 * whose whole job is to stop a wrong-person termination. This is that fixture.
 *
 * **The packet is BUILT, never authored.** `buildIdentityEvidencePacket` is the
 * production fold, and `deriveApprovalShape` inside it is the SERVER's own
 * policy — the thing §14.6 makes a server decision precisely so a frontend
 * cannot choose a cheaper control. A hand-written `approvalShape` here would
 * photograph the fixture's opinion of that policy instead of the policy, which
 * is exactly what the reference exists to catch. So the two gated runs differ
 * in their INPUTS and the shape falls out:
 *
 *  - **`choose-a-candidate`** — the names agree, and a UCPath search on the
 *    document's name resolves a DIFFERENT person. Two candidates, and only a
 *    human can say which the document means.
 *  - **`type-the-eid`** — the names do not match at all. That is `T002173685`'s
 *    own shape, and the riskiest packet the gate can serve, so the EID must be
 *    stated rather than recognised.
 *
 * The two `resolve-gate` descriptors are the SERVER's, word for word
 * (`identityGateActions` in `src/server/dashboard/queries/run-detail.ts`), for
 * the same reason `FIXTURE_PARKED_WRITE` copies its pair: that function is not
 * exported and takes an authority `RunRecord` this adapter has none of. The
 * copy is PINNED to the server's by
 * `tests/unit/server/identity-gate-section.test.ts`, because a copy nobody
 * compares is a reference that documents last month's copy.
 */
import {
  IdentityGateDetailWireSchema,
  type IdentityGateDetailWire,
} from "../../../src/domain/dashboard/run-detail.js";
import { deriveSchemaHash } from "../../../src/domain/schema-bound-value.js";
import { IdentityApprovalResultSchema } from "../../../src/domain/separations/identity-approval.js";
import {
  buildIdentityEvidencePacket,
  deriveIdentityEvidenceDigest,
} from "../../../src/domain/separations/identity-evidence.js";
import type { IdentityEvidencePacket } from "../../../src/domain/separations/identity-evidence.js";
import { noSeparationWritePlan } from "../../../src/domain/separations/write-plan.js";
import { deriveJobRowFromCells } from "../../../src/stores/ucpath/driver/person-org-operation.js";

/** The EID the separation document carries, and the person UCPath showed for it. */
export const FIXTURE_GATE_CHECKED_EID = "10688204";
/** The person a search on the document's NAME resolves — a different human. */
export const FIXTURE_GATE_SEARCH_EID = "10412770";

export const FIXTURE_GATE_RESULT_SCHEMA_HASH = deriveSchemaHash(IdentityApprovalResultSchema, "output");

function packetOf(input: Readonly<{ documentName: string; observedAt: string }>): IdentityEvidencePacket {
  const rows = [deriveJobRowFromCells([
    "0", "07/01/2025", "Active", "SDCMP", "40012345", "000414",
    "Housing Dining Hospitality", "004920", "STDT 3", "", "0.500000", "Student",
  ], 0)];
  return buildIdentityEvidencePacket({
    documentNumber: "4502",
    documentName: input.documentName,
    documentEidText: FIXTURE_GATE_CHECKED_EID,
    emplIdSource: "document-eid",
    documentEidConflicts: false,
    jobSummary: {
      pageStateId: "ucpath.person-org.detail-ready",
      emplId: FIXTURE_GATE_CHECKED_EID as never,
      displayedName: "Blirea, Glaundi",
      jobRows: rows,
      rowCount: rows.length,
      renderContext: { entry: "auto-detail", searchResultRows: 0, employmentInstances: "already-complete" },
      observedAt: input.observedAt as never,
    },
    nameSelection: {
      status: "resolved",
      selected: {
        emplId: FIXTURE_GATE_SEARCH_EID as never,
        name: "Blirea, Glaundi",
        department: "Facilities Management",
        jobTitle: "BLDG MAINT WORKER SR",
        employeeStatus: "active",
        hdh: false,
      },
      candidateEids: [FIXTURE_GATE_SEARCH_EID as never],
    },
    plan: noSeparationWritePlan(
      "this workflow reads an identity and files nothing, so it composes no separation write plan",
    ),
  });
}

/**
 * The server's own option mapping, copied from `run-detail.ts`: the checked EID
 * is `checked`, the one a name search resolved is `name-search`. A surface may
 * not invent either label — the post-gate node re-derives where the approved
 * EID came from and refuses a contradiction as `identity-approval-choice-mismatch`.
 */
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

/** The server's two descriptors, copied verbatim and pinned by a unit test. */
export function fixtureIdentityGateActions(
  packet: IdentityEvidencePacket,
  expectedVersion: number,
): unknown[] {
  const disagreements = packet.comparisons.filter(({ agrees }) => !agrees);
  return [
    {
      key: "resolve-gate-approved",
      label: packet.approvalShape === "one-click" ? "Approve this person" : "Approve the chosen EID",
      detail: packet.approvalShape === "type-the-eid"
        ? "This decision is ambiguous: the EID must be typed, not selected."
        : packet.approvalShape === "choose-a-candidate"
          ? "Choose which candidate the separation document means."
          : "One unambiguous candidate, one active job, and the names agree.",
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
    {
      key: "resolve-gate-rejected",
      label: "Reject — this is not the right person",
      detail: "Ends the run with the reason recorded. Nothing downstream runs.",
      intent: "destructive",
      icon: "resolve",
      placement: ["banner", "footer"],
      kind: "command",
      command: "resolve-gate",
      expectedVersion,
      resolution: "rejected",
      confirm: {
        title: "Reject this identity",
        body: `The run ends and records why. Separation document ${packet.documentNumber} stays untouched.`,
        confirmLabel: "Reject",
        tone: "neutral",
      },
    },
  ];
}

export function buildFixtureIdentityGate(input: Readonly<{
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
    approvalShape: packet.approvalShape,
    actions: fixtureIdentityGateActions(packet, input.expectedVersion),
  });
}
