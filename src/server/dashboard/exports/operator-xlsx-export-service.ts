import { ActivityReportSelectionSchema, type ActivityReportSelection } from "../../../domain/dashboard/activity-selection.js";
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import type { ContentAddressedArtifactWriter } from "../../../base/artifacts.js";
import type { Clock } from "../../../domain/clock.js";
import type { IdFactory } from "../../../domain/identifiers.js";
import { ActorIdSchema, FingerprintSchema, type ActorId } from "../../../domain/ids.js";
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
import { ActivityReportWireSchema } from "../../../domain/dashboard/activity.js";
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
  export(requestedBy: ActorId, input: unknown): Promise<OperatorXlsxDownload>;
}

export interface OperatorXlsxExportServiceDependencies {
  readonly clock: Clock;
  readonly ids: Pick<IdFactory, "uuid">;
  readonly sourceIdentity: string;
  readonly artifacts: ContentAddressedArtifactWriter;
  readonly authority: OperatorXlsxExportRepository;
  readonly search: CrossDateSearchQueryService;
  /** Reserved for the Activity arm; search composition must never read it. */
  readonly activityReport: (from: string, to: string, token: string) => ActivityReportSelection;
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
  expected: Readonly<{ generatedAt: string; authorityGeneration: number; order: typeof CROSS_DATE_SEARCH_ORDER }>,
) {
  const page = CrossDateSearchPageSchema.parse(pageInput);
  if (page.generatedAt!==expected.generatedAt)throw new Error("operator-export-generation-time-mismatch");
  if (page.snapshot.authorityGeneration !== expected.authorityGeneration) {
    throw new Error(
      `operator XLSX search selection names authority generation ${String(expected.authorityGeneration)}, `
      + `but the export read generation ${String(page.snapshot.authorityGeneration)}`,
    );
  }
  return page;
}

export function collectSearchDocument(
  deps: Pick<OperatorXlsxExportServiceDependencies, "search" | "sourceIdentity">,
  selection: Extract<ReturnType<typeof OperatorXlsxExportRequestSchema.parse>["selection"], { kind: "search" }>,
) {
  const query = CrossDateSearchQuerySchema.omit({ cursor: true }).parse(selection.query);
  const first = assertSnapshot(
    deps.search.searchSelected(query, selection.snapshot.token),
    selection.snapshot,
  );
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
    if (canonicalJsonStringify(page.coverage)!==canonicalJsonStringify(first.coverage)||page.generatedAt!==first.generatedAt||page.snapshot.token!==first.snapshot.token)throw new Error("operator-export-page-identity-mismatch");
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
        coverage: first.coverage,
      },
    },
    results,
  });
}

function collectActivityDocument(
  deps: OperatorXlsxExportServiceDependencies,
  selection: Extract<ReturnType<typeof OperatorXlsxExportRequestSchema.parse>["selection"], { kind: "activity" }>,
) {
  const selectedReport = ActivityReportSelectionSchema.parse(deps.activityReport(selection.from, selection.to, selection.snapshotToken));
  if(selectedReport.snapshot.token!==selection.snapshotToken)throw new Error("activity-export-selection-identity-mismatch");
  const report = ActivityReportWireSchema.parse(Object.fromEntries(Object.entries(selectedReport).filter(([key])=>key!=="snapshot")));
  return OperatorXlsxActivityDocumentSchema.parse({
    selection: {
      kind: "activity",
      snapshot: {
        from: report.from,
        to: report.to,
        generatedAt: report.generatedAt,
        sourceIdentity: FingerprintSchema.parse(deps.sourceIdentity),
        totalRuns: report.totalRuns,
        authorityGeneration:selectedReport.snapshot.authorityGeneration,
        reportDigest:selectedReport.snapshot.reportDigest,
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
    async export(requestedByInput: ActorId, input: unknown): Promise<OperatorXlsxDownload> {
      const requestedBy = ActorIdSchema.parse(requestedByInput);
      const request = OperatorXlsxExportRequestSchema.parse(input);
      // Capture the entire admitted selection before registration advances authority generation.
      const document = request.selection.kind === "search"
        ? collectSearchDocument({ ...deps, sourceIdentity }, request.selection)
        : collectActivityDocument({ ...deps, sourceIdentity }, request.selection);
      const workbook = await composeOperatorXlsxWorkbook(document);
      const exportId = OperatorXlsxExportIdSchema.parse(deps.ids.uuid());
      const previous = deps.authority.getFile(exportId);
      if (previous !== undefined) {
        if (previous.registration?.requestedBy !== requestedBy
          || canonicalJsonStringify(previous.exportRequest) !== canonicalJsonStringify(request)) {
          throw new Error("generated-export-registration-divergent");
        }
        const completed = deps.authority.get(exportId);
        if (completed !== undefined) {
          if (completed.selection.snapshot.sourceIdentity !== sourceIdentity) throw new Error("generated-export-source-conflict");
          const bytes = await materialize(await deps.artifacts.open(completed.artifact), completed.artifact.bytes);
          verifyDownload(completed, bytes);
          if (!bytes.equals(workbook.bytes) || canonicalJsonStringify(completed.selection) !== canonicalJsonStringify(document.selection)) {
            throw new Error("generated-export-content-divergent");
          }
          return Object.freeze({ evidence: completed, filename: completed.download.filename,
            mediaType: completed.download.mediaType, contentDisposition: completed.download.contentDisposition, bytes });
        }
      }
      const registration = deps.authority.register({ exportId, request, requestedBy,
        requestedAt: previous?.registration?.requestedAt ?? deps.clock.now().toISOString(),
        contentSha256: createHash("sha256").update(workbook.bytes).digest("hex"),
      });
      try {
        const artifact = await deps.artifacts.put(workbook.bytes, { mediaType: workbook.mediaType });
        const storedBytes = await materialize(await deps.artifacts.open(artifact), artifact.bytes);
        if (!storedBytes.equals(workbook.bytes)) {
          throw new Error(`content-addressed artifact ${artifact.id} does not contain the composed operator XLSX bytes`);
        }
        const filename = filenameOf(document);
        const contentDisposition = `attachment; filename="${filename}"`;
        const evidence = OperatorXlsxExportEvidenceSchema.parse({
          exportId,
          workbookVersion: 3,
          requestedBy,
          createdAt: registration.createdAt,
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
        verifyDownload(evidence, storedBytes);
        const persisted = deps.authority.insert(evidence).record;
        if (canonicalJsonStringify(persisted) !== canonicalJsonStringify(evidence)
          || canonicalJsonStringify(deps.authority.get(exportId)) !== canonicalJsonStringify(evidence)) {
          throw new Error("generated-export-settlement-readback-conflict");
        }
        verifyDownload(persisted, storedBytes);
        return Object.freeze({
          evidence: persisted,
          filename: persisted.download.filename,
          mediaType: persisted.download.mediaType,
          contentDisposition: persisted.download.contentDisposition,
          bytes: storedBytes,
        });
      } catch (error) {
        const current = deps.authority.getFile(exportId);
        if (current !== undefined && current.exportEvidenceJson === null) deps.authority.fail(exportId, registration.version);
        throw error;
      }
    },
  });
}
