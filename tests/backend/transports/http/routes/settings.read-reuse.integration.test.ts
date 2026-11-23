import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../../src/backend/app/config/resolve.js";
import { composeSettings } from "../../../../../src/backend/app/composition/dashboard/settings.js";
import { createDebugEventWriter } from "../../../../../src/backend/logs/debug-events.js";
import { activeSettingsRuntimeIdentity } from "../../../../../src/backend/runtime/settings/settings-runtime.js";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { registerSettingsRoutes } from "../../../../../src/backend/transports/http/routes/settings.js";
import { SettingsFactsWireSchema } from "../../../../../src/models/dashboard/settings.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { seedInitialSettingsRuntimeConfig } from "../../../../support/fixtures/operator-command-fixtures.js";
import { COMMAND_FIXTURES, CONFIG_SNAPSHOT, NOW, UUID_1, UUID_3 } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
import { openBoundDatabaseFixture } from "../../../../support/helpers/admission-fixture.js";
import { createCredentialStore } from "../../../../support/helpers/synthetic-storage-admission.js";

it("revalidates the admitted settings facts against each of their four authority tables", async () => {
  const clock = manualClock(new Date(NOW));
  const fixture = await openBoundDatabaseFixture("settings-read-reuse", clock);
  const { database } = fixture;
  try {
    seedInitialSettingsRuntimeConfig(database, clock);
    let current = true;
    const hostFacts = { primaryDisplay: null };
    const { routes } = composeSettings({ database, clock, environment: {}, hostFacts,
      active: activeSettingsRuntimeIdentity, credentials: createCredentialStore({ stateRoot: fixture.stateRoot }),
      assertCurrent() { if (!current) throw new Error("profile-retired"); } });
    const app: DashboardApp = new Hono();
    app.onError(() => new Response(null, { status: 500 }));
    registerSettingsRoutes(app, routes);
    const read = (tag?: string) => app.request("/api/v1/settings/facts", tag ? { headers: { "If-None-Match": tag } } : {});
    const first = await read();
    assert.equal(first.status, 200);
    const original = SettingsFactsWireSchema.parse(await first.json());
    let tag = first.headers.get("ETag");
    assert.ok(tag);
    const debug = createDebugEventWriter({ repository: database.authority.timelineEvents, clock, build: "0.1.0" });
    assert.equal(debug.emit({ category: "boot", phase: "failed", correlationId: randomUUID(),
      area: "integration", reason: "unrelated-timeline-write" }).state, "inserted");
    assert.equal((await read(tag)).status, 304);

    const active = database.authority.runtimeConfig.get();
    assert.ok(active);
    const systemUrl = "https://crm.example.test/entry";
    const resolved = resolveConfigWithProvenance({ urls: { crm: { prod: { ...CONFIG_SNAPSHOT.config.urls.crm.prod, entry: systemUrl } } } }, hostFacts, clock);
    const snapshot = { ...CONFIG_SNAPSHOT, configSnapshotId: randomUUID(), capturedAt: NOW,
      config: resolved.config, provenance: resolved.provenance, fingerprint: resolved.fingerprint };
    for (const write of [
      () => database.authority.commands.insert(COMMAND_FIXTURES[0]),
      () => database.authority.commandAudits.insert({ auditId: randomUUID(), request: COMMAND_FIXTURES[0],
        result: { state: "applied", commandId: UUID_1, affectedTargets: [{ family: "start", workflowId: "onboarding", startPlanId: UUID_3, expectedVersion: 1 }] },
        completedAt: NOW, versionChanges: [], affectedDependencyIds: [] }),
      () => database.authority.configSnapshots.insert(snapshot),
    ]) {
      write();
      const response = await read(tag);
      assert.equal(response.status, 200);
      assert.deepEqual(SettingsFactsWireSchema.parse(await response.json()), original);
      const next = response.headers.get("ETag");
      assert.ok(next && next !== tag);
      tag = next;
    }
    database.authority.runtimeConfig.activate({ settingsRevision: active.settingsRevision, settingsFingerprint: active.settingsFingerprint,
      configSnapshotId: snapshot.configSnapshotId, configFingerprint: snapshot.fingerprint, activatedAt: NOW });
    const changed = await read(tag);
    assert.equal(changed.status, 200);
    const facts = SettingsFactsWireSchema.parse(await changed.json());
    assert.equal(facts.systemHosts.find(host => host.system === "crm")?.production, systemUrl);
    const latest = changed.headers.get("ETag");
    assert.ok(latest);
    current = false;
    assert.equal((await read(latest)).status, 500);
  } finally { await fixture.close(); }
});

// Select the unchanged schema-39 sweep case in task CI.
