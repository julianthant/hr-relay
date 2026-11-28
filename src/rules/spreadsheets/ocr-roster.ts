import { parseRunWorkbookReference } from "../../models/dashboard/workbooks.js";
import { wholeCellEid } from "../../models/fields/cell-coercion.js";
import { CANONICAL_FIELDS } from "../../models/fields/registry.js";
import type { WorksheetRowChoice } from "../../models/processing/workbooks/reference-choice.js";
import type { SchemaBoundCanonicalValue } from "../../models/validation/schema-bound-value.js";
import { OCR_ROSTER_FIELDS, OCR_ROSTER_TYPE_ID, OcrWorkbookRosterEvidenceSchema, type OcrWorkbookRosterEvidence } from "../../models/workflows/ocr/roster.js";
import { canonicalJsonStringify } from "../validation/canonical-json.js";
import { sha256Hex } from "../validation/sha256.js";
import { resolveWorksheetRows } from "./reference-rows.js";

export function bindOcrRoster(bounds: readonly SchemaBoundCanonicalValue[], readAt: string) {
  const sources = bounds.map(bound => ({ ...parseRunWorkbookReference(bound), referenceDigest: sha256Hex(canonicalJsonStringify(bound)) }));
  const first = sources[0];
  if (first === undefined || new Set(sources.map(source => source.referenceDigest)).size !== sources.length) throw new Error("ocr-roster-reference-invalid");
  const candidates = sources.flatMap(({ request, snapshot, referenceDigest }) => {
    if (!("mode" in request) || request.typeId !== OCR_ROSTER_TYPE_ID || snapshot.type.keyFieldId !== "eid"
      || request.fields.length !== OCR_ROSTER_FIELDS.length
      || OCR_ROSTER_FIELDS.some(field => !request.fields.includes(field) || !snapshot.type.fields.includes(field))) {
      throw new Error("ocr-roster-reference-invalid");
    }
    return snapshot.rows.map(row => {
      const match = row.matches[0];
      if (row.state !== "matched" || match === undefined || row.matches.length !== 1) throw new Error("ocr-roster-membership-invalid");
      return { ...match, referenceDigest, eid: wholeCellEid(match.values.eid) };
    });
  });
  if (new Set(candidates.map(({ referenceDigest, sheetId, rowId }) => canonicalJsonStringify([referenceDigest, sheetId, rowId]))).size !== candidates.length) {
    throw new Error("ocr-roster-membership-invalid");
  }
  const keyed = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    if (candidate.eid === null) continue;
    const rows = keyed.get(candidate.eid) ?? [];
    rows.push(candidate);
    keyed.set(candidate.eid, rows);
  }
  const conflicts = new Map<string, typeof candidates>(), duplicates = new Set<typeof candidates[number]>();
  for (const [key, rows] of keyed) {
    const resolved = resolveWorksheetRows(rows, row => row.values);
    if (resolved.state === "ambiguous") conflicts.set(key, rows);
    if (resolved.state === "resolved") for (const duplicate of rows.slice(1)) duplicates.add(duplicate);
  }
  const roster = OcrWorkbookRosterEvidenceSchema.parse({ workbookType: OCR_ROSTER_TYPE_ID,
    workbookId: first.snapshot.libraryId, workbookVersion: first.snapshot.version, referenceDigest: first.referenceDigest, readAt,
    rows: candidates.filter(row => !duplicates.has(row)).map(({ eid, sheetId, rowId, values, referenceDigest }, index) => ({
      sourceRow: index + 1, sheetId, rowId, eid,
      ...(sources.length > 1 ? { referenceDigest } : {}),
      name: values.fullName === null || typeof values.fullName === "string" && values.fullName.trim() === ""
        ? null : CANONICAL_FIELDS.fullName.schema.parse(values.fullName),
    })) });
  return { roster, conflicts };
}

export function chooseOcrRoster(input: { roster: OcrWorkbookRosterEvidence | null; rosterChoice?: "required" }, choice?: WorksheetRowChoice) {
  const { roster } = input;
  if (input.rosterChoice === undefined && choice === undefined) return roster;
  if (input.rosterChoice !== "required" || roster === null || choice?.referenceDigest !== roster.referenceDigest) {
    throw new Error("ocr-roster-choice-unavailable");
  }
  const chosen = new Map(choice.rows.map(row => [row.key, row]));
  const seen = new Set<string>();
  const rows = roster.rows.filter(row => {
    const selected = row.eid === null ? undefined : chosen.get(row.eid);
    if (selected === undefined) return true;
    if (selected.referenceDigest !== (row.referenceDigest ?? roster.referenceDigest) || selected.sheetId !== row.sheetId || selected.rowId !== row.rowId) return false;
    seen.add(selected.key);
    return true;
  });
  const ids = rows.flatMap(row => row.eid === null ? [] : [row.eid]);
  if (seen.size !== chosen.size || new Set(ids).size !== ids.length) throw new Error("ocr-roster-choice-invalid");
  return OcrWorkbookRosterEvidenceSchema.parse({ ...roster, rows: rows.map((row, index) => ({ ...row, sourceRow: index + 1 })) });
}
