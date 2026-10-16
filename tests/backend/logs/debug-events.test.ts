import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { createDebugEventWriter } from "../../../src/backend/logs/debug-events.js";
import { TimelineEventRecordSchema,type TimelineEventRecord,type TimelineRepository } from "../../../src/models/events/timeline.js";
import { WorkflowIdSchema } from "../../../src/rules/identity/ids.js";
import { manualClock } from "../../../src/rules/time/clock.js";
const AT = new Date("2026-10-10T12:00:00.000Z");
function fixture() {
  const records: TimelineEventRecord[] = [];
  const repository: TimelineRepository = { withReadSnapshot: read => read(),
    append(input) { const record = TimelineEventRecordSchema.parse({ ...(input as object), cursor: records.length + 1 });
      const existing = records.find(row => row.eventId === record.eventId);
      if (existing !== undefined) return { state: "existing", record: existing };
      records.push(record); return { state: "inserted", record }; },
    get: id => records.find(row => row.eventId === id), page: () => records, highWaterMark: () => records.length, pruneBefore: () => 0, confirmedActionHeads: () => [] };
  return { records, repository };
}
describe("bounded native debug events", () => {
  it("binds idempotent client reports to the explicit workflow as well as scope", () => {
    const { records, repository } = fixture();
    const writer = createDebugEventWriter({ repository, clock: manualClock(AT), build: "test" });
    const event = { category: "client", phase: "failed", correlationId: "workflow-bound" };
    const scope = { kind: "client" as const, clientId: "local" };
    const workflow = WorkflowIdSchema.parse("person-lookup");
    assert.equal(writer.emit(event, scope, workflow).state, "inserted");
    assert.equal(writer.emit(event, scope, workflow).state, "existing");
    assert.throws(() => writer.emit(event, scope, WorkflowIdSchema.parse("separations")), /debug-report-identity-conflict/u);
    assert.throws(() => writer.emit(event, scope), /debug-report-identity-conflict/u);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.workflow, "person-lookup");
  });
  it.each(["session", "duo", "worker", "http", "sse", "client", "boot"] as const)("writes %s once with source/build/time", category => {
    const { records, repository } = fixture();
    createDebugEventWriter({ repository, clock: manualClock(AT), build: "test" }).emit({ category, phase: "failed", correlationId: "owned", message: "Bearer CANARY token=CANARY https://example.test/path?key=CANARY#CANARY" });
    assert.equal(records.length, 1); assert.equal(records[0].payload.kind, "debug");
    assert.equal(JSON.stringify(records).includes("CANARY"), false);
    assert.equal(records[0].recordedAt, AT.toISOString());
  });
  it("redacts quoted and nested credentials in every diagnostic text field before append", () => {
    const { records, repository } = fixture();
    const credentials = JSON.stringify({ token: "QUOTED_TOKEN_SECRET", nested: {
      password: 'ESCAPED_PASSWORD_SECRET "quote"\nsecond line', cookie: "COOKIE_SECRET",
      privateKey: { raw: "NESTED_KEY_SECRET" }, challenge: ["CHALLENGE_SECRET"], signature: "SIGNATURE_SECRET" }, name: "Ada" });
    const writer = createDebugEventWriter({ repository, clock: manualClock(AT), build: "test" });
    writer.emit({ category: "client", phase: "failed", correlationId: "owned", pinned: true,
      message: credentials, stack: `Error context ${credentials} {"password":"MULTILINE_SECRET\nSECOND_LINE_SECRET"} {"\\u0074oken":"ESCAPED_KEY_SECRET"}`,
      route: "https://example.test/path?unlabelled=ROUTE_SECRET#FRAGMENT_SECRET",
      release: '{"token":"RELEASE_SECRET"}', surface: '{"password":"SURFACE_SECRET"}', code: '{"cookie":"CODE_SECRET"}' });
    assert.equal(records.length, 1);
    const stored = JSON.stringify(records);
    for (const secret of ["QUOTED_TOKEN_SECRET", "ESCAPED_PASSWORD_SECRET", "COOKIE_SECRET", "NESTED_KEY_SECRET", "CHALLENGE_SECRET", "SIGNATURE_SECRET", "ROUTE_SECRET", "FRAGMENT_SECRET", "RELEASE_SECRET", "SURFACE_SECRET", "CODE_SECRET", "MULTILINE_SECRET", "SECOND_LINE_SECRET", "ESCAPED_KEY_SECRET"]) assert.equal(stored.includes(secret), false, secret);
    const payload = records[0].payload; assert.equal(payload.kind, "debug");
    if (payload.kind !== "debug") throw new Error("debug event expected");
    assert.equal(payload.event.correlationId, "owned"); assert.equal(payload.event.pinned, true);
    assert.equal(payload.event.route, "https://example.test/path"); assert.ok(payload.event.message?.includes("Ada"));
    writer.emit({ category: "http", phase: "failed", correlationId: "second", route: "/api/run?unlabelled=RELATIVE_SECRET#fragment" });
    assert.equal(JSON.stringify(records).includes("RELATIVE_SECRET"), false);
  });
  it("refuses credential-bearing identities without changing their correlation or retaining bytes", () => {
    const { records, repository } = fixture();
    const writer = createDebugEventWriter({ repository, clock: manualClock(AT), build: "test" });
    const event = { category: "client", phase: "failed", correlationId: "owned" };
    assert.throws(() => writer.emit({ ...event, correlationId: "token=IDENTITY_SECRET" }), /debug-identity-contains-credential-material/u);
    assert.throws(() => writer.emit({ ...event, cursor: '{"cookie":"CURSOR_SECRET"}' }), /debug-identity-contains-credential-material/u);
    assert.throws(() => writer.emit(event, { kind: "client", clientId: "token=CLIENT_SECRET" }), /debug-identity-contains-credential-material/u);
    assert.equal(records.length, 0);
  });
  it("retains structural UUID correlation while masking mixed SSN text", () => {
    const { records, repository } = fixture();
    const writer = createDebugEventWriter({ repository, clock: manualClock(AT), build: "test" });
    const correlationId = "aaaaaaaa-aaaa-4aaa-8aaa-a902481357aa";
    writer.emit({ category: "http", phase: "failed", correlationId,
      message: `${correlationId} person 920-74-1459 and 920741459` });
    assert.equal(records.length, 1);
    const payload = records[0].payload;
    assert.equal(payload.kind, "debug");
    if (payload.kind !== "debug") throw new Error("debug event expected");
    assert.equal(payload.event.correlationId, correlationId);
    assert.equal(payload.event.message?.includes("920-74-1459"), false);
    assert.equal(payload.event.message?.includes("person 920741459"), false);
    assert.match(payload.event.message ?? "", /person \[SSN masked\] and \[SSN masked\]/u);
  });

  it("rejects body/header fields and oversized events before append", () => {
    const { records, repository } = fixture();
    const writer = createDebugEventWriter({ repository, clock: manualClock(AT), build: "test" });
    assert.throws(() => writer.emit({ category: "http", phase: "failed", correlationId: "owned", headers: { authorization: "CANARY" } }));
    assert.throws(() => writer.emit({ category: "sse", phase: "failed", correlationId: "owned", message: "a".repeat(8192) }), /size-exceeded/u);
    assert.equal(records.length, 0);
  });
});
