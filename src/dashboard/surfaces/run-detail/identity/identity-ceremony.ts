// The served shape determines the ceremony; unsupported shapes must never downgrade to one-click approval.
import type { RunDetailSectionResponse } from "../../../../models/dashboard/run-detail.js";
import { directIdentifierDigestReference } from "../../../../rules/redaction/redaction.js";

/** The served `identity-gate` section, in every state the wire admits. */
export type IdentityGatePayload =
  Extract<RunDetailSectionResponse, { section: "identity-gate" }>["payload"];

/** The section once the server could describe the gate. */
export type IdentityGateAvailable = Extract<IdentityGatePayload, { state: "available" }>;
export type IdentityGateDetail = IdentityGateAvailable["value"];

/** chosenFrom is served evidence provenance; never infer it from the selected EID. */
export type IdentityGateOption = IdentityGateDetail["options"][number];

// Unsupported ceremonies show a blocked refusal beside the evidence rather than throwing during render.
export type IdentityCeremony =
  /** `one-click`: one unambiguous candidate. The confirm block is the ceremony. */
  | { readonly kind: "confirm"; readonly option: IdentityGateOption }
  /** `choose-a-candidate`: the operator picks which person the document means. */
  | { readonly kind: "choose"; readonly options: readonly IdentityGateOption[] }
  /** `type-the-eid`: the EID must be typed, and must still be one the packet showed. */
  | { readonly kind: "type-the-eid"; readonly options: readonly IdentityGateOption[] }
  /** the rejection arm — operator-authored text, on either approval shape. */
  | { readonly kind: "reject" }
  /** this build cannot describe the ceremony the server asked */
  | { readonly kind: "unsupported"; readonly reason: string };

/** What the operator has typed or picked so far. Both halves, always. */
export interface IdentityGateDraft {
  /** the EID chosen from the list or typed into the field */
  readonly eid: string;
  /** the rejection reason, verbatim as typed */
  readonly reason: string;
}

export const EMPTY_IDENTITY_GATE_DRAFT: IdentityGateDraft = { eid: "", reason: "" };

/** The operator's ANSWER — the part of an `IdentityApprovalResult` that only a
 * human knows. Everything else on the payload (the digest, the schema hash */
export type IdentityGateAnswer =
  | { readonly decision: "approved"; readonly eid: string }
  | { readonly decision: "rejected"; readonly reason: string };

// Exhaustive at compile time; newer server shapes still receive a named runtime refusal.
function unsupportedShape(shape: never): IdentityCeremony {
  return {
    kind: "unsupported",
    reason: `the server set this decision's ceremony to "${String(shape)}", and this build has no `
      + "control for it. It is NOT approvable from here — approving under a ceremony nobody "
      + "implemented is exactly the one-click downgrade ref write-safety §14.6 risk 1 forbids. Resolve this "
      + "gate from the CLI, or update this dashboard.",
  };
}

/** What this resolution costs, from the SERVER's shape and the served options.
 * A contradiction between the two — a `one-click` packet carrying two */
export function identityCeremonyFor(
  gate: IdentityGateDetail,
  resolution: "approved" | "rejected",
): IdentityCeremony {
  if (resolution === "rejected") return { kind: "reject" };
  switch (gate.approvalShape) {
    case "one-click": {
      const [only, ...rest] = gate.options;
      if (only === undefined || rest.length > 0) {
        return {
          kind: "unsupported",
          reason: `the server called this a one-click approval and served ${
            String(gate.options.length)} approvable candidates. One click names exactly one person; `
            + "this packet does not say which.",
        };
      }
      return { kind: "confirm", option: only };
    }
    case "choose-a-candidate": {
      if (gate.options.length < 2) {
        return {
          kind: "unsupported",
          reason: "the server asked for a candidate to be CHOSEN and served "
            + `${String(gate.options.length)} of them. A choice among one is not a choice, and `
            + "picking it anyway would answer a question the server said it had.",
        };
      }
      return { kind: "choose", options: gate.options };
    }
    case "type-the-eid":
      return { kind: "type-the-eid", options: gate.options };
    default:
      return unsupportedShape(gate.approvalShape);
  }
}

/** The 8-digit shape the wire's own option schema pins. */
const EID_PATTERN = /^\d{8}$/u;

/** Match kernel answer bounds; extra client limits would refuse legitimate operator decisions. */
export function identityDraftProblem(
  ceremony: IdentityCeremony,
  draft: IdentityGateDraft,
): string | undefined {
  switch (ceremony.kind) {
    case "unsupported":
      return ceremony.reason;
    case "confirm":
      return undefined;
    case "reject":
      return draft.reason.trim().length === 0
        ? "Say why this is not the right person. The reason is recorded on the run's failure record "
          + "and is the only account of why nothing was filed."
        : undefined;
    case "choose":
      return draft.eid.length === 0
        ? "Pick which candidate the separation document means."
        : optionFor(ceremony.options, draft.eid) === undefined
          ? `EID ${directIdentifierDigestReference(draft.eid)} is not one of the candidates this packet showed.`
          : undefined;
    case "type-the-eid":
      if (!EID_PATTERN.test(draft.eid)) {
        return "Type the 8-digit employee ID this separation is about.";
      }
      return optionFor(ceremony.options, draft.eid) === undefined
        ? `The packet never showed EID ${directIdentifierDigestReference(draft.eid)}. This run performed no live read of it, so `
          + "approving it would file against a person nothing here looked at — which is what the "
          + "identity authority check refuses as `identity-approval-eid-not-shown`."
        : undefined;
  }
}

/** The served option for an EID, or `undefined` when the packet never showed it. */
export function optionFor(
  options: readonly IdentityGateOption[],
  eid: string,
): IdentityGateOption | undefined {
  return options.find((option) => option.eid === eid);
}

/** Return the human decision only; envelope composition remains with the shared command composer. */
export function identityGateAnswer(
  ceremony: IdentityCeremony,
  draft: IdentityGateDraft,
): IdentityGateAnswer | undefined {
  if (identityDraftProblem(ceremony, draft) !== undefined) return undefined;
  switch (ceremony.kind) {
    case "confirm":
      return { decision: "approved", eid: ceremony.option.eid };
    case "choose":
    case "type-the-eid":
      return { decision: "approved", eid: draft.eid };
    case "reject":
      return { decision: "rejected", reason: draft.reason.trim() };
    case "unsupported":
      return undefined;
  }
}
