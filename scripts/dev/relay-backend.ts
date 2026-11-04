import { pathToFileURL } from "node:url";
import type { z } from "zod";
import { DashboardStoppedSchema } from "../../src/models/runtime/dashboard-control.js";
import { StorageMaintenanceCustodyUnavailableError } from "../../src/backend/storage/maintenance/custody-availability.js";
import { hasUnprovedSourceClosure } from "../../src/backend/storage/source-closure.js";

export async function runRelayBackend(run: () => Promise<void> = async () => {
  const { runSecureEnvironmentEntrypoint } = await import("./secure-env-bootstrap.js");
  await runSecureEnvironmentEntrypoint(["cli", "dashboard", "--prod"]);
}): Promise<z.infer<typeof DashboardStoppedSchema>> {
  try {
    await run();
    return DashboardStoppedSchema.parse({ type: "relay-dashboard-stopped", state: "clean" });
  } catch (error) {
    if (!(error instanceof StorageMaintenanceCustodyUnavailableError)
      || error.constructor !== StorageMaintenanceCustodyUnavailableError || error.operation !== "backup"
      || error.cause !== undefined || hasUnprovedSourceClosure(error)) throw error;
    return DashboardStoppedSchema.parse({ type: "relay-dashboard-stopped", state: "backup-unavailable" });
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  const send = process.send?.bind(process);
  if (send === undefined) throw new Error("relay-backend-parent-ipc-required");
  const result = await runRelayBackend();
  await new Promise<void>((resolve, reject) => { send(result, (error: Error | null) => { if (error) reject(error); else resolve(); }); });
  if (process.disconnect === undefined) throw new Error("relay-backend-ipc-disconnect-unavailable");
  process.disconnect();
}
