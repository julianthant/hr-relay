/** Turning a SERVED action descriptor into the ONE command envelope (ref frontend-backend-integration
 * §3.4), for the confirm-first flow the app root mounts. */
import { systemClock } from "../../../rules/time/clock.js";
import type { ActionDescriptorWire } from "../../../models/dashboard/actions.js";
import { directIdentifierDisplay } from "../../../rules/redaction/redaction.js";
import type { ActionTarget } from "../../surfaces/shared/actions/actions.js";
import {
  identityCeremonyFor,
  identityDraftProblem,
  optionFor,
  type IdentityGateAnswer,
  type IdentityGatePayload,
} from "../../surfaces/run-detail/identity/identity-ceremony.js";
import { renameDraftProblem } from "../../surfaces/run-detail/identity/rename-draft.js";

export type CommandAction = Extract<ActionDescriptorWire, { kind: "command" }>;

/** What the app can say about a descriptor it was asked to dispatch; `refused`
 * is a legitimate answer with a sentence the surface reports. */
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
  /** the surface the operator pressed the control */
  readonly source: "queue" | "run-detail";
  /** the gate section the run advertised, when one is open */
  readonly gate?: IdentityGatePayload | undefined;
  /** What the operator answered in the ceremony dialog. It is OPTIONAL because
 * exactly one ceremony needs no answer — a `one-click` packet naming one */
  readonly gateAnswer?: IdentityGateAnswer | undefined;
  /** What the operator typed into the rename dialog, already judged by `renameDraftProblem` */
  readonly renameAnswer?: string | undefined;
  /** retained request identity for replay and in-flight protection */
  readonly commandId?: string | undefined;
  readonly requestedAt?: string | undefined;
}

/** The identity gate's answer: the operator's decision, wearing the server's
 * facts. */
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
// ceremony, so this is unreachable — and it refuses rather than asserting
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
      reason: `EID ${decided.decision === "approved" ? directIdentifierDisplay(decided.eid) : "unavailable"} is not among the candidates `
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

/** Refuse unknown served verbs by name; never turn new commands into silent no-ops. */
export function composeCommandRequest(
  action: CommandAction,
  target: ActionTarget,
  context: CommandContext,
): ComposedCommand {
  const envelope = {
    commandId: context.commandId ?? crypto.randomUUID(),
    requestedAt: context.requestedAt ?? systemClock.now().toISOString(),
    requestedBy: context.actorId,
    source: context.source,
  };
  switch (action.command) {
    case "retry":
    case "restart":
      return { state: "refused", reason: "Open Rerun to review steps and values before starting a new run." };
    case "archive":
      return { state: "refused", reason: "Archive page removed" };
    case "cancel":
    case "bump":
    case "delete":
      /* Rename requires a value; target-only destructive commands use the served confirmation. */
      return {
        state: "ready",
        request: {
          ...envelope,
          family: "run",
          type: action.command,
          target: { runId: target.runId, expectedVersion: action.expectedVersion },
        },
      };
    case "rename": {
      /* Human-authored values must accompany the call; never invent a missing answer. */
      const answer = context.renameAnswer;
      if (answer === undefined) {
        return {
          state: "refused",
          reason: "no name was supplied; the rename dialog owns that value and nothing here may author one",
        };
      }
      const problem = renameDraftProblem(answer);
      if (problem !== undefined) return { state: "refused", reason: problem };
      return {
        state: "ready",
        request: {
          ...envelope,
          family: "run",
          type: "rename",
          target: { runId: target.runId, expectedVersion: action.expectedVersion },
          payload: { displayName: answer.trim() },
        },
      };
    }
    case "resolve-gate":
      return composeGateResult(action, context.gate, context.gateAnswer, envelope);
    case "resolve-write-present":
    case "resolve-write-absent":
      // Park resolutions use the evidence-note dialog; this composer cannot carry that required proof.
      return {
        state: "refused",
        reason: `${action.command} is answered by the parked-write dialog, not by this dispatcher`,
      };
  }
}

export { composeStopWorkerCommand, composePlanWorkerCountCommand, composeSpawnWorkerCommand } from "./worker-command-dispatch.js";
