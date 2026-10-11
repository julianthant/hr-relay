import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { syntheticStateRoot } from "../../../support/helpers/synthetic-storage-admission.js";
import { randomUUID } from "node:crypto";
import { resolutionApp, resolutionFixture } from "../../../support/helpers/failure-resolution/fixtures.js";
import { trustWorld } from "../../../support/helpers/backend/trust-authority-fixture.js";
import { createDiagnosticCaptureService } from "../../../../src/backend/logs/diagnostics/diagnostic-capture.js";
import { operatorRequestedCapture } from "../../../../src/backend/logs/diagnostics/run-diagnostic-capture.js";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { createTimelineRepository } from "../../../../src/backend/storage/sqlite/timeline-repository.js";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
const AT = new Date("2026-10-10T12:00:00.000Z");
function fixture(path = ":memory:") {
  const database = new DatabaseSync(path);
  for (const statement of SQLITE_MIGRATIONS[0].statements) database.exec(statement);
  const repository = createTimelineRepository({ database, read: read => read(), assertOwner: () => {},
    mutate: work => { const nested = database.isTransaction; database.exec(nested ? "SAVEPOINT logging_fixture" : "BEGIN IMMEDIATE"); try { const result = work(); database.exec(nested ? "RELEASE logging_fixture" : "COMMIT"); return result.result; } catch (error) { database.exec(nested ? "ROLLBACK TO logging_fixture; RELEASE logging_fixture" : "ROLLBACK"); throw error; } } });
  return { database, repository };
}
describe("native logging authority", () => {
  it("constructs and reads a read-only repository without initializing write accounting", () => {
    const root = mkdtempSync(join(tmpdir(), "logging-readonly-"));
    const path = join(root, "state.db");
    const seeded = fixture(path);
    createDebugEventWriter({ repository: seeded.repository, clock: manualClock(AT), build: "test" })
      .emit({ category: "http", phase: "failed", correlationId: "readonly" });
    seeded.database.close();
    const before = readFileSync(path);
    const inventory = readdirSync(root).sort();
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      const repository = createTimelineRepository({ database, read: read => read(),
        assertOwner: () => { throw new Error("read-only query attempted owner mutation"); },
        mutate: () => { throw new Error("read-only query attempted mutation"); } });
      const rows = repository.page({});
      assert.equal(rows.length, 1);
      assert.deepEqual(repository.get(rows[0].eventId), rows[0]);
      assert.equal(repository.highWaterMark(), rows[0].cursor);
      assert.deepEqual(database.prepare("SELECT name FROM sqlite_temp_master WHERE name LIKE 'timeline_ordinary_bytes%'").all(), []);
    } finally {
      database.close();
      try {
        assert.deepEqual(readdirSync(root).sort(), inventory);
        assert.deepEqual(readFileSync(path), before);
      } finally { rmSync(root, { recursive: true, force: true }); }
    }
  });
  it("redacts quoted credential payloads and routes in the actual native writer", () => {
    const { database, repository } = fixture();
    try {
      const message = JSON.stringify({ password: 'NATIVE_PASSWORD_SECRET "quoted"\nsecond line', nested: { cookie: "NATIVE_COOKIE_SECRET", token: ["NATIVE_TOKEN_SECRET"] }, employee: "Ada" });
      const writer = createDebugEventWriter({ repository, clock: manualClock(AT), build: "test" });
      const input = { category: "client", phase: "failed", correlationId: "native-redaction", message,
        stack: `Error ${message}`, route: "/run?unlabelled=NATIVE_ROUTE_SECRET#fragment", pinned: true };
      assert.equal(writer.emit(input).state, "inserted");
      assert.equal(writer.emit(input).state, "existing");
      const rows = repository.page({}); assert.equal(rows.length, 1);
      const payload = rows[0].payload; assert.equal(payload.kind, "debug");
      if (payload.kind !== "debug") throw new Error("debug event expected");
      assert.equal(payload.event.route, "/run"); assert.equal(payload.event.pinned, true);
      assert.equal(payload.event.correlationId, "native-redaction"); assert.ok(payload.event.message?.includes("Ada"));
      const stored = JSON.stringify(database.prepare("SELECT payload_json FROM timeline_events").all());
      for (const secret of ["NATIVE_PASSWORD_SECRET", "NATIVE_COOKIE_SECRET", "NATIVE_TOKEN_SECRET", "NATIVE_ROUTE_SECRET"]) assert.equal(stored.includes(secret), false, secret);
    } finally { database.close(); }
  });
  it("stores strict notes once in SQLite with no secrets and reads them from the same home", () => {
    const { database, repository } = fixture();
    try {
      const note = createNoteTimelineWriter({ repository, clock: manualClock(AT), pid: 1 }).emitNote({ workflow: "person-lookup", address: { workerId: "worker-1", spanPath: "worker-1" }, level: "debug", message: "token=CANARY", fields: [
        { key: "password", classification: "secret", transform: "allow", value: "CANARY" },
        { key: "name", classification: "sensitive-hr", transform: "allow", value: "Ada" }] });
      const rows = repository.page({}); assert.equal(rows.length, 1);
      assert.equal(rows[0].payload.kind, "note"); assert.equal(JSON.stringify(rows).includes("CANARY"), false);
      assert.ok(JSON.stringify(note).includes("Ada"));
      const { cursor: _cursor, ...append } = rows[0];
      assert.equal(repository.append(append).state, "existing");
    } finally { database.close(); }
  });
  it("caps each ordinary append before mutation and keeps the original row", () => {
    const { database, repository } = fixture();
    try {
      const writer = createDebugEventWriter({ repository, clock: manualClock(AT), build: "test" });
      writer.emit({ category: "http", phase: "failed", correlationId: "request-1", message: "ok" });
      const { cursor: _cursor, ...first } = repository.page({})[0];
      assert.throws(() => repository.append({ ...first, workflow: "person-lookup", scope: { kind: "worker", workerId: "worker-1" }, eventId: crypto.randomUUID(), payload: { kind: "note", note: { workflow: "person-lookup", workerId: "worker-1", spanPath: "worker-1", ts: AT.toISOString(), pid: 1, level: "debug", message: "a".repeat(256 * 1024) } } }), /size-exceeded/u);
      assert.equal(repository.page({}).length, 1);
    } finally { database.close(); }
  });
  it("maintains ordinary byte caps through outer rollback, prune and external commits", () => {
    const root = mkdtempSync(join(tmpdir(), "logging-cap-"));
    const path = join(root, "state.db");
    const { database, repository } = fixture(path);
    const writer = createDebugEventWriter({ repository, clock: manualClock(AT), build: "test" });
    const actualBytes = () => Number(database.prepare("SELECT COALESCE(SUM(length(CAST(payload_json AS BLOB))),0) AS bytes FROM timeline_events WHERE retention_class='ordinary'").get()?.bytes);
    const cachedBytes = () => Number(database.prepare("SELECT bytes FROM timeline_ordinary_bytes WHERE id=1").get()?.bytes);
    try {
      database.exec("BEGIN IMMEDIATE");
      writer.emit({ category: "http", phase: "failed", correlationId: "first-initialization-rollback" });
      database.exec("ROLLBACK");
      assert.equal(actualBytes(), 0);
      writer.emit({ category: "http", phase: "failed", correlationId: "initial" });
      assert.equal(cachedBytes(), actualBytes());
      const before = actualBytes();
      database.exec("BEGIN IMMEDIATE");
      writer.emit({ category: "http", phase: "failed", correlationId: "rolled-back" });
      assert.ok(cachedBytes() > before);
      database.exec("ROLLBACK");
      assert.equal(cachedBytes(), before);
      assert.equal(repository.pruneBefore("2027-01-01"), 1);
      assert.equal(cachedBytes(), 0);
      const peer = new DatabaseSync(path);
      try {
        const peerRepository = createTimelineRepository({ database: peer, read: read => read(), assertOwner: () => {}, mutate: work => work().result });
        createDebugEventWriter({ repository: peerRepository, clock: manualClock(AT), build: "test" }).emit({ category: "http", phase: "failed", correlationId: "external" });
        writer.emit({ category: "http", phase: "failed", correlationId: "after-external" });
        assert.equal(cachedBytes(), actualBytes());
        peer.exec("DELETE FROM timeline_events");
        writer.emit({ category: "http", phase: "failed", correlationId: "after-external-delete" });
        assert.equal(cachedBytes(), actualBytes());
        const trigger = peer.prepare("SELECT sql FROM sqlite_master WHERE name='timeline_events_immutable'").get();
        assert.equal(typeof trigger?.sql, "string");
        peer.exec("DROP TRIGGER timeline_events_immutable");
        peer.prepare("UPDATE timeline_events SET payload_json=payload_json || printf('%*s',?,'')").run(250 * 1024 * 1024);
        peer.exec(String(trigger?.sql));
        assert.throws(() => writer.emit({ category: "http", phase: "failed", correlationId: "over-cap" }), /timeline-ordinary-cap-exceeded/u);
        assert.equal(Number(database.prepare("SELECT count(*) AS n FROM timeline_events").get()?.n), 1);
      } finally { peer.close(); }
    } finally { database.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it("pins unresolved recovery and applies seven-day successful SSE retention", () => {
    const { database, repository } = fixture();
    try {
      const writer = createDebugEventWriter({ repository, clock: manualClock(AT), build: "test" });
      writer.emit({ category: "sse", phase: "settled", correlationId: "successful" });
      writer.emit({ category: "sse", phase: "failed", correlationId: "failed" });
      writer.emit({ category: "duo", phase: "failed", correlationId: "unresolved", pinned: true });
      assert.equal(repository.pruneBefore("2026-09-18"), 1);
      const remaining = repository.page({}); assert.equal(remaining.length, 2);
      assert.equal(repository.pruneBefore("2027-01-01"), 1);
      assert.equal(repository.page({}).length, 1);
    } finally { database.close(); }
  });
});

describe("ordinary diagnostic authority", () => {
  it("keeps active and pinned captures and marks expired settled captures explicitly unavailable", async () => {
    const w = trustWorld();
    try {
      const active = w.create(810), settled = w.create(811); w.cancel(settled, 812);
      let id = 0;
      const service = createDiagnosticCaptureService({ authority: w.database.authority, clock: w.world.clock,
        ids: { uuid: () => `00000000-0000-4000-8000-${String(++id).padStart(12,"0")}` }, retentionDays: 1,
        artifacts: { stageDiagnostic: () => { throw new Error("no bytes in this test"); }, put: () => { throw new Error("no bytes in this test"); }, open: () => { throw new Error("no bytes in this test"); } } });
      const capture = (runId: string, pin = false) => operatorRequestedCapture({ service, runId,
        configFingerprint: "a".repeat(64), descriptorFingerprint: "b".repeat(64), fields: [],
        ...(pin ? { retention: { kind: "pinned", reason: "write-recovery" } } : {}) });
      const activeBundle = await capture(active.envelope.runId), ordinary = await capture(settled.envelope.runId), pinned = await capture(settled.envelope.runId, true);
      const later = new Date(w.world.clock.nowMs() + 2 * 86_400_000).toISOString();
      assert.deepEqual(w.database.sweepOrdinaryDiagnostics(later).purged, [ordinary.bundleId]);
      assert.equal(w.database.authority.diagnosticBundles.get(ordinary.bundleId)?.availability?.state, "purged");
      assert.equal(w.database.authority.diagnosticBundles.get(activeBundle.bundleId)?.availability, undefined);
      assert.equal(w.database.authority.diagnosticBundles.get(pinned.bundleId)?.availability, undefined);
      assert.deepEqual(w.database.readManagedArtifactReferences(), []);
    } finally { w.dispose(); }
  });
});

describe("diagnostic byte retention", () => {
  it("retains shared pinned bytes and removes only unreferenced expired bytes", async () => {
    const w = trustWorld();
    try {
      const run = w.create(820); w.cancel(run, 821);
      const artifacts = createContentAddressedArtifactWriter({ admission: syntheticStateRoot(w.world.stateRoot) }); await artifacts.ready;
      const service = createDiagnosticCaptureService({ authority: w.database.authority, artifacts, clock: w.world.clock, ids: { uuid: randomUUID }, retentionDays: 1 });
      const capture = (text: string, pinned = false) => operatorRequestedCapture({ service, runId: run.envelope.runId,
        configFingerprint: "a".repeat(64), descriptorFingerprint: "b".repeat(64), fields: [],
        attachments: [{ kind: "console-summary", mediaType: "application/json", sensitivity: "redacted", bytes: new TextEncoder().encode(text) }],
        ...(pinned ? { retention: { kind: "pinned", reason: "write-recovery" } } : {}) });
      const shared = await capture("{\"safe\":true}"), pinned = await capture("{\"safe\":true}", true), alone = await capture("{\"safe\":false}");
      assert.equal(shared.attachments[0]?.digest, pinned.attachments[0]?.digest);
      const result = w.database.sweepOrdinaryDiagnostics(new Date(w.world.clock.nowMs() + 2 * 86_400_000).toISOString());
      assert.deepEqual([...result.purged].sort(), [shared.bundleId, alone.bundleId].sort());
      assert.equal(existsSync(join(w.world.stateRoot, "artifacts", `${shared.attachments[0]?.digest}.artifact`)), true);
      assert.equal(existsSync(join(w.world.stateRoot, "artifacts", `${alone.attachments[0]?.digest}.artifact`)), false);
      assert.equal(w.database.authority.diagnosticBundles.get(pinned.bundleId)?.availability, undefined);
    } finally { w.dispose(); }
  });
});

describe("loopback debug reporting", () => {
  it("admits strict reports and sanitizes once while rejecting secrets in unknown fields", async () => {
    const f = resolutionFixture();
    try {
      const app = resolutionApp(f);
      const send = (body: unknown, origin = "http://localhost") => app.request("http://localhost/api/v1/debug/errors", { method: "POST", headers: { origin, host: "localhost", "content-type": "application/json" }, body: JSON.stringify(body) });
      const report = { reportId: randomUUID(), clientId: "browser-1", release: "test", route: "/", surface: "app", code: "CLIENT_FAILED", message: "token=CANARY" };
      const firstResponse = await send(report); assert.equal(firstResponse.status, 201, await firstResponse.text());
      const rows = f.db.authority.timelineEvents.page({});
      assert.equal(rows.filter(row => row.payload.kind === "debug" && row.payload.event.category === "client").length, 1);
      assert.equal(JSON.stringify(rows).includes("CANARY"), false);
      assert.equal((await send({ ...report, headers: { authorization: "CANARY" } })).status, 400);
      assert.equal((await send(report, "https://untrusted.test")).status, 403);
      assert.equal((await send({ ...report, message: "a".repeat(65537) })).status, 413);
      for (let i = 0; i < 27; i++) assert.equal((await send({ ...report, reportId: randomUUID() })).status, 201);
      assert.equal((await send(report)).status, 429);
      assert.equal(JSON.stringify(f.db.authority.timelineEvents.page({})).includes("CANARY"), false);
    } finally { f.dispose(); }
  });
});
