import { join } from "node:path";
import { z } from "zod";
import { ProfileDatabaseBindingSchema } from "../../../models/profiles/profile.js";
import { FileIdentitySchema } from "../../../models/storage/file-identity.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import { RuntimeAdmission } from "../admission/admission.js";
import { fileStatus, sameDirectory } from "../file-identity.js";
import { privatePathRejects } from "../private-path.js";
import { AuthorityDatabase } from "./authority-database.js";
import { historyArchivePath } from "./isolated-history-store.js";
import { requireDatabaseSourcePath } from "./recovery-admission.js";

export const READ_LANE_PROTOCOL = "relay.dashboard-read-lane.v1";
export const READ_LANE_OPEN_MODE = "dashboard-read-worker-read-only-no-migrate";
export const ReadLaneNameSchema = z.enum(["navigation", "search"]);
export type ReadLaneName = z.infer<typeof ReadLaneNameSchema>;

export const ReadLaneStartSchema = z.strictObject({
  protocol: z.literal(READ_LANE_PROTOCOL),
  lane: ReadLaneNameSchema,
  path: z.string().min(1),
  stateRoot: z.string().min(1),
  binding: ProfileDatabaseBindingSchema,
  identity: FileIdentitySchema,
  historyArchive: z.strictObject({ path: z.string().min(1), identity: FileIdentitySchema }).optional(),
  cursorOffset: z.number().int().nonnegative(),
  /** The navigation lane, and only it, owns the checkpoint-only connection. */
  checkpoint: z.boolean(),
});
export type ReadLaneStart = z.infer<typeof ReadLaneStartSchema>;

/** The store and its WAL companions are private single-link files; requireWal holds the worker to an open WAL source. */
export function readLaneSourceIdentity(path: string, requireWal = false): z.infer<typeof FileIdentitySchema> {
  requireDatabaseSourcePath(path);
  const source = fileStatus(path);
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const file = path + suffix, status = suffix === "" ? source : fileStatus(file, true);
    if (requireWal && status === undefined && (suffix === "-wal" || suffix === "-shm")) throw new Error("read-lane-wal-source-missing");
    if (status !== undefined && (!status.isFile() || BigInt(status.nlink) !== 1n || privatePathRejects(file, status, "group-write"))) {
      throw new Error("profile-database-identity-invalid");
    }
  }
  return { device: String(source.dev), inode: String(source.ino) };
}

/** Main thread, at lane start: the record a lane worker admits itself from. */
export function prepareReadLaneStart(admission: RuntimeAdmission, database: AuthorityDatabase, lane: ReadLaneName): ReadLaneStart {
  const owner = requireRuntimeAdmission(admission);
  owner.assertProfileRuntime();
  const path = join(owner.stateRoot, "state.db");
  owner.assertReadOnlyAuthorityDatabase(path);
  const history = database.dashboardHistory();
  const cursorOffset = history.timelineCursorOffset();
  const archivePath = history === database ? undefined : historyArchivePath(owner.stateRoot);
  const archive = archivePath === undefined ? undefined : fileStatus(archivePath);
  return ReadLaneStartSchema.parse({ protocol: READ_LANE_PROTOCOL, lane, path, stateRoot: owner.stateRoot, binding: owner.profileBinding,
    identity: readLaneSourceIdentity(path), cursorOffset, checkpoint: lane === "navigation",
    ...(archivePath === undefined || archive === undefined ? {} : { historyArchive: { path: archivePath,
      identity: { device: String(archive.dev), inode: String(archive.ino) } } }) });
}

/** Worker thread: validates the start record, re-checks its source and issues this isolate's read-lane admission. */
export function admitReadLane(input: unknown): Readonly<{ start: ReadLaneStart; admission: RuntimeAdmission; assertSource: () => void;
  withProvedSource: <T>(read: () => T) => T }> {
  if (!z.object({ protocol: z.literal(READ_LANE_PROTOCOL) }).safeParse(input).success) throw new Error("read-lane-protocol-mismatch");
  const start = ReadLaneStartSchema.parse(input);
  if (start.historyArchive === undefined && start.cursorOffset !== 0) throw new Error("read-lane-history-cursor-mismatch");
  if (start.checkpoint !== (start.lane === "navigation")) throw new Error("read-lane-checkpoint-refused");
  const assertSource = () => {
    if (!sameDirectory(readLaneSourceIdentity(start.path, true), start.identity)) throw new Error("profile-database-open-source-changed");
  };
  assertSource();
  let proving = false;
  const admission = RuntimeAdmission.forReadLane({ stateRoot: start.stateRoot, path: start.path, binding: start.binding,
    assertSource: () => { if (!proving) assertSource(); }, checkpoint: start.checkpoint });
  /**
   * One read snapshot, with the source proved when it begins and again before its result is returned, instead of on every
   * statement: a store replaced during the read still refuses that read's result.
   */
  const withProvedSource = <T>(read: () => T): T => {
    if (proving) throw new Error("read-lane-source-proof-nested");
    assertSource();
    proving = true;
    let result: T;
    try { result = read(); } finally { proving = false; }
    assertSource();
    return result;
  };
  return Object.freeze({ start, admission, assertSource, withProvedSource });
}

/**
 * Opens the lane's native read-only connection and, when the host admitted one, the history reader over both histories.
 * The stored binding must equal the start record's, and the source must still be the admitted file after the open.
 */
export function openReadLane(lane: ReturnType<typeof admitReadLane>, busyTimeoutMs: number): Readonly<{ native: AuthorityDatabase; history: AuthorityDatabase }> {
  const { start, admission, assertSource } = lane;
  const native = AuthorityDatabase.openReadLaneNative(admission, start.path, busyTimeoutMs, start.historyArchive !== undefined);
  try {
    assertSource();
    const history = native.readLaneHistory(start.historyArchive === undefined ? undefined : { ...start.historyArchive, cursorOffset: start.cursorOffset });
    assertSource();
    return Object.freeze({ native, history });
  } catch (error) { native.close(); throw error; }
}
