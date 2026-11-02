import { lstatSync, readdirSync } from "node:fs";
import { join, parse, relative, resolve } from "node:path";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import { privatePathRejects } from "../private-path.js";
import { outermostOperationProof } from "../configuration/credential-safe-file.js";
import { assertOfflineMaintenanceOperation, offlineMaintenanceWorkspace, type OfflineMaintenanceOperation } from "./lifetime-lock.js";

function fail(reason: string): never { throw new Error(`runtime-control: ${reason}`); }
function fixedLockRoot(workspace: string): string { return resolve(workspace, rebuildRuntimeIsolation.processLockRoot); }
function privateDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || privatePathRejects(path, stat, "directory-0700")) fail(`unsafe directory ${path}`);
}

export function lstatMaybe(path: string): ReturnType<typeof lstatSync> | undefined {
  try { return lstatSync(path); }
  catch (error) {
    if (typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT") return undefined;
    throw error;
  }
}

export function assertNoSymlinkComponents(path: string): void {
  const proof = outermostOperationProof();
  const existing = proof?.slots.get("symlink-free");
  const proven = existing instanceof Set ? existing as Set<string> : new Set<string>();
  if (proof !== undefined && existing !== proven) proof.slots.set("symlink-free", proven);
  if (proven.has(path)) return;
  let component = parse(path).root;
  const checked: string[] = [];
  for (const part of relative(component, path).split(/[\\/]/u)) {
    component = join(component, part);
    checked.push(component);
    if (proven.has(component)) continue;
    if (lstatMaybe(component)?.isSymbolicLink()) fail(`symlink in root path ${component}`);
  }
  for (const item of checked) proven.add(item);
}

export class OldBuildRuntimeArtifactsError extends Error {
  readonly code = "RUNTIME_OLD_BUILD_ARTIFACTS";
  constructor() { super(ERROR_CATALOG.RUNTIME_OLD_BUILD_ARTIFACTS.text); this.name = "OldBuildRuntimeArtifactsError"; }
}

export function assertNoOldBuildRuntimeArtifacts(workspace: string): void {
  const root = fixedLockRoot(workspace), info = lstatMaybe(root);
  if (info === undefined) return;
  assertNoSymlinkComponents(root);
  privateDirectory(root);
  if (readdirSync(root).length !== 0) throw new OldBuildRuntimeArtifactsError();
}

export function assertOfflineMaintenanceForProcessRoot(operation: OfflineMaintenanceOperation, processLockRoot: string): void {
  const workspace = offlineMaintenanceWorkspace(operation);
  if (processLockRoot !== fixedLockRoot(workspace)) fail("offline-maintenance-workspace-mismatch");
  assertOfflineMaintenanceOperation(operation, workspace);
  assertNoOldBuildRuntimeArtifacts(workspace);
}
