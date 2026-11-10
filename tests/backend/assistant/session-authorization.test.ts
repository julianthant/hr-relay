import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { createAssistantSessionAuthorization, type AssistantSessionPorts } from "../../../src/backend/assistant/authorization.js";
import { AssistantToolRefusal } from "../../../src/backend/assistant/plugins/plugin.js";
import { assistantToolRegistry, createAssistantPlugins } from "../../../src/backend/assistant/plugins/registry.js";
import { sessionsPlugin } from "../../../src/backend/assistant/plugins/sessions/index.js";
import { DESCRIPTORS } from "../../../src/backend/app/registries/workflow-registry.js";
import { AssistantAcceptedTurnSchema, AssistantSessionClaimSchema, type AssistantAcceptedTurn, type AssistantApprovalMode } from "../../../src/models/dashboard/assistant.js";
import type { StartPlanWire } from "../../../src/models/dashboard/start-plan.js";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import { CommandResultSchema, type CommandRequest } from "../../../src/rules/commands/commands.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { inMemorySessionClaims } from "../../support/helpers/assistant-session-claims.js";
import { personLookupQueuedRun } from "../../support/helpers/phase1f-executor-harness.js";

const T = "2026-11-09T12:00:00.000Z", hex = (digit: string) => digit.repeat(64);
const turn = (owner: { profileId: string; epoch: number }): AssistantAcceptedTurn => AssistantAcceptedTurnSchema.parse({ conversationId: randomUUID(), messageId: randomUUID(), ordinal: 1, acceptedRevision: 2,
  acceptedAt: T, profileId: owner.profileId, epoch: owner.epoch, proposalAnswer: null });
const refused = (error: unknown) => error instanceof AssistantToolRefusal && error.code === "ASSISTANT_PROPOSAL_REFUSED";

function sessions(options: Readonly<{ fullAccess?: boolean; result?: (command: CommandRequest, runIds: readonly string[]) => unknown; plan?: Partial<StartPlanWire> }> = {}) {
  const owner = { profileId: randomUUID(), epoch: 3 }, claims = inMemorySessionClaims(), submitted: { command: CommandRequest; attribution: unknown }[] = [];
  const plans: StartPlanWire[] = [], runs = new Map<string, unknown>();
  const ports: AssistantSessionPorts = { claims, descriptors: { resolve: id => DESCRIPTORS.find(descriptor => descriptor.id === id) }, served: () => true,
    plans: { plan(input) {
      const request = input as { workflowId: StartPlanWire["workflowId"]; dryRun: boolean; submissions: unknown[] };
      const plan = { wireVersion: 1, startPlanId: randomUUID(), workflowId: request.workflowId, expectedVersion: 1, expiresAt: T, dryRun: request.dryRun, priority: "normal",
        plannedBy: "local-operator", configSnapshotId: randomUUID(), refused: [],
        fingerprints: { descriptorFingerprint: hex("a"), configFingerprint: hex("b"), ingressSchemaHash: hex("c"), canonicalInputSchemaHash: hex("d"), inputFingerprint: hex("e") },
        planned: request.submissions.map((_, index) => ({ logicalKey: `k${String(index)}`, title: "Lookup", matchKey: `m${String(index)}` })), ...options.plan } as unknown as StartPlanWire;
      plans.push(plan); return plan;
    } },
    runs: { read: runId => ({ state: "present" as const, run: RunRecordSchema.parse(runs.get(runId)), disposition: "live" as const }) },
    async submit(command, attribution) {
      authorization.assertEffect(command.commandId, command);
      submitted.push({ command, attribution });
      const runIds = plans.at(-1)?.planned.map(() => randomUUID()) ?? [];
      for (const runId of runIds) runs.set(runId, personLookupQueuedRun({ runId, itemId: randomUUID() }));
      return CommandResultSchema.parse(options.result?.(command, runIds) ?? { state: "applied", commandId: command.commandId, affectedTargets: runIds.map(runId => ({ family: "run", runId })) });
    },
    browserMode: () => "headless", fullAccessAllowed: () => options.fullAccess ?? false, current: () => owner, clock: manualClock(new Date(T)), actorId: "local-operator" };
  const authorization = createAssistantSessionAuthorization(ports);
  const start = (accepted: AssistantAcceptedTurn, workflowId: string, entries: readonly string[], mode: AssistantApprovalMode = "ask") =>
    authorization.start(accepted, { workflowId, entries }, mode, new AbortController().signal, () => {});
  return { owner, claims, submitted, plans, authorization, start };
}

it("declares one tier per offered tool and refuses a tier its kind cannot carry", () => {
  const unused = () => { throw new Error("unused"); };
  const plugins = [...createAssistantPlugins({ findLookupRuns: unused, runReferenceLabel: unused, search: unused, runDetail: unused, notifications: unused, workbooks: unused,
    attachment: unused, settings: unused, facts: unused }), sessionsPlugin()];
  const tiers = new Set(assistantToolRegistry(plugins).tools.map(tool => tool.tier));
  assert.deepEqual([...tiers].sort(), ["read", "session"]);
  const [read] = plugins.flatMap(plugin => plugin.tools);
  assert.ok(read?.kind === "read");
  for (const tier of ["session", "write-local", "leaves-machine", "unknown"] as const)
    assert.throws(() => assistantToolRegistry([{ domain: "fixture", tools: [{ ...read, tier } as typeof read] }]), /assistant-tool-registry-invalid/u);
  assert.throws(() => assistantToolRegistry([{ domain: "fixture", tools: [{ ...sessionsPlugin().tools[0], tier: "read" }] }]), /assistant-tool-registry-invalid/u);
});

it("starts a transaction-free registered workflow in real mode under the accepted turn's attributed claim", async () => {
  const s = sessions(), accepted = turn(s.owner);
  const started = await s.start(accepted, "person-lookup", ["10000001", "10000002"]);
  assert.equal(started.length, 2);
  assert.equal(s.plans[0]?.dryRun, false);
  const [entry] = s.claims.all(), [sent] = s.submitted;
  assert.ok(entry && sent);
  assert.equal(entry.outcome.state, "started");
  assert.deepEqual(entry.outcome.state === "started" ? entry.outcome.runIds : [], started.map(run => run.envelope.runId));
  assert.deepEqual(sent.command, entry.claim.command);
  assert.equal(sent.command.source, "assistant");
  assert.deepEqual(sent.attribution, { kind: "assistant", requestedBy: "local-operator", profileId: s.owner.profileId, conversationId: accepted.conversationId,
    acceptedMessageId: accepted.messageId, binding: { kind: "session", actionId: entry.claim.actionId } });
  assert.throws(() => s.authorization.assertEffect(sent.command.commandId, sent.command), /custody-unproved/u);
  assert.doesNotThrow(() => s.authorization.assertEffect(randomUUID()));
});

it("keeps saving workflows proposed in ask mode, even as a dry run, and outside full access unless Settings allows it", async () => {
  const ask = sessions();
  await assert.rejects(ask.start(turn(ask.owner), "separations", ["4502"]), refused);
  await assert.rejects(ask.start(turn(ask.owner), "separations", ["4502"], "full-access"), refused);
  await assert.rejects(ask.start(turn(ask.owner), "onboarding", ["4502"], "full-access"), refused);
  await assert.rejects(ask.start(turn(ask.owner), "unregistered-workflow", ["4502"]), refused);
  assert.equal(ask.submitted.length + ask.claims.all().length + ask.plans.length, 0);
  const full = sessions({ fullAccess: true });
  await full.start(turn(full.owner), "separations", ["4502"], "full-access");
  assert.equal(full.plans[0]?.dryRun, true);
  assert.equal(full.claims.all()[0]?.claim.dryRun, true);
  await full.start(turn(full.owner), "person-lookup", ["10000001"], "full-access");
  assert.equal(full.plans[1]?.dryRun, false);
  assert.equal(AssistantSessionClaimSchema.safeParse({ ...full.claims.all()[0]?.claim, approvalMode: "ask" }).success, false);
});

it("claims one start per accepted message and request, refuses a stale owner and never reclaims an unknown outcome", async () => {
  const s = sessions(), accepted = turn(s.owner);
  await s.start(accepted, "person-lookup", ["10000001"]);
  await assert.rejects(s.start(accepted, "person-lookup", ["10000001"]), refused);
  await s.start(turn(s.owner), "person-lookup", ["10000001"]);
  assert.equal(s.submitted.length, 2);
  await assert.rejects(s.start(AssistantAcceptedTurnSchema.parse({ ...turn(s.owner), epoch: 4 }), "person-lookup", ["10000001"]), /owner-stale/u);
  assert.equal(s.submitted.length, 2);

  const pending = sessions({ result: command => ({ state: "pending", commandId: command.commandId }) }), pendingTurn = turn(pending.owner);
  await assert.rejects(pending.start(pendingTurn, "person-lookup", ["10000001"]), /settlement-unproved/u);
  assert.equal(pending.claims.all()[0]?.outcome.state, "unknown");
  await assert.rejects(pending.start(pendingTurn, "person-lookup", ["10000001"]), refused);
  assert.equal(pending.submitted.length, 1);

  const short = sessions({ result: (command, runIds) => ({ state: "applied", commandId: command.commandId, affectedTargets: runIds.slice(1).map(runId => ({ family: "run", runId })) }) });
  await assert.rejects(short.start(turn(short.owner), "person-lookup", ["10000001", "10000002"]), refused);
  assert.deepEqual(short.claims.all()[0]?.outcome, { state: "refused", code: "ASSISTANT_PROPOSAL_REFUSED" });
});

it("refuses a plan that would touch another run or refuse an entry", async () => {
  for (const plan of [{ refused: [{ entry: 1, code: "duplicate", message: "x" }] }, { omittedSteps: ["crm"] }] as Partial<StartPlanWire>[]) {
    const s = sessions({ plan });
    await assert.rejects(s.start(turn(s.owner), "person-lookup", ["10000001"]), refused);
    assert.equal(s.claims.all().length + s.submitted.length, 0);
  }
});
