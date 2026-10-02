import { RunRecordSchema } from "../../../src/domain/run/record.js";
import { request as httpRequest } from "node:http";
import assert from "node:assert/strict";
import { it, vi } from "vitest";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { archiveFixture, attachFile } from "../../helpers/archive-transfer/fixtures.js";
import { createRunLifecycleStorage } from "../../../src/backend/storage/run-lifecycle-storage.js";
import { RunRecordService } from "../../../src/backend/runs/run-record-service.js";
import { id } from "../../unit/database-foundation/fixtures.js";

it.each(["canonical disposition", "saved report", "other retained attachment"] as const)(
  "keeps %s readable when one retained attachment is missing", operation => {
    const f = archiveFixture();
    try {
      f.terminal();
      const runId = f.base.run.envelope.runId;
      const missing = attachFile(f.database, f.base.root, runId, 8700, Buffer.from("synthetic missing attachment"));
      const retained = attachFile(f.database, f.base.root, runId, 8710, Buffer.from("synthetic retained attachment"));
      assert.equal(f.kernel.execute(f.applyRequest(f.plan())).state, "applied");
      const storage = createRunLifecycleStorage(f.database);
      const reader = new RunRecordService({ database: f.database, clock: f.base.clock,
        ids: { uuid: () => id(8720) }, publishQueued: () => { throw new Error("read-created-work"); } });
      const read = () => operation === "canonical disposition" ? reader.read(runId)
        : operation === "saved report" ? storage.readReport(runId) : storage.readFile(runId, retained.file.digest);
      const before = read();
      assert.ok(before);
      const missingPath = join(f.base.root, "archive-files", missing.file.digest);
      unlinkSync(missingPath);
      let failure: unknown;
      try { assert.deepEqual(read(), before); } catch (error: unknown) { failure = error; }
      // Recovery control: the exact bytes restore every original answer without a database mutation.
      writeFileSync(missingPath, missing.bytes);
      assert.deepEqual(read(), before);
      if (failure !== undefined) throw new Error("saved archive read depends on unrelated attachment bytes", { cause: failure });
    } finally { f.dispose(); }
  },
);

import { savedHttpFixture } from "../../unit/served-database-surfaces/fixtures.js";
import { startDashboardHttpServer } from "../../../src/backend/transports/dashboard/http-server.js";
import { SavedArchiveDetailWireSchema, SavedArchiveIndexWireSchema, ArchivedCaptureResourceWireSchema } from "../../../src/domain/dashboard/archive.js";
import { readArchiveReport } from "../../../src/backend/runs/dashboard/queries/archive-reports.js";

it("serves standalone saved reports and exact retained bytes after transfer and restart; refuses foreign, corrupt, missing and deleted attachments", async () => {
  const f = savedHttpFixture();
  let server: Awaited<ReturnType<typeof startDashboardHttpServer>> | undefined;
  try {
    const runId = f.base.run.envelope.runId;
    f.terminal();
    const retained = attachFile(f.database, f.base.root, runId, 8750, Buffer.from("synthetic retained HTTP bytes"));
    assert.equal(f.kernel.execute(f.applyRequest(f.plan())).state, "applied");
    f.reopen();
    assert.equal(f.database.authority.runs.get(runId), undefined);
    server = await startDashboardHttpServer({ app: f.app(), port: 0 });
    const origin = `http://127.0.0.1:${server.port}`;
    const get = (path: string, headers?: Record<string, string>) => fetch(`${origin}${path}`, { headers });
    const detailPath = `/api/v1/archive/reports/${runId}`;
    const bytePath = `/artifacts/v1/archive/${runId}/${id(8750)}`;
    const filePath = `/api/v1/archive/reports/${runId}/files/${retained.file.digest}`;
    const digestPath = `/artifacts/v1/archive/${runId}/files/${retained.file.digest}`;
    const resourcePath = `/api/v1/archive/${runId}/captures/${id(8750)}/resource`;
    const currentParser = vi.spyOn(RunRecordSchema, "parse").mockImplementation(() => { throw new Error("saved-report-used-current-run-parser"); });
    let standalone: unknown;
    try {
      standalone = await (await get(detailPath)).json();
      assert.equal((await get("/api/v1/archive/reports?limit=1")).status, 200);
      assert.equal((await get(bytePath)).status, 200);
      assert.equal(currentParser.mock.calls.length, 0);
    } finally { currentParser.mockRestore(); }
    const detail = SavedArchiveDetailWireSchema.parse(standalone);
    assert.equal(detail.state, "available");
    assert.deepEqual(detail, readArchiveReport(createRunLifecycleStorage(f.database), runId));
    assert.equal(JSON.stringify(detail).includes('"sources"'), false);
    const index = SavedArchiveIndexWireSchema.parse(await (await get("/api/v1/archive/reports?limit=1&workflow=person-lookup")).json());
    assert.deepEqual(index.items, [detail]);
    assert.deepEqual(SavedArchiveIndexWireSchema.parse(await (await get("/api/v1/archive/reports?workflow=removed-workflow")).json()).items, []);
    assert.equal((await get("/api/v1/archive/reports?limit=501")).status, 400);
    const generation = f.database.getMeta().authorityGeneration;
    const download = await get(bytePath);
    assert.equal(download.status, 200);
    assert.equal((await get(filePath)).status, 200);
    assert.deepEqual(Buffer.from(await (await get(digestPath)).arrayBuffer()), retained.bytes);
    assert.equal((await get(`/artifacts/v1/archive/${runId}/files/${"f".repeat(64)}`)).status, 404);
    assert.equal(download.headers.get("cache-control"), "no-store");
    assert.match(download.headers.get("content-disposition") ?? "", /^attachment;/);
    assert.equal(download.headers.get("content-type"), "text/yaml");
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), retained.bytes);
    assert.equal((await get(bytePath, { range: "bytes=0-3" })).status, 416);
    for (const headers of [{ host: "evil.example" }, { origin: "https://evil.example" }]) {
      const denied = await new Promise<Response>((resolve, reject) => {
        const request = httpRequest(`${origin}${bytePath}`, { headers }, response => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode })));
          response.on("error", reject);
        });
        request.on("error", reject); request.end();
      });
      assert.equal(denied.status, 403);
      assert.equal((await denied.text()).includes(retained.bytes.toString()), false);
    }
    assert.equal((await get(`/artifacts/v1/archive/${runId}/${id(8751)}`)).status, 404);
    assert.equal((await get(`/artifacts/v1/archive/${id(8752)}/${id(8750)}`)).status, 404);
    const path = join(f.base.root, "archive-files", retained.file.digest);
    writeFileSync(path, Buffer.from("corrupt"));
    assert.equal((await get(bytePath)).status, 500);
    assert.equal(ArchivedCaptureResourceWireSchema.parse(await (await get(resourcePath)).json()).resource.state, "error");
    unlinkSync(path);
    assert.equal(ArchivedCaptureResourceWireSchema.parse(await (await get(resourcePath)).json()).resource.state, "missing");
    assert.deepEqual(SavedArchiveDetailWireSchema.parse(await (await get(detailPath)).json()), detail);
    writeFileSync(path, retained.bytes);
    assert.equal(f.database.getMeta().authorityGeneration, generation);
    assert.equal(SavedArchiveDetailWireSchema.parse(await (await get(`/api/v1/archive/reports/${id(8752)}`)).json()).state, "missing");
    if (detail.state !== "available") throw new Error("saved-report-missing");
    const deleted = f.kernel.execute({ commandId: id(8753), requestedAt: f.base.clock.now().toISOString(), requestedBy: "local-operator", source: "archive", family: "version-archive", type: "delete-archived-run", target: { archivedRunId: runId, archiveFingerprint: detail.archiveFingerprint } });
    assert.equal(deleted.state, "applied");
    assert.equal(SavedArchiveDetailWireSchema.parse(await (await get(detailPath)).json()).state, "deleted");
    assert.equal((await get(bytePath)).status, 404);
  } finally { await server?.close(); f.dispose(); }
});

import { DatabaseSync } from "node:sqlite";
it("refuses a corrupt saved report before serving any sections and recovers only when exact report bytes are restored", async () => {
  const f = savedHttpFixture();
  try {
    f.terminal(); assert.equal(f.kernel.execute(f.applyRequest(f.plan())).state, "applied");
    const app = f.app(), runId = f.base.run.envelope.runId;
    const get = (path: string) => app.request(`http://localhost${path}`, { headers: { host: "localhost" } });
    const original = await (await get(`/api/v1/archive/reports/${runId}`)).text();
    const raw = new DatabaseSync(join(f.base.root, "archive.sqlite"));
    try {
      const row = raw.prepare("SELECT report_json FROM archive_records WHERE run_id=?").get(runId);
      const trigger = raw.prepare("SELECT sql FROM sqlite_master WHERE name='archive_records_immutable'").get();
      assert.equal(typeof row?.report_json, "string"); assert.equal(typeof trigger?.sql, "string");
      raw.exec("DROP TRIGGER archive_records_immutable");
      try {
        raw.prepare("UPDATE archive_records SET report_json=json_set(report_json,'$.content.title','forged synthetic report') WHERE run_id=?").run(runId);
        for (const path of [`/api/v1/archive/reports/${runId}`, "/api/v1/archive/reports"]) {
          const response = await get(path); assert.equal(response.status, 500); assert.equal((await response.text()).includes("forged synthetic report"), false);
        }
      } finally {
        raw.prepare("UPDATE archive_records SET report_json=? WHERE run_id=?").run(row?.report_json ?? "", runId);
        raw.exec(String(trigger?.sql));
      }
    } finally { raw.close(); }
    assert.equal(await (await get(`/api/v1/archive/reports/${runId}`)).text(), original);
  } finally { f.dispose(); }
});
