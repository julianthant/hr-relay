import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

// The development profile is read once at import, and its application data lives under a temporary home.
const fixture = vi.hoisted(() => {
  process.env.RELAY_RUNTIME_PROFILE = "development";
  return { home: "", keychain: [] as string[][] };
});
vi.mock("node:os", async original => {
  const os = await original<typeof import("node:os")>();
  return { ...os, userInfo: () => ({ ...os.userInfo(), homedir: fixture.home }) };
});
vi.mock("@napi-rs/keyring", () => ({ Entry: class {
  constructor(readonly service: string, readonly account: string) {}
  getPassword() { fixture.keychain.push(["get", this.service, this.account]); return null; }
  setPassword() { throw new Error("OS keychain write in a test"); }
  deletePassword() { throw new Error("OS keychain delete in a test"); }
} }));
vi.mock("../../../src/backend/runtime/browser/onboarding-duo-provider.js", { spy: true });

const { composeDashboardApplication } = await import("../../../src/backend/app/composition/dashboard/compose.js");
const { applicationDataWorkspace, rebuildRuntimeIsolation, runtimeProfile } = await import("../../../src/backend/app/config/runtime-isolation.js");
const { acquireEntrypointAdmission } = await import("../../../src/backend/storage/admission/bootstrap-admission.js");
const { RuntimeLifetimeLock } = await import("../../../src/backend/storage/admission/lifetime-lock.js");
const { createCredentialKeyCustody } = await import("../../../src/backend/storage/configuration/credential-key-custody.js");
const duo = await import("../../../src/backend/runtime/browser/onboarding-duo-provider.js");
const { runtimeProfiles } = await import("../../../src/models/config/define-runtime-isolation.js");

const copySignin = { profile: "development" as const,
  credentials(): never { throw new Error("UCPath credentials read during composition"); },
  phone(): never { throw new Error("Duo approval during composition"); } };
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); vi.mocked(duo.createProfileOnboardingDuoProvider).mockClear(); });

function temporaryRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "relay-copy-compose-")));
  roots.push(root);
  return root;
}

async function compose(workspace: string) {
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(workspace, name));
  const lifetime = await RuntimeLifetimeLock.acquire(runtimeProfiles.development.lockPort);
  try {
    const admission = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
    try {
      mkdirSync(join(workspace, rebuildRuntimeIsolation.artifactRoot), { recursive: true, mode: 0o700 });
      return await composeDashboardApplication({ lifetimeLock: lifetime, admission, isolation: rebuildRuntimeIsolation, repoRoot: process.cwd(), env: {}, copySignin })
        .then(runtime => runtime.stop().then(() => "composed"), (error: unknown) => error instanceof Error ? error.message : String(error));
    } finally { admission.release(); }
  } finally { await lifetime.close(); }
}

// The no-flag launcher's custody and Duo selection; the POSIX home layout matches the launcher's macOS target.
it.skipIf(process.platform === "win32")("keeps the OS keychain and the real Duo provider in the development composition and refuses another workspace", async () => {
  fixture.home = temporaryRoot();
  expect(runtimeProfile).toBe("development");
  const ids = { installationId: "10000000-0000-4000-8000-000000000001", profileId: "10000000-0000-4000-8000-000000000002", keyId: "10000000-0000-4000-8000-000000000003" };
  createCredentialKeyCustody().assertAbsent(ids);
  expect(fixture.keychain).toEqual([["get", "Relay", `development:${ids.installationId}:${ids.profileId}`]]);

  const realDuo = new Error("real Duo provider selected");
  vi.mocked(duo.createProfileOnboardingDuoProvider).mockImplementation(() => { throw realDuo; });
  expect(await compose(join(temporaryRoot(), "Relay-development"))).toBe("copy-signin-target-refused");
  expect(duo.createProfileOnboardingDuoProvider).not.toHaveBeenCalled();

  expect(await compose(applicationDataWorkspace(undefined, "development"))).toBe(realDuo.message);
  expect(vi.mocked(duo.copySigninFixtureDuoProvider).mock.results).toEqual([{ type: "return", value: undefined }]);
  expect(vi.mocked(duo.createProfileOnboardingDuoProvider).mock.calls[0]?.[0].copySignin).toBe(copySignin);
});
