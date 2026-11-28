import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { it, vi } from "vitest";
import { resolveConfigWithProvenance } from "../../../../../src/backend/app/config/resolve.js";
import { createComposedDashboardReadHost } from "../../../../../src/backend/app/composition/dashboard/runtime-resources.js";
import { composeSettings } from "../../../../../src/backend/app/composition/dashboard/settings.js";
import type { DashboardReadLanes } from "../../../../../src/backend/storage/sqlite/dashboard-read-host.js";
import { assertRetainedProfileBrowserRoot } from "../../../../../src/backend/storage/maintenance/profile-custody.js";
import { activeSettingsRuntimeIdentity, createProtectedSettingsRuntimeReader } from "../../../../../src/backend/runtime/settings/settings-runtime.js";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { registerSettingsRoutes } from "../../../../../src/backend/transports/http/routes/settings.js";
import { EditableSettingsWireSchema } from "../../../../../src/models/dashboard/settings-editor.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { seedInitialSettingsRuntimeConfig } from "../../../../support/fixtures/operator-command-fixtures.js";
import { COMMAND_FIXTURES, CONFIG_SNAPSHOT, NOW, UUID_1, UUID_3 } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
import { openBoundDatabaseFixture } from "../../../../support/helpers/admission-fixture.js";
import { createCredentialStore } from "../../../../support/helpers/synthetic-storage-admission.js";

it("serves the Settings editor with its store part from the navigation lane, rebuilding the editor when the store, the protected facts or the fiscal year change", async () => {
  const clock = manualClock(new Date(NOW));
  const fixture = await openBoundDatabaseFixture("settings-lane", clock);
  const { database } = fixture;
  const lanes = createComposedDashboardReadHost({ admission: fixture.profile.admission, database, clock });
  try {
    seedInitialSettingsRuntimeConfig(database, clock);
    const hostFacts = { primaryDisplay: null };
    const store = createCredentialStore({ stateRoot: fixture.stateRoot });
    let protectedFailure = false;
    const credentials = { ...store, read: () => { throw new Error("editor read on main"); } };
    const protectedReader = createProtectedSettingsRuntimeReader(store);
    const readProtectedSettings = async () => {
      if (protectedFailure) throw new Error("protected store unreadable");
      return protectedReader.read();
    };
    // Whether each store-part read was served from the lane's cache.
    const storeParts: boolean[] = [];
    const readLanes: Pick<DashboardReadLanes, "read"> = { read: async (definition, args, options) => {
      const reply = await lanes.read(definition, args, options);
      if (definition.id.endsWith("settings-store-part")) storeParts.push(reply.cached);
      return reply;
    } };
    const { routes, editable } = composeSettings({ database, clock, environment: {}, hostFacts, readLanes,
      active: activeSettingsRuntimeIdentity, credentials, readProtectedSettings });
    const app: DashboardApp = new Hono();
    app.onError((error, c) => c.json({ message: error.message }, 500));
    registerSettingsRoutes(app, routes);
    const readEditable = async () => {
      const response = await app.request("/api/v1/settings/editable");
      const body: unknown = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      return EditableSettingsWireSchema.parse(body);
    };
    const noMainRead = () => { throw new Error("main-connection read"); };
    const snapshot = vi.spyOn(database, "withAuthorityReadSnapshot").mockImplementation(noMainRead);
    try {
      const first = await readEditable();
      assert.equal(first.protectedSettings.state, "available");
      assert.equal(first.currentFiscalYear, 2027);
      assert.equal(await editable(), await editable(), "an unchanged store part, protected facts and fiscal year reuse the document");

      protectedFailure = true;
      assert.equal((await readEditable()).protectedSettings.state, "unknown", "a protected-facts change builds again");
      protectedFailure = false;

      clock.setWall(new Date("2027-07-01T17:00:00.000Z"));
      const rolled = await readEditable();
      assert.equal(rolled.currentFiscalYear, 2028, "the fiscal-year rollover builds again");
      assert.ok(rolled.sections.flatMap(section => section.leaves).some(leaf => leaf.path.includes("FY2028")));
      assert.equal(snapshot.mock.calls.length, 0);
    } finally { snapshot.mockRestore(); }

    const active = database.authority.runtimeConfig.get();
    assert.ok(active);
    const resolved = resolveConfigWithProvenance({ urls: { crm: { prod: { ...CONFIG_SNAPSHOT.config.urls.crm.prod, entry: "https://crm.example.test/lane" } } } }, hostFacts, clock);
    const next = { ...CONFIG_SNAPSHOT, configSnapshotId: randomUUID(), capturedAt: NOW,
      config: resolved.config, provenance: resolved.provenance, fingerprint: resolved.fingerprint };
    database.authority.configSnapshots.insert(next);
    database.authority.runtimeConfig.activate({ settingsRevision: active.settingsRevision, settingsFingerprint: active.settingsFingerprint,
      configSnapshotId: next.configSnapshotId, configFingerprint: next.fingerprint, activatedAt: NOW });
    const changed = await readEditable();
    assert.equal(changed.activeConfigFingerprint, next.fingerprint, "a store change builds again");
    assert.equal(changed.runtimeStatus.state, "restart-required");

    // The store part is authenticated against its command and audit rows, so a write to either runs the lane read again.
    await readEditable();
    for (const write of [
      () => database.authority.commands.insert(COMMAND_FIXTURES[0]),
      () => database.authority.commandAudits.insert({ auditId: randomUUID(), request: COMMAND_FIXTURES[0],
        result: { state: "applied", commandId: UUID_1, affectedTargets: [{ family: "start", workflowId: "onboarding", startPlanId: UUID_3, expectedVersion: 1 }] },
        completedAt: NOW, versionChanges: [], affectedDependencyIds: [] }),
    ]) {
      write();
      storeParts.length = 0;
      await readEditable();
      assert.equal(storeParts.length, 1);
      assert.equal(storeParts[0], false, "a backing command or audit write is not served from the warmed store part");
      await readEditable();
      assert.equal(storeParts[1], true, "an unchanged store part is reused");
    }
  } finally {
    await lanes.close();
    await fixture.close();
  }
});

it("checks the browser root's custody at every lane-built editor read, so a root that stops qualifying after startup is refused", async () => {
  const clock = manualClock(new Date(NOW));
  const fixture = await openBoundDatabaseFixture("settings-lane-browser-root", clock);
  const { database } = fixture;
  const lanes = createComposedDashboardReadHost({ admission: fixture.profile.admission, database, clock });
  try {
    const { admission } = fixture.profile;
    const runtimeStoragePair = { stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot };
    seedInitialSettingsRuntimeConfig(database, clock, runtimeStoragePair);
    const { routes } = composeSettings({ database, clock, environment: {}, hostFacts: { primaryDisplay: null }, readLanes: lanes, runtimeStoragePair,
      active: activeSettingsRuntimeIdentity, credentials: createCredentialStore({ stateRoot: fixture.stateRoot }),
      assertBrowserRoot: path => { assertRetainedProfileBrowserRoot(admission, path); } });
    const app: DashboardApp = new Hono();
    app.onError((error, c) => c.json({ message: error.message }, 500));
    registerSettingsRoutes(app, routes);
    const read = () => app.request("/api/v1/settings/editable");
    assert.equal((await read()).status, 200);
    assert.equal((await read()).status, 200, "the reused document passes while the root qualifies");

    const root = join(admission.stateRoot, "browsers");
    rmSync(root, { recursive: true, force: true });
    writeFileSync(root, "", { mode: 0o600 });
    assert.equal((await read()).status, 500, "a root that is no longer a private directory is refused, though the store part is unchanged");
    rmSync(root);
    assert.equal((await read()).status, 200);
  } finally {
    await lanes.close();
    await fixture.close();
  }
});
