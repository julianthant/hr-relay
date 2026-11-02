import { assertOfflineMaintenanceOperation, type OfflineMaintenanceOperation, RuntimeLifetimeLock } from "../admission/lifetime-lock.js";
import { acquireInstallation, inspectFlatOfflineRunMaintenance, type InstallationLease } from "../admission/installation.js";
import { assertNoOldBuildRuntimeArtifacts } from "../admission/process-root.js";
import type { ProfileBrowserClosure } from "./profile-inventory.js";
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { AuthorityDatabase } from "../sqlite/authority-database.js";
import { readPrivateFile } from "../configuration/credential-safe-file.js";
import { proveProfileRootsUnused } from "./process-closure.js";
import { hasUnprovedSourceClosure, retainAuthoritySourceClosure } from "../source-closure.js";
import { systemClock, type Clock } from "../../../rules/time/clock.js";

export function parseQueuedRunCancellation(args: readonly string[]) {
  const fields = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === undefined || fields.has(key)) throw new Error("queued-run-cancellation-usage");
    if (["--plan", "--apply", "--json"].includes(key)) fields.set(key, "true");
    else if (key === "--capture") fields.set(key, z.string().regex(/^[0-9a-f]{64}$/u).parse(args[++index]));
    else throw new Error("queued-run-cancellation-usage");
  }
  if (fields.has("--plan") === fields.has("--apply") || fields.has("--capture") !== fields.has("--apply")) throw new Error("queued-run-cancellation-usage");
  return { apply: fields.has("--apply"), captureDigest: fields.get("--capture"), json: fields.has("--json") };
}

async function capture(workspace: string, operation: OfflineMaintenanceOperation) {
  assertOfflineMaintenanceOperation(operation, workspace);
  assertNoOldBuildRuntimeArtifacts(workspace);
  const installation = inspectFlatOfflineRunMaintenance(workspace);
  proveProfileRootsUnused([...installation.roots.slice(0, 2).map(root => root.path), join(workspace, "data")]);
  const path = join(installation.roots[0]?.path ?? "", "state.db");
  const files = ["", "-wal", "-shm", "-journal"].map(suffix => {
    const filePath = `${path}${suffix}`;
    const file = readPrivateFile(filePath, { label: "authority database", maxBytes: 512 * 1024 * 1024 });
    if (file === undefined) {
      if (suffix === "") throw new Error("queued-run-cancellation-source-missing");
      return { path: filePath, absent: true };
    }
    return { path: filePath, ...file.identity, digest: createHash("sha256").update(file.bytes).digest("hex") };
  });
  const inventory = await AuthorityDatabase.readFlatQueuedRunCancellation(path);
  const witnesses = [...installation.witnesses, ...files];
  const metadata = witnesses.map(file => {
    const stat = lstatSync(file.path, { throwIfNoEntry: false });
    return stat === undefined ? { path: file.path, absent: true } : { path: file.path, device: stat.dev, inode: stat.ino,
      mode: stat.mode, owner: stat.uid, links: stat.nlink, size: stat.size, modified: stat.mtimeMs, changed: stat.ctimeMs };
  });
  const body = { installation, files, metadata, inventoryDigest: inventory.digest };
  return { installation, inventory, captureDigest: createHash("sha256").update(canonicalJsonStringify(body)).digest("hex") };
}

export async function runOfflineQueuedRunCancellation(browserClosure: ProfileBrowserClosure, workspacePath: string, args: readonly string[], lifetime: RuntimeLifetimeLock, clock: Clock = systemClock) {
  if (!(lifetime instanceof RuntimeLifetimeLock)) throw new Error("runtime-lifetime-required");
  lifetime.assertHeld();
  const command = parseQueuedRunCancellation(args), workspace = realpathSync(workspacePath);
  if (workspace !== resolve(workspacePath)) throw new Error("queued-run-cancellation-workspace-unsafe");
  lifetime.assertExclusiveWorkspaceTarget(workspace);
  const restore = lifetime.beginOfflineMaintenance(workspace);
  restore.consume();
  let planned: Awaited<ReturnType<typeof capture>>;
  try { planned = await capture(workspace, restore); }
  catch (error) {
    if (hasUnprovedSourceClosure(error)) throw retainAuthoritySourceClosure([error], { restore });
    try { restore.release(); } catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { restore }); }
    throw error;
  }
  const runIds = planned.inventory.candidates.map(run => run.envelope.runId);
  if (!command.apply) { restore.release(); return { json: command.json, report: { state: "planned", captureDigest: planned.captureDigest, runIds } }; }
  if (planned.captureDigest !== command.captureDigest) { restore.release(); throw new Error("queued-run-cancellation-capture-changed"); }
  let lease: InstallationLease | undefined;
  const release = () => {
    try { restore.release(); lease?.release(); }
    catch (error) { throw retainAuthoritySourceClosure([error], { admission: lease, restore }); }
  };

  try {
    lease = acquireInstallation(workspace, "exclusive", lifetime, { offlineOperation: restore });
    proveProfileRootsUnused([...planned.installation.roots.slice(0, 2).map(root => root.path), join(workspace, "data")]);
    if ((await capture(workspace, restore)).captureDigest !== planned.captureDigest) throw new Error("queued-run-cancellation-capture-changed");
    await AuthorityDatabase.cancelQueuedRunsNative6(browserClosure, lease, restore, planned.inventory.digest, clock);
  } catch (error) {
    if (hasUnprovedSourceClosure(error)) throw retainAuthoritySourceClosure([error], { admission: lease, restore });
    try { release(); } catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { admission: lease, restore }); }
    throw error;
  }
  release();
  return { json: command.json, report: { state: "cancelled", captureDigest: planned.captureDigest, runIds } };
}
