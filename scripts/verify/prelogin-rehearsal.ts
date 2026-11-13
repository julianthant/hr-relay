/** Copy rehearsal of startup and dashboard preflight. Never writes the source workspace. */
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Entry } from "@napi-rs/keyring";
import { z } from "zod";
import { initializeRegisteredPersonStores, prepareApplicationDataWorkspace } from "../../src/backend/app/composition/storage-compose.js";
import { applicationDataWorkspace, rebuildRuntimeIsolation } from "../../src/backend/app/config/runtime-isolation.js";
import { probePrimaryDisplay } from "../../src/backend/app/host/primary-display.js";
import { createDashboardPreflight } from "../../src/backend/app/preflight/dashboard-runners.js";
import { profileBrowserClosure } from "../../src/backend/runtime/browser/profile-browser-closure.js";
import type { RuntimeAdmission } from "../../src/backend/storage/admission/admission.js";
import { acquireDashboardEntrypointAdmission } from "../../src/backend/storage/admission/bootstrap-admission.js";
import { acquireRuntimeLifetimeLock, type RuntimeLifetimeLock } from "../../src/backend/storage/admission/lifetime-lock.js";
import { createCredentialStore } from "../../src/backend/storage/configuration/credential-store.js";
import { hostConfigFacts } from "../../src/models/config/host-display.js";
import { ConfigSchema } from "../../src/models/config/schema.js";
import { hostAwareResolutionEnvironment } from "../../src/models/config/secrets.js";
import { causeChainToken } from "../../src/models/failures/error-origins.js";
import { systemClock } from "../../src/rules/time/clock.js";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const reservedPorts = [rebuildRuntimeIsolation.backendPort, rebuildRuntimeIsolation.lockPort, rebuildRuntimeIsolation.frontendPort] as const;
const token = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);
const ControlRecordSchema = z.looseObject({ workspace: z.string() });

/** Installation record and the two runtime-owner markers. The database keeps its own paths. */
export const rehearsalControlFiles = [
  join(".tracker", "control", "installation.json"),
  join(rebuildRuntimeIsolation.stateRoot, ".runtime-owner.json"),
  join(rebuildRuntimeIsolation.artifactRoot, ".runtime-owner.json"),
] as const;

const BootLineSchema = z.object({
  payload: z.object({
    event: z.object({ area: z.string(), reason: z.string(), code: z.string() }),
  }),
});

export function assertCopyInsideTmp(copyPath: string, tmpRoot = realpathSync(tmpdir())): void {
  const copy = realpathSync(copyPath);
  const root = realpathSync(tmpRoot);
  const fromRoot = relative(root, copy);
  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new Error("prelogin-copy-outside-tmp");
}

export function rebindControlWorkspace(root: string, workspace: string): void {
  const realRoot = realpathSync(root);
  for (const relativePath of rehearsalControlFiles) {
    const path = join(root, relativePath);
    // A copied directory symlink would point the write back at the source store.
    const parent = relative(realRoot, realpathSync(dirname(path)));
    if (parent.startsWith("..") || isAbsolute(parent)) throw new Error("prelogin-control-outside-copy");
    if (lstatSync(path).isSymbolicLink()) throw new Error("prelogin-control-symlink");
    const record = ControlRecordSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    writeFileSync(path, `${JSON.stringify({ ...record, workspace })}\n`, { mode: 0o600 });
  }
}

function bindLoopbackPort(port: number): Promise<boolean> {
  return new Promise((resolveBind, reject) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") resolveBind(false);
      else reject(error);
    });
    server.listen(port, "127.0.0.1", () => {
      server.close(error => { if (error === undefined) resolveBind(true); else reject(error); });
    });
  });
}

export async function occupiedReservedPorts(canBind: (port: number) => Promise<boolean> = bindLoopbackPort): Promise<readonly number[]> {
  const occupied: number[] = [];
  for (const port of reservedPorts) if (!await canBind(port)) occupied.push(port);
  return occupied;
}

function failureToken(error: unknown): string {
  const coded = z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]*$/u) }).safeParse(error);
  if (coded.success) return coded.data.code;
  return causeChainToken(error) ?? "error";
}

function blockKeychainWrites(): void {
  const refuse = (): never => { throw new Error("prelogin-keychain-write-refused"); };
  Entry.prototype.setPassword = refuse;
  Entry.prototype.deletePassword = refuse;
}

function bootLogPath(workspace: string): string {
  return join(workspace, rebuildRuntimeIsolation.stateRoot, "logs", "boot.jsonl");
}

function bootLogSize(workspace: string): number {
  const path = bootLogPath(workspace);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined) return 0;
  if (stat.isSymbolicLink()) throw new Error("prelogin-boot-log-symlink");
  return stat.size;
}

function readStartupHolds(workspace: string, offset: number): readonly { area: string; reason: string; code: string }[] {
  const path = bootLogPath(workspace);
  if (lstatSync(path, { throwIfNoEntry: false }) === undefined) return [];
  const bytes = readFileSync(path);
  if (bytes.length < offset) throw new Error("prelogin-boot-log-shrunk");
  const holds: { area: string; reason: string; code: string }[] = [];
  for (const line of bytes.subarray(offset).toString("utf8").split("\n")) {
    if (line === "") continue;
    let event: z.infer<typeof BootLineSchema> | undefined;
    try {
      const parsed = BootLineSchema.safeParse(JSON.parse(line));
      if (!parsed.success || !parsed.data.payload.event.area.startsWith("profile-startup-")) continue;
      event = parsed.data;
    } catch (error) {
      throw new Error("prelogin-boot-log-unreadable", { cause: error });
    }
    if (event === undefined) continue;
    const hold = event.payload.event;
    if (!token.safeParse(hold.area).success || !token.safeParse(hold.reason).success || !token.safeParse(hold.code).success) {
      throw new Error("prelogin-boot-log-unreadable");
    }
    holds.push({ area: hold.area, reason: hold.reason, code: hold.code });
  }
  return holds;
}

function readCurrentConfig(stateRoot: string): { readonly config: z.output<typeof ConfigSchema>; readonly schema: number } {
  const db = new DatabaseSync(join(stateRoot, "state.db"), { readOnly: true });
  try {
    const schema = z.object({ user_version: z.number().int().nonnegative() }).parse(db.prepare("pragma user_version").get());
    const rows = z.array(z.object({ id: z.string(), payload_json: z.string(), current: z.string() })).parse(db.prepare(
      "select s.id as id, s.payload_json as payload_json, (select snapshot_id from settings where id = 'current') as current from settings_snapshots s",
    ).all());
    const current = rows.find(row => row.id === row.current);
    if (current === undefined) throw new Error("prelogin-settings-missing");
    const payload = z.object({ config: z.unknown() }).parse(JSON.parse(current.payload_json));
    return { config: ConfigSchema.parse(payload.config), schema: schema.user_version };
  } finally { db.close(); }
}

/** cp's own diagnostics name source paths, so they are captured and dropped. */
export function copyWorkspace(source: string, target: string): void {
  try { execFileSync("cp", ["-Rp", source, target], { stdio: ["ignore", "ignore", "pipe"] }); }
  catch { throw new Error("prelogin-copy-failed"); }
}

/** Deletes the copy only after its storage owners closed; an unproved closure keeps it. */
export async function closeThenDelete(release: () => void, close: () => Promise<void>, remove: () => void, write: (line: string) => void): Promise<boolean> {
  let ok = true;
  try { release(); } catch (error) { write(`FAIL ${failureToken(error)}`); ok = false; }
  try { await close(); } catch (error) { write(`FAIL ${failureToken(error)}`); ok = false; }
  if (!ok) { write("KEPT copy closure-unproved"); return false; }
  try { remove(); } catch (error) { write(`FAIL ${failureToken(error)}`); return false; }
  return true;
}

function deleteCopy(copy: string, tmpRoot: string): void {
  assertCopyInsideTmp(copy, tmpRoot);
  if (lstatSync(copy).isSymbolicLink()) throw new Error("prelogin-copy-symlink");
  rmSync(copy, { recursive: true, force: true });
}

export async function runPreloginRehearsal(options: { readonly workspace?: string; readonly write?: (line: string) => void } = {}): Promise<number> {
  const write = options.write ?? ((line: string) => { process.stdout.write(`${line}\n`); });
  const occupied = await occupiedReservedPorts();
  if (occupied.length !== 0) {
    write(`REFUSED ports-occupied ${occupied.map(String).join(" ")}`);
    return 1;
  }
  blockKeychainWrites();
  const tmpRoot = realpathSync(tmpdir());
  const copy = mkdtempSync(join(tmpRoot, "relay-prelogin-"));
  chmodSync(copy, 0o700);
  let result = 0;
  let lock: RuntimeLifetimeLock | undefined;
  let machine: RuntimeAdmission | undefined;
  try {
    assertCopyInsideTmp(copy, tmpRoot);
    const source = realpathSync(resolve(options.workspace ?? applicationDataWorkspace()));
    if (source === realpathSync(copy)) throw new Error("prelogin-copy-is-source");
    const workspace = join(copy, "workspace");
    copyWorkspace(source, workspace);
    chmodSync(workspace, 0o700);
    rebindControlWorkspace(workspace, workspace);
    const bootAt = bootLogSize(workspace);
    const started = systemClock.monotonicMs();
    try {
      lock = await acquireRuntimeLifetimeLock(0);
      const facts = hostConfigFacts(hostAwareResolutionEnvironment(probePrimaryDisplay));
      await prepareApplicationDataWorkspace(repositoryRoot, workspace, lock, facts);
      await initializeRegisteredPersonStores(workspace, lock, facts);
    } finally {
      write(`TIMING startup-stores ms=${String(Math.round(systemClock.monotonicMs() - started))}`);
    }
    for (const hold of readStartupHolds(workspace, bootAt)) {
      result = 1;
      write(`HELD area=${hold.area} reason=${hold.reason} code=${hold.code}`);
    }
    if (lock === undefined) throw new Error("prelogin-lifetime-missing");
    machine = await acquireDashboardEntrypointAdmission(profileBrowserClosure, workspace, "shared", lock);
    for (const profile of machine.readProfileRegistry().profiles.filter(row => row.lifecycle === "ready")) {
      const owner = machine.admitProfile(profile.profileId);
      try {
        const current = readCurrentConfig(owner.stateRoot);
        write(`SCHEMA user_version=${String(current.schema)}`);
        const preflightStarted = systemClock.monotonicMs();
        const { authority } = createDashboardPreflight({
          repoRoot: repositoryRoot,
          config: current.config,
          stateRoot: owner.stateRoot,
          artifactRoot: owner.artifactRoot,
          backendPort: rebuildRuntimeIsolation.backendPort,
          frontendPort: 0,
          clock: systemClock,
          admission: owner,
          credentials: createCredentialStore({ admission: owner, stateRoot: owner.stateRoot }),
          backupDirectory: join(owner.stateRoot, "backups", "authority"),
          configFingerprint: "0".repeat(64),
        });
        const report = await authority.refresh(new AbortController().signal);
        write(`TIMING preflight ms=${String(Math.round(systemClock.monotonicMs() - preflightStarted))}`);
        for (const row of report.results) {
          write(`CHECK ${row.check} ${row.status}`);
          if (row.status === "fail") result = 1;
        }
      } finally { owner.release(); }
    }
  } catch (error) {
    write(`FAIL ${failureToken(error)}`);
    result = 1;
  } finally {
    if (!await closeThenDelete(() => { machine?.release(); }, async () => { await lock?.close(); }, () => { deleteCopy(copy, tmpRoot); }, write)) result = 1;
  }
  return result;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  const flag = process.argv.indexOf("--workspace");
  const workspace = flag === -1 ? undefined : process.argv[flag + 1];
  if (flag !== -1 && (workspace === undefined || workspace.startsWith("-"))) {
    process.stderr.write("verify:prelogin: --workspace needs a path\n");
    process.exitCode = 1;
  } else {
    // An unproved closure can leave the lifetime listener open; the result is final either way.
    process.exit(await runPreloginRehearsal(workspace === undefined ? {} : { workspace }));
  }
}
