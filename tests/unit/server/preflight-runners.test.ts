import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../src/domain/clock.js";
import {
  executePreflightRunner,
  requiredPreflightChecks,
} from "../../../src/domain/preflight.js";
import { createPreflightAuthority } from "../../../src/server/dashboard/preflight-authority.js";
import { createDashboardPreflightRunners } from "../../../src/server/dashboard/preflight-runners.js";
import { DASHBOARD_FRONTEND_OWNER_PATH } from "../../../src/server/dashboard/frontend-owner.js";

const roots: string[] = [];
const CLOCK = manualClock(new Date("2026-08-28T09:00:00.000-07:00"));
const FINGERPRINT = "a".repeat(64);
const OWNER_NONCE = "b".repeat(64);
const FOREIGN_NONCE = "c".repeat(64);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("dashboard preflight runner composition", () => {
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

      const observation = await executePreflightRunner(runner, new AbortController().signal, expiredClock);

      assert.equal(observation.state, "unhealthy");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
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

      const observation = await executePreflightRunner(runner, new AbortController().signal, CLOCK);

      assert.equal(observation.state, "unhealthy");
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

      const observation = await executePreflightRunner(runner, new AbortController().signal, CLOCK);

      assert.equal(observation.state, "unhealthy");
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

      const observation = await executePreflightRunner(runner, new AbortController().signal, CLOCK);

      assert.equal(observation.state, "unhealthy");
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
    }));
    const localChecks = new Set(["runtime.compatibility", "config.valid", "filesystem.health", "process.orphans"]);
    for (const runner of runners.filter(({ check }) => localChecks.has(check))) {
      const observation = await executePreflightRunner(runner, new AbortController().signal, CLOCK);
      assert.equal(observation.state, "healthy", runner.check);
    }
  });
});
