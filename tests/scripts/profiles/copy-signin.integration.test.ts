import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { afterEach, expect, it, vi } from "vitest";

// Every test here holds the development lifetime lock, so they share one file and run in turn.
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
const { readPrivateFile } = await import("../../../src/backend/storage/configuration/credential-safe-file.js");
const duo = await import("../../../src/backend/runtime/browser/onboarding-duo-provider.js");
const { runtimeProfiles } = await import("../../../src/models/config/define-runtime-isolation.js");
const { SignUpOperationSchema } = await import("../../../src/models/profiles/profile.js");

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
  expect(vi.mocked(duo.copySigninFixtureBrowser).mock.results).toEqual([{ type: "return", value: undefined }]);
  expect(vi.mocked(duo.createProfileOnboardingDuoProvider).mock.calls[0]?.[0].copySignin).toBe(copySignin);
});

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const credentials = {
  RELAY_EMAIL: "relay-email-sentinel@example.test",
  RELAY_PASSWORD: "relay-password-sentinel",
  UCPATH_USERNAME: "ucpath-username-sentinel@ucsd.edu",
  UCPATH_PASSWORD: "ucpath-password-sentinel",
};
// HOME moves to the fixture, so Playwright keeps the installed browsers explicitly.
const browsers = chromium.executablePath().split(`${sep}chromium-`)[0];
const sentinels = Object.values(credentials);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function leaks(text: string, root: string, envFile: string, operationPath: string): string[] {
  const file = readPrivateFile(operationPath, { label: "lock", maxBytes: 1_048_576 });
  if (file === undefined) throw new Error("copy sign-in operation is missing");
  const content = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
  const { operationId, relay } = SignUpOperationSchema.parse(JSON.parse(content));
  if (basename(operationPath) !== `${operationId}.json` || relay?.email !== credentials.RELAY_EMAIL) {
    throw new Error("copy sign-in operation has the wrong identity or Relay email");
  }
  const relayField = `"relay":${JSON.stringify(relay)}`;
  if (!content.includes(relayField)) throw new Error("copy sign-in operation lacks the expected Relay field encoding");
  // Mask the permitted email in memory and scan the rest of the operation's original bytes.
  const operationBytes = Buffer.from(content.replace(relayField, `"relay":${JSON.stringify({ ...relay, email: "" })}`));
  const found = sentinels.filter(value => text.includes(value)).map(() => "output");
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && path !== envFile) {
        const bytes = path === operationPath ? operationBytes : readFileSync(path);
        for (const value of sentinels) if (bytes.includes(value)) found.push(path);
      }
    }
  };
  walk(root);
  return found;
}

async function launch(root: string, workspace: string): Promise<{ code: number | null; output: string }> {
  const child = spawn(process.execPath, ["--conditions=development", "--import", "tsx", "scripts/profiles/copy-signin.ts", "development", "--fixture-workspace", workspace], {
    cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HOME: root, RELAY_RUNTIME_PROFILE: "development", PLAYWRIGHT_BROWSERS_PATH: browsers },
  });
  let output = "";
  child.stdout.on("data", chunk => { output += String(chunk); });
  child.stderr.on("data", chunk => { output += String(chunk); });
  const code = await new Promise<number | null>(resolve => { child.on("close", resolve); });
  return { code, output };
}

// The launcher finds the env file through HOME, which Windows does not use.
it.skipIf(process.platform === "win32")("keeps sign-in secrets out of the real launcher's and owned backend's output and written files", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "relay-copy-signin-fixture-")));
  try {
    const envDirectory = join(root, ".config", "relay"), envFile = join(envDirectory, "operator-signin.env");
    const workspace = join(root, "Library", "Application Support", "Relay-development");
    mkdirSync(envDirectory, { recursive: true, mode: 0o700 });
    mkdirSync(workspace, { recursive: true, mode: 0o700 });
    writeFileSync(envFile, Object.entries(credentials).map(([name, value]) => `${name}="${value}"`).join("\n"), { mode: 0o600 });
    const { code, output } = await launch(root, workspace);
    // The owned backend took the sign-up, kept its key in the fixture store and the real owned browser submitted the UCPath sentinels to the synthetic UCSD SSO form.
    expect(output).toContain("copy-signin-duo-unconfirmed");
    expect(output).toContain(`"code":"UCSD_SSO_FIELDS"`);
    expect(code).toBe(1);
    expect(readdirSync(join(workspace, ".tracker", "fixture-keychain")).length).toBeGreaterThan(0);
    expect(JSON.parse(readFileSync(join(workspace, ".tracker", "fixture-sso-submission.json"), "utf8"))).toEqual({
      username: sha256(credentials.UCPATH_USERNAME), password: sha256(credentials.UCPATH_PASSWORD) });
    expect(existsSync(join(workspace, ".tracker", "data", "browsers", "onboarding"))).toBe(true);
    const operations = join(workspace, rebuildRuntimeIsolation.stateRoot, "machine", "operations");
    const names = readdirSync(operations).filter(name => name.endsWith(".json"));
    const [name] = names;
    if (names.length !== 1 || name === undefined) throw new Error("expected exactly one copy sign-in operation");
    const operationPath = join(operations, name);
    expect(leaks(output, root, envFile, operationPath)).toEqual([]);

    const leakPath = join(workspace, "leak.txt");
    writeFileSync(leakPath, credentials.UCPATH_PASSWORD);
    const operation = SignUpOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8")));
    writeFileSync(operationPath, `${JSON.stringify({ ...operation, firstName: credentials.RELAY_EMAIL,
      lastName: credentials.RELAY_PASSWORD })}\n`);
    expect(leaks(`${output}${credentials.RELAY_EMAIL}`, root, envFile, operationPath).sort())
      .toEqual(["output", leakPath, operationPath, operationPath].sort());
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 120_000);

it("refuses a fixture workspace outside the temporary root before the owned backend starts", async () => {
  const parent = join(repositoryRoot, ".work");
  mkdirSync(parent, { recursive: true });
  const root = realpathSync(mkdtempSync(join(parent, "copy-signin-fixture-")));
  try {
    const workspace = join(root, "Relay-development");
    mkdirSync(workspace);
    const child = spawn(process.execPath, ["--conditions=development", "--import", "tsx", "scripts/profiles/copy-signin.ts", "development", "--fixture-workspace", workspace], {
      cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, RELAY_RUNTIME_PROFILE: "development" },
    });
    let output = "";
    child.stdout.on("data", chunk => { output += String(chunk); });
    child.stderr.on("data", chunk => { output += String(chunk); });
    expect(await new Promise<number | null>(resolve => { child.on("close", resolve); })).toBe(1);
    expect(output).toBe("copy-signin-target-refused\n");
    expect(readdirSync(workspace)).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 60_000);
