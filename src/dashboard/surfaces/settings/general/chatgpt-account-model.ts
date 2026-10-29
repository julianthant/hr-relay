import { CHATGPT_COMPLETION_READ_DEADLINE_MS, readWithDeadline } from "../../../client/read-deadline.js";
import type { ChatGptAccountQueries } from "../../../client/queries/chatgpt-account-queries.js";
import { ChatGptAuthorizationUrlSchema, type ChatGptAccountState, type ChatGptAccountView, type ChatGptSignInCompletion } from "../../../../models/dashboard/chatgpt-account.js";
import { ERROR_CATALOG, type ErrorCatalogCode } from "../../../../models/failures/error-catalog.js";
import { systemClock } from "../../../../rules/time/clock.js";
import { createContext, useSyncExternalStore } from "react";

export type ChatGptAccountSnapshot =
  | { readonly state: "loading" }
  | { readonly state: "signed-out" }
  | { readonly state: "expired" | "sign-in-expired" }
  | { readonly state: "signing-in"; readonly attemptId: string; readonly expiresAt: string; readonly authorizationUrl?: string }
  | { readonly state: "unavailable"; readonly message: string; readonly account?: ChatGptAccountView }
  | { readonly state: "connected"; readonly name: string; readonly email: string;
      readonly expiresAt?: string; readonly planUsage: "enabled" | "disabled" | "limit-reached" };

export interface ChatGptAccountPort {
  readonly getResource?: () => ChatGptAccountResource;
  readonly refresh?: () => Promise<void>;
  readonly mode: "preview" | "live";
  readonly getSnapshot: () => ChatGptAccountSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly signIn: (input: { readonly usePlan: boolean }) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly cancelSignIn: () => Promise<void>;
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
    cancelSignIn: () => { publish({ state: "signed-out" }); return Promise.resolve(); },
  };
}

export const PREVIEW_CHATGPT_ACCOUNT = createPreviewChatGptAccountPort();
export const ChatGptAccountContext = createContext<ChatGptAccountPort>(PREVIEW_CHATGPT_ACCOUNT);

export function useChatGptAccount(port: ChatGptAccountPort): ChatGptAccountSnapshot {
  return useSyncExternalStore(port.subscribe, port.getSnapshot, port.getSnapshot);
}

export type ChatGptAccountResource =
  | { readonly state: "loading"; readonly attemptId?: string }
  | { readonly state: "loaded" | "empty"; readonly account: ChatGptAccountState; readonly warning?: ErrorCatalogCode }
  | { readonly state: "failed" | "refused" | "uncertain"; readonly code: ErrorCatalogCode; readonly account?: ChatGptAccountView };
export interface ChatGptAuthorizationWindow { navigate(url: string): void; close(): void }
export function openChatGptAuthorizationWindow(): ChatGptAuthorizationWindow | undefined {
  const popup = window.open("about:blank", "_blank");
  if (popup === null) return undefined;
  try { popup.opener = null; }
  catch { popup.close(); throw new Error(ERROR_CATALOG.CHATGPT_AUTH_UNAVAILABLE.text); }
  return { navigate: url => { popup.location.replace(ChatGptAuthorizationUrlSchema.parse(url)); }, close: () => popup.close() };
}

export function createServedChatGptAccountPort(client: ChatGptAccountQueries, options: {
  readonly open?: () => ChatGptAuthorizationWindow | undefined;
  readonly nowMs?: () => number;
} = {}): ChatGptAccountPort & { refresh(): Promise<void>; dispose(): void; getResource(): ChatGptAccountResource } {
  let snapshot: ChatGptAccountSnapshot = { state: "loading" };
  let resource: ChatGptAccountResource = { state: "loading" };
  let epoch = 0, disposed = false, busy = false, loaded = false;
  let cancelling: number | undefined;
  let ownedPopup: ChatGptAuthorizationWindow | undefined;
  let refreshing: Promise<void> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const nowMs = options.nowMs ?? (() => systemClock.nowMs());
  const current = (request: number) => !disposed && request === epoch;
  const notify = () => { for (const listener of listeners) listener(); };
  const problem = (state: "failed" | "refused" | "uncertain", code: ErrorCatalogCode, account: ChatGptAccountView | undefined = "account" in resource ? resource.account : undefined) => {
    clearTimeout(expiryTimer);
    resource = { state, code, ...(account === undefined ? {} : { account }) };
    snapshot = { state: "unavailable", message: ERROR_CATALOG[code].text, ...(account === undefined ? {} : { account }) };
    if (account?.state === "signing-in") scheduleSignInExpiry(account.expiresAt, epoch);
    notify();
  };
  const closePopup = () => {
    const popup = ownedPopup;
    ownedPopup = undefined;
    try { popup?.close(); }
    catch { if (!disposed) problem("failed", "CHATGPT_AUTH_UNAVAILABLE"); }
  };
  const expireSignIn = () => {
    ++epoch;
    busy = false;
    cancelling = undefined;
    refreshing = undefined;
    clearTimeout(expiryTimer);
    resource = { state: "refused", code: "CHATGPT_AUTH_EXPIRED" };
    snapshot = { state: "sign-in-expired" };
    closePopup();
    notify();
  };
  const scheduleSignInExpiry = (expiresAt: string, request: number) => {
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => { if (current(request)) expireSignIn(); }, Math.min(2_147_483_647, Math.max(0, Date.parse(expiresAt) - nowMs())));
  };
  const signingIn = (attempt: { attemptId: string; expiresAt: string; authorizationUrl?: string }, request: number) => {
    resource = { state: "loading", attemptId: attempt.attemptId };
    snapshot = { state: "signing-in", ...attempt };
    scheduleSignInExpiry(attempt.expiresAt, request);
    notify();
  };
  const accept = (account: ChatGptAccountState) => {
    clearTimeout(expiryTimer);
    if (account.state === "unavailable") { problem("failed", account.code, account); return; }
    resource = { state: account.state === "signed-out" ? "empty" : "loaded", account };
    snapshot = account.state === "connected" && Date.parse(account.expiresAt) <= nowMs() ? { state: "expired" } : account;
    if (account.state === "connected" && snapshot.state === "connected") {
      expiryTimer = setTimeout(() => { void refresh(); }, Math.min(2_147_483_647, Date.parse(account.expiresAt) - nowMs()));
    }
    notify();
  };
  const reconcileProblem = async (request: number, code: ErrorCatalogCode = "CHATGPT_AUTH_UNAVAILABLE", state: "uncertain" | "refused" = "uncertain") => {
    if (!current(request)) return;
    try {
      const account = await readWithDeadline(() => client.chatGptAccount(), "CHATGPT_AUTH_UNAVAILABLE");
      if (current(request)) {
        problem(state, code, account);
      }
    } catch { if (current(request)) problem(state, code); }
  };
  const complete = async (attemptId: string, expiresAt: string, request: number) => {
    let result: ChatGptSignInCompletion;
    try { result = await readWithDeadline(signal => client.completeChatGptSignIn(attemptId, signal), "CHATGPT_AUTH_UNAVAILABLE", Math.min(2_147_483_647, Math.max(CHATGPT_COMPLETION_READ_DEADLINE_MS, Date.parse(expiresAt) - nowMs()))); }
    catch { await reconcileProblem(request); return; }
    if (!current(request)) return;
    if (result.state === "completed") accept(result.account);
    else if (result.state === "uncertain") await reconcileProblem(request, result.code);
    else if (result.code === "CHATGPT_AUTH_EXPIRED") expireSignIn();
    else problem("refused", result.code);
  };
  async function readAccount(): Promise<void> {
    const request = ++epoch;
    busy = true; notify();
    try {
      const account = await readWithDeadline(() => client.chatGptAccount(), "CHATGPT_AUTH_UNAVAILABLE");
      if (!current(request)) return;
      loaded = true;
      if (account.state === "signing-in") {
        const authorizationUrl = account.authorizationUrl;
        signingIn({ attemptId: account.attemptId, expiresAt: account.expiresAt, ...(authorizationUrl === undefined ? {} : { authorizationUrl }) }, request);
        await complete(account.attemptId, account.expiresAt, request);
      } else accept(account);
    } catch { if (current(request)) problem("failed", "CHATGPT_AUTH_UNAVAILABLE"); }
    finally { if (current(request)) { busy = false; notify(); } }
  }
  function refresh(): Promise<void> {
    if (refreshing !== undefined) return refreshing;
    const reading = readAccount().finally(() => { if (refreshing === reading) { refreshing = undefined; notify(); } });
    refreshing = reading;
    return reading;
  }
  return {
    mode: "live", getSnapshot: () => snapshot, getResource: (): ChatGptAccountResource => resource.state !== "loading" && (busy || refreshing !== undefined) ? { state: "loading" } : resource,
    subscribe: listener => {
      listeners.add(listener);
      if (!loaded && !busy && listeners.size === 1) { loaded = true; void refresh(); }
      return () => { listeners.delete(listener); };
    },
    refresh,
    dispose: () => { disposed = true; ++epoch; closePopup(); clearTimeout(expiryTimer); listeners.clear(); },
    signIn: async input => {
      if (disposed || busy || resource.state === "loading") return;
      let popup: ChatGptAuthorizationWindow | undefined;
      try { popup = (options.open ?? openChatGptAuthorizationWindow)(); }
      catch { problem("refused", "CHATGPT_AUTH_UNAVAILABLE"); return; }
      if (popup === undefined) { problem("refused", "CHATGPT_AUTH_UNAVAILABLE"); return; }
      ownedPopup = popup;
      clearTimeout(expiryTimer);
      busy = true; notify();
      const request = ++epoch;
      try {
        const result = await client.startChatGptSignIn(input);
        if (!current(request)) return;
        if (result.state === "refused") { problem("refused", result.code); return; }
        if (result.state === "uncertain") { await reconcileProblem(request, result.code); return; }
        try { popup.navigate(ChatGptAuthorizationUrlSchema.parse(result.authorizationUrl)); }
        catch {
          const cancelled = await client.cancelChatGptSignIn(result.attemptId);
          if (current(request)) {
            if (cancelled.state === "cancelled") problem("refused", "CHATGPT_AUTH_CANCELLED");
            else await reconcileProblem(request);
          }
          return;
        }
        signingIn({ attemptId: result.attemptId, expiresAt: result.expiresAt, authorizationUrl: result.authorizationUrl }, request);
        await complete(result.attemptId, result.expiresAt, request);
      } catch { await reconcileProblem(request); }
      finally { if (ownedPopup === popup) closePopup(); if (current(request)) { busy = false; notify(); } }
    },
    cancelSignIn: async () => {
      const pending = snapshot.state === "unavailable" ? snapshot.account : snapshot;
      if (disposed || cancelling !== undefined || pending?.state !== "signing-in") return;
      const attemptId = pending.attemptId;
      const request = ++epoch;
      cancelling = request;
      refreshing = undefined;
      scheduleSignInExpiry(pending.expiresAt, request);
      busy = true; notify();
      try {
        const result = await readWithDeadline(signal => client.cancelChatGptSignIn(attemptId, signal), "CHATGPT_AUTH_UNAVAILABLE");
        if (!current(request)) return;
        if (result.state === "cancelled") {
          closePopup();
          const account = await readWithDeadline(() => client.chatGptAccount(), "CHATGPT_AUTH_UNAVAILABLE");
          if (!current(request)) return;
          if (account.state === "signing-in") problem("uncertain", "CHATGPT_AUTH_UNAVAILABLE", account);
          else accept(account);
        } else if (result.state === "uncertain") await reconcileProblem(request, result.code);
        else await reconcileProblem(request, result.code, "refused");
      } catch { await reconcileProblem(request); }
      finally { if (cancelling === request) cancelling = undefined; if (current(request)) { busy = false; notify(); } }
    },
    signOut: async () => {
      if (disposed || busy) return;
      clearTimeout(expiryTimer);
      busy = true; notify();
      const request = ++epoch;
      try {
        const result = await client.signOutChatGpt();
        if (!current(request)) return;
        if (result.state === "signed-out") {
          if (result.remoteRevocation === "unconfirmed") {
            clearTimeout(expiryTimer);
            resource = { state: "empty", account: { state: "signed-out" }, warning: "CHATGPT_REVOCATION_UNCONFIRMED" };
            snapshot = { state: "unavailable", message: ERROR_CATALOG.CHATGPT_REVOCATION_UNCONFIRMED.text };
            notify();
          }
          else accept({ state: "signed-out" });
        } else if (result.state === "uncertain") await reconcileProblem(request, result.code);
        else problem("refused", result.code);
      } catch { await reconcileProblem(request); }
      finally { busy = false; notify(); }
    },
  };
}
