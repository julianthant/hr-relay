import { Hono } from "hono";
import { serverLocalDay } from "../../../../../src/dashboard/surfaces/shell/date-navigation-model.js";
import { CalendarQuerySchema, CalendarWireSchema } from "../../../../../src/models/dashboard/calendar.js";
import type { FixtureDashboardProfile } from "../../../fixtures/dashboard/fixture-profile.js";
import { isTerminalQueueStatus, type DashboardDayWire } from "../../../../../src/models/dashboard/projection.js";

export function createFixtureShellRoutesSetup() {
  function registerFixtureShellRoutes({ app, profile, dayWire = profile.day }: { app: Hono; profile: FixtureDashboardProfile; dayWire?: DashboardDayWire }): void {


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
    app.get("/api/v1/application-lifecycle", c => c.json({ runtimeGeneration: 1, state: "ready", pause: "running", update: "installer-unavailable",
      targets: dayWire.queueSurfaces.filter(row => !isTerminalQueueStatus(row.status)).map(row => ({
        runId: row.runId, expectedVersion: row.rowRevision, ...(row.pause === undefined ? {} : { pause: row.pause }),
        pauseUnavailable: row.status === "blocked" || row.status === "cancelling",
      })) }));
  }

  return { registerFixtureShellRoutes };
}
