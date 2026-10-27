
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { PreflightRerunCommandResultSchema, requiredPreflightChecks } from "../../../../../src/models/preflight/preflight.js";

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
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
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
      "process.orphans",
    ]);
    assert.equal(JSON.stringify(h.preflight.authority.readLatest()), JSON.stringify(result.report));

    const malformed = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
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

  it("keeps preflight body transport and decoding refusals distinguishable", async () => {
    const h = await harness();
    const wrongType = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "text/plain", host: "127.0.0.1:3938" },
      body: "{}",
    });
    assert.equal(wrongType.status, 400);
    assert.equal((await json(wrongType)).code, "PREFLIGHT_CONTENT_TYPE_INVALID");

    const invalidJson = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
      body: "{",
    });
    assert.equal(invalidJson.status, 400);
    assert.equal((await json(invalidJson)).code, "PREFLIGHT_BODY_JSON_INVALID");

    const invalidUtf8 = await h.app.request(new Request("http://127.0.0.1:3938/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
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
          host: "127.0.0.1:3938",
        },
        body: "{}",
      });
      assert.equal(response.status, 400);
      assert.equal((await json(response)).code, "PREFLIGHT_CONTENT_LENGTH_INVALID");
    }

    const missingBody = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
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
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
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
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
      body: JSON.stringify({ padding: "x".repeat(4096) }),
    });

    assert.equal(response.status, 413);
    assert.equal((await json(response)).code, "PREFLIGHT_BODY_TOO_LARGE");
  });

  it("rate-bounds preflight rerun starts within one monotonic window", async () => {
    const h = await harness();
    const request = (index: number) => h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
      body: JSON.stringify({
        commandId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "settings-surface",
        type: "rerun-preflight",
        target: { expectedConfigFingerprint: HASH_B },
      }),
    });

    for (let index = 20; index < 26; index += 1) assert.equal((await request(index)).status, 200);
    const refused = await request(26);
    assert.equal(refused.status, 429);
    assert.equal((await json(refused)).code, "PREFLIGHT_RATE_LIMITED");
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
    const request = (commandId: string) => h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
      body: JSON.stringify({
        commandId,
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "settings-surface",
        type: "rerun-preflight",
        target: { expectedConfigFingerprint: HASH_B },
      }),
    });

    const firstPending = request("00000000-0000-4000-8000-000000000030");
    await started;
    const secondPending = request("00000000-0000-4000-8000-000000000031");
    release();
    const [first, second] = await Promise.all([firstPending, secondPending]);

    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.equal((await json(second)).code, "PREFLIGHT_RERUN_ACTIVE");
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
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
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
    assert.equal((await first).status, 500, "late healthy returns cannot publish a report");
    assert.equal(deadlines.size, 0);
    assert.equal((await request("42")).status, 200, "actual settlement releases admission");
  });

  it("reruns preflight through the closed read-only command and returns the exact report", async () => {
    const h = await harness();
    const response = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
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


});

import { HASH_B, disposeHttpRouteHarness, harness, json } from "../../../../support/helpers/backend/http-route-harness.js";
afterEach(disposeHttpRouteHarness);
