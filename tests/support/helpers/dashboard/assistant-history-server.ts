import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ASSISTANT_HISTORY_MIGRATION, AssistantHistoryRefusal, createAssistantHistoryRepository } from "../../../../src/backend/storage/sqlite/assistant-history.js";
import { ASSISTANT_ATTACHMENTS_MIGRATION } from "../../../../src/backend/storage/sqlite/assistant-attachments.js";
import type { AssistantQueries } from "../../../../src/dashboard/client/index.js";
import {
  AssistantConversationViewSchema, AssistantHistoryOperationSchema, AssistantHistoryResultSchema, AssistantHistoryViewSchema,
} from "../../../../src/models/dashboard/assistant.js";

/** The served history routes over the real repository and migration in one in-memory database; each write is one transaction. */
export function assistantHistoryServer(profileId: string = randomUUID(), now: () => string = () => new Date().toISOString()) {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const statement of [...ASSISTANT_HISTORY_MIGRATION.statements, ...ASSISTANT_ATTACHMENTS_MIGRATION.statements]) database.exec(statement);
  const repository = createAssistantHistoryRepository({ database, profileId: () => profileId, read: work => work(),
    mutate: (_table, work) => {
      database.exec("BEGIN IMMEDIATE");
      try { const { result } = work(); database.exec("COMMIT"); return result; } catch (error) { database.exec("ROLLBACK"); throw error; }
    } });
  const writes: unknown[] = [];
  let failWrite: ((input: unknown) => "before" | "after" | undefined) | undefined;
  const client: Required<Pick<AssistantQueries, "assistantHistory" | "assistantConversation" | "assistantHistoryWrite">> = {
    async assistantHistory() { return AssistantHistoryViewSchema.parse(repository.list(now())); },
    async assistantConversation(id) {
      const view = repository.conversation(id, now());
      if (view === undefined) throw new Error("ASSISTANT_CONVERSATION_STALE");
      return AssistantConversationViewSchema.parse(view);
    },
    async assistantHistoryWrite(input) {
      const operation = AssistantHistoryOperationSchema.parse(input), fault = failWrite?.(operation);
      writes.push(operation);
      if (fault === "before") throw new Error("synthetic lost request");
      let result;
      try { result = repository.apply(operation, now()); } catch (error) {
        if (!(error instanceof AssistantHistoryRefusal)) throw error;
        result = { state: "refused" as const, code: error.code };
      }
      if (fault === "after") throw new Error("synthetic lost response");
      return AssistantHistoryResultSchema.parse(result);
    },
  };
  return { profileId, database, repository, client, writes, now,
    /** Lose the request or its response for the writes the predicate selects. */
    fail(predicate: typeof failWrite) { failWrite = predicate; },
    close() { database.close(); } };
}
