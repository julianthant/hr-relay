/** The separation DATE reconciliation — the fold that decides what a real termination is filed on, from the timecard's last punch, the Kuali form's dates, and the leave the card showed. */
import { z } from "zod";
import { IsoInstantSchema } from "../identity/ids.js";
import type { KualiDateField } from "../../models/ui/kuali-separation-document.js";

/** `MM/DD/YYYY`, the spelling Kuali, UCPath Smart HR and WFD all render. */
export const SeparationDateSchema = z.string().regex(
  /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/u,
  "a separation date must be MM/DD/YYYY",
);

export const SEPARATION_PLAN_REFUSAL_CODES = [
  /** The form carries no employee name; nothing downstream can search on one. */
  "employee-name-absent",
  /** The form's Last Day Worked is blank. It is half the write's payload. */
  "last-day-worked-absent",
  /** The form's Separation Date is blank. */
  "separation-date-absent",
  /** A future date is later than the document read's day. */
  "separation-date-in-future",
] as const;
export const SeparationPlanRefusalCodeSchema = z.enum(SEPARATION_PLAN_REFUSAL_CODES);
export type SeparationPlanRefusalCode = z.infer<typeof SeparationPlanRefusalCodeSchema>;

export const RECONCILED_DATE_REFUSAL_CODES = [
    /* The read succeeded and still established no worked day, so it is refused for the same reason the failed read is: no path through this workflow files a termination on a date nobody read. */
  "no-punch-in-window",
  /** A leave day the card reported falls outside the window it was read over. */
  "leave-date-outside-window",
  "separation-date-in-future",
] as const;
export const ReconciledDateRefusalCodeSchema = z.enum(RECONCILED_DATE_REFUSAL_CODES);
export type ReconciledDateRefusalCode = z.infer<typeof ReconciledDateRefusalCodeSchema>;

/** The window the New Kronos timecard is read over, both bounds inclusive. */
export const TimecardWindowSchema = z.strictObject({
  start: SeparationDateSchema,
  end: SeparationDateSchema,
});
export type TimecardWindow = z.infer<typeof TimecardWindowSchema>;

export const SeparationPlanSchema = z.strictObject({
  documentNumber: z.string().min(1),
  /** `Last, First` exactly as the separation form renders it. */
  employeeName: z.string().min(1),
  /** The form's own Last Day Worked, before Kronos has said anything. */
  kualiLastDayWorked: SeparationDateSchema,
  /** The form's own Separation Date, likewise. */
  kualiSeparationDate: SeparationDateSchema,
  /** Compare against the Pacific calendar day of the document read. */
  asOfDate: SeparationDateSchema,
  timecardWindow: TimecardWindowSchema,
});
export type SeparationPlan = z.infer<typeof SeparationPlanSchema>;

export const SeparationPlanResolutionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("planned"), plan: SeparationPlanSchema }),
  z.strictObject({
    state: z.literal("refused"),
    code: SeparationPlanRefusalCodeSchema,
    reason: z.string().min(1),
  }),
]);
export type SeparationPlanResolution = z.infer<typeof SeparationPlanResolutionSchema>;

/** Where a reconciled date came from — the wording a Kuali comment names as its authority. */
export const SeparationDateSourceSchema = z.enum(["kronos-timesheet", "operator"]);
export type SeparationDateSource = z.infer<typeof SeparationDateSourceSchema>;

export const ReconciledSeparationDatesSchema = z.strictObject({
    /* The physical last day worked — what the UCPath override field is filed with; `source` names which authority established it, so the identity packet and its digest bind it. */
  lastDayWorked: SeparationDateSchema,
  /** `max(lastDayWorked, last sick, last holiday)`. */
  separationDate: SeparationDateSchema,
  /** Separation date + 1 day — the UCPath and Kuali effective date. */
  terminationEffectiveDate: SeparationDateSchema,
  /** What the form said, carried so the operator compares rather than recalls. */
  kualiLastDayWorked: SeparationDateSchema,
  kualiSeparationDate: SeparationDateSchema,
  lastDayWorkedChanged: z.boolean(),
  separationDateChanged: z.boolean(),
  /** The latest sick day the card reported, or `null`. */
  latestSickDate: SeparationDateSchema.nullable(),
  /** The first and last holiday days, or `null` — the comment reports a range. */
  firstHolidayDate: SeparationDateSchema.nullable(),
  latestHolidayDate: SeparationDateSchema.nullable(),
    /* Which leave day, if any, MOVED the separation date past the last day worked; `null` when leave changed nothing, which is the ordinary case and is stated rather than inferred. */
  separationDeterminingLeave: z.enum(["sick", "holiday"]).nullable(),
    /* Surface uncounted pay codes verbatim for operator review. */
  unclassifiedPayCodes: z.array(z.string().min(1)),
  /** The UCPath transaction's Initiator Comments, composed from the above. */
  terminationComments: z.string().min(1),
    /* The audit lines the reconciliation itself produces — empty when neither date moved; the finalization's complete comments text is composed later, because it also carries the transaction number. */
  dateChangeComments: z.string(),
  /** Which authority established these dates (see `lastDayWorked`). */
  source: SeparationDateSourceSchema,
});
export type ReconciledSeparationDates = z.infer<typeof ReconciledSeparationDatesSchema>;

export const ReconciledDatesResolutionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("reconciled"), dates: ReconciledSeparationDatesSchema }),
  z.strictObject({
    state: z.literal("refused"),
    code: ReconciledDateRefusalCodeSchema,
    reason: z.string().min(1),
  }),
]);
export type ReconciledDatesResolution = z.infer<typeof ReconciledDatesResolutionSchema>;

/* ── Calendar primitives ──────────────────────────────────────────────────── */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Reject calendar rollover instead of normalizing an invalid date. */
export function parseSeparationDate(value: string): number | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(value);
  if (match === null) return null;
  const [, month = "", day = "", year = ""] = match;
  const at = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const round = new Date(at);
  if (round.getUTCFullYear() !== Number(year)) return null;
  if (round.getUTCMonth() + 1 !== Number(month)) return null;
  if (round.getUTCDate() !== Number(day)) return null;
  return at;
}

function requireEpoch(value: string, label: string): number {
  const at = parseSeparationDate(value);
  if (at === null) {
    throw new Error(
      `${label} ${JSON.stringify(value)} is not a real MM/DD/YYYY calendar day; every producer feeding `
      + "this fold parses its own dates, so an unparseable one here means a caller fabricated it",
    );
  }
  return at;
}

/** UTC epoch milliseconds → `MM/DD/YYYY`. */
export function formatSeparationDate(at: number): string {
  const value = new Date(at);
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return SeparationDateSchema.parse(`${month}/${day}/${String(value.getUTCFullYear())}`);
}

/** `left` is strictly later than `right`. Both must be real calendar days. */
export function isLaterSeparationDate(left: string, right: string): boolean {
  return requireEpoch(left, "date") > requireEpoch(right, "date");
}

/** The later of two dates; ties return `left`. */
function laterOf(left: string, right: string): string {
  return isLaterSeparationDate(right, left) ? right : left;
}

export function addSeparationDays(value: string, days: number): string {
  return formatSeparationDate(requireEpoch(value, "date") + days * DAY_MS);
}

/** Shift a date by whole months, clamping the day to the target month's length; clamping lands WIDER, and wider is the safe direction for a read window. */
export function shiftMonths(value: string, months: number): string {
  const at = new Date(requireEpoch(value, "date"));
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth() + months;
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(at.getUTCDate(), lastDayOfTarget);
  return formatSeparationDate(Date.UTC(year, month, day));
}

/** The Pacific calendar day an instant falls on, as `MM/DD/YYYY`; `Intl` rather than an offset table, because US Pacific observes DST and this comparison decides a real separation. */
export function pacificCalendarDay(instant: string): string {
  const at = new Date(IsoInstantSchema.parse(instant));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? "";
  return SeparationDateSchema.parse(`${part("month")}/${part("day")}/${part("year")}`);
}

/** The New Kronos search window a pair of Kuali dates implies, with the month shift clamped rather than overflowing; the buffer is the measured answer, since narrower windows missed timecards. */
export function computeTimecardWindow(
  lastDayWorked: string,
  separationDate: string,
): TimecardWindow {
  const earlier = isLaterSeparationDate(lastDayWorked, separationDate)
    ? separationDate
    : lastDayWorked;
  const later = laterOf(lastDayWorked, separationDate);
  return TimecardWindowSchema.parse({
    start: shiftMonths(earlier, -1),
    end: shiftMonths(later, 1),
  });
}

/* ── The pre-timecard fold ────────────────────────────────────────────────── */

function dateFieldValue(field: KualiDateField): string | null {
  return field.state === "present" ? field.raw : null;
}

/** Refuse invalid document facts before paying for external browser reads. */
export function planSeparation(input: Readonly<{
  documentNumber: string;
  employeeName: { state: "present"; value: string } | { state: "absent"; reason: string };
  lastDayWorked: KualiDateField;
  separationDate: KualiDateField;
  /** The instant the document read observed the page. */
  observedAt: string;
}>): SeparationPlanResolution {
  if (input.employeeName.state === "absent") {
    return SeparationPlanResolutionSchema.parse({
      state: "refused",
      code: "employee-name-absent",
      reason: `Kuali document ${input.documentNumber} carries no employee name `
        + `(${input.employeeName.reason}). The name is what the UCPath candidate search runs on and `
        + "what the identity gate compares, so there is nothing to check an EID against.",
    });
  }
  const lastDayWorked = dateFieldValue(input.lastDayWorked);
  if (lastDayWorked === null) {
    return SeparationPlanResolutionSchema.parse({
      state: "refused",
      code: "last-day-worked-absent",
      reason: `Kuali document ${input.documentNumber} carries no Last Day Worked `
        + `(${input.lastDayWorked.state === "absent" ? input.lastDayWorked.reason : "unreadable"}). `
        + "It is the payload of the UCPath Override Last Date Worked field and the seed of the "
        + "separation date; there is no default arm for it.",
    });
  }
  const separationDate = dateFieldValue(input.separationDate);
  if (separationDate === null) {
    return SeparationPlanResolutionSchema.parse({
      state: "refused",
      code: "separation-date-absent",
      reason: `Kuali document ${input.documentNumber} carries no Separation Date `
        + `(${input.separationDate.state === "absent" ? input.separationDate.reason : "unreadable"}). `
        + "The termination effective date is that date plus one day; nothing here invents it.",
    });
  }
  const asOfDate = pacificCalendarDay(input.observedAt);
  for (const [label, value] of [
    ["Last Day Worked", lastDayWorked],
    ["Separation Date", separationDate],
  ] as const) {
    if (isLaterSeparationDate(value, asOfDate)) {
      return SeparationPlanResolutionSchema.parse({
        state: "refused",
        code: "separation-date-in-future",
        reason: `Kuali document ${input.documentNumber} carries a ${label} of ${value}, which is after `
          + `${asOfDate} — the Pacific calendar day this run read the document. The employee is not yet `
          + "eligible for separation (S7).",
      });
    }
  }
  return SeparationPlanResolutionSchema.parse({
    state: "planned",
    plan: {
      documentNumber: input.documentNumber,
      employeeName: input.employeeName.value,
      kualiLastDayWorked: lastDayWorked,
      kualiSeparationDate: separationDate,
      asOfDate,
      timecardWindow: computeTimecardWindow(lastDayWorked, separationDate),
    },
  });
}

/* ── The post-timecard fold ───────────────────────────────────────────────── */

/** The separation date, from the last day worked and the leave the card showed; the last day worked SEEDS the maximum, so a stray earlier leave date can never pull the date backwards. */
export function computeSeparationDate(
  lastDayWorked: string,
  sickDates: readonly string[],
  holidayDates: readonly string[],
): string {
  let latest = lastDayWorked;
  for (const candidate of [...sickDates, ...holidayDates]) {
    if (isLaterSeparationDate(candidate, latest)) latest = candidate;
  }
  return latest;
}

/** Report one leave clause: the later date wins; holiday wins only when strictly later. */
export function buildTerminationComments(input: Readonly<{
  terminationEffectiveDate: string;
  lastDayWorked: string;
  documentNumber: string;
  latestSickDate: string | null;
  firstHolidayDate: string | null;
  latestHolidayDate: string | null;
}>): string {
  const sickClause = input.latestSickDate === null
    ? ""
    : ` Sick Leave on ${input.latestSickDate}.`;
  const holidayClause = input.firstHolidayDate === null || input.latestHolidayDate === null
    ? ""
    : input.firstHolidayDate === input.latestHolidayDate
      ? ` Holiday Pay on ${input.firstHolidayDate}.`
      : ` Holiday Pay from ${input.firstHolidayDate} to ${input.latestHolidayDate}.`;
  const leaveClause = input.latestSickDate !== null && input.latestHolidayDate !== null
    ? (isLaterSeparationDate(input.latestHolidayDate, input.latestSickDate) ? holidayClause : sickClause)
    : (sickClause.length > 0 ? sickClause : holidayClause);
  return `Termination eff ${input.terminationEffectiveDate}. `
    + `Last Day Worked ${input.lastDayWorked}.${leaveClause} `
    + `Kuali form #${input.documentNumber}.`;
}

/** `"Synthetic Operator"` → `"SO"`: initials of the two words, dropped from the display fold. */
export function separationInitials(fullName: string): string {
  const initials = fullName
    .split(/\s+/u)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  if (initials.length === 0) {
    throw new Error("cannot derive initials from protected input timekeeperName");
  }
  return initials;
}

/** Non-empty parts, trimmed, newline-joined. */
export function joinSeparationComments(...parts: readonly string[]): string {
  return parts.map((part) => part.trim()).filter((part) => part.length > 0).join("\n");
}

/** The audit lines the date reconciliation produces, including the exact wording those sentences carry on real Kuali documents; a line is emitted only for a date that actually moved. */

const DATE_SOURCE_WORDING: Readonly<Record<SeparationDateSource, string>> = {
  "kronos-timesheet": "per Kronos timesheet",
  operator: "per operator entry at run start",
};

export function buildDateChangeComments(input: Readonly<{
  kualiLastDayWorked: string;
  lastDayWorked: string;
  kualiSeparationDate: string;
  separationDate: string;
  initials: string;
  /** Which authority established the dates; every caller says so explicitly. */
  source: SeparationDateSource;
}>): string {
  const wording = DATE_SOURCE_WORDING[input.source];
  return joinSeparationComments(
    input.kualiLastDayWorked === input.lastDayWorked
      ? ""
      : `Updated Last Day Worked from ${input.kualiLastDayWorked} to ${input.lastDayWorked} `
        + `${wording}. -${input.initials}`,
    input.kualiSeparationDate === input.separationDate
      ? ""
      : `Updated Separation Date from ${input.kualiSeparationDate} to ${input.separationDate} `
        + `${wording}. -${input.initials}`,
  );
}

/** Typed replacements have no observed leave facts or pay codes. */
export function assertSeparationDates(input: Readonly<{
  plan: SeparationPlan;
  timekeeperName: string;
  lastDayWorked: string;
  separationDate: string;
}>): ReconciledSeparationDates {
  const lastDayWorked = SeparationDateSchema.parse(input.lastDayWorked);
  const separationDate = SeparationDateSchema.parse(input.separationDate);
  if (isLaterSeparationDate(lastDayWorked, separationDate)) {
    throw new Error(
      `asserted separation date ${separationDate} precedes the asserted last day worked ${lastDayWorked}; `
      + "a separation cannot take effect before the last day worked",
    );
  }
  // Dates after the plan's as-of day cannot authorize termination.
  if (isLaterSeparationDate(separationDate, input.plan.asOfDate)) {
    throw new Error(
      `asserted separation date ${separationDate} is after ${input.plan.asOfDate}, the day this run planned the separation; `
      + "the employee is not yet separated, so there is no termination to file",
    );
  }
  const terminationEffectiveDate = addSeparationDays(separationDate, 1);
  const initials = separationInitials(input.timekeeperName);
  return ReconciledSeparationDatesSchema.parse({
    lastDayWorked,
    separationDate,
    terminationEffectiveDate,
    kualiLastDayWorked: input.plan.kualiLastDayWorked,
    kualiSeparationDate: input.plan.kualiSeparationDate,
    lastDayWorkedChanged: input.plan.kualiLastDayWorked !== lastDayWorked,
    separationDateChanged: input.plan.kualiSeparationDate !== separationDate,
    latestSickDate: null,
    firstHolidayDate: null,
    latestHolidayDate: null,
    separationDeterminingLeave: null,
    unclassifiedPayCodes: [],
    terminationComments: buildTerminationComments({
      terminationEffectiveDate,
      lastDayWorked,
      documentNumber: input.plan.documentNumber,
      latestSickDate: null,
      firstHolidayDate: null,
      latestHolidayDate: null,
    }),
    dateChangeComments: buildDateChangeComments({
      kualiLastDayWorked: input.plan.kualiLastDayWorked,
      lastDayWorked,
      kualiSeparationDate: input.plan.kualiSeparationDate,
      separationDate,
      initials,
      source: "operator",
    }),
    source: "operator",
  });
}

/** Preserve existing comments, then append date-change audit and this transaction number. */
export function buildFinalizationComments(input: Readonly<{
  existingComments: string;
  dateChangeComments: string;
  documentNumber: string;
  transactionNumber: string;
  initials: string;
  asOfDate: string;
}>): string {
  return joinSeparationComments(
    input.existingComments,
    input.dateChangeComments,
    `Termination filed on UCPath as ${input.transactionNumber}. `
      + `Re Kuali Form #${input.documentNumber}. -${input.initials} ${input.asOfDate}`,
  );
}

/** No physical punch refuses; never substitute the Kuali date. */
export function reconcileSeparationDates(input: Readonly<{
  plan: SeparationPlan;
  timekeeperName: string;
  /** Null means the card had no physical punch. */
  lastPunchDate: string | null;
  sickDates: readonly string[];
  holidayDates: readonly string[];
  unclassifiedPayCodes: readonly string[];
  /** Retain the window the grid was proved to display. */
  observedWindow: TimecardWindow;
}>): ReconciledDatesResolution {
  if (input.lastPunchDate === null) {
    return ReconciledDatesResolutionSchema.parse({
      state: "refused",
      code: "no-punch-in-window",
      reason: `Kuali document ${input.plan.documentNumber}: the New Kronos timecard was read over `
        + `${input.observedWindow.start} – ${input.observedWindow.end} and carried no punch, so this run `
        + `established no last day worked. Legacy would file the Kuali-carried ${input.plan.kualiLastDayWorked} `
        + "and write a \"per Kronos timesheet\" comment citing a card that showed nothing (S34/S36); §4b's "
        + "answer is that no path through this workflow files a termination on a date nobody read.",
    });
  }
  for (const [label, dates] of [
    ["sick", input.sickDates],
    ["holiday", input.holidayDates],
  ] as const) {
    for (const date of dates) {
      if (isLaterSeparationDate(date, input.observedWindow.end)
        || isLaterSeparationDate(input.observedWindow.start, date)) {
        return ReconciledDatesResolutionSchema.parse({
          state: "refused",
          code: "leave-date-outside-window",
          reason: `the New Kronos timecard reported a ${label} day of ${date}, which is outside the `
            + `${input.observedWindow.start} – ${input.observedWindow.end} window it was proved to be `
            + "showing. A leave day the grid could not have rendered is a year-stamp defect (S41), and it "
            + "would move a real termination's effective date.",
        });
      }
    }
  }

  const lastDayWorked = input.lastPunchDate;
  const sorted = (dates: readonly string[]): readonly string[] =>
    [...dates].sort((left, right) => requireEpoch(left, "leave date") - requireEpoch(right, "leave date"));
  const sickDates = sorted(input.sickDates);
  const holidayDates = sorted(input.holidayDates);
  const latestSickDate = sickDates.at(-1) ?? null;
  const firstHolidayDate = holidayDates.at(0) ?? null;
  const latestHolidayDate = holidayDates.at(-1) ?? null;

  const separationDate = computeSeparationDate(lastDayWorked, sickDates, holidayDates);
  if (isLaterSeparationDate(separationDate, input.plan.asOfDate)) {
    return ReconciledDatesResolutionSchema.parse({
      state: "refused",
      code: "separation-date-in-future",
      reason: `reconciled separation date ${separationDate} is after ${input.plan.asOfDate}, the day this run planned the separation; `
        + "the employee is not yet separated, so there is no termination to file",
    });
  }
  const terminationEffectiveDate = addSeparationDays(separationDate, 1);
  const initials = separationInitials(input.timekeeperName);
  const dateChangeComments = buildDateChangeComments({
    kualiLastDayWorked: input.plan.kualiLastDayWorked,
    lastDayWorked,
    kualiSeparationDate: input.plan.kualiSeparationDate,
    separationDate,
    initials,
    source: "kronos-timesheet",
  });

    /* Which leave day moved the separation date, using the tie rule: holiday wins only on a strictly later date, sick wins ties. */
  const separationDeterminingLeave = separationDate === lastDayWorked
    ? null
    : latestSickDate !== null && separationDate === latestSickDate
      ? "sick"
      : "holiday";

  return ReconciledDatesResolutionSchema.parse({
    state: "reconciled",
    dates: {
      lastDayWorked,
      separationDate,
      terminationEffectiveDate,
      kualiLastDayWorked: input.plan.kualiLastDayWorked,
      kualiSeparationDate: input.plan.kualiSeparationDate,
      lastDayWorkedChanged: input.plan.kualiLastDayWorked !== lastDayWorked,
      separationDateChanged: input.plan.kualiSeparationDate !== separationDate,
      latestSickDate,
      firstHolidayDate,
      latestHolidayDate,
      separationDeterminingLeave,
      unclassifiedPayCodes: [...input.unclassifiedPayCodes],
      terminationComments: buildTerminationComments({
        terminationEffectiveDate,
        lastDayWorked,
        documentNumber: input.plan.documentNumber,
        latestSickDate,
        firstHolidayDate,
        latestHolidayDate,
      }),
      dateChangeComments,
      source: "kronos-timesheet",
    },
  });
}
