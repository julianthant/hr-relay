import { randomUUID } from "node:crypto";
import { AssistantSessionClaimSchema, AssistantSessionOutcomeSchema, type AssistantAcceptedTurn, type AssistantApprovalMode, type AssistantSessionClaim, type AssistantSessionOutcome } from "../../../src/models/dashboard/assistant.js";
import { createAssistantSessionAuthorization, type AssistantSessionClaims, type AssistantSessionPorts } from "../../../src/backend/assistant/authorization.js";
import { DESCRIPTORS } from "../../../src/backend/app/registries/workflow-registry.js";
import type { StartPlanWire } from "../../../src/models/dashboard/start-plan.js";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import { CommandResultSchema, type CommandRequest } from "../../../src/rules/commands/commands.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { personLookupQueuedRun } from "./phase1f-executor-harness.js";

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

const T = "2026-11-09T12:00:00.000Z", hex = (digit: string) => digit.repeat(64);
type Owner = { readonly profileId: string; readonly epoch: number };

/** The real session owner over fake plan/submit/run ports; `submit` runs the effect hook before its effect, like the command kernel. */
export function sessionAuthorizationFixture(options: Readonly<{ fullAccess?: boolean; current?: () => Owner; at?: string;
  result?: (command: CommandRequest, runIds: readonly string[]) => unknown; plan?: Partial<StartPlanWire>;
  beforePrepare?: () => Promise<void>; beforeEffect?: () => Promise<void> }> = {}) {
  const owner = { profileId: randomUUID(), epoch: 3 }, claims = inMemorySessionClaims(), submitted: { command: CommandRequest; attribution: unknown }[] = [];
  const plans: StartPlanWire[] = [], runs = new Map<string, unknown>(), at = options.at ?? T, { beforePrepare } = options;
  let fullAccess = options.fullAccess ?? false;
  const ports: AssistantSessionPorts = { claims, descriptors: { resolve: id => DESCRIPTORS.find(descriptor => descriptor.id === id) }, served: () => true,
    plans: { ...(beforePrepare === undefined ? {} : { prepare: () => beforePrepare() }), plan(input) {
      const request = input as { workflowId: StartPlanWire["workflowId"]; dryRun: boolean; submissions: unknown[] };
      const plan = { wireVersion: 1, startPlanId: randomUUID(), workflowId: request.workflowId, expectedVersion: 1, expiresAt: at, dryRun: request.dryRun, priority: "normal",
        plannedBy: "local-operator", configSnapshotId: randomUUID(), refused: [],
        fingerprints: { descriptorFingerprint: hex("a"), configFingerprint: hex("b"), ingressSchemaHash: hex("c"), canonicalInputSchemaHash: hex("d"), inputFingerprint: hex("e") },
        planned: request.submissions.map((_, index) => ({ logicalKey: `k${String(index)}`, title: "Lookup", matchKey: `m${String(index)}` })), ...options.plan } as unknown as StartPlanWire;
      plans.push(plan); return plan;
    } },
    runs: { read: runId => ({ state: "present" as const, run: RunRecordSchema.parse(runs.get(runId)), disposition: "live" as const }) },
    async submit(command, attribution) {
      await options.beforeEffect?.();
      authorization.assertEffect(command.commandId, command);
      submitted.push({ command, attribution });
      const runIds = plans.at(-1)?.planned.map(() => randomUUID()) ?? [];
      for (const runId of runIds) runs.set(runId, personLookupQueuedRun({ runId, itemId: randomUUID() }));
      return CommandResultSchema.parse(options.result?.(command, runIds) ?? { state: "applied", commandId: command.commandId, affectedTargets: runIds.map(runId => ({ family: "run", runId })) });
    },
    browserMode: () => "headless", fullAccessAllowed: () => fullAccess, current: options.current ?? (() => owner), clock: manualClock(new Date(at)), actorId: "local-operator" };
  const authorization = createAssistantSessionAuthorization(ports);
  const start = (accepted: AssistantAcceptedTurn, workflowId: string, entries: readonly string[], mode: AssistantApprovalMode = "ask", assertCurrent = () => {}) =>
    authorization.start(accepted, { workflowId, entries }, mode, new AbortController().signal, assertCurrent);
  return { owner, claims, submitted, plans, authorization, start, setFullAccess(next: boolean) { fullAccess = next; } };
}
