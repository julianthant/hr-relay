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
  /** `one-click`: one candidate. The confirm block is the ceremony. */
  | { readonly kind: "confirm"; readonly option: IdentityGateOption }
  /** `choose-a-candidate`: the operator picks which person the document means. */
  | { readonly kind: "choose"; readonly options: readonly IdentityGateOption[] }
  /** this build cannot describe the ceremony the server asked */
  | { readonly kind: "unsupported"; readonly reason: string };

/** The operator's ANSWER — the part of an `IdentityApprovalResult` that only a human knows. */
export type IdentityGateAnswer = { readonly decision: "approved"; readonly eid: string };

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

/** What approval costs, from the SERVER's shape and the served options. */
export function identityCeremonyFor(gate: IdentityGateDetail): IdentityCeremony {
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
    default:
      return unsupportedShape(gate.approvalShape);
  }
}

/** Match kernel answer bounds; extra client limits would refuse legitimate operator decisions. */
export function identityDraftProblem(ceremony: IdentityCeremony, eid: string): string | undefined {
  switch (ceremony.kind) {
    case "unsupported":
      return ceremony.reason;
    case "confirm":
      return undefined;
    case "choose":
      return eid.length === 0
        ? "Pick which candidate the separation document means."
        : optionFor(ceremony.options, eid) === undefined
          ? `EID ${directIdentifierDigestReference(eid)} is not one of the candidates this packet showed.`
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
