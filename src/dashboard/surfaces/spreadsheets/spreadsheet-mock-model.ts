import { systemClock, type Clock } from "../../../rules/time/clock.js";
import { cellText, type SpreadsheetSaveResult, type EditableWorkbook } from "./spreadsheet-editor-model.js";
import { useSyncExternalStore } from "react";
import { MOCK_ROSTER_ROWS, ROSTER_FIELDS, ROSTER_SHEETS } from "./spreadsheet-mock-data.js";
import { fieldForSpreadsheetHeader, spreadsheetField, spreadsheetHeaderKey, type SpreadsheetColumnBinding } from './spreadsheet-fields-model.js';
import { setSpreadsheetHeaderRow } from './spreadsheet-column-import-model.js';

export interface SpreadsheetType { readonly id: string; readonly name: string; readonly fields: readonly string[] }
export interface SpreadsheetSheet { readonly name: string; readonly headerRow: number; readonly columns: readonly string[]; readonly mapping: readonly string[]; readonly bindings?: readonly SpreadsheetColumnBinding[] }
export interface RegisteredSpreadsheet { readonly id: string; readonly name: string; readonly typeId: string; readonly sheets: readonly SpreadsheetSheet[]; readonly addedAt?: string }
export interface SpreadsheetMockState { readonly types: readonly SpreadsheetType[]; readonly files: readonly RegisteredSpreadsheet[] }
export const WORKBOOK_ONLY = "Keep in workbook only";
export const NOT_MAPPED = "Not used";
const normalize = spreadsheetHeaderKey;
export function initialSpreadsheetSheets(type: SpreadsheetType): SpreadsheetSheet[] {
  return ROSTER_SHEETS.map(sheet => ({ ...sheet, mapping: sheet.columns.map(column => {
    const key = normalize(column);
    if (["temppassword", "temporarypassword", "ssn"].includes(key)) return WORKBOOK_ONLY;
    const canonical = fieldForSpreadsheetHeader(column);
    return canonical ? type.fields.find(field => fieldForSpreadsheetHeader(field)?.id === canonical.id) ?? NOT_MAPPED : NOT_MAPPED;
  }) }));
}
const roster: SpreadsheetType = { id: "roster", name: "Roster", fields: ROSTER_FIELDS };
function initialState(): SpreadsheetMockState {
  return { types: [roster], files: [
    { id: "mock-roster-current", name: "26–27 Student applicants.xlsx", typeId: roster.id, addedAt: "2026-10-01T16:00:00Z", sheets: initialSpreadsheetSheets(roster) },
    { id: "mock-roster-previous", name: "25–26 Student applicants.xlsx", typeId: roster.id, addedAt: "2026-10-01T16:00:00Z", sheets: initialSpreadsheetSheets(roster) },
    { id: "mock-roster-summer", name: "Summer student roster.xlsx", typeId: roster.id, addedAt: "2026-10-01T16:00:00Z", sheets: initialSpreadsheetSheets(roster).slice(0, 3) },
  ] };
}
let state = initialState();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => state;
function publish(next: SpreadsheetMockState) { state = next; for (const listener of listeners) listener(); }
export function useSpreadsheetMocks(): SpreadsheetMockState { return useSyncExternalStore(subscribe, snapshot, snapshot); }
export function spreadsheetFields(file: RegisteredSpreadsheet): string[] {
  return [...new Set(file.sheets.flatMap(sheet => sheet.mapping.filter(field => field !== NOT_MAPPED && field !== WORKBOOK_ONLY)))];
}
export function spreadsheetMappingErrors(sheets: readonly SpreadsheetSheet[]): string[] {
  const errors: string[] = [];
  for (const sheet of sheets) {
    if (!Number.isSafeInteger(sheet.headerRow) || sheet.headerRow < 1) errors.push(`${sheet.name}: enter a positive header row.`);
    const fields = sheet.mapping.filter(field => field !== NOT_MAPPED && field !== WORKBOOK_ONLY);
    if (new Set(fields).size !== fields.length) errors.push(`${sheet.name}: map each named field only once.`);
  }
  if (!sheets.some(sheet => sheet.mapping.some(field => field !== NOT_MAPPED && field !== WORKBOOK_ONLY))) errors.push("Map at least one column to a named field.");
  return errors;
}
export function registerMockSpreadsheet(file: Omit<RegisteredSpreadsheet, "id">, existingId?: string, clock: Clock = systemClock): RegisteredSpreadsheet {
  const type = state.types.find(entry => entry.id === file.typeId);
  if (!type) throw new Error("SPREADSHEET_TYPE_NOT_FOUND");
  if (!file.name.trim()) throw new Error("SPREADSHEET_NAME_REQUIRED");
  const errors = spreadsheetMappingErrors(file.sheets);
  if (errors.length) throw new Error(errors.join(" "));
  if (file.sheets.some(sheet => sheet.mapping.some(field => field !== NOT_MAPPED && field !== WORKBOOK_ONLY && !type.fields.includes(field)))) throw new Error("SPREADSHEET_FIELD_NOT_FOUND");
  if (existingId && !state.files.some(entry => entry.id === existingId)) throw new Error("SPREADSHEET_NOT_FOUND");
  const record = { addedAt: state.files.find(entry => entry.id === existingId)?.addedAt ?? clock.now().toISOString(), ...structuredClone(file), sheets: file.sheets.map((sheet, index) => ({ ...sheet, bindings: sheet.columns.map((sourceHeader, column) => ({ id: `sheet-${index + 1}:column:${column}`, sourceColumn: column, sourceHeader, fieldId: [NOT_MAPPED, WORKBOOK_ONLY].includes(sheet.mapping[column]) ? null : fieldForSpreadsheetHeader(sheet.mapping[column])!.id, basis: 'manual' as const })) })), id: existingId ?? `mock-import-${state.files.length + 1}` };
  publish({ ...state, files: existingId ? state.files.map(entry => entry.id === existingId ? record : entry) : [record, ...state.files] });
  return record;
}
export function addMockSpreadsheetType(name: string, fields: readonly string[]): SpreadsheetType {
  name = name.trim(); fields = fields.map(field => field.trim());
  if (!name) throw new Error("Enter a type name.");
  if (state.types.some(type => normalize(type.name) === normalize(name))) throw new Error("A spreadsheet type with this name already exists.");
  if (!fields.length || fields.some(field => !field)) throw new Error("Name every field before adding this type.");
  if (new Set(fields.map(normalize)).size !== fields.length || fields.some(field => [NOT_MAPPED, WORKBOOK_ONLY].includes(field))) throw new Error("Use a different name for each field.");
  if (fields.some(field => !fieldForSpreadsheetHeader(field))) throw new Error('Choose every field from the available dashboard fields.');
  if (new Set(fields.map(field => fieldForSpreadsheetHeader(field)!.id)).size !== fields.length) throw new Error('Use a different name for each field.');
  const type = { id: `mock-type-${state.types.length + 1}`, name, fields };
  publish({ ...state, types: [...state.types, type] });
  return type;
}
export function searchMockSpreadsheet(file: RegisteredSpreadsheet, sheetName: string, query: string): readonly Readonly<Record<string, string>>[] {
  const sheet = file.sheets.find(entry => entry.name === sheetName);
  if (!sheet) throw new Error("SPREADSHEET_SHEET_NOT_FOUND");
  const fields = sheet.mapping.filter(field => field !== NOT_MAPPED && field !== WORKBOOK_ONLY);
  const needle = query.trim().toLowerCase();
  const local = localWorkbooks.get(file.id)?.sheets.find(entry => entry.name === sheetName);
  if (local) return local.rows.slice(1).map(row => Object.fromEntries(local.columnBindings?.flatMap((binding, column) => binding.fieldId ? [[spreadsheetField(binding.fieldId).label, cellText(row.cells[column])]] : []) ?? [])).filter(row => !needle || Object.values(row).some(value => value.toLowerCase().includes(needle)));
  return MOCK_ROSTER_ROWS.filter(row => !needle || fields.some(field => (row[field] ?? "").toLowerCase().includes(needle)));
}
export function resetSpreadsheetMocks(): void { mockSavedVersions.clear(); localWorkbooks.clear(); publish(initialState()); }

const localWorkbooks = new Map<string, EditableWorkbook>();
export function registeredSpreadsheetWorkbook(file: RegisteredSpreadsheet): EditableWorkbook {
  const local = localWorkbooks.get(file.id);
  if (local) return { ...structuredClone(local), libraryId: file.id };
  return { name: file.name, libraryId: file.id, hasFormulas: false, themes: [], sheets: file.sheets.map((sheet, index) => {
    const fields = sheet.mapping.flatMap((field, column) => field === NOT_MAPPED || field === WORKBOOK_ONLY ? [] : [{ field, title: sheet.columns[column] }]);
    if (!fields.length) throw new Error("SPREADSHEET_NO_VISIBLE_COLUMNS");
    return { id: `sheet-${index + 1}`, name: sheet.name, width: fields.length, hidden: [], headerRow: 1, sourceHeaderRow: sheet.headerRow,
      columnBindings: fields.map(({ field, title }, column) => ({ id: `sheet-${index + 1}:column:${column}`, sourceColumn: sheet.columns.indexOf(title), sourceHeader: title, fieldId: fieldForSpreadsheetHeader(field)?.id ?? null, basis: 'manual' as const })), rows: [
      { id: "header", cells: fields.map(({ title }) => ({ value: title })) },
      ...MOCK_ROSTER_ROWS.map((row, number) => ({ id: `row-${number + 1}`, cells: fields.map(({ field }) => ({ value: row[field] ?? "" })) })),
    ] };
  }) };
}
function localSpreadsheetSheets(document: EditableWorkbook): SpreadsheetSheet[] {
  return document.sheets.map(sheet => ({ name: sheet.name, headerRow: sheet.sourceHeaderRow ?? 1, columns: sheet.rows[0].cells.map(cellText),
    mapping: sheet.columnBindings!.map(binding => binding.fieldId ? spreadsheetField(binding.fieldId).label : NOT_MAPPED), bindings: sheet.columnBindings }));
}
function withColumnBindings(document: EditableWorkbook): EditableWorkbook {
  return { ...document, sheets: document.sheets.map(sheet => sheet.columnBindings ? sheet : setSpreadsheetHeaderRow(sheet, sheet.headerRow ?? 1)) };
}
export function registerLocalSpreadsheet(document: EditableWorkbook, existingId?: string, clock: Clock = systemClock): RegisteredSpreadsheet {
  const existing = existingId ? state.files.find(file => file.id === existingId) : undefined;
  if (existingId && !existing) throw new Error('SPREADSHEET_NOT_FOUND');
  document = withColumnBindings(document);
  const file: RegisteredSpreadsheet = { id: existingId ?? crypto.randomUUID(), name: document.name, typeId: 'local', addedAt: existing?.addedAt ?? clock.now().toISOString(), sheets: localSpreadsheetSheets(document) };
  localWorkbooks.set(file.id, { ...structuredClone(document), libraryId: file.id });
  publish({ ...state, files: existingId ? state.files.map(entry => entry.id === existingId ? file : entry) : [file, ...state.files] });
  return file;
}
export function retainSpreadsheetCopy(id: string, document: EditableWorkbook): void {
  if (!state.files.some(file => file.id === id)) throw new Error("SPREADSHEET_NOT_FOUND");
  document = withColumnBindings(document);
  localWorkbooks.set(id, structuredClone(document));
  publish({ ...state, files: state.files.map(file => file.id === id ? { ...file, name: document.name, sheets: localSpreadsheetSheets(document) } : file) });
}

const mockSavedVersions = new Map<string, number>();
export async function saveMockSpreadsheet(draft: EditableWorkbook): Promise<SpreadsheetSaveResult> {
  await new Promise(resolve => window.setTimeout(resolve, 250));
  if (!draft.libraryId) return { state: 'refused', reason: 'Open a registered workbook before saving.' };
  retainSpreadsheetCopy(draft.libraryId, draft);
  const version = (mockSavedVersions.get(draft.libraryId) ?? 0) + 1;
  mockSavedVersions.set(draft.libraryId, version);
  const file = state.files.find(file => file.id === draft.libraryId);
  if (!file) return { state: 'uncertain', reason: 'The saved workbook could not be read back.' };
  return { state: 'confirmed', version, readback: registeredSpreadsheetWorkbook(file) };
}
