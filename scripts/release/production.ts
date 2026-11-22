import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, mkdtempSync, openSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { rebuildRuntimeIsolation } from "../../src/backend/app/config/runtime-isolation.js";
import {
  acquireRuntimeLifetimeLock, RuntimeAlreadyRunningError, type RuntimeLifetimeLock,
} from "../../src/backend/storage/admission/lifetime-lock.js";
import { ApplicationLifecycleSchema } from "../../src/models/dashboard/application-lifecycle.js";
import { ProfileLoginRequestSchema, PublicProfileStateSchema } from "../../src/models/profiles/public-profile.js";
import { ApplicationCommandRequestSchema, CommandResultSchema } from "../../src/rules/commands/commands.js";
import { systemClock } from "../../src/rules/time/clock.js";
import { remote } from "./github.js";
import { waitForIdleDashboard } from "./release.js";

const { backendPort, lockPort } = rebuildRuntimeIsolation;
const pollMs = 1000;
const startupTimeoutMs = 60_000;

export function productionRelease(report: (message: string) => void) {
  let checkout: string;
  let lock: RuntimeLifetimeLock | undefined;
  const git = (...args: string[]) => execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" }).trim();
  const npm = (...args: string[]) => execFileSync("npm", args, { cwd: checkout, stdio: "inherit" });
  const cleanCheckout = () => {
    if (git("rev-parse", "--show-toplevel") !== checkout || git("remote", "get-url", "origin") !== remote) {
      throw new Error("The production checkout must be the HR Relay clone with the canonical origin.");
    }
    if (git("status", "--porcelain", "--untracked-files=all") !== "") {
      throw new Error("The production checkout has local changes. Preserve them before releasing.");
    }
  };
  const listener = () => {
    const result = spawnSync("lsof", ["-nP", "-tiTCP:" + backendPort, "-sTCP:LISTEN"], { encoding: "utf8" });
    if (result.error !== undefined) throw result.error;
    if (result.status === 1 && result.stdout === "" && result.stderr === "") return undefined;
    const pids = new Set(result.stdout.trim().split("\n"));
    const pid = [...pids][0];
    if (result.status !== 0 || result.stderr !== "" || pids.size !== 1 || !/^\d+$/u.test(pid)) {
      throw new Error("Could not prove exclusive dashboard listener ownership.");
    }
    const cwd = execFileSync("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"], { encoding: "utf8" }).trim().split("\n").at(-1);
    const command = execFileSync("ps", ["-p", pid, "-o", "command="], { encoding: "utf8" }).trim();
    if (cwd !== `n${checkout}` || !command.endsWith("scripts/dev/secure-env-bootstrap.ts cli dashboard --prod")) {
      throw new Error("The dashboard listener is not the production dashboard in the production checkout.");
    }
    return pid;
  };
  const origin = `http://127.0.0.1:${backendPort}`;
  let token: string | undefined;
  const query = (path: string, body?: string) => fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token === undefined ? {} : { "x-relay-session": token }),
      ...(body === undefined ? {} : { origin, "content-type": "application/json" }) },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  const signIn = async () => {
    if (!process.stdin.isTTY) throw new Error("Run the release from an interactive terminal to sign in to the dashboard.");
    const terminal = createInterface({ input: process.stdin, output: process.stderr });
    let email: string;
    try { email = await terminal.question("Production Relay sign-in email: "); }
    finally { terminal.close(); }
    const password = execFileSync("/bin/bash", ["-c", 'IFS= read -r -s -p "Production Relay password: " password && printf "%s" "$password"'], {
      encoding: "utf8", stdio: ["inherit", "pipe", "inherit"],
    });
    process.stderr.write("\n");
    const request = ProfileLoginRequestSchema.parse({ email, password });
    const response = await query("/api/v1/profile/sign-in", JSON.stringify(request));
    const state: unknown = await response.json();
    token = response.headers.get("x-relay-session") ?? undefined;
    if (!response.ok || PublicProfileStateSchema.safeParse(state).data?.state !== "active" || token === undefined) {
      throw new Error("Production Relay sign-in did not return an active session.");
    }
  };
  const snapshot = async () => {
    const response = await query("/api/v1/application-lifecycle");
    if (!response.ok) throw new Error("Could not read live run status. Supply the active production dashboard session.");
    const body: unknown = await response.json();
    return ApplicationLifecycleSchema.parse(body);
  };
  const close = async () => {
    await lock?.close();
    lock = undefined;
  };

  return {
    async stopIdleDashboard() {
      if (process.platform !== "darwin") throw new Error("Production deployment is supported on the release Mac.");
      checkout = realpathSync(join(homedir(), "Projects", "hr-relay"));
      cleanCheckout();
      const pid = listener();
      if (pid !== undefined) {
        await signIn();
        while (true) {
          const status = await waitForIdleDashboard(snapshot, () => sleep(pollMs), report);
          if (status.state !== "ready" || listener() !== pid) throw new Error("The production dashboard changed while preparing to quit.");
          const request = ApplicationCommandRequestSchema.parse({ family: "application", type: "pause-all-and-quit",
            commandId: randomUUID(), requestedBy: "local-operator", requestedAt: systemClock.now().toISOString(), source: "dashboard",
            target: { runtimeGeneration: status.runtimeGeneration }, payload: { confirmed: true, targets: [] } });
          const response = await query("/api/v1/commands", JSON.stringify(request));
          const body: unknown = await response.json();
          const outcome = CommandResultSchema.parse(body);
          if (outcome.commandId !== request.commandId) throw new Error("The dashboard quit reply did not match the request.");
          if (response.ok && outcome.state === "applied") break;
          if (outcome.state !== "rejected" || outcome.code !== "policy-refused" || (await snapshot()).targets.length === 0) {
            throw new Error("Relay refused to quit. Preserve the running dashboard and inspect its status.");
          }
        }
      }
      const deadline = systemClock.monotonicMs() + startupTimeoutMs;
      while (lock === undefined) {
        try { lock = await acquireRuntimeLifetimeLock(lockPort); }
        catch (error) {
          if (!(error instanceof RuntimeAlreadyRunningError) || systemClock.monotonicMs() >= deadline) throw error;
          await sleep(pollMs);
        }
      }
      if (listener() !== undefined) throw new Error("The production dashboard still owns its HTTP listener.");
    },
    deploy({ tag, commit }: { tag: string; commit: string }) {
      if (lock === undefined) throw new Error("Stopped dashboard custody is required before deployment.");
      lock.assertHeld();
      cleanCheckout();
      git("fetch", "origin", `refs/tags/${tag}:refs/tags/${tag}`);
      if (git("rev-parse", `refs/tags/${tag}^{commit}`) !== commit) throw new Error("The fetched tag does not match the promotion merge commit.");
      git("switch", "--detach", `refs/tags/${tag}`);
      npm("ci");
      npm("run", "web:build");
    },
    async restartDashboard() {
      const directory = mkdtempSync(join(tmpdir(), "relay-release-"));
      const log = join(directory, "dashboard.log");
      await close();
      const fd = openSync(log, "wx", 0o600);
      const child = (() => {
        try { return spawn("npm", ["run", "dashboard:prod"], { cwd: checkout, detached: true, stdio: ["ignore", fd, fd] }); }
        finally { closeSync(fd); }
      })();
      let startupError: Error | undefined;
      child.once("error", error => { startupError = error; });
      child.unref();
      report(`Starting the production dashboard. Startup log ${log}`);
      const deadline = systemClock.monotonicMs() + startupTimeoutMs;
      while (systemClock.monotonicMs() < deadline) {
        if (startupError !== undefined) throw startupError;
        if (child.exitCode !== null || child.signalCode !== null) throw new Error("The production dashboard exited during startup.");
        const pid = listener();
        if (pid !== undefined) {
          const group = execFileSync("ps", ["-p", pid, "-o", "pgid="], { encoding: "utf8" }).trim();
          if (group !== String(child.pid)) throw new Error("The production dashboard listener belongs to another launch.");
          const response = await fetch(`http://127.0.0.1:${backendPort}/api/v1/profile/state`, { signal: AbortSignal.timeout(5000), redirect: "error" });
          const state: unknown = await response.json();
          if (response.ok && PublicProfileStateSchema.safeParse(state).data?.state === "signed-out") {
            report("The production dashboard is ready for sign-in.");
            return;
          }
          throw new Error("The production listener did not return the expected ready state.");
        }
        await sleep(pollMs);
      }
      throw new Error("Production dashboard startup could not be confirmed within 60 seconds.");
    },
    close,
  };
}
