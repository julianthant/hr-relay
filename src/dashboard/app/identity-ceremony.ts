/**
 * THE THREE IDENTITY-APPROVAL CEREMONIES (ref write-safety §14.4/§14.6, D226).
 *
 * The identity gate asks one question — *is this the right person* — and ref write-safety
 * §14.6 risk 1 says the CONTROL that answers it must reflect the evidence. This
 * gate is now present only for a name-resolved EID; supplied-EID read-back uses
 * machine authority and never reaches this module. When the gate is present,
 * the SERVER decides its shape — `approvalShape` is computed
 * in `src/domain/separations/identity-evidence.ts` and served on the wire
 * precisely so a frontend cannot quietly downgrade every gate to one click.
 *
 * This module is the client half of that contract, and it is deliberately a
 * pure `.ts` fold rather than component state: what a ceremony COSTS, and
 * whether the operator's draft answer satisfies it, are decisions a test can
 * pin. The `.tsx` surface renders what this returns and adds nothing to it.
 *
 * ## The one rule that outranks the others
 *
 * **An `approvalShape` this build does not know refuses BY NAME.** It never
 * falls through to the approve button, never picks the first candidate, never
 * "defaults" to one click. A surface that met an unrecognised shape and
 * approved anyway would be §14.6 risk 1 with the server's own guard removed —
 * which is strictly worse than having no guard, because the server would still
 * be reporting that it had asked for a choice.
 */
import type { RunDetailSectionResponse } from "../../domain/dashboard/run-detail.js";
import { directIdentifierDisplay } from "../../domain/redaction.js";

/** The served `identity-gate` section, in every state the wire admits. */
export type IdentityGatePayload =
  Extract<RunDetailSectionResponse, { section: "identity-gate" }>["payload"];

/** The section once the server could describe the gate. */
export type IdentityGateAvailable = Extract<IdentityGatePayload, { state: "available" }>;
export type IdentityGateDetail = IdentityGateAvailable["value"];

/**
 * One approvable EID, paired with the `chosenFrom` label the authority node
 * will verify. The label is served, never inferred: `verify-identity-approval`
 * re-derives where an approved EID actually came from and refuses a label the
 * packet contradicts (`identity-approval-choice-mismatch`), so a surface that
 * invented one would put a false statement on the receipt (D202 #3).
 */
export type IdentityGateOption = IdentityGateDetail["options"][number];

/**
 * What the operator is asked to DO, derived from the served shape.
 *
 * `unsupported` is a first-class arm rather than a thrown error because the
 * dialog has somewhere honest to put it — a named refusal beside the packet,
 * with the send control blocked — and because a thrown error in a render pass
 * would take the whole panel down with it, hiding the very evidence the
 * operator needs to act on the gate from the CLI instead.
 */
export type IdentityCeremony =
  /** `one-click`: one unambiguous candidate. The confirm block is the ceremony. */
  | { readonly kind: "confirm"; readonly option: IdentityGateOption }
  /** `choose-a-candidate`: the operator picks which person the document means. */
  | { readonly kind: "choose"; readonly options: readonly IdentityGateOption[] }
  /** `type-the-eid`: the EID must be typed, and must still be one the packet showed. */
  | { readonly kind: "type-the-eid"; readonly options: readonly IdentityGateOption[] }
  /** the rejection arm — operator-authored text, on either approval shape. */
  | { readonly kind: "reject" }
  /** this build cannot describe the ceremony the server asked for. */
  | { readonly kind: "unsupported"; readonly reason: string };

/** What the operator has typed or picked so far. Both halves, always. */
export interface IdentityGateDraft {
  /** the EID chosen from the list or typed into the field */
  readonly eid: string;
  /** the rejection reason, verbatim as typed */
  readonly reason: string;
}

export const EMPTY_IDENTITY_GATE_DRAFT: IdentityGateDraft = { eid: "", reason: "" };

/**
 * The operator's ANSWER — the part of an `IdentityApprovalResult` that only a
 * human knows. Everything else on the payload (the digest, the schema hash,
 * the `chosenFrom` label) is a served fact the composer reads off the section.
 */
export type IdentityGateAnswer =
  | { readonly decision: "approved"; readonly eid: string }
  | { readonly decision: "rejected"; readonly reason: string };

/**
 * An approval shape this build has no ceremony for.
 *
 * The parameter is `never`, so adding a fourth arm to
 * `IdentityApprovalShapeSchema` without adding its ceremony here is a COMPILE
 * error rather than a surface that silently drew the wrong control. The
 * runtime arm still exists, because a wire value can outrun a bundle: a server
 * upgraded ahead of a browser tab serves a shape this build never compiled.
 */
function unsupportedShape(shape: never): IdentityCeremony {
  return {
    kind: "unsupported",
    reason: `the server set this decision's ceremony to "${String(shape)}", and this build has no `
      + "control for it. It is NOT approvable from here — approving under a ceremony nobody "
      + "implemented is exactly the one-click downgrade ref write-safety §14.6 risk 1 forbids. Resolve this "
      + "gate from the CLI, or update this dashboard.",
  };
}

/**
 * What this resolution costs, from the SERVER's shape and the served options.
 *
 * A contradiction between the two — a `one-click` packet carrying two
 * candidates, a `choose-a-candidate` packet carrying one — is `unsupported`
 * rather than a best guess. The server states both facts; when they disagree,
 * only the server can say which one it meant.
 */
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

/**
 * Why this draft cannot be sent yet, in the words the operator has to act on —
 * or `undefined` when it can.
 *
 * Every bound stated here is a bound the KERNEL also holds, stated where the
 * value is typed rather than discovered from a rejection: the EID must be one
 * the packet showed (`identity-approval-eid-not-shown`), and a rejection's
 * reason is `z.string().min(1)`. Nothing invents a bound the server does not
 * have — a client-side maximum on a reason the kernel accepts would be this
 * surface refusing a legitimate answer.
 */
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
          ? `EID ${directIdentifierDisplay(draft.eid)} is not one of the candidates this packet showed.`
          : undefined;
    case "type-the-eid":
      if (!EID_PATTERN.test(draft.eid)) {
        return "Type the 8-digit employee ID this separation is about.";
      }
      return optionFor(ceremony.options, draft.eid) === undefined
        ? `The packet never showed EID ${directIdentifierDisplay(draft.eid)}. This run performed no live read of it, so `
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

/**
 * The operator's answer, or `undefined` when the draft is not yet answerable.
 *
 * It is deliberately NOT a command: composing the envelope stays with
 * `composeCommandRequest`, which is the one place a served control becomes a
 * command. This function's whole job is to say what the HUMAN decided.
 */
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
