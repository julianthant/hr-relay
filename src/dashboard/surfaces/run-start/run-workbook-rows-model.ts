import type { EditableWorkbookWire, WorkbookType } from "../../../models/dashboard/workbooks.js";
import type { InputRunSurface, TypedInputDraft } from "../../../models/workflow/ingress.js";
import { previewRunInput, type RunInputPreview } from "./run-start-model.js";

export interface WorkbookRowCoordinate {
  readonly sheetId: string;
  readonly rowId: string;
}

export type WorkbookRowChoice = WorkbookRowCoordinate & {
  readonly sourceLabel: string;
  readonly key: { readonly state: "available"; readonly value: string }
    | { readonly state: "unavailable"; readonly reason: "key-field-missing" | "key-binding-missing" | "key-binding-ambiguous" | "key-missing" | "key-not-text" | "key-blank" };
};

const unavailableKeyText = {
  "key-field-missing": "The spreadsheet type has no lookup key.",
  "key-binding-missing": "The lookup key column is not mapped.",
  "key-binding-ambiguous": "The lookup key column has an ambiguous mapping.",
  "key-missing": "This row has no lookup key.",
  "key-not-text": "The lookup key must be text.",
  "key-blank": "The lookup key is blank.",
} satisfies Record<Extract<WorkbookRowChoice["key"], { state: "unavailable" }>["reason"], string>;

export function workbookRowChoices(workbook: EditableWorkbookWire, type: WorkbookType): readonly WorkbookRowChoice[] {
  return workbook.sheets.flatMap(sheet => {
    const columns = sheet.columnBindings?.flatMap((binding, index) => binding.fieldId === type.keyFieldId && type.keyFieldId !== null ? [index] : []) ?? [];
    const headerRows = sheet.headerRow ?? 1;
    return sheet.rows.slice(headerRows).map((row, index): WorkbookRowChoice => {
      const coordinate = { sheetId: sheet.id, rowId: row.id, sourceLabel: `${sheet.name} · Row ${row.sourceRow ?? headerRows + index + 1}` };
      if (type.keyFieldId === null) return { ...coordinate, key: { state: "unavailable", reason: "key-field-missing" } };
      if (columns.length === 0) return { ...coordinate, key: { state: "unavailable", reason: "key-binding-missing" } };
      if (columns.length > 1) return { ...coordinate, key: { state: "unavailable", reason: "key-binding-ambiguous" } };
      const value = row.cells[columns[0]]?.value;
      if (value === undefined || value === null) return { ...coordinate, key: { state: "unavailable", reason: "key-missing" } };
      if (typeof value !== "string") return { ...coordinate, key: { state: "unavailable", reason: "key-not-text" } };
      if (value.trim().length === 0) return { ...coordinate, key: { state: "unavailable", reason: "key-blank" } };
      return { ...coordinate, key: { state: "available", value } };
    });
  });
}

const rowIdentity = ({ sheetId, rowId }: WorkbookRowCoordinate): string => JSON.stringify([sheetId, rowId]);

export function resolveWorkbookRowSelection(choices: readonly WorkbookRowChoice[], selected: readonly WorkbookRowCoordinate[]): readonly WorkbookRowChoice[] {
  const known = new Set(choices.map(rowIdentity));
  const identities = new Set<string>();
  for (const coordinate of selected) {
    const identity = rowIdentity(coordinate);
    if (!known.has(identity)) throw new Error("RUN_WORKBOOK_ROW_SELECTION_UNKNOWN");
    if (identities.has(identity)) throw new Error("RUN_WORKBOOK_ROW_SELECTION_DUPLICATE");
    identities.add(identity);
  }
  return choices.filter(choice => identities.has(rowIdentity(choice)));
}

export function previewWorkbookRows(surface: InputRunSurface, choices: readonly WorkbookRowChoice[], selected: readonly WorkbookRowCoordinate[], draft: TypedInputDraft = {}): RunInputPreview {
  const rows = resolveWorkbookRowSelection(choices, selected);
  const entries = rows.map((row, index) => ({ index, sourceText: `${row.sourceLabel}: ${row.key.state === "available" ? row.key.value : unavailableKeyText[row.key.reason]}` }));
  if (rows.length === 0) return { entries, submissions: [], problem: null };
  if (surface.workbookRows === undefined) return { entries, submissions: [], problem: "Saved-row input is unavailable for this workflow." };
  const declaration = surface.typedInput;
  if (declaration !== undefined && !declaration.modes.some(mode => Object.hasOwn(draft, declaration.modeField) && mode.value === draft[declaration.modeField]))
    return { entries, submissions: [], problem: `Choose ${declaration.modeLabel} before previewing selected rows.` };
  const submissions: RunInputPreview["submissions"][number][] = [];
  const problems: string[] = [];
  for (const row of rows) {
    if (row.key.state === "unavailable") {
      problems.push(`${row.sourceLabel}: ${unavailableKeyText[row.key.reason]}`);
      continue;
    }
    const preview = previewRunInput(surface, row.key.value, draft);
    const submission = preview.submissions[0];
    if (preview.problem !== null) problems.push(`${row.sourceLabel}: ${preview.problem}`);
    else if (preview.submissions.length !== 1) problems.push(`${row.sourceLabel}: A selected row must produce exactly one input.`);
    else if (submission === null || typeof submission !== "object" || Array.isArray(submission) || Reflect.get(submission, surface.workbookRows.inputField) !== row.key.value)
      problems.push(`${row.sourceLabel}: Parsed input must preserve the saved row key exactly.`);
    else submissions.push(submission);
  }
  return { entries, submissions: problems.length > 0 ? [] : submissions, problem: problems.length > 0 ? problems.join("\n") : null };
}
