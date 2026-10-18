/** The pure per-cell coercion core: every helper turns ONE raw spreadsheet/PDF cell string into a schema-valid canonical value or a typed refusal, never a default. */
import type { IntakeTargetFieldId, WorkflowId } from "../../rules/identity/ids.js";

/** Where a cell sits, so a failure names the thing the operator must fix. */
export interface CellLocation {
  readonly workflow: WorkflowId;
    /* When this value was OBSERVED, as an ISO instant; it is what resolves a two-digit year, so it is supplied by the caller rather than read from a clock here. */
  readonly readAt: string;
  /** 1-based row number in the SOURCE file, not an index into the valid set. */
  readonly sourceRow: number;
  /** The source column's header text exactly as the file spells it. */
  readonly header: string;
  /** The intake projection path this cell was bound to. */
  readonly targetFieldId: IntakeTargetFieldId;
}

/** A cell that cannot become a schema-valid canonical value; the message reproduces the documented shape verbatim, because the operator reads it in the grid. */
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

/** Title case while preserving the comma form and initial periods. */
export function titleCasePersonName(raw: string): string {
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
  return cased;
}

export function displayPersonName(raw: string): string {
  return titleCasePersonName(raw).replace(/\.\s*$/, "").trim();
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** `/` and `-` both occur on real paper: `4/23/26` and `4-23-26` alike. */
const US_DATE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/;

/** A two-digit year, resolved against when the value was read; `21` becomes 2021, `26` becomes 2026, `98` becomes 1998. */
const FORWARD_ALLOWANCE_YEARS = 1;

function resolveTwoDigitYear(twoDigits: number, referenceYear: number): number {
  const thisCentury = Math.floor(referenceYear / 100) * 100 + twoDigits;
  return thisCentury <= referenceYear + FORWARD_ALLOWANCE_YEARS ? thisCentury : thisCentury - 100;
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const daysInMonth = [
    31,
    (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
  ];
  return day <= (daysInMonth[month - 1] ?? 0);
}

/** `M/D/YY`, `M-D-YY`, `MM/DD/YYYY` (the legacy wire format) or an already-ISO `YYYY-MM-DD` → ISO `YYYY-MM-DD`. */
export function parseUsOrIsoDate(raw: string, readAt: string): string | null {
  const referenceYear = Number(readAt.slice(0, 4));
  if (!Number.isInteger(referenceYear) || referenceYear < 1000) return null;
  const trimmed = collapseWhitespace(raw);
  const iso = ISO_DATE.exec(trimmed);
  if (iso) {
    const [, year, month, day] = iso;
    return isRealCalendarDate(Number(year), Number(month), Number(day)) ? trimmed : null;
  }
  const us = US_DATE.exec(trimmed);
  if (!us) return null;
  const [, month, day, rawYear] = us;
  const year = rawYear.length === 2
    ? resolveTwoDigitYear(Number(rawYear), referenceYear)
    : Number(rawYear);
  if (!isRealCalendarDate(year, Number(month), Number(day))) return null;
  return `${String(year).padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** USPS two-letter codes for the 50 states, DC, and the five inhabited territories; a closed reference table, not a heuristic, and no prefix/fuzzy matching is attempted. */
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
