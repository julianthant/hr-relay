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
 * carries (the operator's chosen candidate when the server asked for a choice,
 * and the operator's rejection reason). Filling either with a plausible constant
 * would put a value nobody authored onto a real HR identity decision, which is
 * the exact substitution the charter's fail-loud rule forbids.
 */
import { systemClock } from "../../domain/clock.js";
import type { ActionDescriptorWire } from "../../domain/dashboard/actions.js";
import type { ActionTarget } from "../surfaces/actions.js";
import type { IdentityGatePayload } from "../surfaces/log-panel.js";

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
}

/**
 * The identity gate's answer, composed from what the SERVER served and nothing
 * else.
 *
 * `evidenceDigest` and `resultSchemaHash` are on the section precisely so a
 * client never derives them (doc 13's own note: a client computing that hash
 * would be a second implementation of the descriptor's identity). The EID and
 * its `chosenFrom` label come from the served `options`, which the wire refines
 * against the packet the operator was shown.
 *
 * TWO ARMS REFUSE, and both refusals name the surface that closes them:
 *
 *  - an `approvalShape` other than `one-click` is the SERVER stating that this
 *    decision costs a choice (§14.6 risk 1 — a surface that quietly turns a
 *    risky approval into one click is rubber-stamping manufactured by
 *    accident). Picking the first option on the operator's behalf is exactly
 *    that, so it refuses;
 *  - `rejected` requires `reason: z.string().min(1)`, which is operator-authored
 *    text with no field on this surface to type it into.
 */
function composeGateResult(
  action: CommandAction,
  gate: IdentityGatePayload | undefined,
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
  if (action.resolution === "rejected") {
    return {
      state: "refused",
      reason: "a rejection records the operator's own reason, and this build has no field to type "
        + "one into; the identity-approval surface owns that control",
    };
  }
  if (action.resolution !== "approved") {
    return {
      state: "refused",
      reason: `the served gate action ${action.key} names no typed resolution`,
    };
  }
  if (served.approvalShape !== "one-click") {
    return {
      state: "refused",
      reason: `the server set this decision's ceremony to "${served.approvalShape}", so the EID must be `
        + "chosen rather than assumed; the identity-approval surface owns that choice",
    };
  }
  const [only, ...rest] = served.options;
  if (only === undefined || rest.length > 0) {
    return {
      state: "refused",
      reason: `a one-click approval names exactly one candidate and this packet shows `
        + `${String(served.options.length)}`,
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
      payload: {
        result: {
          schemaHash: served.resultSchemaHash,
          value: {
            decision: "approved",
            eid: only.eid,
            chosenFrom: only.chosenFrom,
            evidenceDigest: served.evidenceDigest,
          },
        },
      },
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
      return composeGateResult(action, context.gate, envelope);
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
