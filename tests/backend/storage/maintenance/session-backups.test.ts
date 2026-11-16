import { chmodSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionBackups, SESSION_BACKUP_INTERVAL_MS } from "../../../../src/backend/storage/maintenance/session-backups.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

const MINUTE = 60_000;
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture() {
  const bound = await createBoundProfileFixture();
  const clock = manualClock(new Date("2026-11-16T09:00:00.000Z"));
  const database = AuthorityDatabase.open(bound.admission, { path: bound.path, busyTimeoutMs: 250, migrationOwner: "session-backups" },
    clock, undefined, undefined, undefined, boundProfileCredentials(bound.admission));
  const directory = join(bound.stateRoot, "backups", "authority");
  const sessionBackups = createSessionBackups({ admission: bound.admission, database, clock, directory });
  const events: unknown[] = [];
  sessionBackups.start({ emit: input => events.push(input) });
  cleanups.push(async () => { sessionBackups.requestCancellation(); await sessionBackups.awaitCancellation(); chmodSync(directory, 0o700); database.close(); await bound.close(); });
  let occurrence = 0;
  const commitChange = () => {
    const at = clock.now().toISOString();
    database.withAuthorityTransaction(repositories => repositories.notificationHealth.put({ concern: "disk-space", active: true, occurrence: ++occurrence, samples: [], observedAt: at, createdAt: at }));
  };
  const otherBackup = (purpose: "clean-shutdown" | undefined) => new AuthorityBackupService(bound.admission, database, { directory, ...(purpose === undefined ? {} : { purpose }) }, clock)
    .request({ trigger: "operator", requiredGeneration: database.getMeta().authorityGeneration });
  const names = (suffix: string) => readdirSync(directory).filter(name => name.endsWith(suffix)).sort();
  return { bound, clock, database, directory, sessionBackups, events, commitChange, otherBackup, names };
}

describe("hourly in-session backup", () => {
  it("takes a backup only when the store changed and the newest backup is over an hour old", async () => {
    const f = await fixture();
    await expect(f.sessionBackups.check()).resolves.toBe("taken");
    f.clock.advanceWall(SESSION_BACKUP_INTERVAL_MS);
    f.commitChange();
    await expect(f.sessionBackups.check()).resolves.toBe("recent");
    f.clock.advanceWall(1);
    await expect(f.sessionBackups.check()).resolves.toBe("taken");
    f.clock.advanceWall(SESSION_BACKUP_INTERVAL_MS + 1);
    await expect(f.sessionBackups.check()).resolves.toBe("unchanged");
    expect(f.names(".session.sqlite.manifest.json")).toHaveLength(1);
  });

  it("keeps the previous in-session backup until the new one verified and leaves other kinds alone", async () => {
    const f = await fixture();
    await f.otherBackup(undefined); await f.otherBackup("clean-shutdown");
    const others = [...f.names(".shutdown.sqlite"), ...f.names(".shutdown.sqlite.manifest.json")];
    const plain = readdirSync(f.directory).filter(name => !name.includes(".shutdown")).sort();
    f.clock.advanceWall(SESSION_BACKUP_INTERVAL_MS + 1); f.commitChange();
    await expect(f.sessionBackups.check()).resolves.toBe("taken");
    const first = f.names(".session.sqlite.manifest.json");
    expect(first).toHaveLength(1);
    f.clock.advanceWall(SESSION_BACKUP_INTERVAL_MS + 1); f.commitChange();
    chmodSync(f.directory, 0o500);
    await expect(f.sessionBackups.check()).resolves.toBe("failed");
    chmodSync(f.directory, 0o700);
    expect(f.names(".session.sqlite.manifest.json")).toEqual(first);
    f.clock.advanceMonotonic(5 * MINUTE);
    await expect(f.sessionBackups.check()).resolves.toBe("taken");
    const second = f.names(".session.sqlite.manifest.json");
    expect(second).toHaveLength(1);
    expect(second).not.toEqual(first);
    expect(f.names(".session.sqlite")).toEqual(second.map(name => name.slice(0, -".manifest.json".length)));
    expect([...f.names(".shutdown.sqlite"), ...f.names(".shutdown.sqlite.manifest.json")]).toEqual(others);
    expect(readdirSync(f.directory).filter(name => !name.includes(".shutdown") && !name.includes(".session")).sort()).toEqual(plain);
  });

  it("reports a failed backup once and does not retry within five minutes", async () => {
    const f = await fixture();
    await expect(f.sessionBackups.check()).resolves.toBe("taken");
    const previous = f.names(".session.sqlite.manifest.json");
    f.clock.advanceWall(SESSION_BACKUP_INTERVAL_MS + 1); f.commitChange();
    chmodSync(f.directory, 0o500);
    await expect(f.sessionBackups.check()).resolves.toBe("failed");
    f.clock.advanceMonotonic(5 * MINUTE - 1);
    await expect(f.sessionBackups.check()).resolves.toBe("failed");
    chmodSync(f.directory, 0o700);
    expect(f.events).toHaveLength(1);
    expect(f.events[0]).toMatchObject({ category: "worker", phase: "failed", area: "session-backup", reason: "session-backup-failed" });
    expect(f.names(".session.sqlite.manifest.json")).toEqual(previous);
    f.clock.advanceMonotonic(1);
    await expect(f.sessionBackups.check()).resolves.toBe("taken");
  });

  it("stops without leftovers when cancelled during a backup", async () => {
    const f = await fixture();
    const running = f.sessionBackups.check();
    expect(f.sessionBackups.hasUnquiescedWork()).toBe(true);
    f.sessionBackups.requestCancellation();
    await f.sessionBackups.awaitCancellation();
    await expect(running).resolves.toBe("stopped");
    expect(f.sessionBackups.hasUnquiescedWork()).toBe(false);
    expect(readdirSync(f.directory).filter(name => name.startsWith(".") || name.includes(".session"))).toEqual([]);
    expect(f.events).toEqual([]);
    await expect(f.sessionBackups.check()).resolves.toBe("stopped");
  });
});
