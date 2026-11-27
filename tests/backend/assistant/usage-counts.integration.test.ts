import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { afterEach, it } from "vitest";
import { queryActivitySummaries } from "../../../src/backend/runs/queries/activity-summaries.js";
import type { AssistantM1Settlement } from "../../../src/models/dashboard/assistant.js";
import { CommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { createOperatorProjection } from "../../../src/backend/app/composition/dashboard/queue.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { openBoundDatabaseFixture } from "../../support/helpers/admission-fixture.js";
import { sqliteRunReader } from "../../support/helpers/canonical-run-reader.js";

const owners: { close(): Promise<void> }[] = [];
afterEach(async () => { for (const owner of owners.splice(0)) await owner.close(); });

async function world() {
  const fixture = await openBoundDatabaseFixture("assistant-usage-test");
  owners.push(fixture);
  const read = (from = "2026-11-01", to = "2026-11-03") => queryActivitySummaries(fixture.database,
    { from, to, generatedAt: "2026-11-06T20:00:00.000Z" },
    { descriptors: { resolve: () => undefined }, ledger: { foldActivityRange: () => ({ systems: [] }) } });
  fixture.database.bindAssistantEpoch(() => 1);
  const history = fixture.database.authority.assistantHistory;
  const usage = { state: "measured", callCount: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2 } as const;
  const send = (at: string, settledAt = at, reply?: AssistantM1Settlement["reply"]) => {
    const conversationId = randomUUID(), messageId = randomUUID();
    history.apply({ operation: "create", conversationId, title: "Private chat" }, at);
    const input = { conversationId, messageId, expectedRevision: 1, text: "Private question", modelText: "Private replay", subjectRef: null, attachments: [], proposalAnswer: null, now: at };
    const accepted = history.accept(input);
    if (accepted.state !== "accepted") assert.fail("turn not accepted");
    history.settle(accepted, reply === undefined ? { delivery: "refused", code: "ASSISTANT_LIMIT", usage } : { delivery: "answered", usage, reply }, settledAt);
    return { conversationId, messageId, input };
  };
  return { ...fixture, history, read, send };
}

it("serves every selected day as zero retained usage and identifies unrecorded counts", async () => {
  const w = await world(), report = w.read();
  assert.deepEqual(report.assistantMessages, { state: "retained-history", days: [
    { day: "2026-11-01", count: 0 }, { day: "2026-11-02", count: 0 }, { day: "2026-11-03", count: 0 },
  ] });
  assert.deepEqual(report.assistantTools, { state: "unavailable", reason: "not-recorded" });
  assert.deepEqual(report.assistantActions, { state: "retained-history", days: [
    { day: "2026-11-01", proposed: 0 }, { day: "2026-11-02", proposed: 0 }, { day: "2026-11-03", proposed: 0 },
  ], approved: { state: "unavailable", reason: "not-recorded" } });
});

it("counts retained native sends once by Pacific acceptance day across DST whatever the machine zone", async () => {
  const w = await world();
  w.send("2026-11-01T06:59:59.999Z");
  const first = w.send("2026-11-01T07:00:00.000Z");
  assert.equal(w.history.accept(first.input).state, "repeat");
  w.send("2026-11-01T08:30:00.000Z");
  w.send("2026-11-01T09:30:00.000Z");
  w.send("2026-11-02T07:59:59.999Z", "2026-11-02T08:01:00.000Z");
  w.send("2026-11-02T08:00:00.000Z");
  w.send("2026-11-04T07:59:59.999Z");
  w.send("2026-11-04T08:00:00.000Z");
  w.send("2026-10-01T12:00:00.000Z");
  const cleared = w.send("2026-11-02T12:00:00.000Z");
  w.history.apply({ operation: "clear", conversationId: cleared.conversationId, expectedRevision: 3 }, "2026-11-02T13:00:00.000Z");
  w.history.apply({ operation: "local", conversationId: first.conversationId, expectedRevision: 3, messageId: randomUUID(), text: "Private local text" }, "2026-11-02T12:00:00.000Z");
  w.history.apply({ operation: "import", conversationId: randomUUID(), title: "Private imported chat", draft: "", composer: "", notice: null, total: 1, start: 1,
    messages: [{ messageId: randomUUID(), role: "operator", text: "Private imported question" }] }, "2026-11-02T12:00:00.000Z");
  const foreign = await world();
  foreign.send("2026-11-02T12:00:00.000Z");
  const generation = w.database.getMeta().authorityGeneration, report = w.read();
  assert.deepEqual(report.assistantMessages.days, [
    { day: "2026-11-01", count: 4 }, { day: "2026-11-02", count: 1 }, { day: "2026-11-03", count: 1 },
  ]);
  const prior = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    assert.deepEqual(w.read().assistantMessages.days, report.assistantMessages.days);
  } finally { if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior; }
  assert.equal(w.database.getMeta().authorityGeneration, generation);
  assert.deepEqual(w.read("2026-10-01", "2026-10-01").assistantMessages.days, [{ day: "2026-10-01", count: 0 }]);
  assert.equal(JSON.stringify(report).includes("Private"), false);
});

it("wires the retained report to the same populated native usage source as the summary report", async () => {
  const w = await world(), clock = manualClock(new Date("2026-11-06T20:00:00.000Z"));
  w.send("2026-11-01T12:00:00.000Z");
  const projection = createOperatorProjection({ database: w.database, clock, stateRoot: dirname(w.path),
    reader: sqliteRunReader(w.database, clock), appVersion: "0.1.0", descriptorSetHash: FingerprintSchema.parse("a".repeat(64)),
    descriptors: { resolve: () => undefined }, ledger: createTransactionHistory(w.database.authority) });
  const expected = projection.buildActivityReportWire("2026-11-01", "2026-11-03");
  const actual = w.read("2026-11-01", "2026-11-03");
  assert.ok(actual.volume);
  assert.equal(expected.assistantMessages.days[0]?.count, 1);
  assert.deepEqual(actual, expected);
});

it("counts distinct real proposals at their first creation and excludes notification outcome captions", async () => {
  const w = await world(), authorization = w.database.authority.assistantAuthorization;
  const at = "2026-11-02T08:00:00.000Z", expiresAt = "2026-11-02T09:00:00.000Z";
  const proposal = (actionId: string, createdAt: string) => w.send(createdAt, createdAt,
    { id: randomUUID(), kind: "proposal", actionId, parts: [{ kind: "text", runs: [{ kind: "plain", text: "Private proposal" }] }], modelText: "Private replay" });
  const action = (type: "pause" | "notification-read") => {
    const id = randomUUID(), chatId = randomUUID(), profileId = w.database.getMeta().profileId;
    const command = CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: at, requestedBy: "local-operator", source: "assistant",
      ...(type === "pause" ? { family: "run", type, target: { runId: randomUUID(), expectedVersion: 1 } }
        : { family: "notification", type, target: { notificationId: randomUUID(), actorId: "local-operator", expectedVersion: 1 } }) });
    authorization.createChat({ id: chatId, profileId, epoch: 1, createdAt: at, expiresAt });
    authorization.createAction({ id, chatId, manifest: { revision: 1, entries: [] },
      binding: { profileId, accountSessionEpoch: 1, manifestRevision: 1, family: command.family, action: command.type, classification: "local-write",
        commandId: command.commandId, target: command.target, subject: { kind: "none" }, options: { kind: "none" }, configDescriptor: { kind: "none" } },
      command, plan: null, revision: 1, state: "prepared", result: null, createdAt: at, expiresAt });
    authorization.transition(id, 1, "approved");
    return id;
  };
  const spreadsheet = randomUUID(), earlier = randomUUID();
  proposal(spreadsheet, "2026-11-02T07:59:59.999Z");
  proposal(spreadsheet, "2026-11-03T12:00:00.000Z");
  proposal(earlier, "2026-10-31T12:00:00.000Z");
  proposal(earlier, "2026-11-02T12:00:00.000Z");
  proposal(action("pause"), at);
  proposal(action("notification-read"), "2026-11-03T12:00:00.000Z");
  const report = w.read();
  assert.deepEqual(report.assistantActions, { state: "retained-history", days: [
    { day: "2026-11-01", proposed: 1 }, { day: "2026-11-02", proposed: 1 }, { day: "2026-11-03", proposed: 0 },
  ], approved: { state: "unavailable", reason: "not-recorded" } });
  assert.equal(JSON.stringify(report).includes(spreadsheet), false);
});
