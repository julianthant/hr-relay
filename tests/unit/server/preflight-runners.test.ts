import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import type { MonotonicDeadlineScheduler } from "../../../src/core/deadline-scheduler.js";
import { executePreflightRunner } from "../../../src/domain/preflight.js";
import { manualClock } from "../../../src/domain/clock.js";
import {
  requiredPreflightChecks,
} from "../../../src/domain/preflight.js";
import { createPreflightAuthority } from "../../../src/domain/preflight.js";
import { createDashboardPreflightRunners as composeRunners, type DashboardPreflightRunnerInput } from "../../../src/server/preflight/dashboard-runners.js";
import { DASHBOARD_FRONTEND_OWNER_PATH } from "../../../src/server/dashboard/frontend-owner.js";
import { probeOwnedViteServer } from "../../../src/infra/providers/local-vite-probe.js";
import { resolveConfig } from "../../../src/domain/config/resolve.js";
import { AuthorityHealthPreflightRunner } from "../../../src/infra/sqlite/authority-health-runner.js";

const roots: string[] = [];
const CLOCK = manualClock(new Date("2026-08-28T09:00:00.000-07:00"));
const FINGERPRINT = "a".repeat(64);
const OWNER_NONCE = "b".repeat(64);
const FOREIGN_NONCE = "c".repeat(64);
const PASSIVE_DEADLINE_SCHEDULER: MonotonicDeadlineScheduler = Object.freeze({
  schedule: () => Object.freeze({ cancel: () => undefined }),
});

/** Adapt historical detector fixtures to the one production runner composition. */
function createDashboardPreflightRunners(input: Omit<DashboardPreflightRunnerInput, "config" | "authorityHealth" | "listLiveWorkerProcesses">
  & { configFingerprint: string; authorityDoctorOptions: unknown; backendOwned: () => boolean }) {
  const composed = composeRunners({
    ...input,
    config: resolveConfig({}, {}, input.clock),
    authorityHealth: new AuthorityHealthPreflightRunner(input.authorityDoctorOptions, input.clock),
    listLiveWorkerProcesses: () => [],
  });
  if (input.backendOwned()) composed.markBackendOwned(input.backendPort);
  return composed.runners;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const OWNED_VITE_INDEX = '<title>HR Automation — rebuild</title><script type="module" src="/app/main.tsx"></script>';
const OWNED_VITE_CLIENT = 'const name = "Vite"; export function createHotContext() {}';

async function probeViteIdentity(fixture: Readonly<{
  owner: string;
  index: string;
  client: string;
}>) {
  const requestedPaths: string[] = [];
  const server = createServer((request, response) => {
    requestedPaths.push(request.url ?? "<missing>");
    response.writeHead(200, { "content-type": "text/plain" });
    response.end(request.url === DASHBOARD_FRONTEND_OWNER_PATH
      ? fixture.owner
      : request.url === "/"
        ? fixture.index
        : fixture.client);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server exposed no TCP address");
    const result = await probeOwnedViteServer({
      port: address.port,
      signal: new AbortController().signal,
      deadlineMonotonicMs: CLOCK.monotonicMs() + 1_000,
      clock: CLOCK,
      ownerNonce: OWNER_NONCE,
    });
    return { result, requestedPaths };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  }
}

describe("dashboard preflight runner composition", () => {
  it("returns probe-request-failed for a closed allocated loopback port", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server exposed no TCP address");
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    assert.deepEqual(await probeOwnedViteServer({
      port: address.port, signal: new AbortController().signal,
      deadlineMonotonicMs: CLOCK.monotonicMs() + 1_000,
      clock: CLOCK, ownerNonce: OWNER_NONCE,
    }), { state: "not-owned", reason: "probe-request-failed" });
  });

  it("accepts only the exact owned Vite owner, index, and client identity path", async () => {
    const { result, requestedPaths } = await probeViteIdentity({
      owner: OWNER_NONCE,
      index: OWNED_VITE_INDEX,
      client: OWNED_VITE_CLIENT,
    });

    assert.deepEqual(result, { state: "owned" });
    assert.deepEqual(requestedPaths, [DASHBOARD_FRONTEND_OWNER_PATH, "/", "/@vite/client"]);
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
          ? '<title>HR Automation — rebuild</title><script type="module" src="/app/main.tsx"></script>'
          : 'const name = "Vite"; export function createHotContext() {}');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("test server exposed no TCP address");
      const root = mkdtempSync(join(tmpdir(), "hrauto-dashboard-preflight-vite-deadline-"));
      roots.push(root);
      const stateRoot = join(root, ".tracker-rebuild");
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
        processLockRoot: join(stateRoot, "locks"),
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
    const stateRoot = join(root, ".tracker-rebuild");
    const artifactRoot = join(stateRoot, "artifacts");
    mkdirSync(artifactRoot, { recursive: true });
    const runner = createDashboardPreflightRunners({
      repoRoot,
      stateRoot,
      artifactRoot,
      processLockRoot: join(stateRoot, "locks"),
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
    const stateRoot = join(root, ".tracker-rebuild");
    const artifactRoot = join(stateRoot, "artifacts");
    const runner = createDashboardPreflightRunners({
      repoRoot: process.cwd(),
      stateRoot,
      artifactRoot,
      processLockRoot: join(stateRoot, "locks"),
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
      summary: "configured rebuild storage could not be verified (filesystem-root-unavailable: .tracker-rebuild, artifacts)",
      impact: "authority or evidence writes cannot be admitted",
    });
    assert.equal(observation.summary.includes(root), false);
    assert.equal(observation.summary.includes("10873698"), false);
  });

  it("serves only the process-lock root basename when ownership evidence is malformed", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-preflight-employee-10873698-"));
    roots.push(root);
    const stateRoot = join(root, ".tracker-rebuild");
    const artifactRoot = join(stateRoot, "artifacts");
    const processLockRoot = join(stateRoot, "locks");
    mkdirSync(artifactRoot, { recursive: true });
    mkdirSync(processLockRoot, { recursive: true });
    writeFileSync(join(processLockRoot, "server.lock.json"), "not-json");
    const runner = createDashboardPreflightRunners({
      repoRoot: process.cwd(),
      stateRoot,
      artifactRoot,
      processLockRoot,
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
    }).find(({ check }) => check === "process.orphans");
    if (runner === undefined) throw new Error("dashboard preflight omitted process.orphans");

    const observation = await executePreflightRunner(
      runner,
      new AbortController().signal,
      CLOCK,
      PASSIVE_DEADLINE_SCHEDULER,
    );

    assert.deepEqual(observation, {
      check: "process.orphans",
      state: "unhealthy",
      summary: "process-lock evidence could not be reconciled (process-lock-evidence-invalid: locks)",
      impact: "process liveness cannot be reconciled until the malformed record is reviewed",
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
          ? '<title>HR Automation — rebuild</title><script type="module" src="/app/main.tsx"></script>'
          : `const name = "Vite"; export function createHotContext() {}${"x".repeat(300 * 1024)}`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("test server exposed no TCP address");
      const root = mkdtempSync(join(tmpdir(), "hrauto-dashboard-preflight-large-vite-"));
      roots.push(root);
      const stateRoot = join(root, ".tracker-rebuild");
      const artifactRoot = join(stateRoot, "artifacts");
      mkdirSync(artifactRoot, { recursive: true });
      const runner = createDashboardPreflightRunners({
        repoRoot: process.cwd(),
        stateRoot,
        artifactRoot,
        processLockRoot: join(stateRoot, "locks"),
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
        clock: CLOCK,
      }).find(({ check }) => check === "ports.available");
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
        ? '<title>HR Automation — rebuild</title><script type="module" src="/app/main.tsx"></script>'
        : 'const name = "Vite"; export function createHotContext() {}');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("test server exposed no TCP address");
      const root = mkdtempSync(join(tmpdir(), "hrauto-dashboard-preflight-foreign-vite-"));
      roots.push(root);
      const stateRoot = join(root, ".tracker-rebuild");
      const artifactRoot = join(stateRoot, "artifacts");
      mkdirSync(artifactRoot, { recursive: true });
      const runner = createDashboardPreflightRunners({
        repoRoot: process.cwd(),
        stateRoot,
        artifactRoot,
        processLockRoot: join(stateRoot, "locks"),
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
        clock: CLOCK,
      }).find(({ check }) => check === "ports.available");
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
          ? '<title>HR Automation — rebuild</title><script type="module" src="/app/main.tsx"></script>'
          : 'const name = "Vite"; export function createHotContext() {}');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("test server exposed no TCP address");
      const root = mkdtempSync(join(tmpdir(), "hrauto-dashboard-preflight-wrong-launcher-"));
      roots.push(root);
      const stateRoot = join(root, ".tracker-rebuild");
      const artifactRoot = join(stateRoot, "artifacts");
      mkdirSync(artifactRoot, { recursive: true });
      const runner = createDashboardPreflightRunners({
        repoRoot: process.cwd(),
        stateRoot,
        artifactRoot,
        processLockRoot: join(stateRoot, "locks"),
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
        clock: CLOCK,
      }).find(({ check }) => check === "ports.available");
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
    const stateRoot = join(root, ".tracker-rebuild");
    const artifactRoot = join(stateRoot, "artifacts");
    const processLockRoot = join(stateRoot, "locks");
    mkdirSync(artifactRoot, { recursive: true });
    const runners = createDashboardPreflightRunners({
      repoRoot: process.cwd(),
      stateRoot,
      artifactRoot,
      processLockRoot,
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
    const localChecks = new Set(["runtime.compatibility", "config.valid", "filesystem.health", "process.orphans"]);
    for (const runner of runners.filter(({ check }) => localChecks.has(check))) {
      const observation = await executePreflightRunner(runner, new AbortController().signal, CLOCK, PASSIVE_DEADLINE_SCHEDULER);
      assert.equal(observation.state, "healthy", runner.check);
    }
  });
});
