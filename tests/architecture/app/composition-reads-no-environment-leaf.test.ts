import { runtimeLifetimeLock } from "../../support/helpers/backend/runtime-lifetime.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { composeProfileRuntime, composeSelectedProfileStorage } from "../../../src/backend/app/composition/storage-compose.js";
import { ManualScheduler } from "../../support/helpers/phase1f-executor-harness.js";
import { readSettings } from "../../../src/backend/runtime/settings/settings-runtime.js";
import { fixtureAdmission, createBoundProfileFixture, boundProfileCredentials, releaseAdmissionFixture, releaseAdmissionFixtures } from "../../support/helpers/admission-fixture.js";
import { healthyRuntimePreflightRunners } from "../../support/fixtures/preflight-seams.js";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { MIGRATED_SETTINGS_ENVIRONMENT_KEYS, RETIRED_TEST_TARGET_ENVIRONMENT_KEYS } from "../../../src/models/config/catalog.js";
import { resolveConfigWithProvenance } from "../../../src/backend/app/config/resolve.js";
import { hostConfigFacts } from "../../../src/models/config/host-display.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { duoCeremonyGatesOver } from "../../support/helpers/duo-ceremony-fixtures.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { composeDashboardRuntime } from "../../../src/backend/app/composition/dashboard/compose.js";
import { composeWorkerRuntime } from "../../../src/backend/app/composition/worker-compose.js";
import { inventoryEnvironmentAccesses } from "../runtime/helpers/environment-read-audit.js";
import { gitVisibleFiles, REPO_ROOT } from "../support/helpers/guard-files.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) { releaseAdmissionFixture(root); rmSync(root, { recursive: true, force: true }); } releaseAdmissionFixtures(); });
const clock = manualClock(new Date("2026-09-06T07:00:00.000Z"));
function environment(key: string) {
  let reads = 0;
  const env: NodeJS.ProcessEnv = {};
  Object.defineProperty(env, key, { enumerable: true, get: () => { reads += 1; throw new Error("forbidden value read"); } });
  return { env, reads: () => reads };
}
function resolverViolations(path: string, source: string): readonly string[] {
  return inventoryEnvironmentAccesses(path, source).map(({ operation }) => `${path}: resolver environment ${operation} is forbidden`);
}

describe("composition-reads-no-environment-leaf", () => {
  it("walks every config module and rejects direct, aliased and computed process environment access", () => {
    const paths = gitVisibleFiles(["src/models/config", "src/backend/app/config"]).filter((path) => path.endsWith(".ts") && path !== "src/models/config/secrets.ts");
    assert.ok(paths.includes("src/backend/app/config/resolve.ts"));
    assert.equal(paths.includes("src/models/config/secrets.ts"), false);
    assert.ok(resolverViolations("src/models/config/future.ts", "export const value = process.env.UCPATH_PASSWORD;").length > 0);
    assert.deepEqual(paths.flatMap((path) => resolverViolations(path, readFileSync(join(REPO_ROOT, path), "utf8"))), []);
    for (const source of ["const value = process.env.HRAUTO_DEFAULT_WORKERS;", "const env = process.env; const value = env[key];", "delete process.env.UCPATH_PASSWORD;"])
      assert.ok(resolverViolations("src/backend/app/config/resolve.ts", source).length > 0, source);
  });
  it("keeps non-retired hostile noise outside config and provenance with zero accessor reads", () => {
    const noise = environment("UNRELATED_HOSTILE_NOISE");
    assert.equal(MIGRATED_SETTINGS_ENVIRONMENT_KEYS.includes("UNRELATED_HOSTILE_NOISE"), false);
    const ordinary = { concurrency: { defaultWorkers: 3 } };
    const clean = resolveConfigWithProvenance(ordinary, hostConfigFacts({}), clock);
    const noisy = resolveConfigWithProvenance(ordinary, hostConfigFacts(noise.env), clock);
    assert.deepEqual(noisy, clean);
    assert.equal(noise.reads(), 0);
  });
  it("production dashboard and worker resolve the same config under non-retired hostile noise", async () => {
    const configs: unknown[] = [];
    for (const noisy of [false, true]) for (const role of ["dashboard", "worker"] as const) {
      const f = await createBoundProfileFixture(), root = f.workspace;
      const profileClock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
      const profile = role === "dashboard" ? composeProfileRuntime({ admission: f.machine, clock: profileClock, hostFacts: { primaryDisplay: null } }) : undefined;
      let context: ReturnType<typeof composeSelectedProfileStorage> | undefined;
      let dashboard: Awaited<ReturnType<typeof composeDashboardRuntime>> | undefined;
      try {
      const active = profile?.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: profileClock.now().toISOString() });
      if (profile !== undefined && active?.state !== "active") throw new Error("environment-profile-sign-in-required");
      context = profile !== undefined && active?.state === "active" ? profile.selectedContext(active.token)
        : composeSelectedProfileStorage({ machineAdmission: f.machine, admission: f.admission, credentials: boundProfileCredentials(f.admission),
          hostFacts: { primaryDisplay: null }, clock: profileClock });
      for (const name of ["package.json", "package-lock.json"])
        writeFileSync(join(root, name), readFileSync(join(REPO_ROOT, name)));
      const hostile = environment("UNRELATED_HOSTILE_NOISE");
      const env = noisy ? hostile.env : {};
      const common = { isolation: rebuildRuntimeIsolation, repoRoot: root, env, clock: profileClock };
      if (profile !== undefined && active?.state === "active") dashboard = await composeDashboardRuntime({ lifetimeLock: await runtimeLifetimeLock(), ...common, admission: f.machine, profile: { runtime: profile, token: active.token }, preflightRunnerFactory: healthyRuntimePreflightRunners, backendPortOverride: 0, frontendPortOverride: 0 });
      const selectedContext = context;
      const path = join(f.stateRoot, "state.db");
      const readConfig = () => {
        const database = AuthorityDatabase.open(selectedContext.admission, { path, busyTimeoutMs: 100, migrationOwner: "unit-test" }, profileClock, undefined, undefined, undefined, selectedContext.credentials);
        try {
          const active = database.authority.runtimeConfig.get(); assert.ok(active);
          const snapshot = database.authority.configSnapshots.get(active.configSnapshotId); assert.ok(snapshot);
          return { config: snapshot.config, provenance: snapshot.provenance, fingerprint: snapshot.fingerprint };
        } finally { database.close(); }
      };
      const before = readConfig();
      const database = AuthorityDatabase.open(selectedContext.admission, { path, busyTimeoutMs: 100, migrationOwner: "noise-resolution-proof" }, profileClock, undefined, undefined, undefined, selectedContext.credentials);
      try {
        const ordinary = readSettings(database.authority).settings;
        const pair = { stateRoot: f.stateRoot, artifactRoot: join(f.stateRoot, "artifacts") };
        const clean = resolveConfigWithProvenance(ordinary, hostConfigFacts({}), profileClock, pair);
        const noisyResolution = resolveConfigWithProvenance(ordinary, hostConfigFacts(hostile.env), profileClock, pair);
        assert.deepEqual(noisyResolution, clean);
        assert.deepEqual(before, clean);
      } finally { database.close(); }
      if (role === "worker") {
      const worker = await composeWorkerRuntime({ lifetimeLock: await runtimeLifetimeLock(), ...common, admission: f.machine, preflightRunnerFactory: healthyRuntimePreflightRunners, args: ["person-lookup", "--pool-index", "1", "--drain"],
        duoCeremony: duoCeremonyGatesOver(selectedContext.database, profileClock, new ManualScheduler(profileClock)),
        sessionFactory: { probeProfile: async () => undefined, open: () => { throw new Error("no browser may open for idle proof"); } }, write: () => undefined });
      assert.deepEqual(worker.outcomes, []);
      assert.equal(worker.stopped, "idle");
      }
      assert.deepEqual(readConfig(), before);
      assert.equal(hostile.reads(), 0);
      assert.equal(before.config.paths.stateRoot, f.stateRoot);
      assert.equal(before.config.paths.artifactRoot, join(f.stateRoot, "artifacts"));
      assert.equal(before.config.paths.browserProfileRoot, join(f.stateRoot, "browsers"));
      assert.equal(before.config.paths.duoCredential, join(f.stateRoot, "credentials", "duo-webauthn.json"));
      configs.push({ config: { ...before.config, paths: { ...before.config.paths,
        stateRoot: "owned-state-root", artifactRoot: "owned-artifact-root", browserProfileRoot: "owned-browser-root", duoCredential: "owned-duo-credential" } }, provenance: before.provenance });
      } finally {
        if (dashboard !== undefined) await dashboard.stop();
        else if (profile !== undefined) await profile.close();
        else if (context !== undefined) { await context.account.close(); context.database.close(); }
        await f.close();
      }
    }
    for (const config of configs.slice(1)) assert.deepEqual(config, configs[0]);
  });
  it.each(MIGRATED_SETTINGS_ENVIRONMENT_KEYS)("refuses retired %s at every composition before value/authority/browser/spawn access", async (key) => {
    const root = mkdtempSync(join(tmpdir(), "hr-env-refusal-")); roots.push(root);
    writeFileSync(join(root, "package.json"), '{"version":"0.1.0"}');
    const hostile = environment(key);
    const common = { admission: fixtureAdmission(root), isolation: rebuildRuntimeIsolation, repoRoot: root, env: hostile.env, clock };

    const expected = (RETIRED_TEST_TARGET_ENVIRONMENT_KEYS as readonly string[]).includes(key)
      ? `retired test-target environment key ${key} is refused; test-target inputs live in config/test-data.local.json, so remove it`
      : `migrated environment key ${key} is refused; set it in Settings, then remove it`;
    const refuse = (error: unknown): boolean => error instanceof Error && error.message === expected;
    await assert.rejects(composeDashboardRuntime({ lifetimeLock: await runtimeLifetimeLock(), ...common, backendPortOverride: 0, frontendPortOverride: 0 }), refuse);
    await assert.rejects(composeWorkerRuntime({ lifetimeLock: await runtimeLifetimeLock(), ...common, args: ["person-lookup", "--pool-index", "1", "--drain"] }), refuse);
    assert.equal(hostile.reads(), 0);
    assert.deepEqual(readdirSync(root), ["package.json"]);
  });
});
