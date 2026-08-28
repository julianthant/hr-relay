import writeXlsxFile, { type Cell, type Sheet } from "write-excel-file/node";
import {
  OPERATOR_XLSX_MEDIA_TYPE,
  OperatorXlsxSearchDocumentSchema,
  operatorXlsxSearchCaveats,
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

function cell(value: string | number | boolean | Date | undefined, style = BODY_STYLE): Cell {
  return value === undefined ? null : { value, ...style };
}

function headerRow(columns: readonly string[]): Cell[] {
  return columns.map((value) => ({ value, ...HEADER_STYLE }));
}

function typedDate(value: string, format: string): Cell {
  return { value: new Date(value), type: Date, format, ...BODY_STYLE };
}

function readMeSheet(document: ReturnType<typeof OperatorXlsxSearchDocumentSchema.parse>): Sheet<Buffer> {
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

function runsSheet(document: ReturnType<typeof OperatorXlsxSearchDocumentSchema.parse>): Sheet<Buffer> {
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
        cell(result.endedAt.state === "absent" ? result.endedAt.reason : ""),
        cell(result.retryOf.state === "present" ? "Yes — source identifier retained only in export evidence" : `No — ${result.retryOf.reason}`),
        cell(result.match.field),
        cell(result.match.strength),
      ]),
    ],
  };
}

export interface ComposedOperatorXlsxWorkbook {
  readonly mediaType: typeof OPERATOR_XLSX_MEDIA_TYPE;
  readonly sheetNames: readonly ["Read Me", "Runs"];
  readonly bytes: Buffer;
}

export async function composeOperatorXlsxWorkbook(input: unknown): Promise<ComposedOperatorXlsxWorkbook> {
  const document = OperatorXlsxSearchDocumentSchema.parse(input);
  const output: unknown = await writeXlsxFile([readMeSheet(document), runsSheet(document)]).toBuffer();
  if (!Buffer.isBuffer(output)) throw new Error("operator XLSX writer returned non-Buffer bytes");
  return Object.freeze({
    mediaType: OPERATOR_XLSX_MEDIA_TYPE,
    sheetNames: Object.freeze(["Read Me", "Runs"] as const),
    bytes: output,
  });
}
