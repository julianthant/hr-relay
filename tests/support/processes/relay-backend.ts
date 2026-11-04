import { existsSync, watch, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { startRebuildRuntime } from "../../../src/backend/app/composition/runtime-composition.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { runRelayBackend } from "../../../scripts/dev/relay-backend.js";
import { StorageMaintenanceCustodyUnavailableError } from "../../../src/backend/storage/maintenance/custody-availability.js";

const directory = process.argv[2];
if (directory === undefined) throw new Error("fixture-directory-required");
const release = join(directory, "release");
const mode = process.argv[3];
if (mode === "disconnected") {
  if (process.disconnect === undefined) throw new Error("fixture-disconnect-required");
  process.disconnect();
}
const result = await runRelayBackend(() => startRebuildRuntime({
  isolation: rebuildRuntimeIsolation, args: ["dashboard"], write: () => undefined,
  dashboard: async () => ({ port: 3938, stop: async () => {
    writeFileSync(join(directory, "draining"), "draining");
    await new Promise<void>(resolve => {
      const observer = watch(directory, () => { if (existsSync(release)) { observer.close(); resolve(); } });
      if (existsSync(release)) { observer.close(); resolve(); }
    });
    const file = await open(join(directory, "committed"), "wx", 0o600);
    try { await file.writeFile("drained and synced"); await file.sync(); }
    finally { await file.close(); }
    if (mode === "failed") throw new Error("fixture-stop-failed");
    if (mode === "backup-unavailable") throw new StorageMaintenanceCustodyUnavailableError("backup");
  } }),
}));
if (process.send === undefined) throw new Error("fixture-parent-required");
if (mode !== "silent") await new Promise<void>((resolve, reject) => { process.send?.(result, (error: Error | null) => { if (error) reject(error); else resolve(); }); });
if (process.disconnect === undefined) throw new Error("fixture-disconnect-required");
process.disconnect();
