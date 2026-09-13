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
  const cursor = useRef(cursorOf(window.history.state) ?? 0);
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

  useEffect(() => {
    const onPop = (): void => {
      const next = parseRoute(window.location.search);
      const nextCursor = cursorOf(window.history.state);
      if (nextCursor === undefined) throw new Error("dashboard history entry has no route cursor");
      const pending = pendingPop.current;
      if (pending !== undefined && pending.cursor === nextCursor) {
        pendingPop.current = undefined;
        cursor.current = nextCursor;
        if (pending.kind === "restore") pending.afterRestore();
        else setRouteState(pending.route);
        return;
      }
      const handler = onPopstateRef.current;
      if (handler === undefined) {
        setRouteState(next);
        return;
      }
      handler({ route: next, cursor: nextCursor });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [onPopstateRef]);

  const setRoute = useCallback((next: AppRouteState) => {
    // Re-pressing the door already open (the gear, the active nav entry, the
    // Storage door) must not push a second, identical history entry — that
    // makes the browser's own Back button appear inert (unit F4b finding 2).
    if (routeAdvancesHistory(next, window.location.search)) {
      cursor.current += 1;
      window.history.pushState({ [ROUTE_CURSOR_KEY]: cursor.current }, "", `${window.location.pathname}${routeToSearch(next)}`);
    }
    setRouteState(next);
  }, []);

  const nativeHistory = useMemo<NativeRouteHistory>(() => ({
    accept: (target) => { cursor.current = target.cursor; setRouteState(target.route); },
    restore: (target, afterRestore) => {
      const delta = cursor.current - target.cursor;
      if (delta === 0) { afterRestore(); return; }
      pendingPop.current = { cursor: cursor.current, kind: "restore", afterRestore };
      window.history.go(delta);
    },
    replay: (target) => {
      const delta = target.cursor - cursor.current;
      if (delta === 0) { cursor.current = target.cursor; setRouteState(target.route); return; }
      pendingPop.current = { cursor: target.cursor, kind: "accept", route: target.route };
      window.history.go(delta);
    },
  }), []);
  return [route, setRoute, nativeHistory];
}
