import { z } from "zod";
import { classifyNameSimilarity } from "./name-match.js";

export const ReferenceCheckOutcomeSchema = z.enum(["found", "not-found", "name-differs"]);
export type ReferenceCheckOutcome = z.infer<typeof ReferenceCheckOutcomeSchema>;
export const ReferenceCheckResultSchema = z.enum(["confirmed", "unconfirmed", "no-person"]);

/** One sheet row that carries the person's Employee ID; `name` is null when the sheet has no name column. */
type ReferenceRow = Readonly<{ row: number; name: string | null }>;
type ReferenceRowCheck = Readonly<{ outcome: ReferenceCheckOutcome; row: number | null }>;

/** The name is compared only when the run found one and the row holds one. */
export function checkReferenceRows(personName: string | null, rows: readonly ReferenceRow[]): ReferenceRowCheck {
  const first = rows[0];
  if (first === undefined) return { outcome: "not-found", row: null };
  const agreeing = rows.find(candidate => personName === null || candidate.name === null || candidate.name.trim() === ""
    || classifyNameSimilarity(personName, candidate.name) !== "different");
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
