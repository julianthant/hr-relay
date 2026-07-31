import type { RuntimeIsolation } from "../config/define-runtime-isolation.js";

export interface RebuildRuntimeStart {
  readonly isolation: RuntimeIsolation;
  readonly args?: readonly string[];
  readonly write?: (message: string) => void;
}

export function runtimeHelp(isolation: RuntimeIsolation): string {
  return [
    "HR Automation rebuild foundation (Phase 1b)",
    "Commands:",
    "  help     show this contract surface",
    "  phase    print the active isolated runtime resources",
    `Dashboard/server execution is deferred to its owning 1g-spine slice (reserved port ${String(isolation.backendPort)}).`,
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
      phase: "1b",
      stateRoot: input.isolation.stateRoot,
      artifactRoot: input.isolation.artifactRoot,
      backendPort: input.isolation.backendPort,
      frontendPort: input.isolation.frontendPort,
      browserSessionNamespace: input.isolation.browserSessionNamespace,
    }));
    return;
  }
  if (command === "dashboard") {
    throw new Error("rebuild dashboard execution is unavailable until the owning 1g-spine BFF slice lands");
  }
  throw new Error(`unknown rebuild command: ${command}`);
}
