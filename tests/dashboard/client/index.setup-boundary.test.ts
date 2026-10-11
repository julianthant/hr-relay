import { Hono } from "hono";
import assert from "node:assert/strict";
import { it } from "vitest";
import { buildBootstrap } from "../../../src/backend/runs/queries/bootstrap.js";
import type { DashboardApp } from "../../../src/backend/transports/http/routes/api-types.js";
import { registerSettingsPreflightRoutes } from "../../../src/backend/transports/http/routes/settings-preflight.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { createPreflightAuthority,requiredPreflightChecks } from "../../../src/models/preflight/preflight.js";
import { PREFLIGHT_CHECKS } from "../../../src/models/runtime/runtime-dependencies.js";
import { ActorIdSchema,FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { manualClock } from "../../../src/rules/time/clock.js";

it("independent Setup consumer reads production readiness and reruns/replays the real preflight authority", async () => {
  const clock = manualClock(new Date("2026-09-18T12:00:00.000Z")); const fingerprint = FingerprintSchema.parse("a".repeat(64));
  let probes = 0; let unhealthy = false;
  const preflight = createPreflightAuthority({ configFingerprint: fingerprint, clock, requestedCapabilities: ["dashboard.serve"],
    scheduler: { schedule: () => ({ cancel() {} }) },
    runners: requiredPreflightChecks(["dashboard.serve"]).map((check) => {
      const metadata = PREFLIGHT_CHECKS.find((entry) => entry.id === check); assert.ok(metadata);
      return { check, kind: metadata.runner, run: async () => { probes += 1;
        return unhealthy ? { check, state: "unhealthy" as const, summary: "Fixture unavailable", impact: "Unavailable" }
          : { check, state: "healthy" as const, summary: "Fixture ready" }; } };
    }) });
  await preflight.refresh(new AbortController().signal);
  const app: DashboardApp = new Hono();
  app.use("*", async (c, next) => { c.set("requestActorId", ActorIdSchema.parse("local-operator")); await next(); });
  registerSettingsPreflightRoutes(app, { clock, preflight });
  app.get("/api/v1/bootstrap", (c) => c.json(buildBootstrap({ appVersion: "0.1.0", clock, modules: [], descriptorSetHash: fingerprint,
    settingsSchemaHash: fingerprint, projection: { generation: () => 1 }, authorityMeta: () => ({ schemaVersion: 53, authorityGeneration: 1 }),
    backupSummary: () => "missing", preflightReport: () => preflight.readLatest(), })));
  const client = createDashboardClient({ baseUrl: "http://localhost", fetchImpl: async (url, init) => app.request(url, { ...init, headers: { ...init?.headers, host: "localhost" } }) });
  const ready = await client.readiness(); assert.ok(ready.state === "present"); assert.ok(ready.checks.every((check) => check.verdict === "pass"));
  unhealthy = true;
  const request = { commandId: "00000000-0000-4000-8000-000000000001", requestedBy: "local-operator", requestedAt: clock.now().toISOString(), source: "settings-surface",
    type: "rerun-preflight", target: { expectedConfigFingerprint: fingerprint } };
  const result = await client.rerunPreflight(request); assert.ok(result.report.results.some((r) => r.status === "fail"));
  const count = probes; assert.deepEqual(await client.rerunPreflight(request), result); assert.equal(probes, count);
  const blocked = await client.readiness(); assert.ok(blocked.state === "present"); assert.ok(blocked.checks.some((c) => c.verdict === "fail"));
  await assert.rejects(client.rerunPreflight({ ...request, commandId: "00000000-0000-4000-8000-000000000002", target: { expectedConfigFingerprint: "b".repeat(64) } }));
  assert.equal(probes, count, "stale config cannot invoke a detector");
});
