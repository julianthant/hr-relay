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
  /** The selected model or other verification input changed; any shown result is no longer current. */
  readonly invalidate?: () => void;
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
  return { snapshot: useSyncExternalStore(port.subscribe, port.getSnapshot, port.getSnapshot), testAssistant: port.testAssistant, invalidate: port.invalidate };
}

export const ASSISTANT_VERIFICATION_WINDOW_MS = 15 * 60_000;
const authorityKey = (snapshot: ReturnType<ChatGptAccountPort["getSnapshot"]>) =>
  snapshot.state === "connected" ? `connected:${snapshot.email}:${snapshot.planUsage}:${snapshot.expiresAt ?? ""}` : snapshot.state;

/** Runs the same explicit verification the chat used; a result lives only for the current account capability and the 15-minute window. */
export function createServedPreflightAssistantPort(client: Pick<AssistantQueries, "assistantRespond">, account: ChatGptAccountPort): PreflightAssistantPort & { readonly dispose: () => void } {
  let snapshot: PreflightAssistantSnapshot = { state: "idle" };
  let epoch = 0, expiry: ReturnType<typeof setTimeout> | undefined, request: AbortController | undefined, refreshing = false, disposed = false;
  let key = authorityKey(account.getSnapshot());
  const listeners = new Set<() => void>();
  const set = (next: PreflightAssistantSnapshot) => { snapshot = next; for (const listener of listeners) listener(); };
  const retire = () => {
    epoch += 1; clearTimeout(expiry); expiry = undefined; request?.abort(); request = undefined;
    if (snapshot.state !== "idle") set({ state: "idle" });
  };
  const unsubscribe = account.subscribe(() => {
    if (refreshing) return;
    const next = authorityKey(account.getSnapshot());
    if (next !== key) { key = next; retire(); }
  });
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    invalidate: () => { if (!disposed) retire(); },
    dispose: () => { disposed = true; unsubscribe(); retire(); listeners.clear(); },
    async testAssistant() {
      if (disposed || snapshot.state === "loading") return;
      const mine = ++epoch, abort = new AbortController();
      clearTimeout(expiry); request = abort;
      set({ state: "loading" });
      const settle = (next: PreflightAssistantSnapshot) => {
        if (mine !== epoch) return;
        set(next);
        if (next.state === "passed") expiry = setTimeout(() => { if (mine === epoch) set({ state: "idle" }); }, ASSISTANT_VERIFICATION_WINDOW_MS);
      };
      try {
        const result = await client.assistantRespond({ message: ASSISTANT_VERIFY_COMMAND }, abort.signal);
        settle(result.state === "answered" ? { state: "passed" } : { state: "failed", message: result.state === "refused" ? ASSISTANT_FAILURES[result.code] : ASSISTANT_FAILURES.ASSISTANT_VERIFICATION_FAILED });
        if (mine !== epoch) return;
        refreshing = true;
        try { await account.refresh?.(); } finally { refreshing = false; }
        if (mine !== epoch) return;
        const after = authorityKey(account.getSnapshot());
        if (after !== key) { key = after; retire(); }
      } catch { settle({ state: "failed", message: ASSISTANT_FAILURES.ASSISTANT_VERIFICATION_FAILED }); }
    },
  };
}
