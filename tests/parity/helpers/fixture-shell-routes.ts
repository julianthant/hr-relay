import { CalendarQuerySchema, CalendarWireSchema } from "../../../src/domain/dashboard/calendar.js";
import { serverLocalDay } from "../../../src/dashboard/surfaces/date-navigation-model.js";
import type { FixtureDashboardProfile } from "./fixture-profile.js";
import { Hono } from "hono";
export function registerFixtureShellRoutes({ app, profile }: { app: Hono; profile: FixtureDashboardProfile }): void {


  app.get("/api/v1/calendar", (c) => {
    const { month, day } = CalendarQuerySchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
    const today = serverLocalDay(profile.bootstrap.serverClock);
    const counts = profile.day.monthCounts.filter(entry => entry.count > 0 && entry.day <= today);
    const days = counts.map(entry => entry.day).sort();
    return c.json(CalendarWireSchema.parse({ month, day, today, authorityGeneration: 1,
      monthCounts: counts.filter(entry => entry.day.startsWith(month)), firstDay: days.at(0) ?? null,
      lastDay: days.at(-1) ?? null, previousDay: days.filter(value => value < day).at(-1) ?? null,
      nextDay: [...days, today].filter(value => value > day).sort().at(0) ?? null }));
  });
  app.get("/api/v1/bootstrap", (c) => c.json(profile.bootstrap as unknown));
}
