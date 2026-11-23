import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { chromium, type BrowserContext } from "playwright";
import { z } from "zod";
import { applicationDataWorkspace, rebuildRuntimeIsolation, runtimeProfile } from "../../src/backend/app/config/runtime-isolation.js";
import { probeOwnedViteServer } from "../../src/backend/app/host/local-vite-probe.js";
import { noSymlinkAncestry, readPrivateFile, statDirectory } from "../../src/backend/storage/configuration/credential-safe-file.js";
import { createDashboardClient, type DashboardClient } from "../../src/dashboard/client/index.js";
import { runtimeProfiles } from "../../src/models/config/define-runtime-isolation.js";
import { systemClock } from "../../src/rules/time/clock.js";
import { runDevDashboard } from "../dev/dashboard.js";

const CopyProfileSchema = z.enum(["staging", "development"]);
type CopyProfile = z.infer<typeof CopyProfileSchema>;
const SignInCredentialsSchema = z.strictObject({
  RELAY_EMAIL: z.string().min(1),
  RELAY_PASSWORD: z.string().min(1),
  UCPATH_USERNAME: z.string().min(1),
  UCPATH_PASSWORD: z.string().min(1),
});
type SignInCredentials = z.infer<typeof SignInCredentialsSchema>;
const stateRoute = "/api/v1/profile/state", resumeRoute = "/api/v1/profile/resume";
const resumeKey = "relay.profile.resume";

class CopySigninError extends Error {
  constructor(code: string) { super(code); this.name = "CopySigninError"; }
}

export function readCopySigninCredentials(path: string): SignInCredentials {
  let file: ReturnType<typeof readPrivateFile>;
  try {
    if (noSymlinkAncestry(dirname(path), new Map())) file = readPrivateFile(path, { label: "launcher", maxBytes: 8192 });
  } catch { throw new CopySigninError("copy-signin-env-unavailable"); }
  if (file === undefined || (Number(file.stat.mode) & 0o7777) !== 0o600) throw new CopySigninError("copy-signin-env-unavailable");
  try {
    return SignInCredentialsSchema.parse(parseEnv(file.bytes.toString("utf8")));
  } catch { throw new CopySigninError("copy-signin-env-invalid"); }
}

export function assertCopySigninTarget(profile: CopyProfile, workspace: string,
  ports: Readonly<{ backendPort: number; frontendPort: number; lockPort: number }>): void {
  if (!CopyProfileSchema.safeParse(profile).success) throw new CopySigninError("copy-signin-target-refused");
  const expected = runtimeProfiles[profile];
  if (workspace !== applicationDataWorkspace(undefined, profile) || ports.backendPort !== expected.backendPort
    || ports.frontendPort !== expected.frontendPort || ports.lockPort !== expected.lockPort) {
    throw new CopySigninError("copy-signin-target-refused");
  }
  try {
    for (const path of [join(workspace, ".tracker", "control"), join(workspace, rebuildRuntimeIsolation.artifactRoot)]) {
      noSymlinkAncestry(path, new Map());
    }
  } catch { throw new CopySigninError("copy-signin-target-refused"); }
}

type ProfileDashboard = Pick<DashboardClient, "readProfileSession" | "resumeProfile" | "signInProfile" | "signUpProfile"
  | "openProfileOnboardingPortal" | "completeProfileOnboarding">;

export async function driveCopySignin(profile: CopyProfile, dashboard: ProfileDashboard,
  credentials: () => SignInCredentials): Promise<"resumed" | "signed in"> {
  try {
    let state = await dashboard.readProfileSession();
    if (state.state === "active" && state.duoState === "ready") return "resumed";
    if (state.state === "signed-out") {
      if (state.resumable === true) {
        const resumed = await dashboard.resumeProfile();
        if (resumed.state === "active" && resumed.duoState === "ready") return "resumed";
        throw new CopySigninError("copy-signin-resume-refused");
      }
      if (state.logoutIncomplete === true) throw new CopySigninError("copy-signin-logout-incomplete");
      const { RELAY_EMAIL: email, RELAY_PASSWORD: password } = credentials();
      state = state.signUpRequired === true
        ? await dashboard.signUpProfile({ email, password, firstName: profile === "development" ? "Development" : "Staging", lastName: "Operator" })
        : await dashboard.signInProfile({ email, password });
    }
    if (state.state === "onboarding") {
      const { operationId, profileId } = state;
      if (state.step === "duo") state = await dashboard.openProfileOnboardingPortal({ operationId });
      if (state.state !== "onboarding" || state.step !== "ready" || state.operationId !== operationId || state.profileId !== profileId) {
        throw new CopySigninError("copy-signin-duo-unconfirmed");
      }
      state = await dashboard.completeProfileOnboarding({ operationId });
      if (state.state !== "active" || state.profileId !== profileId) throw new CopySigninError("copy-signin-finish-unconfirmed");
    }
    if (state.state !== "active" || state.duoState !== "ready") throw new CopySigninError("copy-signin-dashboard-refused");
    return "signed in";
  } catch (error) {
    if (error instanceof CopySigninError) throw error;
    throw new CopySigninError("copy-signin-dashboard-failed");
  }
}

function operatorCredentials(): SignInCredentials {
  return readCopySigninCredentials(join(homedir(), ".config", "relay", "operator-signin.env"));
}

async function runCopyBackend(profile: CopyProfile): Promise<void> {
  if (process.send === undefined || !process.connected || runtimeProfile !== profile) throw new CopySigninError("copy-signin-profile-refused");
  assertCopySigninTarget(profile, applicationDataWorkspace(undefined, profile), rebuildRuntimeIsolation);
  const { captureBuildId } = await import("../../src/backend/runtime/build-id.js");
  captureBuildId();
  const { runSecureEnvironmentBootstrap } = await import("../../src/backend/app/bootstrap/secure-env-bootstrap.js");
  const { runCli } = await import("../../src/cli.js");
  await runSecureEnvironmentBootstrap(["cli", "dashboard"], {
    runCli: (admission, accept, lifetime) => runCli(admission, accept, lifetime, {
      profile,
      credentials() {
        const { UCPATH_USERNAME: userId, UCPATH_PASSWORD: password } = operatorCredentials();
        return { userId, password };
      },
      phone() { process.send?.({ type: "relay-copy-signin-phone" }); },
    }),
  });
}

async function waitForFrontend(port: number, ownerNonce: string, signal: AbortSignal): Promise<void> {
  const deadline = systemClock.monotonicMs() + 30_000;
  while (!signal.aborted && systemClock.monotonicMs() < deadline) {
    const result = await probeOwnedViteServer({ port, ownerNonce, signal, clock: systemClock,
      deadlineMonotonicMs: Math.min(deadline, systemClock.monotonicMs() + 2000) });
    if (result.state === "owned") return;
    if (result.reason !== "probe-request-failed" && result.reason !== "probe-deadline-expired") break;
    await delay(100, undefined, { signal });
  }
  throw new CopySigninError("copy-signin-dashboard-not-owned");
}

async function openCopyDashboard(profile: CopyProfile): Promise<void> {
  const ports = runtimeProfiles[profile], workspace = applicationDataWorkspace(undefined, profile);
  assertCopySigninTarget(profile, workspace, ports);
  const origin = `http://127.0.0.1:${String(ports.frontendPort)}`;
  const ready = Promise.withResolvers<string>(), signals = new EventEmitter(), stop = new AbortController();
  let approvals = 0, context: BrowserContext | undefined;
  const finished = runDevDashboard({ profile, signals, copySignin: {
    backendEntry: fileURLToPath(import.meta.url),
    ready: ready.resolve,
    phone() {
      if (approvals === 0) {
        approvals = 1;
        process.stdout.write("approve the Duo request on your phone\n");
      }
    },
  } }).finally(() => { stop.abort(); });
  const halt = () => { signals.emit("SIGTERM"); };
  process.on("SIGINT", halt);
  process.on("SIGTERM", halt);
  try {
    const nonce = await Promise.race([ready.promise, finished.then(() => { throw new CopySigninError("copy-signin-dashboard-stopped"); })]);
    await waitForFrontend(ports.frontendPort, nonce, stop.signal);
    const browserDirectory = join(workspace, "copy-signin-browser");
    mkdirSync(browserDirectory, { mode: 0o700, recursive: true });
    statDirectory(browserDirectory, "copy sign-in browser", 0o700);
    context = await chromium.launchPersistentContext(browserDirectory, {
      headless: false, channel: "chromium", acceptDownloads: false,
      args: ["--no-proxy-server", "--disable-features=PasswordManagerOnboarding,PasswordImport,PasswordManagerEnabled"],
    });
    const closed = new Promise<void>(resolve => { context?.once("close", resolve); });
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(`${origin}${stateRoute}`);
    let proof = await page.evaluate(({ origin, resumeKey }) => {
      if (location.origin !== origin) throw new Error("copy-signin-dashboard-not-owned");
      return localStorage.getItem(resumeKey);
    }, { origin, resumeKey });
    const dashboard = createDashboardClient({ baseUrl: origin, async fetchImpl(input, init) {
      const url = new URL(input);
      if (url.origin !== origin || url.username || url.password) throw new CopySigninError("copy-signin-dashboard-not-owned");
      const headers = new Headers(init?.headers);
      if (proof !== null && (url.pathname === stateRoute || url.pathname === resumeRoute)) headers.set("x-relay-resume", proof);
      const response = await fetch(url, { ...init, headers, redirect: "error", signal: stop.signal });
      if (response.ok) proof = response.headers.get("x-relay-resume") ?? proof;
      return response;
    } });
    const result = await driveCopySignin(profile, dashboard, operatorCredentials);
    const resumeProof = z.string().min(1).parse(proof);
    await page.evaluate(({ origin, resumeKey, resumeProof }) => {
      if (location.origin !== origin) throw new Error("copy-signin-dashboard-not-owned");
      localStorage.setItem(resumeKey, resumeProof);
    }, { origin, resumeKey, resumeProof });
    await page.goto(origin);
    process.stdout.write(`${profile}: ${result} (${String(approvals)} Duo phone approvals)\n`);
    await Promise.race([closed, finished]);
  } finally {
    try { await context?.close(); }
    finally {
      halt();
      const status = await finished;
      process.removeListener("SIGINT", halt);
      process.removeListener("SIGTERM", halt);
      if (status !== 0) throw new CopySigninError("copy-signin-dashboard-stopped");
    }
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  delete process.env.DEBUG;
  delete process.env.PWDEBUG;
  delete process.env.NODE_DEBUG;
  try {
    const args = process.argv.slice(2);
    const child = args[0] === "--owned-backend" && args.length === 2;
    const profile = CopyProfileSchema.safeParse(args.length === 1 ? args[0] : child ? args[1] : undefined);
    if (!profile.success) throw new CopySigninError("Usage: tsx scripts/profiles/copy-signin.ts <staging|development>");
    if (child) await runCopyBackend(profile.data);
    else await openCopyDashboard(profile.data);
  } catch (error) {
    process.stderr.write(`${error instanceof CopySigninError ? error.message : "copy-signin-failed"}\n`);
    process.exitCode = 1;
  }
}
