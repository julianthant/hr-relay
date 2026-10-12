import { createDashboardPortTestWorld } from "../../../../support/helpers/backend/dashboard-port-world.js";
import { fixtureAdmission, releaseAdmissionFixture, releaseAdmissionFixtures } from "../../../../support/helpers/admission-fixture.js";
import assert from "node:assert/strict";
import { once } from "node:events";
import { copyFileSync, cpSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, vi } from "vitest";
import { writeDashboardBuildIdentity } from "../../../../../src/backend/app/composition/dashboard/build-identity.js";
import { type DashboardRuntime } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { DESCRIPTORS } from "../../../../../src/backend/app/registries/workflow-registry.js";
import { createDashboardClient, type DashboardClient, type SubscriptionState } from "../../../../../src/dashboard/client/index.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../../src/models/config/protected-settings.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../../src/models/config/settings.js";
import { ProtectedSettingsCommandRequestSchema } from "../../../../../src/rules/commands/commands.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { settingsSetOperations } from "../../../../support/fixtures/settings-operation-fixtures.js";

const { cleanups, composeDashboardRuntime, readRuntimeSettingsRevision, readPersistedSettings, copyRuntimePackageFixture } = createDashboardPortTestWorld();


function reportRealPortPhase(
  phase: "startup" | "request" | "teardown",
  state: "begin" | "complete",
): void {
  process.stdout.write(`[compose-real-port] ${phase}:${state}\n`);
}

function protectedSettingsCommand(
  commandId: string,
  requestedAt: string,
  expectedRevision: number,
  writeId: string,
  value: string,
) {
  return ProtectedSettingsCommandRequestSchema.parse({
    commandId,
    requestedAt,
    requestedBy: "local-operator",
    source: "settings-surface",
    family: "settings",
    type: "apply-protected-settings",
    target: { expectedRevision },
    payload: {
      protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
      writeId,
      entries: { ucpathPassword: { set: value } },
    },
  });
}

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    fsyncSync: vi.fn(actual.fsyncSync),
    readFileSync: vi.fn(actual.readFileSync),
    openSync: vi.fn(actual.openSync),
    mkdirSync: vi.fn(actual.mkdirSync),
  };
});

afterEach(async () => {
  vi.mocked(fsyncSync).mockReset();
  vi.mocked(readFileSync).mockReset();
  vi.mocked(openSync).mockReset();
  vi.mocked(mkdirSync).mockReset();
  vi.restoreAllMocks();

  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  releaseAdmissionFixtures();
});

describe("composed dashboard runtime over an owned loopback socket", () => {

  it("refuses persisted protected write-id reuse after a dashboard restart", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-protected-write-id-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    const clock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
    const writeId = "77777777-7777-4777-8777-777777777777";
    let runtime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      clock,
      repoRoot,
    });
    cleanups.push(() => runtime.stop());
    const firstClient = createDashboardClient({
      baseUrl: `http://127.0.0.1:${String(runtime.port)}`,
    });
    const first = await firstClient.executeCommand(protectedSettingsCommand(
      "33333333-3333-4333-8333-333333333333",
      clock.now().toISOString(),
      1,
      writeId,
      "first-synthetic-protected-value",
    ));
    assert.equal(first.state, "applied");
    const protectedPath = join(repoRoot, rebuildRuntimeIsolation.stateRoot, "credentials", "protected.json");
    const committedBytes = readFileSync(protectedPath);

    await runtime.stop();
    runtime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      clock,
      repoRoot,
    });
    const restartedClient = createDashboardClient({
      baseUrl: `http://127.0.0.1:${String(runtime.port)}`,
    });
    const reused = await restartedClient.executeCommand(protectedSettingsCommand(
      "55555555-5555-4555-8555-555555555555",
      clock.now().toISOString(),
      2,
      writeId,
      "second-synthetic-protected-value",
    ));

    assert.equal(reused.state, "rejected");
    if (reused.state === "rejected") {
      assert.equal(reused.code, "command-divergent");
      assert.equal(reused.message, "credential command or write identity differs from its persisted request");
    }
    assert.deepEqual(readFileSync(protectedPath), committedBytes);
  });

  it("creates the artifact root as an owner-only directory", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-private-artifacts-"));
    copyFileSync(join(process.cwd(), "package.json"), join(repoRoot, "package.json"));
    copyFileSync(join(process.cwd(), "package-lock.json"), join(repoRoot, "package-lock.json"));
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    const runtime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      frontendPortOverride: 0,
      env: {},
      repoRoot,
    });
    cleanups.push(() => runtime.stop());

    const permissions = statSync(join(repoRoot, rebuildRuntimeIsolation.artifactRoot)).mode & 0o777;
    assert.equal(permissions, 0o700);
  });

  it("activates a saved revision immediately and retains it through restart", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-settings-"));
    copyFileSync(join(process.cwd(), "package.json"), join(repoRoot, "package.json"));
    copyFileSync(join(process.cwd(), "package-lock.json"), join(repoRoot, "package-lock.json"));
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    const commandId = "72727272-7272-4272-8272-727272727272";
    const patch = settingsSetOperations({ display: { screenWidth: 1980, screenHeight: 1080 } });
    const command = {
      commandId,
      requestedAt: new Date().toISOString(),
      requestedBy: "local-operator",
      source: "settings-surface",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch),
        patch,
      },
    } as const;

    const first = await composeDashboardRuntime({
      frontendPortOverride: 0,
      isolation: rebuildRuntimeIsolation,
      env: {},
      repoRoot,
      backendPortOverride: 0,
    });
    try {
      const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(first.port)}` });
      const before = await client.editableSettings();
      assert.equal(before.revision, 1);
      const applied = await client.applySettings(command);
      assert.equal(applied.state, "applied");
      if (applied.state === "applied") assert.equal(applied.restartRequired, false);
      const readback = await client.editableSettings();
      assert.equal(readback.revision, 2);
      assert.equal(readback.runtimeStatus.state, "current");
      const screenWidth = readback.sections.flatMap((section) => section.leaves).find((leaf) => leaf.path === "display.screenWidth");
      assert.equal(screenWidth?.effectiveValue, 1980);
      assert.equal(screenWidth?.settingsValue, 1980);
      assert.equal(readPersistedSettings(repoRoot, manualClock(new Date(command.requestedAt))).settings.display?.screenWidth, 1980);
      assert.equal(readRuntimeSettingsRevision(repoRoot), 2);
      const replay = await client.applySettings(command);
      assert.equal(replay.state, "already-applied");
      if (replay.state === "already-applied") assert.equal(replay.restartRequired, false);
    } finally {
      await first.stop();
    }

    const restarted = await composeDashboardRuntime({
      frontendPortOverride: 0,
      isolation: rebuildRuntimeIsolation,
      env: {},
      repoRoot,
      backendPortOverride: 0,
    });
    try {
      assert.equal(readRuntimeSettingsRevision(repoRoot), 2);
      const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(restarted.port)}` });
      const readback = await client.editableSettings();
      assert.equal(readback.runtimeStatus.state, "current");
      assert.equal(readback.revision, 2);
    } finally {
      await restarted.stop();
    }
  }, 20_000);

  it("serves bootstrap, day, and SSE through a real ephemeral listener and releases it at teardown", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-"));
    copyFileSync(join(process.cwd(), "package.json"), join(repoRoot, "package.json"));
    copyFileSync(join(process.cwd(), "package-lock.json"), join(repoRoot, "package-lock.json"));
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));

    reportRealPortPhase("startup", "begin");
    const runtime: DashboardRuntime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      frontendPortOverride: 0,
      env: {},
      repoRoot,
    });
    let subscription: ReturnType<DashboardClient["subscribeDay"]> | undefined;
    const failures: unknown[] = [];
    try {
      assert.notEqual(runtime.port, 0);
      assert.notEqual(runtime.port, rebuildRuntimeIsolation.backendPort);
      reportRealPortPhase("startup", "complete");

      reportRealPortPhase("request", "begin");
      const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(runtime.port)}` });
      const bootstrap = await client.bootstrap();
      assert.equal(bootstrap.appVersion, "0.1.0");

      assert.deepEqual(
        (bootstrap.workflows as { id: string }[]).map(({ id }) => id).toSorted(),
        DESCRIPTORS.map(({ id }) => id).toSorted(),
      );
      assert.equal(bootstrap.storage.authority, "healthy");

      const today = new Date().toISOString().slice(0, 10);
      const day = await client.dashboardDay(today);
      assert.deepEqual(day.queueSurfaces, []);
      assert.deepEqual(day.workflowCounts, []);

      const states: SubscriptionState[] = [];
      let sawDay = false;
      const liveWithDay = new Promise<void>((resolve) => {
        subscription = client.subscribeDay({
          day: today,
          onDay: (received) => {
            assert.equal(received.day, today);
            sawDay = true;
          },
          onState: (state) => {
            states.push(state);
            if (state.state === "live" && sawDay) resolve();
          },
        });
      });
      await liveWithDay;
      assert.equal(states[0]?.state, "connecting");
      reportRealPortPhase("request", "complete");
    } catch (error: unknown) {
      failures.push(error);
    }

    reportRealPortPhase("teardown", "begin");
    try {
      subscription?.close();
    } catch (error: unknown) {
      failures.push(error);
    }
    try {
      await runtime.stop();
    } catch (error: unknown) {
      failures.push(error);
    }

    const releasedPortProbe = createServer();
    try {
      releasedPortProbe.listen(runtime.port, "127.0.0.1");
      await once(releasedPortProbe, "listening");
    } catch (error: unknown) {
      failures.push(error);
    } finally {
      if (releasedPortProbe.listening) {
        try {
          releasedPortProbe.close();
          await once(releasedPortProbe, "close");
        } catch (error: unknown) {
          failures.push(error);
        }
      }
    }
    if (failures.length === 0) reportRealPortPhase("teardown", "complete");
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, "real-port lifecycle observed multiple failures", {
        cause: failures[0],
      });
    }
  }, 20_000);
  it("built-bundle mode refuses to compose without dist/dashboard/index.html, and serves the bundle beside the API when it exists", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-built-bundle-"));
    copyRuntimePackageFixture(repoRoot);
    cpSync(join(process.cwd(), "src"), join(repoRoot, "src"), { recursive: true });
    mkdirSync(join(repoRoot, "config"), { recursive: true });
    copyFileSync(join(process.cwd(), "config", "dashboard-workflow-sources.json"), join(repoRoot, "config", "dashboard-workflow-sources.json"));
    copyFileSync(join(process.cwd(), "vite.dashboard.config.ts"), join(repoRoot, "vite.dashboard.config.ts"));
    copyFileSync(join(process.cwd(), "tsconfig.json"), join(repoRoot, "tsconfig.json"));
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));

    // No bundle: refuse before any authority, lock or socket exists.
    await assert.rejects(
      composeDashboardRuntime({ admission: fixtureAdmission(repoRoot),
        isolation: rebuildRuntimeIsolation,
        backendPortOverride: 0,
        env: {},
        clock: manualClock(new Date("2026-08-28T12:00:00.000Z")),
        repoRoot,
        frontend: "built-bundle",
      }),
      /npm run web:build/u,
    );
    assert.equal(existsSync(join(repoRoot, rebuildRuntimeIsolation.stateRoot, "state.db")), false, "a refused built-bundle composition opens no authority");

    const dist = join(repoRoot, "dist", "dashboard", "assets");
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(repoRoot, "dist", "dashboard", "index.html"), "<!doctype html><title>built</title>");
    writeFileSync(join(dist, "app.f00d.js"), "export const built = true;");
    writeDashboardBuildIdentity({ repoRoot, distDir: join(repoRoot, "dist", "dashboard") });
    const runtime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      clock: manualClock(new Date("2026-08-28T12:00:00.000Z")),
      repoRoot,
      frontend: "built-bundle",
    });
    cleanups.push(() => runtime.stop());
    const base = `http://127.0.0.1:${String(runtime.port)}`;

    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    assert.equal(index.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(index.headers.get("cache-control"), "no-cache");
    assert.match(await index.text(), /<title>built<\/title>/u);
    const asset = await fetch(`${base}/assets/app.f00d.js`);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get("cache-control"), "public, max-age=31536000, immutable");
    const spa = await fetch(`${base}/archive`);
    assert.equal(spa.status, 200);
    assert.match(await spa.text(), /<title>built<\/title>/u);
    const api = await fetch(`${base}/api/v1/bootstrap`);
    assert.equal(api.status, 200);
    assert.match(api.headers.get("content-type") ?? "", /application\/json/u);
    const unknownApi = await fetch(`${base}/api/v1/nope`);
    assert.equal(unknownApi.status, 404);
    assert.equal(((await unknownApi.json()) as { code: string }).code, "ROUTE_NOT_FOUND");
    const refused = await fetch(`${base}/..%2fpackage.json`);
    assert.equal(refused.status, 400);
    assert.equal(((await refused.json()) as { code: string }).code, "STATIC_PATH_REFUSED");
  });

  it("vite-dev mode (the default) serves no bundle bytes: an unrouted path stays a JSON 404", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-vite-dev-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    const runtime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      clock: manualClock(new Date("2026-08-28T12:00:00.000Z")),
      repoRoot,
    });
    cleanups.push(() => runtime.stop());
    const index = await fetch(`http://127.0.0.1:${String(runtime.port)}/`);
    assert.equal(index.status, 404);
    assert.equal(((await index.json()) as { code: string }).code, "ROUTE_NOT_FOUND");
  });
});
