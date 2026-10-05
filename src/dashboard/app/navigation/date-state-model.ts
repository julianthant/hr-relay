import { z } from "zod";
import { routeWithoutTakeovers, type AppRouteState } from "./url-state.js";

export type DateSelection =
  | { readonly state: "valid"; readonly day: string; readonly followToday: boolean }
  | { readonly state: "invalid"; readonly requested: string; readonly reason: "invalid" | "future" };

export function resolveDateSelection(requested: string | undefined, today: string): DateSelection {
  if (requested === undefined) return { state: "valid", day: today, followToday: true };
  if (!z.iso.date().safeParse(requested).success) return { state: "invalid", requested, reason: "invalid" };
  if (requested > today) return { state: "invalid", requested, reason: "future" };
  return { state: "valid", day: requested, followToday: false };
}

export function routeForDay(route: AppRouteState, day: string | undefined): AppRouteState {
  if (route.day === day) return route;
  return { ...route, day, run: undefined, section: undefined };
}

export function routeForStartedRun(route: AppRouteState): AppRouteState {
  return { ...routeWithoutTakeovers(routeForDay(route, undefined)), run: undefined, section: undefined };
}
