/**
 * `npm run dashboard` — the whole dev dashboard in ONE terminal.
 *
 * The dashboard is two processes: the BFF (`cli dashboard`, port 3938, serves
 * `/api/v1/*` and the SSE day stream) and the vite dev server (`web`, port
 * 5174, serves the bundle and proxies `/api` to the BFF). Run only the second
 * and every page load logs `http proxy error: /api/v1/bootstrap … ECONNREFUSED
 * 127.0.0.1:3938` — which is not a defect anywhere, just the BFF not being up.
 * This launcher starts both through their own declared scripts (so the command
 * each runs is still the ONE string `config/runtime-isolation.json` pins and
 * the operational-isolation guard audits), and ties their lifetimes together:
 *
 *  - Ctrl+C (SIGINT) or SIGTERM stops both and waits for both to exit.
 *  - If either exits on its own — the BFF refusing because another holder owns
 *    the D181 server lock, a vite crash — the other is stopped and this process
 *    exits with that code, so the failure is the thing on screen rather than a
 *    half-running dashboard that looks alive.
 *
 * Output is inherited verbatim (no prefixing) so vite keeps its own TTY
 * rendering; the BFF prints one `listening` line and then structured logs.
 * The BFF alone is still `npm run cli -- dashboard`; vite alone is `npm run web`.
 */
import { spawn, type ChildProcess } from "node:child_process";

const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

interface Managed {
  readonly name: string;
  readonly child: ChildProcess;
}

const managed: Managed[] = [];
let stopping = false;

function stopOthers(except: ChildProcess, signal: NodeJS.Signals): void {
  for (const { child } of managed) {
    if (child !== except && child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

function launch(name: string, args: readonly string[]): void {
  const child = spawn(NPM, args, { stdio: "inherit" });
  managed.push({ name, child });
  child.on("error", (error) => {
    process.stderr.write(`[dashboard] could not start ${name}: ${error.message}\n`);
    stopping = true;
    stopOthers(child, "SIGTERM");
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (!stopping) {
      stopping = true;
      const how = signal === null ? `exit code ${String(code)}` : `signal ${signal}`;
      process.stderr.write(`\n[dashboard] ${name} stopped (${how}); stopping the rest.\n`);
      process.exitCode = code ?? 1;
      stopOthers(child, "SIGTERM");
    }
    if (managed.every(({ child: c }) => c.exitCode !== null || c.signalCode !== null)) {
      process.exit(process.exitCode ?? 0);
    }
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    // A terminal Ctrl+C already reaches the children through the process
    // group; forwarding is for the case where only this process was signalled.
    stopping = true;
    for (const { child } of managed) {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    }
  });
}

launch("bff", ["run", "cli", "--", "dashboard"]);
launch("web", ["run", "web"]);
