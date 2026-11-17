import { CalendarQuerySchema, CalendarWireSchema, type CalendarQuery, type CalendarWire } from "../../../models/dashboard/calendar.js";
import type { Clock } from "../../../rules/time/clock.js";
import { searchPartitionDay } from "../../../models/dashboard/search-calendar.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";

export interface CalendarQueryService { read(input: CalendarQuery): CalendarWire }
export function createCalendarQuery(database: Pick<AuthorityDatabase, "queryRunCalendar">, clock: Clock): CalendarQueryService {
  return { read(input) {
    const query = CalendarQuerySchema.parse(input);
    const today = searchPartitionDay(clock.now());
    if (query.day > today) throw new Error("calendar-future-day");
    return CalendarWireSchema.parse(database.queryRunCalendar({ ...query, today }));
  } };
}
