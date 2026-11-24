import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { assertCopySigninFixture, assertCopySigninTarget, driveCopySignin, useCopySigninFixture, readCopySigninCredentials, writeCopySigninSnapshot } from "../../../scripts/profiles/copy-signin.js";
import { runDevDashboard } from "../../../scripts/dev/dashboard.js";
import { copySigninFixtureBrowser } from "../../../src/backend/runtime/browser/onboarding-duo-provider.js";
import { osCredentialSecretStore, selectedCredentialSecretStore } from "../../../src/backend/storage/configuration/credential-key-custody.js";
import { applicationDataWorkspace } from "../../../src/backend/app/config/runtime-isolation.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { runtimeProfiles } from "../../../src/models/config/define-runtime-isolation.js";

const credentials = {
  RELAY_EMAIL: "synthetic-copy@example.test",
  RELAY_PASSWORD: "relay # sentinel",
  UCPATH_USERNAME: "ucpath-username-sentinel",
  UCPATH_PASSWORD: "ucpath-password-sentinel",
};
const envBody = Object.entries(credentials).map(([name, value]) => `${name}="${value}"`).join("\n");
let directory: string, envFile: string;

beforeEach(() => {
  directory = mkdtempSync(join(realpathSync(tmpdir()), "relay-copy-signin-"));
  envFile = join(directory, "operator-signin.env");
  writeFileSync(envFile, envBody, { mode: 0o600 });
});

afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

function copyLogs(): { workspace: string; logs: string; outside: string } {
  const workspace = join(directory, "Relay-development"), logs = join(workspace, ".tracker", "data", "logs"), outside = join(directory, "outside");
  mkdirSync(logs, { recursive: true, mode: 0o700 }); mkdirSync(outside, { mode: 0o700 });
  return { workspace, logs, outside };
}
const modeOf = (path: string) => statSync(path).mode & 0o7777;

it("replaces a permissive prior snapshot with a fresh 0600 file and leaves no stage", () => {
  const { workspace, logs } = copyLogs(), path = join(logs, "copy-signin-duo-gate.txt");
  writeFileSync(path, "prior", { mode: 0o644 });
  writeCopySigninSnapshot(workspace, "gate", "snapshot");
  expect(readFileSync(path, "utf8")).toBe("snapshot");
  expect(modeOf(path)).toBe(0o600);
  expect(readdirSync(logs)).toEqual(["copy-signin-duo-gate.txt"]);
});

it("replaces a planted link at the snapshot path without writing through it", () => {
  const { workspace, logs, outside } = copyLogs(), target = join(outside, "target.txt"), path = join(logs, "copy-signin-duo-after-push.txt");
  writeFileSync(target, "outside", { mode: 0o644 });
  symlinkSync(target, path);
  writeCopySigninSnapshot(workspace, "after-push", "snapshot");
  expect(lstatSync(path).isSymbolicLink()).toBe(false);
  expect(modeOf(path)).toBe(0o600);
  expect(readFileSync(target, "utf8")).toBe("outside");
});

it("refuses a logs directory that is a link or not private", () => {
  const { workspace, logs, outside } = copyLogs();
  rmSync(logs, { recursive: true }); symlinkSync(outside, logs);
  expect(() => writeCopySigninSnapshot(workspace, "gate", "snapshot")).toThrow(/symbolic link/u);
  expect(readdirSync(outside)).toEqual([]);
  rmSync(logs); mkdirSync(logs, { mode: 0o755 }); chmodSync(logs, 0o755);
  expect(() => writeCopySigninSnapshot(workspace, "gate", "snapshot")).toThrow(/0700/u);
  expect(existsSync(join(logs, "copy-signin-duo-gate.txt"))).toBe(false);
});

it("reads the four values from the private env file without changing quoted values", () => {
  expect(readCopySigninCredentials(envFile)).toEqual(credentials);
});

it.each([0o400, 0o640, 0o700])("refuses a sign-in file with mode %i", mode => {
  chmodSync(envFile, mode);
  expect(() => readCopySigninCredentials(envFile)).toThrow("copy-signin-env-unavailable");
});

it("reports a malformed env file without including its contents", () => {
  writeFileSync(envFile, `RELAY_PASSWORD="${credentials.RELAY_PASSWORD}"\n`);
  expect(() => readCopySigninCredentials(envFile)).toThrow(/^copy-signin-env-invalid$/u);
});

it("refuses production ports or roots, including the production launcher profile", () => {
  const workspace = applicationDataWorkspace(undefined, "development");
  expect(() => assertCopySigninTarget("development", workspace, runtimeProfiles.production)).toThrow("copy-signin-target-refused");
  expect(() => assertCopySigninTarget("development", applicationDataWorkspace(undefined, "production"), runtimeProfiles.development))
    .toThrow("copy-signin-target-refused");
  expect(() => runDevDashboard({ profile: "production", copySignin: { backendEntry: "", ready: () => undefined, phone: () => undefined } }))
    .toThrow("copy-signin-profile-refused");
});

it("refuses a fixture under any live profile root even when the temporary root resolves there", () => {
  const production = join(directory, "Library", "Application Support", "Relay");
  const temporary = join(production, "tmp"), inside = join(temporary, "fixture", "Relay-development"), outside = join(directory, "fixture", "Relay-development");
  for (const path of [inside, outside]) mkdirSync(path, { recursive: true });
  expect(() => assertCopySigninFixture("development", inside, temporary, [production])).toThrow("copy-signin-target-refused");
  expect(() => assertCopySigninFixture("development", inside, temporary, [inside])).toThrow("copy-signin-target-refused");
  expect(() => assertCopySigninFixture("development", outside, directory, [production])).not.toThrow();
  expect(() => assertCopySigninFixture("staging", outside, directory, [production])).toThrow("copy-signin-target-refused");
});

it("refuses a fixture reached through a case alias of a live profile root that holds the temporary root", () => {
  const live = join(directory, "Live"), alias = join(directory, "live"), fixture = join(alias, "tmp", "fixture", "Relay-development");
  mkdirSync(join(live, "tmp", "fixture", "Relay-development"), { recursive: true });
  // Case-sensitive volumes have no alias; the check must refuse either way.
  expect(() => assertCopySigninFixture("development", fixture, join(alias, "tmp"), [live])).toThrow("copy-signin-target-refused");
});

it("keeps the OS keychain and the real Duo provider unless a fixture workspace is bound", () => {
  expect(selectedCredentialSecretStore()).toBe(osCredentialSecretStore);
  expect(copySigninFixtureBrowser()).toBeUndefined();
  const workspace = join(directory, "Relay-development");
  mkdirSync(workspace);
  expect(() => useCopySigninFixture("development", workspace)).toThrow("copy-signin-target-refused");
  expect(selectedCredentialSecretStore()).toBe(osCredentialSecretStore);
  expect(copySigninFixtureBrowser()).toBeUndefined();
  expect(readdirSync(workspace)).toEqual([]);
});

it("refuses copy onboarding in the production bootstrap before acquiring a lifetime lock", async () => {
  const { runSecureEnvironmentBootstrap } = await import("../../../src/backend/app/bootstrap/secure-env-bootstrap.js");
  const acquireLifetimeLock = vi.fn(() => { throw new Error("production lock touched"); });
  await expect(runSecureEnvironmentBootstrap(["cli", "dashboard"], { acquireLifetimeLock, copySignin: {
    profile: "development",
    credentials() { throw new Error("credentials read before admission"); },
    phone() { throw new Error("approval before admission"); },
  } })).rejects.toThrow("copy-signin-profile-refused");
  expect(acquireLifetimeLock).not.toHaveBeenCalled();
});

const active = { state: "active", profileId: "10000000-0000-4000-8000-000000000001", duoState: "ready", epoch: 1 };
const activeResponse = () => Response.json(active, { headers: { "x-relay-session": "synthetic-session", "x-relay-resume": "synthetic-resume" } });

it("resumes a verified dashboard session without reading credentials or posting sign-in", async () => {
  const routes: string[] = [];
  const dashboard = createDashboardClient({
    baseUrl: "http://127.0.0.1:3940",
    fetchImpl: async url => {
      const path = new URL(String(url)).pathname;
      routes.push(path);
      return path.endsWith("/state") ? Response.json({ state: "signed-out", resumable: true }) : activeResponse();
    },
  });
  const read = vi.fn(() => { throw new Error("credentials read during resume"); });
  await expect(driveCopySignin("development", dashboard, read)).resolves.toBe("resumed");
  expect(read).not.toHaveBeenCalled();
  expect(routes).toEqual(["/api/v1/profile/state", "/api/v1/profile/resume"]);
});

it("opens a new copy's Duo setup and only finishes after the dashboard reports both receipts", async () => {
  const operationId = "10000000-0000-4000-8000-000000000002";
  const receipt = { ceremonyObserved: true, portalAccepted: true, operatorConfirmed: false, exactCredentialRequestObserved: false };
  const idle = { state: "idle", ...receipt, ceremonyObserved: false, portalAccepted: false };
  const complete = { state: "complete", ...receipt };
  const draft = { state: "onboarding", operationId, profileId: active.profileId, browser: { state: "open", generation: 1 } };
  const calls: { path: string; body: unknown; session: string | null }[] = [];
  const dashboard = createDashboardClient({
    baseUrl: "http://127.0.0.1:3940",
    fetchImpl: async (url, init) => {
      const path = new URL(url).pathname;
      calls.push({ path, body: init?.body, session: new Headers(init?.headers).get("x-relay-session") });
      if (path.endsWith("/state")) return Response.json({ state: "signed-out", signUpRequired: true });
      if (path.endsWith("/sign-up")) return Response.json({ ...draft, step: "duo", methods: { key: idle } },
        { headers: { "x-relay-session": "synthetic-draft" } });
      if (path.endsWith("/portal")) return Response.json({ ...draft, step: "ready", methods: { key: complete } });
      return activeResponse();
    },
  });
  await expect(driveCopySignin("development", dashboard, () => readCopySigninCredentials(envFile))).resolves.toBe("signed in");
  expect(calls).toEqual([
    { path: "/api/v1/profile/state", body: undefined, session: null },
    { path: "/api/v1/profile/sign-up", body: JSON.stringify({
      email: credentials.RELAY_EMAIL, password: credentials.RELAY_PASSWORD, firstName: "Development", lastName: "Operator",
    }), session: null },
    { path: "/api/v1/profile/onboarding/duo/portal", body: JSON.stringify({ operationId }), session: "synthetic-draft" },
    { path: "/api/v1/profile/onboarding/complete", body: JSON.stringify({ operationId }), session: "synthetic-draft" },
  ]);
});

it("passes only Relay credentials to the dashboard and keeps echoed secrets out of output and files", async () => {
  const post = vi.fn();
  const dashboard = createDashboardClient({
    baseUrl: "http://127.0.0.1:3940",
    fetchImpl: async (url, init) => {
      if (new URL(String(url)).pathname.endsWith("/state")) return Response.json({ state: "signed-out", signUpRequired: false });
      post(init?.body);
      throw new Error(Object.values(credentials).join(" "));
    },
  });
  const stdout = vi.spyOn(process.stdout, "write"), stderr = vi.spyOn(process.stderr, "write");
  try {
    await expect(driveCopySignin("development", dashboard, () => readCopySigninCredentials(envFile)))
      .rejects.toThrow(/^copy-signin-dashboard-failed$/u);
    expect(post.mock.calls).toEqual([[JSON.stringify({ email: credentials.RELAY_EMAIL, password: credentials.RELAY_PASSWORD })]]);
    const output = [...stdout.mock.calls, ...stderr.mock.calls].map(([chunk]) => String(chunk)).join("\n");
    for (const value of Object.values(credentials)) expect(output).not.toContain(value);
    expect(readdirSync(directory)).toEqual(["operator-signin.env"]);
  } finally { stdout.mockRestore(); stderr.mockRestore(); }
});
