import { RuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { createBoundProfileFixture } from '../../support/helpers/admission-fixture.js';
import { composeProfileRuntime } from '../../../src/backend/app/composition/storage-compose.js';
import { retainAuthoritySourceClosure } from '../../../src/backend/storage/source-closure.js';
import { PARITY_BUILD_COMMAND } from "../../../src/backend/app/composition/dashboard/build-identity.js";
import type { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { copyFileSync, cpSync, mkdirSync } from "node:fs";

import { join } from "node:path";
import { manualClock } from "../../../src/rules/time/clock.js";
import { composeDashboardRuntime } from "../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { PARITY_DIST_DIR, PARITY_REPO_ROOT, assertServedBundle } from "./bundle.js";

/** Real composition and command routes on a private, disposable authority. */
const retainedSettingsParityOwners = new Set<object>();
export async function startSettingsActivationServer() {
  assertServedBundle(PARITY_DIST_DIR, { proof: "working-tree" });
  const clock = manualClock(new Date("2026-09-09T12:00:00.000Z"));
  const fixture = await createBoundProfileFixture({ sharedMachine: true });
  const root = fixture.workspace;
  const held: { fixture: typeof fixture; machine?: RuntimeAdmission; profile?: ReturnType<typeof composeProfileRuntime>;
    runtime?: Awaited<ReturnType<typeof composeDashboardRuntime>>; lock?: RuntimeLifetimeLock; primary?: unknown } = { fixture };
  retainedSettingsParityOwners.add(held);
  try {
    for (const name of ["package.json", "package-lock.json", "vite.dashboard.config.ts", "vite.parity.config.ts", "tsconfig.json"])
      copyFileSync(join(PARITY_REPO_ROOT, name), join(root, name));
    cpSync(join(PARITY_REPO_ROOT, "src"), join(root, "src"), { recursive: true });
    for (const name of ["config/dashboard-workflow-sources.json", "tests/parity/app-entry.tsx", "tests/parity/helpers/workflow-composition.ts"]) {
      mkdirSync(join(root, name, ".."), { recursive: true });
      copyFileSync(join(PARITY_REPO_ROOT, name), join(root, name));
    }
    mkdirSync(join(root, "dist"));
    cpSync(PARITY_DIST_DIR, join(root, "dist", "dashboard"), { recursive: true });
    const machine = acquireEntrypointAdmission(root, "shared", fixture.lifetime);
    held.machine = machine;
    const profile = composeProfileRuntime({ admission: machine, clock, hostFacts: { primaryDisplay: null } });
    held.profile = profile;
    const active = profile.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
    if (active.state !== 'active') throw new Error('parity-profile-sign-in-refused');
    if (active.profileId !== fixture.admission.profileBinding.profileId) throw new Error('parity-profile-binding-mismatch');
    const lock = fixture.lifetime;
    held.lock = lock;
    const runtime = await composeDashboardRuntime({ lifetimeLock: lock, admission: machine, profile: { runtime: profile, token: active.token }, clock,
      isolation: rebuildRuntimeIsolation,
      repoRoot: root,
      env: { HRAUTO_HOST_PRIMARY_DISPLAY: "2560x1440" },
      backendPortOverride: 0,
      frontendPortOverride: 0,
      frontend: "built-bundle",
      frontendBuildScript: PARITY_BUILD_COMMAND });
    held.runtime = runtime;
    let stopPromise: Promise<void> | undefined;
    return { url: `http://127.0.0.1:${runtime.port}`, root, stateRoot: fixture.stateRoot,
      profileId: active.profileId,
      protectedRevision: () => {
        profile.assertCurrent(active.token);
        const current = profile.selectedContext(active.token);
        if (current.admission.profileBinding.profileId !== active.profileId) throw new Error('parity-profile-binding-mismatch');
        const revision = current.credentials.read().revision;
        current.assertCurrent(); profile.assertCurrent(active.token);
        return revision;
      },
      stop: () => {
        if (stopPromise !== undefined) return stopPromise;
        stopPromise = (async () => {
          try {
            await runtime.stop();
            await profile.close();
            machine.release();
            await fixture.close();
            retainedSettingsParityOwners.delete(held);
          } catch (error) { held.primary = error; throw retainAuthoritySourceClosure([error], { admission: held }); }
        })();
        return stopPromise;
      } };
  } catch (error) { held.primary = error; throw retainAuthoritySourceClosure([error], { admission: held }); }
}
