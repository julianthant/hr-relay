import { lstatSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "./migrations.js";

export function requireSupportedRecoverySchema(schemaVersion: number): void {
  if (schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) throw new Error(`authority-schema-mismatch { schemaVersion: ${schemaVersion}, supported: ${CURRENT_AUTHORITY_SCHEMA_VERSION} }`);
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
