/**
 * The pure per-cell coercion core — doc 06 §2.4.
 *
 * Every helper here turns ONE raw spreadsheet/PDF cell string into a
 * canonical value or **throws**. There is deliberately no "best effort" arm:
 * doc 06 §7 vector #2 is precisely "coercion swallows a bad cell", and the
 * charter's fail-loud rule makes a substituted default the worst outcome this
 * program can produce. A malformed EID that becomes `""` is a wrong person; a
 * date this module guesses the century for is a wrong effective date on a live
 * HR transaction.
 *
 * ## Why a throw here is not a swallowed failure downstream
 *
 * `CellCoercionError` is a TYPED, located failure. Doc 06 §5's intake pipeline
 * catches exactly this class and records a durable `cell-coercion` row
 * rejection carrying the row, column, field and reason; every other throw
 * propagates untouched. That is a conversion into visible durable evidence,
 * not a `catch {}` — the operator must still fix or explicitly exclude the row
 * before anything fans out.
 *
 * ## Ported knowledge (D93 — copy with provenance, never link)
 *
 * The legacy repository is a frozen production reference. These behaviours are
 * copied from it at commit `4deabc5a`:
 *
 * - EID digit normalization — `src/domain/identity/eid.ts` (`normalizeEid`).
 * - Person-name title casing, hyphen/apostrophe handling, and the trailing
 *   middle-initial period drop — `src/domain/identity/person-name.ts`
 *   (`titleCasePersonToken`, `displayPersonName`).
 * - `MM/DD/YYYY` as the Kuali / UCPath / PeopleSoft wire date format —
 *   `src/domain/dates.ts` (`formatMmDdYyyy`) and the parsers in
 *   `src/workflows/separations/schema.ts`.
 *
 * The US state table below is NOT ported: legacy accepted whatever OCR emitted
 * (`z.string()`) and never normalized. It is a closed USPS reference table,
 * verifiable by inspection, and an unknown name refuses rather than passing
 * through.
 */
import type { IntakeTargetFieldId, WorkflowId } from "../ids.js";

/** Where a cell sits, so a failure names the thing the operator must fix. */
export interface CellLocation {
  readonly workflow: WorkflowId;
  /** 1-based row number in the SOURCE file, not an index into the valid set. */
  readonly sourceRow: number;
  /** The source column's header text exactly as the file spells it. */
  readonly header: string;
  /** The intake projection path this cell was bound to. */
  readonly targetFieldId: IntakeTargetFieldId;
}

/**
 * A cell that cannot become a schema-valid canonical value.
 *
 * The message reproduces doc 06 §2.4's shape verbatim, because the operator
 * reads it in the intake grid and has to know which cell to correct:
 *
 * ```
 * work-study intake, row 12, column "Employee ID#" (→ eid):
 *   value "10-4567" is not a UCPath EID (must be 10xxxxxx, 8 digits).
 * ```
 */
export class CellCoercionError extends Error {
  readonly location: CellLocation;
  readonly canonicalFieldId: string;
  readonly raw: string;
  readonly reason: string;

  constructor(args: {
    location: CellLocation;
    canonicalFieldId: string;
    raw: string;
    reason: string;
  }) {
    super(
      `${args.location.workflow} intake, row ${String(args.location.sourceRow)}, ` +
        `column "${args.location.header}" (→ ${args.canonicalFieldId}):\n` +
        `  value ${JSON.stringify(args.raw)} ${args.reason}.`,
    );
    this.name = "CellCoercionError";
    this.location = args.location;
    this.canonicalFieldId = args.canonicalFieldId;
    this.raw = args.raw;
    this.reason = args.reason;
  }
}

export function isCellCoercionError(error: unknown): error is CellCoercionError {
  return error instanceof CellCoercionError;
}

/** Collapse runs of whitespace and trim. Applied before every other rule. */
export function collapseWhitespace(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Ported verbatim from legacy `identity/eid.ts` — strip every non-digit. */
export function normalizeEidDigits(raw: string): string {
  return raw.replace(/\D+/g, "");
}

/** Ported verbatim from legacy `identity/person-name.ts`. */
export function titleCasePersonToken(token: string): string {
  return token
    .split(/([-' ])/)
    .map((part) => {
      if (part === "-" || part === "'" || part === " ") return part;
      if (part.length === 0) return part;
      return part[0].toUpperCase() + part.slice(1).toLowerCase();
    })
    .join("");
}

function titleCaseTokens(value: string): string {
  return value.split(/\s+/).filter(Boolean).map(titleCasePersonToken).join(" ");
}

/**
 * Ported from legacy `identity/person-name.ts` (`displayPersonName`): title
 * case, preserve an existing `Last, First` comma form, and drop a single
 * trailing period left over from a middle initial.
 */
export function displayPersonName(raw: string): string {
  const trimmed = collapseWhitespace(raw);
  if (trimmed.length === 0) return "";
  const commaIndex = trimmed.indexOf(",");
  const cased = commaIndex === -1
    ? titleCaseTokens(trimmed)
    : (() => {
      const last = trimmed.slice(0, commaIndex).trim();
      const rest = trimmed.slice(commaIndex + 1).trim();
      if (last.length === 0 || rest.length === 0) return trimmed;
      return `${titleCaseTokens(last)}, ${titleCaseTokens(rest)}`;
    })();
  return cased.replace(/\.\s*$/, "").trim();
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const TWO_DIGIT_YEAR_DATE = /^\d{1,2}\/\d{1,2}\/\d{2}$/;

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const daysInMonth = [
    31,
    (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
  ];
  return day <= (daysInMonth[month - 1] ?? 0);
}

/**
 * `MM/DD/YYYY` (the legacy wire format, and what every operator spreadsheet
 * carries) or an already-ISO `YYYY-MM-DD` → ISO `YYYY-MM-DD`.
 *
 * Returns `null` rather than throwing so the caller can name the field in its
 * own error. Two refusals are deliberate:
 *
 * - **A two-digit year.** `1/2/26` could be 1926 or 2026; a century this code
 *   picked would be an invented value on a live transaction.
 * - **A date that is not a real calendar day.** `02/30/2026` parses as digits
 *   and would otherwise roll forward into March, which is the silent
 *   wrong-value class this program bans.
 *
 * A bare number (an unconverted Excel serial such as `45678`) matches neither
 * pattern and is refused: the extraction parser converts genuinely date-typed
 * cells before mapping ever sees them, so a serial arriving here means the
 * column is not what the operator thinks it is.
 */
export function parseUsOrIsoDate(raw: string): string | null {
  const trimmed = collapseWhitespace(raw);
  const iso = ISO_DATE.exec(trimmed);
  if (iso) {
    const [, year, month, day] = iso;
    return isRealCalendarDate(Number(year), Number(month), Number(day)) ? trimmed : null;
  }
  if (TWO_DIGIT_YEAR_DATE.test(trimmed)) return null;
  const us = US_DATE.exec(trimmed);
  if (!us) return null;
  const [, month, day, year] = us;
  if (!isRealCalendarDate(Number(year), Number(month), Number(day))) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/**
 * USPS two-letter codes for the 50 states, DC, and the five inhabited
 * territories. A closed reference table, not a heuristic: an entry that is not
 * here refuses, and no prefix/fuzzy matching is attempted.
 */
const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC", "AS", "GU", "MP", "PR", "VI",
]);

const US_STATE_NAMES = new Map<string, string>([
  ["alabama", "AL"], ["alaska", "AK"], ["arizona", "AZ"], ["arkansas", "AR"],
  ["california", "CA"], ["colorado", "CO"], ["connecticut", "CT"], ["delaware", "DE"],
  ["florida", "FL"], ["georgia", "GA"], ["hawaii", "HI"], ["idaho", "ID"],
  ["illinois", "IL"], ["indiana", "IN"], ["iowa", "IA"], ["kansas", "KS"],
  ["kentucky", "KY"], ["louisiana", "LA"], ["maine", "ME"], ["maryland", "MD"],
  ["massachusetts", "MA"], ["michigan", "MI"], ["minnesota", "MN"], ["mississippi", "MS"],
  ["missouri", "MO"], ["montana", "MT"], ["nebraska", "NE"], ["nevada", "NV"],
  ["new hampshire", "NH"], ["new jersey", "NJ"], ["new mexico", "NM"], ["new york", "NY"],
  ["north carolina", "NC"], ["north dakota", "ND"], ["ohio", "OH"], ["oklahoma", "OK"],
  ["oregon", "OR"], ["pennsylvania", "PA"], ["rhode island", "RI"], ["south carolina", "SC"],
  ["south dakota", "SD"], ["tennessee", "TN"], ["texas", "TX"], ["utah", "UT"],
  ["vermont", "VT"], ["virginia", "VA"], ["washington", "WA"], ["west virginia", "WV"],
  ["wisconsin", "WI"], ["wyoming", "WY"], ["district of columbia", "DC"],
  ["american samoa", "AS"], ["guam", "GU"], ["northern mariana islands", "MP"],
  ["puerto rico", "PR"], ["virgin islands", "VI"], ["u.s. virgin islands", "VI"],
]);

/** A USPS code or a full state name → the two-letter code; `null` otherwise. */
export function parseUsStateCode(raw: string): string | null {
  const trimmed = collapseWhitespace(raw);
  const upper = trimmed.toUpperCase();
  if (US_STATE_CODES.has(upper)) return upper;
  return US_STATE_NAMES.get(trimmed.toLowerCase()) ?? null;
}

/** Digits only, so `(858) 555-0134` and `858-555-0134` agree. */
export function normalizePhoneDigits(raw: string): string {
  return raw.replace(/\D+/g, "");
}
