import { z } from "zod";
import { DayCountWireSchema } from "./projection.js";

export const CalendarMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u);
export const CalendarQuerySchema = z.strictObject({ month: CalendarMonthSchema, day: z.iso.date() });
export type CalendarQuery = z.infer<typeof CalendarQuerySchema>;

/** Bounded availability, separate from the selected day's snapshot counts. */
export const CalendarWireSchema = z.strictObject({
  month: CalendarMonthSchema,
  day: z.iso.date(),
  today: z.iso.date(),
  authorityGeneration: z.number().int().nonnegative(),
  monthCounts: z.array(DayCountWireSchema).max(31),
  firstDay: z.iso.date().nullable(),
  lastDay: z.iso.date().nullable(),
  previousDay: z.iso.date().nullable(),
  nextDay: z.iso.date().nullable(),
}).superRefine((wire, ctx) => {
  const days = wire.monthCounts.map(entry => entry.day);
  if (wire.day > wire.today || days.some((day, i) => !day.startsWith(wire.month) || day > wire.today
    || (i > 0 && day <= days[i - 1]))
    || wire.monthCounts.some(entry => entry.count <= 0)
    || (wire.previousDay !== null && wire.previousDay >= wire.day)
    || (wire.nextDay !== null && (wire.nextDay <= wire.day || wire.nextDay > wire.today))
    || (wire.firstDay === null) !== (wire.lastDay === null)
    || (wire.firstDay !== null && wire.lastDay !== null && (wire.firstDay > wire.lastDay || wire.lastDay > wire.today))) {
    ctx.addIssue({ code: "custom", message: "calendar-coherence-invalid" });
  }
});
export type CalendarWire = z.infer<typeof CalendarWireSchema>;
