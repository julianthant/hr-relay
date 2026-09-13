import { useCallback,useEffect,useMemo,useRef,useState } from "react";
import {
parseRoute,
routeAdvancesHistory,
routeToSearch,
type AppRouteState
} from "./url-state.js";


/** The route, kept in the URL so every screen is addressable. */
export interface RouteHistoryTarget {
  readonly route: AppRouteState;
  readonly cursor: number;
  /** Revokes a delayed guard callback after a newer navigation intent. */
  readonly intent?: number;
}

export type PopstateRouteHandler = (target: RouteHistoryTarget) => void;

export interface NativeRouteHistory {
  accept(target: RouteHistoryTarget): void;
  restore(target: RouteHistoryTarget, afterRestore: () => void): void;
  replay(target: RouteHistoryTarget): void;
}

const ROUTE_CURSOR_KEY = "hrDashboardRouteCursor";


function cursorOf(state: unknown): number | undefined {
  if (typeof state !== "object" || state === null) return undefined;
  const cursor: unknown = Reflect.get(state, ROUTE_CURSOR_KEY);
  return typeof cursor === "number" && Number.isInteger(cursor) && cursor >= 0 ? cursor : undefined;
}


export function useRoute(
  onPopstateRef: { readonly current: PopstateRouteHandler | undefined },
): [AppRouteState, (next: AppRouteState) => void, NativeRouteHistory] {
  const [route, setRouteState] = useState<AppRouteState>(() => parseRoute(window.location.search));
  const acceptedRoute = useRef(route);
  const cursor = useRef(cursorOf(window.history.state) ?? 0);
  const intent = useRef(0);
  const queuedRoute = useRef<AppRouteState | undefined>(undefined);
  const pendingPop = useRef<
    | { readonly cursor: number; readonly kind: "restore"; readonly afterRestore: () => void }
    | { readonly cursor: number; readonly kind: "accept"; readonly route: AppRouteState }
    | undefined
  >(undefined);

  useEffect(() => {
    if (cursorOf(window.history.state) === undefined) {
      window.history.replaceState({ [ROUTE_CURSOR_KEY]: cursor.current }, "", window.location.href);
    }
  }, []);

  const commitRoute = useCallback((next: AppRouteState) => {
    if (routeAdvancesHistory(next, window.location.search)) {
      cursor.current += 1;
      window.history.pushState({ [ROUTE_CURSOR_KEY]: cursor.current }, "", `${window.location.pathname}${routeToSearch(next)}`);
    }
    acceptedRoute.current = next;
    setRouteState(next);
  }, []);

  useEffect(() => {
    const onPop = (): void => {
      const next = parseRoute(window.location.search);
      const nextCursor = cursorOf(window.history.state);
      if (nextCursor === undefined) throw new Error("dashboard history entry has no route cursor");
      const pending = pendingPop.current;
      if (pending !== undefined && pending.cursor === nextCursor) {
        pendingPop.current = undefined;
        cursor.current = nextCursor;
        const queued = queuedRoute.current;
        queuedRoute.current = undefined;
        if (queued !== undefined) commitRoute(queued);
        else if (pending.kind === "restore") pending.afterRestore();
        else { acceptedRoute.current = next; setRouteState(next); }
        return;
      }
      if (pending === undefined && nextCursor === cursor.current
        && routeToSearch(next) === routeToSearch(acceptedRoute.current)) return;
      const handler = onPopstateRef.current;
      const target = { route: next, cursor: nextCursor, intent: ++intent.current };
      if (handler === undefined) {
        cursor.current = nextCursor;
        acceptedRoute.current = next;
        setRouteState(next);
        return;
      }
      handler(target);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [onPopstateRef, commitRoute]);

  const setRoute = useCallback((next: AppRouteState) => {
    intent.current += 1;
    // A push during native restoration would truncate the wrong forward
    // branch. Finish the physical traversal, then commit the latest intent.
    if (pendingPop.current !== undefined) { queuedRoute.current = next; return; }
    commitRoute(next);
  }, [commitRoute]);

  const nativeHistory = useMemo<NativeRouteHistory>(() => ({
    accept: (target) => { pendingPop.current = undefined; cursor.current = target.cursor; acceptedRoute.current = target.route; setRouteState(target.route); },
    restore: (target, afterRestore) => {
      const delta = cursor.current - target.cursor;
      if (delta === 0) { afterRestore(); return; }
      pendingPop.current = { cursor: cursor.current, kind: "restore", afterRestore };
      window.history.go(delta);
    },
    replay: (target) => {
      if (target.intent !== undefined && target.intent !== intent.current) return;
      const delta = target.cursor - cursor.current;
      if (delta === 0) { cursor.current = target.cursor; acceptedRoute.current = target.route; setRouteState(target.route); return; }
      pendingPop.current = { cursor: target.cursor, kind: "accept", route: target.route };
      window.history.go(delta);
    },
  }), []);
  return [route, setRoute, nativeHistory];
}
