import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type BrowserContext, type Page } from "playwright";
import { z } from "zod";
import { applicationDataWorkspace, rebuildRuntimeIsolation } from "../../src/backend/app/config/runtime-isolation.js";
import { acquireEntrypointAdmission } from "../../src/backend/storage/admission/bootstrap-admission.js";
import { acquireRuntimeLifetimeLock } from "../../src/backend/storage/admission/lifetime-lock.js";
import { noSymlinkAncestry, statDirectory } from "../../src/backend/storage/configuration/credential-safe-file.js";
import { createDashboardClient } from "../../src/dashboard/client/index.js";
import { runtimeProfiles } from "../../src/models/config/define-runtime-isolation.js";
import type { PublicProfileState } from "../../src/models/profiles/public-profile.js";
import type { runDevDashboard } from "../dev/dashboard.js";
import { assertCopySigninTarget, CopySigninError, driveCopySignin, operatorCredentials, resumeKey, resumeRoute, stateRoute, waitForFrontend } from "./copy-signin.js";

const profile = "development";
const ports = runtimeProfiles[profile];
const repository = fileURLToPath(new URL("../..", import.meta.url));

export function checkoutGit(checkout: string, args: readonly string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
  return execFileSync("git", ["-C", checkout, ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function developmentCopyCheckout(): string {
  const checkout = join(userInfo().homedir, "Projects", "hr-relay-dev");
  const commonDir = ["rev-parse", "--path-format=absolute", "--git-common-dir"];
  if (realpathSync(checkout) !== checkout || !lstatSync(join(checkout, ".git")).isFile()
    || checkoutGit(checkout, commonDir) !== checkoutGit(repository, commonDir)
    || checkoutGit(checkout, ["branch", "--show-current"]) !== ""
    || checkoutGit(checkout, ["status", "--porcelain"]) !== "") {
    throw new CopySigninError("copy-signin-headless-worktree-refused");
  }
  return checkout;
}

async function enrolledProfile(workspace: string, beforeStart?: (profile: CopyProfile) => void) {
  assertCopySigninTarget(profile, workspace, ports);
  const lock = await acquireRuntimeLifetimeLock(ports.lockPort);
  try {
    const admission = acquireEntrypointAdmission(workspace, "shared", lock);
    try {
      const { profiles, activeProfileId, installationId } = admission.readProfileRegistry();
      const row = profiles.length === 1 && (activeProfileId === null || profiles[0].profileId === activeProfileId) ? profiles[0] : undefined;
      if (row?.lifecycle !== "ready" || row.credentialState !== "saved" || row.duoState !== "ready" || row.registration.onboardingCompletion === undefined) {
        throw new CopySigninError("copy-signin-headless-enrollment-required");
      }
      const machineRoot = join(workspace, rebuildRuntimeIsolation.stateRoot);
      const stateRoot = join(machineRoot, "profiles", row.profileId);
      if (admission.stateRoot !== machineRoot || !noSymlinkAncestry(stateRoot, new Map())) {
        throw new CopySigninError("copy-signin-headless-profile-root-refused");
      }
      const selected = { profileId: row.profileId, installationId, stateRoot };
      beforeStart?.(selected);
      return selected;
    } finally { admission.release(); }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      const refused = new CopySigninError("copy-signin-headless-enrollment-required");
      refused.cause = error;
      throw refused;
    }
    throw error;
  } finally { await lock.close(); }
}

type CopyProfile = Readonly<{ profileId: string; installationId: string; stateRoot: string }>;

export interface HeadlessCopySession extends CopyProfile {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly origin: string;
  readonly signal: AbortSignal;
}

export async function withHeadlessCopySignin<T>(use: (session: HeadlessCopySession) => Promise<T>, options: {
  readonly signal?: AbortSignal;
  readonly beforeStart?: (profile: CopyProfile) => void;
  readonly expectedSha?: string;
} = {}): Promise<T> {
  options.signal?.throwIfAborted();
  if (process.env.PWDEBUG || process.env.DEBUG || process.env.NODE_DEBUG) throw new CopySigninError("copy-signin-headless-debug-refused");
  const workspace = applicationDataWorkspace(undefined, profile);
  const selected = await enrolledProfile(workspace, options.beforeStart);
  const checkout = developmentCopyCheckout();
  const head = checkoutGit(checkout, ["rev-parse", "HEAD"]);
  const requireHead = (expected: string) => {
    if (head !== expected || checkoutGit(checkout, ["rev-parse", "HEAD"]) !== expected) {
      throw new CopySigninError("copy-signin-headless-sha-changed");
    }
  };
  requireHead(options.expectedSha ?? head);
  const launcherEntry = join(checkout, "scripts", "dev", "dashboard.ts");
  if (realpathSync(launcherEntry) !== launcherEntry) throw new CopySigninError("copy-signin-headless-worktree-refused");
  const launcherUrl = pathToFileURL(launcherEntry);
  launcherUrl.searchParams.set("sha", head);
  const launcher: unknown = await import(launcherUrl.href);
  const { runDevDashboard: start } = z.object({ runDevDashboard: z.custom<typeof runDevDashboard>(fn => typeof fn === "function") }).parse(launcher);
  const backendEntry = join(checkout, "scripts", "profiles", "copy-signin.ts");
  if (realpathSync(backendEntry) !== backendEntry) throw new CopySigninError("copy-signin-headless-worktree-refused");
  const signals = new EventEmitter(), stop = new AbortController();
  const signal = options.signal === undefined ? stop.signal : AbortSignal.any([options.signal, stop.signal]);
  const halt = () => { signals.emit("SIGTERM"); };
  const ready = Promise.withResolvers<string>();
  const finished = start({ profile, signals, copySignin: { backendEntry, ready: ready.resolve,
    phone() { stop.abort(new CopySigninError("copy-signin-headless-enrollment-required")); } } })
    .finally(() => { stop.abort(new CopySigninError("copy-signin-headless-dashboard-stopped")); });
  signal.addEventListener("abort", halt, { once: true });
  let context: BrowserContext | undefined;
  let result: T;
  let dashboardStatus: number;
  try {
    signal.throwIfAborted();
    const nonce = await Promise.race([ready.promise, finished.then(() => { throw signal.reason instanceof Error ? signal.reason : new CopySigninError("copy-signin-headless-dashboard-stopped"); })]);
    await waitForFrontend(ports.frontendPort, nonce, signal);
    requireHead(head);
    const origin = `http://127.0.0.1:${String(ports.frontendPort)}`;
    const browserDirectory = join(workspace, "copy-signin-browser");
    mkdirSync(browserDirectory, { mode: 0o700, recursive: true });
    statDirectory(browserDirectory, "copy sign-in browser", 0o700);
    context = await chromium.launchPersistentContext(browserDirectory, {
      headless: true, channel: "chromium", acceptDownloads: false, serviceWorkers: "block",
      args: ["--no-proxy-server", "--disable-features=PasswordManagerOnboarding,PasswordImport,PasswordManagerEnabled"],
    });
    context.once("close", () => { stop.abort(new CopySigninError("copy-signin-headless-browser-stopped")); });
    signal.throwIfAborted();
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
    await context.routeWebSocket(/.*/u, socket => {
      if (new URL(socket.url()).origin === origin.replace("http:", "ws:")) socket.connectToServer();
      else void socket.close({ code: 1008 });
    });
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(`${origin}${stateRoute}`);
    if (new URL(page.url()).origin !== origin) throw new CopySigninError("copy-signin-headless-dashboard-refused");
    let proof = await page.evaluate(key => localStorage.getItem(key), resumeKey);
    const dashboard = createDashboardClient({ baseUrl: origin, async fetchImpl(input, init) {
      const url = new URL(input);
      if (url.origin !== origin || url.username || url.password) throw new CopySigninError("copy-signin-headless-dashboard-refused");
      const headers = new Headers(init?.headers);
      if (proof !== null && (url.pathname === stateRoute || url.pathname === resumeRoute)) headers.set("x-relay-resume", proof);
      const response = await fetch(url, { ...init, headers, redirect: "error", signal });
      if (response.ok) proof = response.headers.get("x-relay-resume") ?? proof;
      return response;
    } });
    const refuseEnrollment = () => { throw new CopySigninError("copy-signin-headless-enrollment-required"); };
    const check = (state: PublicProfileState) => {
      if (state.state === "onboarding" || state.state === "signed-out" && state.signUpRequired === true) return refuseEnrollment();
      if (state.state === "active" && (state.profileId !== selected.profileId || state.duoState !== "ready")) {
        throw new CopySigninError("copy-signin-headless-profile-changed");
      }
      return state;
    };
    await driveCopySignin(profile, {
      async readProfileSession() { return check(await dashboard.readProfileSession()); },
      async resumeProfile() { return check(await dashboard.resumeProfile()); },
      async signInProfile(request) { return check(await dashboard.signInProfile(request)); },
      signUpProfile: refuseEnrollment, openProfileOnboardingPortal: refuseEnrollment, completeProfileOnboarding: refuseEnrollment,
    }, operatorCredentials);
    await page.evaluate(({ origin, key, value }) => {
      if (location.origin !== origin) throw new Error("copy-signin-headless-dashboard-refused");
      localStorage.setItem(key, value);
    }, { origin, key: resumeKey, value: z.string().min(1).parse(proof) });
    signal.throwIfAborted();
    result = await use({ context, page, origin, signal, ...selected });
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener("abort", halt);
    try { await context?.close(); }
    finally {
      halt();
      dashboardStatus = await finished;
    }
  }
  if (dashboardStatus !== 0) throw new CopySigninError("copy-signin-headless-dashboard-stopped");
  return result;
}
