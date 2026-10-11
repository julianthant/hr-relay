import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { once as once_m0 } from "node:events";
import { mkdirSync as mkdirSync_m0,mkdirSync as mkdirSync_m1,mkdtempSync as mkdtempSync_m0,mkdtempSync as mkdtempSync_m1,rmSync as rmSync_m0,rmSync as rmSync_m1,writeFileSync as writeFileSync_m0,writeFileSync as writeFileSync_m1 } from "node:fs";
import { createServer as createServer_m1 } from "node:http";
import { createServer as createServer_m0,type Server as Server_m0 } from "node:net";
import { tmpdir as tmpdir_m0,tmpdir as tmpdir_m1 } from "node:os";
import { join as join_m0,join as join_m1 } from "node:path";
import { afterEach as afterEach_m0,afterEach as afterEach_m1,describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1 } from "vitest";
import { resolveConfigWithProvenance as resolveConfigWithProvenance_m0,resolveConfigWithProvenance as resolveConfigWithProvenance_m1 } from "../../../../src/backend/app/config/resolve.js";
import type { probeOwnedViteServer as probeOwnedViteServer_m0 } from "../../../../src/backend/app/host/local-vite-probe.js";
import { probeOwnedViteServer as probeOwnedViteServer_m1 } from "../../../../src/backend/app/host/local-vite-probe.js";
import { createDashboardPreflightRunners as composeRunners_m1,createDashboardPreflightRunners as createDashboardPreflightRunners_m0,type DashboardPreflightRunnerInput as DashboardPreflightRunnerInput_m1 } from "../../../../src/backend/app/preflight/dashboard-runners.js";
import type { MonotonicDeadlineScheduler as MonotonicDeadlineScheduler_m1 } from "../../../../src/backend/runtime/scheduling/deadline-scheduler.js";
import { DASHBOARD_FRONTEND_OWNER_PATH as DASHBOARD_FRONTEND_OWNER_PATH_m1 } from "../../../../src/backend/transports/http/frontend-owner.js";
import { hostConfigFacts as hostConfigFacts_m0,hostConfigFacts as hostConfigFacts_m1 } from "../../../../src/models/config/host-display.js";
import {
createPreflightAuthority as createPreflightAuthority_m1,
executePreflightRunner as executePreflightRunner_m0,
executePreflightRunner as executePreflightRunner_m1,
requiredPreflightChecks as requiredPreflightChecks_m0,
requiredPreflightChecks as requiredPreflightChecks_m1,
type PreflightDeadlineScheduler as PreflightDeadlineScheduler_m0
} from "../../../../src/models/preflight/preflight.js";
import { PreflightCheckIdSchema as PreflightCheckIdSchema_m0 } from "../../../../src/models/runtime/runtime-dependencies.js";
import { manualClock as manualClock_m0,manualClock as manualClock_m1 } from "../../../../src/rules/time/clock.js";
import { NOW as NOW_m0 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { AuthorityHealthPreflightRunner as AuthorityHealthPreflightRunner_m1 } from "../../../support/helpers/synthetic-storage-admission.js";


{


const roots: string[] = [];
const servers: Server_m0[] = [];
const NEVER_DEADLINE_SCHEDULER: PreflightDeadlineScheduler_m0 = Object.freeze({
  schedule: () => Object.freeze({ cancel: (): void => undefined }),
});

const _afterEachFixture0 = async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.close();
    await once_m0(server, "close");
  }));
  for (const root of roots.splice(0)) rmSync_m0(root, { recursive: true, force: true });
};

async function occupiedPort(refuseTransport = false): Promise<number> {
  const server = createServer_m0((socket) => {
    if (refuseTransport) socket.destroy();
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once_m0(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fixture server has no numeric port");
  return address.port;
}

describe_m0("dashboard preflight runners", () => {
afterEach_m0(_afterEachFixture0);

  it_m0("maps a concrete occupied-port transport refusal to unhealthy ownership", async () => {
    const root = mkdtempSync_m0(join_m0(tmpdir_m0(), "hrauto-preflight-transport-"));
    roots.push(root);
    const stateRoot = join_m0(root, ".tracker");
    const clock = manualClock_m0(new Date(NOW_m0));
    const frontendPort = await occupiedPort(true);
    const composed = createDashboardPreflightRunners_m0({
      repoRoot: root, stateRoot, artifactRoot: join_m0(stateRoot, "artifacts"),
      processLockRoot: join_m0(stateRoot, "locks"), config: resolveConfigWithProvenance_m0({}, hostConfigFacts_m0({}), clock).config,
      backendPort: 0, frontendPort, frontendOwnerNonce: "a".repeat(64), clock,
      authorityHealth: {
        check: PreflightCheckIdSchema_m0.parse("authority.health"), kind: "io",
        async run() { throw new Error("ports check must not run authority health"); },
      },
      listLiveWorkerProcesses: () => [],
    });
    const runner = composed.runners.find(({ check }) => check === "ports.available");
    assert_m0.ok(runner);
    const observation = await executePreflightRunner_m0(runner, new AbortController().signal, clock, NEVER_DEADLINE_SCHEDULER);
    assert_m0.deepEqual(observation, {
      check: "ports.available", state: "unhealthy",
      summary: `reserved port ownership is invalid for frontend ${String(frontendPort)} (probe-request-failed)`,
      impact: "the isolated dashboard cannot bind or identify its serving process",
    });
  });

  it_m0("implements every dashboard.serve check from observable runtime boundaries", async () => {
    const root = mkdtempSync_m0(join_m0(tmpdir_m0(), "hrauto-dashboard-preflight-"));
    roots.push(root);
    const stateRoot = join_m0(root, ".tracker");
    const artifactRoot = join_m0(stateRoot, "artifacts");
    mkdirSync_m0(artifactRoot, { recursive: true });
    writeFileSync_m0(join_m0(root, "package.json"), JSON.stringify({
      name: "preflight-fixture",
      version: "0.1.0",
      engines: { node: ">=26.0.0" },
    }));
    writeFileSync_m0(join_m0(root, "package-lock.json"), JSON.stringify({
      name: "preflight-fixture",
      version: "0.1.0",
      lockfileVersion: 3,
      packages: { "": { name: "preflight-fixture", version: "0.1.0", engines: { node: ">=26.0.0" } } },
    }));
    const authorityHealth = {
      check: PreflightCheckIdSchema_m0.parse("authority.health"),
      kind: "io" as const,
      async run() {
        return { check: "authority.health" as const, state: "healthy" as const, summary: "authority is healthy" };
      },
    };
    const runners = createDashboardPreflightRunners_m0({
      repoRoot: root,
      config: resolveConfigWithProvenance_m0({}, hostConfigFacts_m0({}), manualClock_m0(new Date(NOW_m0))).config,
      stateRoot,
      artifactRoot,
      backendPort: 0,
      frontendPort: 0,
      authorityHealth,
      clock: manualClock_m0(new Date(NOW_m0)),
      processLockRoot: join_m0(stateRoot, "locks"),
      frontendProbe: async () => { throw new Error("port 0 must not invoke the frontend probe"); },
      listLiveWorkerProcesses: () => [],
    });

    const observations = await Promise.all(runners.runners.map((runner) =>
      executePreflightRunner_m0(
        runner,
        new AbortController().signal,
        manualClock_m0(new Date(NOW_m0)),
        NEVER_DEADLINE_SCHEDULER,
      )));

    assert_m0.deepEqual(observations.map(({ check }) => check), requiredPreflightChecks_m0(["dashboard.serve"]));
    assert_m0.equal(observations.every(({ state }) => state === "healthy"), true);
  });

  it_m0("uses the injected frontend HTTP probe and propagates an indeterminate probe failure", async () => {
    const root = mkdtempSync_m0(join_m0(tmpdir_m0(), "hrauto-dashboard-preflight-probe-"));
    roots.push(root);
    const stateRoot = join_m0(root, ".tracker");
    const artifactRoot = join_m0(stateRoot, "artifacts");
    mkdirSync_m0(artifactRoot, { recursive: true });
    writeFileSync_m0(join_m0(root, "package.json"), JSON.stringify({
      name: "preflight-fixture",
      version: "0.1.0",
      engines: { node: ">=26.0.0" },
    }));
    writeFileSync_m0(join_m0(root, "package-lock.json"), JSON.stringify({
      name: "preflight-fixture",
      version: "0.1.0",
      lockfileVersion: 3,
      packages: { "": { name: "preflight-fixture", version: "0.1.0", engines: { node: ">=26.0.0" } } },
    }));
    const frontendPort = await occupiedPort();
    const authorityHealth = {
      check: PreflightCheckIdSchema_m0.parse("authority.health"),
      kind: "io" as const,
      async run() {
        return { check: "authority.health" as const, state: "healthy" as const, summary: "authority is healthy" };
      },
    };
    let probePort: number | undefined;
    const foreignProbe: typeof probeOwnedViteServer_m0 = async (input) => {
        probePort = input.port;
        return { state: "not-owned", reason: "index-identity-invalid" };
    };
    const options = {
      repoRoot: root,
      config: resolveConfigWithProvenance_m0({}, hostConfigFacts_m0({}), manualClock_m0(new Date(NOW_m0))).config,
      stateRoot,
      artifactRoot,
      backendPort: 0,
      frontendPort,
      clock: manualClock_m0(new Date(NOW_m0)),
      processLockRoot: join_m0(stateRoot, "locks"),
      authorityHealth,
      listLiveWorkerProcesses: () => [],
    } as const;
    const foreign = createDashboardPreflightRunners_m0({ ...options, frontendProbe: foreignProbe });
    const portsRunner = foreign.runners.find(({ check }) => check === "ports.available");
    assert_m0.ok(portsRunner);
    const observation = await executePreflightRunner_m0(
      portsRunner,
      new AbortController().signal,
      manualClock_m0(new Date(NOW_m0)),
      NEVER_DEADLINE_SCHEDULER,
    );
    assert_m0.equal(probePort, frontendPort);
    assert_m0.equal(observation.state, "unhealthy");
    assert_m0.match(observation.summary, /index-identity-invalid/);

    const failing = createDashboardPreflightRunners_m0({
      ...options,
      frontendProbe: async () => { throw new Error("frontend inspection failed"); },
    });
    const failingPortsRunner = failing.runners.find(({ check }) => check === "ports.available");
    assert_m0.ok(failingPortsRunner);
    await assert_m0.rejects(executePreflightRunner_m0(
      failingPortsRunner,
      new AbortController().signal,
      manualClock_m0(new Date(NOW_m0)),
      NEVER_DEADLINE_SCHEDULER,
    ), /frontend inspection failed/);
  });

});
}

{


const roots: string[] = [];
const CLOCK = manualClock_m1(new Date("2026-08-28T09:00:00.000-07:00"));
const FINGERPRINT = "a".repeat(64);
const OWNER_NONCE = "b".repeat(64);
const FOREIGN_NONCE = "c".repeat(64);
const PASSIVE_DEADLINE_SCHEDULER: MonotonicDeadlineScheduler_m1 = Object.freeze({
  schedule: () => Object.freeze({ cancel: () => undefined }),
});


function createDashboardPreflightRunners(input: Omit<DashboardPreflightRunnerInput_m1, "config" | "authorityHealth" | "listLiveWorkerProcesses">
  & { configFingerprint: string; authorityDoctorOptions: unknown; backendOwned: () => boolean }) {
  const composed = composeRunners_m1({
    ...input,
    config: resolveConfigWithProvenance_m1({}, hostConfigFacts_m1({}), input.clock).config,
    authorityHealth: new AuthorityHealthPreflightRunner_m1(input.authorityDoctorOptions, input.clock),
    listLiveWorkerProcesses: () => [],
  });
  if (input.backendOwned()) composed.markBackendOwned(input.backendPort);
  return composed.runners;
}

const _afterEachFixture0 = () => {
  for (const root of roots.splice(0)) rmSync_m1(root, { recursive: true, force: true });
};

const OWNED_VITE_INDEX = '<title>Relay</title><script type="module" src="/app/main.tsx"></script>';
const OWNED_VITE_CLIENT = 'const name = "Vite"; export function createHotContext() {}';

async function probeViteIdentity(fixture: Readonly<{
  owner: string;
  index: string;
  client: string;
}>) {
  const requestedPaths: string[] = [];
  const server = createServer_m1((request, response) => {
    requestedPaths.push(request.url ?? "<missing>");
    response.writeHead(200, { "content-type": "text/plain" });
    response.end(request.url === DASHBOARD_FRONTEND_OWNER_PATH_m1
      ? fixture.owner
      : request.url === "/"
        ? fixture.index
        : fixture.client);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server exposed no TCP address");
    const result = await probeOwnedViteServer_m1({
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

describe_m1("dashboard preflight runner composition", () => {
afterEach_m1(_afterEachFixture0);


  it_m1("accepts a Vite client bundle the size the real dev server serves", async () => {
    const { result } = await probeViteIdentity({
      owner: OWNER_NONCE,
      index: OWNED_VITE_INDEX,
      client: `${OWNED_VITE_CLIENT}${"x".repeat(204_724 - OWNED_VITE_CLIENT.length)}`,
    });

    assert_m1.deepEqual(result, { state: "owned" });
  });

  it_m1.each([
    ["launcher nonce", { owner: FOREIGN_NONCE, index: OWNED_VITE_INDEX, client: OWNED_VITE_CLIENT }, "owner-proof-invalid", [DASHBOARD_FRONTEND_OWNER_PATH_m1]],
    ["dashboard index", { owner: OWNER_NONCE, index: '<title>Foreign</title><script type="module" src="/app/main.tsx"></script>', client: OWNED_VITE_CLIENT }, "index-identity-invalid", [DASHBOARD_FRONTEND_OWNER_PATH_m1, "/"]],
    ["Vite client", { owner: OWNER_NONCE, index: OWNED_VITE_INDEX, client: "export function createForeignContext() {}" }, "vite-client-identity-invalid", [DASHBOARD_FRONTEND_OWNER_PATH_m1, "/", "/@vite/client"]],
  ] as const)("refuses a foreign %s identity before claiming the occupied port", async (_label, fixture, reason, paths) => {
    const { result, requestedPaths } = await probeViteIdentity(fixture);

    assert_m1.deepEqual(result, { state: "not-owned", reason });
    assert_m1.deepEqual(requestedPaths, paths);
  });

  it_m1("refuses a Vite identity probe after the registered deadline", async () => {
    const server = createServer_m1((request, response) => {
      response.writeHead(200, { "content-type": request.url === "/" ? "text/html" : "text/javascript" });
      response.end(request.url === DASHBOARD_FRONTEND_OWNER_PATH_m1
        ? OWNER_NONCE
        : request.url === "/"
          ? '<title>Relay</title><script type="module" src="/app/main.tsx"></script>'
          : 'const name = "Vite"; export function createHotContext() {}');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("test server exposed no TCP address");
      const root = mkdtempSync_m1(join_m1(tmpdir_m1(), "hrauto-dashboard-preflight-vite-deadline-"));
      roots.push(root);
      const stateRoot = join_m1(root, ".tracker");
      const artifactRoot = join_m1(stateRoot, "artifacts");
      mkdirSync_m1(artifactRoot, { recursive: true });
      let monotonicReads = 0;
      const expiredClock = {
        ...CLOCK,
        monotonicMs: () => monotonicReads++ === 0 ? 0 : 1_001,
      };
      const runner = createDashboardPreflightRunners({
        repoRoot: process.cwd(),
        stateRoot,
        artifactRoot,
        processLockRoot: join_m1(stateRoot, "locks"),
        backendPort: 0,
        frontendPort: address.port,
        frontendOwnerNonce: OWNER_NONCE,
        backendOwned: () => false,
        configFingerprint: FINGERPRINT,
        authorityDoctorOptions: {
          stateRootTrustAnchor: root,
          stateRoot,
          authorityPath: join_m1(stateRoot, "state.db"),
          backupDirectory: join_m1(stateRoot, "backups", "authority"),
          maxBackupAgeMs: 60_000,
          busyTimeoutMs: 100,
        },
        clock: expiredClock,
      }).find(({ check }) => check === "ports.available");
      if (runner === undefined) throw new Error("dashboard preflight omitted ports.available");

      const observation = await executePreflightRunner_m1(
        runner,
        new AbortController().signal,
        expiredClock,
        PASSIVE_DEADLINE_SCHEDULER,
      );

      assert_m1.equal(observation.state, "unhealthy");
      assert_m1.match(observation.summary, /probe-deadline-expired/u);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it_m1("serves a closed runtime-contract failure without the absolute checkout path", async () => {
    const root = mkdtempSync_m1(join_m1(tmpdir_m1(), "hrauto-preflight-employee-10873698-"));
    roots.push(root);
    const repoRoot = join_m1(root, "runtime-checkout");
    const stateRoot = join_m1(root, ".tracker");
    const artifactRoot = join_m1(stateRoot, "artifacts");
    mkdirSync_m1(artifactRoot, { recursive: true });
    const runner = createDashboardPreflightRunners({
      repoRoot,
      stateRoot,
      artifactRoot,
      processLockRoot: join_m1(stateRoot, "locks"),
      backendPort: 0,
      frontendPort: 0,
      backendOwned: () => false,
      configFingerprint: FINGERPRINT,
      authorityDoctorOptions: {
        stateRootTrustAnchor: root,
        stateRoot,
        authorityPath: join_m1(stateRoot, "state.db"),
        backupDirectory: join_m1(stateRoot, "backups", "authority"),
        maxBackupAgeMs: 60_000,
        busyTimeoutMs: 100,
      },
      clock: CLOCK,
    }).find(({ check }) => check === "runtime.compatibility");
    if (runner === undefined) throw new Error("dashboard preflight omitted runtime.compatibility");

    const observation = await executePreflightRunner_m1(
      runner,
      new AbortController().signal,
      CLOCK,
      PASSIVE_DEADLINE_SCHEDULER,
    );

    assert_m1.deepEqual(observation, {
      check: "runtime.compatibility",
      state: "unhealthy",
      summary: "runtime package contract could not be verified (runtime-contract-unavailable: package.json/package-lock.json)",
      impact: "the dashboard cannot establish its reviewed runtime dependency closure",
    });
    assert_m1.equal(observation.summary.includes(root), false);
    assert_m1.equal(observation.summary.includes("10873698"), false);
  });

  it_m1("serves only configured root basenames when filesystem inspection fails", async () => {
    const root = mkdtempSync_m1(join_m1(tmpdir_m1(), "hrauto-preflight-employee-10873698-"));
    roots.push(root);
    const stateRoot = join_m1(root, ".tracker");
    const artifactRoot = join_m1(stateRoot, "artifacts");
    const runner = createDashboardPreflightRunners({
      repoRoot: process.cwd(),
      stateRoot,
      artifactRoot,
      processLockRoot: join_m1(stateRoot, "locks"),
      backendPort: 0,
      frontendPort: 0,
      backendOwned: () => false,
      configFingerprint: FINGERPRINT,
      authorityDoctorOptions: {
        stateRootTrustAnchor: root,
        stateRoot,
        authorityPath: join_m1(stateRoot, "state.db"),
        backupDirectory: join_m1(stateRoot, "backups", "authority"),
        maxBackupAgeMs: 60_000,
        busyTimeoutMs: 100,
      },
      clock: CLOCK,
    }).find(({ check }) => check === "filesystem.health");
    if (runner === undefined) throw new Error("dashboard preflight omitted filesystem.health");

    const observation = await executePreflightRunner_m1(
      runner,
      new AbortController().signal,
      CLOCK,
      PASSIVE_DEADLINE_SCHEDULER,
    );

    assert_m1.deepEqual(observation, {
      check: "filesystem.health",
      state: "unhealthy",
      summary: "configured rebuild storage could not be verified (filesystem-root-unavailable: .tracker, artifacts)",
      impact: "authority or evidence writes cannot be admitted",
    });
    assert_m1.equal(observation.summary.includes(root), false);
    assert_m1.equal(observation.summary.includes("10873698"), false);
  });

  it_m1("serves only the process-lock root basename when ownership evidence is malformed", async () => {
    const root = mkdtempSync_m1(join_m1(tmpdir_m1(), "hrauto-preflight-employee-10873698-"));
    roots.push(root);
    const stateRoot = join_m1(root, ".tracker");
    const artifactRoot = join_m1(stateRoot, "artifacts");
    const processLockRoot = join_m1(stateRoot, "locks");
    mkdirSync_m1(artifactRoot, { recursive: true });
    mkdirSync_m1(processLockRoot, { recursive: true });
    writeFileSync_m1(join_m1(processLockRoot, "server.lock.json"), "not-json");
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
        authorityPath: join_m1(stateRoot, "state.db"),
        backupDirectory: join_m1(stateRoot, "backups", "authority"),
        maxBackupAgeMs: 60_000,
        busyTimeoutMs: 100,
      },
      clock: CLOCK,
    }).find(({ check }) => check === "process.orphans");
    if (runner === undefined) throw new Error("dashboard preflight omitted process.orphans");

    const observation = await executePreflightRunner_m1(
      runner,
      new AbortController().signal,
      CLOCK,
      PASSIVE_DEADLINE_SCHEDULER,
    );

    assert_m1.deepEqual(observation, {
      check: "process.orphans",
      state: "unhealthy",
      summary: "process-lock evidence could not be reconciled (process-lock-evidence-invalid: locks)",
      impact: "process liveness cannot be reconciled until the malformed record is reviewed",
    });
    assert_m1.equal(observation.summary.includes(root), false);
    assert_m1.equal(observation.summary.includes("10873698"), false);
  });

  it_m1("refuses an oversized frontend identity response", async () => {
    const server = createServer_m1((request, response) => {
      response.writeHead(200, { "content-type": request.url === "/" ? "text/html" : "text/javascript" });
      response.end(request.url === DASHBOARD_FRONTEND_OWNER_PATH_m1
        ? OWNER_NONCE
        : request.url === "/"
          ? '<title>Relay</title><script type="module" src="/app/main.tsx"></script>'
          : `const name = "Vite"; export function createHotContext() {}${"x".repeat(2 * 1024 * 1024)}`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("test server exposed no TCP address");
      const root = mkdtempSync_m1(join_m1(tmpdir_m1(), "hrauto-dashboard-preflight-large-vite-"));
      roots.push(root);
      const stateRoot = join_m1(root, ".tracker");
      const artifactRoot = join_m1(stateRoot, "artifacts");
      mkdirSync_m1(artifactRoot, { recursive: true });
      const runner = createDashboardPreflightRunners({
        repoRoot: process.cwd(),
        stateRoot,
        artifactRoot,
        processLockRoot: join_m1(stateRoot, "locks"),
        backendPort: 0,
        frontendPort: address.port,
        frontendOwnerNonce: OWNER_NONCE,
        backendOwned: () => false,
        configFingerprint: FINGERPRINT,
        authorityDoctorOptions: {
          stateRootTrustAnchor: root,
          stateRoot,
          authorityPath: join_m1(stateRoot, "state.db"),
          backupDirectory: join_m1(stateRoot, "backups", "authority"),
          maxBackupAgeMs: 60_000,
          busyTimeoutMs: 100,
        },
        clock: CLOCK,
      }).find(({ check }) => check === "ports.available");
      if (runner === undefined) throw new Error("dashboard preflight omitted ports.available");

      const observation = await executePreflightRunner_m1(runner, new AbortController().signal, CLOCK, PASSIVE_DEADLINE_SCHEDULER);

      assert_m1.equal(observation.state, "unhealthy");
      assert_m1.match(observation.summary, /probe-response-too-large/u);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it_m1("refuses a foreign server that copies every public Vite marker", async () => {
    const server = createServer_m1((request, response) => {
      response.writeHead(200, { "content-type": request.url === "/" ? "text/html" : "text/javascript" });
      response.end(request.url === "/"
        ? '<title>Relay</title><script type="module" src="/app/main.tsx"></script>'
        : 'const name = "Vite"; export function createHotContext() {}');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("test server exposed no TCP address");
      const root = mkdtempSync_m1(join_m1(tmpdir_m1(), "hrauto-dashboard-preflight-foreign-vite-"));
      roots.push(root);
      const stateRoot = join_m1(root, ".tracker");
      const artifactRoot = join_m1(stateRoot, "artifacts");
      mkdirSync_m1(artifactRoot, { recursive: true });
      const runner = createDashboardPreflightRunners({
        repoRoot: process.cwd(),
        stateRoot,
        artifactRoot,
        processLockRoot: join_m1(stateRoot, "locks"),
        backendPort: 0,
        frontendPort: address.port,
        frontendOwnerNonce: OWNER_NONCE,
        backendOwned: () => false,
        configFingerprint: FINGERPRINT,
        authorityDoctorOptions: {
          stateRootTrustAnchor: root,
          stateRoot,
          authorityPath: join_m1(stateRoot, "state.db"),
          backupDirectory: join_m1(stateRoot, "backups", "authority"),
          maxBackupAgeMs: 60_000,
          busyTimeoutMs: 100,
        },
        clock: CLOCK,
      }).find(({ check }) => check === "ports.available");
      if (runner === undefined) throw new Error("dashboard preflight omitted ports.available");

      const observation = await executePreflightRunner_m1(runner, new AbortController().signal, CLOCK, PASSIVE_DEADLINE_SCHEDULER);

      assert_m1.equal(observation.state, "unhealthy");
      assert_m1.match(observation.summary, /owner-proof-invalid/u);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it_m1("refuses public Vite markers owned by a different launcher nonce", async () => {
    const server = createServer_m1((request, response) => {
      response.writeHead(200, { "content-type": request.url === "/" ? "text/html" : "text/plain" });
      response.end(request.url === DASHBOARD_FRONTEND_OWNER_PATH_m1
        ? FOREIGN_NONCE
        : request.url === "/"
          ? '<title>Relay</title><script type="module" src="/app/main.tsx"></script>'
          : 'const name = "Vite"; export function createHotContext() {}');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("test server exposed no TCP address");
      const root = mkdtempSync_m1(join_m1(tmpdir_m1(), "hrauto-dashboard-preflight-wrong-launcher-"));
      roots.push(root);
      const stateRoot = join_m1(root, ".tracker");
      const artifactRoot = join_m1(stateRoot, "artifacts");
      mkdirSync_m1(artifactRoot, { recursive: true });
      const runner = createDashboardPreflightRunners({
        repoRoot: process.cwd(),
        stateRoot,
        artifactRoot,
        processLockRoot: join_m1(stateRoot, "locks"),
        backendPort: 0,
        frontendPort: address.port,
        frontendOwnerNonce: OWNER_NONCE,
        backendOwned: () => false,
        configFingerprint: FINGERPRINT,
        authorityDoctorOptions: {
          stateRootTrustAnchor: root,
          stateRoot,
          authorityPath: join_m1(stateRoot, "state.db"),
          backupDirectory: join_m1(stateRoot, "backups", "authority"),
          maxBackupAgeMs: 60_000,
          busyTimeoutMs: 100,
        },
        clock: CLOCK,
      }).find(({ check }) => check === "ports.available");
      if (runner === undefined) throw new Error("dashboard preflight omitted ports.available");

      const observation = await executePreflightRunner_m1(runner, new AbortController().signal, CLOCK, PASSIVE_DEADLINE_SCHEDULER);

      assert_m1.equal(observation.state, "unhealthy");
      assert_m1.match(observation.summary, /owner-proof-invalid/u);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it_m1("owns the exact dashboard registry subset and executes its local pure/filesystem/process detectors", async () => {
    const root = mkdtempSync_m1(join_m1(tmpdir_m1(), "hrauto-dashboard-preflight-"));
    roots.push(root);
    const stateRoot = join_m1(root, ".tracker");
    const artifactRoot = join_m1(stateRoot, "artifacts");
    const processLockRoot = join_m1(stateRoot, "locks");
    mkdirSync_m1(artifactRoot, { recursive: true });
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
        authorityPath: join_m1(stateRoot, "state.db"),
        backupDirectory: join_m1(stateRoot, "backups", "authority"),
        maxBackupAgeMs: 60_000,
        busyTimeoutMs: 100,
      },
      clock: CLOCK,
    });

    assert_m1.deepEqual(runners.map(({ check }) => check), requiredPreflightChecks_m1(["dashboard.serve"]));
    assert_m1.doesNotThrow(() => createPreflightAuthority_m1({
      configFingerprint: FINGERPRINT,
      requestedCapabilities: ["dashboard.serve"],
      runners,
      clock: CLOCK,
      scheduler: PASSIVE_DEADLINE_SCHEDULER,
    }));
    const localChecks = new Set(["runtime.compatibility", "config.valid", "filesystem.health", "process.orphans"]);
    for (const runner of runners.filter(({ check }) => localChecks.has(check))) {
      const observation = await executePreflightRunner_m1(runner, new AbortController().signal, CLOCK, PASSIVE_DEADLINE_SCHEDULER);
      assert_m1.equal(observation.state, "healthy", runner.check);
    }
  });
});
}
