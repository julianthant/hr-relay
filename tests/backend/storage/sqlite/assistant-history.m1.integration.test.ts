import { aggregateAssistantUsage } from "../../../../src/models/dashboard/assistant-usage.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { assistantMessageFromRow, assistantM1MessageFromRow } from "../../../../src/backend/storage/sqlite/assistant-history.js";
import { assistantM1HistoryFixture } from "../../../support/helpers/assistant-m1-history-fixture.js";
import { ASSISTANT_CHATS_MAX, AssistantM1MessagePayloadSchema } from "../../../../src/models/dashboard/assistant.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";

const NOW = "2026-11-08T12:00:00.000Z", LATER = "2026-11-08T12:05:00.000Z";
const databases: DatabaseSync[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
const parts = (text: string) => [{ kind: "text" as const, runs: [{ kind: "plain" as const, text }] }];
function world() {
  const fixture = assistantM1HistoryFixture({ now: NOW, acceptedAt: LATER }); databases.push(fixture.database); return fixture;
}

it("prepares real accepted metadata, pending usage and one atomic structured reply settlement", () => {
  const w = world(), id = w.create(), input = w.input(id), accepted = w.history.accept(input);
  assert.equal(accepted.state, "accepted"); if (accepted.state !== "accepted") assert.fail();
  assert.equal(accepted.conversationCreatedAt, NOW);
  assert.deepEqual(accepted.acceptedTurn, { conversationId: id, messageId: input.messageId, ordinal: 1, acceptedRevision: 2,
    acceptedAt: LATER, profileId: w.profileId(), epoch: 7, proposalAnswer: null });
  assert.throws(() => assistantMessageFromRow(w.database.prepare("SELECT * FROM assistant_messages").get()), "the active reader has no next-format fallback");
  const before = w.history.conversation(id, LATER); assert.ok(before);
  assert.deepEqual(before.messages[0]?.payload.recording, { kind: "accepted-turn", acceptedTurn: accepted.acceptedTurn, usage: { state: "pending" } });
  const generation = w.generation();
  assert.equal(w.history.accept({ ...input, expectedRevision: 1 }).state, "repeat"); assert.equal(w.generation(), generation);
  assert.throws(() => w.history.accept({ ...input, modelText: "changed" }));
  assert.equal(w.history.sending(accepted, LATER), true);
  const usage = aggregateAssistantUsage([{ state: "measured", inputTokens: 5, outputTokens: 3, totalTokens: 8 }]);
  const replyId = randomUUID();
  assert.equal(w.history.settle(accepted, { delivery: "answered", usage,
    reply: { id: replyId, kind: "answer", parts: parts("Server answer"), modelText: "Answer [[R1.g1]]" } }, LATER), 3);
  const view = w.history.conversation(id, LATER); assert.ok(view);
  assert.deepEqual(view.messages.map(row => row.payload.recording), [
    { kind: "accepted-turn", acceptedTurn: accepted.acceptedTurn, usage }, { kind: "reply", acceptedMessageId: input.messageId }]);
  assert.deepEqual(view.messages[1]?.payload.parts, parts("Server answer"));
  assert.equal(JSON.stringify(view).includes("modelText"), false); assert.equal(JSON.stringify(view).includes("subjectRef"), false);
  assert.deepEqual(w.history.replay(id, 3, LATER), [{ role: "operator", modelText: input.modelText, messageId: input.messageId }, { role: "assistant", modelText: "Answer [[R1.g1]]" }]);
  const settledGeneration = w.generation();
  assert.equal(w.history.settle(accepted, { delivery: "delivery-unknown", usage }, LATER), undefined);
  assert.equal(w.generation(), settledGeneration);
});
it("rolls back malformed settlement, correlation and changed accepted data under the prepared SQL fence", () => {
  const w = world(), id = w.create(), input = w.input(id), attempt = w.history.accept(input);
  const generation = w.generation(), before = w.database.prepare("SELECT * FROM assistant_messages").get(); assert.ok(before);
  assert.throws(() => w.history.settle(attempt, { delivery: "answered", usage: aggregateAssistantUsage([]),
    reply: { id: randomUUID(), kind: "answer", parts: [], modelText: "invalid" } }, LATER));
  assert.deepEqual(w.database.prepare("SELECT * FROM assistant_messages").get(), before); assert.equal(w.generation(), generation);
  assert.equal(w.history.sending(attempt, LATER), true, "rolled-back settlement retains the real attempt");
  const row = assistantM1MessageFromRow(before);
  assert.equal(row.payload.recording.kind, "accepted-turn");
  if (row.payload.recording.kind !== "accepted-turn") assert.fail();
  const finalPayload = { ...row.payload, recording: { ...row.payload.recording, usage: aggregateAssistantUsage([]) } };
  for (const patch of ["model_text='changed'", "ordinal=2", "created_at='2026-11-08T12:01:00.000Z'"]) {
    assert.throws(() => w.database.prepare(`UPDATE assistant_messages SET delivery='answered',payload_json=?,${patch} WHERE id=?`)
      .run(canonicalJsonStringify(finalPayload), input.messageId), /assistant-message-immutable/u);
  }
  for (const payload of [{ ...finalPayload, parts: parts("changed") }, { ...finalPayload, recording: { ...finalPayload.recording,
    acceptedTurn: { ...finalPayload.recording.acceptedTurn, epoch: 8 } } }, {}]) {
    assert.throws(() => w.database.prepare("UPDATE assistant_messages SET delivery='answered',payload_json=? WHERE id=?")
      .run(canonicalJsonStringify(payload), input.messageId), /assistant-message-immutable/u);
  }
  for (const acceptedTurn of [{ ...row.payload.recording.acceptedTurn, messageId: randomUUID() }, { ...row.payload.recording.acceptedTurn, acceptedAt: NOW },
    { ...row.payload.recording.acceptedTurn, ordinal: 2 }]) {
    assert.throws(() => assistantM1MessageFromRow({ ...before, payload_json: canonicalJsonStringify({ ...row.payload,
      recording: { ...row.payload.recording, acceptedTurn } }) }));
  }
  const other = w.create();
  w.database.prepare("INSERT INTO assistant_messages VALUES(?,?,1,'assistant','answer','model',NULL,NULL,'settled',NULL,?,?,?)")
    .run(randomUUID(), other, canonicalJsonStringify({ parts: parts("Foreign reply"), recording: { kind: "reply", acceptedMessageId: input.messageId } }), LATER, LATER);
  assert.throws(() => w.history.conversation(other, LATER));
});
it("holds clear, live epoch changes and interrupted sends without inventing accounting", () => {
  const w = world(), id = w.create(), input = w.input(id), attempt = w.history.accept(input);
  w.changeEpoch();
  assert.equal(w.history.sending(attempt, LATER), false);
  assert.equal(w.history.settle(attempt, { delivery: "answered", usage: aggregateAssistantUsage([]) }, LATER), undefined);
  assert.throws(() => w.history.accept(input));
  assert.equal(w.history.settleInterrupted(LATER), 1);
  const view = w.history.conversation(id, LATER); assert.ok(view);
  assert.equal(view.messages[0]?.delivery, "delivery-unknown");
  assert.equal(view.messages[0]?.payload.recording.kind, "accepted-turn");
  assert.deepEqual(AssistantM1MessagePayloadSchema.parse(view.messages[0]?.payload).recording,
    { kind: "accepted-turn", acceptedTurn: { conversationId: id, messageId: input.messageId, ordinal: 1, acceptedRevision: 2,
      acceptedAt: LATER, profileId: w.profileId(), epoch: 7, proposalAnswer: null }, usage: { state: "pending" } });
  assert.equal(w.history.settleInterrupted(LATER), 0);
  const next = w.input(id), nextAttempt = w.history.accept(next);
  w.history.apply({ operation: "clear", conversationId: id, expectedRevision: w.revision(id) }, LATER);
  assert.equal(w.history.settle(nextAttempt, { delivery: "delivery-unknown", usage: aggregateAssistantUsage([undefined]) }, LATER), undefined);
  assert.equal(w.history.conversation(id, LATER), undefined);
  const foreign = world().create();
  assert.equal(w.history.conversation(foreign, LATER), undefined);
  assert.throws(() => w.history.apply({ operation: "draft", conversationId: foreign, draft: "x", composer: "" }, LATER));
});
it("imports literal/empty inert rows once and keeps CAS, drafts, selection, limits and semantic profile budget", () => {
  const w = world(), id = randomUUID(), rows = [{ messageId: randomUUID(), role: "operator" as const, text: "" },
    { messageId: randomUUID(), role: "assistant" as const, text: "**literal** [[R1.g1]]" }];
  const batch = { operation: "import" as const, conversationId: id, title: "Imported", draft: "d", composer: "c", notice: null,
    total: 2, start: 1, messages: rows };
  w.history.apply(batch, NOW); const generation = w.generation(); w.history.apply(batch, NOW); assert.equal(w.generation(), generation);
  const view = w.history.conversation(id, NOW); assert.ok(view);
  assert.deepEqual(view.messages.map(row => row.payload.parts), [[], parts(rows[1].text)]);
  assert.ok(view.messages.every(row => row.payload.recording.kind === "unrecorded")); assert.deepEqual(w.history.replay(id, 9, NOW), []);
  w.history.apply({ operation: "draft", conversationId: id, draft: "new", composer: "composer" }, NOW); assert.equal(w.revision(id), 2);
  w.history.apply({ operation: "rename", conversationId: id, expectedRevision: 2, title: "Renamed" }, NOW);
  assert.throws(() => w.history.apply({ operation: "select", conversationId: id, expectedRevision: 2 }, NOW));
  w.history.apply({ operation: "select", conversationId: id, expectedRevision: 3 }, NOW); assert.equal(w.history.list(NOW).selectedId, id);
  const a = randomUUID(), b = randomUUID(), base = { operation: "import" as const, draft: "", composer: "", notice: null };
  w.history.apply({ operation: "clear", conversationId: id, expectedRevision: 4 }, NOW);
  const full = (count: number) => Array.from({ length: count }, () => ({ messageId: randomUUID(), role: "assistant" as const, text: "x".repeat(8000) }));
  w.history.apply({ ...base, conversationId: a, title: "A", total: 200, start: 1, messages: full(200) }, NOW);
  w.history.apply({ ...base, conversationId: b, title: "B", total: 49, start: 1, messages: full(49) }, NOW);
  w.history.apply({ operation: "draft", conversationId: b, draft: "x".repeat(4000), composer: "x".repeat(3998) }, NOW);
  const before = w.generation();
  assert.throws(() => w.history.apply({ operation: "local", conversationId: b, expectedRevision: w.revision(b), messageId: randomUUID(), text: "x" }, NOW));
  assert.equal(w.generation(), before); assert.equal(w.history.conversation(b, NOW)?.messages.length, 49);
  assert.throws(() => w.history.accept(w.input(a)), /ASSISTANT_CHAT_FULL/u);
});
it("claims attachment bytes once, enforces owned reads and preserves accepted bytes at startup", () => {
  const w = world(), id = w.create(), other = w.create(), input = w.input(id), bytes = new TextEncoder().encode("fixture");
  const stage = w.history.stage({ id: randomUUID(), conversationId: id, mediaType: "text/plain", name: "fixture.txt", bytes, now: LATER });
  assert.equal(w.history.attachment(id, stage.id, LATER), undefined);
  w.history.accept({ ...input, attachments: [stage.id] });
  assert.deepEqual(w.history.turnAttachments(input.messageId, LATER).map(file => [...file.bytes]), [[...bytes]]);
  assert.equal(w.history.attachment(other, stage.id, LATER), undefined);
  assert.equal(w.history.settleInterrupted(LATER), 1);
  assert.deepEqual(w.history.turnAttachments(input.messageId, LATER).map(file => [...file.bytes]), [[...bytes]]);
  assert.throws(() => w.history.turnAttachments(randomUUID(), LATER));
});
it("stores refused/uncertain accounting once and keeps literal decisions inert", () => {
  const w = world(), id = w.create(), first = w.input(id), firstAttempt = w.history.accept(first);
  const usage = aggregateAssistantUsage([undefined]);
  assert.equal(w.history.settle(firstAttempt, { delivery: "refused", code: "ASSISTANT_UNAVAILABLE", usage }, LATER), 3);
  const next = w.input(id), nextAttempt = w.history.accept(next);
  w.history.settle(nextAttempt, { delivery: "delivery-unknown", usage }, LATER);
  const actionId = randomUUID(), caption = { conversationId: id, actionId, messageId: randomUUID(), text: "Done: literal caption.", now: LATER };
  w.history.appendDecision(caption); const generation = w.generation(); w.history.appendDecision(caption); assert.equal(w.generation(), generation);
  const rows = w.history.conversation(id, LATER)?.messages; assert.ok(rows);
  assert.deepEqual(rows.map(row => row.delivery), ["refused", "delivery-unknown", "settled"]);
  assert.deepEqual(rows[2]?.payload, { parts: parts(caption.text), recording: { kind: "unrecorded", usage: { state: "unrecorded" } } });
  assert.equal(rows[2]?.kind, "decision"); assert.equal(rows[2]?.actionId, actionId);
  const nextId = w.create(), accepted = w.input(nextId), acceptedAttempt = w.history.accept(accepted);
  w.history.settle(acceptedAttempt, { delivery: "answered", usage: aggregateAssistantUsage([]),
    reply: { id: randomUUID(), kind: "proposal", actionId: randomUUID(), parts: [{ kind: "text", runs: [
      { kind: "bold", text: "Preview" }, { kind: "value", value: "new", previous: "old" }] }], modelText: "Preview" } }, LATER);
  assert.equal(w.history.conversation(nextId, LATER)?.messages[1]?.kind, "proposal");
});
it("rolls back the actual pending-usage update and reply insert when semantic profile budget is exceeded", () => {
  const w = world(), a = randomUUID(), b = randomUUID(), base = { operation: "import" as const, draft: "", composer: "", notice: null };
  const rows = (count: number) => Array.from({ length: count }, () => ({ messageId: randomUUID(), role: "assistant" as const, text: "x".repeat(8000) }));
  w.history.apply({ ...base, conversationId: a, title: "A", total: 200, start: 1, messages: rows(200) }, NOW);
  w.history.apply({ ...base, conversationId: b, title: "B", total: 49, start: 1, messages: rows(49) }, NOW);
  w.history.apply({ operation: "draft", conversationId: b, draft: "x".repeat(4000), composer: "x".repeat(3997) }, NOW);
  const input = w.input(b, "x"), attempt = w.history.accept(input);
  const before = w.history.conversation(b, LATER), generation = w.generation();
  assert.throws(() => w.history.settle(attempt, { delivery: "answered", usage: aggregateAssistantUsage([]),
    reply: { id: randomUUID(), kind: "answer", parts: parts("x"), modelText: "x" } }, LATER), /ASSISTANT_HISTORY_FULL/u);
  assert.equal(w.generation(), generation); assert.deepEqual(w.history.conversation(b, LATER), before);
});
it("reserves the pending reply slot, expires chats, and refuses foreign attachment claims atomically", () => {
  const w = world(), id = w.create(), other = w.create();
  const foreign = w.history.stage({ id: randomUUID(), conversationId: other, mediaType: "text/plain", name: "foreign.txt", bytes: new TextEncoder().encode("foreign"), now: NOW });
  const own = w.history.stage({ id: randomUUID(), conversationId: id, mediaType: "text/plain", name: "own.txt", bytes: new TextEncoder().encode("own"), now: NOW });
  const input = w.input(id), before = w.generation();
  assert.throws(() => w.history.accept({ ...input, attachments: [own.id, foreign.id] }));
  assert.equal(w.history.attachment(id, own.id, LATER), undefined, "the earlier claim rolled back too");
  assert.equal(w.generation(), before); assert.equal(w.history.conversation(id, NOW)?.messages.length, 0); assert.equal(w.revision(id), 1);
  const expiry = w.history.list(NOW).chats[0]?.expiresAt; assert.ok(expiry);
  assert.equal(w.history.conversation(id, expiry), undefined); assert.equal(w.history.list(expiry).chats.length, 0);
  assert.equal(w.history.reclaimExpired(expiry), 2);
  const full = randomUUID();
  w.history.apply({ operation: "import", conversationId: full, title: "Full", draft: "", composer: "", notice: null,
    total: 198, start: 1, messages: Array.from({ length: 198 }, () => ({ messageId: randomUUID(), role: "assistant", text: "x" })) }, NOW);
  const send = w.input(full, "x"), attempt = w.history.accept(send);
  assert.throws(() => w.history.apply({ operation: "local", conversationId: full, expectedRevision: w.revision(full), messageId: randomUUID(), text: "Cannot take reply slot" }, LATER), /ASSISTANT_CHAT_FULL/u);
  w.history.settle(attempt, { delivery: "answered", usage: aggregateAssistantUsage([]),
    reply: { id: randomUUID(), kind: "answer", parts: parts("Last"), modelText: "Last" } }, LATER);
  assert.equal(w.history.conversation(full, LATER)?.messages.length, 200);
});

it("refuses an old actual attempt after Clear and same-ID recreation", () => {
  const w = world(), id = w.create(), input = w.input(id), old = w.history.accept(input);
  w.history.apply({ operation: "clear", conversationId: id, expectedRevision: w.revision(id) }, LATER);
  w.history.apply({ operation: "create", conversationId: id, title: "Recreated" }, LATER);
  const current = w.history.accept({ ...input, expectedRevision: 1 });
  const before = w.history.conversation(id, LATER), generation = w.generation();
  assert.equal(w.history.sending(old, LATER), false);
  assert.equal(w.history.settle(old, { delivery: "answered", usage: aggregateAssistantUsage([]) }, LATER), undefined);
  assert.equal(w.generation(), generation); assert.deepEqual(w.history.conversation(id, LATER), before);
  assert.equal(w.history.sending(current, LATER), true);
  assert.equal(w.history.settle(current, { delivery: "answered", usage: aggregateAssistantUsage([]) }, LATER), 3);
});

it("preserves positional import/CAS and the exact chat bound in the prepared owner", () => {
  const w = world(), id = randomUUID(), messages = Array.from({ length: 4 }, (_, index) => ({ messageId: randomUUID(), role: "assistant" as const, text: `Row ${String(index)}` }));
  const batch = { operation: "import" as const, conversationId: id, title: "Imported", draft: "", composer: "", notice: null, total: 4 };
  w.history.apply({ ...batch, start: 1, messages: messages.slice(0, 2) }, NOW);
  const generation = w.generation();
  assert.throws(() => w.history.apply({ ...batch, start: 4, messages: messages.slice(3) }, NOW));
  assert.throws(() => w.history.apply({ ...batch, title: "Changed", start: 3, messages: messages.slice(2) }, NOW));
  assert.throws(() => w.history.apply({ ...batch, start: 1, messages: [{ ...messages[0], text: "Changed" }, messages[1]] }, NOW));
  assert.equal(w.generation(), generation);
  w.history.apply({ ...batch, start: 3, messages: messages.slice(2) }, NOW);
  assert.deepEqual(w.history.conversation(id, NOW)?.messages.map(row => row.id), messages.map(row => row.messageId));
  for (let index = 1; index < ASSISTANT_CHATS_MAX; index++) w.create(`Chat ${String(index)}`);
  assert.equal(w.history.list(NOW).chats.length, ASSISTANT_CHATS_MAX);
  assert.throws(() => w.create("Too many"), /ASSISTANT_CHAT_LIMIT/u);
});
it("separates same-ID same-clock attempts privately and never gives repeats a fresh live identity", () => {
  const w = world(), id = w.create(), input = { ...w.input(id), now: NOW }, old = w.history.accept(input);
  const repeated = w.history.accept(input);
  assert.equal(repeated.state, "repeat");
  assert.equal(w.history.sending(repeated, NOW), false);
  const repeatGeneration = w.generation();
  assert.equal(w.history.settle(repeated, { delivery: "answered", usage: aggregateAssistantUsage([]) }, NOW), undefined);
  assert.equal(w.generation(), repeatGeneration);
  assert.equal(w.history.sending(old, NOW), true, "repeat readback does not replace the original live attempt");
  w.history.apply({ operation: "clear", conversationId: id, expectedRevision: w.revision(id) }, NOW);
  w.history.apply({ operation: "create", conversationId: id, title: "Chat" }, NOW);
  const current = w.history.accept(input);
  assert.deepEqual(current.acceptedTurn, old.acceptedTurn, "every persisted accepted field is identical");
  assert.equal(current.conversationCreatedAt, old.conversationCreatedAt);
  const before = w.history.conversation(id, NOW), generation = w.generation();
  assert.equal(w.history.sending(old, NOW), false);
  assert.equal(w.history.settle(old, { delivery: "answered", usage: aggregateAssistantUsage([]) }, NOW), undefined);
  assert.equal(w.generation(), generation); assert.deepEqual(w.history.conversation(id, NOW), before);
  assert.equal(w.history.sending(current, NOW), true);
  assert.equal(w.history.settle(current, { delivery: "answered", usage: aggregateAssistantUsage([]) }, NOW), 3);
  assert.equal(w.history.sending(current, NOW), false);
});

it("restores stored facts after owner restart without restoring a live attempt", () => {
  const w = world(), id = w.create(), input = w.input(id), actual = w.history.accept(input), restarted = w.restart();
  assert.equal(restarted.sending(actual, LATER), false);
  const repeat = restarted.accept(input); assert.equal(repeat.state, "repeat");
  assert.equal(restarted.sending(repeat, LATER), false);
  const generation = w.generation();
  assert.equal(restarted.settle(repeat, { delivery: "answered", usage: aggregateAssistantUsage([]) }, LATER), undefined);
  assert.equal(w.generation(), generation);
  assert.equal(restarted.settleInterrupted(LATER), 1);
  const row = restarted.conversation(id, LATER)?.messages[0]; assert.ok(row);
  assert.equal(row.delivery, "delivery-unknown"); assert.equal(row.payload.recording.kind, "accepted-turn");
  if (row.payload.recording.kind !== "accepted-turn") assert.fail();
  assert.deepEqual(row.payload.recording.usage, { state: "pending" });
});

for (const operation of ["clear", "settle", "interrupt", "expire"] as const) it(`preserves the actual sending right after nested ${operation} and outer rollback`, () => {
  const w = world(), id = w.create(), attempt = w.history.accept(w.input(id));
  const before = w.history.conversation(id, LATER), generation = w.generation();
  assert.throws(() => w.outer(() => {
    if (operation === "clear") w.history.apply({ operation: "clear", conversationId: id, expectedRevision: w.revision(id) }, LATER);
    if (operation === "settle") w.history.settle(attempt, { delivery: "answered", usage: aggregateAssistantUsage([]) }, LATER);
    if (operation === "interrupt") w.history.settleInterrupted(LATER);
    if (operation === "expire") {
      const expiry = w.history.list(NOW).chats[0]?.expiresAt; assert.ok(expiry); w.history.reclaimExpired(expiry);
    }
    throw new Error("outer-rollback");
  }), /outer-rollback/u);
  assert.equal(w.generation(), generation); assert.deepEqual(w.history.conversation(id, LATER), before);
  assert.equal(w.history.sending(attempt, LATER), true);
  assert.equal(w.history.settle(attempt, { delivery: "answered", usage: aggregateAssistantUsage([]) }, LATER), 3);
});
it("publishes a new nested acceptance only after outer commit and grants no right on rollback", () => {
  const w = world(), id = w.create(), input = w.input(id);
  let rolledBack: ReturnType<typeof w.history.accept> | undefined;
  assert.throws(() => w.outer(() => {
    rolledBack = w.history.accept(input);
    assert.equal(w.history.sending(rolledBack, LATER), false, "SAVEPOINT release is not publication");
    throw new Error("outer-rollback");
  }), /outer-rollback/u);
  assert.ok(rolledBack); assert.equal(w.history.sending(rolledBack, LATER), false);
  assert.equal(w.history.conversation(id, LATER)?.messages.length, 0);
  const committed = w.outer(() => {
    const accepted = w.history.accept(input); assert.equal(w.history.sending(accepted, LATER), false); return accepted;
  });
  assert.equal(w.history.sending(rolledBack, LATER), false);
  assert.equal(w.history.sending(committed, LATER), true);
  assert.equal(w.outer(() => w.history.settle(committed, { delivery: "answered", usage: aggregateAssistantUsage([]) }, LATER)), 3);
  assert.equal(w.history.sending(committed, LATER), false);
});
it("discards inner-savepoint publications while committing unrelated outer work", () => {
  const w = world(), id = w.create(), attempt = w.history.accept(w.input(id)), generation = w.generation();
  w.outer(() => {
    assert.throws(() => w.outer(() => {
      w.history.settle(attempt, { delivery: "answered", usage: aggregateAssistantUsage([]) }, LATER);
      throw new Error("inner-rollback");
    }), /inner-rollback/u);
    w.history.apply({ operation: "draft", conversationId: id, draft: "retained", composer: "" }, LATER);
  });
  assert.equal(w.generation(), generation + 1);
  assert.equal(w.history.conversation(id, LATER)?.draft, "retained");
  assert.equal(w.history.sending(attempt, LATER), true);
  assert.equal(w.history.settle(attempt, { delivery: "answered", usage: aggregateAssistantUsage([]) }, LATER), 3);
});

it("reads authentic repeats before remasking without exposing replay or granting a live identity", () => {
  const w = world(), id = w.create(), input = w.input(id), attempt = w.history.accept(input);
  const query = { conversationId: id, messageId: input.messageId, text: input.text, subjectRef: input.subjectRef, attachments: input.attachments, now: LATER };
  const repeat = w.restart().repeat(query); assert.ok(repeat);
  assert.equal(repeat.state, "repeat"); assert.equal(repeat.delivery, "sending");
  assert.deepEqual(repeat.acceptedTurn, attempt.acceptedTurn); assert.deepEqual(repeat.usage, { state: "pending" });
  assert.equal("modelText" in repeat, false); assert.equal("subjectRef" in repeat, false);
  assert.equal(w.history.sending(repeat, LATER), false); assert.equal(w.history.sending(attempt, LATER), true);
  assert.equal(w.history.repeat({ ...query, messageId: randomUUID() }), undefined);
  for (const patch of [{ text: "changed" }, { subjectRef: "run_other_1" }, { attachments: [randomUUID()] }, { conversationId: w.create() }])
    assert.throws(() => w.history.repeat({ ...query, ...patch }), /ASSISTANT_CONVERSATION_STALE/u);
  w.history.settle(attempt, { delivery: "refused", code: "ASSISTANT_UNAVAILABLE", usage: aggregateAssistantUsage([]) }, LATER);
  assert.equal(w.restart().repeat(query)?.delivery, "refused");
  w.changeEpoch(); assert.throws(() => w.history.repeat(query), /ASSISTANT_CONVERSATION_STALE/u);
});
