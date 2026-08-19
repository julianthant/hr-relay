/**
 * Turning a SERVED action descriptor into the ONE command envelope (doc 13
 * §3.4), for the confirm-first flow the app root mounts.
 *
 * The demo's `runAction` (legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * `RebuildDemo.tsx:226-252`) is one `switch` over a mock service; here the
 * envelope is a strict discriminated union the kernel parses, so composing it is
 * a real step with real failure modes — and this module makes those failures
 * VALUES rather than exceptions or, worse, invented payloads.
 *
 * THE RULE THIS FILE EXISTS TO KEEP: a command whose payload cannot be composed
 * from SERVED facts is refused BY NAME and never sent. The identity gate is the
 * live example — the kernel's `resolve-gate` payload is a schema-bound
 * `IdentityApprovalResult`, and two of its arms need something no served fact
 * carries: the operator's chosen candidate when the server asked for a choice,
 * and the operator's rejection reason. Filling either with a plausible constant
 * would put a value nobody authored onto a real HR identity decision, which is
 * the exact substitution the charter's fail-loud rule forbids.
 *
 * **D226 supplies those two values rather than inventing them.** The ceremony
 * dialog (`surfaces/identity-approve.tsx`) collects the operator's ANSWER and
 * hands it to this composer as `context.gateAnswer`; everything else on the
 * payload — the evidence digest, the result schema hash, the `chosenFrom` label
 * — is still read straight off the served section. So the three refusals this
 * file used to end at are now three composed arms, and the refusals that remain
 * are the honest ones: a shape this build has no ceremony for, an EID the
 * packet never showed, an answer that was never authored.
 */
import { systemClock } from "../../domain/clock.js";
import type { ActionDescriptorWire } from "../../domain/dashboard/actions.js";
import type { ActionTarget } from "../surfaces/actions.js";
import {
  identityCeremonyFor,
  identityDraftProblem,
  optionFor,
  type IdentityGateAnswer,
  type IdentityGatePayload,
} from "./identity-ceremony.js";

export type CommandAction = Extract<ActionDescriptorWire, { kind: "command" }>;

/**
 * What the app can say about a descriptor it was asked to dispatch. `refused`
 * is a legitimate answer with a sentence in it — the surface reports it and
 * sends nothing.
 */
export type ComposedCommand =
  | { readonly state: "ready"; readonly request: unknown }
  | { readonly state: "refused"; readonly reason: string };

/** The four envelope fields every family shares, stamped once per dispatch. */
interface CommandEnvelopeFields {
  readonly commandId: string;
  readonly requestedAt: string;
  readonly requestedBy: string;
  readonly source: string;
}

export interface CommandContext {
  /** who is asking — the bootstrap document's actor */
  readonly actorId: string;
  /** the surface the operator pressed the control on */
  readonly source: "queue" | "run-detail";
  /** the gate section the run advertised, when one is open */
  readonly gate?: IdentityGatePayload | undefined;
  /**
   * What the operator answered in the ceremony dialog (D226). It is OPTIONAL
   * because exactly one ceremony needs no answer — a `one-click` packet naming
   * one candidate, where the served option IS the answer. Every other shape
   * refuses without one rather than choosing on the operator's behalf.
   */
  readonly gateAnswer?: IdentityGateAnswer | undefined;
}

/**
 * The identity gate's answer: the operator's decision, wearing the server's
 * facts.
 *
 * `evidenceDigest` and `resultSchemaHash` are on the section precisely so a
 * client never derives them (doc 13's own note: a client computing that hash
 * would be a second implementation of the descriptor's identity). The
 * `chosenFrom` label comes from the served `options`, which the wire refines
 * against the packet the operator was shown — the post-gate node re-derives
 * where the EID actually came from and refuses a label the packet contradicts
 * (`identity-approval-choice-mismatch`), so a label invented here would put a
 * false statement on the receipt.
 *
 * WHAT STILL REFUSES, and why each refusal is the honest answer:
 *
 *  - **an unrecognised `approvalShape`** — `identityCeremonyFor` returns
 *    `unsupported`, and this composer sends nothing. Approving under a ceremony
 *    nobody implemented is §14.6 risk 1 with the server's own guard removed;
 *  - **a shape that needs an answer, with none supplied** — a `choose`, a
 *    `type-the-eid` or a rejection reached without the dialog. Picking the first
 *    option, or minting an empty reason, would be this surface authoring the
 *    human's decision;
 *  - **an EID the packet never showed** — the post-gate check refuses it as
 *    `identity-approval-eid-not-shown`, and refusing at composition means the
 *    run never has to. The same sentence is stated at the field the operator
 *    types into, so this arm is a backstop rather than the first they hear of it.
 */
function composeGateResult(
  action: CommandAction,
  gate: IdentityGatePayload | undefined,
  answer: IdentityGateAnswer | undefined,
  envelope: CommandEnvelopeFields,
): ComposedCommand {
  if (gate === undefined || gate.state !== "available") {
    return {
      state: "refused",
      reason: gate === undefined
        ? "this run served no identity-gate section, so there is no packet to answer"
        : `the identity-gate section is ${gate.state}: ${"reason" in gate ? gate.reason : gate.message}`,
    };
  }
  const served = gate.value;
  const { resolution } = action;
  if (resolution === undefined) {
    return {
      state: "refused",
      reason: `the served gate action ${action.key} names no typed resolution`,
    };
  }
  const ceremony = identityCeremonyFor(served, resolution);
  if (ceremony.kind === "unsupported") return { state: "refused", reason: ceremony.reason };

  // The ONE ceremony whose answer is a served fact: the server said one click,
  // and named exactly one candidate. Everything else waits for a human.
  const decided: IdentityGateAnswer | undefined = answer
    ?? (ceremony.kind === "confirm" ? { decision: "approved", eid: ceremony.option.eid } : undefined);
  if (decided === undefined) {
    return {
      state: "refused",
      reason: `this gate's ceremony is "${served.approvalShape}" and no operator answer was supplied; `
        + "the identity-approval dialog owns that answer and nothing here may author it",
    };
  }
  if (decided.decision !== resolution) {
    return {
      state: "refused",
      reason: `the operator answered "${decided.decision}" and the control pressed was `
        + `"${resolution}"; nothing is sent while the two disagree`,
    };
  }

  const problem = identityDraftProblem(ceremony, {
    eid: decided.decision === "approved" ? decided.eid : "",
    reason: decided.decision === "rejected" ? decided.reason : "",
  });
  if (problem !== undefined) return { state: "refused", reason: problem };

  const value = ((): Record<string, unknown> | undefined => {
    if (decided.decision === "rejected") {
      return {
        decision: "rejected",
        reason: decided.reason.trim(),
        evidenceDigest: served.evidenceDigest,
      };
    }
    const option = optionFor(served.options, decided.eid);
    // `identityDraftProblem` already refused an unshown EID on every approval
    // ceremony, so this is unreachable — and it refuses rather than asserting,
    // because the alternative is a `chosenFrom` label nobody served.
    if (option === undefined) {
      return undefined;
    }
    return {
      decision: "approved",
      eid: option.eid,
      chosenFrom: option.chosenFrom,
      evidenceDigest: served.evidenceDigest,
    };
  })();
  if (value === undefined) {
    return {
      state: "refused",
      reason: `EID ${decided.decision === "approved" ? decided.eid : ""} is not among the candidates `
        + "this packet served, so there is no `chosenFrom` label to record it under",
    };
  }

  return {
    state: "ready",
    request: {
      ...envelope,
      family: "gate",
      type: "resolve-gate",
      target: {
        runId: served.runId,
        gateId: served.gateId,
        expectedVersion: action.expectedVersion,
      },
      payload: { result: { schemaHash: served.resultSchemaHash, value } },
    },
  };
}

/**
 * The one composer. It is exhaustive over the served command vocabulary
 * (`ActionCommandKeySchema`), so a verb the projection starts serving cannot
 * fall through to a silent no-op — an unhandled verb refuses with its own name
 * in the sentence.
 */
export function composeCommandRequest(
  action: CommandAction,
  target: ActionTarget,
  context: CommandContext,
): ComposedCommand {
  const envelope = {
    commandId: crypto.randomUUID(),
    requestedAt: systemClock.now().toISOString(),
    requestedBy: context.actorId,
    source: context.source,
  };
  switch (action.command) {
    case "retry":
    case "cancel":
    case "bump":
    case "hide":
    case "unhide":
      return {
        state: "ready",
        request: {
          ...envelope,
          family: "run",
          type: action.command,
          target: { runId: target.runId, expectedVersion: action.expectedVersion },
        },
      };
    case "resolve-gate":
      return composeGateResult(action, context.gate, context.gateAnswer, envelope);
    case "resolve-write-present":
    case "resolve-write-absent":
      // The park resolutions have their OWN wired path: `park-resolve.tsx`
      // opens a dialog that captures the evidence note the kernel requires and
      // posts the command itself. Routing them through here as well would offer
      // one irreversible answer by two roads, one of which cannot carry the
      // note.
      return {
        state: "refused",
        reason: `${action.command} is answered by the parked-write dialog, not by this dispatcher`,
      };
  }
}
