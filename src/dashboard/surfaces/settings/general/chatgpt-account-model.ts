import { createContext, useSyncExternalStore } from "react";

export type ChatGptAccountSnapshot =
  | { readonly state: "loading" }
  | { readonly state: "signed-out" }
  | { readonly state: "expired" }
  | { readonly state: "unavailable"; readonly message: string }
  | { readonly state: "connected"; readonly name: string; readonly email: string;
      readonly planUsage: "enabled" | "disabled" | "limit-reached" };

export interface ChatGptAccountPort {
  readonly mode: "preview" | "live";
  readonly getSnapshot: () => ChatGptAccountSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly signIn: (input: { readonly usePlan: boolean }) => Promise<void>;
  readonly signOut: () => Promise<void>;
}

export const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

/** Preview identity stays in memory; OAuth tokens belong to the backend adapter. */
export function createPreviewChatGptAccountPort(): ChatGptAccountPort {
  let snapshot: ChatGptAccountSnapshot = { state: "signed-out" };
  const listeners = new Set<() => void>();
  const publish = (next: ChatGptAccountSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  return {
    mode: "preview",
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    signIn: ({ usePlan }) => {
      publish({ state: "connected", name: "Jordan Lee", email: "jordan.lee@example.com", planUsage: usePlan ? "enabled" : "disabled" });
      return Promise.resolve();
    },
    signOut: () => { publish({ state: "signed-out" }); return Promise.resolve(); },
  };
}

export const PREVIEW_CHATGPT_ACCOUNT = createPreviewChatGptAccountPort();
export const ChatGptAccountContext = createContext<ChatGptAccountPort>(PREVIEW_CHATGPT_ACCOUNT);

export function useChatGptAccount(port: ChatGptAccountPort): ChatGptAccountSnapshot {
  return useSyncExternalStore(port.subscribe, port.getSnapshot, port.getSnapshot);
}
