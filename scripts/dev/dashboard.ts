/** `npm run dashboard` owns the BFF and Vite dev server, including their shutdown. */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEVELOPMENT_DEBUG_MIRROR_ENV } from "../../src/models/config/secrets.js";
import {
  DASHBOARD_LAUNCH_NONCE_ENV,
  DashboardLaunchNonceSchema,
} from "../../src/backend/transports/http/frontend-owner.js";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const STARTUP_PROGRESS_MS = 30_000;

interface Managed {
  readonly name: string;
  readonly child: ChildProcess;
  closed: boolean;
}

export interface DashboardLauncherOptions {
  readonly mode?: "dashboard" | "backend" | "web";
  readonly frontendOwnerFile?: string;
  readonly signals?: EventEmitter;
  readonly writeError?: (message: string) => void;
}

export function runDevDashboard(options: DashboardLauncherOptions = {}): Promise<number> {
  const mode = options.mode ?? "dashboard";
  const frontendOwnerFile = options.frontendOwnerFile ?? join(repositoryRoot, "node_modules", ".cache", "relay-dashboard", "frontend-owner");
  const writeError = options.writeError ?? ((message: string) => { process.stderr.write(message); });
  let launchNonce: string;
  try {
    launchNonce = mode === "web" ? DashboardLaunchNonceSchema.parse(readFileSync(frontendOwnerFile, "utf8"))
      : DashboardLaunchNonceSchema.parse(randomBytes(32).toString("hex"));
  } catch (error) {
    if (!(mode === "web" && error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    writeError('[dashboard] Start npm run backend first and wait for "listening".\n');
    return Promise.resolve(1);
  }
  const childEnvironment = { ...process.env, [DASHBOARD_LAUNCH_NONCE_ENV]: launchNonce, [DEVELOPMENT_DEBUG_MIRROR_ENV]: "1" };
  const signals = options.signals ?? process;
  const managed: Managed[] = [];
  let stopping = false;
  let result = 0;
  let forwardedSignal: NodeJS.Signals | undefined;
  let ready = false;
  let progress: ReturnType<typeof setInterval> | undefined;
  let finish: (code: number) => void = () => undefined;
  const done = new Promise<number>(resolve => { finish = resolve; });

  function stopProgress(): void {
    if (progress === undefined) return;
    clearInterval(progress);
    progress = undefined;
  }

  function completeIfClosed(): void {
    if (!stopping || !managed.every(item => item.closed)) return;
    signals.removeListener("SIGINT", onInterrupt);
    signals.removeListener("SIGTERM", onTerminate);
    if (mode === "backend" && ready) {
      try { if (readFileSync(frontendOwnerFile, "utf8") === launchNonce) unlinkSync(frontendOwnerFile); }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
          writeError("[dashboard] frontend ownership handoff cleanup failed.\n"); result = 1;
        }
      }
    }
    finish(result);
  }

  function stop(signal: NodeJS.Signals, code: number): void {
    if (stopping) return;
    stopping = true;
    result = code;
    forwardedSignal = signal;
    stopProgress();
    for (const { child, closed } of managed) {
      if (!closed && child.exitCode === null && child.signalCode === null) child.kill(signal);
    }
    completeIfClosed();
  }

  function launch(name: string, args: readonly string[], ipc = false): ChildProcess {
    const child = spawn(process.execPath, args, {
      cwd: repositoryRoot,
      stdio: ipc ? ["inherit", "inherit", "inherit", "ipc"] : "inherit",
      env: childEnvironment,
    });
    const item: Managed = { name, child, closed: false };
    managed.push(item);
    child.on("error", (error) => {
      writeError(`[dashboard] could not start ${name}: ${error.message}\n`);
      if (stopping) result = 1;
      else stop("SIGTERM", 1);
    });
    child.on("exit", (code, signal) => {
      if (!stopping) {
        const how = signal === null ? `exit code ${String(code)}` : `signal ${signal}`;
        writeError(`\n[dashboard] ${name} stopped (${how}); stopping the rest.\n`);
        stop("SIGTERM", code ?? 1);
      } else if (result === 0) {
        if (code !== null && code !== 0) result = code;
        else if (signal !== null && signal !== forwardedSignal) result = 1;
      }
    });
    child.on("close", () => { item.closed = true; completeIfClosed(); });
    return child;
  }

  function onInterrupt(): void { stop("SIGINT", 0); }
  function onTerminate(): void { stop("SIGTERM", 0); }
  signals.on("SIGINT", onInterrupt);
  signals.on("SIGTERM", onTerminate);

  const launchWeb = () => launch("web", [fileURLToPath(new URL("../../node_modules/vite/bin/vite.js", import.meta.url)), "--config", "vite.dashboard.config.ts"]);
  if (mode === "web") {
    ready = true;
    launchWeb();
    return done;
  }
  const backend = launch("bff", ["--conditions=development", "--import", "tsx", fileURLToPath(new URL("./secure-env-bootstrap.ts", import.meta.url)), "cli", "dashboard"], true);
  progress = setInterval(() => {
    if (stopping || ready) return;
    writeError("[dashboard] still starting (preparing saved data)...\n");
  }, STARTUP_PROGRESS_MS);
  backend.on("message", (message: unknown) => {
    if (stopping || ready || message === null || typeof message !== "object"
      || !("type" in message) || message.type !== "hrauto-dashboard-ready") return;
    ready = true;
    stopProgress();
    if (mode === "dashboard") launchWeb();
    else {
      try {
        mkdirSync(dirname(frontendOwnerFile), { recursive: true });
        const temporary = `${frontendOwnerFile}.${process.pid}.tmp`;
        writeFileSync(temporary, launchNonce, { flag: "wx", mode: 0o600 });
        renameSync(temporary, frontendOwnerFile);
      } catch {
        writeError("[dashboard] frontend ownership handoff failed.\n");
        stop("SIGTERM", 1);
      }
    }
  });
  return done;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  process.exitCode = await runDevDashboard({ mode: process.argv.includes("--backend-only") ? "backend" : process.argv.includes("--web-only") ? "web" : "dashboard" });
}
