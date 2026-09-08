import { sqliteRunReader } from "../../helpers/canonical-run-reader.js";
/** DCA4: the real HTTP boundary over an immutable test archive repository. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, it, vi } from "vitest";
import { manualClock } from "../../../src/domain/clock.js";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import {
  ArchivedRunContentSchema,
  ArchivedRunRecordSchema,
  archivedRunContentDigest,
  type ArchivedRunRecord,
} from "../../../src/domain/archive/model.js";
import type { ArchivedCaptureTile } from "../../../src/domain/archive/sections.js";
import { ArchivedCaptureResourceWireSchema } from "../../../src/domain/dashboard/archive.js";
import { ArtifactRefSchema, type ArtifactRef } from "../../../src/domain/artifacts.js";
import {
  createServerVerifiedArtifactReader,
  VerifiedArtifactSourceMissingError,
  type ServerVerifiedArtifactReader,
  type VerifiedByteLease,
} from "../../../src/infra/artifacts/server-verified-artifact-reader.js";
import { WireErrorSchema } from "../../../src/domain/dashboard/primitives.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import type { AuthorityRepositories } from "../../../src/infra/sqlite/authority-database.js";
import { createDashboardApp, type DashboardAppDeps } from "../../../src/server/dashboard/routes/api.js";
import { startDashboardHttpServer } from "../../../src/server/dashboard/http-server.js";
import { createSoloRequestIdentityCheckpoint } from "../../../src/server/dashboard/request-identity.js";
import {
  ARCHIVED_RUN,
  ARCHIVED_RUN_WITH_SECTIONS,
  VERSION_PLAN_ROW,
  VERSION_BUMP_APPLICATION,
} from "../../fixtures/archive-fixtures.js";
import { personLookupQueuedRun } from "../../helpers/phase1f-executor-harness.js";

const ARTIFACT_ID = "00000000-0000-4000-8000-000000000917";
const FOREIGN_ID = "00000000-0000-4000-8000-000000000919";
const BYTES = new TextEncoder().encode("archived capture bytes");
const BYTE_URL = `/artifacts/v1/archive/${ARCHIVED_RUN_WITH_SECTIONS.runId}/${ARTIFACT_ID}`;
const RESOURCE_URL = `/api/v1/archive/${ARCHIVED_RUN_WITH_SECTIONS.runId}/captures/${ARTIFACT_ID}/resource`;
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

function recordWithTile(
  tile: Partial<Record<keyof ArchivedCaptureTile, unknown>> = {},
): ArchivedRunRecord {
  const { contentDigest: _digest, ...stored } = ARCHIVED_RUN_WITH_SECTIONS;
  assert.ok(stored.sections);
  const content = ArchivedRunContentSchema.parse({
    ...stored,
    sections: {
      ...stored.sections,
      captures: { state: "present", value: [{
        artifactId: ARTIFACT_ID, bundleId: FOREIGN_ID, kind: "screenshot", mediaType: "image/png",
        byteLength: 22, digest: createHash("sha256").update(BYTES).digest("hex"),
        sensitivity: "redacted", capturedAt: "2026-08-20T09:11:00.000Z", origin: "operator-request",
        dimensions: { width: 200, height: 100 },
        step: { state: "absent", reason: "No failure origin" },
        system: { state: "absent", reason: "No failure origin" },
        retention: { kind: "ordinary", purgeAfter: "2020-01-01T00:00:00.000Z" },
        ...tile,
      }] },
    },
  });
  return ArchivedRunRecordSchema.parse({ ...content, contentDigest: archivedRunContentDigest(content) });
}

/**
 * Seal deliberately malformed boundary data without invoking an archive schema.
 * Otherwise the fixture throws before production sees it, or an old digest
 * rejects it for a different reason than the schema restriction under test.
 */
function rawArchiveContentDigest(content: unknown): string {
  return createHash("sha256")
    .update(`hrauto:archived-run:v1\0${canonicalJsonStringify(content)}`)
    .digest("hex");
}

async function readFixtureBytes(
  open: (ref: ArtifactRef) => Promise<Readable>,
  ref: ArtifactRef,
): Promise<Uint8Array> {
  let stream: Readable;
  try {
    stream = await open(ref);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new VerifiedArtifactSourceMissingError({ cause: error });
    }
    throw error;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array)) throw new Error("fixture artifact reader received a non-byte chunk");
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.byteLength !== ref.bytes) throw new Error("fixture artifact reader observed a byte-size mismatch");
  if (createHash("sha256").update(bytes).digest("hex") !== ref.sha256) {
    throw new Error("fixture artifact reader observed a digest mismatch");
  }
  return bytes;
}

function fixtureLease(ref: ArtifactRef, bytes: Uint8Array): VerifiedByteLease {
  let taken = false;
  let disposed = false;
  return Object.freeze({
    ref: Object.freeze(ref),
    async takeBody() {
      if (taken || disposed) throw new Error("fixture lease is not available");
      taken = true;
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.from(bytes));
          controller.close();
        },
      });
    },
    async dispose() {
      disposed = true;
    },
  });
}

function fixtureArtifactReader(open: (ref: ArtifactRef) => Promise<Readable>): ServerVerifiedArtifactReader {
  return Object.freeze({
    async verify(ref: ArtifactRef) {
      await readFixtureBytes(open, ref);
    },
    async prepare(ref: ArtifactRef) {
      return fixtureLease(ref, await readFixtureBytes(open, ref));
    },
  });
}

function fixture(options: {
  record?: ArchivedRunRecord;
  open?: (ref: ArtifactRef) => Promise<Readable>;
  artifactReader?: ServerVerifiedArtifactReader;
  noStore?: boolean;
  retainedInput?: ArchivedRunRecord["input"];
  /** Raw repository fault injection: production, not this fixture, validates the result. */
  lookup?: (requestedId: string) => unknown;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "hrauto-archive-resource-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const clock = manualClock(new Date("2026-08-30T12:00:00.000Z"));
  const database = AuthorityDatabase.open(
    { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "archive-resource-test" },
    clock,
  );
  cleanups.push(() => database.close());
  const record = options.record ?? recordWithTile();
  database.withAuthorityTransaction((repositories) => {
    repositories.runs.enqueue({ ...personLookupQueuedRun({ runId: record.runId }),
      input: options.retainedInput ?? record.input });
    repositories.runs.transition({ runId: record.runId, expectedVersion: 1, now: record.archivedAt,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: record.archivedAt } });
    repositories.versionPlans.insert(VERSION_PLAN_ROW);
    repositories.versionBumpApplications.insert(VERSION_BUMP_APPLICATION);
    repositories.archivedRuns.insert(record);
  });
  const open = vi.fn(options.open ?? (async () => Readable.from([BYTES.subarray(0, 7), BYTES.subarray(7)])));
  const lookup = vi.fn(options.lookup ?? ((id: string) => database.authority.archivedRuns.get(id)));
  const authority = {
    withAuthorityTransaction: <Result>(work: (repositories: AuthorityRepositories) => Result): Result =>
      database.withAuthorityTransaction(() => work({
        archivedRuns: { get: lookup },
        get runs() { throw new Error("forbidden current run lookup"); },
        get diagnosticBundles() { throw new Error("forbidden current attachment lookup"); },
      } as unknown as AuthorityRepositories)),
  };
  // Only dependencies these two routes may use are supplied. The HTTP handlers,
  // query, repository, wire schemas and stream verifier are all production code.
  const app = createDashboardApp({
    requestIdentity: createSoloRequestIdentityCheckpoint({ id: "local-operator", label: "Local operator" }),
    bootstrap: { clock },
    commandJournal: { get: () => undefined },
    protectedCommandAcceptedAt: () => { throw new Error("forbidden credential command lookup"); },
    bulkCommandAcceptances: {
      withTransaction: () => { throw new Error("forbidden bulk command acceptance"); },
    },
    archive: {
      authority,
      reader: sqliteRunReader(database, clock),
      get descriptors() { throw new Error("forbidden current descriptor lookup"); },
    },
    ...(options.noStore ? {} : { diagnosticBundles: {
      artifactReader: options.artifactReader ?? fixtureArtifactReader(open),
      get authority() { throw new Error("forbidden current diagnostic authority lookup"); },
    } }),
  } as unknown as DashboardAppDeps);
  return { app, database, open, lookup, record };
}

function writeStoredArtifact(root: string, ref: ArtifactRef, bytes: Uint8Array): void {
  const artifactRoot = join(root, ".tracker", "artifacts");
  mkdirSync(artifactRoot, { recursive: true });
  writeFileSync(join(artifactRoot, `${ref.sha256}.artifact`), JSON.stringify({
    ref,
    payloadBase64: Buffer.from(bytes).toString("base64"),
  }));
}

async function assertError(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  const error = WireErrorSchema.parse(await response.json());
  assert.equal(error.code, code);
  assert.equal(error.retryable, false);
  assert.equal(response.headers.get("content-disposition"), null);
  assert.equal(response.headers.get("content-range"), null);
  return error;
}

describe("DCA4 exact archived capture routes", () => {
  it("serves exact Archive bytes through the production reader and real node HTTP adapter", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-archive-reader-http-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const ref = ArtifactRefSchema.parse({
      id: ARTIFACT_ID,
      sha256: createHash("sha256").update(BYTES).digest("hex"),
      bytes: BYTES.byteLength,
      mediaType: "image/png",
    });
    writeStoredArtifact(root, ref, BYTES);
    let leaseCloses = 0;
    const leaseClosed = Promise.withResolvers<void>();
    const artifactReader = createServerVerifiedArtifactReader({
      workspaceRoot: root,
      artifactRoot: ".tracker/artifacts",
      observeLeaseClosed: () => {
        leaseCloses += 1;
        leaseClosed.resolve();
      },
    });
    const { app } = fixture({ artifactReader });
    const transferErrors: Error[] = [];
    const server = await startDashboardHttpServer({
      app,
      port: 0,
      onTransferError: (error) => transferErrors.push(error),
    });
    try {
      const response = await fetch(`http://127.0.0.1:${String(server.port)}${BYTE_URL}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/png");
      assert.equal(response.headers.get("content-disposition"), `attachment; filename="archive-${ARTIFACT_ID}"`);
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), BYTES);
      await leaseClosed.promise;
      assert.equal(leaseCloses, 1);
      assert.deepEqual(transferErrors, []);
    } finally {
      await server.close();
    }
  });

  it("cancels the production Archive reader lease when the real HTTP client disconnects", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-archive-reader-cancel-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const bytes = Buffer.alloc(2 * 1024 * 1024, 0x5a);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const ref = ArtifactRefSchema.parse({
      id: ARTIFACT_ID,
      sha256: digest,
      bytes: bytes.byteLength,
      mediaType: "image/png",
    });
    writeStoredArtifact(root, ref, bytes);
    const leaseClosed = Promise.withResolvers<void>();
    const transferReported = Promise.withResolvers<Error>();
    const artifactReader = createServerVerifiedArtifactReader({
      workspaceRoot: root,
      artifactRoot: ".tracker/artifacts",
      observeLeaseClosed: leaseClosed.resolve,
    });
    const { app } = fixture({
      artifactReader,
      record: recordWithTile({ byteLength: bytes.byteLength, digest }),
    });
    const server = await startDashboardHttpServer({
      app,
      port: 0,
      onTransferError: transferReported.resolve,
    });
    const client = request({
      hostname: "127.0.0.1",
      port: server.port,
      method: "GET",
      path: BYTE_URL,
    });
    client.on("error", () => undefined);
    let serverClosed = false;
    try {
      const response = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
        client.once("response", resolve);
        client.once("error", reject);
        client.end();
      });
      response.on("error", () => undefined);
      response.pause();
      response.destroy();
      await leaseClosed.promise;
      const reported = await transferReported.promise;
      assert.match(reported.message, /closed|disconnected/u);
      await assert.rejects(
        () => server.close(),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /closed|disconnected/u);
          return true;
        },
      );
      serverClosed = true;
    } finally {
      client.destroy();
      if (!serverClosed) await server.close();
    }
  });

  it("serves verified resource identity from the repository without current run or index lookups", async () => {
    const { app, database } = fixture();
    assert.deepEqual(database.authority.diagnosticBundles.findByArtifact(ARTIFACT_ID), []);
    const response = await app.request(RESOURCE_URL);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(ArchivedCaptureResourceWireSchema.parse(await response.json()), {
      runId: ARCHIVED_RUN_WITH_SECTIONS.runId, artifactId: ARTIFACT_ID,
      resource: { state: "available", downloadUrl: BYTE_URL },
    });
  });

  for (const mediaType of ["image/png", "image/jpeg", "text/yaml", "application/json"] as const) {
    it(`serves exact ${mediaType} bytes as a safe download`, async () => {
      const { app } = fixture({ record: recordWithTile({ mediaType }) });
      const response = await app.request(BYTE_URL);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), mediaType);
      assert.equal(response.headers.get("content-length"), "22");
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("content-disposition"), `attachment; filename="archive-${ARTIFACT_ID}"`);
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), BYTES);
    });
  }

  for (const url of [RESOURCE_URL, BYTE_URL]) {
    describe(url.startsWith("/api") ? "resource" : "bytes", () => {
      it("refuses an uncomposed artifact capability", async () => {
        const { app, open } = fixture({ noStore: true });
        await assertError(await app.request(url), 409, "SECTION_UNAVAILABLE");
        assert.equal(open.mock.calls.length, 0);
      });

      for (const target of [url.replace(ARTIFACT_ID, FOREIGN_ID), url.replace(ARCHIVED_RUN_WITH_SECTIONS.runId, FOREIGN_ID)]) {
        it(`does not open stored bytes for a foreign exact identity ${target}`, async () => {
          const { app, open } = fixture();
          await assertError(await app.request(target), 404, "TARGET_NOT_FOUND");
          assert.equal(open.mock.calls.length, 0);
        });
      }

      for (const target of [url.replace(ARTIFACT_ID, "not-an-id"), url.replace(ARCHIVED_RUN_WITH_SECTIONS.runId, "..%2Flatest")]) {
        it(`refuses missing capability before parsing malformed input ${target}`, async () => {
          const { app, open, lookup } = fixture({ noStore: true });
          const response = await app.request(target);
          await assertError(response, 409, "SECTION_UNAVAILABLE");
          assert.equal(response.headers.get("cache-control"), "no-store");
          assert.equal(open.mock.calls.length, 0);
          assert.equal(lookup.mock.calls.length, 0);
        });

        it(`rejects malformed exact input ${target} before authority`, async () => {
          const { app, open, lookup } = fixture();
          await assertError(await app.request(target), 400, "SCHEMA_INVALID");
          assert.equal(open.mock.calls.length, 0);
          assert.equal(lookup.mock.calls.length, 0);
        });
      }

      it("refuses generation-one metadata absence", async () => {
        const { app, open } = fixture({ record: ARCHIVED_RUN });
        await assertError(await app.request(url.replace(ARCHIVED_RUN_WITH_SECTIONS.runId, ARCHIVED_RUN.runId)), 404, "TARGET_NOT_FOUND");
        assert.equal(open.mock.calls.length, 0);
      });

      it("refuses a foreign record returned by the repository", async () => {
        const original = recordWithTile();
        const foreign = ArchivedRunRecordSchema.parse(JSON.parse(
          JSON.stringify(original).replaceAll(original.runId, FOREIGN_ID),
        ));
        const { contentDigest: _digest, ...content } = foreign;
        const authenticForeign = { ...content, contentDigest: archivedRunContentDigest(content) };
        const { app, open } = fixture({ lookup: () => authenticForeign });
        const error = await assertError(await app.request(url), 500, "ARCHIVED_CAPTURE_CORRUPT");
        assert.match(error.message, /foreign archived run identity/u);
        assert.equal(open.mock.calls.length, 0);
      });

      it("verifies the archived content digest read through the real repository", async () => {
        const { app, open } = fixture({ record: ArchivedRunRecordSchema.parse({ ...recordWithTile(), contentDigest: "0".repeat(64) }) });
        const error = await assertError(await app.request(url), 500, "ARCHIVED_CAPTURE_CORRUPT");
        assert.match(error.message, /content digest mismatch/u);
        assert.equal(open.mock.calls.length, 0);
      });

      for (const changed of ["raw", "parsed", "both"] as const) {
        it(`rejects changed private ${changed} input before capture byte open`, async () => {
          const original = recordWithTile();
          const corrupt = structuredClone(original);
          if (changed !== "parsed") corrupt.input.raw = { emplId: "10854321" };
          if (changed !== "raw") corrupt.input.parsed.value = {
            emplId: "10854321", keepNonHdh: false, includeCrmDates: false,
          };
          const { contentDigest, ...content } = corrupt;
          assert.equal(archivedRunContentDigest(content), contentDigest);
          const { app, database, open } = fixture({ record: corrupt, retainedInput: original.input });
          const generation = database.getMeta().authorityGeneration;
          const error = await assertError(await app.request(url), 500, "ARCHIVED_CAPTURE_CORRUPT");
          assert.doesNotMatch(error.message, /10854321|10873698/u);
          assert.equal(open.mock.calls.length, 0);
          assert.equal(database.getMeta().authorityGeneration, generation);
        });
      }

      it("does not expose storage paths from authority failures", async () => {
        const { app, open } = fixture({ lookup: () => { throw new Error("read /private/operator/state.sqlite failed"); } });
        const error = await assertError(await app.request(url), 500, "ARCHIVED_CAPTURE_CORRUPT");
        assert.doesNotMatch(error.message, /private|sqlite/u);
        assert.equal(open.mock.calls.length, 0);
      });

      it("classifies a malformed stored row as server corruption, not invalid caller input", async () => {
        const rawRecord = {
          ...recordWithTile(), unexpected: "/private/operator/state.sqlite",
        };
        const { app, open } = fixture({ lookup: () => rawRecord });
        const error = await assertError(await app.request(url), 500, "ARCHIVED_CAPTURE_CORRUPT");
        assert.match(error.message, /archived capture authority could not be verified/u);
        assert.doesNotMatch(error.message, /private|sqlite|unexpected/u);
        assert.equal(open.mock.calls.length, 0);
      });

      it("rejects an active document media type from a malformed repository result before byte open", async () => {
        const { contentDigest: projectedDigest, ...content } = recordWithTile();
        assert.equal(archivedRunContentDigest(content), projectedDigest);
        // Prove the historical raw seal is accepted before changing only MIME.
        const originalDigest = rawArchiveContentDigest(content);
        const valid = fixture({ lookup: () => ({ ...content, contentDigest: originalDigest }) });
        assert.equal((await valid.app.request(url)).status, 200);
        assert.ok(content.sections?.captures.state === "present");
        const tile = content.sections.captures.value[0];
        assert.ok(tile);
        Reflect.set(tile, "mediaType", "text/html");
        const contentDigest = rawArchiveContentDigest(content);
        assert.notEqual(contentDigest, originalDigest);
        const rawRecord = { ...content, contentDigest };
        const { app, open } = fixture({ lookup: () => rawRecord });
        const error = await assertError(await app.request(url), 500, "ARCHIVED_CAPTURE_CORRUPT");
        assert.match(error.message, /archived capture authority could not be verified/u);
        assert.doesNotMatch(error.message, /content digest mismatch|text\/html/u);
        assert.equal(open.mock.calls.length, 0);
      });

    });
  }

  it("reports physical absence without interpreting elapsed retention as a purge", async () => {
    const { app } = fixture({ open: async () => { throw Object.assign(new Error("/private/lost"), { code: "ENOENT" }); } });
    const response = await app.request(RESOURCE_URL);
    assert.equal(response.status, 200);
    assert.deepEqual(ArchivedCaptureResourceWireSchema.parse(await response.json()).resource, {
      state: "missing", reason: "The archived capture's stored bytes are no longer present.",
    });
    for (const headers of [new Headers(), new Headers({ range: "bytes=0-1" })]) {
      await assertError(await app.request(BYTE_URL, { headers }), 500, "ARCHIVED_CAPTURE_BYTES_MISSING");
    }
  });

  for (const [label, open] of [
    ["same-length digest corruption", async () => Readable.from([new TextEncoder().encode("Archived capture bytes")])],
    ["short stream", async () => Readable.from([BYTES.subarray(1)])],
    ["oversized stream", async () => Readable.from([BYTES, new Uint8Array([1])])],
    ["non-byte chunk", async () => Readable.from(["not bytes"])],
    ["read failure", async () => Readable.from((async function* () {
      yield BYTES.subarray(0, 1);
      throw new Error("read /private/capture.bin failed");
    })())],
    ["open failure", async () => { throw new Error("open /private/capture.bin failed"); }],
  ] as const) {
    it(`never serves successful bytes for ${label}, even with unsupported Range`, async () => {
      const { app } = fixture({ open });
      const resourceResponse = await app.request(RESOURCE_URL);
      assert.equal(resourceResponse.status, 200);
      assert.deepEqual(ArchivedCaptureResourceWireSchema.parse(await resourceResponse.json()).resource, {
        state: "error", message: "The archived capture bytes could not be verified.",
      });
      for (const headers of [new Headers(), new Headers({ range: "bytes=0-1" })]) {
        const error = await assertError(await app.request(BYTE_URL, { headers }), 500, "ARCHIVED_CAPTURE_CORRUPT");
        assert.doesNotMatch(error.message, /private|capture.bin/u);
      }
    });
  }

  it("refuses unsupported Range only after draining and verifying the complete object", async () => {
    let drained = false;
    const { app } = fixture({ open: async () => Readable.from((async function* () {
      yield BYTES;
      drained = true;
    })()) });
    const response = await app.request(BYTE_URL, { headers: { range: "bytes=0-1" } });
    assert.equal(drained, true);
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), "bytes */22");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "");
  });

  it("re-verifies a download after the earlier availability check", async () => {
    const { app } = fixture({ open: vi.fn()
      .mockResolvedValueOnce(Readable.from([BYTES]))
      .mockRejectedValueOnce(Object.assign(new Error("lost"), { code: "ENOENT" })) });
    const response = await app.request(RESOURCE_URL);
    assert.equal(ArchivedCaptureResourceWireSchema.parse(await response.json()).resource.state, "available");
    await assertError(await app.request(BYTE_URL), 500, "ARCHIVED_CAPTURE_BYTES_MISSING");
  });
});
