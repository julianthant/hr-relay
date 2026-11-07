

/** One rendered result row, as the interpreter reads it off the DOM. */
export interface SlatRenderFact {
  /** The row's accessible name, or its whitespace-collapsed text when it has none. */
  readonly label: string;
  /** Whether the row's `krn-slats-tabular-data` card has been transcluded yet (stage 3). */
  readonly cardRendered: boolean;
}


export type SearchRenderVerdict = "results" | "hydrating" | "absent";

/** AngularJS leaves the raw `{{ … }}` binding in a text node until its first digest. */
const UNINTERPOLATED_BINDING = "{{";

// A row is readable only after its card exists and template bindings are interpolated.
export function slatRenderComplete(slat: SlatRenderFact): boolean {
  return slat.cardRendered && slat.label.length > 0 && !slat.label.includes(UNINTERPOLATED_BINDING);
}

export function judgeSearchRender(slats: readonly SlatRenderFact[]): SearchRenderVerdict {
  if (slats.length === 0) return "absent";
  return slats.every(slatRenderComplete) ? "results" : "hydrating";
}

/** The identity WFD renders per row: `Name <name> ID <eid>` (label/value pairs of the tabular card). */
const SLAT_IDENTITY = /^Name\s+(.+?)\s+ID\s+(\d{6,10})$/u;


export function parseSlatIdentity(
  label: string,
): Readonly<{ displayName: string; employeeId: string }> | null {
  const match = SLAT_IDENTITY.exec(label.replace(/\s+/gu, " ").trim());
  if (match === null) return null;
  const [, displayName = "", employeeId = ""] = match;
  return Object.freeze({ displayName, employeeId });
}
