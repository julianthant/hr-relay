/** Holds the dashboard's view state (the part of the address a surface reads) in the page, so a story can start a surface at a
 * drilldown, a detail page or a search without clicking its way there. */
import { useMemo, useState, type ReactNode } from "react";
import { ViewNavigationContext, type ViewRoute } from "../../../../../../src/dashboard/app/navigation/view-route-model.js";

export function ViewNavigationHost({ initial, children }: { initial?: ViewRoute; children: ReactNode }) {
  const [view, setView] = useState<ViewRoute>(initial ?? {});
  const [start, setStart] = useState(false);
  const navigation = useMemo(() => ({ view, start, setStart, update: (patch: Partial<ViewRoute>) => { setView(current => ({ ...current, ...patch })); } }), [view, start]);
  return <ViewNavigationContext.Provider value={navigation}>{children}</ViewNavigationContext.Provider>;
}
