import assert from "node:assert/strict";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { writeDashboardBuildIdentity } from "../../../../../src/backend/app/composition/dashboard/build-identity.js";
import { composeDashboardApplication } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import type { DashboardComposeInput } from "../../../../../src/backend/app/composition/dashboard/runtime-contracts.js";
import { readLocalDebugLog } from "../../../../../src/backend/storage/events/local-debug-log.js";
import { PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { syntheticOnboardingDuo } from "../../../../support/helpers/admission-fixture.js";
import { publicProfileShellFixture as fixture, readyPublicSignUp } from "../../../../support/helpers/backend/public-profile-shell.js";

const FRONTEND = rebuildRuntimeIsolation.frontendPort;

function occupy(port: number): Promise<Server> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function compose(f: Awaited<ReturnType<typeof fixture>>, extra: Partial<DashboardComposeInput> = {}) {
  return composeDashboardApplication({
    lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
    backendPortOverride: 0, onboardingDuo: syntheticOnboardingDuo(), env: {},
    preflightRunnerFactory: healthyRuntimePreflightRunners, ...extra,
  });
}

function installBundle(root: string): void {
  cpSync("src", join(root, "src"), { recursive: true });
  mkdirSync(join(root, "config"), { recursive: true });
  cpSync("config/dashboard-workflow-sources.json", join(root, "config", "dashboard-workflow-sources.json"));
  cpSync("vite.dashboard.config.ts", join(root, "vite.dashboard.config.ts"));
  cpSync("tsconfig.json", join(root, "tsconfig.json"));
  const dist = join(root, "dist", "dashboard");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>built</title>");
  writeFileSync(join(dist, "assets", "app.f00d.js"), "export const built = true;\n");
  writeDashboardBuildIdentity({ repoRoot: root, distDir: dist });
}

function request(port: number, path: string, host: string, body?: string): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: "127.0.0.1", port, path, method: body === undefined ? "GET" : "POST",
      headers: {
        host,
        ...(body === undefined ? {} : {
          origin: `http://${host}`, "content-type": "application/json", "content-length": Buffer.byteLength(body),
        }),
      },
    }, res => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => { chunks.push(chunk); });
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode ?? 0, json: text.length === 0 ? undefined : JSON.parse(text) as unknown });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function close(runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined, listener: Server | undefined, f: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  await runtime?.stop();
  listener?.close();
  f.machine.release();
  rmSync(f.root, { recursive: true, force: true });
}

it("T1 keeps sign-in active when a foreign listener occupies the dev frontend port", async () => {
  const f = await fixture();
  let listener: Server | undefined, runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    listener = await occupy(FRONTEND);
    runtime = await compose(f);
    const finished = await (await readyPublicSignUp(`http://127.0.0.1:${runtime.port}`)).finish();
    assert.equal(finished.status, 200);
    const active = PublicProfileStateSchema.parse(await finished.json());
    assert.equal(active.state, "active");
    if (active.state !== "active" || active.firstRunCheck?.state !== "failed") throw new Error("failed ports check required");
    assert.equal(active.firstRunCheck.report.results.some(result => result.check === "ports.available" && result.status === "fail"), true);
  } finally { await close(runtime, listener, f); }
});

it("T2 refuses an unowned dev-frontend host and lets an owned probe reach sign-in", async () => {
  const f = await fixture();
  let owned = false, listener: Server | undefined, runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    listener = await occupy(FRONTEND);
    runtime = await compose(f, {
      frontendProbe: async () => owned ? { state: "owned" } : { state: "not-owned", reason: "owner-proof-unconfigured" },
    });
    const before = f.machine.readProfileRegistry().activeProfileId;
    const host = `127.0.0.1:${String(FRONTEND)}`;
    const body = JSON.stringify({ email: "fixture@ucsd.edu", password: "disposable-fixture-password" });
    const state = await request(runtime.port, "/api/v1/profile/state", host);
    const signIn = await request(runtime.port, "/api/v1/profile/sign-in", host, body);
    assert.equal(state.status, 403);
    assert.deepEqual(state.json, { state: "refused", code: "DASHBOARD_FRONTEND_NOT_OWNED" });
    assert.equal(signIn.status, 403);
    assert.deepEqual(signIn.json, { state: "refused", code: "DASHBOARD_FRONTEND_NOT_OWNED" });
    assert.equal(f.machine.readProfileRegistry().activeProfileId, before);
    owned = true;
    const proceeded = await request(runtime.port, "/api/v1/profile/sign-in", host, body);
    assert.deepEqual(proceeded.json, { state: "refused", code: "PROFILE_SIGN_IN_REFUSED" });
    assert.equal(f.machine.readProfileRegistry().activeProfileId, before);
  } finally { await close(runtime, listener, f); }
});

it("T3 passes ports.available for the built bundle while the dev frontend port is occupied", async () => {
  const f = await fixture();
  let listener: Server | undefined, runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    installBundle(f.root);
    listener = await occupy(FRONTEND);
    runtime = await compose(f, { frontend: "built-bundle" });
    const finished = await (await readyPublicSignUp(`http://127.0.0.1:${runtime.port}`)).finish();
    assert.equal(finished.status, 200);
    const active = PublicProfileStateSchema.parse(await finished.json());
    assert.equal(active.state, "active");
    if (active.state !== "active" || active.firstRunCheck?.state !== "passed") throw new Error("built-bundle ports check required");
    assert.equal(active.firstRunCheck.report.results.some(result => result.check === "ports.available" && result.status === "pass"), true);
  } finally { await close(runtime, listener, f); }
});

it("T5 names a compose failure PROFILE_RUNTIME_START_FAILED and logs only its kebab token", async () => {
  const f = await fixture();
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    runtime = await compose(f, { onInitialPreflight: () => { throw new Error("some-kebab-token: detail"); } });
    const finished = await (await readyPublicSignUp(`http://127.0.0.1:${runtime.port}`)).finish();
    assert.equal(finished.status, 500);
    const body = PublicProfileStateSchema.parse(await finished.json());
    assert.equal(body.state, "error");
    if (body.state !== "error") throw new Error("start failure required");
    assert.equal(body.code, "PROFILE_RUNTIME_START_FAILED");
    const boot = readLocalDebugLog(f.machine.stateRoot);
    if (boot.state !== "present") throw new Error("boot log missing");
    assert.equal(boot.records.some(record => record.payload.kind === "debug" && record.payload.event.reason === "some-kebab-token"), true);
    assert.equal(JSON.stringify(boot.records).includes("detail"), false);
  } finally { await close(runtime, undefined, f); }
});
