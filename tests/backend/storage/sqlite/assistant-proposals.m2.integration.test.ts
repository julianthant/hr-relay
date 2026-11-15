import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { AssistantAcceptedTurnSchema, AssistantM2ProposalSnapshotSchema, AssistantSessionClaimSchema, assistantM2ProposalDigest, type AssistantM2ProposalSnapshot } from "../../../../src/models/dashboard/assistant.js";
import { assistantM1HistoryFixture } from "../../../support/helpers/assistant-m1-history-fixture.js";

const T = "2026-11-09T12:00:00.000Z", hex = (digit: string) => digit.repeat(64);
const fingerprints = { descriptorFingerprint: hex("a"), configFingerprint: hex("b"), ingressSchemaHash: hex("c"), canonicalInputSchemaHash: hex("d"), inputFingerprint: hex("e") };

const usage = { state: "measured", callCount: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2 } as const;
const options = { browserMode: "headless", captureBrowserScreenshots: true, priority: "interactive" } as const;
type Bound = Readonly<{ proposalId: string; proposalRevision: number; renderedMessageId: string; renderedDigest: string }>;

function world() {
  const storage = assistantM1HistoryFixture({ now: T, acceptedAt: T });
  const chat = storage.create();
  const before = storage.history.conversation(chat, T);
  const proposals = storage.proposals();
  assert.deepEqual(storage.history.conversation(chat, T), before, "M2 statements keep the populated M1 chat");
  /** One genuine accepted operator message; `proposalAnswer` binds it to a shown proposal. */
  const accept = (conversationId: string = chat, proposalAnswer: Bound | null = null) => {
    const accepted = storage.history.accept({ ...storage.input(conversationId), proposalAnswer: AssistantAcceptedTurnSchema.shape.proposalAnswer.parse(proposalAnswer) });
    assert.equal(accepted.state, "accepted"); if (accepted.state !== "accepted") assert.fail();
    return accepted;
  };
  const reply = (accepted: ReturnType<typeof accept>) => {
    const id = randomUUID();
    assert.ok(storage.history.settle(accepted, { delivery: "answered", usage, reply: { id, kind: "answer", parts: [{ kind: "text", runs: [{ kind: "plain", text: "Proposed" }] }], modelText: "Proposed" } }, T));
    return id;
  };
  /** A proposing turn's reply in `conversationId`, then the snapshot rendered in it. */
  const snapshot = (conversationId = chat, rows = 2, shownOptions: typeof options = options): AssistantM2ProposalSnapshot => {
    const source = accept(conversationId);
    const draft = { id: randomUUID(), profileId: storage.profileId(), conversationId, revision: 1, renderedMessageId: reply(source), sourceMessageId: source.acceptedTurn.messageId,
      label: "Start Person Lookup", dryRun: false, options: shownOptions, createdAt: T, rows: Array.from({ length: rows }, (_, index) => ({ id: randomUUID(), ordinal: index + 1, title: `Row ${String(index + 1)}`,
        display: { kind: "request" as const }, operation: { kind: "workflow-start" as const, workflowId: "person-lookup", submission: { line: String(index) }, reviewed: "e".repeat(64) } })) };
    return AssistantM2ProposalSnapshotSchema.parse({ ...draft, renderedDigest: assistantM2ProposalDigest(draft) });
  };
  const bound = (shown: AssistantM2ProposalSnapshot): Bound => ({ proposalId: shown.id, proposalRevision: shown.revision, renderedMessageId: shown.renderedMessageId, renderedDigest: shown.renderedDigest });
  /** The operator's answer: a genuine accepted message bound to `shown`. */
  const answer = (shown: AssistantM2ProposalSnapshot, overrides: Partial<Bound> = {}) => {
    const accepted = accept(shown.conversationId, { ...bound(shown), ...overrides });
    return { ...bound(shown), ...overrides, answerMessageId: accepted.acceptedTurn.messageId, accepted, attempt: accepted, now: T };
  };
  const finish = (accepted: ReturnType<typeof accept>) => { reply(accepted); };
  return { storage, chat, proposals, snapshot, accept, reply, answer, bound, finish };
}

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
  for (const wrong of [{ proposalRevision: 2 }, { renderedDigest: hex("f") }, { renderedMessageId: randomUUID() }]) {
    const attempt = w.answer(first, wrong);
    assert.equal(w.proposals.claimAnswer(attempt), false); w.finish(attempt.accepted);
  }
  const second = w.snapshot();
  w.proposals.issue(second);
  assert.deepEqual(w.proposals.read(first.id)?.lifecycle, { state: "superseded" });
  const late = w.answer(first); assert.equal(w.proposals.claimAnswer(late), false); w.finish(late.accepted);
  const third = w.snapshot(); w.proposals.issue(third);
  const yes = w.answer(third);
  assert.equal(w.proposals.claimAnswer(yes), true);
  assert.equal(w.proposals.claimAnswer(yes), false);
  assert.deepEqual(w.proposals.read(third.id)?.lifecycle, { state: "answered", answerMessageId: yes.answerMessageId });
  assert.equal(w.proposals.needsYou(T), 0);
  w.finish(yes.accepted);
  const fourth = w.snapshot(); w.proposals.issue(fourth); w.proposals.supersede(w.chat);
  const after = w.answer(fourth); assert.equal(w.proposals.claimAnswer(after), false); assert.equal(w.proposals.open(w.chat), undefined);
  assert.equal(w.proposals.needsYou(T), 0);
});

it("answers only with the live accepted message right after the rendered reply, in the same chat and bound to that proposal", () => {
  const w = world(), shown = w.snapshot();
  w.proposals.issue(shown);
  const unbound = w.accept();
  const claim = (attempt: typeof unbound, messageId = attempt.acceptedTurn.messageId) => w.proposals.claimAnswer({ ...w.bound(shown),
    attempt: { ...attempt, acceptedTurn: AssistantAcceptedTurnSchema.parse({ ...attempt.acceptedTurn, messageId }) }, now: T });
  assert.equal(claim(unbound, randomUUID()), false, "nonexistent message");
  assert.equal(claim(unbound, shown.renderedMessageId), false, "a reply is not an accepted operator message");
  assert.equal(claim(unbound), false, "an accepted message that answered nothing");
  w.finish(unbound);
  const other = w.storage.create(), foreign = w.accept(other, w.bound(shown));
  assert.equal(claim(foreign), false, "another chat's accepted message");
  assert.equal(w.proposals.read(shown.id)?.lifecycle.state, "open");

  const later = w.snapshot(); w.proposals.issue(later);
  const localId = randomUUID();
  w.storage.history.apply({ operation: "local", conversationId: w.chat, expectedRevision: w.storage.revision(w.chat), messageId: localId, text: "Note" }, T);
  assert.equal(claim(unbound, localId), false, "an unrecorded local message");
  const intervened = w.answer(later);
  assert.equal(w.proposals.claimAnswer(intervened), false, "a message between the rendered reply and the answer");
  w.finish(intervened.accepted);

  const settled = w.snapshot(); w.proposals.issue(settled);
  const finished = w.answer(settled); w.finish(finished.accepted);
  assert.equal(w.proposals.claimAnswer(finished), false, "an answer no longer sending");
});

it("claims an answer only through the live accepted attempt: a changed epoch, a restarted owner or an expired chat leaves the proposal open", () => {
  for (const fault of ["epoch", "restart", "expiry"] as const) {
    const w = world(), shown = w.snapshot();
    w.proposals.issue(shown);
    const yes = w.answer(shown);
    if (fault === "epoch") w.storage.changeEpoch();
    const owner = fault === "restart" ? w.storage.proposals(w.storage.restart()) : w.proposals;
    assert.equal(owner.claimAnswer({ ...yes, now: fault === "expiry" ? "2027-01-01T00:00:00.000Z" : T }), false, fault);
    assert.deepEqual(w.proposals.read(shown.id)?.lifecycle, { state: "open" });
    assert.throws(() => w.proposals.claimRow(shown.id, shown.rows[0]?.id ?? "", randomUUID()), /not-answered/u);
  }
});

it("issues only a snapshot rendered in its chat's latest reply to its source message", () => {
  const w = world(), shown = w.snapshot();
  w.finish(w.accept());
  assert.throws(() => w.proposals.issue(shown), /rendered-message-invalid/u);
  const elsewhere = w.snapshot(w.storage.create()), moved = { ...elsewhere, id: randomUUID(), conversationId: w.chat };
  assert.throws(() => w.proposals.issue(AssistantM2ProposalSnapshotSchema.parse({ ...moved, renderedDigest: assistantM2ProposalDigest(moved) })), /rendered-message-invalid/u);
  const current = w.snapshot(), unsourced = { ...current, id: randomUUID(), sourceMessageId: randomUUID() };
  assert.throws(() => w.proposals.issue(AssistantM2ProposalSnapshotSchema.parse({ ...unsourced, renderedDigest: assistantM2ProposalDigest(unsourced) })), /rendered-message-invalid/u);
  assert.equal(w.proposals.issue(current).lifecycle.state, "open");
});

it("binds the reviewed start options into the digest", () => {
  const w = world(), shown = w.snapshot();
  for (const changed of [{ ...options, browserMode: "headed" }, { ...options, captureBrowserScreenshots: false }, { ...options, priority: "bulk" }])
    assert.equal(AssistantM2ProposalSnapshotSchema.safeParse({ ...shown, options: changed }).success, false);
  assert.equal(AssistantM2ProposalSnapshotSchema.safeParse({ ...shown, options: { ...options, instance: 1 } }).success, false);
  assert.equal(AssistantM2ProposalSnapshotSchema.safeParse({ ...shown }).success, true);
});

it("claims each row for one command once, keeps UNKNOWN terminal and refuses a row before its claim", () => {
  const w = world(), shown = w.snapshot(undefined, 3), [a, b, c] = shown.rows;
  assert.ok(a && b && c);
  w.proposals.issue(shown);
  assert.throws(() => w.proposals.claimRow(shown.id, a.id, randomUUID()), /not-answered/u);
  assert.equal(w.proposals.claimAnswer(w.answer(shown)), true);
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
  const foreign = { ...w.snapshot(), id: randomUUID(), profileId: randomUUID() };
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
