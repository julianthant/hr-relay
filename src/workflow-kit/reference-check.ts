import { classifyNameSimilarity, matchesExactPersonName } from "../rules/matching/name-match.js";
import { spreadsheetField, type SpreadsheetFieldType } from "../models/fields/workbook-fields.js";
import type { CompareReferenceFields, ReferenceField, ReferenceFieldApproval, ReferenceMatch, ReferenceMismatch, ReferenceSheet } from "../models/processing/workbooks/reference-fields.js";
import { z } from "zod";
import { NodeIdSchema } from "../rules/identity/ids.js";
import { deepFreeze } from "../rules/validation/immutability.js";
import { REFERENCE_CHECK_ID, ReferenceKeyFieldSchema } from "../models/processing/workbooks/reference-fields.js";
import type { StepOmissionForm, StepOmissionProduceContext } from "../models/workflow/step-omission.js";

export const REFERENCE_RESULT_FORM = deepFreeze({
  fields: [{ key: "referenceResult", label: "Reference spreadsheet result", kind: "enum", values: ["Confirmed", "Unconfirmed", "Not checked"] }],
} satisfies StepOmissionForm);

export function manualReferenceReview({ facts, scope }: StepOmissionProduceContext) {
  return { captured: null, matches: [], mismatches: [], review: scope.dryRun === undefined && facts.referenceResult !== "Confirmed" ? true : null };
}

const SourceFields = z.record(z.string(), z.union([z.string().min(1), z.array(z.string().min(1)).min(2)]));
const ReferenceCheckDefinitionSchema = z.strictObject({
  key: ReferenceKeyFieldSchema,
  input: SourceFields.optional(),
  lookupName: z.string().min(1).optional(),
  manual: z.enum(["values", "review-on-own-start"]).optional(),
  writeReview: z.strictObject({ source: NodeIdSchema, before: z.array(NodeIdSchema).min(1) }).optional(),
  outputs: z.record(z.string().refine(id => NodeIdSchema.safeParse(id).success), SourceFields),
});
export type ReferenceCheckDefinition = z.input<typeof ReferenceCheckDefinitionSchema>;

export function defineReferenceCheck(spec: ReferenceCheckDefinition) {
  const definition = ReferenceCheckDefinitionSchema.parse(spec);
  for (const source of [definition.input ?? {}, ...Object.values(definition.outputs)]) {
    for (const field of Object.keys(source)) spreadsheetField(field);
  }
  return deepFreeze({ ...definition, selection: { id: REFERENCE_CHECK_ID, keyFieldId: definition.key } });
}

function valueAt(value: unknown, path: string): string {
  let selected = value;
  for (const key of path.split(".")) {
    const unique = key.endsWith("[]");
    const member = unique ? key.slice(0, -2) : key;
    if (selected === null || typeof selected !== "object" || !Object.hasOwn(selected, member)) return "";
    selected = Reflect.get(selected, member);
    if (unique) {
      if (!Array.isArray(selected) || selected.length !== 1) return "";
      selected = selected[0];
    }
  }
  return typeof selected === "string" || typeof selected === "number" ? String(selected).trim() : "";
}

export function referenceFieldsAt(fields: Readonly<Record<string, string | readonly string[]>>, value: unknown): ReferenceField[] {
  return Object.entries(fields).flatMap(([field, path]) => {
    const parts = typeof path === "string" ? [valueAt(value, path)] : path.map(part => valueAt(value, part));
    const text = parts.every(Boolean) ? parts.join(" ") : "";
    return text.length > 0 ? [{ field, value: text }] : [];
  });
}

function dateKey(value: string): string {
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/u.exec(value);
  return us === null ? value : `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
}

function comparisonValue(type: SpreadsheetFieldType, value: string): string {
  switch (type) {
    case "email": return value.toLowerCase();
    case "date": return dateKey(value);
    default: return value;
  }
}

export function newReferenceFields(fields: readonly ReferenceField[], compared: readonly ReferenceField[] = []): ReferenceField[] {
  const seen = [...compared];
  return fields.filter(field => {
    const type = spreadsheetField(field.field).type;
    if (seen.some(previous => previous.field === field.field && (type === "name"
      ? matchesExactPersonName(previous.value, field.value)
      : comparisonValue(type, previous.value) === comparisonValue(type, field.value)))) return false;
    seen.push(field);
    return true;
  });
}

export function compareReferenceFields(
  sheets: readonly ReferenceSheet[], fields: readonly ReferenceField[], approved: readonly ReferenceFieldApproval[],
): Readonly<{ matches: ReferenceMatch[]; mismatches: ReferenceMismatch[] }> {
  const matches: ReferenceMatch[] = [], mismatches: ReferenceMismatch[] = [];
  const distinct = newReferenceFields(fields);
  for (const { source, sheet, rows } of sheets) {
    for (const { row, values } of rows) {
      for (const { field, value: actual } of distinct) {
        const expected = values.find(cell => cell.field === field)?.value;
        if (expected === undefined) continue;
        const comparison = { sheet, row, field };
        const type = spreadsheetField(field).type;
        const agrees = type === "name" ? classifyNameSimilarity(expected, actual) !== "different"
          : comparisonValue(type, expected) === comparisonValue(type, actual);
        if (agrees) matches.push(comparison);
        else if (!approved.some(item => item.source === source && item.field === field)) {
          mismatches.push({ source, ...comparison, expected, actual });
        }
      }
    }
  }
  return { matches, mismatches };
}

export function compareReferenceCapture(input: z.output<typeof CompareReferenceFields.input>, captured: ReferenceSheet[] | null) {
  const sheets = captured ?? input.sheets;
  const compared = compareReferenceFields(sheets ?? [], input.fields, input.approved);
  const lines = (captured ?? []).flatMap(sheet => sheet.rows.length === 0 ? [`Not in ${sheet.sheet}`] : []);
  if (sheets === null && input.last) lines.push(`Reference not checked: no ${input.keyField === "eid" ? "Employee ID" : "email address"}`);
  for (const match of compared.matches) lines.push(`${match.sheet}, row ${match.row}: ${spreadsheetField(match.field).label} matches`);
  for (const mismatch of compared.mismatches) lines.push(`${mismatch.sheet}, row ${mismatch.row}: ${spreadsheetField(mismatch.field).label} differs`);
  return { output: { captured, ...compared, review: compared.mismatches.length > 0 ? true as const : null }, lines };
}
