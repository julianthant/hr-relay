import { createContext, useEffect, useMemo, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import type { DashboardClient } from "../../client/index.js";
import { DashboardClientError } from "../../client/errors.js";
import { STARTUP_READ_DEADLINE_MS } from "../../state/use-bootstrap.js";

export const SLOW_STARTUP_MS = 5_000;
export { STARTUP_READ_DEADLINE_MS };
// Reads a first screen can make, and the account check its next read repeats. Writes are never expired: one may still land after its answer is dropped.
const FIRST_SCREEN_READS = new Set(["activityPopulation", "activityReport", "applicationLifecycle", "assistantActivity", "assistantConversation", "assistantHistory",
  "assistantModelPreference", "assistantModels", "calendar", "chatGptAccount", "checkChatGptAccount", "editableSettings", "intakeSession", "itemAttemptHistory", "notificationCollection",
  "notificationSnapshot", "notificationStatus", "preflightScopes", "readActivityPopulation", "readPreflight", "readiness", "runDetail", "runHistoryStatus", "runSection",
  "settingsFacts", "workbookCatalog", "workbookCompatibility", "workbookHistory", "workbookList", "workbookRevision", "workbookTypes", "workflowExplorer"]);
const STILL_LOADING = '[data-slot="skeleton"], [data-loading-layout], [aria-busy="true"]:not(button)';

/** False while the first screen is still hidden under the startup loader; surfaces that open on their own wait for it. */
export const FirstScreenRevealedContext = createContext(true);

/**
 * The startup loader stays over the mounted dashboard until no part of it is still loading, then
 * lifts in one step. Reads still pending at the startup deadline fail into their own part's notice
 * (startupDeadlineClient), so the loader always ends on a settled screen.
 */
export function useFirstScreen(screen: RefObject<HTMLElement | null>, mounted: boolean, client: DashboardClient, startDeadline?: () => StartupDeadline) {
  const [revealed, setRevealed] = useState(false);
  const [slow, setSlow] = useState(false);
  const deadline = useMemo(() => startDeadline?.() ?? startupDeadlineClient(client), [startDeadline, client]);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_STARTUP_MS);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    const node = screen.current;
    if (!mounted || node === null) { setRevealed(false); return; }
    if (revealed) { deadline.end(); return; }
    // A part inside a hidden subtree (the closed assistant) is not on the first screen; it shows its own loading once opened.
    const complete = () => [...node.querySelectorAll(STILL_LOADING)].every(part => part.closest("[hidden]") !== null);
    // flushSync: the reveal commits in the same task as the last load, so no frame shows the loader over a finished screen.
    const observer = new MutationObserver(() => { if (complete()) flushSync(() => setRevealed(true)); });
    observer.observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-busy", "data-slot", "data-loading-layout", "hidden"] });
    if (complete()) setRevealed(true);
    const timer = setTimeout(deadline.expire, STARTUP_READ_DEADLINE_MS);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [screen, mounted, revealed, deadline]);
  return { revealed: mounted && revealed, slow, client: deadline.client };
}

export type StartupDeadline = ReturnType<typeof startupDeadlineClient>;

/** The dashboard client for the first screen: until `end`, a first-screen read still pending at `expire` fails as a read failure and its late answer is dropped. */
export function startupDeadlineClient(client: DashboardClient) {
  let open = true;
  const expiries = new Set<() => void>();
  const failure = () => new DashboardClientError({ kind: "network", code: "DASHBOARD_READ_FAILED", message: ERROR_CATALOG.DASHBOARD_READ_FAILED.text, retryable: true });
  const wrap = (key: PropertyKey, value: unknown): unknown => {
    if (typeof value !== "function") return value;
    const call = value as (...args: unknown[]) => unknown;
    if (key !== "subscribeDay" && !FIRST_SCREEN_READS.has(String(key))) return (...args: unknown[]) => call.apply(client, args);
    return key === "subscribeDay" ? (input: Parameters<DashboardClient["subscribeDay"]>[0]) => {
      if (!open) return call.call(client, input);
      let settled = false;
      const settle = () => { settled = true; expiries.delete(expire); };
      const subscription = call.call(client, { ...input,
        onDay: (day: Parameters<typeof input.onDay>[0], cursor: Parameters<typeof input.onDay>[1]) => { settle(); input.onDay(day, cursor); },
        onState: (state: Parameters<typeof input.onState>[0]) => { if (state.state === "stopped") settle(); input.onState(state); } }) as ReturnType<DashboardClient["subscribeDay"]>;
      function expire() { subscription.close(); input.onState({ state: "stopped", error: failure() }); }
      if (!settled) expiries.add(expire);
      return subscription;
    } : (...args: unknown[]) => {
      const result = call.apply(client, args);
      if (!open || !(result instanceof Promise)) return result;
      return new Promise((resolve, reject) => {
        const expire = () => reject(failure());
        expiries.add(expire);
        result.then(value => { expiries.delete(expire); resolve(value); }, (error: unknown) => {
          expiries.delete(expire);
          reject(error instanceof Error ? error : failure());
        });
      });
    };
  };
  const wrappers = new Map<PropertyKey, unknown>();
  // An empty target: the client may be frozen, and a proxy must not change a frozen property's value.
  const proxy = new Proxy({}, {
    get: (_, key) => { if (!wrappers.has(key)) wrappers.set(key, wrap(key, Reflect.get(client, key))); return wrappers.get(key); },
    has: (_, key) => Reflect.has(client, key),
  });
  return {
    client: proxy as DashboardClient,
    expire: () => { open = false; for (const expire of [...expiries]) expire(); expiries.clear(); },
    end: () => { open = false; expiries.clear(); },
    /** True until `expire` or `end`. */
    pending: () => open,
  };
}
