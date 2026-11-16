import { pathToFileURL } from "node:url";
import type { z } from "zod";
import { DashboardFailedSchema, DashboardStoppedSchema } from "../../src/models/runtime/dashboard-control.js";
import { ERROR_CATALOG, ErrorCatalogCodeSchema } from "../../src/models/failures/error-catalog.js";
import { StorageMaintenanceCustodyUnavailableError } from "../../src/backend/storage/maintenance/custody-availability.js";
import { hasUnprovedSourceClosure } from "../../src/backend/storage/source-closure.js";

const publicReasons = new Map([
  ["relay-microsoft-edge-not-found", "Microsoft Edge was not found in the Windows Program Files folders."],
  ["relay-program-files-root-invalid", "A Windows Program Files location is invalid."],
  ["relay-build-preparation-failed", "Relay could not prepare its build. Run npm run build:observer-policy and retain the error."],
  ["relay-backend-ipc-disconnected", "The backend control channel disconnected."],
  ["relay-backend-stopped-before-readiness", "The backend reported a stop before it was ready."],
  ["relay-backend-duplicate-stop-report", "The backend sent conflicting shutdown receipts."],
  ["relay-launcher-not-running", "No Relay launcher control file was found. Use the same LOCALAPPDATA as the running launcher."],
  ["relay-launcher-owner-gone", "The recorded Relay launcher is no longer running."],
  ["relay-launcher-control-changed", "The private launcher control file changed. Preserve the files."],
  ["relay-launcher-control-invalid", "The private launcher control file is invalid. Preserve the folder and report this error."],
  ["relay-launcher-control-unpublished", "Relay could not verify its published control file."],
  ["relay-launcher-listener-unproved", "Relay could not verify its local control listener."],
  ["relay-launcher-identity-unavailable", "Relay could not verify the launcher process identity."],
  ["relay-stop-closure-unproved", "Relay did not prove a clean backend stop. Keep the launcher console open and preserve its output."],
  ["relay-stop-response-unauthenticated", "The stop receipt could not be authenticated."],
  ["relay-window-not-ready", "The running Relay backend is not ready to open its window."],
  ["relay-invalid-command", "Usage: relay.cmd [start|stop]"],
  ["relay-launcher-publication-failed", "Relay could not publish its private control file without replacing an existing owner."],
]);

export class RelayPublicFailure extends Error {}

export function relayFailureReason(error: unknown): string {
  if (error instanceof RelayPublicFailure) return error.message;
  if (error instanceof Error) {
    if (error.message.startsWith("dashboard bundle refused:")) return "The dashboard bundle is missing or stale. Run npm run web:build.";
    if (error.message.startsWith("directory-integrity:") || error.message.startsWith("credential store launcher")) return "The private launcher directory or control file has unsafe permissions or changed identity. Preserve the folder.";
    const reason = publicReasons.get(error.message);
    if (reason !== undefined) return reason;
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    const catalog = ErrorCatalogCodeSchema.safeParse(error.code);
    if (catalog.success) return `${catalog.data}: ${ERROR_CATALOG[catalog.data].text}`;
    if (error.code === "EADDRINUSE") return "A required local port is already in use.";
    if (error.code === "ENOENT") return "A required executable or file was not found.";
    if (error.code === "EACCES" || error.code === "EPERM") return "Windows or the filesystem refused access to a required resource.";
    if (error.code === "EEXIST") return "Another launcher already published its control file. Try opening Relay again.";
    if (error.code === "ERR_IPC_CHANNEL_CLOSED" || error.code === "ERR_IPC_DISCONNECTED") return "The backend control channel closed before its reply could be delivered.";
    if (error.code === "ECONNREFUSED" || error.code === "ECONNRESET" || error.code === "ETIMEDOUT") return `${error.code}: a required connection failed; the requested operation did not complete.`;
  }
  return "Relay encountered an unexpected failure; preserve its state and report the failed step.";
}

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
  let result: z.infer<typeof DashboardStoppedSchema> | z.infer<typeof DashboardFailedSchema>;
  try {
    if (send === undefined) throw new RelayPublicFailure("The Relay backend must be started by relay.cmd.");
    result = await runRelayBackend();
  } catch (error) {
    result = DashboardFailedSchema.parse({ type: "relay-dashboard-failed", reason: relayFailureReason(error) });
    process.exitCode = 1;
  }
  if (send !== undefined && process.connected) {
    try { await new Promise<void>((resolve, reject) => { send(result, (error: Error | null) => { if (error) reject(error); else resolve(); }); }); }
    catch (error) { process.stderr.write(`${relayFailureReason(error)}\n`); process.exitCode = 1; }
  }
  if (process.connected) process.disconnect?.();
}
