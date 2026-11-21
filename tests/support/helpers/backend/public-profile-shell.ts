import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimeLifetimeLock } from "./runtime-lifetime.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import type { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { composeDashboardApplication, type DashboardComposeInput } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { PublicProfileStateSchema } from "../../../../src/models/profiles/public-profile.js";

type PublicProfileRuntime = Awaited<ReturnType<typeof composeDashboardApplication>>;
const fixtureMachines = new WeakSet<RuntimeAdmission>();
const listenerOrigins = new WeakMap<PublicProfileRuntime, string>();

export async function composePublicProfileFixtureRuntime(input: DashboardComposeInput): Promise<PublicProfileRuntime> {
  const runtime = await composeDashboardApplication(input);
  if (input.admission === undefined || !fixtureMachines.has(input.admission) || input.backendPortOverride !== 0) return runtime;
  const owned: PublicProfileRuntime = Object.freeze({ ...runtime, stop() {
    listenerOrigins.delete(owned);
    return runtime.stop();
  } });
  listenerOrigins.set(owned, `http://127.0.0.1:${String(owned.port)}`);
  return owned;
}

export async function readyPublicSignUp(runtime: PublicProfileRuntime, methods: "confirmed" | "detected" = "confirmed") {
  const base = listenerOrigins.get(runtime);
  if (base === undefined) throw new Error("fixture-signup-listener-unowned");
  const post = async (path: string, body: unknown, credential?: string) => {
    if (listenerOrigins.get(runtime) !== base) throw new Error("fixture-signup-listener-unowned");
    const url = new URL(path, base);
    if (url.origin !== base || url.username || url.password) throw new Error("fixture-signup-origin-mismatch");
    return fetch(url, { method: "POST", redirect: "error",
      headers: { origin: base, "content-type": "application/json", ...(credential === undefined ? {} : { "x-relay-session": credential }) }, body: JSON.stringify(body) });
  };
  const signup = await post("/api/v1/profile/sign-up", { firstName: "Fixture", lastName: "Operator", email: "fixture@ucsd.edu", password: "disposable-fixture-password" });
  const draft = PublicProfileStateSchema.parse(await signup.json());
  assert.equal(draft.state, "onboarding");
  if (draft.state !== "onboarding") throw new Error("fixture actual signup draft required");
  const credential = signup.headers.get("x-relay-session") ?? undefined; assert.ok(credential);
  for (const method of ["key", "touch"] as const) {
    const started = await post("/api/v1/profile/onboarding/duo/start", { operationId: draft.operationId, method }, credential);
    const pending = PublicProfileStateSchema.parse(await started.json());
    assert.equal(pending.state, "onboarding");
    if (pending.state !== "onboarding") throw new Error("fixture actual Duo attempt required");
    assert.equal(pending.methods[method].state, methods === "detected" || method === "touch" ? "complete" : "pending");
    if (methods === "detected") continue;
    const confirmed = await post("/api/v1/profile/onboarding/duo/confirm", {
      operationId: draft.operationId, method, attemptId: pending.methods[method].attemptId, operatorConfirmed: true }, credential);
    const result = PublicProfileStateSchema.parse(await confirmed.json());
    assert.equal(result.state, "onboarding");
    if (result.state !== "onboarding") throw new Error("fixture confirmed Duo draft required");
    assert.equal(result.methods[method].state, "complete");
    assert.equal(result.step, method === "touch" ? "ready" : "duo");
  }
  return { post, credential, draft, finish: () => post("/api/v1/profile/onboarding/complete", { operationId: draft.operationId }, credential) };
}

export async function publicProfileShellFixture(lifetime?: Parameters<typeof acquireEntrypointAdmission>[2], mode: "exclusive" | "shared" = "exclusive") {
  const controller = lifetime ?? await runtimeLifetimeLock();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "public-profile-shell-")));
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(root, name));
  const machine = acquireEntrypointAdmission(root, mode, controller);
  mkdirSync(join(root, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
  fixtureMachines.add(machine);
  return { root, lifetime: controller, machine };
}
