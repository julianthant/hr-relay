import { createContext, useContext, useSyncExternalStore } from "react";
import { ASSISTANT_VERIFY_COMMAND } from "../../../../models/dashboard/assistant.js";
import { ASSISTANT_FAILURES } from "../../../../models/dashboard/assistant.js";
import type { AssistantQueries } from "../../../client/queries/assistant-queries.js";
import type { ChatGptAccountPort } from "../general/chatgpt-account-model.js";

export type PreflightAssistantSnapshot =
  | { readonly state: "idle" | "loading" | "passed" }
  | { readonly state: "failed"; readonly message: string };
export interface PreflightAssistantPort {
  readonly getSnapshot: () => PreflightAssistantSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly testAssistant: () => Promise<void>;
}

export function createPreviewPreflightAssistantPort(): PreflightAssistantPort {
  let snapshot: PreflightAssistantSnapshot = { state: "idle" };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    testAssistant: () => { snapshot = { state: "passed" }; for (const listener of listeners) listener(); return Promise.resolve(); },
  };
}
export const PreflightAssistantContext = createContext<PreflightAssistantPort>(createPreviewPreflightAssistantPort());
export function usePreflightAssistant() {
  const port = useContext(PreflightAssistantContext);
  return { snapshot: useSyncExternalStore(port.subscribe, port.getSnapshot, port.getSnapshot), testAssistant: port.testAssistant };
}

/** Runs the same explicit verification the chat used, then refreshes the account so the panel unlocks. */
export function createServedPreflightAssistantPort(client: Pick<AssistantQueries, "assistantRespond">, account: ChatGptAccountPort): PreflightAssistantPort {
  let snapshot: PreflightAssistantSnapshot = { state: "idle" };
  const listeners = new Set<() => void>();
  const set = (next: PreflightAssistantSnapshot) => { snapshot = next; for (const listener of listeners) listener(); };
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async testAssistant() {
      if (snapshot.state === "loading") return;
      set({ state: "loading" });
      try {
        const result = await client.assistantRespond({ message: ASSISTANT_VERIFY_COMMAND });
        set(result.state === "answered" ? { state: "passed" } : { state: "failed", message: result.state === "refused" ? ASSISTANT_FAILURES[result.code] : ASSISTANT_FAILURES.ASSISTANT_VERIFICATION_FAILED });
        await account.refresh?.();
      } catch { set({ state: "failed", message: ASSISTANT_FAILURES.ASSISTANT_VERIFICATION_FAILED }); }
    },
  };
}
