import { startFailureResolutionServer } from "../../parity/helpers/fixture-failure-resolution.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "vitest";
import { SavedArchiveReportWireSchema, ArchiveIndexWireSchema, ArchivedCaptureResourceWireSchema, ArchivedRunDetailWireSchema } from "../../../src/domain/dashboard/archive.js";
import { archivedRunContentDigest, ArchivedRunRecordSchema } from "../../../src/domain/archive/model.js";
import { WireErrorSchema } from "../../../src/domain/dashboard/primitives.js";
import { FIXTURE_ARCHIVED_RUN, FIXTURE_ARCHIVE_INDEX, FIXTURE_ARCHIVED_RUN_ID } from "../../parity/helpers/fixture-archive.js";
import {
  FIXTURE_ARCHIVE_EVIDENCE_BYTES,
  FIXTURE_ARCHIVE_EVIDENCE_CAPTURE,
  FIXTURE_ARCHIVE_EVIDENCE_RUN,
  FIXTURE_ARCHIVE_EVIDENCE_RECORD,
} from "../../parity/helpers/fixture-archive-evidence.js";
import { createFixtureBff, startFixtureServer, type FixtureServer } from "../../parity/helpers/fixture-bff.js";

async function withArchiveHttp(
  scenario: "evidence" | undefined,
  check: (server: FixtureServer, distDir: string) => Promise<void>,
): Promise<void> {
  const distDir = mkdtempSync(join(tmpdir(), "dca4-archive-http-"));
  try {
    const server = await startFixtureServer({
      distDir,
      bundle: { proof: "unverified", reason: "HTTP route regression; temporary static files are never rendered" },
      ...(scenario === undefined ? {} : { archiveScenario: scenario }),
    });
    try {
      await check(server, distDir);
    } finally {
      await server.close();
    }
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
}

function writeStaticProbe(distDir: string, path: string, body: string): void {
  const target = join(distDir, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
}

async function assertUnknownCapture(response: Response, runId: string, artifactId: string): Promise<void> {
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(WireErrorSchema.parse(await response.json()), {
    state: "error",
    code: "ARCHIVE_CAPTURE_UNKNOWN",
    message: `no frozen fixture capture ${artifactId} for archived run ${runId}`,
    retryable: false,
  });
}

describe("the archive-evidence fixture", () => {
  it("serves the exact resource download over real HTTP from an ephemeral port", async () => {
    await withArchiveHttp("evidence", async (server) => {
      const capture = FIXTURE_ARCHIVE_EVIDENCE_CAPTURE;
      const runId = FIXTURE_ARCHIVE_EVIDENCE_RUN.runId;
      const response = await fetch(`${server.baseUrl}/api/v1/archive/${runId}/captures/${capture.artifactId}/resource`);
      assert.equal(response.status, 200);
      const resource = ArchivedCaptureResourceWireSchema.parse(await response.json());
      assert.equal(resource.runId, runId);
      assert.equal(resource.artifactId, capture.artifactId);
      if (resource.resource.state !== "available") throw new Error("the HTTP fixture did not serve an available resource");
      assert.equal(resource.resource.downloadUrl, `/artifacts/v1/archive/${runId}/${capture.artifactId}`);

      const download = await fetch(`${server.baseUrl}${resource.resource.downloadUrl}`);
      const bytes = new Uint8Array(await download.arrayBuffer());
      assert.deepEqual({
        status: download.status,
        mediaType: download.headers.get("content-type"),
        byteLength: bytes.byteLength,
        digest: createHash("sha256").update(bytes).digest("hex"),
      }, {
        status: 200,
        mediaType: "image/png",
        byteLength: 3281,
        digest: "f3ede4591dd6034661d8d63aef43ce4734610be67edbc7e30ce68834ebcd3847",
      }, `HTTP download body prefix: ${JSON.stringify(new TextDecoder().decode(bytes.subarray(0, 32)))}`);
      assert.deepEqual(bytes, FIXTURE_ARCHIVE_EVIDENCE_BYTES);
      assert.equal(download.headers.get("content-length"), "3281");
      assert.equal(download.headers.get("cache-control"), "no-store");
      assert.equal(download.headers.get("x-content-type-options"), "nosniff");
      assert.equal(download.headers.get("content-disposition"), `attachment; filename="archive-${capture.artifactId}"`);
    });
  });

  it("refuses foreign capture ids over real HTTP without falling through to static bytes", async () => {
    await withArchiveHttp("evidence", async (server, distDir) => {
      const runId = FIXTURE_ARCHIVE_EVIDENCE_RUN.runId;
      const artifactId = FIXTURE_ARCHIVE_EVIDENCE_CAPTURE.artifactId;
      const foreignId = "00000000-0000-4000-8000-000000000999";
      for (const [run, artifact] of [[foreignId, artifactId], [runId, foreignId]]) {
        const path = `/artifacts/v1/archive/${run}/${artifact}`;
        writeStaticProbe(distDir, path, "not this archived capture");
        await assertUnknownCapture(await fetch(`${server.baseUrl}${path}`), run, artifact);
        await assertUnknownCapture(
          await fetch(`${server.baseUrl}/api/v1/archive/${run}/captures/${artifact}/resource`), run, artifact,
        );
      }
    });
  });

  it("keeps the default HTTP archive corpus isolated from evidence and static substitutes", async () => {
    await withArchiveHttp(undefined, async (server, distDir) => {
      const runId = FIXTURE_ARCHIVE_EVIDENCE_RUN.runId;
      const artifactId = FIXTURE_ARCHIVE_EVIDENCE_CAPTURE.artifactId;
      const path = `/artifacts/v1/archive/${runId}/${artifactId}`;
      writeStaticProbe(distDir, path, "evidence scenario was not selected");
      const index = await fetch(`${server.baseUrl}/api/v1/archive`);
      assert.equal(index.status, 200);
      assert.deepEqual(await index.json(), FIXTURE_ARCHIVE_INDEX);
      const detail = await fetch(`${server.baseUrl}/api/v1/archive/${FIXTURE_ARCHIVED_RUN_ID}`);
      assert.equal(detail.status, 200);
      assert.deepEqual(await detail.json(), FIXTURE_ARCHIVED_RUN);
      await assertUnknownCapture(await fetch(`${server.baseUrl}${path}`), runId, artifactId);
      await assertUnknownCapture(
        await fetch(`${server.baseUrl}/api/v1/archive/${runId}/captures/${artifactId}/resource`), runId, artifactId,
      );
    });
  });

  it("preserves ordinary static files and missing-file 404s beside the exact HTTP artifact route", async () => {
    await withArchiveHttp("evidence", async (server, distDir) => {
      const files = [
        ["/index.html", "<!doctype html><title>HTTP probe</title>", "text/html; charset=utf-8"],
        ["/assets/archive.css", "body { color: black; }", "text/css; charset=utf-8"],
        ["/artifacts/logo.svg", "<svg></svg>", "image/svg+xml"],
        ["/artifacts/v1/archive-help.html", "Archive help", "text/html; charset=utf-8"],
        ["/artifacts/v1/archive-notes/readme.json", "{\"static\":true}", "application/json; charset=utf-8"],
        ["/artifacts/v1/archive/run/artifact/details.json", "{\"nestedStatic\":true}", "application/json; charset=utf-8"],
      ];
      for (const [path, body, mediaType] of files) {
        writeStaticProbe(distDir, path, body);
        const response = await fetch(`${server.baseUrl}${path === "/index.html" ? "/" : path}`);
        assert.equal(response.status, 200, path);
        assert.equal(response.headers.get("content-type"), mediaType, path);
        assert.equal(await response.text(), body, path);
      }
      for (const path of ["/missing.js", "/artifacts/missing.png", "/artifacts/v1/archive/one-segment"]) {
        const response = await fetch(`${server.baseUrl}${path}`);
        assert.equal(response.status, 404, path);
        assert.equal(response.headers.get("content-type"), null, path);
        assert.equal(await response.text(), "not found", path);
      }
    });
  });

  it("leaves the broad archive corpus unchanged unless the evidence scenario is selected", async () => {
    const { app } = createFixtureBff();
    assert.deepEqual(await (await app.request(`/api/v1/archive/${FIXTURE_ARCHIVED_RUN_ID}`)).json(), FIXTURE_ARCHIVED_RUN);
    assert.deepEqual(await (await app.request("/api/v1/archive")).json(), FIXTURE_ARCHIVE_INDEX);
    const runId = FIXTURE_ARCHIVE_EVIDENCE_RUN.runId;
    const artifactId = FIXTURE_ARCHIVE_EVIDENCE_CAPTURE.artifactId;
    assert.equal((await app.request(`/api/v1/archive/${runId}/captures/${artifactId}/resource`)).status, 404);
    assert.equal((await app.request(`/artifacts/v1/archive/${runId}/${artifactId}`)).status, 404);
  });

  it("does not reuse the broad corpus fingerprint for a different archived record", async () => {
    const { app } = createFixtureBff({ archiveScenario: "evidence" });
    const response = await app.request(`/api/v1/archive/${FIXTURE_ARCHIVE_EVIDENCE_RUN.runId}`);
    const detail = ArchivedRunDetailWireSchema.parse(await response.json());
    assert.notEqual(detail.archiveFingerprint, FIXTURE_ARCHIVED_RUN.archiveFingerprint);
  });

  it("projects the exact sealed durable record into both the evidence detail and index", async () => {
    const { app } = createFixtureBff({ archiveScenario: "evidence" });
    const record = ArchivedRunRecordSchema.parse(FIXTURE_ARCHIVE_EVIDENCE_RECORD);
    const { contentDigest, ...content } = record;
    assert.equal(archivedRunContentDigest(content), contentDigest);
    const detail = ArchivedRunDetailWireSchema.parse(await (await app.request(`/api/v1/archive/${record.runId}`)).json());
    const index = ArchiveIndexWireSchema.parse(await (await app.request("/api/v1/archive")).json());
    assert.equal(detail.archiveFingerprint, contentDigest);
    assert.deepEqual(detail.row, record.row);
    assert.deepEqual(detail.detail, record.detail);
    assert.deepEqual(detail.evidence, record.evidence);
    assert.deepEqual(detail.sections, { state: "present", value: record.sections });
    assert.equal(index.entries.length, 1);
    assert.equal(index.entries[0].runId, record.runId);
    assert.equal(index.entries[0].archiveFingerprint, contentDigest);
    assert.equal(index.entries[0].applicationId, record.applicationId);
    assert.deepEqual(record.evidence.artifactIds, [FIXTURE_ARCHIVE_EVIDENCE_CAPTURE.artifactId]);
    assert.deepEqual(record.sections?.captures, { state: "present", value: [FIXTURE_ARCHIVE_EVIDENCE_CAPTURE] });
  });

  it("refuses foreign run and artifact ids even inside the evidence scenario", async () => {
    const { app } = createFixtureBff({ archiveScenario: "evidence" });
    const runId = FIXTURE_ARCHIVE_EVIDENCE_RUN.runId;
    const artifactId = FIXTURE_ARCHIVE_EVIDENCE_CAPTURE.artifactId;
    const foreignId = "00000000-0000-4000-8000-000000000999";
    for (const [run, artifact] of [[foreignId, artifactId], [runId, foreignId]]) {
      assert.equal((await app.request(`/api/v1/archive/${run}/captures/${artifact}/resource`)).status, 404);
      assert.equal((await app.request(`/artifacts/v1/archive/${run}/${artifact}`)).status, 404);
    }
  });

  it("serves the exact frozen capture bytes and metadata through its own archive route", async () => {
    const { app } = createFixtureBff({ archiveScenario: "evidence" });
    const runId = FIXTURE_ARCHIVE_EVIDENCE_RUN.runId;
    const resourceResponse = await app.request(
      `http://fixture.test/api/v1/archive/${runId}/captures/${FIXTURE_ARCHIVE_EVIDENCE_CAPTURE.artifactId}/resource`,
    );
    assert.equal(resourceResponse.status, 200);
    const resource = ArchivedCaptureResourceWireSchema.parse(await resourceResponse.json());
    assert.equal(resource.runId, runId);
    assert.equal(resource.artifactId, FIXTURE_ARCHIVE_EVIDENCE_CAPTURE.artifactId);
    if (resource.resource.state !== "available") throw new Error("the archive-evidence fixture did not serve an available resource");

    const bytesResponse = await app.request(`http://fixture.test${resource.resource.downloadUrl}`);
    assert.equal(bytesResponse.status, 200);
    assert.equal(bytesResponse.headers.get("content-type"), FIXTURE_ARCHIVE_EVIDENCE_CAPTURE.mediaType);
    assert.equal(bytesResponse.headers.get("content-length"), String(FIXTURE_ARCHIVE_EVIDENCE_BYTES.byteLength));
    assert.equal(bytesResponse.headers.get("cache-control"), "no-store");
    assert.equal(bytesResponse.headers.get("x-content-type-options"), "nosniff");
    assert.match(bytesResponse.headers.get("content-disposition") ?? "", /^attachment;/u);
    const bytes = new Uint8Array(await bytesResponse.arrayBuffer());
    assert.deepEqual(bytes, FIXTURE_ARCHIVE_EVIDENCE_BYTES);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), FIXTURE_ARCHIVE_EVIDENCE_CAPTURE.digest);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const png = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(png.getUint32(16), 1440);
    assert.equal(png.getUint32(20), 900);
    assert.equal(FIXTURE_ARCHIVE_EVIDENCE_CAPTURE.byteLength, FIXTURE_ARCHIVE_EVIDENCE_BYTES.byteLength);
    assert.equal(FIXTURE_ARCHIVE_EVIDENCE_CAPTURE.dimensions?.width, 1440);
    assert.equal(FIXTURE_ARCHIVE_EVIDENCE_CAPTURE.dimensions?.height, 900);
  });
});

it("routes current native report files to the API and never to static fallback",async()=>{
  const distDir=mkdtempSync(join(tmpdir(),"saved-archive-http-"));
  const runId=FIXTURE_ARCHIVE_EVIDENCE_RUN.runId,digest=FIXTURE_ARCHIVE_EVIDENCE_CAPTURE.digest;
  const path=`/artifacts/v1/archive/${runId}/files/${digest}`;
  try {
    writeStaticProbe(distDir,path.slice(1),"must-not-serve-static");
    const server=await startFixtureServer({distDir,bundle:{proof:"unverified",reason:"native file dispatcher regression"},
      savedArchiveFileResponse:(requestedRun,requestedDigest)=>requestedRun===runId&&requestedDigest===digest
        ?new Response(new Uint8Array(FIXTURE_ARCHIVE_EVIDENCE_BYTES).buffer,{headers:{"content-type":"image/png"}})
        :new Response("unknown retained member",{status:404})});
    try {
      const response=await fetch(`${server.baseUrl}${path}`);assert.equal(response.status,200);
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()),FIXTURE_ARCHIVE_EVIDENCE_BYTES);
      assert.equal((await fetch(`${server.baseUrl}/artifacts/v1/archive/${runId}/files/${"0".repeat(64)}`)).status,404);
      assert.ok(server.artifactExchanges().some(row=>row.pathname===path&&row.status===200));
    }finally{await server.close();}
  }finally{rmSync(distDir,{recursive:true,force:true});}
});


it("serves the frozen redacted resolution through the current saved-report HTTP route", async () => {
  const root = mkdtempSync(join(tmpdir(), "resolution-report-http-"));
  const server = await startFailureResolutionServer({ distDir: root,
    bundle: { proof: "unverified", reason: "HTTP regression without browser rendering" } });
  try {
    assert.equal((await server.externalAction("resolve", "SYNTHETIC_PRIVATE_NOTE")).state, "applied");
    const archivedId = server.captureArchive();
    const route = `${server.baseUrl}/api/v1/archive/reports/${archivedId}`;
    const response = await fetch(route);
    assert.equal(response.status, 200);
    const bytes = await response.text();
    const report = SavedArchiveReportWireSchema.parse(JSON.parse(bytes));
    assert.equal(report.runId, archivedId);
    assert.equal(bytes.includes("SYNTHETIC_PRIVATE_NOTE"), false);
    assert.equal(bytes.includes("Protected resolution note withheld."), true);
    assert.equal((await server.externalAction("reopen")).state, "applied");
    assert.equal(await (await fetch(route)).text(), bytes);
    assert.equal(server.reads(), 0);
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});
