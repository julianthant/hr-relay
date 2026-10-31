import { createClonedProfileFixtures } from "../../../support/helpers/admission-fixture.js";
import { afterAll } from "vitest";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { describe,it } from "vitest";
import { exportSearchMetadata } from "../../../../src/backend/runs/exports/search-metadata-export.js";
import { createOperatorXlsxExportService } from "../../../../src/backend/runs/exports/operator-xlsx-export-service.js";
import { createCrossDateSearchService } from "../../../../src/backend/runs/queries/search.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { CrossDateSearchPageSchema } from "../../../../src/models/dashboard/search.js";
import { LOCAL_OPERATOR_ACTOR_ID,PositiveIntSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { insertMeasuredSearchRun } from "../../../support/helpers/backend/cross-date-search-harness.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const EXPORT_ID = "00020002-0002-4002-8002-000200020002";
const RUN_ID = "00010001-0001-4001-8001-000100010001";
const SECOND_RUN_ID = "00010001-0001-4001-8001-000100010002";

function searchPage() {
  return CrossDateSearchPageSchema.parse({
    wireVersion: 1,
    generatedAt: "2026-08-28T16:00:00.000Z",
    snapshot: {
      authorityGeneration: 19,
      order: "match-strength/enqueued-desc/run-id-asc:v2",
      token: "test-snapshot-token",
    },
    totalMatches: 1,
    coverage:{matched:1,subjectUnavailable:1,actorUnavailable:1,candidateLimit:10000},
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
      metadata: { subject:{state:"unavailable",reason:"declaration-unavailable"}, actor:{state:"unavailable",reason:"not-recorded"},version:1,failureCode:null,evidence:{receipt:false,failure:false,diagnostic:false} },
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
    requestVersion:3 as const,
    selection: {
      kind: "search" as const,
      query: {
        q: "separations",
        scope: "workflow" as const,
        facets: { day: "2026-08-28", dryRun: true as const },
        limit: 20,
      },
      snapshot: {
        generatedAt: "2026-08-28T16:00:00.000Z",
        authorityGeneration: 19,
        order: "match-strength/enqueued-desc/run-id-asc:v2" as const,
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
    coverage:{matched:input.totalMatches,subjectUnavailable:input.totalMatches,actorUnavailable:input.totalMatches,candidateLimit:10000},
    results: input.results,
    nextCursor: input.nextCursor,
  });
}

function evidenceCount(path: string): number {
  const raw = new DatabaseSync(path);
  try {
    const row = raw.prepare("SELECT count(*) AS count FROM artifacts WHERE kind='generated' AND export_id IS NOT NULL").get();
    return Number(row?.count);
  } finally {
    raw.close();
  }
}

const profiles = createClonedProfileFixtures();
afterAll(() => profiles.close());

async function exportHarness(label: string) {
  const profile = await profiles.create();
  const root = profile.stateRoot, path = profile.path;
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
      admission: profile.admission,
    }),
    close: async () => {
      database.close();
      await profile.close();
    },
  };
}

function fakeSearchExportService(
  harness: Awaited<ReturnType<typeof exportHarness>>,
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

function realSearchService(harness: Awaited<ReturnType<typeof exportHarness>>, signingByte: number) {
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
  it("exports an elapsed-clock signed selection through XLSX, CSV and diagnostic collectors including continuation", async () => {
    const h = await exportHarness("elapsed-selection"); await h.artifacts.ready;
    try {
      insertMeasuredSearchRun(h.database, { authorityPath: h.path, seed: 93, enqueuedAt: "2026-08-28T15:00:00.000Z" });
      insertMeasuredSearchRun(h.database, { authorityPath: h.path, seed: 94, enqueuedAt: "2026-08-28T14:00:00.000Z" });
      const search = realSearchService(h, 0x41);
      const query = { ...selectedSearchRequest().selection.query, limit: 1 };
      const page = search.search(query);
      assert.equal(page.nextCursor.state, "present");
      const selection = { kind: "search" as const, query, snapshot: { ...page.snapshot, generatedAt: page.generatedAt } };
      const generation = h.database.getMeta().authorityGeneration;
      h.clock.advanceWall(1);
      assert.equal(h.database.getMeta().authorityGeneration, generation);
      for (const format of ["csv", "diagnostic"] as const) {
        const response = exportSearchMetadata({ search, sourceIdentity: h.database.getSourceDatabaseIdentity() }, { selection, format });
        const text = await response.text();
        assert.ok(text.includes(page.generatedAt));
        assert.ok(text.includes(page.results[0]?.runId ?? "missing"));
        assert.ok(text.includes(search.search({ ...query, cursor: page.nextCursor.state === "present" ? page.nextCursor.value : undefined }).results[0]?.runId ?? "missing"));
      }
      const service = createOperatorXlsxExportService({ clock: h.clock, ids: { uuid: () => EXPORT_ID },
        artifacts: h.artifacts, sourceIdentity: h.database.getSourceDatabaseIdentity(),
        authority: h.database.authority.operatorXlsxExports, search,
        activityReport: () => { throw new Error("unexpected activity"); } });
      const result = await service.export(LOCAL_OPERATOR_ACTOR_ID, { requestVersion: 3, selection });
      assert.equal(result.evidence.selection.kind, "search");
      assert.ok(result.bytes.length > 0);
    } finally { await h.close(); }
  });
  it("persists content-addressed bytes and exact attachment evidence before returning", async () => {
    const h = await exportHarness("operator-xlsx");
    const { clock, database, artifacts } = h;
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
        requestVersion:3,
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
            authorityGeneration: 19,
            order: "match-strength/enqueued-desc/run-id-asc:v2",
            token: "test-snapshot-token",
          },
        },
      });

      const persisted = database.authority.operatorXlsxExports.get(EXPORT_ID);
      assert.deepEqual(persisted, download.evidence);
      assert.equal(download.evidence.workbookVersion, 3);
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

      const raw = new DatabaseSync(h.path);
      try {
        assert.throws(
          () => raw.prepare("UPDATE artifacts SET payload_json=json_set(payload_json,'$.exportEvidenceJson',?),version=version+1 WHERE kind='generated' AND export_id = ?")
            .run("substituted.xlsx", EXPORT_ID),
          /generated-artifact-evidence-immutable/,
        );
        assert.throws(
          () => raw.prepare("DELETE FROM artifacts WHERE kind='generated' AND export_id = ?").run(EXPORT_ID),
          /artifact-evidence-retained/,
        );
        assert.throws(
          () => raw.exec(
            `INSERT OR REPLACE INTO artifacts
             SELECT * FROM artifacts WHERE kind='generated' AND export_id = '${EXPORT_ID}'`,
          ),
          /artifact-identity-conflict/,
        );
      } finally {
        raw.close();
      }
    } finally {
      await h.close();
    }
  });

  it("refuses a search selection from a foreign authority snapshot before composing bytes", async () => {
    const h = await exportHarness("operator-xlsx-foreign");
    const { clock, database, artifacts } = h;
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
        requestVersion:3,
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
              authorityGeneration: 20,
              order: "match-strength/enqueued-desc/run-id-asc:v2",
              token: "test-snapshot-token",
            },
          },
        }),
        /selection names authority generation 20, but the export read generation 19/,
      );
      const raw = new DatabaseSync(h.path);
      try {
        const row = raw.prepare("SELECT count(*) AS count FROM artifacts WHERE kind='generated' AND export_id IS NOT NULL").get();
        assert.equal(row?.count, 0);
      } finally {
        raw.close();
      }
    } finally {
      await h.close();
    }
  });

  it("walks every continuation of one exact selected snapshot before persisting", async () => {
    const h = await exportHarness("multi-page");
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
      await h.close();
    }
  });

  it("refuses a repeated continuation without leaving export evidence", async () => {
    const h = await exportHarness("repeated-cursor");
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
      await h.close();
    }
  });

  it("refuses a moved continuation snapshot without leaving export evidence", async () => {
    const h = await exportHarness("moved-continuation");
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
      await h.close();
    }
  });

  it("refuses incomplete continuation coverage without leaving export evidence", async () => {
    const h = await exportHarness("incomplete-pages");
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
      await h.close();
    }
  });

  it("refuses a selected token after the search signer restarts without leaving evidence", async () => {
    const h = await exportHarness("foreign-signer");
    try {
      insertMeasuredSearchRun(h.database, { authorityPath: h.path, seed: 91, enqueuedAt: "2026-08-28T15:00:00.000Z" });
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
        requestVersion:3,
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
      await h.close();
    }
  });
});


describe("G explicit export lifecycle", () => {
  for (const fault of ["put", "readback", "settlement"] as const) it(`retains a failed registration after ${fault}, then replays the same content on the same file`, async () => {
    const h = await exportHarness(`failure-${fault}`);
    await h.artifacts.ready;
    try {
      const repository = h.database.authority.operatorXlsxExports;
      let failing = true;
      const service = createOperatorXlsxExportService({
        clock: h.clock, ids: { uuid: () => EXPORT_ID }, sourceIdentity: h.database.getSourceDatabaseIdentity(),
        artifacts: {
          put: async (bytes, metadata) => {
            const pending = repository.getFile(EXPORT_ID);
            assert.ok(pending);
            assert.equal(pending.exportEvidenceJson, null);
            assert.ok(pending.state === "pending" || pending.state === "failed");
            if (failing && fault === "put") throw new Error("injected-put");
            return h.artifacts.put(bytes, metadata);
          },
          open: async ref => failing && fault === "readback" ? Readable.from([Buffer.alloc(ref.bytes)]) : h.artifacts.open(ref),
        },
        authority: { ...repository, insert: input => {
          if (failing && fault === "settlement") throw new Error("injected-settlement");
          return repository.insert(input);
        } },
        search: { search: () => searchPage(), searchSelected: () => searchPage() },
        activityReport: () => { throw new Error("unexpected activity"); },
      });
      await assert.rejects(service.export(LOCAL_OPERATOR_ACTOR_ID, selectedSearchRequest()), /injected-|does not contain/u);
      const failed = repository.getFile(EXPORT_ID);
      assert.equal(failed?.state, "failed");
      assert.equal(repository.get(EXPORT_ID), undefined);
      assert.equal(evidenceCount(h.path), 1);
      failing = false;
      const download = await service.export(LOCAL_OPERATOR_ACTOR_ID, selectedSearchRequest());
      assert.equal(repository.getFile(EXPORT_ID)?.state, "ready");
      assert.equal(evidenceCount(h.path), 1);
      assert.deepEqual(download.evidence, repository.get(EXPORT_ID));
      assert.deepEqual(download.bytes, await bytesOf(await h.artifacts.open(download.evidence.artifact)));
    } finally { await h.close(); }
  });

  it("refuses a changed settlement receipt instead of returning inconsistent download metadata", async () => {
    const h = await exportHarness("receipt-fault"); await h.artifacts.ready;
    try {
      const repository = h.database.authority.operatorXlsxExports;
      const service = createOperatorXlsxExportService({ clock: h.clock, ids: { uuid: () => EXPORT_ID },
        sourceIdentity: h.database.getSourceDatabaseIdentity(), artifacts: h.artifacts,
        authority: { ...repository, insert: input => {
          const saved = repository.insert(input);
          return { ...saved, record: { ...saved.record, download: { ...saved.record.download, contentDisposition: "changed receipt" } } };
        } },
        search: { search: () => searchPage(), searchSelected: () => searchPage() }, activityReport: () => { throw new Error("unexpected activity"); } });
      await assert.rejects(service.export(LOCAL_OPERATOR_ACTOR_ID, selectedSearchRequest()), /settlement-readback-conflict/u);
      const stored = repository.get(EXPORT_ID); assert.ok(stored);
      assert.equal(stored.download.contentDisposition, 'attachment; filename="hr-run-search-2026-08-28-g19.xlsx"');
      const replay = await fakeSearchExportService(h, { first: searchPage() }).export(LOCAL_OPERATOR_ACTOR_ID, selectedSearchRequest());
      assert.deepEqual(replay.evidence, stored);
    } finally { await h.close(); }
  });

  it("replays immutable evidence and refuses changed request or selected contents", async () => {
    const h = await exportHarness("identified-replay"); await h.artifacts.ready;
    try {
      const service = fakeSearchExportService(h, { first: searchPage() });
      const first = await service.export(LOCAL_OPERATOR_ACTOR_ID, selectedSearchRequest());
      h.clock.advanceWall(1000);
      const replay = await service.export(LOCAL_OPERATOR_ACTOR_ID, selectedSearchRequest());
      assert.deepEqual(replay, first);
      const generation = h.database.getMeta().authorityGeneration;
      await assert.rejects(service.export(LOCAL_OPERATOR_ACTOR_ID, selectedSearchRequest("changed-token")), /registration-divergent/u);
      const altered = searchPage();
      const result = altered.results[0]; assert.ok(result);
      const changed = fakeSearchExportService(h, { first: { ...altered, results: [{ ...result, runNumber: { state: "present", value: PositiveIntSchema.parse(99) } }] } });
      await assert.rejects(changed.export(LOCAL_OPERATOR_ACTOR_ID, selectedSearchRequest()), /content-divergent/u);
      assert.deepEqual(h.database.authority.operatorXlsxExports.get(EXPORT_ID), first.evidence);
      assert.equal(h.database.getMeta().authorityGeneration, generation);
    } finally { await h.close(); }
  });

  it("keeps independent same-byte exports separate and refuses divergent pending byte commitments", async () => {
    const h = await exportHarness("independent"); await h.artifacts.ready;
    try {
      const first = await fakeSearchExportService(h, { first: searchPage() }).export(LOCAL_OPERATOR_ACTOR_ID, selectedSearchRequest());
      const secondId = "00020002-0002-4002-8002-000200020003";
      const repository = h.database.authority.operatorXlsxExports;
      const service = createOperatorXlsxExportService({ clock: h.clock, ids: { uuid: () => secondId },
        sourceIdentity: h.database.getSourceDatabaseIdentity(), artifacts: h.artifacts, authority: repository,
        search: { search: () => searchPage(), searchSelected: () => searchPage() }, activityReport: () => { throw new Error("unexpected activity"); } });
      const second = await service.export(LOCAL_OPERATOR_ACTOR_ID, selectedSearchRequest());
      assert.notEqual(first.evidence.exportId, second.evidence.exportId);
      assert.deepEqual(first.bytes, second.bytes);
      assert.deepEqual(first.evidence.artifact, second.evidence.artifact);
      assert.equal(evidenceCount(h.path), 2);
      const pendingId = "00020002-0002-4002-8002-000200020004";
      const registration = { exportId: pendingId, request: selectedSearchRequest(), requestedBy: LOCAL_OPERATOR_ACTOR_ID,
        requestedAt: h.clock.now().toISOString(), contentSha256: first.evidence.artifact.sha256 };
      repository.register(registration);
      assert.throws(() => repository.register({ ...registration, contentSha256: "a".repeat(64) }), /content-divergent/u);
      assert.throws(() => repository.insert({ ...first.evidence, exportId: pendingId, createdAt: registration.requestedAt,
        selection: { ...first.evidence.selection, query: { ...selectedSearchRequest().selection.query, q: "changed" } } }), /publication-identity-conflict/u);
      assert.equal(repository.getFile(pendingId)?.state, "pending");
    } finally { await h.close(); }
  });
});
