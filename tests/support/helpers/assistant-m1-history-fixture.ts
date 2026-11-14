import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ASSISTANT_HISTORY_MIGRATION, ASSISTANT_M1_HISTORY_STATEMENTS, createAssistantM1HistoryRepository } from "../../../src/backend/storage/sqlite/assistant-history.js";
import { ASSISTANT_ATTACHMENTS_MIGRATION } from "../../../src/backend/storage/sqlite/assistant-attachments.js";
import { ASSISTANT_M2_PROPOSAL_STATEMENTS, createAssistantProposalRepository } from "../../../src/backend/storage/sqlite/assistant-proposals.js";

export function assistantM1HistoryFixture(config: Readonly<{ now: string; acceptedAt: string; profileId?: string }>) {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const statement of [...ASSISTANT_HISTORY_MIGRATION.statements, ...ASSISTANT_ATTACHMENTS_MIGRATION.statements, ...ASSISTANT_M1_HISTORY_STATEMENTS]) database.exec(statement);
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
  let m2 = false;
  /** Applies the candidate M2 statements once over this populated M1 database and opens the prepared proposal owner over `accepted`. */
  const proposals = (accepted: Pick<typeof history, "sending"> = history) => {
    if (!m2) for (const statement of ASSISTANT_M2_PROPOSAL_STATEMENTS) database.exec(statement);
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
