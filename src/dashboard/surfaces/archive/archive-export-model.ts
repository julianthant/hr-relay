import { SavedArchiveReportWireSchema, type SavedArchiveQuery, type SavedArchiveReportWire } from "../../../domain/dashboard/archive.js";
import { ARCHIVE_CSV_HEADER, ArchiveExportFormatSchema, archiveCsvFields, archiveCsvRows, type ArchiveExportFormat } from "../../../domain/dashboard/archive-export.js";

export type ArchiveExportRead = (query: SavedArchiveQuery, signal?: AbortSignal) => Promise<{
  items: SavedArchiveReportWire[];
  next: NonNullable<SavedArchiveQuery["after"]> | null;
}>;

export function archiveExportBlob(records: readonly SavedArchiveReportWire[], format: ArchiveExportFormat): Blob {
  const acceptedFormat = ArchiveExportFormatSchema.parse(format);
  const content = acceptedFormat === "json"
    ? archiveJson(records)
    : archiveCsvFields(records);
  const blob = acceptedFormat === "json"
    ? new Blob([content], { type: "application/json" })
    : new Blob([content], { type: "text/csv;charset=utf-8" });
  assertArchiveExportSize(blob.size);
  return blob;
}

const MAX_ARCHIVE_EXPORT_BYTES = 50_000_000;
const MAX_ARCHIVE_EXPORT_REPORTS = 5_000;
const ARCHIVE_EXPORT_PAGE_SIZE = 100;

function archiveJson(records: readonly SavedArchiveReportWire[]): string {
  const reports = SavedArchiveReportWireSchema.array().parse(records);
  const [single] = reports;
  const payload = reports.length === 1 && single !== undefined ? single : reports;
  const json = JSON.stringify(payload, null, 2);
  if (json === undefined) throw new Error("Archive report JSON serialization failed.");
  return json;
}

export function assertArchiveExportSize(bytes: number): void {
  if (bytes > MAX_ARCHIVE_EXPORT_BYTES) throw new Error("Archive export exceeds 50 MB. Narrow the search and export each selection.");
}

export async function readWorkflowExport(read: ArchiveExportRead, query: Omit<SavedArchiveQuery, "limit" | "after">,
  signal: AbortSignal, format: ArchiveExportFormat, onProgress: (count: number) => void,
  isCurrent: () => boolean = () => true): Promise<SavedArchiveReportWire[]> {
  if (query.workflow === undefined) throw new Error("Archive workflow export needs a workflow identity.");
  const acceptedFormat = ArchiveExportFormatSchema.parse(format);
  const records: SavedArchiveReportWire[] = [];
  const seenRunIds = new Set<string>();
  const seenCursors = new Set<string>();
  const encoder = new TextEncoder();
  let jsonReportBytes = 0;
  let jsonLineCount = 0;
  let csvBytes = encoder.encode(ARCHIVE_CSV_HEADER).byteLength;
  let selectedBytes: number;
  let after: SavedArchiveQuery["after"];
  do {
    assertExportCurrent(signal, isCurrent);
    const page = await read({ ...query, limit: ARCHIVE_EXPORT_PAGE_SIZE, ...(after === undefined ? {} : { after }) }, signal);
    assertExportCurrent(signal, isCurrent);
    if (page.items.length > ARCHIVE_EXPORT_PAGE_SIZE) throw new Error("Archive export page exceeded its requested size.");
    if (after !== undefined && page.items.length === 0) throw new Error("Archive export stopped before paging completed. Start the export again.");
    let lastRecordCursor = after;
    for (const input of page.items) {
      const record = SavedArchiveReportWireSchema.parse(input);
      const recordCursor = { completedAt: record.completedAt, runId: record.runId };
      if (lastRecordCursor !== undefined && compareArchiveCursors(recordCursor, lastRecordCursor) <= 0) {
        throw new Error("Archive export cursor did not advance. Narrow the search and try again.");
      }
      lastRecordCursor = recordCursor;
      if (record.workflow !== query.workflow || seenRunIds.has(record.runId)) throw new Error("Archive export membership changed during paging.");
      if (query.dashboardVersion !== undefined && !sameRuntimeVersion(record.runtimeVersion?.dashboard, query.dashboardVersion)) {
        throw new Error("Archive export dashboard version mismatch. Return to the workflow selection and try again.");
      }
      if (query.workflowVersion !== undefined && !sameRuntimeVersion(record.runtimeVersion?.workflow, query.workflowVersion)) {
        throw new Error("Archive export workflow version mismatch. Return to the workflow selection and try again.");
      }
      if (query.versionState !== undefined && (query.versionState === "unrecorded"
        ? record.runtimeVersion !== undefined
        : record.runtimeVersion?.state !== query.versionState)) {
        throw new Error("Archive export version state mismatch. Return to the workflow selection and try again.");
      }
      const nextCount = records.length + 1;
      if (nextCount > MAX_ARCHIVE_EXPORT_REPORTS) {
        throw new Error("Archive export exceeds 5,000 reports. Narrow the search and export each selection.");
      }
      if (acceptedFormat === "json") {
        const json = JSON.stringify(record, null, 2);
        if (json === undefined) throw new Error("Archive report JSON serialization failed.");
        jsonReportBytes += encoder.encode(json).byteLength;
        jsonLineCount += countLines(json);
        selectedBytes = nextCount === 1
          ? jsonReportBytes
          : jsonReportBytes + (2 * jsonLineCount) + (2 * nextCount) + 2;
      } else {
        csvBytes += encoder.encode(archiveCsvRows([record])).byteLength;
        selectedBytes = csvBytes;
      }
      if (selectedBytes > MAX_ARCHIVE_EXPORT_BYTES) {
        throw new Error("Archive export exceeds 50 MB. Narrow the search and export each selection.");
      }
      seenRunIds.add(record.runId);
      records.push(record);
    }
    onProgress(records.length);
    if (page.next !== null) {
      const lastRecord = records.at(-1);
      if (lastRecord === undefined) throw new Error("Archive export cursor did not advance. Narrow the search and try again.");
      const nextCursorKey = archiveCursorKey(page.next);
      const lastRecordKey = archiveCursorKey({ completedAt: lastRecord.completedAt, runId: lastRecord.runId });
      if (seenCursors.has(nextCursorKey)) throw new Error("Archive export cursor repeated during paging. Narrow the search and try again.");
      if (nextCursorKey !== lastRecordKey || (after !== undefined && compareArchiveCursors(page.next, after) <= 0)) {
        throw new Error("Archive export cursor did not advance from the last report. Narrow the search and try again.");
      }
      seenCursors.add(nextCursorKey);
    }
    after = page.next ?? undefined;
  } while (after !== undefined);
  assertExportCurrent(signal, isCurrent);
  return records;
}

function assertExportCurrent(signal: AbortSignal, isCurrent: () => boolean): void {
  signal.throwIfAborted();
  if (!isCurrent()) throw new Error("Archive export selection changed. Start the export again.");
  signal.throwIfAborted();
}

function compareArchiveCursors(left: NonNullable<SavedArchiveQuery["after"]>, right: NonNullable<SavedArchiveQuery["after"]>): number {
  if (left.completedAt !== right.completedAt) return left.completedAt < right.completedAt ? -1 : 1;
  if (left.runId === right.runId) return 0;
  return left.runId < right.runId ? -1 : 1;
}

function archiveCursorKey(cursor: NonNullable<SavedArchiveQuery["after"]>): string {
  return JSON.stringify([cursor.completedAt, cursor.runId]);
}

function sameRuntimeVersion(left: { major: number; minor: number } | undefined, right: { major: number; minor: number }): boolean {
  return left?.major === right.major && left.minor === right.minor;
}

function countLines(value: string): number {
  let count = 1;
  for (let index = value.indexOf("\n"); index !== -1; index = value.indexOf("\n", index + 1)) count += 1;
  return count;
}
