import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { manualClock } from "../../../src/domain/clock.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../src/domain/ids.js";
import { CrossDateSearchPageSchema } from "../../../src/domain/dashboard/search.js";
import { createContentAddressedArtifactWriter } from "../../../src/infra/artifacts/content-addressed-artifact-writer.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { createOperatorXlsxExportService } from "../../../src/server/dashboard/exports/operator-xlsx-export-service.js";
import { createCrossDateSearchService } from "../../../src/server/dashboard/queries/search.js";
import { insertMeasuredSearchRun } from "./helpers/cross-date-search-harness.js";

const EXPORT_ID = "00020002-0002-4002-8002-000200020002";
const RUN_ID = "00010001-0001-4001-8001-000100010001";
const SECOND_RUN_ID = "00010001-0001-4001-8001-000100010002";

function searchPage() {
  return CrossDateSearchPageSchema.parse({
    wireVersion: 1,
    generatedAt: "2026-08-28T16:00:00.000Z",
    snapshot: {
      authorityGeneration: 19,
      order: "match-strength/enqueued-desc/run-id-asc:v1",
      token: "test-snapshot-token",
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

function searchResult(runId: string, enqueuedAt: string) {
  const page = searchPage();
  const result = page.results[0];
  if (result === undefined) throw new Error("search fixture omitted its one result");
  return {
    ...result,
    runId,
    traceId: `sp-${enqueuedAt.slice(11, 19).replaceAll(":", "")}-${runId.slice(-4)}`,
    enqueuedAt,
  };
}

function selectedSearchRequest(token = "test-snapshot-token") {
  return {
    selection: {
      kind: "search" as const,
      query: {
        q: "separations",
        scope: "workflow" as const,
        facets: { day: "2026-08-28", dryRun: true as const },
        limit: 20,
      },
      snapshot: {
        authorityGeneration: 19,
        order: "match-strength/enqueued-desc/run-id-asc:v1" as const,
        token,
      },
    },
  };
}

function pageWith(input: Readonly<{
  totalMatches: number;
  results: readonly ReturnType<typeof searchResult>[];
  nextCursor: { readonly state: "present"; readonly value: string }
    | { readonly state: "absent"; readonly reason: string };
  authorityGeneration?: number;
}>) {
  const base = searchPage();
  return CrossDateSearchPageSchema.parse({
    ...base,
    snapshot: {
      ...base.snapshot,
      authorityGeneration: input.authorityGeneration ?? base.snapshot.authorityGeneration,
    },
    totalMatches: input.totalMatches,
    results: input.results,
    nextCursor: input.nextCursor,
  });
}

function evidenceCount(path: string): number {
  const raw = new DatabaseSync(path);
  try {
    const row = raw.prepare("SELECT count(*) AS count FROM operator_xlsx_exports").get();
    return Number(row?.count);
  } finally {
    raw.close();
  }
}

function exportHarness(label: string) {
  const root = mkdtempSync(join(tmpdir(), `hrauto-operator-xlsx-${label}-`));
  const path = join(root, "authority.db");
  const clock = manualClock(new Date("2026-08-28T16:00:00.000Z"));
  const database = AuthorityDatabase.open({
    path,
    busyTimeoutMs: 1_000,
    migrationOwner: `operator-xlsx-${label}-test`,
  }, clock);
  return {
    root,
    path,
    clock,
    database,
    artifacts: createContentAddressedArtifactWriter({
      workspaceRoot: root,
      artifactRoot: ".tracker-rebuild/artifacts",
    }),
    close: () => {
      database.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function fakeSearchExportService(
  harness: ReturnType<typeof exportHarness>,
  pages: Readonly<{
    first: ReturnType<typeof searchPage>;
    continuations?: Readonly<Record<string, ReturnType<typeof searchPage>>>;
  }>,
) {
  return createOperatorXlsxExportService({
    clock: harness.clock,
    ids: { uuid: () => EXPORT_ID },
    artifacts: harness.artifacts,
    sourceIdentity: harness.database.getSourceDatabaseIdentity(),
    authority: harness.database.authority.operatorXlsxExports,
    search: {
      searchSelected: () => pages.first,
      search: (input) => {
        const cursor = (input as { readonly cursor?: string }).cursor;
        const page = cursor === undefined ? undefined : pages.continuations?.[cursor];
        if (page === undefined) throw new Error(`test search has no page for cursor ${String(cursor)}`);
        return page;
      },
    },
    activityReport: () => {
      throw new Error("activity must not be read for a search export");
    },
  });
}

function realSearchService(harness: ReturnType<typeof exportHarness>, signingByte: number) {
  return createCrossDateSearchService({
    clock: harness.clock,
    sourceIdentity: harness.database.getSourceDatabaseIdentity(),
    cursorSigningKey: new Uint8Array(32).fill(signingByte),
    descriptors: {
      resolve: (workflowId) => workflowId === "separations"
        ? { id: "separations", label: "Separations", code: "sp", category: "separation" }
        : undefined,
    },
    authority: {
      readSnapshot: (read) => harness.database.withAuthorityReadSnapshot(() => read({
        authorityGeneration: harness.database.getMeta().authorityGeneration,
        searchRuns: (input) => harness.database.authority.runs.search(input),
      })),
    },
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
        search: {
          search: () => searchPage(),
          searchSelected: () => searchPage(),
        },
        activityReport: () => {
          throw new Error("activity must not be read for a search export");
        },
      });

      const download = await service.export(LOCAL_OPERATOR_ACTOR_ID, {
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
            token: "test-snapshot-token",
          },
        },
      });

      const persisted = database.authority.operatorXlsxExports.get(EXPORT_ID);
      assert.deepEqual(persisted, download.evidence);
      assert.equal(download.evidence.workbookVersion, 2);
      assert.equal(download.evidence.requestedBy, LOCAL_OPERATOR_ACTOR_ID);
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
        assert.throws(
          () => raw.exec(
            `INSERT OR REPLACE INTO operator_xlsx_exports
             SELECT * FROM operator_xlsx_exports WHERE record_key = '${EXPORT_ID}'`,
          ),
          /operator XLSX export evidence insert conflicts with immutable evidence/,
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
        search: {
          search: () => searchPage(),
          searchSelected: () => searchPage(),
        },
        activityReport: () => {
          throw new Error("activity must not be read for a search export");
        },
      });

      await assert.rejects(
        service.export(LOCAL_OPERATOR_ACTOR_ID, {
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
              token: "test-snapshot-token",
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

  it("walks every continuation of one exact selected snapshot before persisting", async () => {
    const h = exportHarness("multi-page");
    try {
      const first = pageWith({
        totalMatches: 2,
        results: [searchResult(RUN_ID, "2026-08-28T15:00:00.000Z")],
        nextCursor: { state: "present", value: "cursor-a" },
      });
      const second = pageWith({
        totalMatches: 2,
        results: [searchResult(SECOND_RUN_ID, "2026-08-28T14:00:00.000Z")],
        nextCursor: { state: "absent", reason: "the snapshot has no later matching run" },
      });

      const download = await fakeSearchExportService(h, {
        first,
        continuations: { "cursor-a": second },
      }).export(LOCAL_OPERATOR_ACTOR_ID, selectedSearchRequest());

      assert.equal(download.evidence.workbook.rowCount, 2);
      assert.equal(h.database.authority.operatorXlsxExports.get(EXPORT_ID)?.selection.kind, "search");
      assert.equal(evidenceCount(h.path), 1);
    } finally {
      h.close();
    }
  });

  it("refuses a repeated continuation without leaving export evidence", async () => {
    const h = exportHarness("repeated-cursor");
    try {
      const first = pageWith({
        totalMatches: 2,
        results: [searchResult(RUN_ID, "2026-08-28T15:00:00.000Z")],
        nextCursor: { state: "present", value: "cursor-a" },
      });
      const repeated = pageWith({
        totalMatches: 2,
        results: [searchResult(SECOND_RUN_ID, "2026-08-28T14:00:00.000Z")],
        nextCursor: { state: "present", value: "cursor-a" },
      });
      await assert.rejects(
        fakeSearchExportService(h, {
          first,
          continuations: { "cursor-a": repeated },
        }).export(LOCAL_OPERATOR_ACTOR_ID, selectedSearchRequest()),
        /repeated a continuation cursor/,
      );
      assert.equal(evidenceCount(h.path), 0);
    } finally {
      h.close();
    }
  });

  it("refuses a moved continuation snapshot without leaving export evidence", async () => {
    const h = exportHarness("moved-continuation");
    try {
      const first = pageWith({
        totalMatches: 2,
        results: [searchResult(RUN_ID, "2026-08-28T15:00:00.000Z")],
        nextCursor: { state: "present", value: "cursor-a" },
      });
      const moved = pageWith({
        totalMatches: 2,
        results: [searchResult(SECOND_RUN_ID, "2026-08-28T14:00:00.000Z")],
        nextCursor: { state: "absent", reason: "the snapshot has no later matching run" },
        authorityGeneration: 20,
      });
      await assert.rejects(
        fakeSearchExportService(h, {
          first,
          continuations: { "cursor-a": moved },
        }).export(LOCAL_OPERATOR_ACTOR_ID, selectedSearchRequest()),
        /selection names authority generation 19, but the export read generation 20/,
      );
      assert.equal(evidenceCount(h.path), 0);
    } finally {
      h.close();
    }
  });

  it("refuses incomplete continuation coverage without leaving export evidence", async () => {
    const h = exportHarness("incomplete-pages");
    try {
      const first = pageWith({
        totalMatches: 3,
        results: [searchResult(RUN_ID, "2026-08-28T15:00:00.000Z")],
        nextCursor: { state: "present", value: "cursor-a" },
      });
      const incomplete = pageWith({
        totalMatches: 3,
        results: [searchResult(SECOND_RUN_ID, "2026-08-28T14:00:00.000Z")],
        nextCursor: { state: "absent", reason: "the snapshot has no later matching run" },
      });
      await assert.rejects(
        fakeSearchExportService(h, {
          first,
          continuations: { "cursor-a": incomplete },
        }).export(LOCAL_OPERATOR_ACTOR_ID, selectedSearchRequest()),
        /pages contain 2 runs but the snapshot totals 3/,
      );
      assert.equal(evidenceCount(h.path), 0);
    } finally {
      h.close();
    }
  });

  it("refuses a selected token after the search signer restarts without leaving evidence", async () => {
    const h = exportHarness("foreign-signer");
    try {
      insertMeasuredSearchRun(h.database, { seed: 91, enqueuedAt: "2026-08-28T15:00:00.000Z" });
      const selectedBy = realSearchService(h, 0x41);
      const restarted = realSearchService(h, 0x42);
      const request = selectedSearchRequest();
      const selected = selectedBy.search(request.selection.query);
      const service = createOperatorXlsxExportService({
        clock: h.clock,
        ids: { uuid: () => { throw new Error("a refused signer must not mint export evidence"); } },
        artifacts: h.artifacts,
        sourceIdentity: h.database.getSourceDatabaseIdentity(),
        authority: h.database.authority.operatorXlsxExports,
        search: restarted,
        activityReport: () => {
          throw new Error("activity must not be read for a search export");
        },
      });

      await assert.rejects(
        service.export(LOCAL_OPERATOR_ACTOR_ID, {
          selection: {
            ...request.selection,
            snapshot: {
              ...request.selection.snapshot,
              authorityGeneration: selected.snapshot.authorityGeneration,
              order: selected.snapshot.order,
              token: selected.snapshot.token,
            },
          },
        }),
        /snapshot token signature belongs to a different BFF process or was modified/,
      );
      assert.equal(evidenceCount(h.path), 0);
    } finally {
      h.close();
    }
  });
});
