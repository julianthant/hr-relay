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

export const ASSISTANT_VERIFICATION_WINDOW_MS = 15 * 60_000;
const authorityKey = (snapshot: ReturnType<ChatGptAccountPort["getSnapshot"]>) => snapshot.state === "connected" ? `connected:${snapshot.email}` : snapshot.state;

/** Runs the same explicit verification the chat used; a result lives only for the current account and the 15-minute window. */
export function createServedPreflightAssistantPort(client: Pick<AssistantQueries, "assistantRespond">, account: ChatGptAccountPort): PreflightAssistantPort & { readonly dispose: () => void } {
  let snapshot: PreflightAssistantSnapshot = { state: "idle" };
  let epoch = 0, expiry: ReturnType<typeof setTimeout> | undefined, key = authorityKey(account.getSnapshot());
  const listeners = new Set<() => void>();
  const set = (next: PreflightAssistantSnapshot) => { snapshot = next; for (const listener of listeners) listener(); };
  const retire = () => { epoch += 1; clearTimeout(expiry); expiry = undefined; if (snapshot.state !== "idle") set({ state: "idle" }); };
  const unsubscribe = account.subscribe(() => { const next = authorityKey(account.getSnapshot()); if (next !== key) { key = next; retire(); } });
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose: () => { unsubscribe(); epoch += 1; clearTimeout(expiry); listeners.clear(); },
    async testAssistant() {
      if (snapshot.state === "loading") return;
      const mine = ++epoch;
      clearTimeout(expiry);
      set({ state: "loading" });
      const settle = (next: PreflightAssistantSnapshot) => {
        if (mine !== epoch) return;
        set(next);
        if (next.state === "passed") expiry = setTimeout(() => { if (mine === epoch) set({ state: "idle" }); }, ASSISTANT_VERIFICATION_WINDOW_MS);
      };
      try {
        const result = await client.assistantRespond({ message: ASSISTANT_VERIFY_COMMAND });
        settle(result.state === "answered" ? { state: "passed" } : { state: "failed", message: result.state === "refused" ? ASSISTANT_FAILURES[result.code] : ASSISTANT_FAILURES.ASSISTANT_VERIFICATION_FAILED });
        if (mine === epoch) await account.refresh?.();
      } catch { settle({ state: "failed", message: ASSISTANT_FAILURES.ASSISTANT_VERIFICATION_FAILED }); }
    },
  };
}
