import { createOwnedViteProbeFixtures } from "../../../support/helpers/backend/owned-vite-probe-fixtures.js";
import { preflightPortRunner } from "../../../support/helpers/backend/preflight-port-fixtures.js";
import { default as assert } from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createServer_m0, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { probeOwnedViteServer } from "../../../../src/backend/app/host/local-vite-probe.js";

import { createDashboardPreflightRunners as composeRunners_m1, type DashboardPreflightRunnerInput } from "../../../../src/backend/app/preflight/dashboard-runners.js";
import { type MonotonicDeadlineScheduler } from "../../../../src/backend/runtime/scheduling/deadline-scheduler.js";
import { DASHBOARD_FRONTEND_OWNER_PATH } from "../../../../src/backend/transports/http/frontend-owner.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { createPreflightAuthority, executePreflightRunner, requiredPreflightChecks, type PreflightDeadlineScheduler } from "../../../../src/models/preflight/preflight.js";
import { PreflightCheckIdSchema } from "../../../../src/models/runtime/runtime-dependencies.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { AuthorityHealthPreflightRunner } from "../../../support/helpers/synthetic-storage-admission.js";

{

const roots: string[] = [];
const servers: Server[] = [];
const NEVER_DEADLINE_SCHEDULER: PreflightDeadlineScheduler = Object.freeze({
  schedule: () => Object.freeze({ cancel: (): void => undefined }),
});

const _afterEachFixture0 = async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.close();
    await once(server, "close");
  }));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
};

async function occupiedPort(refuseTransport = false): Promise<number> {
  const server = createServer_m0((socket) => {
    if (refuseTransport) socket.destroy();
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fixture server has no numeric port");
  return address.port;
}

describe("dashboard preflight runners", () => {
afterEach(_afterEachFixture0);

  it("maps a concrete occupied-port transport refusal to unhealthy ownership", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-preflight-transport-"));
    roots.push(root);
    const stateRoot = join(root, ".tracker");
    const clock = manualClock(new Date(NOW));
    const frontendPort = await occupiedPort(true);
    const composed = composeRunners_m1({
      repoRoot: root, stateRoot, artifactRoot: join(stateRoot, "artifacts"),
      config: resolveConfigWithProvenance({}, hostConfigFacts({}), clock).config,
      backendPort: 0, frontendPort, frontendOwnerNonce: "a".repeat(64), clock,
      authorityHealth: {
        check: PreflightCheckIdSchema.parse("authority.health"), kind: "io",
        async run() { throw new Error("ports check must not run authority health"); },
      },
    });
    const runner = composed.runners.find(({ check }) => check === "ports.available");
    assert.ok(runner);
    const observation = await executePreflightRunner(runner, new AbortController().signal, clock, NEVER_DEADLINE_SCHEDULER);
    assert.deepEqual(observation, {
      check: "ports.available", state: "unhealthy",
      summary: `reserved port ownership is invalid for frontend ${String(frontendPort)} (probe-request-failed)`,
      impact: "the isolated dashboard cannot bind or identify its serving process",
    });
  });

  it("implements every dashboard.serve check from observable runtime boundaries", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dashboard-preflight-"));
    roots.push(root);
    const stateRoot = join(root, ".tracker");
    const artifactRoot = join(stateRoot, "artifacts");
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "preflight-fixture",
      version: "0.1.0",
      engines: { node: ">=26.0.0" },
    }));
    writeFileSync(join(root, "package-lock.json"), JSON.stringify({
      name: "preflight-fixture",
      version: "0.1.0",
      lockfileVersion: 3,
      packages: { "": { name: "preflight-fixture", version: "0.1.0", engines: { node: ">=26.0.0" } } },
    }));
    const authorityHealth = {
      check: PreflightCheckIdSchema.parse("authority.health"),
      kind: "io" as const,
      async run() {
        return { check: "authority.health" as const, state: "healthy" as const, summary: "authority is healthy" };
      },
    };
    const runners = composeRunners_m1({
      repoRoot: root,
      config: resolveConfigWithProvenance({}, hostConfigFacts({}), manualClock(new Date(NOW))).config,
      stateRoot,
      artifactRoot,
      backendPort: 0,
      frontendPort: 0,
      authorityHealth,
      clock: manualClock(new Date(NOW)),
      frontendProbe: async () => { throw new Error("port 0 must not invoke the frontend probe"); },
    });

    const observations = await Promise.all(runners.runners.map((runner) =>
      executePreflightRunner(
        runner,
        new AbortController().signal,
        manualClock(new Date(NOW)),
        NEVER_DEADLINE_SCHEDULER,
      )));

    assert.deepEqual(observations.map(({ check }) => check), requiredPreflightChecks(["dashboard.serve"]));
    assert.equal(observations.every(({ state }) => state === "healthy"), true);
  });

  it("uses the injected frontend HTTP probe and propagates an indeterminate probe failure", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dashboard-preflight-probe-"));
    roots.push(root);
    const stateRoot = join(root, ".tracker");
    const artifactRoot = join(stateRoot, "artifacts");
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "preflight-fixture",
      version: "0.1.0",
      engines: { node: ">=26.0.0" },
    }));
    writeFileSync(join(root, "package-lock.json"), JSON.stringify({
      name: "preflight-fixture",
      version: "0.1.0",
      lockfileVersion: 3,
      packages: { "": { name: "preflight-fixture", version: "0.1.0", engines: { node: ">=26.0.0" } } },
    }));
    const frontendPort = await occupiedPort();
    const authorityHealth = {
      check: PreflightCheckIdSchema.parse("authority.health"),
      kind: "io" as const,
      async run() {
        return { check: "authority.health" as const, state: "healthy" as const, summary: "authority is healthy" };
      },
    };
    let probePort: number | undefined;
    const foreignProbe: typeof probeOwnedViteServer = async (input) => {
        probePort = input.port;
        return { state: "not-owned", reason: "index-identity-invalid" };
    };
    const options = {
      repoRoot: root,
      config: resolveConfigWithProvenance({}, hostConfigFacts({}), manualClock(new Date(NOW))).config,
      stateRoot,
      artifactRoot,
      backendPort: 0,
      frontendPort,
      clock: manualClock(new Date(NOW)),
      authorityHealth,
    } as const;
    const foreign = composeRunners_m1({ ...options, frontendProbe: foreignProbe });
    const portsRunner = foreign.runners.find(({ check }) => check === "ports.available");
    assert.ok(portsRunner);
    const observation = await executePreflightRunner(
      portsRunner,
      new AbortController().signal,
      manualClock(new Date(NOW)),
      NEVER_DEADLINE_SCHEDULER,
    );
    assert.equal(probePort, frontendPort);
    assert.equal(observation.state, "unhealthy");
    assert.match(observation.summary, /index-identity-invalid/);

    const failing = composeRunners_m1({
      ...options,
      frontendProbe: async () => { throw new Error("frontend inspection failed"); },
    });
    const failingPortsRunner = failing.runners.find(({ check }) => check === "ports.available");
    assert.ok(failingPortsRunner);
    await assert.rejects(executePreflightRunner(
      failingPortsRunner,
      new AbortController().signal,
      manualClock(new Date(NOW)),
      NEVER_DEADLINE_SCHEDULER,
    ), /frontend inspection failed/);
  });

});
}

{

const roots: string[] = [];
const CLOCK = manualClock(new Date("2026-08-28T09:00:00.000-07:00"));
const FINGERPRINT = "a".repeat(64);
const OWNER_NONCE = "b".repeat(64);
const FOREIGN_NONCE = "c".repeat(64);
const PASSIVE_DEADLINE_SCHEDULER: MonotonicDeadlineScheduler = Object.freeze({
  schedule: () => Object.freeze({ cancel: () => undefined }),
});

function createDashboardPreflightRunners(input: Omit<DashboardPreflightRunnerInput, "config" | "authorityHealth">
  & { configFingerprint: string; authorityDoctorOptions: unknown; backendOwned: () => boolean }) {
  const composed = composeRunners_m1({
    ...input,
    config: resolveConfigWithProvenance({}, hostConfigFacts({}), input.clock).config,
    authorityHealth: new AuthorityHealthPreflightRunner(input.authorityDoctorOptions, input.clock),
  });
  if (input.backendOwned()) composed.markBackendOwned(input.backendPort);
  return composed.runners;
}

const _afterEachFixture0 = () => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
};

const OWNED_VITE_INDEX = '<title>Relay</title><script type="module" src="/app/main.tsx"></script>';
const OWNED_VITE_CLIENT = 'const name = "Vite"; export function createHotContext() {}';

const { probeViteIdentity } = createOwnedViteProbeFixtures(CLOCK, OWNER_NONCE);

describe("dashboard preflight runner composition", () => {
afterEach(_afterEachFixture0);

  it("accepts a Vite client bundle the size the real dev server serves", async () => {
    const { result } = await probeViteIdentity({
      owner: OWNER_NONCE,
      index: OWNED_VITE_INDEX,
      client: `${OWNED_VITE_CLIENT}${"x".repeat(204_724 - OWNED_VITE_CLIENT.length)}`,
    });

    assert.deepEqual(result, { state: "owned" });
  });

  it.each([
    ["launcher nonce", { owner: FOREIGN_NONCE, index: OWNED_VITE_INDEX, client: OWNED_VITE_CLIENT }, "owner-proof-invalid", [DASHBOARD_FRONTEND_OWNER_PATH]],
    ["dashboard index", { owner: OWNER_NONCE, index: '<title>Foreign</title><script type="module" src="/app/main.tsx"></script>', client: OWNED_VITE_CLIENT }, "index-identity-invalid", [DASHBOARD_FRONTEND_OWNER_PATH, "/"]],
    ["Vite client", { owner: OWNER_NONCE, index: OWNED_VITE_INDEX, client: "export function createForeignContext() {}" }, "vite-client-identity-invalid", [DASHBOARD_FRONTEND_OWNER_PATH, "/", "/@vite/client"]],
  ] as const)("refuses a foreign %s identity before claiming the occupied port", async (_label, fixture, reason, paths) => {
    const { result, requestedPaths } = await probeViteIdentity(fixture);

    assert.deepEqual(result, { state: "not-owned", reason });
    assert.deepEqual(requestedPaths, paths);
  });

  it("refuses a Vite identity probe after the registered deadline", async () => {
    const server = createServer((request, response) => {
      response.writeHead(200, { "content-type": request.url === "/" ? "text/html" : "text/javascript" });
      response.end(request.url === DASHBOARD_FRONTEND_OWNER_PATH
        ? OWNER_NONCE
        : request.url === "/"
          ? '<title>Relay</title><script type="module" src="/app/main.tsx"></script>'
          : 'const name = "Vite"; export function createHotContext() {}');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("test server exposed no TCP address");
      const root = mkdtempSync(join(tmpdir(), "hrauto-dashboard-preflight-vite-deadline-"));
      roots.push(root);
      const stateRoot = join(root, ".tracker");
      const artifactRoot = join(stateRoot, "artifacts");
      mkdirSync(artifactRoot, { recursive: true });
      let monotonicReads = 0;
      const expiredClock = {
        ...CLOCK,
        monotonicMs: () => monotonicReads++ === 0 ? 0 : 1_001,
      };
      const runner = createDashboardPreflightRunners({
        repoRoot: process.cwd(),
        stateRoot,
        artifactRoot,
        backendPort: 0,
        frontendPort: address.port,
        frontendOwnerNonce: OWNER_NONCE,
        backendOwned: () => false,
        configFingerprint: FINGERPRINT,
        authorityDoctorOptions: {
          stateRootTrustAnchor: root,
          stateRoot,
          authorityPath: join(stateRoot, "state.db"),
          backupDirectory: join(stateRoot, "backups", "authority"),
          maxBackupAgeMs: 60_000,
          busyTimeoutMs: 100,
        },
        clock: expiredClock,
      }).find(({ check }) => check === "ports.available");
      if (runner === undefined) throw new Error("dashboard preflight omitted ports.available");

      const observation = await executePreflightRunner(
        runner,
        new AbortController().signal,
        expiredClock,
        PASSIVE_DEADLINE_SCHEDULER,
      );

      assert.equal(observation.state, "unhealthy");
      assert.match(observation.summary, /probe-deadline-expired/u);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it("serves a closed runtime-contract failure without the absolute checkout path", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-preflight-employee-10873698-"));
    roots.push(root);
    const repoRoot = join(root, "runtime-checkout");
    const stateRoot = join(root, ".tracker");
    const artifactRoot = join(stateRoot, "artifacts");
    mkdirSync(artifactRoot, { recursive: true });
    const runner = createDashboardPreflightRunners({
      repoRoot,
      stateRoot,
      artifactRoot,
      backendPort: 0,
      frontendPort: 0,
      backendOwned: () => false,
      configFingerprint: FINGERPRINT,
      authorityDoctorOptions: {
        stateRootTrustAnchor: root,
        stateRoot,
        authorityPath: join(stateRoot, "state.db"),
        backupDirectory: join(stateRoot, "backups", "authority"),
        maxBackupAgeMs: 60_000,
        busyTimeoutMs: 100,
      },
      clock: CLOCK,
    }).find(({ check }) => check === "runtime.compatibility");
    if (runner === undefined) throw new Error("dashboard preflight omitted runtime.compatibility");

    const observation = await executePreflightRunner(
      runner,
      new AbortController().signal,
      CLOCK,
      PASSIVE_DEADLINE_SCHEDULER,
    );

    assert.deepEqual(observation, {
      check: "runtime.compatibility",
      state: "unhealthy",
      summary: "runtime package contract could not be verified (runtime-contract-unavailable: package.json/package-lock.json)",
      impact: "the dashboard cannot establish its reviewed runtime dependency closure",
    });
    assert.equal(observation.summary.includes(root), false);
    assert.equal(observation.summary.includes("10873698"), false);
  });

  it("serves only configured root basenames when filesystem inspection fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-preflight-employee-10873698-"));
    roots.push(root);
    const stateRoot = join(root, ".tracker");
    const artifactRoot = join(stateRoot, "artifacts");
    const runner = createDashboardPreflightRunners({
      repoRoot: process.cwd(),
      stateRoot,
      artifactRoot,
      backendPort: 0,
      frontendPort: 0,
      backendOwned: () => false,
      configFingerprint: FINGERPRINT,
      authorityDoctorOptions: {
        stateRootTrustAnchor: root,
        stateRoot,
        authorityPath: join(stateRoot, "state.db"),
        backupDirectory: join(stateRoot, "backups", "authority"),
        maxBackupAgeMs: 60_000,
        busyTimeoutMs: 100,
      },
      clock: CLOCK,
    }).find(({ check }) => check === "filesystem.health");
    if (runner === undefined) throw new Error("dashboard preflight omitted filesystem.health");

    const observation = await executePreflightRunner(
      runner,
      new AbortController().signal,
      CLOCK,
      PASSIVE_DEADLINE_SCHEDULER,
    );

    assert.deepEqual(observation, {
      check: "filesystem.health",
      state: "unhealthy",
      summary: "configured rebuild storage could not be verified (filesystem-root-unavailable: .tracker, artifacts)",
      impact: "authority or evidence writes cannot be admitted",
    });
    assert.equal(observation.summary.includes(root), false);
    assert.equal(observation.summary.includes("10873698"), false);
  });

  it("refuses an oversized frontend identity response", async () => {
    const server = createServer((request, response) => {
      response.writeHead(200, { "content-type": request.url === "/" ? "text/html" : "text/javascript" });
      response.end(request.url === DASHBOARD_FRONTEND_OWNER_PATH
        ? OWNER_NONCE
        : request.url === "/"
          ? '<title>Relay</title><script type="module" src="/app/main.tsx"></script>'
          : `const name = "Vite"; export function createHotContext() {}${"x".repeat(2 * 1024 * 1024)}`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("test server exposed no TCP address");
      const root = mkdtempSync(join(tmpdir(), "hrauto-dashboard-preflight-large-vite-"));
      roots.push(root);
      const runner = preflightPortRunner(root, address.port, OWNER_NONCE, FINGERPRINT, CLOCK, createDashboardPreflightRunners);
      if (runner === undefined) throw new Error("dashboard preflight omitted ports.available");

      const observation = await executePreflightRunner(runner, new AbortController().signal, CLOCK, PASSIVE_DEADLINE_SCHEDULER);

      assert.equal(observation.state, "unhealthy");
      assert.match(observation.summary, /probe-response-too-large/u);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it("refuses a foreign server that copies every public Vite marker", async () => {
    const server = createServer((request, response) => {
      response.writeHead(200, { "content-type": request.url === "/" ? "text/html" : "text/javascript" });
      response.end(request.url === "/"
        ? '<title>Relay</title><script type="module" src="/app/main.tsx"></script>'
        : 'const name = "Vite"; export function createHotContext() {}');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("test server exposed no TCP address");
      const root = mkdtempSync(join(tmpdir(), "hrauto-dashboard-preflight-foreign-vite-"));
      roots.push(root);
      const runner = preflightPortRunner(root, address.port, OWNER_NONCE, FINGERPRINT, CLOCK, createDashboardPreflightRunners);
      if (runner === undefined) throw new Error("dashboard preflight omitted ports.available");

      const observation = await executePreflightRunner(runner, new AbortController().signal, CLOCK, PASSIVE_DEADLINE_SCHEDULER);

      assert.equal(observation.state, "unhealthy");
      assert.match(observation.summary, /owner-proof-invalid/u);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it("refuses public Vite markers owned by a different launcher nonce", async () => {
    const server = createServer((request, response) => {
      response.writeHead(200, { "content-type": request.url === "/" ? "text/html" : "text/plain" });
      response.end(request.url === DASHBOARD_FRONTEND_OWNER_PATH
        ? FOREIGN_NONCE
        : request.url === "/"
          ? '<title>Relay</title><script type="module" src="/app/main.tsx"></script>'
          : 'const name = "Vite"; export function createHotContext() {}');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("test server exposed no TCP address");
      const root = mkdtempSync(join(tmpdir(), "hrauto-dashboard-preflight-wrong-launcher-"));
      roots.push(root);
      const runner = preflightPortRunner(root, address.port, OWNER_NONCE, FINGERPRINT, CLOCK, createDashboardPreflightRunners);
      if (runner === undefined) throw new Error("dashboard preflight omitted ports.available");

      const observation = await executePreflightRunner(runner, new AbortController().signal, CLOCK, PASSIVE_DEADLINE_SCHEDULER);

      assert.equal(observation.state, "unhealthy");
      assert.match(observation.summary, /owner-proof-invalid/u);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it("owns the exact dashboard registry subset and executes its local pure/filesystem/process detectors", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dashboard-preflight-"));
    roots.push(root);
    const stateRoot = join(root, ".tracker");
    const artifactRoot = join(stateRoot, "artifacts");
    mkdirSync(artifactRoot, { recursive: true });
    const runners = createDashboardPreflightRunners({
      repoRoot: process.cwd(),
      stateRoot,
      artifactRoot,
      backendPort: 0,
      frontendPort: 0,
      backendOwned: () => false,
      configFingerprint: FINGERPRINT,
      authorityDoctorOptions: {
        stateRootTrustAnchor: root,
        stateRoot,
        authorityPath: join(stateRoot, "state.db"),
        backupDirectory: join(stateRoot, "backups", "authority"),
        maxBackupAgeMs: 60_000,
        busyTimeoutMs: 100,
      },
      clock: CLOCK,
    });

    assert.deepEqual(runners.map(({ check }) => check), requiredPreflightChecks(["dashboard.serve"]));
    assert.doesNotThrow(() => createPreflightAuthority({
      configFingerprint: FINGERPRINT,
      requestedCapabilities: ["dashboard.serve"],
      runners,
      clock: CLOCK,
      scheduler: PASSIVE_DEADLINE_SCHEDULER,
    }));
    const localChecks = new Set(["runtime.compatibility", "config.valid", "filesystem.health"]);
    for (const runner of runners.filter(({ check }) => localChecks.has(check))) {
      const observation = await executePreflightRunner(runner, new AbortController().signal, CLOCK, PASSIVE_DEADLINE_SCHEDULER);
      assert.equal(observation.state, "healthy", runner.check);
    }
  });
});
}
