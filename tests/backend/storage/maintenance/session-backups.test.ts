import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionBackups, SESSION_BACKUP_INTERVAL_MS } from "../../../../src/backend/storage/maintenance/session-backups.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthoritySourceClosureUnprovedError, hasUnprovedSourceClosure } from "../../../../src/backend/storage/source-closure.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

// Fails the close of the next descriptor opened on a temporary backup copy, after the descriptor really closed.
const closeFault = vi.hoisted(() => ({ armed: undefined as (() => void) | undefined, descriptors: new Set<number>() }));
// Runs once right after the next listing of the given directory returns.
const afterListing = vi.hoisted(() => ({ directory: undefined as string | undefined, run: undefined as (() => void) | undefined }));
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const openSync = ((path: Parameters<typeof actual.openSync>[0], ...rest: unknown[]) => {
    const descriptor = (actual.openSync as (...args: unknown[]) => number)(path, ...rest);
    if (closeFault.armed !== undefined && String(path).endsWith(".sqlite.tmp")) closeFault.descriptors.add(descriptor);
    return descriptor;
  }) as typeof actual.openSync;
  const closeSync = ((descriptor: number) => {
    actual.closeSync(descriptor);
    const onFault = closeFault.armed;
    if (onFault === undefined || !closeFault.descriptors.delete(descriptor)) return;
    closeFault.armed = undefined;
    onFault();
    throw Object.assign(new Error("injected close failure"), { code: "EIO" });
  }) as typeof actual.closeSync;
  const readdirSync = ((path: Parameters<typeof actual.readdirSync>[0], ...rest: unknown[]) => {
    const listed = (actual.readdirSync as (...args: unknown[]) => unknown)(path, ...rest);
    const run = afterListing.run;
    if (run !== undefined && String(path) === afterListing.directory) { afterListing.run = undefined; run(); }
    return listed;
  }) as typeof actual.readdirSync;
  return { ...actual, default: { ...actual, openSync, closeSync, readdirSync }, openSync, closeSync, readdirSync };
});

const MINUTE = 60_000;
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { closeFault.armed = undefined; afterListing.run = undefined; closeFault.descriptors.clear(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture() {
  const bound = await createBoundProfileFixture();
  const clock = manualClock(new Date("2026-11-16T09:00:00.000Z"));
  const database = AuthorityDatabase.open(bound.admission, { path: bound.path, busyTimeoutMs: 250, migrationOwner: "session-backups" },
    clock, undefined, undefined, undefined, boundProfileCredentials(bound.admission));
  const directory = join(bound.stateRoot, "backups", "authority");
  const sessionBackups = createSessionBackups({ admission: bound.admission, database, clock, directory });
  const events: unknown[] = [];
  sessionBackups.start({ emit: input => events.push(input) });
  cleanups.push(async () => {
    vi.restoreAllMocks(); sessionBackups.requestCancellation();
    // A retained unproved closure legitimately fails the drain and makes the profile refuse release; anything else fails the test after closing.
    let drainFailure: { error: unknown } | undefined;
    await sessionBackups.awaitCancellation().catch((error: unknown) => { if (!hasUnprovedSourceClosure(error)) drainFailure = { error }; });
    if (existsSync(directory)) chmodSync(directory, 0o700);
    try { database.close(); await bound.close(); } catch (error) { if (!hasUnprovedSourceClosure(error)) throw error; }
    if (drainFailure !== undefined) throw drainFailure.error;
  });
  let occurrence = 0;
  const commitChange = () => {
    const at = clock.now().toISOString();
    database.withAuthorityTransaction(repositories => repositories.notificationHealth.put({ concern: "disk-space", active: true, occurrence: ++occurrence, samples: [], observedAt: at, createdAt: at }));
  };
  const otherBackup = (purpose: "clean-shutdown" | undefined) => new AuthorityBackupService(bound.admission, database, { directory, ...(purpose === undefined ? {} : { purpose }) }, clock)
    .request({ trigger: "schema-migration", requiredGeneration: database.getMeta().authorityGeneration });
  const names = (suffix: string) => readdirSync(directory).filter(name => name.endsWith(suffix)).sort();
  const sessionBackup = () => new AuthorityBackupService(bound.admission, database, { directory, purpose: "in-session" }, clock)
    .request({ trigger: "interval", requiredGeneration: database.getMeta().authorityGeneration });
  const damage = (fileName: string) => { const path = join(directory, fileName), bytes = readFileSync(path); bytes[bytes.length - 1] ^= 1; writeFileSync(path, bytes); };
  return { bound, clock, database, directory, sessionBackups, events, commitChange, otherBackup, sessionBackup, damage, names };
}

describe("hourly in-session backup", () => {
  it.each(["missing", "damaged"] as const)("replaces a session backup whose log companion is %s", async damage => {
    const f = await fixture();
    await expect(f.sessionBackups.check()).resolves.toBe("taken");
    const previous = f.names(".session.sqlite")[0];
    const companion = `${previous}.timeline.db`;
    if (damage === "missing") rmSync(join(f.directory, companion));
    else f.damage(companion);
    await expect(f.sessionBackups.check()).resolves.toBe("taken");
    const [replacement] = f.names(".session.sqlite");
    expect(replacement).not.toBe(previous);
    expect(f.names(".session.sqlite.timeline.db")).toEqual([`${replacement}.timeline.db`]);
    expect(f.names(".session.sqlite.dashboard.db")).toEqual([`${replacement}.dashboard.db`]);
  });

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
    for (const log of ["timeline", "dashboard"]) {
      expect(f.names(`.session.sqlite.${log}.db`)).toEqual(second.map(name => name.replace(/\.manifest\.json$/u, `.${log}.db`)));
    }
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

  describe("unproved source closure", () => {
    const failure = () => new AuthoritySourceClosureUnprovedError([new Error("injected descriptor close failure")]);
    it("stops for good, keeps work unquiesced and fails the drain", async () => {
      const f = await fixture();
      const request = vi.spyOn(AuthorityBackupService.prototype, "request").mockRejectedValue(failure());
      await expect(f.sessionBackups.check()).resolves.toBe("failed");
      expect(f.sessionBackups.hasUnquiescedWork()).toBe(true);
      await expect(f.sessionBackups.awaitCancellation()).rejects.toBeInstanceOf(AuthoritySourceClosureUnprovedError);
      await expect(f.sessionBackups.check()).resolves.toBe("failed");
      expect(request).toHaveBeenCalledTimes(1);
    });
    it("is not hidden by a cancellation that raced the failure", async () => {
      const f = await fixture();
      let fail!: () => void;
      const requested = new Promise<void>(resolve => {
        vi.spyOn(AuthorityBackupService.prototype, "request").mockImplementation(() => new Promise((_, reject) => { fail = () => reject(failure()); resolve(); }));
      });
      const running = f.sessionBackups.check();
      await requested;
      f.sessionBackups.requestCancellation();
      fail();
      await expect(running).resolves.toBe("failed");
      expect(f.sessionBackups.hasUnquiescedWork()).toBe(true);
      await expect(f.sessionBackups.awaitCancellation()).rejects.toBeInstanceOf(AuthoritySourceClosureUnprovedError);
    });
    it("keeps the copy it could not prove closed when a cancellation races the failure", async () => {
      const f = await fixture();
      closeFault.armed = () => f.sessionBackups.requestCancellation();
      await expect(f.sessionBackups.check()).resolves.toBe("failed");
      // The drain settles on the same thread-idle promise after the take's disposal callback already ran.
      await expect(f.sessionBackups.awaitCancellation()).rejects.toBeInstanceOf(AuthoritySourceClosureUnprovedError);
      expect(readdirSync(f.directory).filter(name => name.endsWith(".sqlite.tmp"))).toHaveLength(1);
    });
  });

  describe("newest verified backup", () => {
    it.each(["deleted", "altered"] as const)("ignores a manifest whose backup bytes are %s", async fault => {
      const f = await fixture();
      await expect(f.sessionBackups.check()).resolves.toBe("taken");
      const file = f.names(".session.sqlite")[0];
      if (fault === "deleted") rmSync(join(f.directory, file)); else f.damage(file);
      f.clock.advanceWall(SESSION_BACKUP_INTERVAL_MS + 1);
      await expect(f.sessionBackups.check()).resolves.toBe("taken");
    });
  });

  describe("interrupted replacement", () => {
    const { value: request } = Object.getOwnPropertyDescriptors(AuthorityBackupService.prototype).request;
    assert.ok(request);
    it("keeps only the newest verified pair on the next check, even when the answer is recent", async () => {
      const f = await fixture();
      await f.otherBackup(undefined); await f.otherBackup("clean-shutdown");
      const others = readdirSync(f.directory).sort();
      await f.sessionBackup();
      f.clock.advanceWall(SESSION_BACKUP_INTERVAL_MS + 1);
      await f.sessionBackup();
      const newest = f.names(".session.sqlite.manifest.json").at(-1)!;
      expect(f.names(".session.sqlite")).toHaveLength(2);
      await expect(f.sessionBackups.check()).resolves.toBe("recent");
      expect(f.names(".session.sqlite.manifest.json")).toEqual([newest]);
      expect(f.names(".session.sqlite")).toEqual([newest.slice(0, -".manifest.json".length)]);
      expect(readdirSync(f.directory).filter(name => !name.includes(".session")).sort()).toEqual(others);
    });
    it("keeps the older verified pair when the newest pair's bytes are broken", async () => {
      const f = await fixture();
      await f.sessionBackup();
      const older = f.names(".session.sqlite.manifest.json")[0];
      f.clock.advanceWall(SESSION_BACKUP_INTERVAL_MS + 1);
      await f.sessionBackup();
      const newest = f.names(".session.sqlite").find(name => `${name}.manifest.json` !== older)!;
      f.damage(newest);
      await expect(f.sessionBackups.check()).resolves.toBe("unchanged");
      expect(f.names(".session.sqlite.manifest.json")).toEqual([older]);
      expect(f.names(".session.sqlite")).toEqual([older.slice(0, -".manifest.json".length)]);
    });
    // Makes a file unreadable in place, or moves it behind an unsearchable folder so even its existence cannot be probed; returns the undo.
    const lock = (f: Awaited<ReturnType<typeof fixture>>, fileName: string, how: "mode" | "unsearchable folder") => {
      const path = join(f.directory, fileName);
      if (how === "mode") { chmodSync(path, 0o000); const undo = () => { if (existsSync(path)) chmodSync(path, 0o600); }; cleanups.push(undo); return undo; }
      const folder = join(f.bound.stateRoot, "locked"), moved = join(folder, fileName);
      mkdirSync(folder); renameSync(path, moved); symlinkSync(moved, path); chmodSync(folder, 0o000);
      const undo = () => { if (!existsSync(folder)) return; chmodSync(folder, 0o700); if (existsSync(moved)) { rmSync(path, { force: true }); renameSync(moved, path); } rmSync(folder, { recursive: true, force: true }); };
      cleanups.push(undo); return undo;
    };
    const failedOnce = (f: Awaited<ReturnType<typeof fixture>>) => {
      expect(f.events).toHaveLength(1);
      expect(f.events[0]).toMatchObject({ category: "worker", phase: "failed", area: "session-backup", reason: "session-backup-failed" });
    };
    const allFiles = (f: Awaited<ReturnType<typeof fixture>>) => readdirSync(f.directory).sort();
    it.each([["backup", "mode"], ["manifest", "mode"], ["backup", "unsearchable folder"]] as const)(
      "retires nothing and reports failed when the newest pair's %s cannot be read (%s)", async (part, how) => {
        const f = await fixture();
        await f.sessionBackup();
        const older = f.names(".session.sqlite.manifest.json")[0];
        f.clock.advanceWall(SESSION_BACKUP_INTERVAL_MS + 1);
        await f.sessionBackup();
        const files = allFiles(f);
        const newest = f.names(".session.sqlite.manifest.json").find(name => name !== older)!;
        const undo = lock(f, part === "manifest" ? newest : newest.slice(0, -".manifest.json".length), how);
        await expect(f.sessionBackups.check()).resolves.toBe("failed");
        expect(allFiles(f)).toEqual(files);
        failedOnce(f);
        undo();
        await expect(f.sessionBackups.check()).resolves.toBe("recent");
        expect(f.names(".session.sqlite.manifest.json")).toEqual([newest]);
      });
    it("retires nothing and reports failed when an older session pair's backup cannot be read", async () => {
      const f = await fixture();
      await f.sessionBackup();
      const older = f.names(".session.sqlite.manifest.json")[0];
      f.clock.advanceWall(SESSION_BACKUP_INTERVAL_MS + 1);
      await f.sessionBackup();
      const files = allFiles(f);
      const undo = lock(f, older.slice(0, -".manifest.json".length), "mode");
      await expect(f.sessionBackups.check()).resolves.toBe("failed");
      expect(allFiles(f)).toEqual(files);
      failedOnce(f);
      undo();
      await expect(f.sessionBackups.check()).resolves.toBe("recent");
      expect(f.names(".session.sqlite.manifest.json")).toEqual(files.filter(name => name.endsWith(".session.sqlite.manifest.json") && name !== older));
    });
    it("keeps a future-dated session pair when the wall clock was set back between two valid pairs", async () => {
      const f = await fixture();
      const start = f.clock.now();
      await f.sessionBackup();
      f.clock.advanceWall(SESSION_BACKUP_INTERVAL_MS + 1);
      await f.sessionBackup();
      const files = allFiles(f);
      f.clock.setWall(new Date(start.getTime() + 30 * MINUTE));
      await expect(f.sessionBackups.check()).resolves.toBe("recent");
      expect(allFiles(f)).toEqual(files);
    });
    it("holds retirement when a classified pair changed while the new backup was taken", async () => {
      const f = await fixture();
      await expect(f.sessionBackups.check()).resolves.toBe("taken");
      const previous = f.names(".session.sqlite")[0];
      f.clock.advanceWall(SESSION_BACKUP_INTERVAL_MS + 1); f.commitChange();
      vi.spyOn(AuthorityBackupService.prototype, "request").mockImplementationOnce(function (this: AuthorityBackupService, ...args: Parameters<typeof request>) {
        utimesSync(join(f.directory, previous), new Date(), new Date(Date.now() - MINUTE));
        return request.apply(this, args);
      });
      await expect(f.sessionBackups.check()).resolves.toBe("failed");
      expect(f.names(".session.sqlite")).toHaveLength(2);
      expect(f.names(".session.sqlite")).toContain(previous);
      expect(f.names(".session.sqlite.manifest.json")).toHaveLength(2);
      failedOnce(f);
      await expect(f.sessionBackups.check()).resolves.toBe("recent");
      expect(f.names(".session.sqlite")).toHaveLength(1);
      expect(f.names(".session.sqlite")).not.toContain(previous);
    });
    it.each(["removed", "altered", "given a foreign source identity"] as const)("keeps the previous pair when the fresh backup's files are %s after the request", async fault => {
      const f = await fixture();
      await expect(f.sessionBackups.check()).resolves.toBe("taken");
      const previous = f.names(".session.sqlite")[0];
      f.clock.advanceWall(SESSION_BACKUP_INTERVAL_MS + 1); f.commitChange();
      vi.spyOn(AuthorityBackupService.prototype, "request").mockImplementationOnce(async function (this: AuthorityBackupService, ...args: Parameters<typeof request>) {
        const result = await request.apply(this, args), fresh = result.manifests.at(-1)!.backupFileName;
        const manifestPath = join(f.directory, `${fresh}.manifest.json`);
        if (fault === "removed") { rmSync(manifestPath); rmSync(join(f.directory, fresh)); }
        else if (fault === "altered") f.damage(fresh);
        else {
          const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { sourceDatabaseIdentity: string };
          manifest.sourceDatabaseIdentity = `${manifest.sourceDatabaseIdentity.startsWith("0") ? "1" : "0"}${manifest.sourceDatabaseIdentity.slice(1)}`;
          writeFileSync(manifestPath, JSON.stringify(manifest));
        }
        return result;
      });
      await expect(f.sessionBackups.check()).resolves.toBe("failed");
      expect(f.names(".session.sqlite")).toContain(previous);
      expect(f.names(".session.sqlite.manifest.json")).toContain(`${previous}.manifest.json`);
      failedOnce(f);
    });
    it("keeps a manifest-less session backup whose manifest appears during the pass", async () => {
      const f = await fixture();
      await expect(f.sessionBackups.check()).resolves.toBe("taken");
      const previous = f.names(".session.sqlite")[0];
      const orphan = previous.replace(/-[0-9a-f-]{36}\.session/u, "-00000000-0000-4000-8000-000000000000.session");
      writeFileSync(join(f.directory, orphan), readFileSync(join(f.directory, previous)), { mode: 0o600 });
      f.clock.advanceWall(SESSION_BACKUP_INTERVAL_MS + 1); f.commitChange();
      vi.spyOn(AuthorityBackupService.prototype, "request").mockImplementationOnce(function (this: AuthorityBackupService, ...args: Parameters<typeof request>) {
        writeFileSync(join(f.directory, `${orphan}.manifest.json`), "{}", { mode: 0o600 });
        return request.apply(this, args);
      });
      await expect(f.sessionBackups.check()).resolves.toBe("failed");
      expect(f.names(".session.sqlite")).toContain(orphan);
      failedOnce(f);
    });
    it("keeps a manifest-less session backup whose manifest is published right after the listing", async () => {
      const f = await fixture();
      await expect(f.sessionBackups.check()).resolves.toBe("taken");
      const previous = f.names(".session.sqlite")[0];
      const orphan = previous.replace(/-[0-9a-f-]{36}\.session/u, "-00000000-0000-4000-8000-000000000000.session");
      writeFileSync(join(f.directory, orphan), readFileSync(join(f.directory, previous)), { mode: 0o600 });
      Object.assign(afterListing, { directory: f.directory, run: () => writeFileSync(join(f.directory, `${orphan}.manifest.json`), "{}", { mode: 0o600 }) });
      await expect(f.sessionBackups.check()).resolves.toBe("recent");
      expect(f.names(".session.sqlite")).toContain(orphan);
      expect(f.names(".session.sqlite.manifest.json")).toContain(`${orphan}.manifest.json`);
    });
    it("retires no stale session pair when the replacement backup fails verification", async () => {
      const f = await fixture();
      await f.sessionBackup();
      f.clock.advanceWall(SESSION_BACKUP_INTERVAL_MS + 1);
      await f.sessionBackup();
      f.clock.advanceWall(SESSION_BACKUP_INTERVAL_MS + 1); f.commitChange();
      const files = allFiles(f);
      vi.spyOn(AuthorityBackupService.prototype, "request").mockRejectedValueOnce(Object.assign(new Error("injected verification read failure"), { code: "EIO" }));
      await expect(f.sessionBackups.check()).resolves.toBe("failed");
      expect(allFiles(f)).toEqual(files);
      await expect(f.sessionBackups.check()).resolves.toBe("failed");
      expect(allFiles(f)).toEqual(files);
      failedOnce(f);
    });
    it("retires no session pair when a newer backup of another kind cannot be read", async () => {
      const f = await fixture();
      await f.sessionBackup();
      f.clock.advanceWall(SESSION_BACKUP_INTERVAL_MS + 1);
      await f.sessionBackup();
      f.clock.advanceWall(1);
      await f.otherBackup("clean-shutdown");
      const files = allFiles(f);
      lock(f, f.names(".shutdown.sqlite")[0], "mode");
      await expect(f.sessionBackups.check()).resolves.toBe("failed");
      expect(allFiles(f)).toEqual(files);
      failedOnce(f);
    });
    it.each(["foreign source identity", "renamed manifest"] as const)("keeps the older usable pair when the newest manifest has a %s", async fault => {
      const f = await fixture();
      await f.sessionBackup();
      const older = f.names(".session.sqlite.manifest.json")[0];
      f.clock.advanceWall(SESSION_BACKUP_INTERVAL_MS + 1);
      await f.sessionBackup();
      const newest = f.names(".session.sqlite.manifest.json").find(name => name !== older)!, newestPath = join(f.directory, newest);
      const manifest = JSON.parse(readFileSync(newestPath, "utf8")) as { sourceDatabaseIdentity: string };
      if (fault === "foreign source identity") {
        manifest.sourceDatabaseIdentity = `${manifest.sourceDatabaseIdentity.startsWith("0") ? "1" : "0"}${manifest.sourceDatabaseIdentity.slice(1)}`;
        writeFileSync(newestPath, JSON.stringify(manifest));
      } else {
        writeFileSync(join(f.directory, newest.replace(/-[0-9a-f-]{36}\.session/u, "-00000000-0000-4000-8000-000000000000.session")), readFileSync(newestPath));
        rmSync(newestPath);
      }
      await expect(f.sessionBackups.check()).resolves.toBe("unchanged");
      expect(f.names(".session.sqlite.manifest.json")).toEqual([older]);
      expect(f.names(".session.sqlite")).toEqual([older.slice(0, -".manifest.json".length)]);
    });
  });
});
