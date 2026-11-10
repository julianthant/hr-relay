import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { AssistantM2ProposalSnapshotSchema, AssistantSessionClaimSchema, assistantM2ProposalDigest, type AssistantM2ProposalSnapshot } from "../../../../src/models/dashboard/assistant.js";
import { assistantM1HistoryFixture } from "../../../support/helpers/assistant-m1-history-fixture.js";

const T = "2026-11-09T12:00:00.000Z", hex = (digit: string) => digit.repeat(64);
const fingerprints = { descriptorFingerprint: hex("a"), configFingerprint: hex("b"), ingressSchemaHash: hex("c"), canonicalInputSchemaHash: hex("d"), inputFingerprint: hex("e") };

function world() {
  const storage = assistantM1HistoryFixture({ now: T, acceptedAt: T });
  const chat = storage.create();
  const before = storage.history.conversation(chat, T);
  const proposals = storage.proposals();
  assert.deepEqual(storage.history.conversation(chat, T), before, "M2 statements keep the populated M1 chat");
  const snapshot = (conversationId = chat, rows = 2): AssistantM2ProposalSnapshot => {
    const draft = { id: randomUUID(), profileId: storage.profileId(), conversationId, revision: 1, renderedMessageId: randomUUID(), sourceMessageId: randomUUID(),
      label: "Start Person Lookup", dryRun: false, createdAt: T, rows: Array.from({ length: rows }, (_, index) => ({ id: randomUUID(), ordinal: index + 1, title: `Row ${String(index + 1)}`,
        display: { kind: "request" as const }, operation: { kind: "workflow-start" as const, workflowId: "person-lookup", submission: { line: String(index) }, expected: fingerprints } })) };
    return AssistantM2ProposalSnapshotSchema.parse({ ...draft, renderedDigest: assistantM2ProposalDigest(draft) });
  };
  return { storage, chat, proposals, snapshot };
}
const answer = (shown: AssistantM2ProposalSnapshot, overrides: Partial<{ proposalRevision: number; renderedDigest: string; renderedMessageId: string }> = {}) => ({
  proposalId: shown.id, proposalRevision: shown.revision, renderedMessageId: shown.renderedMessageId, renderedDigest: shown.renderedDigest, answerMessageId: randomUUID(), ...overrides });

it("binds a snapshot digest to everything shown and refuses a changed or reordered row", () => {
  const w = world(), shown = w.snapshot();
  assert.equal(AssistantM2ProposalSnapshotSchema.safeParse({ ...shown, rows: [...shown.rows].reverse() }).success, false);
  assert.equal(AssistantM2ProposalSnapshotSchema.safeParse({ ...shown, label: "Start something else" }).success, false);
  assert.equal(AssistantM2ProposalSnapshotSchema.safeParse({ ...shown, rows: shown.rows.map((row, index) => index === 0 ? { ...row, title: "Changed" } : row) }).success, false);
});

it("issues one open proposal per chat, answers only the exact shown snapshot once and supersedes on a new proposal or change request", () => {
  const w = world(), first = w.snapshot();
  const issued = w.proposals.issue(first);
  assert.deepEqual(issued.lifecycle, { state: "open" }); assert.deepEqual(issued.rows.map(row => row.result.state), ["not-started", "not-started"]);
  assert.equal(w.proposals.open(w.chat)?.snapshot.id, first.id); assert.equal(w.proposals.needsYou(T), 1);
  for (const wrong of [{ proposalRevision: 2 }, { renderedDigest: hex("f") }, { renderedMessageId: randomUUID() }]) assert.equal(w.proposals.claimAnswer(answer(first, wrong)), false);
  const second = w.snapshot();
  w.proposals.issue(second);
  assert.deepEqual(w.proposals.read(first.id)?.lifecycle, { state: "superseded" });
  assert.equal(w.proposals.claimAnswer(answer(first)), false);
  const yes = answer(second);
  assert.equal(w.proposals.claimAnswer(yes), true);
  assert.equal(w.proposals.claimAnswer({ ...yes, answerMessageId: randomUUID() }), false);
  assert.deepEqual(w.proposals.read(second.id)?.lifecycle, { state: "answered", answerMessageId: yes.answerMessageId });
  assert.equal(w.proposals.needsYou(T), 0);
  const third = w.snapshot(); w.proposals.issue(third); w.proposals.supersede(w.chat);
  assert.equal(w.proposals.claimAnswer(answer(third)), false); assert.equal(w.proposals.open(w.chat), undefined);
  assert.equal(w.proposals.needsYou(T), 0);
});

it("claims each row for one command once, keeps UNKNOWN terminal and refuses a row before its claim", () => {
  const w = world(), shown = w.snapshot(undefined, 3), [a, b, c] = shown.rows;
  assert.ok(a && b && c);
  w.proposals.issue(shown);
  assert.throws(() => w.proposals.claimRow(shown.id, a.id, randomUUID()), /not-answered/u);
  assert.equal(w.proposals.claimAnswer(answer(shown)), true);
  const commandA = randomUUID(), commandB = randomUUID();
  assert.equal(w.proposals.claimRow(shown.id, a.id, commandA), true);
  assert.equal(w.proposals.claimRow(shown.id, a.id, randomUUID()), false);
  assert.throws(() => w.proposals.claimRow(shown.id, b.id, commandA), /UNIQUE/u);
  assert.equal(w.proposals.claimRow(shown.id, b.id, commandB), true);
  w.proposals.settleRow(shown.id, a.id, { state: "applied", commandId: commandA, runIds: [randomUUID()] });
  w.proposals.settleRow(shown.id, b.id, { state: "unknown", commandId: commandB });
  w.proposals.settleRow(shown.id, c.id, { state: "refused", code: "ASSISTANT_PROPOSAL_REFUSED", commandId: null });
  assert.equal(w.proposals.claimRow(shown.id, b.id, randomUUID()), false);
  assert.throws(() => w.proposals.settleRow(shown.id, b.id, { state: "applied", commandId: commandB, runIds: [] }), /row-not-claimable/u);
  assert.throws(() => w.proposals.settleRow(shown.id, a.id, { state: "unknown", commandId: commandA }), /row-not-claimable/u);
  assert.deepEqual(w.proposals.read(shown.id)?.rows.map(row => row.result.state), ["applied", "unknown", "refused"]);
});

it("enforces immutability in SQL, cascades with chat deletion and refuses another profile's chat", () => {
  const w = world(), shown = w.snapshot();
  w.proposals.issue(shown);
  assert.throws(() => w.storage.database.prepare("UPDATE assistant_proposals SET snapshot_json='{}' WHERE id=?").run(shown.id), /assistant-proposal-immutable/u);
  assert.throws(() => w.storage.database.prepare("UPDATE assistant_proposals SET state='open' WHERE id=?").run(shown.id), /assistant-proposal-immutable/u);
  assert.throws(() => w.storage.database.prepare("UPDATE assistant_proposal_rows SET state='applied' WHERE proposal_id=?").run(shown.id), /assistant-proposal-row-immutable/u);
  assert.throws(() => w.storage.database.prepare("INSERT INTO assistant_proposals(id,conversation_id,revision,rendered_message_id,rendered_digest,state,answer_message_id,snapshot_json,created_at) VALUES(?,?,1,?,?,'open',NULL,'{}',?)")
    .run(randomUUID(), w.chat, randomUUID(), hex("1"), T), /UNIQUE/u);
  const foreign = { ...shown, id: randomUUID(), renderedMessageId: randomUUID(), profileId: randomUUID() };
  assert.throws(() => w.proposals.issue(AssistantM2ProposalSnapshotSchema.parse({ ...foreign, renderedDigest: assistantM2ProposalDigest(foreign) })), /not-owned/u);
  w.storage.database.prepare("DELETE FROM assistant_conversations WHERE id=?").run(w.chat);
  assert.equal(w.proposals.read(shown.id), undefined);
  assert.equal(Number(w.storage.database.prepare("SELECT COUNT(*) AS n FROM assistant_proposal_rows").get()?.n), 0);
});

it("keeps durable session claims once per accepted message and request with one settlement", () => {
  const w = world(), claims = w.proposals.sessions;
  const claim = AssistantSessionClaimSchema.parse({ actionId: randomUUID(), approvalMode: "ask", dryRun: false, contractFingerprint: hex("9"), requestDigest: hex("8"), claimedAt: T,
    acceptedTurn: { conversationId: w.chat, messageId: randomUUID(), ordinal: 1, acceptedRevision: 2, acceptedAt: T, profileId: w.storage.profileId(), epoch: 7, proposalAnswer: null },
    command: { commandId: randomUUID(), requestedAt: T, requestedBy: "local-operator", source: "assistant", family: "start", type: "start-run",
      target: { workflowId: "person-lookup", startPlanId: randomUUID(), expectedVersion: 1 }, payload: fingerprints } });
  assert.equal(claims.claim(claim), true);
  assert.equal(claims.claim({ ...claim, actionId: randomUUID(), command: { ...claim.command, commandId: randomUUID() } }), false);
  assert.equal(claims.claim({ ...claim, actionId: randomUUID() }), false);
  assert.deepEqual(claims.byCommand(claim.command.commandId), { claim, outcome: { state: "claimed" } });
  claims.settle(claim.actionId, { state: "unknown" });
  assert.throws(() => claims.settle(claim.actionId, { state: "started", runIds: [randomUUID()] }), /not-claimed/u);
  assert.deepEqual(claims.byCommand(claim.command.commandId)?.outcome, { state: "unknown" });
  assert.throws(() => claims.claim({ ...claim, actionId: randomUUID(), requestDigest: hex("7"), command: { ...claim.command, commandId: randomUUID() },
    acceptedTurn: { ...claim.acceptedTurn, profileId: randomUUID() } }), /not-owned/u);
});
