import { installationAdmission, AuthorityDatabase } from "../admission-fixture.js";
import assert from "node:assert/strict";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { composeDashboardRuntime as composeProductionDashboardRuntime, type DashboardComposeInput, type DashboardRuntime } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { manualClock } from "../../../../src/rules/time/clock.js";





export function createDashboardPortTestWorld() {
  const cleanups: (() => Promise<void> | void)[] = [];

  async function composeDashboardRuntime(input: DashboardComposeInput): Promise<DashboardRuntime> {
    return composeProductionDashboardRuntime({
      ...input,
      admission: input.admission ?? installationAdmission(input.repoRoot ?? process.cwd()),
      backendPortOverride: 0,
      frontendPortOverride: 0,
    });
  }

  function readRuntimeSettingsRevision(repoRoot: string) {
    const database = AuthorityDatabase.open({
      path: join(repoRoot, rebuildRuntimeIsolation.stateRoot, "state.db"),
      busyTimeoutMs: 250,
      migrationOwner: "unit-test",
    });
    try {
      const active = database.authority.runtimeConfig.get();
      assert.ok(active, "the composed dashboard must have an active runtime config");
      return active.settingsRevision;
    } finally {
      database.close();
    }
  }

  function readPersistedSettings(repoRoot: string, clock: ReturnType<typeof manualClock>) {
    const database = AuthorityDatabase.open({ path: join(repoRoot, rebuildRuntimeIsolation.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock);
    try { return readSettings(database.authority); } finally { database.close(); }
  }

  function copyRuntimePackageFixture(repoRoot: string): void {
    copyFileSync(join(process.cwd(), "package.json"), join(repoRoot, "package.json"));
    copyFileSync(join(process.cwd(), "package-lock.json"), join(repoRoot, "package-lock.json"));
  }
  return { cleanups, composeDashboardRuntime, readRuntimeSettingsRevision, readPersistedSettings, copyRuntimePackageFixture };
}
