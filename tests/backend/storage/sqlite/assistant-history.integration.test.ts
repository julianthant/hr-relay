import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { ASSISTANT_HISTORY_MIGRATION, AssistantHistoryRefusal } from "../../../../src/backend/storage/sqlite/assistant-history.js";
import { ASSISTANT_CHATS_MAX, ASSISTANT_MESSAGES_MAX } from "../../../../src/models/dashboard/assistant.js";
import { openBoundDatabaseFixture } from "../../../support/helpers/admission-fixture.js";

const NOW = "2026-11-06T12:00:00.000Z", LATER = "2026-11-06T12:05:00.000Z";
const owners: { close(): Promise<void> }[] = [];
afterEach(async () => { for (const owner of owners.splice(0)) await owner.close(); });
async function world() {
  const fixture = await openBoundDatabaseFixture("assistant-history-test"); owners.push(fixture);
  const history = fixture.database.authority.assistantHistory;
  const create = (title = "Chat") => {
    const conversationId = randomUUID();
    assert.deepEqual(history.apply({ operation: "create", conversationId, title }, NOW), { state: "saved", conversationId, revision: 1 });
    return conversationId;
  };
  const revision = (id: string, now = NOW) => history.conversation(id, now)?.revision ?? 0;
  const accept = (conversationId: string, text = "Explain", extra: { messageId?: string; subjectRef?: string | null; expectedRevision?: number } = {}) =>
    history.accept({ conversationId, expectedRevision: extra.expectedRevision ?? revision(conversationId), messageId: extra.messageId ?? randomUUID(), text,
      modelText: `masked ${text}`, subjectRef: extra.subjectRef ?? null, attachments: [], now: NOW });
  const generation = () => fixture.database.getMeta().authorityGeneration;
  return { ...fixture, history, create, revision, accept, generation };
}
const refusedWith = (code: string) => (error: unknown) => error instanceof AssistantHistoryRefusal && error.code === code;

it("enforces the message shape natively: kinds, one sending turn, one caption per action and settle-only updates", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys=ON");
    for (const statement of ASSISTANT_HISTORY_MIGRATION.statements) database.exec(statement);
    const chat = randomUUID();
    database.prepare("INSERT INTO assistant_conversations VALUES(?,?,1,NULL,'{\"title\":\"Chat\"}','','',0,NULL,?,?)").run(chat, randomUUID(), NOW, LATER);
    const insert = (row: { ordinal: number; role?: string; kind: string; modelText?: string | null; actionId?: string | null; delivery: string; code?: string | null; subjectRef?: string | null }) =>
      database.prepare("INSERT INTO assistant_messages VALUES(?,?,?,?,?,?,?,?,?,?,'{\"text\":\"x\"}',?,?)").run(randomUUID(), chat, row.ordinal, row.role ?? "assistant", row.kind,
        row.modelText === undefined ? "model" : row.modelText, row.subjectRef ?? null, row.actionId ?? null, row.delivery, row.code ?? null, NOW, NOW);
    const turn = insert({ ordinal: 1, role: "operator", kind: "turn", delivery: "sending", subjectRef: "run_x_1" });
    assert.equal(turn.changes, 1);
    for (const invalid of [
      { ordinal: 2, kind: "inert", delivery: "settled" },
      { ordinal: 2, kind: "answer", modelText: null, delivery: "settled" },
      { ordinal: 2, role: "operator", kind: "turn", delivery: "settled" },
      { ordinal: 2, role: "assistant", kind: "turn", delivery: "answered" },
      { ordinal: 2, kind: "answer", delivery: "answered" },
      { ordinal: 2, role: "operator", kind: "turn", delivery: "answered", code: "ASSISTANT_LIMIT" },
      { ordinal: 2, role: "operator", kind: "turn", delivery: "refused" },
      { ordinal: 2, kind: "answer", delivery: "settled", subjectRef: "run_x_1" },
      { ordinal: 2, kind: "proposal", delivery: "settled" },
      { ordinal: 2, kind: "answer", delivery: "settled", actionId: randomUUID() },
      { ordinal: 1, kind: "answer", delivery: "settled" },
      { ordinal: 2, role: "operator", kind: "turn", delivery: "sending" },
    ]) assert.throws(() => insert(invalid), /constraint failed/u, JSON.stringify(invalid));
    const action = randomUUID();
    insert({ ordinal: 2, kind: "decision", actionId: action, delivery: "settled" });
    assert.throws(() => insert({ ordinal: 3, kind: "decision", actionId: action, delivery: "settled" }), /UNIQUE constraint failed/u);
    insert({ ordinal: 3, kind: "proposal", actionId: action, delivery: "settled" });
    for (const change of ["payload_json='{\"text\":\"changed\"}'", "model_text='changed'", "subject_ref=NULL", "ordinal=9", "kind='answer'"])
      assert.throws(() => database.exec(`UPDATE assistant_messages SET ${change}, delivery='answered' WHERE ordinal=1`), /assistant-message-immutable/u, change);
    assert.throws(() => database.exec("UPDATE assistant_messages SET delivery='settled' WHERE ordinal=2"), /assistant-message-immutable/u);
    assert.equal(database.prepare("UPDATE assistant_messages SET delivery='refused', code='ASSISTANT_LIMIT', updated_at=? WHERE ordinal=1").run(LATER).changes, 1);
    assert.throws(() => database.exec("UPDATE assistant_messages SET delivery='answered', code=NULL WHERE ordinal=1"), /assistant-message-immutable/u);
    database.exec(`DELETE FROM assistant_conversations WHERE id='${chat}'`);
    assert.equal(database.prepare("SELECT count(*) AS count FROM assistant_messages").get()?.count, 0);
  } finally { database.close(); }
});

it("accepts one turn per message identity, reads repeats without the revision and refuses changed input, stale revisions and a busy chat", async () => {
  const w = await world(), id = w.create(), messageId = randomUUID();
  const accepted = w.accept(id, "Explain", { messageId, subjectRef: "run_a_1" });
  assert.deepEqual(accepted, { state: "accepted", ordinal: 1, revision: 2, createdAt: NOW });
  assert.deepEqual(w.history.apply({ operation: "rename", conversationId: id, expectedRevision: 2, title: "Renamed" }, NOW), { state: "saved", conversationId: id, revision: 3 });
  assert.equal(w.history.sending(id, NOW, messageId, NOW), true, "a rename does not invalidate the attempt");
  assert.deepEqual(w.accept(id, "Explain", { messageId, subjectRef: "run_a_1", expectedRevision: 1 }), { state: "repeat", ordinal: 1, revision: 3, delivery: "sending" });
  assert.throws(() => w.accept(id, "Explain", { messageId, subjectRef: "run_b_1" }), refusedWith("ASSISTANT_CONVERSATION_STALE"));
  assert.throws(() => w.accept(id, "Changed", { messageId, subjectRef: "run_a_1" }), refusedWith("ASSISTANT_CONVERSATION_STALE"));
  assert.throws(() => w.accept(w.create(), "Explain", { messageId, subjectRef: "run_a_1" }), refusedWith("ASSISTANT_CONVERSATION_STALE"));
  assert.throws(() => w.accept(id, "Another", { expectedRevision: 2 }), refusedWith("ASSISTANT_CONVERSATION_STALE"));
  assert.throws(() => w.accept(id, "Another"), refusedWith("ASSISTANT_CONVERSATION_BUSY"));
  assert.throws(() => w.accept(randomUUID(), "Unknown chat", { expectedRevision: 1 }), refusedWith("ASSISTANT_CONVERSATION_STALE"));
  assert.equal(w.history.settle(id, messageId, { delivery: "answered", reply: { id: randomUUID(), kind: "answer", text: "Answer for 10812345", modelText: "Answer for [[E1.g1]]" } }, LATER), 4);
  assert.deepEqual(w.accept(id, "Explain", { messageId, subjectRef: "run_a_1" }), { state: "repeat", ordinal: 1, revision: 4, delivery: "answered" });
  assert.equal(w.history.settle(id, messageId, { delivery: "delivery-unknown" }, LATER), undefined, "a settled turn never settles again");
  assert.deepEqual(w.history.replay(id, 3), [{ role: "operator", modelText: "masked Explain", messageId }, { role: "assistant", modelText: "Answer for [[E1.g1]]" }]);
  const view = w.history.conversation(id, LATER); assert.ok(view);
  assert.deepEqual(view.messages.map(row => [row.ordinal, row.role, row.kind, row.text, row.delivery]),
    [[1, "operator", "turn", "Explain", "answered"], [2, "assistant", "answer", "Answer for 10812345", "settled"]]);
  assert.equal(JSON.stringify(view).includes("[[E1"), false); assert.equal(JSON.stringify(view).includes("run_a_1"), false);
});

it("stores exactly one outcome per result arm and settles interrupted sends as delivery-unknown", async () => {
  const w = await world(), id = w.create(), action = randomUUID(), unknown = randomUUID();
  const settle = (text: string, settlement: Parameters<typeof w.history.settle>[2]) => {
    const messageId = randomUUID(); assert.equal(w.accept(id, text, { messageId }).state, "accepted");
    assert.equal(typeof w.history.settle(id, messageId, settlement, LATER), "number");
  };
  settle("Card", { delivery: "answered", reply: { id: randomUUID(), kind: "proposal", actionId: action, text: "Review this proposal. No action has been applied.", modelText: "I prepared a confirmation card: Start Person Lookup. The operator has not decided yet." } });
  settle("Lost", { delivery: "answered", reply: { id: randomUUID(), kind: "proposal", actionId: unknown, text: "Outcome unknown: Mark notifications read. Do not retry.", modelText: "Outcome unknown: Mark notifications read. Do not retry." } });
  settle("Refused", { delivery: "refused", code: "ASSISTANT_CANCELLED" });
  const interrupted = randomUUID(); assert.equal(w.accept(id, "Interrupted", { messageId: interrupted }).state, "accepted");
  const before = w.revision(id);
  assert.equal(w.history.settleInterrupted(LATER), 1);
  assert.equal(w.revision(id), before + 1);
  assert.equal(w.history.sending(id, NOW, interrupted, NOW), false);
  const rows = w.history.conversation(id, LATER)?.messages ?? [];
  assert.deepEqual(rows.map(row => [row.kind, row.delivery, row.code, row.actionId]), [
    ["turn", "answered", null, null], ["proposal", "settled", null, action],
    ["turn", "answered", null, null], ["proposal", "settled", null, unknown],
    ["turn", "refused", "ASSISTANT_CANCELLED", null],
    ["turn", "delivery-unknown", null, null],
  ]);
  assert.deepEqual(w.history.replay(id, 99).map(row => row.role), ["operator", "assistant", "operator", "assistant", "operator", "operator"]);
  assert.equal(w.history.settleInterrupted(LATER), 0);
});

it("captions a decision once, writes nothing for a cleared chat and still surfaces an unrelated constraint failure", async () => {
  const w = await world(), id = w.create(), action = randomUUID(), captionId = randomUUID();
  const caption = (conversationId: string, messageId = randomUUID(), text = "Done: Start Person Lookup.") => w.history.appendDecision({ conversationId, actionId: action, messageId, text, now: LATER });
  const before = w.generation();
  caption(id, captionId);
  assert.equal(w.generation(), before + 1); assert.equal(w.revision(id), 2);
  caption(id, randomUUID(), "Outcome unknown: Start Person Lookup. Do not retry.");
  assert.equal(w.generation(), before + 1, "a duplicate decision adds nothing");
  const rows = w.history.conversation(id, LATER)?.messages ?? [];
  assert.deepEqual(rows.map(row => [row.id, row.kind, row.text, row.actionId]), [[captionId, "decision", "Done: Start Person Lookup.", action]]);
  assert.throws(() => w.history.appendDecision({ conversationId: id, actionId: randomUUID(), messageId: captionId, text: "Not done: x.", now: LATER }), /UNIQUE constraint failed|constraint/u);
  assert.equal(w.generation(), before + 1);
  const cleared = w.create();
  assert.equal(w.history.apply({ operation: "clear", conversationId: cleared, expectedRevision: 1 }, NOW).state, "cleared");
  const afterClear = w.generation();
  w.history.appendDecision({ conversationId: cleared, actionId: randomUUID(), messageId: randomUUID(), text: "Done: x.", now: LATER });
  assert.equal(w.generation(), afterClear);
});

it("clears a chat during a send so the attempt is no longer current and its settlement writes nothing", async () => {
  const w = await world(), id = w.create(), messageId = randomUUID();
  assert.equal(w.accept(id, "Explain", { messageId }).state, "accepted");
  assert.deepEqual(w.history.apply({ operation: "clear", conversationId: id, expectedRevision: 2 }, NOW), { state: "cleared", conversationId: id, transmissionMayHaveStarted: true });
  assert.equal(w.history.sending(id, NOW, messageId, NOW), false);
  const before = w.generation();
  assert.equal(w.history.settle(id, messageId, { delivery: "answered", reply: { id: randomUUID(), kind: "answer", text: "Late", modelText: "Late" } }, LATER), undefined);
  assert.equal(w.generation(), before);
  assert.equal(w.history.conversation(id, LATER), undefined);
});

it("bounds chats and messages, keeps drafts out of the revision and reads only owned, unexpired chats", async () => {
  const w = await world(), first = w.create("First");
  for (let index = 1; index < ASSISTANT_CHATS_MAX; index++) w.create(`Chat ${String(index)}`);
  assert.throws(() => w.history.apply({ operation: "create", conversationId: randomUUID(), title: "One too many" }, NOW), refusedWith("ASSISTANT_CHAT_LIMIT"));
  assert.deepEqual(w.history.apply({ operation: "create", conversationId: first, title: "First" }, NOW), { state: "saved", conversationId: first, revision: 1 });
  assert.throws(() => w.history.apply({ operation: "create", conversationId: first, title: "Other" }, NOW), refusedWith("ASSISTANT_CONVERSATION_STALE"));
  assert.deepEqual(w.history.apply({ operation: "draft", conversationId: first, draft: "panel", composer: "hub" }, NOW), { state: "saved", conversationId: first, revision: 1 });
  assert.deepEqual(w.history.apply({ operation: "select", conversationId: first, expectedRevision: 1 }, LATER), { state: "saved", conversationId: first, revision: 2 });
  assert.equal(w.history.list(LATER).selectedId, first);
  let revision = 2;
  for (let index = 0; index < ASSISTANT_MESSAGES_MAX - 1; index++) {
    const result = w.history.apply({ operation: "local", conversationId: first, expectedRevision: revision, messageId: randomUUID(), text: `Local ${String(index)}` }, NOW);
    assert.equal(result.state, "saved"); if (result.state === "saved") revision = result.revision;
  }
  assert.throws(() => w.accept(first, "Needs two rows"), refusedWith("ASSISTANT_CHAT_FULL"));
  assert.equal(w.history.apply({ operation: "local", conversationId: first, expectedRevision: revision, messageId: randomUUID(), text: "Last" }, NOW).state, "saved");
  assert.throws(() => w.history.apply({ operation: "local", conversationId: first, expectedRevision: revision + 1, messageId: randomUUID(), text: "Over" }, NOW), refusedWith("ASSISTANT_CHAT_FULL"));
  const view = w.history.conversation(first, NOW); assert.ok(view);
  assert.equal(view.messages.length, ASSISTANT_MESSAGES_MAX); assert.deepEqual([view.draft, view.composer], ["panel", "hub"]);
  assert.deepEqual(w.history.replay(first, 999), [], "local rows never replay");
  const expiry = w.history.list(NOW).chats.find(chat => chat.id === first)?.expiresAt; assert.ok(expiry);
  assert.equal(Date.parse(expiry) - Date.parse(NOW), 30 * 24 * 60 * 60 * 1000);
  assert.equal(w.history.conversation(first, expiry), undefined);
  assert.equal(w.history.list(expiry).chats.length, 0);
  assert.throws(() => w.history.apply({ operation: "rename", conversationId: first, expectedRevision: revision + 1, title: "Expired" }, expiry), refusedWith("ASSISTANT_CONVERSATION_STALE"));
  assert.equal(w.history.reclaimExpired(expiry), ASSISTANT_CHATS_MAX);
  assert.equal(w.history.reclaimExpired(expiry), 0);
});

it("imports positional batches once, repeats a finished batch unchanged and refuses gaps, overlaps and changed metadata", async () => {
  const w = await world(), id = randomUUID();
  const base = { operation: "import" as const, conversationId: id, title: "Imported", draft: "d", composer: "c", notice: "unknown" as const, total: 4 };
  const messages = Array.from({ length: 4 }, (_, index) => ({ messageId: randomUUID(), role: index % 2 === 0 ? "operator" as const : "assistant" as const, text: `Row ${String(index + 1)}` }));
  const first = { ...base, start: 1, messages: messages.slice(0, 2) }, second = { ...base, start: 3, messages: messages.slice(2) };
  assert.throws(() => w.history.apply(second, NOW), refusedWith("ASSISTANT_CONVERSATION_STALE"), "a later batch needs the conversation");
  assert.deepEqual(w.history.apply(first, NOW), { state: "saved", conversationId: id, revision: 2 });
  assert.deepEqual(w.history.apply(first, NOW), { state: "saved", conversationId: id, revision: 2 });
  assert.throws(() => w.history.apply({ ...first, messages: [messages[0], { ...messages[1], text: "Changed" }] }, NOW), refusedWith("ASSISTANT_CONVERSATION_STALE"));
  assert.throws(() => w.history.apply({ ...second, start: 4, messages: messages.slice(3) }, NOW), refusedWith("ASSISTANT_CONVERSATION_STALE"));
  assert.throws(() => w.history.apply({ ...second, draft: "other" }, NOW), refusedWith("ASSISTANT_CONVERSATION_STALE"));
  assert.throws(() => w.history.apply({ ...second, messages: [messages[0], messages[3]] }, NOW), refusedWith("ASSISTANT_CONVERSATION_STALE"));
  assert.deepEqual(w.history.apply(second, NOW), { state: "saved", conversationId: id, revision: 3 });
  const view = w.history.conversation(id, NOW); assert.ok(view);
  assert.deepEqual([view.importTotal, view.importNotice, view.draft, view.composer], [4, "unknown", "d", "c"]);
  assert.deepEqual(view.messages.map(row => [row.id, row.ordinal, row.kind]), messages.map((message, index) => [message.messageId, index + 1, "inert"]));
  assert.deepEqual(w.history.replay(id, 99), []);
  const empty = randomUUID();
  assert.deepEqual(w.history.apply({ ...base, conversationId: empty, total: 0, start: 1, messages: [] }, NOW), { state: "saved", conversationId: empty, revision: 1 });
});

it("fences an accepted attempt and its settlement at the chat's expiry without cleanup", async () => {
  const w = await world(), id = w.create(), messageId = randomUUID();
  assert.equal(w.accept(id, "Explain", { messageId }).state, "accepted");
  const expiry = w.history.list(NOW).chats.find(chat => chat.id === id)?.expiresAt; assert.ok(expiry);
  const justBefore = new Date(Date.parse(expiry) - 1).toISOString();
  assert.equal(w.history.sending(id, NOW, messageId, justBefore), true);
  assert.equal(w.history.sending(id, NOW, messageId, expiry), false);
  const generation = w.generation();
  assert.equal(w.history.settle(id, messageId, { delivery: "answered", reply: { id: randomUUID(), kind: "answer", text: "Late", modelText: "Late" } }, expiry), undefined);
  assert.equal(w.generation(), generation, "a late settlement writes nothing");
  assert.deepEqual(w.history.conversation(id, justBefore)?.messages.map(row => [row.kind, row.delivery]), [["turn", "sending"]], "the expired row is left as stored, not reclaimed");
});

it("keeps an accepted turn's reply slot and refuses a decision caption in a full chat", async () => {
  const w = await world(), id = w.create(), action = randomUUID();
  let revision = 1;
  const local = (text: string) => w.history.apply({ operation: "local", conversationId: id, expectedRevision: revision, messageId: randomUUID(), text }, NOW);
  for (let index = 0; index < ASSISTANT_MESSAGES_MAX - 2; index++) { const result = local(`Local ${String(index)}`); if (result.state === "saved") revision = result.revision; }
  const messageId = randomUUID(), accepted = w.accept(id, "Card", { messageId }); assert.equal(accepted.state, "accepted"); revision = accepted.revision;
  assert.equal(accepted.ordinal, ASSISTANT_MESSAGES_MAX - 1);
  const generation = w.generation();
  assert.throws(() => local("Takes the reply slot"), refusedWith("ASSISTANT_CHAT_FULL"));
  assert.throws(() => w.history.appendDecision({ conversationId: id, actionId: randomUUID(), messageId: randomUUID(), text: "Done: x.", now: NOW }), refusedWith("ASSISTANT_CHAT_FULL"));
  assert.equal(w.generation(), generation);
  assert.equal(typeof w.history.settle(id, messageId, { delivery: "answered", reply: { id: randomUUID(), kind: "proposal", actionId: action,
    text: "Review this proposal. No action has been applied.", modelText: "I prepared a confirmation card: Start Person Lookup. The operator has not decided yet." } }, NOW), "number");
  assert.throws(() => w.history.appendDecision({ conversationId: id, actionId: action, messageId: randomUUID(), text: "Done: Start Person Lookup.", now: NOW }), refusedWith("ASSISTANT_CHAT_FULL"),
    "a full chat refuses the caption instead of dropping it");
  const view = w.history.conversation(id, NOW); assert.ok(view);
  assert.equal(view.messages.length, ASSISTANT_MESSAGES_MAX);
  assert.deepEqual(view.messages.slice(-2).map(row => [row.ordinal, row.kind]), [[ASSISTANT_MESSAGES_MAX - 1, "turn"], [ASSISTANT_MESSAGES_MAX, "proposal"]]);
});

it("bounds the profile's stored titles, drafts and display text in UTF-16 units across chats and batches and rolls a refused write back", async () => {
  const w = await world(), wide = "😀".repeat(4000), a = randomUUID(), b = randomUUID();
  assert.equal(wide.length, 8000);
  const rows = (count: number) => Array.from({ length: count }, () => ({ messageId: randomUUID(), role: "assistant" as const, text: wide }));
  const base = { operation: "import" as const, draft: "", composer: "", notice: null };
  assert.equal(w.history.apply({ ...base, conversationId: a, title: "A", total: 200, start: 1, messages: rows(200) }, NOW).state, "saved");
  assert.equal(w.history.apply({ ...base, conversationId: b, title: "B", total: 49, start: 1, messages: rows(25) }, NOW).state, "saved");
  assert.equal(w.history.apply({ ...base, conversationId: b, title: "B", total: 49, start: 26, messages: rows(24) }, NOW).state, "saved");
  // 1 + 200 × 8000 + 1 + 49 × 8000 = 1,992,002 units; the next 7,998 still fit.
  assert.equal(w.history.apply({ operation: "draft", conversationId: b, draft: "é".repeat(4000), composer: "é".repeat(3998) }, NOW).state, "saved");
  const generation = w.generation(), revision = w.revision(b);
  assert.throws(() => w.history.apply({ operation: "local", conversationId: b, expectedRevision: revision, messageId: randomUUID(), text: "x" }, NOW), refusedWith("ASSISTANT_HISTORY_FULL"));
  assert.throws(() => w.history.apply({ operation: "draft", conversationId: b, draft: "é".repeat(4000), composer: "é".repeat(3999) }, NOW), refusedWith("ASSISTANT_HISTORY_FULL"));
  assert.throws(() => w.history.apply({ operation: "create", conversationId: randomUUID(), title: "C" }, NOW), refusedWith("ASSISTANT_HISTORY_FULL"));
  assert.throws(() => w.accept(b, "y"), refusedWith("ASSISTANT_HISTORY_FULL"));
  assert.equal(w.generation(), generation, "every refused write rolled back");
  const view = w.history.conversation(b, NOW); assert.ok(view);
  assert.deepEqual([view.messages.length, view.draft.length, view.composer.length, view.revision], [49, 4000, 3998, revision]);
  assert.equal(w.history.apply({ operation: "draft", conversationId: b, draft: "", composer: "" }, NOW).state, "saved", "a shrinking write still saves");
});

it("stages attachments under an owned chat, claims them once in send order with the turn and serves authenticated bytes", async () => {
  const w = await world(), id = w.create(), other = w.create(), messageId = randomUUID();
  const bytes = (text: string) => new TextEncoder().encode(text);
  const stage = (conversationId: string, name: string, now = NOW) => w.history.stage({ id: randomUUID(), conversationId, mediaType: "text/plain", name, bytes: bytes(name), now });
  const [a, b, foreign] = [stage(id, "a.txt"), stage(id, "b.txt"), stage(other, "c.txt")];
  assert.throws(() => stage(randomUUID(), "x.txt"), refusedWith("ASSISTANT_CONVERSATION_STALE"));
  assert.equal(w.history.attachment(id, a.id, NOW), undefined, "a stage is not an accepted attachment");
  const accept = (ids: string[], extra: { messageId?: string; now?: string } = {}) => w.history.accept({ conversationId: id, expectedRevision: w.revision(id), messageId: extra.messageId ?? randomUUID(),
    text: "Read", modelText: "Read", subjectRef: null, attachments: ids, now: extra.now ?? NOW });
  assert.throws(() => accept([a.id, foreign.id]), refusedWith("ASSISTANT_ATTACHMENT_UNAVAILABLE"));
  assert.equal(w.history.conversation(id, NOW)?.messages.length, 0, "a refused claim stores no turn");
  assert.equal(accept([b.id, a.id], { messageId }).state, "accepted");
  assert.deepEqual(w.history.turnAttachments(messageId).map(file => [file.name, file.ordinal, new TextDecoder().decode(file.bytes)]), [["b.txt", 1, "b.txt"], ["a.txt", 2, "a.txt"]]);
  assert.deepEqual(w.history.conversation(id, NOW)?.messages[0]?.attachments, [{ id: b.id, name: "b.txt" }, { id: a.id, name: "a.txt" }]);
  assert.equal(w.history.attachment(id, a.id, NOW)?.name, "a.txt");
  assert.equal(w.history.attachment(other, a.id, NOW), undefined, "another chat never reads it");
  assert.throws(() => accept([a.id], { messageId }), refusedWith("ASSISTANT_CONVERSATION_STALE"), "a repeat with changed attachments refuses");
  const late = stage(id, "late.txt");
  assert.throws(() => accept([late.id], { now: "2026-11-06T12:16:00.000Z" }), refusedWith("ASSISTANT_CONVERSATION_BUSY"));
  w.history.settle(id, messageId, { delivery: "refused", code: "ASSISTANT_UNAVAILABLE" }, LATER);
  assert.throws(() => accept([late.id], { now: "2026-11-06T12:16:00.000Z" }), refusedWith("ASSISTANT_ATTACHMENT_UNAVAILABLE"), "a stage expires after 15 minutes");
});
