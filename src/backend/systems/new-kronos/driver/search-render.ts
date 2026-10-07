/**
 * The Employee Search result render, judged as DATA (§9.20 item 7 → §9.28).
 *
 * The interpreter's search poll used to accept a result row on sight — the
 * moment `[role='menuitemradio']` counted above zero — and then read each
 * row's identity. WFD renders a slat in STAGES, each an Angular digest apart
 * (live 2026-08-27, MutationObserver in the panel's frame, 7 cold + 14 warm
 * searches):
 *
 *   1. the `slat-container` host lands — the row, already `role=menuitemradio`,
 *      with NO text;
 *   2. the inner `krn-slat` skeleton (checkbox zone, data zone) renders;
 *   3. the `krn-slats-tabular-data` card is transcluded into the data zone,
 *      its `span.card__label` / `span.card__info` text nodes still holding the
 *      RAW bindings `{{::row.label ? row.label : row.name}}` and
 *      `{{context.data[slatIndex][row.name]}}`;
 *   4. a digest interpolates them into `Name` / `<name>` / `ID` / `<eid>`.
 *
 * Host → interpolated text measured 30–108 ms on a cold profile's first search
 * and 9–18 ms warm on an idle machine, 214–570 ms under CPU throttling. On
 * 2026-08-19's loaded cold profile the driver's 200 ms poll landed inside it
 * and refused the row as `""`; under 20× throttle on 2026-08-27 it did so
 * again with a card-presence check in place — stage 3 is not the answer.
 *
 * This module is the verdict, out of the Playwright closure so a fixture can
 * reach it (the D205 discipline: a decision only a real WFD session can
 * exercise is a decision nobody can pin).
 */

/** One rendered result row, as the interpreter reads it off the DOM. */
export interface SlatRenderFact {
  /** The row's accessible name, or its whitespace-collapsed text when it has none. */
  readonly label: string;
  /** Whether the row's `krn-slats-tabular-data` card has been transcluded yet (stage 3). */
  readonly cardRendered: boolean;
}

/**
 * - `results`: at least one row, and every row has COMPLETED its render — the
 *   identity can be read now (and may still fail to parse, which is a refusal).
 * - `hydrating`: rows exist but at least one is still mid-render — keep
 *   polling, and refuse if the bound elapses here.
 * - `absent`: no rows at all — the sentinel logic decides.
 */
export type SearchRenderVerdict = "results" | "hydrating" | "absent";

/** AngularJS leaves the raw `{{ … }}` binding in a text node until its first digest. */
const UNINTERPOLATED_BINDING = "{{";

/**
 * A row has completed its render when its card is in (stage 3) AND the card's
 * bindings have been interpolated (stage 4): the text is non-empty and no
 * longer carries a raw `{{ … }}` binding. Empty text is stage 1–3; a `{{`
 * is stage 3. Neither is a subject.
 */
export function slatRenderComplete(slat: SlatRenderFact): boolean {
  return slat.cardRendered && slat.label.length > 0 && !slat.label.includes(UNINTERPOLATED_BINDING);
}

export function judgeSearchRender(slats: readonly SlatRenderFact[]): SearchRenderVerdict {
  if (slats.length === 0) return "absent";
  return slats.every(slatRenderComplete) ? "results" : "hydrating";
}

/** The identity WFD renders per row: `Name <name> ID <eid>` (label/value pairs of the tabular card). */
const SLAT_IDENTITY = /^Name\s+(.+?)\s+ID\s+(\d{6,10})$/u;

/**
 * Parse a row's label into its subject, or `null` when the label does not
 * carry the identity — the caller refuses by name; this never guesses.
 */
export function parseSlatIdentity(
  label: string,
): Readonly<{ displayName: string; employeeId: string }> | null {
  const match = SLAT_IDENTITY.exec(label.replace(/\s+/gu, " ").trim());
  if (match === null) return null;
  const [, displayName = "", employeeId = ""] = match;
  return Object.freeze({ displayName, employeeId });
}
