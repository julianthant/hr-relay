import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimeLifetimeLock } from "./runtime-lifetime.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { PublicProfileStateSchema } from "../../../../src/models/profiles/public-profile.js";

export async function readyPublicSignUp(base: string, methods: "confirmed" | "detected" = "confirmed") {
  const post = (path: string, body: unknown, credential?: string) => fetch(`${base}${path}`, { method: "POST",
    headers: { origin: base, "content-type": "application/json", ...(credential === undefined ? {} : { "x-relay-session": credential }) }, body: JSON.stringify(body) });
  const signup = await post("/api/v1/profile/sign-up", { firstName: "Fixture", lastName: "Operator", email: "fixture@ucsd.edu", password: "disposable-fixture-password",
    ucpathUsername: "fixture@ucsd.edu", ucpathPassword: "disposable-fixture-password" });
  const draft = PublicProfileStateSchema.parse(await signup.json());
  assert.equal(draft.state, "onboarding");
  if (draft.state !== "onboarding") throw new Error("fixture actual signup draft required");
  const credential = signup.headers.get("x-relay-session") ?? undefined; assert.ok(credential);
  const started = await post("/api/v1/profile/onboarding/duo/start", { operationId: draft.operationId, method: "key" }, credential);
  const pending = PublicProfileStateSchema.parse(await started.json());
  assert.equal(pending.state, "onboarding");
  if (pending.state !== "onboarding") throw new Error("fixture actual Duo attempt required");
  assert.equal(pending.methods.key.state, methods === "detected" ? "complete" : "pending");
  if (methods === "confirmed") {
    const confirmed = await post("/api/v1/profile/onboarding/duo/confirm", {
      operationId: draft.operationId, method: "key", attemptId: pending.methods.key.attemptId, operatorConfirmed: true }, credential);
    const result = PublicProfileStateSchema.parse(await confirmed.json());
    assert.equal(result.state, "onboarding");
    if (result.state !== "onboarding") throw new Error("fixture confirmed Duo draft required");
    assert.equal(result.methods.key.state, "complete");
    assert.equal(result.step, "ready");
  }
  return { post, credential, draft, finish: () => post("/api/v1/profile/onboarding/complete", { operationId: draft.operationId }, credential) };
}

export async function publicProfileShellFixture(lifetime?: Parameters<typeof acquireEntrypointAdmission>[2], mode: "exclusive" | "shared" = "exclusive") {
  const controller = lifetime ?? await runtimeLifetimeLock();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "public-profile-shell-")));
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(root, name));
  const machine = acquireEntrypointAdmission(root, mode, controller);
  mkdirSync(join(root, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
  return { root, lifetime: controller, machine };
}
