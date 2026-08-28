import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { manualClock } from "../../../src/domain/clock.js";
import { CrossDateSearchPageSchema } from "../../../src/domain/dashboard/search.js";
import { createContentAddressedArtifactWriter } from "../../../src/infra/artifacts/content-addressed-artifact-writer.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { createOperatorXlsxExportService } from "../../../src/server/dashboard/exports/operator-xlsx-export-service.js";

const EXPORT_ID = "00020002-0002-4002-8002-000200020002";
const RUN_ID = "00010001-0001-4001-8001-000100010001";

function searchPage() {
  return CrossDateSearchPageSchema.parse({
    wireVersion: 1,
    generatedAt: "2026-08-28T16:00:00.000Z",
    snapshot: {
      authorityGeneration: 19,
      order: "match-strength/enqueued-desc/run-id-asc:v1",
    },
    totalMatches: 1,
    results: [{
      runId: RUN_ID,
      traceId: "sp-160000-0001",
      workflowId: "separations",
      registration: {
        state: "registered",
        label: "Separations",
        code: "sp",
        categoryId: "separation",
      },
      partitionDay: "2026-08-28",
      state: "failed",
      shape: "single",
      dryRun: true,
      priority: "interactive",
      systems: ["kuali", "new-kronos", "ucpath"],
      runNumber: { state: "present", value: 7 },
      retryOf: { state: "absent", reason: "this run is not a retry" },
      enqueuedAt: "2026-08-28T15:00:00.000Z",
      endedAt: { state: "present", value: "2026-08-28T15:05:00.000Z" },
      match: { field: "workflow", strength: "exact" },
    }],
    nextCursor: { state: "absent", reason: "the snapshot has no later matching run" },
  });
}

async function bytesOf(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array)) throw new Error("artifact fixture emitted a non-byte chunk");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe("operator XLSX export service", () => {
  it("persists content-addressed bytes and exact attachment evidence before returning", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-operator-xlsx-"));
    const clock = manualClock(new Date("2026-08-28T16:00:00.000Z"));
    const database = AuthorityDatabase.open({
      path: join(root, "authority.db"),
      busyTimeoutMs: 1_000,
      migrationOwner: "operator-xlsx-test",
    }, clock);
    const artifacts = createContentAddressedArtifactWriter({
      workspaceRoot: root,
      artifactRoot: ".tracker-rebuild/artifacts",
    });
    try {
      const service = createOperatorXlsxExportService({
        clock,
        ids: { uuid: () => EXPORT_ID },
        artifacts,
        sourceIdentity: database.getSourceDatabaseIdentity(),
        authority: database.authority.operatorXlsxExports,
        search: { search: () => searchPage() },
        activityReport: () => {
          throw new Error("activity must not be read for a search export");
        },
      });

      const download = await service.export({
        selection: {
          kind: "search",
          query: {
            q: "separations",
            scope: "workflow",
            facets: { day: "2026-08-28", dryRun: true },
            limit: 20,
          },
          snapshot: {
            authorityGeneration: 19,
            order: "match-strength/enqueued-desc/run-id-asc:v1",
          },
        },
      });

      const persisted = database.authority.operatorXlsxExports.get(EXPORT_ID);
      assert.deepEqual(persisted, download.evidence);
      assert.equal(download.filename, "hr-run-search-2026-08-28-g19.xlsx");
      assert.equal(download.mediaType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      assert.equal(download.bytes.byteLength, download.evidence.download.byteLength);
      assert.equal(
        createHash("sha256").update(download.bytes).digest("hex"),
        download.evidence.download.sha256,
      );
      assert.deepEqual(
        await bytesOf(await artifacts.open(download.evidence.artifact)),
        download.bytes,
      );

      const raw = new DatabaseSync(join(root, "authority.db"));
      try {
        assert.throws(
          () => raw.prepare("UPDATE operator_xlsx_exports SET filename = ? WHERE record_key = ?")
            .run("substituted.xlsx", EXPORT_ID),
          /operator XLSX export evidence is immutable/,
        );
        assert.throws(
          () => raw.prepare("DELETE FROM operator_xlsx_exports WHERE record_key = ?").run(EXPORT_ID),
          /operator XLSX export evidence is never deleted/,
        );
      } finally {
        raw.close();
      }
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a search selection from a foreign authority snapshot before composing bytes", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-operator-xlsx-foreign-"));
    const clock = manualClock(new Date("2026-08-28T16:00:00.000Z"));
    const database = AuthorityDatabase.open({
      path: join(root, "authority.db"),
      busyTimeoutMs: 1_000,
      migrationOwner: "operator-xlsx-foreign-test",
    }, clock);
    const artifacts = createContentAddressedArtifactWriter({
      workspaceRoot: root,
      artifactRoot: ".tracker-rebuild/artifacts",
    });
    try {
      const service = createOperatorXlsxExportService({
        clock,
        ids: { uuid: () => { throw new Error("a refused selection must not mint evidence"); } },
        artifacts,
        sourceIdentity: database.getSourceDatabaseIdentity(),
        authority: database.authority.operatorXlsxExports,
        search: { search: () => searchPage() },
        activityReport: () => {
          throw new Error("activity must not be read for a search export");
        },
      });

      await assert.rejects(
        service.export({
          selection: {
            kind: "search",
            query: {
              q: "separations",
              scope: "workflow",
              facets: { day: "2026-08-28", dryRun: true },
              limit: 20,
            },
            snapshot: {
              authorityGeneration: 20,
              order: "match-strength/enqueued-desc/run-id-asc:v1",
            },
          },
        }),
        /selection names authority generation 20, but the export read generation 19/,
      );
      const raw = new DatabaseSync(join(root, "authority.db"));
      try {
        const row = raw.prepare("SELECT count(*) AS count FROM operator_xlsx_exports").get();
        assert.equal(row?.count, 0);
      } finally {
        raw.close();
      }
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
