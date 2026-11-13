import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { AssistantToolRefusal } from "../../../src/backend/assistant/plugins/plugin.js";
import { assistantToolRegistry, createAssistantPlugins } from "../../../src/backend/assistant/plugins/registry.js";
import { sessionsPlugin } from "../../../src/backend/assistant/plugins/sessions/index.js";
import { AssistantAcceptedTurnSchema, AssistantSessionClaimSchema, type AssistantAcceptedTurn } from "../../../src/models/dashboard/assistant.js";
import type { StartPlanWire } from "../../../src/models/dashboard/start-plan.js";
import { sessionAuthorizationFixture } from "../../support/helpers/assistant-session-claims.js";

const T = "2026-11-09T12:00:00.000Z";
const turn = (owner: { profileId: string; epoch: number }): AssistantAcceptedTurn => AssistantAcceptedTurnSchema.parse({ conversationId: randomUUID(), messageId: randomUUID(), ordinal: 1, acceptedRevision: 2,
  acceptedAt: T, profileId: owner.profileId, epoch: owner.epoch, proposalAnswer: null });
const refused = (error: unknown) => error instanceof AssistantToolRefusal && error.code === "ASSISTANT_PROPOSAL_REFUSED";

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
  const s = sessionAuthorizationFixture(), accepted = turn(s.owner);
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
  const ask = sessionAuthorizationFixture();
  await assert.rejects(ask.start(turn(ask.owner), "separations", ["4502"]), refused);
  await assert.rejects(ask.start(turn(ask.owner), "separations", ["4502"], "full-access"), refused);
  await assert.rejects(ask.start(turn(ask.owner), "onboarding", ["4502"], "full-access"), refused);
  await assert.rejects(ask.start(turn(ask.owner), "unregistered-workflow", ["4502"]), refused);
  assert.equal(ask.submitted.length + ask.claims.all().length + ask.plans.length, 0);
  const full = sessionAuthorizationFixture({ fullAccess: true });
  await full.start(turn(full.owner), "separations", ["4502"], "full-access");
  assert.equal(full.plans[0]?.dryRun, true);
  assert.equal(full.claims.all()[0]?.claim.dryRun, true);
  await full.start(turn(full.owner), "person-lookup", ["10000001"], "full-access");
  assert.equal(full.plans[1]?.dryRun, false);
  assert.equal(AssistantSessionClaimSchema.safeParse({ ...full.claims.all()[0]?.claim, approvalMode: "ask" }).success, false);
});

it("claims one start per accepted message and request, refuses a stale owner and never reclaims an unknown outcome", async () => {
  const s = sessionAuthorizationFixture(), accepted = turn(s.owner);
  await s.start(accepted, "person-lookup", ["10000001"]);
  await assert.rejects(s.start(accepted, "person-lookup", ["10000001"]), refused);
  await s.start(turn(s.owner), "person-lookup", ["10000001"]);
  assert.equal(s.submitted.length, 2);
  await assert.rejects(s.start(AssistantAcceptedTurnSchema.parse({ ...turn(s.owner), epoch: 4 }), "person-lookup", ["10000001"]), /owner-stale/u);
  assert.equal(s.submitted.length, 2);

  const pending = sessionAuthorizationFixture({ result: command => ({ state: "pending", commandId: command.commandId }) }), pendingTurn = turn(pending.owner);
  await assert.rejects(pending.start(pendingTurn, "person-lookup", ["10000001"]), /settlement-unproved/u);
  assert.equal(pending.claims.all()[0]?.outcome.state, "unknown");
  await assert.rejects(pending.start(pendingTurn, "person-lookup", ["10000001"]), refused);
  assert.equal(pending.submitted.length, 1);

  const short = sessionAuthorizationFixture({ result: (command, runIds) => ({ state: "applied", commandId: command.commandId, affectedTargets: runIds.slice(1).map(runId => ({ family: "run", runId })) }) });
  await assert.rejects(short.start(turn(short.owner), "person-lookup", ["10000001", "10000002"]), refused);
  assert.deepEqual(short.claims.all()[0]?.outcome, { state: "refused", code: "ASSISTANT_PROPOSAL_REFUSED" });
});

it("refuses a plan that would touch another run or refuse an entry", async () => {
  for (const plan of [{ refused: [{ entry: 1, code: "duplicate", message: "x" }] }, { omittedSteps: ["crm"] }] as Partial<StartPlanWire>[]) {
    const s = sessionAuthorizationFixture({ plan });
    await assert.rejects(s.start(turn(s.owner), "person-lookup", ["10000001"]), refused);
    assert.equal(s.claims.all().length + s.submitted.length, 0);
  }
});

function held() { let release = () => {}; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
for (const fault of ["none", "turn retired", "full access off before planning", "full access off during submit"] as const)
  it(`rechecks the accepted turn and Full access through a held dry-run start (${fault})`, async () => {
    const prepare = held(), waiting = held(), effect = held();
    const s = sessionAuthorizationFixture({ fullAccess: true, beforePrepare: () => prepare.promise, beforeEffect: () => { waiting.release(); return effect.promise; } });
    let retired = false;
    const started = s.start(turn(s.owner), "separations", ["4502"], "full-access", () => { if (retired) throw new Error("assistant-turn-retired"); });
    if (fault === "full access off before planning") s.setFullAccess(false);
    prepare.release();
    if (fault !== "full access off before planning") {
      await waiting.promise;
      if (fault === "turn retired") retired = true;
      if (fault === "full access off during submit") s.setFullAccess(false);
      effect.release();
    }
    if (fault === "none") { await started; assert.equal(s.submitted.length, 1); assert.equal(s.claims.all()[0]?.outcome.state, "started"); return; }
    await assert.rejects(started, fault === "turn retired" ? /assistant-turn-retired/u : refused);
    assert.equal(s.submitted.length, 0);
    assert.deepEqual(s.claims.all().map(entry => entry.outcome.state), fault === "full access off before planning" ? [] : ["unknown"]);
  });
