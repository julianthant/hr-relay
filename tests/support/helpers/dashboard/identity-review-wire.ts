import { identityGateDecision } from "../../../../src/backend/runs/queries/run-detail/gate-park.js";
import { IDENTITY_REVIEW_TEXT } from "../../../../src/backend/runs/decisions/decision-catalog.js";
import type { ActionDescriptorWire } from "../../../../src/models/dashboard/actions.js";
import { IdentityGateDetailWireSchema, type IdentityGateDetailWire } from "../../../../src/models/dashboard/run-detail.js";
import type { IdentityEvidencePacket } from "../../../../src/rules/separations/identity-evidence.js";

export const IDENTITY_GATE_REF = "00000000-0000-4000-8000-0000000000a1";
export const identityOptionRef = (index: number): string => `00000000-0000-4000-8000-0000000000b${String(index)}`;
const masked = (eid: string): string => `••••${eid.slice(-4)}`;

/** The served reason for a fixture packet (fixtures check the name-resolved EID path only). */
export function identityReviewReason(packet: IdentityEvidencePacket): string {
  const { reason } = IDENTITY_REVIEW_TEXT;
  const first = packet.comparisons.find(({ agrees }) => !agrees);
  return packet.approvableEids.length > 1 ? reason["several-people"] : first === undefined ? reason.agreed : reason[first.field];
}

/** The served identity review for a packet: display text and opaque refs only, never a full Employee ID. */
export function identityReviewWire(packet: IdentityEvidencePacket, input: Readonly<{
  runId: string;
  label: string;
  parkedAt: string;
  expectedVersion: number;
  actions: readonly ActionDescriptorWire[];
  order?: number;
  rejectable?: boolean;
  overrides?: Record<string, unknown>;
}>): IdentityGateDetailWire {
  const { origin, label, value } = IDENTITY_REVIEW_TEXT;
  const nameSearchEid = packet.nameSearch.status === "resolved" ? packet.nameSearch.candidate.eid : undefined;
  const options = packet.approvableEids.map((eid, index) => ({
    ref: identityOptionRef(index),
    displayName: String(eid) === String(packet.emplId) ? packet.ucpathName : value.unnamed,
    maskedEid: masked(String(eid)),
    origin: String(eid) === String(packet.emplId) ? origin["name-resolved"]
      : String(eid) === String(nameSearchEid) ? origin["name-search"] : origin.manual,
  }));
  const comparisons = packet.comparisons.map(({ field, agrees }) => ({
    label: label[field],
    request: field === "eid" ? value.noFormEid : packet.documentName,
    ucpath: field === "eid" ? masked(String(packet.emplId)) : packet.ucpathName,
    agrees,
  }));
  return IdentityGateDetailWireSchema.parse({
    runId: input.runId,
    gateRef: IDENTITY_GATE_REF,
    label: input.label,
    parkedAt: input.parkedAt,
    expectedVersion: input.expectedVersion,
    ...(input.order === undefined ? {} : { order: input.order }),
    reason: identityReviewReason(packet),
    comparisons,
    options,
    approvalShape: options.length > 1 ? "choose-a-candidate" : "one-click",
    actions: input.actions,
    decision: identityGateDecision(options, input.actions, [], undefined, { documentName: packet.documentName }),
    ...input.overrides,
  });
}
