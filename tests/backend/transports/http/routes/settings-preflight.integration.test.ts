
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { PreflightRerunCommandResultSchema, requiredPreflightChecks } from "../../../../../src/models/preflight/preflight.js";
import { PreflightObservationChangedError } from "../../../../../src/rules/preflight/preflight-admission.js";

const SAME_ORIGIN = { host: "127.0.0.1:3938", origin: "http://127.0.0.1:3938" };

describe("BFF spine flow (start plan -> kernel -> spans -> projection)", () => {

  it("reruns the one strict preflight authority through its command route", async () => {
    const h = await harness();
    const command = {
      commandId: "00000000-0000-4000-8000-000000000010",
      requestedAt: h.clock.now().toISOString(),
      requestedBy: "local-operator",
      source: "settings-surface",
      type: "rerun-preflight",
      target: { expectedConfigFingerprint: HASH_B },
    } as const;

    const response = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", ...SAME_ORIGIN },
      body: JSON.stringify(command),
    });

    assert.equal(response.status, 200);
    const result = PreflightRerunCommandResultSchema.parse(await response.json());
    assert.equal(result.state, "completed");
    assert.deepEqual(result.report.results.map(({ check }) => check), [
      "runtime.compatibility",
      "config.valid",
      "filesystem.health",
      "authority.health",
      "ports.available",
    ]);
    assert.equal(JSON.stringify(h.preflight.read()), JSON.stringify({ state: "present", report: result.report }));

    const malformed = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", ...SAME_ORIGIN },
      body: JSON.stringify({ ...command, commandId: "00000000-0000-4000-8000-000000000011", extra: true }),
    });
    assert.equal(malformed.status, 400);
  });

  it("refuses preflight reruns outside the loopback Host and Origin boundary", async () => {
    const h = await harness();
    const command = {
      commandId: "00000000-0000-4000-8000-000000000012",
      requestedAt: h.clock.now().toISOString(),
      requestedBy: "local-operator",
      source: "settings-surface",
      type: "rerun-preflight",
      target: { expectedConfigFingerprint: HASH_B },
    } as const;
    const cases = [
      { host: "attacker.example", origin: "http://127.0.0.1:5174" },
      { host: "127.0.0.1:3938", origin: "https://attacker.example" },
    ];

    for (const headers of cases) {
      const response = await h.app.request("/api/v1/preflight/rerun", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(command),
      });
      assert.equal(response.status, 403);
      assert.equal((await json(response)).code, "PREFLIGHT_INGRESS_FORBIDDEN");
    }

    const malformedOrigin = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { host: "127.0.0.1:3938", origin: "not an absolute origin", "content-type": "application/json" },
      body: JSON.stringify(command),
    });
    assert.equal(malformedOrigin.status, 400);
    assert.equal((await json(malformedOrigin)).code, "PREFLIGHT_ORIGIN_INVALID");
  });

  it.each([
    { host: "127.0.0.1:3938" },
    { host: "127.0.0.1:3938", origin: "http://127.0.0.1:5174" },
    { host: "127.0.0.1:0", origin: "http://127.0.0.1:0" },
    { host: "127.0.0.1:65536", origin: "http://127.0.0.1" },
  ])("refuses preflight ingress before reading the request body (%j)", async headers => {
    const h = await harness();
    const requestHeaders = new Headers({ host: headers.host, "content-type": "application/json" });
    if (headers.origin !== undefined) requestHeaders.set("origin", headers.origin);
    const request = new Request("http://127.0.0.1:3938/api/v1/preflight/rerun", {
      method: "POST",
      headers: requestHeaders,
      body: "{}",
    });

    const response = await h.app.request(request);

    assert.equal(response.status, 403);
    assert.equal((await json(response)).code, "PREFLIGHT_INGRESS_FORBIDDEN");
    assert.equal(request.bodyUsed, false);
  });

  it("bounds Host ports at the shared mutation door before the command body is read", async () => {
    const h = await harness();
    for (const [port, originPort, status] of [[0, ":0", 403], [65536, "", 403], [1, ":1", 400], [65535, ":65535", 400]] as const) {
      const request = new Request("http://127.0.0.1:3938/api/v1/commands", {
        method: "POST",
        headers: { host: `127.0.0.1:${String(port)}`, origin: `http://127.0.0.1${originPort}`, "content-type": "application/json" },
        body: "{}",
      });
      const response = await h.app.request(request);
      assert.equal(response.status, status, `Host port ${String(port)}`);
      assert.equal(request.bodyUsed, status === 400);
    }
  });

  it("keeps preflight body transport and decoding refusals distinguishable", async () => {
    const h = await harness();
    const wrongType = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "text/plain", ...SAME_ORIGIN },
      body: "{}",
    });
    assert.equal(wrongType.status, 400);
    assert.equal((await json(wrongType)).code, "PREFLIGHT_CONTENT_TYPE_INVALID");

    const invalidJson = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", ...SAME_ORIGIN },
      body: "{",
    });
    assert.equal(invalidJson.status, 400);
    assert.equal((await json(invalidJson)).code, "PREFLIGHT_BODY_JSON_INVALID");

    const invalidUtf8 = await h.app.request(new Request("http://127.0.0.1:3938/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", ...SAME_ORIGIN },
      body: new Uint8Array([0xff]),
    }));
    assert.equal(invalidUtf8.status, 400);
    assert.equal((await json(invalidUtf8)).code, "PREFLIGHT_BODY_UTF8_INVALID");
  });

  it("distinguishes malformed lengths, missing bodies, and failed body streams", async () => {
    const h = await harness();
    for (const contentLength of ["01", "9007199254740992"]) {
      const response = await h.app.request("/api/v1/preflight/rerun", {
        method: "POST",
        headers: {
          "content-length": contentLength,
          "content-type": "application/json",
          ...SAME_ORIGIN,
        },
        body: "{}",
      });
      assert.equal(response.status, 400);
      assert.equal((await json(response)).code, "PREFLIGHT_CONTENT_LENGTH_INVALID");
    }

    const missingBody = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", ...SAME_ORIGIN },
    });
    assert.equal(missingBody.status, 400);
    assert.equal((await json(missingBody)).code, "PREFLIGHT_BODY_MISSING");

    const failedBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("injected request-stream failure"));
      },
    });
    const streamRequestInit: RequestInit & { readonly duplex: "half" } = {
      method: "POST",
      headers: { "content-type": "application/json", ...SAME_ORIGIN },
      body: failedBody,
      duplex: "half",
    };
    const readFailed = await h.app.request(new Request(
      "http://127.0.0.1:3938/api/v1/preflight/rerun",
      streamRequestInit,
    ));
    assert.equal(readFailed.status, 400);
    assert.equal((await json(readFailed)).code, "PREFLIGHT_BODY_READ_FAILED");
  });

  it("refuses a preflight rerun body beyond its strict byte limit", async () => {
    const h = await harness();
    const response = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", ...SAME_ORIGIN },
      body: JSON.stringify({ padding: "x".repeat(4096) }),
    });

    assert.equal(response.status, 413);
    assert.equal((await json(response)).code, "PREFLIGHT_BODY_TOO_LARGE");
  });

  it("rate-bounds preflight rerun starts within one monotonic window", async () => {
    const h = await harness();
    const command = (index: number) => ({
      commandId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      requestedAt: h.clock.now().toISOString(),
      requestedBy: "local-operator",
      source: "settings-surface",
      type: "rerun-preflight",
      target: { expectedConfigFingerprint: HASH_B },
    });
    const request = (index: number) => h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", ...SAME_ORIGIN },
      body: JSON.stringify(command(index)),
    });

    const signal = new AbortController().signal;
    const first = await h.preflight.execute(command(20), signal);
    for (let index = 21; index < 26; index += 1) assert.equal((await request(index)).status, 200);
    assert.deepEqual(await h.preflight.execute(command(20), signal), first, "completed replay does not start detector work");
    const refused = await request(26);
    assert.equal(refused.status, 429);
    assert.equal((await json(refused)).code, "PREFLIGHT_RATE_LIMITED");
    h.clock.advanceMonotonic(60_000);
    assert.equal((await request(26)).status, 200, "a refusal does not occupy the replay key");
  });

  it("answers the 257th dashboard preflight rerun", async () => {
    const h = await harness();
    for (let attempt = 1; attempt <= 257; attempt += 1) {
      const commandId = `00000000-0000-4000-8000-${String(attempt).padStart(12, "0")}`;
      const response = await h.app.request("/api/v1/preflight/rerun", {
        method: "POST",
        headers: { "content-type": "application/json", ...SAME_ORIGIN },
        body: JSON.stringify({
          commandId, requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator",
          source: "settings-surface", type: "rerun-preflight", target: { expectedConfigFingerprint: HASH_B },
        }),
      });
      assert.equal(response.status, 200, `dashboard rerun ${String(attempt)}`);
      assert.equal(PreflightRerunCommandResultSchema.parse(await response.json()).commandId, commandId);
      h.clock.advanceMonotonic(60_000);
    }
  });

  it("admits only one preflight rerun while detector work is active", async () => {
    let release = (): void => undefined;
    let markStarted = (): void => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const h = await harness({ preflightBeforeRun: async () => {
      markStarted();
      await gate;
    } });
    const command = (suffix: string) => ({
      commandId: `00000000-0000-4000-8000-0000000000${suffix}`,
      requestedAt: h.clock.now().toISOString(),
      requestedBy: "local-operator",
      source: "settings-surface",
      type: "rerun-preflight",
      target: { expectedConfigFingerprint: HASH_B },
    });

    const signal = new AbortController().signal;
    const first = h.preflight.execute(command("30"), signal);
    await started;
    const replay = h.preflight.execute(command("30"), signal);
    const competing = h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", ...SAME_ORIGIN },
      body: JSON.stringify(command("31")),
    });
    try {
      const second = await Promise.race([competing, new Promise<"pending">(resolve => setImmediate(() => resolve("pending")))]);
      assert.ok(second !== "pending", "a new command is refused while the detector is busy");
      assert.equal(second.status, 429);
      assert.equal((await json(second)).code, "PREFLIGHT_RERUN_ACTIVE");
    } finally {
      release();
      await competing;
      assert.deepEqual(await replay, await first);
    }
  });

  it("keeps rerun admission held after deadlines until all detector callbacks actually settle", async () => {
    const deadlines = new Set<() => void>();
    const began = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const h = await harness({
      preflightScheduler: {
        schedule(_at, onDeadline) {
          deadlines.add(onDeadline);
          return { cancel: () => { deadlines.delete(onDeadline); } };
        },
      },
      preflightBeforeRun: async () => { began.resolve(); await release.promise; },
    });
    const request = (suffix: string) => h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", ...SAME_ORIGIN },
      body: JSON.stringify({
        commandId: `00000000-0000-4000-8000-0000000000${suffix}`,
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator", source: "settings-surface", type: "rerun-preflight",
        target: { expectedConfigFingerprint: HASH_B },
      }),
    });
    const first = Promise.resolve(request("40"));
    await began.promise;
    assert.equal(deadlines.size, requiredPreflightChecks(["dashboard.serve"]).length);
    for (const deadline of deadlines) deadline();
    let settled = false;
    void first.then(() => { settled = true; }, () => { settled = true; });
    const refused = await request("41");
    assert.equal(refused.status, 429);
    assert.equal((await json(refused)).code, "PREFLIGHT_RERUN_ACTIVE");
    assert.equal(settled, false);
    release.resolve();
    const timedOut = await first;
    assert.equal(timedOut.status, 409, "late healthy returns cannot publish a report");
    assert.equal((await json(timedOut)).code, "PREFLIGHT_TIMEOUT");
    assert.equal(deadlines.size, 0);
    assert.equal((await request("42")).status, 200, "actual settlement releases admission");
  });

  it("reruns preflight through the closed read-only command and returns the exact report", async () => {
    const h = await harness();
    const response = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", ...SAME_ORIGIN },
      body: JSON.stringify({
        commandId: "00000000-0000-4000-8000-000000000091",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "settings-surface",
        type: "rerun-preflight",
        target: {
          expectedConfigFingerprint: HASH_B,
        },
      }),
    });

    assert.equal(response.status, 200);
    const result = await json(response);
    assert.equal(result.state, "completed");
    assert.equal(result.commandId, "00000000-0000-4000-8000-000000000091");
    assert.deepEqual(
      (result.report as { results: { check: string }[] }).results.map(({ check }) => check),
      requiredPreflightChecks(["dashboard.serve"]),
    );
  });

  it("refuses a transient observation change, including a sibling runner failure, and accepts a later rerun", async () => {
    const checks = requiredPreflightChecks(["dashboard.serve"]);
    const authoritySlot = checks.findIndex((check) => String(check) === "authority.health");
    const secondSlot = checks.findIndex((check) => String(check) === "config.valid");
    assert.notEqual(authoritySlot, -1);
    assert.notEqual(secondSlot, -1);
    let mode: "authority" | "mixed" | "healthy" = "authority";
    let calls = 0;
    const h = await harness({
      preflightBeforeRun: async () => {
        if (mode === "healthy") return;
        const slot = calls % checks.length;
        calls += 1;
        if (slot === authoritySlot) throw new PreflightObservationChangedError();
        if (mode === "mixed" && slot === secondSlot) throw new Error("config.valid failed during an observation change");
      },
    });
    const request = (commandId: string) => h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", ...SAME_ORIGIN },
      body: JSON.stringify({
        commandId,
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "settings-surface",
        type: "rerun-preflight",
        target: { expectedConfigFingerprint: HASH_B },
      }),
    });

    const authorityOnly = await request("00000000-0000-4000-8000-000000000092");
    assert.equal(authorityOnly.status, 409);
    assert.equal((await json(authorityOnly)).code, "PREFLIGHT_OBSERVATION_CHANGED");

    mode = "mixed";
    const mixed = await request("00000000-0000-4000-8000-000000000093");
    assert.equal(mixed.status, 409);
    assert.equal((await json(mixed)).code, "PREFLIGHT_OBSERVATION_CHANGED");

    mode = "healthy";
    const healthy = await request("00000000-0000-4000-8000-000000000094");
    assert.equal(healthy.status, 200);
    const result = PreflightRerunCommandResultSchema.parse(await healthy.json());
    assert.equal(result.state, "completed");
    assert.equal(result.commandId, "00000000-0000-4000-8000-000000000094");
  });

  it("answers 409 when a detector exceeds its registered timeout", async () => {
    const h = await harness({
      preflightScheduler: { schedule(_deadline, onDeadline) { onDeadline(); return { cancel() {} }; } },
    });
    const response = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", ...SAME_ORIGIN },
      body: JSON.stringify({
        commandId: "00000000-0000-4000-8000-000000000095",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "settings-surface",
        type: "rerun-preflight",
        target: { expectedConfigFingerprint: HASH_B },
      }),
    });
    assert.equal(response.status, 409);
    const body = await json(response);
    assert.equal(body.code, "PREFLIGHT_TIMEOUT");
    assert.equal(body.retryable, false);
    const named = /^A readiness check took too long\. Check again\. \((.+)\)$/u.exec(String(body.message));
    assert.ok(named !== null && requiredPreflightChecks(["dashboard.serve"]).some(check => check === named[1]), String(body.message));
  });

});

import { HASH_B, disposeHttpRouteHarness, harness, json } from "../../../../support/helpers/backend/http-route-harness.js";
afterEach(disposeHttpRouteHarness);
