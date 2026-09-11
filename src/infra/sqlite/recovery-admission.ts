import { lstatSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { UPGRADE_FLOOR_SCHEMA_VERSION } from "./migrations.js";

/** Inspection remains available below the floor; replacement and conversion do not. */
export function requireSupportedRecoverySchema(schemaVersion: number): void {
  if (schemaVersion < UPGRADE_FLOOR_SCHEMA_VERSION) throw new Error(`authority-below-floor { schemaVersion: ${String(schemaVersion)}, floor: ${String(UPGRADE_FLOOR_SCHEMA_VERSION)} }: restore and upgrade on the original compatible release, or start a fresh root (D321)`);
}

/** Reject aliases before a stopped operation can replace or convert an authority. */
export function requireDatabaseSourcePath(path: string): void {
  let current = resolve(path);
  let leaf = true;
  while (true) {
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || (!leaf && !stat.isDirectory())) throw new Error(`source-integrity { file: ${basename(path)} }`);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent; leaf = false;
  }
}
