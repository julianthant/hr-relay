import { z } from "zod";
import { SavedArchiveReportWireSchema, type SavedArchiveReportWire } from "./archive.js";

export const ArchiveExportFormatSchema = z.enum(["json", "csv"]);
export type ArchiveExportFormat = z.infer<typeof ArchiveExportFormatSchema>;

export const ARCHIVE_CSV_HEADER = '"runId","fieldPath","type","value"\r\n';

export function archiveObjectFieldPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key)
    ? (path === "" ? key : `${path}.${key}`)
    : `${path}[${JSON.stringify(key)}]`;
}

const ArchiveFieldRowSchema = z.tuple([z.string(), z.string(), z.string(), z.string()]);

export function archiveFieldRows(records: readonly SavedArchiveReportWire[]) {
  const reports = SavedArchiveReportWireSchema.array().parse(records);
  const rows: z.infer<typeof ArchiveFieldRowSchema>[] = [];
  const addRow = (runId: string, path: string, type: string, value: string): void => {
    rows.push(ArchiveFieldRowSchema.parse([runId, path, type, value]));
  };
  const visit = (runId: string, path: string, value: unknown): void => {
    if (value === null) { addRow(runId, path, "null", "null"); return; }
    if (Array.isArray(value)) {
      const items: readonly unknown[] = value;
      if (items.length === 0) addRow(runId, path, "array", "[]");
      else items.forEach((item, index) => visit(runId, `${path}[${index}]`, item));
      return;
    }
    if (typeof value === "object") {
      const entries: readonly [string, unknown][] = Object.entries(value);
      if (entries.length === 0) addRow(runId, path, "object", "{}");
      else entries.forEach(([key, item]) => visit(runId, archiveObjectFieldPath(path, key), item));
      return;
    }
    if (typeof value === "string") { addRow(runId, path, "string", value); return; }
    if (typeof value === "number") { addRow(runId, path, "number", String(value)); return; }
    if (typeof value === "boolean") { addRow(runId, path, "boolean", String(value)); return; }
    throw new Error("Archive report contains a non-JSON public value.");
  };
  reports.forEach((record) => visit(record.runId, "", record));
  return rows;
}

function spreadsheetSafeText(value: string): string {
  // eslint-disable-next-line no-control-regex -- Spreadsheet parsers ignore leading controls before formulas.
  return /^[\s\u0000-\u001f]*[=+@-]/u.test(value) || /^[\t\r\n]/u.test(value) ? `'${value}` : value;
}

function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function archiveCsvRows(records: readonly SavedArchiveReportWire[]): string {
  const rows = archiveFieldRows(records);
  return rows.map((row) => row.map((cell, index) => {
    const value = index === 3 && row[2] === "string" ? spreadsheetSafeText(cell) : cell;
    return quote(value);
  }).join(",")).join("\r\n") + (records.length === 0 ? "" : "\r\n");
}

export function archiveCsvFields(records: readonly SavedArchiveReportWire[]): string {
  return ARCHIVE_CSV_HEADER + archiveCsvRows(records);
}
