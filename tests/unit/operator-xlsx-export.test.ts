import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  OPERATOR_XLSX_MEDIA_TYPE,
  OperatorXlsxExportEvidenceSchema,
} from "../../src/domain/dashboard/xlsx-export.js";

const HASH = "a".repeat(64);
const EXPORT_ID = "00020002-0002-4002-8002-000200020002";
const ARTIFACT_ID = "00030003-0003-4003-8003-000300030003";

function searchEvidence(): Record<string, unknown> {
  const filename = "hr-run-search-2026-08-28-g19.xlsx";
  return {
    exportId: EXPORT_ID,
    workbookVersion: 1,
    createdAt: "2026-08-28T16:00:00.000Z",
    selection: {
      kind: "search",
      query: {
        q: "separations",
        scope: "workflow",
        facets: { day: "2026-08-28", dryRun: true },
        limit: 20,
      },
      snapshot: {
        generatedAt: "2026-08-28T16:00:00.000Z",
        sourceIdentity: HASH,
        authorityGeneration: 19,
        order: "match-strength/enqueued-desc/run-id-asc:v1",
        totalMatches: 1,
      },
    },
    workbook: { sheetNames: ["Read Me", "Runs"], rowCount: 1 },
    artifact: {
      id: ARTIFACT_ID,
      sha256: HASH,
      bytes: 1_024,
      mediaType: OPERATOR_XLSX_MEDIA_TYPE,
    },
    download: {
      filename,
      mediaType: OPERATOR_XLSX_MEDIA_TYPE,
      contentDisposition: `attachment; filename="${filename}"`,
      byteLength: 1_024,
      sha256: HASH,
    },
  };
}

describe("operator XLSX export evidence", () => {
  it("keeps v1 explicitly unattributed and requires attribution on v2", () => {
    const v1 = searchEvidence();
    assert.deepEqual(OperatorXlsxExportEvidenceSchema.parse(v1), v1);
    assert.throws(() => OperatorXlsxExportEvidenceSchema.parse({
      ...v1,
      requestedBy: "local-operator",
    }));
    assert.throws(() => OperatorXlsxExportEvidenceSchema.parse({
      ...v1,
      workbookVersion: 2,
    }));
    assert.deepEqual(OperatorXlsxExportEvidenceSchema.parse({
      ...v1,
      workbookVersion: 2,
      requestedBy: "local-operator",
    }), {
      ...v1,
      workbookVersion: 2,
      requestedBy: "local-operator",
    });
  });

  it("refuses workbook sheets and filenames from the other selection arm", () => {
    const search = searchEvidence();
    const activity = {
      ...search,
      selection: {
        kind: "activity",
        snapshot: {
          from: "2026-08-01",
          to: "2026-08-28",
          generatedAt: "2026-08-28T16:00:00.000Z",
          sourceIdentity: HASH,
          totalRuns: 1,
        },
      },
    };
    assert.throws(() => OperatorXlsxExportEvidenceSchema.parse(activity));

    const activityFilename = "hr-activity-2026-08-01_2026-08-28.xlsx";
    assert.throws(() => OperatorXlsxExportEvidenceSchema.parse({
      ...search,
      workbook: {
        sheetNames: [
          "Read Me",
          "Summary",
          "By Day",
          "By Workflow",
          "By Category",
          "By Status",
          "By Outcome",
          "Failures",
          "Ledger",
        ],
        rowCount: 1,
      },
      download: {
        ...(search.download as Record<string, unknown>),
        filename: activityFilename,
        contentDisposition: `attachment; filename="${activityFilename}"`,
      },
    }));
  });
});
