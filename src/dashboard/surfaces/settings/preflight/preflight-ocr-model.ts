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
