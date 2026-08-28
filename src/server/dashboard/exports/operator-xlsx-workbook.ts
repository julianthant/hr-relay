import writeXlsxFile, { type Cell, type Sheet } from "write-excel-file/node";
import {
  OPERATOR_XLSX_MEDIA_TYPE,
  OperatorXlsxWorkbookDocumentSchema,
  operatorXlsxActivityCaveats,
  operatorXlsxSearchCaveats,
} from "../../../domain/dashboard/xlsx-export.js";
import { activityErrorRatePercent } from "../../../domain/dashboard/activity.js";
import type {
  OperatorXlsxActivityDocument,
  OperatorXlsxSearchDocument,
} from "../../../domain/dashboard/xlsx-export.js";

export { OPERATOR_XLSX_MEDIA_TYPE } from "../../../domain/dashboard/xlsx-export.js";

export const OPERATOR_XLSX_SEARCH_COLUMNS = Object.freeze([
  "Run number",
  "Workflow",
  "Workflow code",
  "Category",
  "Partition day",
  "State",
  "Shape",
  "Dry run",
  "Priority",
  "Systems",
  "Enqueued at",
  "Ended at",
  "End note",
  "Retry",
  "Match field",
  "Match strength",
] as const);

export const OPERATOR_XLSX_ACTIVITY_SHEETS = Object.freeze([
  "Read Me",
  "Summary",
  "By Day",
  "By Workflow",
  "By Category",
  "By Status",
  "By Outcome",
  "Failures",
  "Ledger",
] as const);

const HEADER_STYLE = Object.freeze({
  fontWeight: "bold" as const,
  textColor: "#FFFFFF",
  backgroundColor: "#1F4E78",
  alignVertical: "center" as const,
  height: 24,
  wrap: true,
  bottomBorderStyle: "thin" as const,
  bottomBorderColor: "#B4C7E7",
});

const LABEL_STYLE = Object.freeze({
  fontWeight: "bold" as const,
  textColor: "#1F2937",
  backgroundColor: "#D9EAF7",
  alignVertical: "top" as const,
});

const BODY_STYLE = Object.freeze({
  alignVertical: "top" as const,
  bottomBorderStyle: "thin" as const,
  bottomBorderColor: "#D9E2F3",
});

const ZIP_LOCAL_FILE_HEADER = 0x0403_4b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x0201_4b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x0605_4b50;
const ZIP_FIXED_DOS_TIME = 0;
const ZIP_FIXED_DOS_DATE = 0x0021; // 1980-01-01, the earliest ordinary ZIP date.

/**
 * `write-excel-file` delegates to fflate, whose ZIP headers default to the
 * current wall clock. The workbook XML is deterministic, so pin only that
 * archive metadata after walking the authoritative central directory. This
 * parser deliberately refuses ZIP64/multidisk shapes instead of scanning for
 * signature-like bytes inside compressed worksheet data.
 */
function normalizeXlsxArchiveTimestamps(input: Buffer): Buffer {
  const output = Buffer.from(input);
  const minimumEnd = 22;
  const maximumComment = 65_535;
  let endOffset = -1;
  for (
    let candidate = output.byteLength - minimumEnd;
    candidate >= Math.max(0, output.byteLength - minimumEnd - maximumComment);
    candidate -= 1
  ) {
    if (output.readUInt32LE(candidate) === ZIP_END_OF_CENTRAL_DIRECTORY
      && candidate + minimumEnd + output.readUInt16LE(candidate + 20) === output.byteLength) {
      endOffset = candidate;
      break;
    }
  }
  if (endOffset < 0) throw new Error("operator XLSX writer returned bytes without one ZIP directory end");
  if (output.readUInt16LE(endOffset + 4) !== 0 || output.readUInt16LE(endOffset + 6) !== 0) {
    throw new Error("operator XLSX writer returned an unsupported multidisk ZIP archive");
  }
  const entryCount = output.readUInt16LE(endOffset + 10);
  const directorySize = output.readUInt32LE(endOffset + 12);
  const directoryOffset = output.readUInt32LE(endOffset + 16);
  if (entryCount === 0xffff || directorySize === 0xffff_ffff || directoryOffset === 0xffff_ffff) {
    throw new Error("operator XLSX writer returned an unsupported ZIP64 archive");
  }

  let centralOffset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (centralOffset + 46 > endOffset
      || output.readUInt32LE(centralOffset) !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      throw new Error(`operator XLSX ZIP central entry ${String(index)} is malformed`);
    }
    const nameLength = output.readUInt16LE(centralOffset + 28);
    const extraLength = output.readUInt16LE(centralOffset + 30);
    const commentLength = output.readUInt16LE(centralOffset + 32);
    const localOffset = output.readUInt32LE(centralOffset + 42);
    if (localOffset === 0xffff_ffff
      || localOffset + 30 > directoryOffset
      || output.readUInt32LE(localOffset) !== ZIP_LOCAL_FILE_HEADER) {
      throw new Error(`operator XLSX ZIP local entry ${String(index)} is malformed`);
    }
    output.writeUInt16LE(ZIP_FIXED_DOS_TIME, centralOffset + 12);
    output.writeUInt16LE(ZIP_FIXED_DOS_DATE, centralOffset + 14);
    output.writeUInt16LE(ZIP_FIXED_DOS_TIME, localOffset + 10);
    output.writeUInt16LE(ZIP_FIXED_DOS_DATE, localOffset + 12);
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  if (centralOffset !== directoryOffset + directorySize || centralOffset !== endOffset) {
    throw new Error("operator XLSX ZIP central directory size does not match its entries");
  }
  return output;
}

function cell(value: string | number | boolean | Date | undefined, style = BODY_STYLE): Cell {
  return value === undefined ? null : { value, ...style };
}

function headerRow(columns: readonly string[]): Cell[] {
  return columns.map((value) => ({ value, ...HEADER_STYLE }));
}

function typedDate(value: string, format: string): Cell {
  return { value: new Date(value), type: Date, format, ...BODY_STYLE };
}

function searchReadMeSheet(document: OperatorXlsxSearchDocument): Sheet<Buffer> {
  const metadata: readonly (readonly [string, string | number])[] = [
    ["Workbook", "HR automation run search export"],
    ["Source", "Non-archived run authority"],
    ["Selection", "Cross-date search (query text retained in export evidence, not workbook cells)"],
    ["Snapshot generated at", document.selection.snapshot.generatedAt],
    ["Authority generation", document.selection.snapshot.authorityGeneration],
    ["Authority order", document.selection.snapshot.order],
    ["Rows", document.results.length],
  ];
  return {
    sheet: "Read Me",
    showGridLines: false,
    columns: [{ width: 26 }, { width: 112 }],
    data: [
      [
        { value: "Read this before using the numbers", columnSpan: 2, fontSize: 16, fontWeight: "bold", textColor: "#FFFFFF", backgroundColor: "#17365D", height: 30 },
        null,
      ],
      ...metadata.map(([label, value]) => [
        { value: label, ...LABEL_STYLE },
        { value, ...BODY_STYLE, wrap: true },
      ]),
      [null, null],
      [
        { value: "Caveats", columnSpan: 2, fontWeight: "bold", textColor: "#7F6000", backgroundColor: "#FFF2CC", height: 24 },
        null,
      ],
      ...operatorXlsxSearchCaveats(document).map((caveat) => [
        { value: "Important", ...LABEL_STYLE },
        { value: caveat, ...BODY_STYLE, wrap: true },
      ]),
    ],
  };
}

function runsSheet(document: OperatorXlsxSearchDocument): Sheet<Buffer> {
  return {
    sheet: "Runs",
    showGridLines: false,
    stickyRowsCount: 1,
    columns: [
      { width: 14 }, { width: 20 }, { width: 15 }, { width: 16 },
      { width: 15 }, { width: 16 }, { width: 12 }, { width: 10 },
      { width: 14 }, { width: 32 }, { width: 23 }, { width: 23 },
      { width: 42 }, { width: 34 }, { width: 14 }, { width: 16 },
    ],
    data: [
      headerRow(OPERATOR_XLSX_SEARCH_COLUMNS),
      ...document.results.map((result) => [
        cell(result.runNumber.state === "present" ? result.runNumber.value : result.runNumber.reason),
        cell(result.registration.label),
        cell(result.registration.code),
        cell(result.registration.categoryId),
        typedDate(`${result.partitionDay}T00:00:00.000Z`, "yyyy-mm-dd"),
        cell(result.state),
        cell(result.shape),
        cell(result.dryRun),
        cell(result.priority),
        cell(result.systems.join(", ")),
        typedDate(result.enqueuedAt, "yyyy-mm-dd hh:mm:ss"),
        result.endedAt.state === "present"
          ? typedDate(result.endedAt.value, "yyyy-mm-dd hh:mm:ss")
          : cell(undefined),
        // The served absence reason names the full run id. Preserve the fact,
        // but derive its workbook-safe wording from the already-admitted
        // lifecycle state rather than exporting that identifier-bearing text.
        cell(result.endedAt.state === "absent" ? `Not terminal — ${result.state}` : ""),
        cell(result.retryOf.state === "present" ? "Yes — source identifier retained only in export evidence" : `No — ${result.retryOf.reason}`),
        cell(result.match.field),
        cell(result.match.strength),
      ]),
    ],
  };
}

function activityReadMeSheet(document: OperatorXlsxActivityDocument): Sheet<Buffer> {
  const { report } = document;
  const metadata: readonly (readonly [string, string | number])[] = [
    ["Workbook", "HR automation Activity export"],
    ["Source", "The served Activity report: one run/queue projection plus its explicitly named write-ledger authority"],
    ["Selection", `${report.from} through ${report.to}, inclusive`],
    ["Snapshot generated at", report.generatedAt],
    ["Runs", report.totalRuns],
  ];
  return {
    sheet: "Read Me",
    showGridLines: false,
    columns: [{ width: 26 }, { width: 112 }],
    data: [
      [
        { value: "Read this before using the numbers", columnSpan: 2, fontSize: 16, fontWeight: "bold", textColor: "#FFFFFF", backgroundColor: "#17365D", height: 30 },
        null,
      ],
      ...metadata.map(([label, value]) => [
        { value: label, ...LABEL_STYLE },
        { value, ...BODY_STYLE, wrap: true },
      ]),
      [null, null],
      [
        { value: "Caveats", columnSpan: 2, fontWeight: "bold", textColor: "#7F6000", backgroundColor: "#FFF2CC", height: 24 },
        null,
      ],
      ...operatorXlsxActivityCaveats(document).map((caveat) => [
        { value: "Important", ...LABEL_STYLE },
        { value: caveat, ...BODY_STYLE, wrap: true },
      ]),
    ],
  };
}

function numericCell(value: number | undefined, format = "#,##0"): Cell {
  return value === undefined ? null : { value, type: Number, format, ...BODY_STYLE };
}

function activitySheets(document: OperatorXlsxActivityDocument): readonly Sheet<Buffer>[] {
  const { report } = document;
  const median = report.durations.medianMs;
  const longest = report.durations.longestMs;
  const summary: Sheet<Buffer> = {
    sheet: "Summary",
    showGridLines: false,
    stickyRowsCount: 1,
    columns: [{ width: 30 }, { width: 18 }, { width: 16 }, { width: 72 }],
    data: [
      headerRow(["Metric", "Value", "Unit", "Note"]),
      [cell("Total runs"), numericCell(report.totalRuns), cell("runs"), cell("")],
      [cell("Terminal runs"), numericCell(report.terminalRuns), cell("runs"), cell("")],
      [cell("In-flight runs"), numericCell(report.inFlightRuns), cell("runs"), cell("")],
      [cell("Read back"), numericCell(report.completion.readBack), cell("runs"), cell("")],
      [cell("Warnings"), numericCell(report.completion.warnings), cell("runs"), cell("")],
      [cell("Warnings unread"), numericCell(report.completion.warningsUnknown), cell("runs"), cell("")],
      [cell("Error rate"), numericCell(activityErrorRatePercent(report) / 100, "0.0%"), cell("terminal runs"), cell("")],
      [cell("Measured durations"), numericCell(report.durations.measuredRuns), cell("runs"), cell("")],
      [cell("Unmeasured durations"), numericCell(report.durations.unmeasuredRuns), cell("runs"), cell("")],
      [cell("Median duration"), numericCell(median.state === "present" ? median.value : undefined), cell("milliseconds"), cell(median.state === "absent" ? median.reason : "")],
      [cell("Longest duration"), numericCell(longest.state === "present" ? longest.value : undefined), cell("milliseconds"), cell(longest.state === "absent" ? longest.reason : "run identifier omitted")],
      [cell("Total duration"), numericCell(report.durations.totalMs), cell("milliseconds"), cell("")],
    ],
  };
  const byDay: Sheet<Buffer> = {
    sheet: "By Day",
    showGridLines: false,
    stickyRowsCount: 1,
    columns: [{ width: 16 }, { width: 14 }],
    data: [
      headerRow(["Day", "Runs"]),
      ...report.days.map((day) => [typedDate(`${day.day}T00:00:00.000Z`, "yyyy-mm-dd"), numericCell(day.runs)]),
    ],
  };
  const byWorkflow: Sheet<Buffer> = {
    sheet: "By Workflow",
    showGridLines: false,
    stickyRowsCount: 1,
    columns: [
      { width: 24 }, { width: 14 }, { width: 18 }, { width: 12 }, { width: 14 },
      { width: 14 }, { width: 16 }, { width: 12 }, { width: 14 }, { width: 12 },
      { width: 12 }, { width: 56 },
    ],
    data: [
      headerRow(["Workflow", "Code", "Category", "Runs", "Read back", "Warnings", "Warnings unread", "Failed", "Cancelled", "Partial", "Open", "Registration note"]),
      ...report.workflows.map((workflow) => [
        cell(workflow.registration.state === "registered" ? workflow.registration.label : "Unavailable"),
        cell(workflow.registration.state === "registered" ? workflow.registration.code : ""),
        cell(workflow.registration.state === "registered" ? workflow.registration.categoryId : ""),
        numericCell(workflow.runs),
        numericCell(workflow.completion.readBack),
        numericCell(workflow.completion.warnings),
        numericCell(workflow.completion.warningsUnknown),
        numericCell(workflow.failed),
        numericCell(workflow.cancelled),
        numericCell(workflow.partial),
        numericCell(workflow.open),
        cell(workflow.registration.state === "unregistered" ? workflow.registration.reason : ""),
      ]),
    ],
  };
  const byCategory: Sheet<Buffer> = {
    sheet: "By Category",
    showGridLines: false,
    stickyRowsCount: 1,
    columns: [{ width: 24 }, { width: 14 }, { width: 64 }],
    data: [
      headerRow(["Category", "Runs", "Registration note"]),
      ...report.categories.map((entry) => [
        cell(entry.category.state === "registered" ? entry.category.categoryId : "Unavailable"),
        numericCell(entry.runs),
        cell(entry.category.state === "unregistered" ? entry.category.reason : ""),
      ]),
    ],
  };
  const byStatus: Sheet<Buffer> = {
    sheet: "By Status",
    showGridLines: false,
    stickyRowsCount: 1,
    columns: [{ width: 24 }, { width: 14 }, { width: 24 }],
    data: [
      headerRow(["Status", "Runs", "Sampled identifiers omitted"]),
      ...report.statuses.map((entry) => [cell(entry.status), numericCell(entry.runs), numericCell(entry.sample.length)]),
    ],
  };
  const byOutcome: Sheet<Buffer> = {
    sheet: "By Outcome",
    showGridLines: false,
    stickyRowsCount: 1,
    columns: [{ width: 24 }, { width: 14 }],
    data: [
      headerRow(["Outcome", "Runs"]),
      ...report.outcomes.map((entry) => [cell(entry.outcome), numericCell(entry.runs)]),
    ],
  };
  const failures: Sheet<Buffer> = {
    sheet: "Failures",
    showGridLines: false,
    stickyRowsCount: 1,
    columns: [{ width: 38 }, { width: 14 }, { width: 14 }, { width: 24 }],
    data: [
      headerRow(["Failure code", "Runs", "Transient", "Sampled identifiers omitted"]),
      ...report.failures.map((entry) => [
        cell(entry.code), numericCell(entry.runs), numericCell(entry.transient), numericCell(entry.sample.length),
      ]),
    ],
  };
  const ledger: Sheet<Buffer> = {
    sheet: "Ledger",
    showGridLines: false,
    stickyRowsCount: 1,
    columns: [{ width: 24 }, { width: 14 }, { width: 16 }, { width: 14 }],
    data: [
      headerRow(["System", "Entries", "Production", "Test"]),
      ...report.ledger.systems.map((entry) => [
        cell(entry.system), numericCell(entry.entries), numericCell(entry.prod), numericCell(entry.test),
      ]),
    ],
  };
  return [activityReadMeSheet(document), summary, byDay, byWorkflow, byCategory, byStatus, byOutcome, failures, ledger];
}

export interface ComposedOperatorXlsxWorkbook {
  readonly mediaType: typeof OPERATOR_XLSX_MEDIA_TYPE;
  readonly sheetNames: readonly string[];
  readonly bytes: Buffer;
}

export async function composeOperatorXlsxWorkbook(input: unknown): Promise<ComposedOperatorXlsxWorkbook> {
  const document = OperatorXlsxWorkbookDocumentSchema.parse(input);
  const sheets = "results" in document
    ? [searchReadMeSheet(document), runsSheet(document)]
    : activitySheets(document);
  const output: unknown = await writeXlsxFile([...sheets]).toBuffer();
  if (!Buffer.isBuffer(output)) throw new Error("operator XLSX writer returned non-Buffer bytes");
  const bytes = normalizeXlsxArchiveTimestamps(output);
  return Object.freeze({
    mediaType: OPERATOR_XLSX_MEDIA_TYPE,
    sheetNames: Object.freeze(sheets.map((sheet) => sheet.sheet ?? "")),
    bytes,
  });
}
