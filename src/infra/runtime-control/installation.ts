import { randomUUID } from "node:crypto";
import {
  closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync,
} from "node:fs";
import { isAbsolute, join, parse, relative, resolve } from "node:path";
import { z } from "zod";
import { rebuildRuntimeIsolation } from "../../config/runtime-isolation.js";
import { observeProcessIdentity, ProcessStartIdentitySchema, type ProcessStartIdentity } from "../sqlite/runtime-process-locks.js";

const PairSchema = z.strictObject({ stateRoot: z.string().min(1), artifactRoot: z.string().min(1) });
const InstallationSchema = z.strictObject({ schemaVersion: z.literal(1), installationId: z.uuid(), workspace: z.string().min(1) });
const LocatorSchema = z.strictObject({ schemaVersion: z.literal(1), installationId: z.uuid(), generation: z.number().int().nonnegative(), stateRoot: z.string(), artifactRoot: z.string() });
const MarkerSchema = z.strictObject({ schemaVersion: z.literal(1), installationId: z.uuid(), workspace: z.string(), role: z.enum(["state", "artifact"]), generation: z.number().int().nonnegative() });
const LeaseSchema = z.strictObject({ schemaVersion: z.literal(1), admissionId: z.uuid(), mode: z.enum(["shared", "exclusive"]), pid: z.number().int().positive(), processIdentity: ProcessStartIdentitySchema });
const JournalSchema = z.discriminatedUnion("phase", [
  z.strictObject({ schemaVersion: z.literal(1), phase: z.literal("adopting"), installationId: z.uuid() }),
  z.strictObject({ schemaVersion: z.literal(1), phase: z.literal("preparing"), installationId: z.uuid(), fromGeneration: z.number().int().nonnegative(), source: PairSchema, destination: PairSchema }),
  z.strictObject({ schemaVersion: z.literal(1), phase: z.literal("fenced"), installationId: z.uuid(), fromGeneration: z.number().int().nonnegative(), source: PairSchema, destination: PairSchema, backupReceiptId: z.string().min(1), stagingReceiptId: z.string().min(1) }),
  z.strictObject({ schemaVersion: z.literal(1), phase: z.literal("switched"), installationId: z.uuid(), fromGeneration: z.number().int().nonnegative(), source: PairSchema, destination: PairSchema, backupReceiptId: z.string().min(1), stagingReceiptId: z.string().min(1) }),
]);
export type RuntimePair = z.infer<typeof PairSchema>;
export type RuntimeLocator = z.infer<typeof LocatorSchema>;
export type ExistingAuthorityEvidence = Readonly<{ kind: "verified-existing"; pair: RuntimePair; authorityGeneration: number; databaseIdentity: string }>;
export type AuthorityVerifier = (pair: RuntimePair) => ExistingAuthorityEvidence;
export type VerifiedRelocationEvidence = Readonly<{ installationId: string; sourceGeneration: number; destination: RuntimePair; backupReceiptId: string; stagingReceiptId: string }>;
export type RelocationVerifier = (source: RuntimeLocator, destination: RuntimePair) => VerifiedRelocationEvidence;
export type InstallationLease = Readonly<{ mode: "shared" | "exclusive"; locator: RuntimeLocator; assertHeld(): void; release(): void }>;
export type ExclusiveInstallationLease = InstallationLease & Readonly<{
  beginRelocation(destination: RuntimePair): void;
  fenceRelocationSource(verify: RelocationVerifier): void;
  switchRelocationLocator(): RuntimeLocator;
  settleRelocation(): void;
}>;

const CONTROL = ".runtime-control";
const MARKER = ".runtime-owner.json";
const FENCE = ".runtime-source-fence.json";
const issuedLeases = new WeakSet<object>();

function fail(reason: string): never { throw new Error(`runtime-control: ${reason}`); }
function inside(parent: string, child: string): boolean {
  const part = relative(parent, child);
  return part === "" || (part !== ".." && !part.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(part));
}
function validatePair(workspace: string, pair: RuntimePair): RuntimePair {
  PairSchema.parse({ stateRoot: pair.stateRoot, artifactRoot: pair.artifactRoot });
  for (const path of [pair.stateRoot, pair.artifactRoot]) {
    if (!isAbsolute(path) || resolve(path) !== path) fail("root must be canonical absolute path");
    if (inside(path, workspace) || inside(path, join(workspace, CONTROL)) || inside(join(workspace, CONTROL), path)) fail("control overlaps a movable root");
  }
  if (pair.stateRoot === pair.artifactRoot || (inside(pair.artifactRoot, pair.stateRoot))) fail("invalid root overlap");
  return pair;
}
function assertKnownDefaults(workspace: string, pair: RuntimePair): void {
  validatePair(workspace, pair);
  if (pair.stateRoot !== resolve(workspace, rebuildRuntimeIsolation.stateRoot) || pair.artifactRoot !== resolve(workspace, rebuildRuntimeIsolation.artifactRoot)) fail("first adoption requires the known default root pair");
}
function privateDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o777) !== 0o700) fail(`unsafe directory ${path}`);
}
function dataDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o222) !== 0o200) fail(`unsafe data root ${path}`);
}
function lstatMaybe(path: string): ReturnType<typeof lstatSync> | undefined {
  try { return lstatSync(path); }
  catch (error) {
    if (typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT") return undefined;
    throw error;
  }
}
function privateFile(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o777) !== 0o600) fail(`unsafe file ${path}`);
}
function syncDir(path: string): void { const fd = openSync(path, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
function readStrict<T>(path: string, schema: z.ZodType<T>): T {
  privateFile(path);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o777) !== 0o600) fail(`unsafe file ${path}`);
    return schema.parse(JSON.parse(readFileSync(fd, "utf8")));
  } finally { closeSync(fd); }
}
function atomicJson(path: string, value: unknown, parentKind: "control" | "data" = "control"): void {
  const directory = resolve(path, "..");
  if (parentKind === "control") privateDirectory(directory);
  else dataDirectory(directory);
  const temp = join(directory, `.${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
    const fd = openSync(temp, "r"); try { fsyncSync(fd); } finally { closeSync(fd); }
    if (lstatMaybe(path)) privateFile(path);
    renameSync(temp, path);
    syncDir(directory);
  } finally { if (existsSync(temp)) unlinkSync(temp); }
}
function assertNoSymlinkComponents(path: string): void {
  let component = parse(path).root;
  for (const part of relative(component, path).split(/[\\/]/u)) {
    component = join(component, part);
    if (lstatMaybe(component)?.isSymbolicLink()) fail(`symlink in root path ${component}`);
  }
}
function preflightRoot(path: string): void {
  assertNoSymlinkComponents(path);
  if (lstatMaybe(path)) dataDirectory(path);
}
function preflightPair(pair: RuntimePair): void {
  preflightRoot(pair.stateRoot);
  preflightRoot(pair.artifactRoot);
}
function ensureRoot(path: string): void {
  preflightRoot(path);
  if (!lstatMaybe(path)) { mkdirSync(path, { recursive: true, mode: 0o700 }); syncDir(resolve(path, "..")); }
  dataDirectory(path);
}
function markerPath(root: string): string { return join(root, MARKER); }
function assertNoDefaultWitness(pair: RuntimePair): void {
  for (const root of [pair.stateRoot, pair.artifactRoot]) {
    if (lstatMaybe(markerPath(root))) fail("existing ownership witness without locator");
    if (lstatMaybe(join(root, FENCE))) fail("retained source fence without locator");
  }
}
function checkMarker(root: string, installationId: string, workspace: string, role: "state" | "artifact", generation: number): void {
  preflightRoot(root);
  dataDirectory(root);
  const marker = readStrict(markerPath(root), MarkerSchema);
  if (marker.installationId !== installationId || marker.workspace !== workspace || marker.role !== role || marker.generation !== generation) fail(`root ownership mismatch: ${role}`);
}
function installMarker(root: string, installationId: string, workspace: string, role: "state" | "artifact", generation: number): void {
  ensureRoot(root);
  if (lstatMaybe(markerPath(root))) fail(`root already owned: ${role}`);
  atomicJson(markerPath(root), { schemaVersion: 1, installationId, workspace, role, generation }, "data");
}
function ensureDestinationMarker(root: string, installationId: string, workspace: string, role: "state" | "artifact", generation: number): void {
  if (lstatMaybe(markerPath(root))) checkMarker(root, installationId, workspace, role, generation);
  else installMarker(root, installationId, workspace, role, generation);
}
function identity(): ProcessStartIdentity {
  const observation = observeProcessIdentity(process.pid);
  if (observation.state !== "alive") fail("current process identity unavailable");
  return observation.identity;
}
function isLive(lease: z.infer<typeof LeaseSchema>): boolean {
  const observed = observeProcessIdentity(lease.pid);
  return observed.state === "alive" && observed.identity.platform === lease.processIdentity.platform && observed.identity.startToken === lease.processIdentity.startToken;
}
function mutex<T>(control: string, callback: () => T): T {
  privateDirectory(control);
  const path = join(control, "admission-mutex");
  try { mkdirSync(path, { mode: 0o700 }); syncDir(control); }
  catch { fail("admission mutex busy or abandoned; offline recovery required"); }
  try {
    privateDirectory(path);
    atomicJson(join(path, "owner.json"), { schemaVersion: 1, acquisitionId: randomUUID(), phase: "admitting", pid: process.pid, processIdentity: identity() });
    return callback();
  } finally {
    unlinkSync(join(path, "owner.json"));
    rmdirSync(path);
    syncDir(control);
  }
}
function activeLeases(control: string): readonly z.infer<typeof LeaseSchema>[] {
  const directory = join(control, "leases");
  privateDirectory(directory);
  return readdirSync(directory).map((name) => {
    if (!/^[-0-9a-f]+\.json$/u.test(name)) fail("unexpected lease entry");
    return readStrict(join(directory, name), LeaseSchema);
  }).filter(isLive);
}
function readInstallation(control: string, workspace: string): z.infer<typeof InstallationSchema> {
  const installed = readStrict(join(control, "installation.json"), InstallationSchema);
  if (installed.workspace !== workspace) fail("installation workspace mismatch");
  return installed;
}
function readLocator(control: string, workspace: string, recovery?: { installationId: string; fromGeneration: number }): RuntimeLocator {
  const installation = readInstallation(control, workspace);
  if (!existsSync(join(control, "locator.json"))) fail("installation locator missing; offline recovery required");
  const locator = readStrict(join(control, "locator.json"), LocatorSchema);
  if (locator.installationId !== installation.installationId) fail("locator installation mismatch");
  validatePair(workspace, locator);
  checkMarker(locator.stateRoot, locator.installationId, workspace, "state", locator.generation);
  checkMarker(locator.artifactRoot, locator.installationId, workspace, "artifact", locator.generation);
  if (existsSync(join(control, "journal.json"))) {
    const journal = readStrict(join(control, "journal.json"), JournalSchema);
    if (journal.phase === "adopting" || journal.phase === "preparing") fail(`unfinished ${journal.phase} operation; explicit offline recovery required`);
    if (journal.phase === "fenced" || journal.phase === "switched") {
      if (!recovery || recovery.installationId !== journal.installationId || recovery.fromGeneration !== journal.fromGeneration || locator.installationId !== journal.installationId || (locator.generation !== journal.fromGeneration && locator.generation !== journal.fromGeneration + 1)) fail(`unfinished ${journal.phase} operation; explicit offline recovery required`);
      for (const root of [journal.source.stateRoot, journal.source.artifactRoot]) {
        const fence = readStrict(join(root, FENCE), z.strictObject({ schemaVersion: z.literal(1), installationId: z.uuid(), generation: z.number().int().nonnegative(), destination: PairSchema }));
        if (fence.installationId !== journal.installationId || fence.generation !== journal.fromGeneration || fence.destination.stateRoot !== journal.destination.stateRoot || fence.destination.artifactRoot !== journal.destination.artifactRoot) fail("source fence mismatch");
      }
      if (locator.generation === journal.fromGeneration && (locator.stateRoot !== journal.source.stateRoot || locator.artifactRoot !== journal.source.artifactRoot)) fail("recovery source locator mismatch");
      if (locator.generation === journal.fromGeneration + 1 && (locator.stateRoot !== journal.destination.stateRoot || locator.artifactRoot !== journal.destination.artifactRoot)) fail("recovery destination locator mismatch");
      if (journal.phase === "switched" && locator.generation !== journal.fromGeneration + 1) fail("switched journal locator mismatch");
    }
  } else if (recovery) {
    fail("relocation recovery journal missing");
  }
  if (!recovery && (existsSync(join(locator.stateRoot, FENCE)) || existsSync(join(locator.artifactRoot, FENCE)))) fail("locator points to a fenced source");
  return locator;
}
function rawLocator(control: string, workspace: string): RuntimeLocator {
  const installation = readInstallation(control, workspace);
  const locator = readStrict(join(control, "locator.json"), LocatorSchema);
  if (locator.installationId !== installation.installationId) fail("locator installation mismatch");
  validatePair(workspace, locator);
  return locator;
}
function defaultEmpty(pair: RuntimePair): boolean {
  const permittedStateEntry = inside(pair.stateRoot, pair.artifactRoot) ? relative(pair.stateRoot, pair.artifactRoot).split(/[\\/]/u)[0] : undefined;
  for (const [root, allowed] of [[pair.stateRoot, permittedStateEntry], [pair.artifactRoot, undefined]] as const) {
    if (!lstatMaybe(root)) continue;
    dataDirectory(root);
    if (readdirSync(root).some((name) => name !== allowed)) return false;
  }
  return true;
}
function adopt(control: string, workspace: string, defaultPair: RuntimePair, verifier?: AuthorityVerifier): RuntimeLocator {
  const pair = Object.freeze({ stateRoot: defaultPair.stateRoot, artifactRoot: defaultPair.artifactRoot });
  assertKnownDefaults(workspace, pair);
  preflightPair(pair);
  if (existsSync(join(control, "installation.json")) || existsSync(join(control, "locator.json")) || existsSync(join(control, "journal.json"))) fail("incomplete adoption; offline recovery required");
  assertNoDefaultWitness(pair);
  if (!defaultEmpty(pair)) {
    if (!verifier) fail("existing authority requires verifier");
    const evidence = verifier(Object.freeze({ ...pair }));
    if (evidence.kind !== "verified-existing" || evidence.pair.stateRoot !== pair.stateRoot || evidence.pair.artifactRoot !== pair.artifactRoot || !Number.isSafeInteger(evidence.authorityGeneration) || evidence.authorityGeneration < 0 || !evidence.databaseIdentity) fail("invalid authority evidence");
  }
  preflightPair(pair);
  assertNoDefaultWitness(pair);
  const installationId = randomUUID();
  atomicJson(join(control, "installation.json"), { schemaVersion: 1, installationId, workspace });
  atomicJson(join(control, "journal.json"), { schemaVersion: 1, phase: "adopting", installationId });
  installMarker(pair.stateRoot, installationId, workspace, "state", 0);
  installMarker(pair.artifactRoot, installationId, workspace, "artifact", 0);
  const locator = { schemaVersion: 1 as const, installationId, generation: 0, ...pair };
  atomicJson(join(control, "locator.json"), locator);
  unlinkSync(join(control, "journal.json")); syncDir(control);
  return locator;
}
export function acquireInstallation(workspacePath: string, mode: "shared", options?: never): InstallationLease;
export function acquireInstallation(workspacePath: string, mode: "exclusive", options?: { defaultPair?: RuntimePair; verifyExisting?: AuthorityVerifier; recoverRelocation?: { installationId: string; fromGeneration: number } }): ExclusiveInstallationLease;
export function acquireInstallation(workspacePath: string, mode: "shared" | "exclusive", options?: { defaultPair?: RuntimePair; verifyExisting?: AuthorityVerifier; recoverRelocation?: { installationId: string; fromGeneration: number } }): InstallationLease | ExclusiveInstallationLease {
  const workspace = realpathSync(workspacePath);
  const control = join(workspace, CONTROL);
  if (!existsSync(control)) {
    if (mode !== "exclusive" || !options?.defaultPair) fail("installation locator missing");
    assertKnownDefaults(workspace, options.defaultPair);
    preflightPair(options.defaultPair);
    assertNoDefaultWitness(options.defaultPair);
    mkdirSync(control, { mode: 0o700 }); syncDir(workspace);
    mkdirSync(join(control, "leases"), { mode: 0o700 }); syncDir(control);
  }
  privateDirectory(control);
  let leasePath = "";
  let admissionId = "";
  const resolvedLocator = mutex(control, () => {
    const peers = activeLeases(control);
    if (peers.some((peer) => mode === "exclusive" || peer.mode === "exclusive")) fail("installation lease busy");
    const resolved = existsSync(join(control, "installation.json")) ? readLocator(control, workspace, mode === "exclusive" ? options?.recoverRelocation : undefined) : (mode === "exclusive" && options?.defaultPair ? adopt(control, workspace, options.defaultPair, options.verifyExisting) : fail("installation locator missing"));
    admissionId = randomUUID();
    leasePath = join(control, "leases", `${admissionId}.json`);
    atomicJson(leasePath, { schemaVersion: 1, admissionId, mode, pid: process.pid, processIdentity: identity() });
    return resolved;
  });
  const locator = Object.freeze({ ...resolvedLocator });
  const publicLocator = Object.freeze({ ...locator });
  let released = false;
  function assertHeld(): void {
    if (released) fail("installation lease released");
    const record = readStrict(leasePath, LeaseSchema);
    if (record.admissionId !== admissionId || record.pid !== process.pid || !isLive(record)) fail("installation lease identity changed");
  }
  const shared = {
    mode,
    locator: publicLocator,
    assertHeld,
    release() {
      if (released) return;
      mutex(control, () => { assertHeld(); unlinkSync(leasePath); syncDir(join(control, "leases")); });
      released = true;
    },
  };
  issuedLeases.add(shared);
  if (mode === "shared") return shared;
  let relocationStarted = options?.recoverRelocation !== undefined;
  function journal(): z.infer<typeof JournalSchema> {
    return readStrict(join(control, "journal.json"), JournalSchema);
  }
  const exclusive: ExclusiveInstallationLease = {
    ...shared,
    beginRelocation(destination) {
      assertHeld();
      if (relocationStarted) fail("one relocation per exclusive lease; reacquire after settlement");
      const target = Object.freeze({ stateRoot: destination.stateRoot, artifactRoot: destination.artifactRoot });
      validatePair(workspace, target);
      if (existsSync(join(control, "journal.json"))) fail("relocation already pending");
      if (target.stateRoot === locator.stateRoot && target.artifactRoot === locator.artifactRoot) fail("destination unchanged");
      if ([target.stateRoot, target.artifactRoot].some((root) => inside(locator.stateRoot, root) || inside(root, locator.stateRoot) || inside(locator.artifactRoot, root) || inside(root, locator.artifactRoot))) fail("source and destination overlap");
      preflightPair(target);
      if (lstatMaybe(markerPath(target.stateRoot)) || lstatMaybe(markerPath(target.artifactRoot)) || lstatMaybe(join(target.stateRoot, FENCE)) || lstatMaybe(join(target.artifactRoot, FENCE)) || !defaultEmpty(target)) fail("destination is not fresh and eligible");
      const current = rawLocator(control, workspace);
      if (current.installationId !== locator.installationId || current.generation !== locator.generation || current.stateRoot !== locator.stateRoot || current.artifactRoot !== locator.artifactRoot) fail("exclusive locator changed; reacquire lease");
      atomicJson(join(control, "journal.json"), { schemaVersion: 1, phase: "preparing", installationId: locator.installationId, fromGeneration: locator.generation, source: { stateRoot: locator.stateRoot, artifactRoot: locator.artifactRoot }, destination: target });
      relocationStarted = true;
    },
    fenceRelocationSource(verify) {
      assertHeld();
      const pending = journal();
      if (pending.phase !== "preparing" || pending.installationId !== locator.installationId || pending.fromGeneration !== locator.generation) fail("relocation is not preparing");
      const evidence = verify(Object.freeze({ ...locator }), Object.freeze({ ...pending.destination }));
      if (evidence.installationId !== locator.installationId || evidence.sourceGeneration !== locator.generation || evidence.destination.stateRoot !== pending.destination.stateRoot || evidence.destination.artifactRoot !== pending.destination.artifactRoot || !evidence.backupReceiptId || !evidence.stagingReceiptId) fail("invalid relocation evidence");
      for (const root of [pending.source.stateRoot, pending.source.artifactRoot]) {
        const path = join(root, FENCE);
        if (lstatMaybe(path)) fail("source already fenced");
        atomicJson(path, { schemaVersion: 1, installationId: locator.installationId, generation: locator.generation, destination: pending.destination }, "data");
      }
      atomicJson(join(control, "journal.json"), { ...pending, phase: "fenced", backupReceiptId: evidence.backupReceiptId, stagingReceiptId: evidence.stagingReceiptId });
    },
    switchRelocationLocator() {
      assertHeld();
      const pending = journal();
      if (pending.phase !== "fenced") fail("source fence required before locator switch");
      for (const root of [pending.source.stateRoot, pending.source.artifactRoot]) {
        const fence = readStrict(join(root, FENCE), z.strictObject({ schemaVersion: z.literal(1), installationId: z.uuid(), generation: z.number().int().nonnegative(), destination: PairSchema }));
        if (fence.installationId !== locator.installationId || fence.generation !== pending.fromGeneration || fence.destination.stateRoot !== pending.destination.stateRoot || fence.destination.artifactRoot !== pending.destination.artifactRoot) fail("source fence mismatch");
      }
      const next = { ...locator, generation: pending.fromGeneration + 1, ...pending.destination };
      if (locator.generation === pending.fromGeneration) {
        ensureDestinationMarker(next.stateRoot, next.installationId, workspace, "state", next.generation);
        ensureDestinationMarker(next.artifactRoot, next.installationId, workspace, "artifact", next.generation);
        atomicJson(join(control, "locator.json"), next);
      } else if (locator.generation !== next.generation || locator.stateRoot !== next.stateRoot || locator.artifactRoot !== next.artifactRoot) fail("recovery locator mismatch");
      atomicJson(join(control, "journal.json"), { ...pending, phase: "switched" });
      return Object.freeze({ ...next });
    },
    settleRelocation() {
      assertHeld();
      const pending = journal();
      if (pending.phase !== "switched") fail("relocation is not switched");
      const current = rawLocator(control, workspace);
      if (current.generation !== pending.fromGeneration + 1 || current.stateRoot !== pending.destination.stateRoot || current.artifactRoot !== pending.destination.artifactRoot) fail("switched locator mismatch");
      unlinkSync(join(control, "journal.json")); syncDir(control);
    },
  };
  issuedLeases.add(exclusive);
  return exclusive;
}

export function assertInstallationLease(value: InstallationLease): void {
  if (!issuedLeases.has(value)) fail("unissued installation lease");
  value.assertHeld();
}
