import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { rmSync } from "node:fs";
import { it, vi } from "vitest";
import * as preferences from "../../../../../src/backend/storage/sqlite/assistant-model-preference.js";
import { AssistantModelPreferenceViewSchema } from "../../../../../src/models/dashboard/assistant.js";
import * as storage from "../../../../../src/backend/app/composition/storage-compose.js";
import { composeDashboardApplication } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { WorkflowExplorerWireSchema } from "../../../../../src/models/dashboard/explorer.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { publicProfileShellFixture, readyPublicSignUp } from "../../../../support/helpers/backend/public-profile-shell.js";
import { composeSettings } from "../../../../../src/backend/app/composition/dashboard/settings.js";
import { activeSettingsRuntimeIdentity } from "../../../../../src/backend/runtime/settings/settings-runtime.js";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { registerSettingsRoutes } from "../../../../../src/backend/transports/http/routes/settings.js";
import { hostConfigFacts } from "../../../../../src/models/config/host-display.js";
import { EditableSettingsWireSchema } from "../../../../../src/models/dashboard/settings-editor.js";
import { SettingsFactsWireSchema } from "../../../../../src/models/dashboard/settings.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { seedInitialSettingsRuntimeConfig } from "../../../../support/fixtures/operator-command-fixtures.js";
import { openBoundDatabaseFixture, syntheticOnboardingDuo } from "../../../../support/helpers/admission-fixture.js";
import { createCredentialStore } from "../../../../support/helpers/synthetic-storage-admission.js";

it("serves the same Settings facts and editable settings while another connection holds the writer reservation", async () => {
  const clock = manualClock(new Date("2026-10-01T12:00:00Z"));
  const fixture = await openBoundDatabaseFixture("request-proofs", clock);
  let writer: DatabaseSync | undefined;
  try {
    seedInitialSettingsRuntimeConfig(fixture.database, clock);
    const { routes } = composeSettings({ database: fixture.database, clock, environment: {}, hostFacts: hostConfigFacts({}),
      active: activeSettingsRuntimeIdentity, credentials: createCredentialStore({ stateRoot: fixture.stateRoot }),
      assertCurrent: () => fixture.profile.admission.assertProfileRuntime() });
    const app: DashboardApp = new Hono();
    app.onError(error => { throw error; });
    registerSettingsRoutes(app, routes);
    const read = async () => {
      const facts = await app.request("/api/v1/settings/facts");
      assert.equal(facts.status, 200);
      const editable = await app.request("/api/v1/settings/editable");
      assert.equal(editable.status, 200);
      return [SettingsFactsWireSchema.parse(await facts.json()), EditableSettingsWireSchema.parse(await editable.json())];
    };
    const expected = await read();
    writer = new DatabaseSync(fixture.path);
    writer.exec("BEGIN IMMEDIATE");
    assert.deepEqual(await read(), expected);
  } finally {
    writer?.close();
    await fixture.close();
  }
});

it("proves mounted reads once, requires the session, and reads one authenticated model preference", async () => {
  const fixture = await publicProfileShellFixture();
  const compose = storage.composeProfileRuntime;
  let proofs = 0;
  const profile = vi.spyOn(storage, "composeProfileRuntime").mockImplementation(input => {
    const runtime = compose(input);
    return { ...runtime, assertCurrent(token) { proofs++; runtime.assertCurrent(token); } };
  });
  let preferenceReads = 0;
  const createPreferences = preferences.createAssistantModelPreferenceRepository;
  const preferenceStore = vi.spyOn(preferences, "createAssistantModelPreferenceRepository").mockImplementation(ports => {
    const repository = createPreferences(ports);
    return { ...repository, get() { preferenceReads++; return repository.get(); } };
  });
  let application: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    application = await composeDashboardApplication({ admission: fixture.machine, lifetimeLock: fixture.lifetime,
      isolation: rebuildRuntimeIsolation, repoRoot: fixture.root, backendPortOverride: 0, frontendPortOverride: 0,
      onboardingDuo: syntheticOnboardingDuo(), env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    const base = `http://127.0.0.1:${application.port}`;
    const activated = await (await readyPublicSignUp(base)).finish();
    assert.equal(activated.status, 200);
    const session = activated.headers.get("x-relay-session");
    assert.ok(session);
    const url = base + "/api/v1/explorer";
    for (let i = 0; i < 2; i++) {
      proofs = 0;
      const response: Response = await fetch(url, { headers: { "x-relay-session": session } });
      assert.equal(response.status, 200);
      WorkflowExplorerWireSchema.parse(await response.json());
      assert.equal(proofs, 1);
      assert.equal((await fetch(url)).status, 401);
    }
    preferenceReads = 0;
    const preference = await fetch(base + "/api/v1/assistant/model-preference", { headers: { "x-relay-session": session } });
    assert.equal(preference.status, 200);
    assert.equal(AssistantModelPreferenceViewSchema.parse(await preference.json()).revision, 0);
    assert.equal(preferenceReads, 1);
  } finally {
    await application?.stop();
    preferenceStore.mockRestore();
    profile.mockRestore();
    fixture.machine.release();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
