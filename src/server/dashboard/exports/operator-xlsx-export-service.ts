import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import type { ContentAddressedArtifactWriter } from "../../../base/artifacts.js";
import type { Clock } from "../../../domain/clock.js";
import type { IdFactory } from "../../../domain/identifiers.js";
import { FingerprintSchema } from "../../../domain/ids.js";
import {
  OPERATOR_XLSX_MEDIA_TYPE,
  OperatorXlsxExportEvidenceSchema,
  OperatorXlsxExportIdSchema,
  OperatorXlsxExportRequestSchema,
  OperatorXlsxActivityDocumentSchema,
  OperatorXlsxSearchDocumentSchema,
  type OperatorXlsxExportEvidence,
  type OperatorXlsxWorkbookDocument,
} from "../../../domain/dashboard/xlsx-export.js";
import {
  CROSS_DATE_SEARCH_ORDER,
  CrossDateSearchPageSchema,
  CrossDateSearchQuerySchema,
  type CrossDateSearchResult,
} from "../../../domain/dashboard/search.js";
import type { ActivityReportWire } from "../../../domain/dashboard/activity.js";
import type { OperatorXlsxExportRepository } from "../../../infra/sqlite/authority-database.js";
import type { CrossDateSearchQueryService } from "../queries/search.js";
import { composeOperatorXlsxWorkbook } from "./operator-xlsx-workbook.js";

export const OPERATOR_XLSX_MAX_ROWS = 5_000;

export interface OperatorXlsxDownload {
  readonly evidence: OperatorXlsxExportEvidence;
  readonly filename: string;
  readonly mediaType: typeof OPERATOR_XLSX_MEDIA_TYPE;
  readonly contentDisposition: string;
  readonly bytes: Buffer;
}

export interface OperatorXlsxExportService {
  export(input: unknown): Promise<OperatorXlsxDownload>;
}

export interface OperatorXlsxExportServiceDependencies {
  readonly clock: Clock;
  readonly ids: Pick<IdFactory, "uuid">;
  readonly sourceIdentity: string;
  readonly artifacts: ContentAddressedArtifactWriter;
  readonly authority: OperatorXlsxExportRepository;
  readonly search: CrossDateSearchQueryService;
  /** Reserved for the Activity arm; search composition must never read it. */
  readonly activityReport: (from: string, to: string) => ActivityReportWire;
}

async function materialize(stream: Readable, expectedBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array)) throw new Error("operator XLSX artifact emitted a non-byte chunk");
    byteLength += chunk.byteLength;
    if (!Number.isSafeInteger(byteLength) || byteLength > expectedBytes) {
      throw new Error(`operator XLSX artifact exceeded its recorded ${String(expectedBytes)} bytes`);
    }
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.byteLength !== expectedBytes) {
    throw new Error(
      `operator XLSX artifact emitted ${String(bytes.byteLength)} bytes but recorded ${String(expectedBytes)}`,
    );
  }
  return bytes;
}

function assertSnapshot(
  pageInput: unknown,
  expected: Readonly<{ authorityGeneration: number; order: typeof CROSS_DATE_SEARCH_ORDER }>,
) {
  const page = CrossDateSearchPageSchema.parse(pageInput);
  if (page.snapshot.authorityGeneration !== expected.authorityGeneration) {
    throw new Error(
      `operator XLSX search selection names authority generation ${String(expected.authorityGeneration)}, `
      + `but the export read generation ${String(page.snapshot.authorityGeneration)}`,
    );
  }
  return page;
}

function collectSearchDocument(
  deps: OperatorXlsxExportServiceDependencies,
  selection: Extract<ReturnType<typeof OperatorXlsxExportRequestSchema.parse>["selection"], { kind: "search" }>,
) {
  const query = CrossDateSearchQuerySchema.omit({ cursor: true }).parse(selection.query);
  const first = assertSnapshot(deps.search.search(query), selection.snapshot);
  if (first.totalMatches > OPERATOR_XLSX_MAX_ROWS) {
    throw new Error(
      `operator XLSX search selection contains ${String(first.totalMatches)} runs; `
      + `the export limit is ${String(OPERATOR_XLSX_MAX_ROWS)}`,
    );
  }

  const results: CrossDateSearchResult[] = [...first.results];
  const cursors = new Set<string>();
  let page = first;
  while (page.nextCursor.state === "present") {
    if (cursors.has(page.nextCursor.value)) {
      throw new Error("operator XLSX search authority repeated a continuation cursor");
    }
    cursors.add(page.nextCursor.value);
    page = assertSnapshot(
      deps.search.search({ ...query, cursor: page.nextCursor.value }),
      selection.snapshot,
    );
    if (page.totalMatches !== first.totalMatches) {
      throw new Error(
        `operator XLSX search total moved from ${String(first.totalMatches)} to ${String(page.totalMatches)} `
        + "inside one authority selection",
      );
    }
    results.push(...page.results);
    if (results.length > first.totalMatches) {
      throw new Error("operator XLSX search pages exceed the selected snapshot total");
    }
  }
  if (results.length !== first.totalMatches) {
    throw new Error(
      `operator XLSX search pages contain ${String(results.length)} runs but the snapshot totals `
      + String(first.totalMatches),
    );
  }
  return OperatorXlsxSearchDocumentSchema.parse({
    selection: {
      kind: "search",
      query,
      snapshot: {
        generatedAt: first.generatedAt,
        sourceIdentity: FingerprintSchema.parse(deps.sourceIdentity),
        authorityGeneration: first.snapshot.authorityGeneration,
        order: first.snapshot.order,
        totalMatches: first.totalMatches,
      },
    },
    results,
  });
}

function collectActivityDocument(
  deps: OperatorXlsxExportServiceDependencies,
  selection: Extract<ReturnType<typeof OperatorXlsxExportRequestSchema.parse>["selection"], { kind: "activity" }>,
) {
  const report = deps.activityReport(selection.from, selection.to);
  return OperatorXlsxActivityDocumentSchema.parse({
    selection: {
      kind: "activity",
      snapshot: {
        from: report.from,
        to: report.to,
        generatedAt: report.generatedAt,
        sourceIdentity: FingerprintSchema.parse(deps.sourceIdentity),
        totalRuns: report.totalRuns,
      },
    },
    report,
  });
}

function filenameOf(document: OperatorXlsxWorkbookDocument): string {
  return document.selection.kind === "search"
    ? `hr-run-search-${document.selection.snapshot.generatedAt.slice(0, 10)}`
      + `-g${String(document.selection.snapshot.authorityGeneration)}.xlsx`
    : `hr-activity-${document.selection.snapshot.from}_${document.selection.snapshot.to}.xlsx`;
}

function verifyDownload(evidence: OperatorXlsxExportEvidence, bytes: Buffer): void {
  if (bytes.byteLength !== evidence.download.byteLength) {
    throw new Error(`operator XLSX response size disagrees with export ${evidence.exportId}`);
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== evidence.download.sha256) {
    throw new Error(`operator XLSX response digest disagrees with export ${evidence.exportId}`);
  }
  if (evidence.download.mediaType !== OPERATOR_XLSX_MEDIA_TYPE) {
    throw new Error(`operator XLSX response media type disagrees with export ${evidence.exportId}`);
  }
}

export function createOperatorXlsxExportService(
  deps: OperatorXlsxExportServiceDependencies,
): OperatorXlsxExportService {
  const sourceIdentity = FingerprintSchema.parse(deps.sourceIdentity);
  return Object.freeze({
    async export(input: unknown): Promise<OperatorXlsxDownload> {
      const request = OperatorXlsxExportRequestSchema.parse(input);
      const document = request.selection.kind === "search"
        ? collectSearchDocument({ ...deps, sourceIdentity }, request.selection)
        : collectActivityDocument({ ...deps, sourceIdentity }, request.selection);
      const workbook = await composeOperatorXlsxWorkbook(document);
      const artifact = await deps.artifacts.put(workbook.bytes, { mediaType: workbook.mediaType });
      const storedBytes = await materialize(await deps.artifacts.open(artifact), artifact.bytes);
      if (!storedBytes.equals(workbook.bytes)) {
        throw new Error(`content-addressed artifact ${artifact.id} does not contain the composed operator XLSX bytes`);
      }
      const filename = filenameOf(document);
      const contentDisposition = `attachment; filename="${filename}"`;
      const evidence = OperatorXlsxExportEvidenceSchema.parse({
        exportId: OperatorXlsxExportIdSchema.parse(deps.ids.uuid()),
        workbookVersion: 1,
        createdAt: deps.clock.now().toISOString(),
        selection: document.selection,
        workbook: {
          sheetNames: workbook.sheetNames,
          rowCount: "results" in document
            ? document.results.length
            : document.report.totalRuns,
        },
        artifact,
        download: {
          filename,
          mediaType: workbook.mediaType,
          contentDisposition,
          byteLength: storedBytes.byteLength,
          sha256: createHash("sha256").update(storedBytes).digest("hex"),
        },
      });
      const persisted = deps.authority.insert(evidence).record;
      verifyDownload(persisted, storedBytes);
      return Object.freeze({
        evidence: persisted,
        filename: persisted.download.filename,
        mediaType: persisted.download.mediaType,
        contentDisposition: persisted.download.contentDisposition,
        bytes: storedBytes,
      });
    },
  });
}
