/**
 * The separation DATE reconciliation — the fold that decides what a real
 * termination is filed on.
 *
 * ## What it computes, and where each rule comes from
 *
 * | Value | Rule | Legacy |
 * |---|---|---|
 * | Last Day Worked | the New Kronos last physical punch, falling back to the Kuali form's LDW when the card carried no punch | `legacy:src/workflows/separations/workflow.ts` @ `1bffbd65…` |
 * | Separation Date | `max(LDW, last sick day, last holiday day)` | `computeSeparationDate`, `legacy:src/workflows/separations/schema.ts:52-81` |
 * | Termination Effective Date | separation date **+ 1 day** | `computeTerminationEffDate`, `:42-48` |
 * | the Kronos window | `[earlier(ldw, sep) − 1 month, later(ldw, sep) + 1 month]` | `computeKronosDateRange`, `:249-266` |
 * | the UCPath comment | `Termination eff <eff>. Last Day Worked <ldw>.[ one leave clause] Kuali form #<doc>.` | `buildTerminationComments`, `:107-142` |
 * | the Kuali audit lines | `Updated <field> from <a> to <b> per Kronos timesheet. -<initials>` | `buildDateChangeComments` / `buildSeparationDateChangeComment`, `:275-298` |
 * | the future refusal | a Kuali LDW or separation date after today is "not yet eligible for separation" (**S7**) | `validateLastDayWorked`, `:342-358` |
 *
 * ## The zero-hour "Observed" holidays do NOT count — and that is a decision
 *
 * `Juneteenth Observed` and `Independence Day Observed` (both amount `0.00`)
 * do not match chunk 1's ported `/holiday/i` classifier, so they never reach
 * `holidayDates` and never move the separation date. The operator ratified that
 * on **2026-08-13** (`docs/migrations/separations.md` §9.1): keep legacy-identical,
 * change no regex, add no zero-amount rule. What this module owes in exchange is
 * VISIBILITY — every unclassified pay code the card carried travels on the
 * reconciliation, so the day the rule declined to count is a fact the operator
 * reads at the gate rather than one nobody can see. Surfaced, never counted,
 * never dropped.
 *
 * ## Two folds, because they fail for different reasons
 *
 * `planSeparation` runs BEFORE the timecard read: it is what the Kronos window
 * is computed from, so it must refuse a blank or future Kuali date before a
 * browser opens. `reconcileSeparationDates` runs AFTER, and its refusals are
 * about the card. Chunk 2's rule ("two nodes because an operator needs to see
 * WHICH failed") applied to the date half.
 *
 * ## "Today" is the document read's own instant, never a clock read
 *
 * S7 compares against today, and legacy reads the machine clock. Here the
 * reference is `document.observedAt` — the instant this run actually looked at
 * the form — projected into **America/Los_Angeles**, which is the calendar every
 * one of these systems renders its dates in. That makes the refusal a pure
 * function of facts the run holds (so a fixture pins it exactly) and makes the
 * sentence it prints true: *as of the moment this run read the document*. A UTC
 * comparison would call 5pm Pacific "tomorrow" and let a genuinely future date
 * through for seven hours a day.
 */
import { z } from "zod";
import { IsoInstantSchema } from "../ids.js";
import type { KualiDateField } from "../ui/kuali-separation-document.js";

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
  /** S7 — a date after the day this run read the document. */
  "separation-date-in-future",
] as const;
export const SeparationPlanRefusalCodeSchema = z.enum(SEPARATION_PLAN_REFUSAL_CODES);
export type SeparationPlanRefusalCode = z.infer<typeof SeparationPlanRefusalCodeSchema>;

export const RECONCILED_DATE_REFUSAL_CODES = [
  /**
   * The card opened, carried no punch, and the Kuali LDW is what the write
   * would then be filed on. §4b's hard-fail covers every way the READ can go
   * wrong; this is the one case where the read SUCCEEDED and still established
   * no worked day, and it is refused for the same reason: no path through this
   * workflow files a termination on a date nobody read (S34/S38 stay distinct
   * values in `timecard.hasPunches`, which is what a future composition selects
   * on).
   */
  "no-punch-in-window",
  /** A leave day the card reported falls outside the window it was read over. */
  "leave-date-outside-window",
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
  /** The Pacific calendar day the document was read on — S7's reference. */
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
  /**
   * The physical last day worked — what the UCPath override field is filed
   * with. Before D307 it was ALWAYS the New Kronos last punch and this schema
   * deliberately carried no `source` beside it (a closed enum with one arm
   * pretending to be a choice). D307 adds the one other reachable authority —
   * the operator who omitted the Kronos step and typed the pair — and `source`
   * below names which one, so the identity packet and its digest bind it.
   * What the form said still travels as `kualiLastDayWorked`, so the operator
   * compares the two rather than reading a label about them.
   */
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
  /**
   * Which leave day, if any, is the one that MOVED the separation date past the
   * last day worked. `null` when leave changed nothing — which is the ordinary
   * case and is stated rather than inferred from the dates.
   */
  separationDeterminingLeave: z.enum(["sick", "holiday"]).nullable(),
  /**
   * Pay codes the ported classifier declined to count, verbatim (§9.1's
   * 2026-08-13 answer). Surfaced so a day the rule did not count is visible at
   * the gate; nothing here consumes them.
   */
  unclassifiedPayCodes: z.array(z.string().min(1)),
  /** The UCPath transaction's Initiator Comments, composed from the above. */
  terminationComments: z.string().min(1),
  /**
   * The Kuali audit lines the reconciliation itself produces — empty when
   * neither date moved. The finalization's complete comments text is composed
   * later, because it also carries the transaction number.
   */
  dateChangeComments: z.string(),
  /** D307 — which authority established these dates (see `lastDayWorked`). */
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

/**
 * `MM/DD/YYYY` → UTC epoch milliseconds at midnight, or `null` when the string
 * is not a real calendar day.
 *
 * The round-trip check is the point and it is `parseKualiFormDate`'s, restated
 * for the wider set of producers this module folds together: `new Date(2026, 1, 31)`
 * is a valid `Date` that silently means 3 March, so a form or a grid holding
 * `02/31/2026` would otherwise become a plausible-but-wrong effective date.
 */
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

/**
 * Shift a date by whole months, clamping the day to the target month's length.
 *
 * Legacy uses `Date.setMonth()`, which OVERFLOWS: `Mar 31 − 1 month` targets
 * `Feb 31` and lands on `Mar 3`, so the window it computes is a few days
 * NARROWER than a month on 29th–31st inputs (`legacy:src/workflows/separations/CLAUDE.md:146`
 * records the quirk and calls it harmless "given the buffer"). Clamping instead
 * lands on `Feb 28`, which is WIDER — and wider is the safe direction for a
 * read window: the timecard read proves the window it applied and the fold
 * takes the LAST punch, so extra days at the start of the range cannot change
 * an answer, while missing days at the end could.
 */
export function shiftMonths(value: string, months: number): string {
  const at = new Date(requireEpoch(value, "date"));
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth() + months;
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(at.getUTCDate(), lastDayOfTarget);
  return formatSeparationDate(Date.UTC(year, month, day));
}

/**
 * The Pacific calendar day an instant falls on, as `MM/DD/YYYY`.
 *
 * `Intl` rather than an offset table: US Pacific observes DST, so a fixed −8
 * would be wrong for eight months of the year, and this comparison decides
 * whether a real separation is refused as "not yet eligible".
 */
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

/**
 * The New Kronos search window a pair of Kuali dates implies.
 *
 * Ported from `computeKronosDateRange` (`legacy:src/workflows/separations/schema.ts:249-266`
 * @ `1bffbd658db34ce84a08e69484db3a40b3658d6e`), with the month shift clamped
 * rather than overflowing — see `shiftMonths`. The ±1 month buffer is legacy's
 * own measured answer: narrower windows missed timecards.
 */
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

/**
 * Everything the rest of the graph needs from the separation document alone:
 * who it names, the two dates it carries, and the timecard window they imply.
 *
 * It runs before any UCPath or Kronos read, which is deliberate — S7's refusal
 * and a blank payload date both cost nothing here and cost a browser session
 * one node later.
 */
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

/**
 * The separation date, from the last day worked and the leave the card showed.
 *
 * Ported verbatim in behaviour from `computeSeparationDate`
 * (`legacy:src/workflows/separations/schema.ts:52-81` @ `1bffbd65…`): the last
 * day worked SEEDS the maximum, so a stray earlier leave date can never pull
 * the separation date backwards.
 */
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

/**
 * The UCPath Initiator Comments, and it reports exactly ONE leave clause.
 *
 * Ported from `buildTerminationComments` (`legacy:.../schema.ts:107-142` @
 * `1bffbd65…`). `<ldw>` is the PHYSICAL last day worked, never the separation
 * date: leave pushes out the separation date (and hence the effective date) and
 * never the day somebody last worked. When both sick and holiday exist only the
 * later is reported — it is the leave day that actually set the separation date
 * — and holiday wins only on a strictly later date, sick winning ties.
 */
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

/**
 * `"Synthetic Operator"` → `"SO"`. Ported from `getInitials`
 * (`legacy:.../schema.ts:227-232` @ `1bffbd65…`).
 */
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

/** Non-empty parts, trimmed, newline-joined. Ported from `joinComments`. */
export function joinSeparationComments(...parts: readonly string[]): string {
  return parts.map((part) => part.trim()).filter((part) => part.length > 0).join("\n");
}

/**
 * The Kuali Timekeeper/Approver audit lines the date reconciliation produces.
 *
 * Ported from `buildDateChangeComments` + `buildSeparationDateChangeComment`
 * (`legacy:.../schema.ts:275-298` @ `1bffbd65…`), including the wording — those
 * exact sentences are what appear on three real Kuali documents (4445, 4461,
 * 4471), which is how the S36 defect was found in the first place. A line is
 * emitted only for a date that actually moved; the empty string is the ordinary
 * case.
 */

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

/**
 * D307 — the reconciled dates when the operator OMITTED the Kronos timecard
 * step and typed the last day worked and separation date instead.
 *
 * Nothing here is read from a card, so nothing here pretends to have been:
 * every leave field is `null`, the pay-code list is empty, the termination
 * comment names no leave, and the date-change comment cites operator entry
 * rather than a timesheet. The one derived value — the effective date — keeps
 * the same rule the Kronos path applies (separation date + 1), so a typed pair
 * cannot file a termination effective on a day the operator did not intend.
 */
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
  // The same bound the Kuali read applies (`separation-date-in-future`): a
  // typed date after the plan's as-of day would file a termination for someone
  // still on pay status.
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

/**
 * The COMPLETE Kuali Timekeeper/Approver comments text the finalization stages.
 *
 * Three parts, newline-joined in this order: whatever the control already held
 * (legacy prepends the existing value so nothing a human wrote is clobbered —
 * `fillTimekeeperComments`), the date-change audit lines, and one line naming
 * the transaction this run filed.
 *
 * **That last line is an addition, and it is argued rather than inherited.**
 * Legacy leaves the control untouched when no date moved, but §4e makes the
 * comments one of the ten fields ONE save writes and
 * `KualiFinalizationCommentsSchema` requires a non-empty value — so a run that
 * changed no date still has to say something, and the honest thing to say is
 * what it filed. The sentence is modelled on legacy's own duplicate-termination
 * note (`buildDuplicateTerminationComment`, `:314-324`), which is the one place
 * legacy writes an audit line about a transaction rather than about a change.
 * §9.12 records the live consequence of the alternative: a document finalized
 * with an EMPTY comment can never be probed `present`.
 */
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

/**
 * Fold the timecard onto the plan: the reconciled dates, the effective date,
 * and the two comment texts derived from them.
 *
 * `lastPunchDate === null` REFUSES. §4b hard-fails every way the read can go
 * wrong; this is the one arm where the read succeeded and still established no
 * worked day, and filing the Kuali-carried LDW there is exactly the fallback the
 * operator's answer removed ("no path through this workflow files a termination
 * on a date nobody read"). The distinction survives in the timecard output
 * itself — `hasPunches` separates "card opened, no punches" (S38) from every
 * failure — which is what a future §3.1 recomposition would select on.
 */
export function reconcileSeparationDates(input: Readonly<{
  plan: SeparationPlan;
  timekeeperName: string;
  /** The card's last physical punch, or `null` when it carried none (S38). */
  lastPunchDate: string | null;
  sickDates: readonly string[];
  holidayDates: readonly string[];
  unclassifiedPayCodes: readonly string[];
  /** The window the grid was PROVED to be showing when it was read (S40). */
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

  /**
   * Which leave day moved the separation date, using legacy's own tie rule:
   * holiday wins only on a strictly later date, sick wins ties
   * (`legacy:.../schema.ts:128-139` @ `1bffbd65…`).
   */
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
