import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { resolveConfig } from "../../src/domain/config/resolve.js";
import {
  executePreflightRunner,
  requiredPreflightChecks,
  type PreflightDeadlineScheduler,
} from "../../src/domain/preflight.js";
import { createDashboardPreflightRunners } from "../../src/server/preflight/dashboard-runners.js";
import {
  createDashboardFrontendHttpProbe,
  type DashboardFrontendProbe,
} from "../../src/infra/providers/dashboard-frontend-http-probe.js";
import { PreflightCheckIdSchema } from "../../src/domain/runtime-dependencies.js";
import { NOW } from "./fixtures/phase1c-contract-fixtures.js";

const roots: string[] = [];
const servers: Server[] = [];
const NEVER_DEADLINE_SCHEDULER: PreflightDeadlineScheduler = Object.freeze({
  schedule: () => Object.freeze({ cancel: (): void => undefined }),
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.close();
    await once(server, "close");
  }));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function occupiedPort(): Promise<number> {
  const server = createServer();
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fixture server has no numeric port");
  return address.port;
}

describe("dashboard preflight runners", () => {
  it("implements every dashboard.serve check from observable runtime boundaries", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dashboard-preflight-"));
    roots.push(root);
    const stateRoot = join(root, ".tracker-rebuild");
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
    }));
    const authorityHealth = {
      check: PreflightCheckIdSchema.parse("authority.health"),
      kind: "io" as const,
      async run() {
        return { check: "authority.health" as const, state: "healthy" as const, summary: "authority is healthy" };
      },
    };
    const runners = createDashboardPreflightRunners({
      repoRoot: root,
      config: resolveConfig({}, {}, manualClock(new Date(NOW))),
      stateRoot,
      artifactRoot,
      backendPort: 0,
      frontendPort: 0,
      authorityHealth,
      frontendProbe: { inspect: async () => { throw new Error("port 0 must not invoke the frontend probe"); } },
      listLiveWorkerProcesses: () => [],
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
    const stateRoot = join(root, ".tracker-rebuild");
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
    const foreignProbe: DashboardFrontendProbe = {
      async inspect(input) {
        probePort = input.port;
        return { state: "foreign", reason: "document-marker-missing", status: 200 };
      },
    };
    const options = {
      repoRoot: root,
      config: resolveConfig({}, {}, manualClock(new Date(NOW))),
      stateRoot,
      artifactRoot,
      backendPort: 0,
      frontendPort,
      authorityHealth,
      listLiveWorkerProcesses: () => [],
    } as const;
    const foreign = createDashboardPreflightRunners({ ...options, frontendProbe: foreignProbe });
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
    assert.match(observation.summary, /document marker missing/);

    const failing = createDashboardPreflightRunners({
      ...options,
      frontendProbe: { inspect: async () => { throw new Error("frontend inspection failed"); } },
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

  it("classifies checked HTTP responses without swallowing transport failures", async () => {
    const matching = createDashboardFrontendHttpProbe(async () => new Response(
      "<title>HR Automation — rebuild</title>",
      { status: 200 },
    ));
    assert.deepEqual(await matching.inspect({ port: 5174, signal: new AbortController().signal }), {
      state: "dashboard",
      status: 200,
    });

    const transportFailure = createDashboardFrontendHttpProbe(async () => {
      throw new Error("loopback transport unavailable");
    });
    await assert.rejects(
      transportFailure.inspect({ port: 5174, signal: new AbortController().signal }),
      /loopback transport unavailable/,
    );
  });
});
