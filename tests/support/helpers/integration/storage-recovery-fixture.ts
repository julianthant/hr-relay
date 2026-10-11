import { mkdtempSync, mkdirSync, rmSync, readFileSync, readdirSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createHash } from "node:crypto";
import { SQLITE_MIGRATIONS, AUTHORITY_APPLICATION_ID } from "../../../../src/backend/storage/sqlite/migrations.js";
import { backupStoppedAuthority, upgradeStorage } from "../synthetic-storage-admission.js";

export function storageRecoveryFixture(version = 0) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "supported-recovery-"));
  const path = join(root, "state.db");
  const clock = manualClock(new Date("2026-09-10T20:00:00Z"));
  if (version > 0) {
    const database = new DatabaseSync(path);
    try {
      for (const migration of SQLITE_MIGRATIONS.filter(row => row.version <= version)) for (const statement of migration.statements) database.exec(statement);
      database.prepare(`INSERT INTO ${"database_states"}(id,schema_version,authority_generation,updated_at,search_generation,search_state) VALUES (1,?,7,?,NULL,'unbuilt')`).run(version, clock.now().toISOString());
      database.exec(`PRAGMA user_version=${String(version)}; PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}`);
    } finally { database.close(); }
  }
  const input = { stateRoot: root, processLockRoot: join(root, "locks"), environmentFile: join(root, ".env"), plan: false };
  return { root, path, clock, input, backup: () => backupStoppedAuthority(root, clock, input.processLockRoot),
    run: (plan = false) => upgradeStorage({ ...input, plan }, clock),
    dispose: () => rmSync(root, { recursive: true, force: true }) };
}
/** Exact retained file bytes; do not follow deliberately hostile aliases. */
export function storageTree(root: string): Record<string, string> {
  const rows: Record<string, string> = {};
  const visit = (path: string, prefix: string) => {
    for (const name of readdirSync(path).sort()) {
      const child = join(path, name), key = `${prefix}${name}`, stat = lstatSync(child);
      if (stat.isSymbolicLink()) rows[key] = `symlink:${readlinkSync(child)}`;
      else if (stat.isDirectory()) visit(child, `${key}/`);
      else rows[key] = createHash("sha256").update(readFileSync(child)).digest("hex");
    }
  };
  visit(root, ""); return rows;
}
export function credentialTrap(root: string): void {
  mkdirSync(join(root, "credentials"), { recursive: true });
  // Unsupported authority refuses before independent credentials.
  mkdirSync(join(root, "credentials", "protected.json"));
}
