/**
 * The intake workspace's pure half — every sentence the surface composes from
 * the served session, extracted so it is pinned by a unit test rather than by a
 * screenshot.
 *
 * This tree renders no React in the unit lane (D187's lesson, restated by
 * D237/D238), so an operator-facing string left inside a component is only as
 * pinned as the parity corpus that photographs it — and three of the facts
 * below (`corrections`, the manifest block) appear on states the corpus does
 * not hold. They are folds, so they are testable; leaving them inline would
 * have made them unpinnable.
 *
 * Every fact here is one the wire ALREADY carries and the surface used to drop
 * on the floor (03a §Served-and-dropped, ledger 3 §6 rows IN8, IN9, IN53, IN82,
 * IN106, IN121, IN126, IN127, IN131). The legacy rebuild-demo is the incumbent
 * visual truth for where and how each is drawn; each fold names the demo line
 * it is ported from.
 *
 * Provenance: `hr-automation@src/dashboard/components/dev/rebuild-demo/DemoIntake.tsx`.
 */
import type { z } from "zod";
import type { ServedHeaderCandidateSchema } from "../../domain/intake/header-discovery.js";
import type { IntakeRowCorrectionSchema } from "../../domain/intake/session.js";
import type { SuggestionSchema } from "../../domain/intake/suggestions.js";
import type { IntakeSessionWire } from "../../domain/intake/wire.js";
import { shortHash } from "./format.js";

type ServedHeaderCandidate = z.infer<typeof ServedHeaderCandidateSchema>;
type IntakeRowCorrection = z.infer<typeof IntakeRowCorrectionSchema>;
type Suggestion = z.infer<typeof SuggestionSchema>;

/** Why a column was proposed — ref data-intake-and-edit-data §2.5's scorer, said out loud. */
const SUGGESTION_WHY_LABEL: Record<Suggestion["why"][number], string> = {
  "alias-exact": "known header",
  "label-exact": "matches the field label",
  "token-overlap": "words in common",
  "samples-parse": "its values parse",
};

/**
 * The name this file was uploaded under — one fallback, spelled once.
 *
 * A pre-D171 session has no `sourceName`, and a blank there would read as a
 * file with no name rather than as a record that predates the field.
 */
export function sourceLabel(session: IntakeSessionWire): string {
  return session.sourceName ?? "(this session predates file names)";
}

/**
 * A header candidate as one line of a `<select>` — `row 4 · confidence 0.96 —
 * Employee ID · Legal Name · …` (IN53, `DemoIntake.tsx:488-493`).
 *
 * The demo draws the rank as its own muted span inside a selectable `Card`;
 * D173 reshaped the candidate list into one `Select`, and an `<option>` carries
 * text and nothing else — so the fact travels as a ` · ` segment in the label,
 * in the demo's own order (row, then confidence, then the row's cells) and at
 * the demo's own two decimal places. It is a RANK, never a probability, which
 * is why it is never rendered as a percentage.
 */
export function headerCandidateOptionLabel(candidate: ServedHeaderCandidate): string {
  const preview = candidate.cells.filter((cell) => cell.length > 0).slice(0, 6).join(" · ");
  return `row ${String(candidate.rowIndex + 1)} · confidence ${candidate.confidence.toFixed(2)} — ${preview}`;
}

/**
 * A proposal's reasoning and its rank — `known header, matches the field label
 * (0.94)` (IN82, `DemoIntake.tsx:636-638`).
 *
 * The demo prints the score parenthesised immediately after the reason, in the
 * same muted span, because the two are one thought: *this* is why, and *this*
 * is how strongly. Splitting them across two lines would let the rank read as a
 * fact about the column rather than about the proposal.
 */
export function suggestionProposalText(proposal: Suggestion): string {
  const why = proposal.why.map((entry) => SUGGESTION_WHY_LABEL[entry]).join(", ");
  return `${why} (${proposal.score.toFixed(2)})`;
}

/**
 * The layout the whole surface is read relative to — `header row 4 ·
 * fingerprint 503172dd` (IN8/IN9, `DemoIntake.tsx:355-358`).
 *
 * Every binding, correction and exclusion on this screen names a row and a
 * column UNDER THIS LAYOUT, and the kernel fences each confirmation on this
 * exact fingerprint — so the operator working at the bottom of a long grid can
 * read which layout they are deciding against without scrolling back to the
 * source band. That is the demo's reason for putting it in the dialog footer,
 * and the sticky outcome band is this workspace's footer.
 *
 * Empty until a header row is settled: before that there is no layout, and a
 * fingerprint of nothing is a value nobody could act on. The header row is
 * printed 1-BASED, matching the row numbers the source band's own picker and
 * every rejection use; `headerRowIndex` is 0-based on the wire.
 */
export function layoutMetaItems(session: IntakeSessionWire): string[] {
  if (session.headerRowIndex === null || session.headerFingerprint === null) return [];
  return [
    `header row ${String(session.headerRowIndex + 1)}`,
    `fingerprint ${shortHash(session.headerFingerprint)}`,
  ];
}

/**
 * A recorded correction, as its own line — `Employee ID (EID) → “12345”`
 * (IN121, `DemoIntake.tsx:918-921`).
 *
 * The demo writes `“<original>” → “<corrected>”`. `IntakeRowCorrectionSchema`
 * carries no `original`, so the left of the arrow is UNSERVED and the field's
 * own label stands there instead — inventing the prior value, or leaving an
 * empty quoted pair, would both be claims about a cell nothing on this wire
 * describes. The arrow survives because the direction is served: this value
 * REPLACED what the file holds, and the file is never rewritten.
 */
export function correctionText(correction: IntakeRowCorrection, fieldLabel: string): string {
  return `${fieldLabel} → “${correction.correctedValue}”`;
}
