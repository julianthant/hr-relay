import { randomUUID } from "node:crypto";
import { freemem } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertBundleCurrent } from "./bundle-manifest.js";
import { collectDiagnostics, defaultDiagnosticName } from "./diagnostics.js";

export async function runBundleCommand(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  const root = resolve(import.meta.dirname, "../..");
  try {
    const command = args[0] ?? "start";
    const profile = args.length === 2 && args[1] === "--cpu-profile";
    if (!["start", "stop", "diagnose"].includes(command) || args.length > 1 && !(command === "start" && profile)) throw new Error("relay-bundle-usage");
    const manifest = assertBundleCurrent(root);
    if (process.platform !== "win32" || process.arch !== "x64" || process.version !== manifest.node) throw new Error("relay-bundle-runtime-mismatch");
    process.env.PLAYWRIGHT_BROWSERS_PATH = join(root, "tools/browsers");
    const { applicationDataWorkspace } = await import("../../src/backend/app/config/runtime-isolation.js");
    const workspace = applicationDataWorkspace();
    if (command === "diagnose") {
      const output = await collectDiagnostics({ appRoot: root, workspace, output: defaultDiagnosticName(workspace) });
      process.stdout.write(`Diagnostics saved: ${output}\n`);
      return 0;
    }
    if (command === "start" && freemem() < 4 * 1024 ** 3) throw new Error("relay-bundle-memory-below-4gib");
    const { runRelayCommand } = await import("../dev/relay.js");
    const backendArguments = ["--import", "tsx", join(root, "scripts/dev/relay-backend.ts")];
    if (profile) {
      const { createPrivateDirectory } = await import("../../src/backend/storage/private-path.js");
      const directory = join(workspace, "diagnostics/cpu");
      createPrivateDirectory(directory, { recursive: true, mode: 0o700 });
      backendArguments.unshift("--cpu-prof", `--cpu-prof-dir=${directory}`, `--cpu-prof-name=relay-${randomUUID()}.cpuprofile`);
    }
    return await runRelayCommand([command], { prepare: async () => { assertBundleCurrent(root); }, backendArguments });
  } catch {
    process.stderr.write("Relay bundle refused. Use relay.cmd [start [--cpu-profile]|stop|diagnose]. Keep at least 4 GiB free memory. Re-extract the original zip into a short path if files changed. Source checkout development: node --import tsx scripts/dev/relay.ts.\n");
    return 1;
  }
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = await runBundleCommand();
