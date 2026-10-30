import { readWithDeadline } from "../../../client/read-deadline.js";
import type { ChatGptAccountQueries } from "../../../client/queries/chatgpt-account-queries.js";
import type { ChatGptAccountPort } from "../general/chatgpt-account-model.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { createContext, useContext, useSyncExternalStore } from "react";
import type { ChatGptOcrTestResultSchema } from "../../../../models/dashboard/chatgpt-account.js";
import type { ErrorCatalogCode } from "../../../../models/failures/error-catalog.js";
import type { z } from "zod";

export type PreflightOcrSnapshot =
  | { readonly state: "idle" }
  | { readonly state: "loading" }
  | { readonly state: "disabled"; readonly code: ErrorCatalogCode }
  | { readonly state: "failed"; readonly code: ErrorCatalogCode }
  | z.infer<typeof ChatGptOcrTestResultSchema>;
export interface PreflightOcrPort {
  readonly getSnapshot: () => PreflightOcrSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly testOcr: () => Promise<void>;
}
export function createPreviewPreflightOcrPort(initial: PreflightOcrSnapshot = { state: "disabled", code: "CHATGPT_PLAN_DISABLED" }): PreflightOcrPort {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    testOcr: () => {
      if (snapshot.state === "disabled" || snapshot.state === "loading" || snapshot.state === "uncertain") return Promise.resolve();
      snapshot = { state: "completed", model: "Preview OCR" };
      for (const listener of listeners) listener();
      return Promise.resolve();
    },
  };
}
export const PreflightOcrContext = createContext<PreflightOcrPort>(createPreviewPreflightOcrPort());
export function usePreflightOcr() {
  const port = useContext(PreflightOcrContext);
  const snapshot = useSyncExternalStore(port.subscribe, port.getSnapshot, port.getSnapshot);
  return { snapshot, testOcr: port.testOcr };
}

export function createServedPreflightOcrPort(client: Pick<ChatGptAccountQueries, "testChatGptOcr">, account: ChatGptAccountPort): PreflightOcrPort & { dispose(): void } {
  let disposed = false, epoch = 0;
  let controller: AbortController | undefined;
  const listeners = new Set<() => void>();
  const disabled = (): Extract<PreflightOcrSnapshot, { state: "disabled" }> | undefined => {
    const identity = account.getSnapshot();
    const resource = account.getResource?.();
    if ((resource !== undefined && resource.state !== "loaded") || identity.state !== "connected") return { state: "disabled", code: "CHATGPT_AUTH_UNAVAILABLE" };
    if (identity.planUsage !== "enabled") return { state: "disabled", code: identity.planUsage === "limit-reached" ? "CHATGPT_USAGE_LIMIT" : "CHATGPT_PLAN_DISABLED" };
    return undefined;
  };
  let snapshot: PreflightOcrSnapshot = disabled() ?? { state: "idle" };
  const notify = () => { for (const listener of listeners) listener(); };
  const uncertain = (): PreflightOcrSnapshot => ({ state: "uncertain", code: "CHATGPT_OCR_FAILED", message: ERROR_CATALOG.CHATGPT_OCR_FAILED.text });
  const refresh = () => {
    if (disposed) return;
    ++epoch;
    controller?.abort(); controller = undefined;
    snapshot = snapshot.state === "loading" ? uncertain() : snapshot.state === "uncertain" ? snapshot : disabled() ?? { state: "idle" };
    notify();
  };
  const unsubscribe = account.subscribe(refresh);
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose: () => { disposed = true; ++epoch; unsubscribe(); controller?.abort(); controller = undefined; listeners.clear(); },
    testOcr: async () => {
      if (disposed || controller !== undefined || snapshot.state === "uncertain") return;
      const unavailable = disabled();
      if (unavailable !== undefined) { snapshot = unavailable; notify(); return; }
      const request = ++epoch;
      const owned = new AbortController(); controller = owned;
      snapshot = { state: "loading" }; notify();
      try {
        const result = await readWithDeadline(signal => client.testChatGptOcr(signal), "CHATGPT_OCR_FAILED", 120_000, owned.signal);
        if (!disposed && request === epoch) { snapshot = result; notify(); }
      } catch {
        if (!disposed && request === epoch) { snapshot = uncertain(); notify(); }
      } finally { if (controller === owned) controller = undefined; }
    },
  };
}
