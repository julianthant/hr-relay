import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { z } from "zod";
import { createDebugEventWriter, emitFaultWithCauses } from "../../../src/backend/logs/debug-events.js";
import { mirrorDebugEvent } from "../../../src/backend/storage/events/local-debug-log.js";
import { PreflightObservationChangedError } from "../../../src/rules/preflight/preflight-admission.js";
import { debugTimelineFixture as fixture } from "../../support/helpers/backend/debug-timeline-fixture.js";
import { RunIdSchema, WorkflowIdSchema } from "../../../src/rules/identity/ids.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { debugEventLevel } from "../../../src/models/events/timeline.js";
const AT = new Date("2026-10-10T12:00:00.000Z");
describe("bounded native debug events", () => {
  it("accepts only closed ChatGPT inference metadata before persistence", () => {
    const { records, repository } = fixture();
    const writer = createDebugEventWriter({ repository, clock: manualClock(AT), build: "test" });
    const chatGptInference = { operation: "ocr", path: "http-error", contentType: "application/json", providerCode: "model_not_found" };
    const event = { category: "http", phase: "failed", correlationId: "inference" };
    for (const field of ["operation", "path", "contentType", "providerCode", "headers"])
      assert.throws(() => writer.emit({ ...event, chatGptInference: { ...chatGptInference, [field]: "PRIVATE_CANARY" } }));
    assert.equal(records.length, 0);
    for (const metadata of [
      { jsonFailure: "PRIVATE_CANARY" },
      { events: { types: ["PRIVATE_EVENT_CANARY"], truncated: false } },
      { terminalShape: { fields: [{ path: ["response", "PRIVATE_KEY_CANARY"], type: "string" }], truncated: false } },
      { terminalShape: { fields: [{ path: ["response", "id"], type: "PRIVATE_VALUE_CANARY" }], truncated: false } },
      { terminalIssues: { issues: [{ path: ["response", "id"], code: "PRIVATE_VALUE_CANARY" }], truncated: false } },
    ]) assert.throws(() => writer.emit({ ...event, chatGptInference: { ...chatGptInference, ...metadata } }));
    assert.equal(records.length, 0);
    writer.emit({ ...event, chatGptInference });
    assert.equal(records.length, 1);
  });
  it("keeps a supervisor fault's real closed cause in events and stderr", () => {
    const { records, repository } = fixture();
    const writer = createDebugEventWriter({ repository, clock: manualClock(AT), build: "test" });
    const faults: string[] = [];
    const error = new AggregateError([new PreflightObservationChangedError()], "PRIVATE_CANARY");
    emitFaultWithCauses(writer, line => { faults.push(line); }, error,
      { category: "worker", area: "supervisor", code: "WORKER_SUPERVISOR_FAILED", reason: "supervisor-failed" });
    const events = records.map(record => record.payload.kind === "debug" ? record.payload.event : undefined);
    assert.deepEqual(events.map(event => [event?.code, event?.reason, event?.message]), [
      ["WORKER_SUPERVISOR_FAILED", "supervisor-failed", undefined],
      ["INTERNAL_FAILURE", "aggregate-cause", "AggregateError"],
      ["PREFLIGHT_OBSERVATION_CHANGED", "observation-changed", "PreflightObservationChangedError"],
    ]);
    assert.equal(new Set(events.map(event => event?.correlationId)).size, 1);
    assert.deepEqual((JSON.parse(faults[0] ?? "{}") as { causes: unknown }).causes, [
      { name: "AggregateError", code: "INTERNAL_FAILURE", reason: "aggregate-cause" },
      { name: "PreflightObservationChangedError", code: "PREFLIGHT_OBSERVATION_CHANGED", reason: "observation-changed" },
    ]);
    assert.equal(JSON.stringify([records, faults]).includes("CANARY"), false);
  });
  it("revalidates the mirrored payload, not only its label", () => {
    const lines: string[] = [];
    const record = JSON.parse(JSON.stringify({ recordedAt: AT.toISOString(), scope: { kind: "transport", connectionId: "local" },
      event: { category: "http", phase: "failed", correlationId: "x", build: "test", pid: 1, pinned: false, reason: "PRIVATE CANARY" } })) as Parameters<typeof mirrorDebugEvent>[0];
    assert.throws(() => { mirrorDebugEvent(record, { development: true, writeStderr: line => { lines.push(line); } }); });
    assert.deepEqual(lines, []);
  });
  it("mirrors HTTP method, registered route template and status without client routes or payloads", () => {
    const { repository } = fixture(); const lines: string[] = [];
    const writer = createDebugEventWriter({ repository, clock: manualClock(AT), build: "test", development: true,
      writeStderr: line => { lines.push(line); } });
    writer.emit({ category: "http", phase: "failed", correlationId: "route-proof", method: "GET",
      route: "/api/v1/runs/:runId/attempt-history", status: 503, message: "PRIVATE_BODY_CANARY", stack: "PRIVATE_STACK_CANARY" });
    const mirrored = JSON.parse(lines[0]) as Record<string, unknown>;
    assert.equal(mirrored.method, "GET");
    assert.equal(mirrored.route, "/api/v1/runs/:runId/attempt-history");
    assert.equal(mirrored.status, 503);
    writer.emit({ category: "client", phase: "failed", correlationId: "client-route", route: "/api/v1/runs/PRIVATE_NAME_CANARY" });
    assert.equal("route" in JSON.parse(lines[1]), false);
    writer.emit({ category: "client", phase: "failed", correlationId: "client-root", route: "/api/v1/dashboard" });
    assert.equal((JSON.parse(lines[2]) as { route?: string }).route, "/api/v1/dashboard");
    assert.equal(lines.join("").includes("CANARY"), false);
  });
  it.each([
    [{ phase: "failed" }, "error"],
    [{ phase: "settled" }, "info"],
    [{ phase: "expired" }, "warn"],
    [{ phase: "failed", reason: "operation-refused" }, "warn"],
    [{ phase: "settled", reason: "outcome-unknown" }, "error"],
    [{ phase: "failed", reason: "operation-refused", status: 503 }, "error"],
    [{ phase: "settled", status: 403 }, "warn"],
    [{ phase: "failed", code: "CHATGPT_OCR_CANCELLED", reason: "catalog-request" }, "info"],
    [{ phase: "failed", code: "INTERNAL_FAILURE", reason: "request-disconnected" }, "info"],
  ] as const)("derives severity from retained metadata %j", (event, level) => {
    assert.equal(debugEventLevel(event), level);
  });
  it("derives levels and mirrors only inserted redacted metadata in development", () => {
    const { records, repository } = fixture();
    const lines: string[] = [];
    const writer = createDebugEventWriter({ repository, clock: manualClock(AT), build: "test", development: true,
      writeStderr: line => { assert.equal(records.length, lines.length + 1); lines.push(line); } });
    const event = { category: "client", phase: "failed", correlationId: "owned", area: "dashboard", reason: "operation-failed",
      code: "token=CODE_CANARY", message: "PRIVATE_NAME_CANARY", stack: "PRIVATE_PAGE_CANARY", route: "/api/runs?token=ROUTE_CANARY" };
    writer.emit(event);
    writer.emit(event);
    writer.emit({ category: "session", phase: "acquired", correlationId: "session" });
    writer.emit({ category: "sse", phase: "reset", correlationId: "stream" });
    writer.emit({ category: "http", phase: "failed", reason: "operation-refused", correlationId: "refusal" });
    assert.equal(lines.length, 4);
    const mirrors = lines.map(line => z.object({ level: z.enum(["error", "warn", "info"]), time: z.string(), correlationId: z.string() }).loose().parse(JSON.parse(line)));
    assert.deepEqual(mirrors.map(mirror => mirror.level), ["error", "info", "warn", "warn"]);
    for (const record of records) {
      assert.equal(record.payload.kind, "debug");
      if (record.payload.kind === "debug") assert.equal("level" in record.payload.event, false);
    }
    for (const [index, mirror] of mirrors.entries()) {
      const line = lines[index];
      assert.equal(line.split("\n").length, 2);
      assert.equal(/CANARY/u.test(line), false);
      assert.equal(mirror.time, AT.toISOString());
      assert.ok(mirror.correlationId);
      assert.equal("message" in mirror || "stack" in mirror || "route" in mirror, false);
    }
  });
  it("keeps production silent and never mirrors an append failure", () => {
    const { repository } = fixture();
    const lines: string[] = [];
    const writeStderr = (line: string) => { lines.push(line); };
    createDebugEventWriter({ repository, clock: manualClock(AT), build: "test", development: false, writeStderr })
      .emit({ category: "boot", phase: "failed", correlationId: "production" });
    const writer = createDebugEventWriter({ repository: { ...repository, append() { throw new Error("append-failed"); } },
      clock: manualClock(AT), build: "test", development: true, writeStderr });
    assert.throws(() => writer.emit({ category: "http", phase: "failed", correlationId: "failed" }), /append-failed/u);
    assert.deepEqual(lines, []);
  });
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
  it("mirrors a run-scoped worker failure value-free with only its closed fields", () => {
    const { records, repository } = fixture(); const lines: string[] = [];
    const writer = createDebugEventWriter({ repository, clock: manualClock(AT), build: "test", development: true,
      writeStderr: line => { lines.push(line); } });
    const scope = { kind: "run" as const, runId: RunIdSchema.parse("00000000-0000-4000-8000-0000000000a1") };
    writer.emit({ category: "worker", phase: "failed", area: "run-execution", reason: "run-failed", code: "TASK_FAILED", correlationId: "failure-1" },
      scope, WorkflowIdSchema.parse("person-lookup"));
    assert.equal(records.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), { time: AT.toISOString(), level: "error", category: "worker", phase: "failed", code: "TASK_FAILED",
      area: "run-execution", reason: "run-failed", correlationId: "failure-1", scope, workflow: "person-lookup" });
    assert.equal(/message|stack|cause/u.test(lines[0]), false);
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
      message: `${correlationId} person 902-48-1357 and 902481357` });
    assert.equal(records.length, 1);
    const payload = records[0].payload;
    assert.equal(payload.kind, "debug");
    if (payload.kind !== "debug") throw new Error("debug event expected");
    assert.equal(payload.event.correlationId, correlationId);
    assert.equal(payload.event.message?.includes("902-48-1357"), false);
    assert.equal(payload.event.message?.includes("person 902481357"), false);
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
