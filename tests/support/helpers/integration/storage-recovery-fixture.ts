import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createBoundProfileFixture } from "../admission-fixture.js";
import { mkdirSync, readFileSync, readdirSync, lstatSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createHash } from "node:crypto";
import { SQLITE_MIGRATIONS, AUTHORITY_APPLICATION_ID } from "../../../../src/backend/storage/sqlite/migrations.js";
import { backupStoppedAuthority, upgradeStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";

export async function storageRecoveryFixture(version = 0) {
  const fixture = await createBoundProfileFixture({ pending: "storage" });
  const root = fixture.stateRoot, path = fixture.path;
  const clock = manualClock(new Date("2026-09-10T20:00:00Z"));
  if (version > 0) {
    const database = new DatabaseSync(path);
    try {
      for (const migration of SQLITE_MIGRATIONS.filter(row => row.version <= Math.min(version, 7))) for (const statement of migration.statements) database.exec(statement);
      if (version >= 7) database.prepare("INSERT INTO database_states(id,schema_version,authority_generation,updated_at,search_generation,search_state,installation_id,profile_id) VALUES(1,?,7,?,NULL,'unbuilt',?,?)")
        .run(version, clock.now().toISOString(), fixture.admission.profileBinding.installationId, fixture.admission.profileBinding.profileId);
      else database.prepare("INSERT INTO database_states(id,schema_version,authority_generation,updated_at,search_generation,search_state) VALUES(1,?,7,?,NULL,'unbuilt')").run(version, clock.now().toISOString());
      database.exec(`PRAGMA user_version=${String(version)}; PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}`);
    } finally { database.close(); }
  }
  const input = { stateRoot: root, processLockRoot: join(fixture.workspace, rebuildRuntimeIsolation.processLockRoot), environmentFile: join(root, ".env"), plan: false };
  return { root, path, clock, input, get admission() { return fixture.admission; },
    backup: () => backupStoppedAuthority(fixture.admission, root, clock, input.processLockRoot),
    run: (plan = false) => upgradeStorage(fixture.admission, { ...input, plan }, clock),
    dispose: async () => await fixture.close() };
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
