import { z } from "zod";
import { classifyNameSimilarity } from "./name-match.js";

export const ReferenceCheckOutcomeSchema = z.enum(["found", "not-found", "name-differs"]);
export type ReferenceCheckOutcome = z.infer<typeof ReferenceCheckOutcomeSchema>;
export const ReferenceCheckResultSchema = z.enum(["confirmed", "unconfirmed", "no-person"]);

/** One sheet row that carries the person's Employee ID; `name` is null when the sheet has no name column or the cell holds no text. */
type ReferenceRow = Readonly<{ row: number; name: string | null }>;
type ReferenceRowCheck = Readonly<{ outcome: ReferenceCheckOutcome; row: number | null }>;

/** The name is compared when the sheet has a name column and the run found a name; a blank or non-text name there never confirms the person. */
export function checkReferenceRows(personName: string | null, rows: readonly ReferenceRow[], hasNameColumn: boolean): ReferenceRowCheck {
  const first = rows[0];
  if (first === undefined) return { outcome: "not-found", row: null };
  if (!hasNameColumn || personName === null) return { outcome: "found", row: first.row };
  const agreeing = rows.find(candidate => candidate.name !== null && classifyNameSimilarity(personName, candidate.name) !== "different");
  return agreeing === undefined ? { outcome: "name-differs", row: first.row } : { outcome: "found", row: agreeing.row };
}

/** The Logs line names the spreadsheet, the sheet and the row number, never a value from the row. */
export function referenceCheckLine(spreadsheet: string, sheet: string, check: ReferenceRowCheck): string {
  const row = String(check.row);
  const outcome = { found: `found in row ${row}`, "not-found": "not found", "name-differs": `name differs in row ${row}` }[check.outcome];
  return `${spreadsheet} · ${sheet}: ${outcome}`;
}

export function referenceCheckResult(outcomes: readonly ReferenceCheckOutcome[]): "confirmed" | "unconfirmed" {
  return outcomes.every(outcome => outcome === "found") ? "confirmed" : "unconfirmed";
}
