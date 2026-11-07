import { useCallback, useMemo, type ReactNode } from "react";
import { ViewNavigationContext, ViewRouteSchema, type RouteSetter, type ViewRoute } from "./view-route-model.js";
import type { AppRouteState } from "./url-state.js";

export function ViewNavigationProvider({ route, setRoute, children }: { route: AppRouteState; setRoute: RouteSetter; children: ReactNode }) {
  const update = useCallback((patch: Partial<ViewRoute>, mode: "push" | "replace" = "push") => {
    setRoute(current => ({ ...current, view: ViewRouteSchema.parse({ ...current.view, ...patch }), viewInvalid: undefined }), mode);
  }, [setRoute]);
  const setStart = useCallback((open: boolean) => setRoute(current => ({ ...current, start: open })), [setRoute]);
  const value = useMemo(() => ({ view: route.view ?? {}, start: route.start, setStart, update }), [route.view, route.start, setStart, update]);
  return <ViewNavigationContext.Provider value={value}>{children}</ViewNavigationContext.Provider>;
}
