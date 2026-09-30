/** `npm run dashboard` owns the BFF and Vite dev server, including their shutdown. */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DASHBOARD_LAUNCH_NONCE_ENV,
  DashboardLaunchNonceSchema,
} from "../src/server/dashboard/frontend-owner.js";

const launchNonce = DashboardLaunchNonceSchema.parse(randomBytes(32).toString("hex"));
const childEnvironment = { ...process.env, [DASHBOARD_LAUNCH_NONCE_ENV]: launchNonce };
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

interface Managed {
  readonly name: string;
  readonly child: ChildProcess;
  closed: boolean;
}

export interface DashboardLauncherOptions {
  readonly startupTimeoutMs?: number;
  readonly signals?: EventEmitter;
  readonly writeError?: (message: string) => void;
}

export function runDevDashboard(options: DashboardLauncherOptions = {}): Promise<number> {
  const signals = options.signals ?? process;
  const writeError = options.writeError ?? ((message: string) => { process.stderr.write(message); });
  const managed: Managed[] = [];
  let stopping = false;
  let result = 0;
  let ready = false;
  let finish: (code: number) => void = () => undefined;
  const done = new Promise<number>(resolve => { finish = resolve; });

  function completeIfClosed(): void {
    if (!stopping || !managed.every(item => item.closed)) return;
    signals.removeListener("SIGINT", onInterrupt);
    signals.removeListener("SIGTERM", onTerminate);
    finish(result);
  }

  function stop(signal: NodeJS.Signals, code: number): void {
    if (stopping) return;
    stopping = true;
    result = code;
    clearTimeout(startupTimer);
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
      } else if (code !== null && code !== 0 && result === 0) result = code;
    });
    child.on("close", () => { item.closed = true; completeIfClosed(); });
    return child;
  }

  function onInterrupt(): void { stop("SIGINT", 0); }
  function onTerminate(): void { stop("SIGTERM", 0); }
  signals.on("SIGINT", onInterrupt);
  signals.on("SIGTERM", onTerminate);
  const startupTimer = setTimeout(() => {
    writeError("[dashboard] BFF readiness timed out; stopping the backend.\n");
    stop("SIGTERM", 1);
  }, options.startupTimeoutMs ?? 30_000);

  const backend = launch("bff", ["--import", "tsx", fileURLToPath(new URL("./secure-env-bootstrap.ts", import.meta.url)), "cli", "dashboard"], true);
  backend.on("message", (message: unknown) => {
    if (stopping || ready || message === null || typeof message !== "object"
      || !("type" in message) || message.type !== "hrauto-dashboard-ready") return;
    ready = true;
    clearTimeout(startupTimer);
    launch("web", [fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url)), "--config", "vite.dashboard.config.ts"]);
  });
  return done;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  process.exitCode = await runDevDashboard();
}
