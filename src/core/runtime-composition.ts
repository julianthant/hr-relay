/**
 * The rebuild CLI's command surface. The `dashboard` command is real as of
 * 1g-spine: it starts the in-process typed BFF (projection + SSE + command
 * route) through the injected `dashboard` seam.
 *
 * The seam exists because of the layer matrix, not taste: the composition
 * that imports workflow modules and the server tree sits ABOVE `core`
 * (`src/server/dashboard/compose.ts`, the same move `workflow-registry.ts`
 * documents), so `src/cli.ts` — outside the layer map — hands it in. A
 * `dashboard` invocation without the seam fails loud; it never pretends a
 * server started.
 */
import type { RuntimeIsolation } from "../config/define-runtime-isolation.js";

export interface RunningDashboard {
  readonly port: number;
  stop(): Promise<void>;
}

export interface RebuildRuntimeStart {
  readonly isolation: RuntimeIsolation;
  readonly args?: readonly string[];
  readonly write?: (message: string) => void;
  /** The 1g-spine BFF composition (`composeDashboardRuntime`), injected from the CLI. */
  readonly dashboard?: (isolation: RuntimeIsolation) => Promise<RunningDashboard>;
}

export function runtimeHelp(isolation: RuntimeIsolation): string {
  return [
    "HR Automation rebuild foundation (completed through 1e; active 1f)",
    "Commands:",
    "  help       show this contract surface",
    "  phase      print the active isolated runtime resources",
    `  dashboard  start the in-process typed dashboard BFF (1g-spine, port ${String(isolation.backendPort)})`,
  ].join("\n");
}

export function startRebuildRuntime(input: RebuildRuntimeStart): void {
  const args = input.args ?? process.argv.slice(2);
  const write = input.write ?? ((message: string): void => {
    process.stdout.write(`${message}\n`);
  });
  const command = args[0] ?? "help";
  if (command === "help" || command === "--help" || command === "-h") {
    write(runtimeHelp(input.isolation));
    return;
  }
  if (command === "phase") {
    write(JSON.stringify({
      completedThrough: "1e",
      active: "1f",
      stateRoot: input.isolation.stateRoot,
      artifactRoot: input.isolation.artifactRoot,
      backendPort: input.isolation.backendPort,
      frontendPort: input.isolation.frontendPort,
      browserSessionNamespace: input.isolation.browserSessionNamespace,
    }));
    return;
  }
  if (command === "dashboard") {
    const compose = input.dashboard;
    if (compose === undefined) {
      throw new Error(
        "the dashboard command needs its composition seam; start it through src/cli.ts, which injects composeDashboardRuntime",
      );
    }
    compose(input.isolation)
      .then((running) => {
        write(`dashboard BFF listening on 127.0.0.1:${String(running.port)}`);
      })
      .catch((error: unknown) => {
        // Re-throwing out of the promise chain crashes the process loudly —
        // a dashboard that failed to bind must never look started.
        throw error instanceof Error ? error : new Error(String(error));
      });
    return;
  }
  throw new Error(`unknown rebuild command: ${command}`);
}
