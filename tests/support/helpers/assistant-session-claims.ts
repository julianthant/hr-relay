import { AssistantSessionClaimSchema, AssistantSessionOutcomeSchema, type AssistantSessionClaim, type AssistantSessionOutcome } from "../../../src/models/dashboard/assistant.js";
import type { AssistantSessionClaims } from "../../../src/backend/assistant/authorization.js";

/** In-memory session claim owner with the durable owner's once-only rules. */
export function inMemorySessionClaims(): AssistantSessionClaims & { all(): readonly Readonly<{ claim: AssistantSessionClaim; outcome: AssistantSessionOutcome }>[] } {
  const rows = new Map<string, { claim: AssistantSessionClaim; outcome: AssistantSessionOutcome }>();
  return {
    claim(input) {
      const claim = AssistantSessionClaimSchema.parse(input);
      if ([...rows.values()].some(row => row.claim.actionId === claim.actionId || row.claim.command.commandId === claim.command.commandId
        || (row.claim.acceptedTurn.messageId === claim.acceptedTurn.messageId && row.claim.requestDigest === claim.requestDigest))) return false;
      rows.set(claim.actionId, { claim, outcome: { state: "claimed" } });
      return true;
    },
    settle(actionId, outcome) {
      const row = rows.get(actionId);
      if (row?.outcome.state !== "claimed") throw new Error("assistant-session-claim-not-claimed");
      row.outcome = AssistantSessionOutcomeSchema.parse(outcome);
    },
    byCommand: commandId => [...rows.values()].find(row => row.claim.command.commandId === commandId),
    all: () => [...rows.values()],
  };
}
