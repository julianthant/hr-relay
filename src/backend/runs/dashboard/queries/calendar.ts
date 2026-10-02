import { CalendarQuerySchema, CalendarWireSchema, type CalendarQuery, type CalendarWire } from "../../../../domain/dashboard/calendar.js";
import type { Clock } from "../../../../domain/clock.js";
import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";

export interface CalendarQueryService { read(input: CalendarQuery): CalendarWire }
export function createCalendarQuery(database: Pick<AuthorityDatabase, "queryRunCalendar">, clock: Clock): CalendarQueryService {
  return { read(input) {
    const query = CalendarQuerySchema.parse(input);
    const today = clock.todayLocal();
    if (query.day > today) throw new Error("calendar-future-day");
    return CalendarWireSchema.parse(database.queryRunCalendar({ ...query, today }));
  } };
}
