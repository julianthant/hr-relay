import { cellText, type EditableWorkbook } from "./spreadsheet-editor-model.js";
import { useSyncExternalStore } from "react";
import { MOCK_ROSTER_ROWS, ROSTER_FIELDS, ROSTER_SHEETS } from "./spreadsheet-mock-data.js";

export interface SpreadsheetType { readonly id: string; readonly name: string; readonly fields: readonly string[] }
export interface SpreadsheetSheet { readonly name: string; readonly headerRow: number; readonly columns: readonly string[]; readonly mapping: readonly string[] }
export interface RegisteredSpreadsheet { readonly id: string; readonly name: string; readonly typeId: string; readonly sheets: readonly SpreadsheetSheet[]; readonly addedAt?: string }
export interface SpreadsheetMockState { readonly types: readonly SpreadsheetType[]; readonly files: readonly RegisteredSpreadsheet[] }
export const WORKBOOK_ONLY = "Keep in workbook only";
export const NOT_MAPPED = "Not used";
const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/gu, "");
const FIELD_ALIASES: Readonly<Record<string, string>> = {
  livedname: "Preferred name", ucpathid: "Employee ID", proposedlocationassignment: "Work location",
  position: "Position number", backgroundcheckaccepttermsyn: "Background terms accepted",
  datebackgroundentered: "Background entered", transaction: "Transaction number", addoathtoucpath: "Oath added to UCPath",
  gdrivejoleedataform: "JOL and employee data form",
};
export function initialSpreadsheetSheets(type: SpreadsheetType): SpreadsheetSheet[] {
  return ROSTER_SHEETS.map(sheet => ({ ...sheet, mapping: sheet.columns.map(column => {
    const key = normalize(column);
    if (["temppassword", "temporarypassword", "ssn"].includes(key)) return WORKBOOK_ONLY;
    return type.fields.find(field => normalize(field) === key) ?? (type.fields.includes(FIELD_ALIASES[key]) ? FIELD_ALIASES[key] : NOT_MAPPED);
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
export function registerMockSpreadsheet(file: Omit<RegisteredSpreadsheet, "id">, existingId?: string): RegisteredSpreadsheet {
  const type = state.types.find(entry => entry.id === file.typeId);
  if (!type) throw new Error("SPREADSHEET_TYPE_NOT_FOUND");
  if (!file.name.trim()) throw new Error("SPREADSHEET_NAME_REQUIRED");
  const errors = spreadsheetMappingErrors(file.sheets);
  if (errors.length) throw new Error(errors.join(" "));
  if (file.sheets.some(sheet => sheet.mapping.some(field => field !== NOT_MAPPED && field !== WORKBOOK_ONLY && !type.fields.includes(field)))) throw new Error("SPREADSHEET_FIELD_NOT_FOUND");
  if (existingId && !state.files.some(entry => entry.id === existingId)) throw new Error("SPREADSHEET_NOT_FOUND");
  const record = { addedAt: state.files.find(entry => entry.id === existingId)?.addedAt ?? new Date().toISOString(), ...structuredClone(file), id: existingId ?? `mock-import-${state.files.length + 1}` };
  publish({ ...state, files: existingId ? state.files.map(entry => entry.id === existingId ? record : entry) : [record, ...state.files] });
  return record;
}
export function addMockSpreadsheetType(name: string, fields: readonly string[]): SpreadsheetType {
  name = name.trim(); fields = fields.map(field => field.trim());
  if (!name) throw new Error("Enter a type name.");
  if (state.types.some(type => normalize(type.name) === normalize(name))) throw new Error("A spreadsheet type with this name already exists.");
  if (!fields.length || fields.some(field => !field)) throw new Error("Name every field before adding this type.");
  if (new Set(fields.map(normalize)).size !== fields.length || fields.some(field => [NOT_MAPPED, WORKBOOK_ONLY].includes(field))) throw new Error("Use a different name for each field.");
  const type = { id: `mock-type-${state.types.length + 1}`, name, fields };
  publish({ ...state, types: [...state.types, type] });
  return type;
}
export function searchMockSpreadsheet(file: RegisteredSpreadsheet, sheetName: string, query: string): readonly Readonly<Record<string, string>>[] {
  const sheet = file.sheets.find(entry => entry.name === sheetName);
  if (!sheet) throw new Error("SPREADSHEET_SHEET_NOT_FOUND");
  const fields = sheet.mapping.filter(field => field !== NOT_MAPPED && field !== WORKBOOK_ONLY);
  const needle = query.trim().toLowerCase();
  return MOCK_ROSTER_ROWS.filter(row => !needle || fields.some(field => (row[field] ?? "").toLowerCase().includes(needle)));
}
export function resetSpreadsheetMocks(): void { localWorkbooks.clear(); publish(initialState()); }

const localWorkbooks = new Map<string, EditableWorkbook>();
export function registeredSpreadsheetWorkbook(file: RegisteredSpreadsheet): EditableWorkbook {
  const local = localWorkbooks.get(file.id);
  if (local) return { ...structuredClone(local), libraryId: file.id };
  return { name: file.name, libraryId: file.id, hasFormulas: false, themes: [], sheets: file.sheets.map((sheet, index) => {
    const fields = sheet.mapping.flatMap((field, column) => field === NOT_MAPPED || field === WORKBOOK_ONLY ? [] : [{ field, title: sheet.columns[column] }]);
    if (!fields.length) throw new Error("SPREADSHEET_NO_VISIBLE_COLUMNS");
    return { id: `sheet-${index + 1}`, name: sheet.name, width: fields.length, hidden: [], rows: [
      { id: "header", cells: fields.map(({ title }) => ({ value: title })) },
      ...MOCK_ROSTER_ROWS.map((row, number) => ({ id: `row-${number + 1}`, cells: fields.map(({ field }) => ({ value: row[field] ?? "" })) })),
    ] };
  }) };
}
export function registerLocalSpreadsheet(document: EditableWorkbook): RegisteredSpreadsheet {
  const file: RegisteredSpreadsheet = { id: crypto.randomUUID(), name: document.name, typeId: "local", addedAt: new Date().toISOString(),
    sheets: document.sheets.map(sheet => ({ name: sheet.name, headerRow: 1, columns: sheet.rows[0].cells.map(cellText), mapping: sheet.rows[0].cells.map(cell => cellText(cell) || NOT_MAPPED) })) };
  localWorkbooks.set(file.id, { ...structuredClone(document), libraryId: file.id });
  publish({ ...state, files: [file, ...state.files] });
  return file;
}
export function retainSpreadsheetCopy(id: string, document: EditableWorkbook): void {
  if (!state.files.some(file => file.id === id)) throw new Error("SPREADSHEET_NOT_FOUND");
  localWorkbooks.set(id, structuredClone(document));
}
