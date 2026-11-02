import type { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase as CanonicalAuthorityDatabase, AuthorityDatabaseOptionsSchema } from "../../../../src/backend/storage/sqlite/authority-database.js";
import type { Clock } from "../../../../src/rules/time/clock.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { composeProfileRuntime } from "../../../../src/backend/app/composition/storage-compose.js";
import { installationAdmission, createBoundProfileFixture } from "../admission-fixture.js";
import assert from "node:assert/strict";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { composeDashboardRuntime as composeProductionDashboardRuntime, type DashboardComposeInput, type DashboardRuntime } from "../../../../src/backend/app/composition/dashboard/compose.js";

import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { manualClock } from "../../../../src/rules/time/clock.js";


export function createDashboardPortTestWorld(resetMocks: () => void, releaseAdmissionFixtures: () => void) {
  const cleanups: (() => Promise<void> | void)[] = [];

  async function composeDashboardRuntime(input: DashboardComposeInput): Promise<DashboardRuntime> {
    return composeProductionDashboardRuntime({
      ...input,
      admission: input.admission ?? installationAdmission(input.repoRoot ?? process.cwd(), input.lifetimeLock),
      backendPortOverride: 0,
      frontendPortOverride: 0,
    });
  }

  async function createProfileFixture(clock: Clock) {
    const fixture = await createBoundProfileFixture({ sharedMachine: true });
    const profileClosures: (() => Promise<void>)[] = [];
    cleanups.push(async () => {
      for (const close of profileClosures.toReversed()) await close();
      await fixture.close();
    });
    copyRuntimePackageFixture(fixture.workspace);
    function selectProfile() {
      const machine = acquireEntrypointAdmission(fixture.workspace, "shared", fixture.lifetime);
      const storage: { admission?: RuntimeAdmission } = {};
      let runtime: ReturnType<typeof composeProfileRuntime> | undefined = undefined;
      let closed = false;
      const close = async () => {
        if (closed) return;
        await runtime?.close();
        storage.admission?.release();
        machine.release();
        closed = true;
      };
      profileClosures.push(close);
      runtime = composeProfileRuntime({ admission: machine, clock, hostFacts: { primaryDisplay: null } });
      const active = runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
      assert.equal(active.state, "active");
      if (active.state !== "active") throw new Error("fixture-profile-sign-in-required");
      const admission = machine.admitProfile(active.profileId);
      storage.admission = admission;
      const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot,
        });
      return { machine, runtime, token: active.token, admission, credentials, close };
    }
    let selected = selectProfile();
    return {
      workspace: fixture.workspace,
      lifetime: fixture.lifetime,
      stateRoot: fixture.stateRoot,
      get artifactRoot() { return selected.admission.artifactRoot; },
      get dashboardInput() {
        return { clock, admission: selected.machine, profile: { runtime: selected.runtime, token: selected.token } };
      },
      openDatabase(input: unknown, readClock: Clock = clock) {
        const options = AuthorityDatabaseOptionsSchema.parse(input);
        assert.equal(options.path, join(fixture.stateRoot, "state.db"));
        return CanonicalAuthorityDatabase.open(selected.admission, options, readClock, undefined, undefined, undefined, selected.credentials);
      },
      async restart() {
        await selected.close();
        selected = selectProfile();
      },
    };
  }

  function readRuntimeSettingsRevision(fixture: Awaited<ReturnType<typeof createProfileFixture>>) {
    const database = fixture.openDatabase({
      path: join(fixture.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test",
    });
    try {
      const active = database.authority.runtimeConfig.get();
      assert.ok(active, "the composed dashboard must have an active runtime config");
      return active.settingsRevision;
    } finally { database.close(); }
  }

  function readPersistedSettings(fixture: Awaited<ReturnType<typeof createProfileFixture>>, clock: ReturnType<typeof manualClock>) {
    const database = fixture.openDatabase({ path: join(fixture.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock);
    try { return readSettings(database.authority); } finally { database.close(); }
  }

  function copyRuntimePackageFixture(repoRoot: string): void {
    copyFileSync(join(process.cwd(), "package.json"), join(repoRoot, "package.json"));
    copyFileSync(join(process.cwd(), "package-lock.json"), join(repoRoot, "package-lock.json"));
  }
  const cleanup = async () => {
    resetMocks();

    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    releaseAdmissionFixtures();
  };
  return { cleanups, createProfileFixture, composeDashboardRuntime, readRuntimeSettingsRevision, readPersistedSettings, copyRuntimePackageFixture, cleanup };
}
