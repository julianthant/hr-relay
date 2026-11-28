import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { AssistantProposalSnapshotSchema, assistantProposalDigest, type AssistantReplyPart } from "../../../src/models/dashboard/assistant.js";
import { ASSISTANT_HISTORY_MIGRATION, ASSISTANT_M1_HISTORY_STATEMENTS, createAssistantM1HistoryRepository } from "../../../src/backend/storage/sqlite/assistant-history.js";
import { ASSISTANT_ATTACHMENTS_MIGRATION } from "../../../src/backend/storage/sqlite/assistant-attachments.js";
import { ASSISTANT_PROPOSAL_STATEMENTS, createAssistantProposalRepository } from "../../../src/backend/storage/sqlite/assistant-proposals.js";

export function assistantM1HistoryFixture(config: Readonly<{ now: string; acceptedAt: string; profileId?: string }>, installedDatabase?: DatabaseSync) {
  const database = installedDatabase ?? new DatabaseSync(":memory:");
  if (installedDatabase === undefined) {
    database.exec("PRAGMA foreign_keys=ON");
    for (const statement of [...ASSISTANT_HISTORY_MIGRATION.statements, ...ASSISTANT_ATTACHMENTS_MIGRATION.statements, ...ASSISTANT_M1_HISTORY_STATEMENTS]) database.exec(statement);
  }
  const profileId = config.profileId ?? randomUUID();
  let epoch = 7, generation = 0, depth = 0, sequence = 0, dirty = false;
  const callbacks: (() => void)[] = [];
  function transaction<T>(work: () => T): T {
    const nested = depth > 0, savepoint = `prepared_${String(++sequence)}`, before = callbacks.length, dirtyBefore = dirty;
    database.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE"); depth++;
    let result: T;
    try {
      result = work();
      database.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : "COMMIT");
    } catch (error) {
      if (nested) { database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); database.exec(`RELEASE SAVEPOINT ${savepoint}`); }
      else database.exec("ROLLBACK");
      callbacks.splice(before); dirty = dirtyBefore; throw error;
    } finally { depth--; }
    if (!nested) {
      if (dirty) generation++;
      dirty = false;
      const committed = callbacks.splice(0); for (const publish of committed) publish();
    }
    return result;
  }
  const schemaBefore = database.prepare("SELECT name,sql FROM sqlite_schema ORDER BY name").all();
  const ports: Parameters<typeof createAssistantM1HistoryRepository>[0] = { database, profileId: () => profileId, epoch: () => epoch,
    afterCommit: publish => { if (depth === 0) publish(); else callbacks.push(publish); },
    read: work => { if (depth > 0) return work(); database.exec("BEGIN"); try { const result = work(); database.exec("COMMIT"); return result; } catch (error) { database.exec("ROLLBACK"); throw error; } },
    mutate: (_table, work) => transaction(() => { const value = work(); if (value.changes > 0) dirty = true; return value.result; }) };
  const history = createAssistantM1HistoryRepository(ports);
  let m2 = installedDatabase !== undefined;
  /** Installs M2 in the in-memory fixture once and opens the prepared proposal owner over `accepted`. */
  const proposals = (accepted: Pick<typeof history, "sending"> = history) => {
    if (!m2) for (const statement of ASSISTANT_PROPOSAL_STATEMENTS) database.exec(statement);
    m2 = true;
    return createAssistantProposalRepository({ database, profileId: () => profileId, read: work => ports.read(work), accepted,
      mutate: (_table, work) => transaction(() => { const value = work(); if (value.changes > 0) dirty = true; return value.result; }) });
  };
  assert.deepEqual(database.prepare("SELECT name,sql FROM sqlite_schema ORDER BY name").all(), schemaBefore, "prepared construction never changes schema");
  const create = (title = "Chat") => { const id = randomUUID(); history.apply({ operation: "create", conversationId: id, title }, config.now); return id; };
  const revision = (id: string) => { const chat = history.conversation(id, config.now); assert.ok(chat); return chat.revision; };
  const input = (id: string, text = "Explain") => ({ conversationId: id, expectedRevision: revision(id), messageId: randomUUID(), text,
    modelText: `masked ${text}`, subjectRef: null, attachments: [], proposalAnswer: null, now: config.acceptedAt });
  return { database, history, proposals, create, revision, input, outer: transaction, restart: () => createAssistantM1HistoryRepository(ports), generation: () => generation, epoch: () => epoch, profileId: () => profileId,
    changeEpoch: () => epoch++ };
}

export function seedAssistantPhaseOne(database: DatabaseSync, profileId: string, now: string) {
  const storage = assistantM1HistoryFixture({ now, acceptedAt: now, profileId }, database);
  const conversationId = storage.create(), proposals = storage.proposals();
  const turn = storage.history.accept(storage.input(conversationId));
  if (turn.state !== "accepted") assert.fail("fixture turn was not accepted");
  const renderedMessageId = randomUUID();
  const parts: AssistantReplyPart[] = [{ kind: "text", runs: [{ kind: "plain", text: "Ready to start" }] }];
  const usage = { state: "measured", callCount: 1, inputTokens: 2, outputTokens: 3, totalTokens: 5 } as const;
  assert.ok(storage.history.settle(turn, { delivery: "answered", usage,
    reply: { id: renderedMessageId, kind: "answer", parts, modelText: "Ready to start" } }, now));
  const rowId = randomUUID(), fingerprint = "a".repeat(64);
  const draft = { id: randomUUID(), profileId, conversationId, renderedMessageId, revision: 1, sourceMessageId: turn.acceptedTurn.messageId,
    label: "Start Person Lookup", dryRun: true, createdAt: now, options: { browserMode: "headless", captureBrowserScreenshots: true, priority: "interactive" } as const,
    rows: [{ id: rowId, ordinal: 1, title: "Synthetic row", display: { kind: "request" } as const,
      operation: { kind: "workflow-start", workflowId: "person-lookup", submission: {}, reviewed: fingerprint } as const }] };
  const shown = AssistantProposalSnapshotSchema.parse({ ...draft, renderedDigest: assistantProposalDigest(draft) });
  proposals.issue(shown);
  const binding = { proposalId: shown.id, proposalRevision: shown.revision, renderedMessageId, renderedDigest: shown.renderedDigest };
  const answer = storage.history.accept({ ...storage.input(conversationId, "Yes"), proposalAnswer: binding });
  if (answer.state !== "accepted") assert.fail("fixture answer was not accepted");
  assert.equal(proposals.claimAnswer({ ...binding, attempt: answer, now }), true);
  assert.equal(proposals.claimRow(shown.id, rowId, randomUUID()), true);
  assert.equal(proposals.sessions.claim({ actionId: randomUUID(), approvalMode: "full-access", dryRun: true, contractFingerprint: fingerprint,
    requestDigest: fingerprint, claimedAt: now, acceptedTurn: answer.acceptedTurn,
    command: { commandId: randomUUID(), requestedAt: now, requestedBy: "local-operator", source: "assistant", family: "start", type: "start-run",
      target: { workflowId: "person-lookup", startPlanId: randomUUID(), expectedVersion: 1 },
      payload: { descriptorFingerprint: fingerprint, configFingerprint: fingerprint, ingressSchemaHash: fingerprint,
        canonicalInputSchemaHash: fingerprint, inputFingerprint: fingerprint } } }), true);
  assert.ok(storage.history.settle(answer, { delivery: "answered", usage }, now));
  return conversationId;
}
