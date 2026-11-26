import { randomUUID } from "node:crypto";
import { AssistantHistoryRefusal } from "../../../../src/backend/storage/sqlite/assistant-history.js";
import type { AssistantQueries } from "../../../../src/dashboard/client/index.js";
import {
  AssistantM1ConversationWireSchema, AssistantHistoryOperationSchema, AssistantHistoryResultSchema, AssistantHistoryWireSchema,
} from "../../../../src/models/dashboard/assistant.js";
import { assistantM1HistoryFixture } from "../assistant-m1-history-fixture.js";

/** The served history routes over the real turn-accounting repository in one in-memory database; each write is one transaction. */
export function assistantHistoryServer(profileId: string = randomUUID(), now: () => string = () => new Date().toISOString()) {
  const stamp = now(), storage = assistantM1HistoryFixture({ now: stamp, acceptedAt: stamp, profileId });
  const { database, history: repository } = storage;
  const writes: unknown[] = [];
  let failWrite: ((input: unknown) => "before" | "after" | undefined) | undefined;
  const client: Required<Pick<AssistantQueries, "assistantHistory" | "assistantConversation" | "assistantHistoryWrite">> = {
    async assistantHistory() { return AssistantHistoryWireSchema.parse({ ...repository.list(now()), needsYou: storage.proposals().needsYou(now()) }); },
    async assistantConversation(id) {
      const view = repository.conversation(id, now());
      if (view === undefined) throw new Error("ASSISTANT_CONVERSATION_STALE");
      return AssistantM1ConversationWireSchema.parse({ ...view, sessions: [] });
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
