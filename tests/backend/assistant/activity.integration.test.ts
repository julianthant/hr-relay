import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { Hono } from "hono";
import { createAssistantActivityQuery } from "../../../src/backend/assistant/activity.js";
import type { AssistantM1HistoryRepository } from "../../../src/backend/storage/sqlite/assistant-history.js";
import { registerAssistantRoutes } from "../../../src/backend/transports/http/routes/assistant.js";
import type { DashboardApp } from "../../../src/backend/transports/http/routes/api-types.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { CommandRequestSchema, NotificationCommandRequestSchema, StartCommandRequestSchema, type CommandResult } from "../../../src/rules/commands/commands.js";
import { RunIdSchema } from "../../../src/rules/identity/ids.js";
import { openBoundDatabaseFixture } from "../../support/helpers/admission-fixture.js";
import { runRecordOf } from "../../support/helpers/backend/dashboard-harness.js";
import { CONFIG_SNAPSHOT } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { seedSyntheticRuntimeConfig } from "../../support/fixtures/operator-command-fixtures.js";
import { testWorkerPorts } from "../../support/fixtures/run-lifecycle-fixtures.js";
import { personLookupDescriptor } from "../../support/helpers/registered-workflows.js";

const owners: { close(): Promise<void> }[] = [];
const USAGE = { state: "measured", callCount: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2 } as const;
const words = (text: string) => [{ kind: "text" as const, runs: [{ kind: "plain" as const, text }] }];
/** One accepted operator turn in a new chat's first revision. */
function accept(history: AssistantM1HistoryRepository, input: Readonly<{ conversationId: string; messageId: string; text: string; modelText: string; now: string }>) {
  const accepted = history.accept({ ...input, expectedRevision: 1, subjectRef: null, attachments: [], proposalAnswer: null });
  if (accepted.state !== "accepted") assert.fail("turn not accepted");
  return accepted;
}
afterEach(async () => { for (const owner of owners.splice(0)) await owner.close(); });

async function world(assertCurrent: () => void = () => {}) {
  const fixture = await openBoundDatabaseFixture("assistant-activity-test"); owners.push(fixture);
  const clock = manualClock(new Date("2026-11-06T20:00:00.000Z"));
  fixture.database.bindAssistantEpoch(() => 1);
  const history = fixture.database.authority.assistantHistory;
  const query = createAssistantActivityQuery({ database: fixture.database, clock,
    assertCurrent, workflowLabel: () => "Person Lookup" });
  const refuse = (acceptedAt: string, settledAt: string) => {
    const conversationId = randomUUID(), messageId = randomUUID();
    history.apply({ operation: "create", conversationId, title: "Private chat title" }, acceptedAt);
    history.settle(accept(history, { conversationId, messageId, text: "Private question", modelText: "Private model text", now: acceptedAt }),
      { delivery: "refused", code: "ASSISTANT_LIMIT", usage: USAGE }, settledAt);
    return messageId;
  };
  return { ...fixture, clock, history, query, refuse };
}

it("serves uncached activity through HTTP, validates search, and refuses unavailable profile reads", async () => {
  let current = true;
  const w = await world(() => { if (!current) throw new Error("Private profile context expired"); });
  const id = w.refuse("2026-11-06T10:00:00.000Z", "2026-11-06T10:01:00.000Z");
  const app: DashboardApp = new Hono();
  registerAssistantRoutes(app, { async respond() { throw new Error("unexpected inference"); }, activity: w.query.read });
  const url = "http://127.0.0.1:3938/api/v1/assistant/activity";
  const response = await app.request(`${url}?search=REFUSED`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { day: "2026-11-06", rows: [{ id, label: "Request refused", at: "2026-11-06T10:01:00.000Z" }] });
  assert.deepEqual(await (await app.request(`${url}?search=Private`)).json(), { day: "2026-11-06", rows: [] });
  assert.equal((await app.request(`${url}?search=${"x".repeat(201)}`)).status, 400);
  assert.equal((await app.request(`${url}?profileId=${randomUUID()}`)).status, 400);
  current = false;
  const stale = await app.request(url);
  assert.equal(stale.status, 503);
  assert.equal(stale.headers.get("cache-control"), "no-store");
  assert.equal((await stale.text()).includes("Private"), false);
  const unavailable: DashboardApp = new Hono(); registerAssistantRoutes(unavailable, undefined);
  assert.equal((await unavailable.request(url)).status, 503);
});

it("serves recorded refusals by settlement time in the dashboard day, newest first, without message text", async () => {
  const w = await world();
  const first = w.refuse("2026-11-06T07:59:00.000Z", "2026-11-06T08:00:00.000Z");
  w.refuse("2026-11-06T07:00:00.000Z", "2026-11-06T07:59:59.999Z");
  const last = w.refuse("2026-11-06T19:00:00.000Z", "2026-11-06T19:01:00.000Z");
  assert.deepEqual(w.query.read(), { day: "2026-11-06", rows: [
    { id: last, label: "Request refused", at: "2026-11-06T19:01:00.000Z" },
    { id: first, label: "Request refused", at: "2026-11-06T08:00:00.000Z" },
  ] });
});

it.each(["applied", "rejected"] as const)("serves %s notification edits at their audit time without history messages or notification values", async outcome => {
  const w = await world(), profileId = w.database.getMeta().profileId;
  const at = "2026-11-06T07:59:00.000Z", completedAt = "2026-11-06T08:00:00.000Z", expiresAt = "2026-11-06T08:01:00.000Z";
  const authorization = w.database.authority.assistantAuthorization, id = randomUUID(), chatId = randomUUID();
  const command = NotificationCommandRequestSchema.options[0].parse({ commandId: randomUUID(), requestedAt: at, requestedBy: "local-operator", source: "assistant",
    family: "notification", type: "notification-read", target: { notificationId: randomUUID(), actorId: "local-operator", expectedVersion: 1 } });
  authorization.createChat({ id: chatId, profileId, epoch: 1, createdAt: at, expiresAt });
  authorization.createAction({ id, chatId, manifest: { revision: 1, entries: [] },
    binding: { profileId, accountSessionEpoch: 1, manifestRevision: 1, family: "notification", action: command.type, classification: "local-write",
      commandId: command.commandId, target: command.target, subject: { kind: "none" }, options: { kind: "none" }, configDescriptor: { kind: "none" } },
    command, plan: null, revision: 1, state: "prepared", result: null, createdAt: at, expiresAt });
  const result: CommandResult = outcome === "applied" ? { state: "applied", commandId: command.commandId, affectedTargets: [{ family: "notification", notificationId: command.target.notificationId }] }
    : { state: "rejected", commandId: command.commandId, code: "policy-refused", message: "Private notification detail" };
  authorization.transition(id, 1, "approved"); authorization.transition(id, 2, "claimed"); authorization.transition(id, 3, "settled", result);
  w.database.authority.commands.insert(command);
  w.database.authority.commandAudits.insert({ auditId: randomUUID(), request: command, result, completedAt, versionChanges: [], affectedDependencyIds: [] });
  const label = outcome === "applied" ? "Marked notification read" : "Refused: Mark notification read";
  const generation = w.database.getMeta().authorityGeneration;
  assert.deepEqual(w.query.read(), { day: "2026-11-06", rows: [{ id, label, at: completedAt }] });
  assert.equal(w.database.getMeta().authorityGeneration, generation);
  assert.deepEqual(w.query.read("private").rows, []);
  assert.equal(w.query.read("NOTIFICATION").rows.length, 1);
  const foreign = await world();
  assert.deepEqual(foreign.query.read().rows, []);
  w.clock.setWall(new Date("2026-11-07T08:00:00.000Z"));
  assert.deepEqual(w.query.read(), { day: "2026-11-07", rows: [] });
});

it("searches the name line case-insensitively, ignores private chat content, and serves an empty new day", async () => {
  const w = await world(), id = w.refuse("2026-11-06T10:00:00.000Z", "2026-11-06T10:01:00.000Z");
  assert.deepEqual(w.query.read("  REFUSED  ").rows, [{ id, label: "Request refused", at: "2026-11-06T10:01:00.000Z" }]);
  assert.deepEqual(w.query.read("Private").rows, []);
  assert.throws(() => w.query.read("x".repeat(201)));
  w.clock.setWall(new Date("2026-11-07T08:00:00.000Z"));
  assert.deepEqual(w.query.read(), { day: "2026-11-07", rows: [] });
});

it("serves an old proposal's metadata without guessing a spreadsheet action from its caption", async () => {
  const w = await world(), conversationId = randomUUID(), messageId = randomUUID(), proposalId = randomUUID(), actionId = randomUUID();
  const proposedAt = "2026-11-06T10:00:00.000Z";
  w.history.apply({ operation: "create", conversationId, title: "Private title" }, proposedAt);
  w.history.settle(accept(w.history, { conversationId, messageId, text: "Private question", modelText: "Private text", now: proposedAt }),
    { delivery: "answered", usage: USAGE, reply: { id: proposalId, kind: "proposal", actionId, parts: words("Private spreadsheet caption"), modelText: "Private replay caption" } }, proposedAt);
  assert.deepEqual(w.query.read(), { day: "2026-11-06", rows: [{ id: proposalId, label: "Proposed change", at: proposedAt }] });
  assert.deepEqual(w.query.read("spreadsheet").rows, []);
});

it("names an old card's canonical proposal from its action metadata, whatever the action's outcome", async () => {
  const w = await world(), profileId = w.database.getMeta().profileId;
  const at = "2026-11-06T12:00:00.000Z", expiresAt = "2026-11-07T12:00:00.000Z";
  const authorization = w.database.authority.assistantAuthorization;
  for (const outcome of ["applied", "cancelled", "rejected", "unknown"] as const) {
    const conversationId = randomUUID(), messageId = randomUUID(), proposalId = randomUUID(), actionId = randomUUID(), chatId = randomUUID();
    const fingerprint = "a".repeat(64);
    const command = StartCommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: at, requestedBy: "local-operator", source: "assistant",
      family: "start", type: "start-run", target: { workflowId: "person-lookup", startPlanId: randomUUID(), expectedVersion: 1 },
      payload: { descriptorFingerprint: fingerprint, configFingerprint: fingerprint, ingressSchemaHash: fingerprint, canonicalInputSchemaHash: fingerprint, inputFingerprint: fingerprint } });
    authorization.createChat({ id: chatId, profileId, epoch: 1, createdAt: at, expiresAt });
    authorization.createAction({ id: actionId, chatId, manifest: { revision: 1, entries: [] },
      binding: { profileId, accountSessionEpoch: 1, manifestRevision: 1, family: "start", action: "start-run", classification: "external-submit",
        commandId: command.commandId, target: command.target, subject: { kind: "none" }, options: { kind: "none" }, configDescriptor: { kind: "none" } },
      command, plan: { startPlanId: command.target.startPlanId, version: 1, ...command.payload, expiresAt },
      revision: 1, state: "prepared", result: null, createdAt: at, expiresAt });
    w.history.apply({ operation: "create", conversationId, title: "Private name" }, at);
    w.history.settle(accept(w.history, { conversationId, messageId, text: "Private question", modelText: "Private replay", now: at }),
      { delivery: "answered", usage: USAGE, reply: { id: proposalId, kind: "proposal", actionId, parts: words("Private proposal"), modelText: "Private reply" } }, at);
    if (outcome === "cancelled") authorization.transition(actionId, 1, "cancelled");
    else {
      authorization.transition(actionId, 1, "approved"); authorization.transition(actionId, 2, "claimed");
      if (outcome === "unknown") authorization.transition(actionId, 3, "unknown");
      else authorization.transition(actionId, 3, "settled", outcome === "applied"
        ? { state: "applied", commandId: command.commandId, affectedTargets: [{ family: "run", runId: RunIdSchema.parse(randomUUID()) }] }
        : { state: "rejected", commandId: command.commandId, code: "policy-refused", message: "Private refusal detail" });
    }
    const rows = w.query.read().rows;
    assert.deepEqual(rows.find(row => row.id === proposalId), { id: proposalId, label: "Proposed: Start Person Lookup", at });
  }
});

it.each([true, false])("names a run action without exposing its display name (run retained: %s)", async retained => {
  const w = await world(), profileId = w.database.getMeta().profileId;
  const at = "2026-11-06T12:00:00.000Z", expiresAt = "2026-11-06T13:00:00.000Z";
  const run = runRecordOf({ seed: 71, displayName: "Private person and run title" });
  if (retained) {
    seedSyntheticRuntimeConfig(w.database);
    w.database.authority.configSnapshots.insert(CONFIG_SNAPSHOT);
    testWorkerPorts(w.database, w.clock, { path: w.path, descriptor: personLookupDescriptor, poolIndex: 1 });
    w.database.authority.runs.enqueue(run);
  }
  const command = CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: at, requestedBy: "local-operator", source: "assistant",
    family: "run", type: "pause", target: { runId: run.envelope.runId, expectedVersion: run.version } });
  const authorization = w.database.authority.assistantAuthorization, chatId = randomUUID(), actionId = randomUUID();
  authorization.createChat({ id: chatId, profileId, epoch: 1, createdAt: at, expiresAt });
  authorization.createAction({ id: actionId, chatId, manifest: { revision: 1, entries: [] },
    binding: { profileId, accountSessionEpoch: 1, manifestRevision: 1, family: "run", action: "pause", classification: "local-write",
      commandId: command.commandId, target: command.target, subject: { kind: "none" }, options: { kind: "none" }, configDescriptor: { kind: "none" } },
    command, plan: null, revision: 1, state: "prepared", result: null, createdAt: at, expiresAt });
  const conversationId = randomUUID(), messageId = randomUUID(), id = randomUUID();
  w.history.apply({ operation: "create", conversationId, title: "Private chat title" }, at);
  w.history.settle(accept(w.history, { conversationId, messageId, text: "Private question", modelText: "Private model text", now: at }),
    { delivery: "answered", usage: USAGE, reply: { id, kind: "proposal", actionId, parts: words("Private caption"), modelText: "Private caption" } }, at);
  assert.deepEqual(w.query.read().rows, [{ id, label: retained ? "Proposed: Pause Person Lookup" : "Proposed: Pause a run after its current step", at }]);
});
