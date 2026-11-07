import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe,it } from "vitest";
import { readTimelineRecords } from "../../../../src/backend/storage/events/timeline-reader.js";
import { TimelineAppendSchema } from "../../../../src/models/events/timeline.js";
import { NOW } from "../../../support/helpers/database-foundation/fixtures.js";
import { resolutionApp,resolutionCommand,resolutionFixture } from "../../../support/helpers/failure-resolution/fixtures.js";

function snapshot(f: Awaited<ReturnType<typeof resolutionFixture>>, excludeHttpDiagnostics = false) {
  const sql = new DatabaseSync(f.path);
  try { return JSON.stringify({ ...(excludeHttpDiagnostics ? {} : { generation: f.db.getMeta().authorityGeneration }),
    tables: Object.fromEntries(["runs", "run_failures", "commands", "command_audits", "timeline_events", "run_receipts"]
      .map(table => [table, sql.prepare(`SELECT * FROM ${table}${excludeHttpDiagnostics && table === "timeline_events" ? " WHERE kind <> 'debug'" : ""} ORDER BY 1`).all()])) }); }
  finally { sql.close(); }
}

describe("D resolution command authority", () => {
  it("strict history binds scope/time/source, duplicate identity and ordinary retention", async () => {
    const f = await resolutionFixture();
    try {
      f.kernel.execute(resolutionCommand());
      const record = readTimelineRecords(f.db.authority.timelineEvents).records.find(row => row.payload.kind === "failure-resolution"); assert.ok(record);
      const { cursor: _cursor, ...append } = record;
      assert.equal(f.db.authority.timelineEvents.append(append).state, "existing");
      for (const bad of [{ ...append, workflow: "separations" }, { ...append, scope: { kind: "run", runId: randomUUID() } }, { ...append, occurredAt: "2026-09-10T00:00:00.000Z" }, { ...append, payload: { ...append.payload, note: "forbidden" } }]) {
        assert.equal(TimelineAppendSchema.safeParse(bad).success, false);
      }
      assert.throws(() => f.db.authority.timelineEvents.append({ ...append, retentionDate: "2026-09-08" }), /identity-conflict/u);
      assert.ok(f.db.authority.timelineEvents.pruneBefore("2026-09-10") >= 1);
      assert.equal(f.db.authority.timelineEvents.get(record.eventId), undefined);
      assert.equal(f.db.authority.failureResolution.read(f.record.runId, f.record.failureId)?.resolution.status, "resolved");
    } finally { await f.dispose(); }
  });
});

describe("D actual HTTP admission", () => {
  it("admits actor and server time, refuses forged actor/Host/Origin and malformed actions without mutation", async () => {
    const f = await resolutionFixture();
    try {
      const app = resolutionApp(f); const before = snapshot(f, true);
      const headers = { host: "localhost", origin: "http://localhost", "content-type": "application/json" };
      for (const input of [
        { headers: { ...headers, host: "evil.example" }, body: resolutionCommand(), status: 403 },
        { headers: { ...headers, origin: "http://evil.example" }, body: resolutionCommand(), status: 403 },
        { headers, body: resolutionCommand({ requestedBy: "forged-actor" }), status: 403 },
        { headers, body: { ...resolutionCommand(), payload: { action: "resolve", note: "x".repeat(1001) } }, status: 400 },
      ]) {
        const response = await app.request("http://localhost/api/v1/commands", { method: "POST", headers: input.headers, body: JSON.stringify(input.body) });
        assert.equal(response.status, input.status, await response.text()); assert.equal(snapshot(f, true), before);
        const diagnostics = readTimelineRecords(f.db.authority.timelineEvents).records.filter(row => row.payload.kind === "debug");
        assert.ok(diagnostics.every(row => row.payload.kind === "debug" && row.payload.event.category === "http"));
        assert.ok(diagnostics.every(row => !JSON.stringify(row).includes("Updated page control.")));
      }
      const command = resolutionCommand({ requestedAt: "2000-01-01T00:00:00.000Z" });
      const response = await app.request("http://localhost/api/v1/commands", { method: "POST", headers, body: JSON.stringify(command) });
      assert.equal(response.status, 200, await response.text());
      const accepted = f.db.authority.commands.get(command.commandId); assert.equal(accepted?.requestedAt, NOW);
      assert.equal(accepted?.requestedBy, "local-operator");
      const replay = await app.request("http://localhost/api/v1/commands", { method: "POST", headers, body: JSON.stringify(command) });
      assert.equal(replay.status, 200);
      const committed = snapshot(f, true);
      const divergent = await app.request("http://localhost/api/v1/commands", { method: "POST", headers,
        body: JSON.stringify({ ...command, payload: { action: "resolve", note: "PRIVATE_CHANGED_NOTE" } }) });
      assert.equal(divergent.status, 422);
      const refusal = await divergent.text();
      assert.match(refusal, /command-divergent/u); assert.ok(!refusal.includes("PRIVATE_CHANGED_NOTE"));
      assert.equal(snapshot(f, true), committed);
    } finally { await f.dispose(); }
  });
});
