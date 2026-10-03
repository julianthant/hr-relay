import type { FrontendBootstrapWire } from "../../models/dashboard/bootstrap.js";
import { useServedNow } from "../state/served-clock.js";
import { useDashboardDay } from "../state/use-dashboard-day.js";
import { useRunDetail } from "../state/use-run-detail.js";
import { serverLocalDay } from "../surfaces/date-navigation-model.js";
import { resolveDateSelection } from "./date-state-model.js";
import type { AppRouteState } from "./url-state.js";

/** One served clock, one day subscription and the exact selected run read. */
export function useConsumerAuthority(boot: Pick<FrontendBootstrapWire, "actor" | "serverClock">, route: AppRouteState, detailNonce: number) {
  const nowIso = useServedNow(boot.serverClock.now);
  const today = serverLocalDay({ ...boot.serverClock, now: nowIso });
  const dateSelection = resolveDateSelection(route.day, today);
  const day = dateSelection.state === "valid" ? dateSelection.day : dateSelection.requested;
  const dateError = dateSelection.state === "valid" ? undefined : dateSelection.reason === "future"
    ? `Date ${day} is after Today (${today}).` : `Invalid date: ${day || "(empty)"}.`;
  const { day: dayResource, connection, refresh: refreshDay } = useDashboardDay(dateSelection.state === "valid" ? day : undefined, nowIso);
  const dayWire = dayResource.state === "loaded" && dayResource.value.day === day ? dayResource.value : undefined;
  const servedRowRevision = dayWire?.queueSurfaces.find((row) => String(row.runId) === route.run)?.rowRevision;
  const detail = useRunDetail(dateSelection.state === "valid" ? route.run : undefined, detailNonce,
    servedRowRevision, dateSelection.state === "valid" ? day : undefined);
  return { actorId: boot.actor.id, nowIso, today, day, dateError, dayResource, connection, dayWire, detail, refreshDay };
}
