import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { readdirSync } from "node:fs";
import { z } from "zod";
import type { Clock } from "../../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { BrowserRootSchema, BrowserRootsSchema, StoppedBrowserRootsV1Schema as PriorDocument } from "../browser-root-contract.js";
import { BrowserRootUnavailableError, assertPrivateProfilePath, profileReservations, type BrowserProfileProbeFactory } from "../browser-roots.js";
import { assertStoppedMachineMaintenance, type InstallationLease } from "../admission/installation.js";
import type { OfflineMaintenanceOperation } from "../admission/lifetime-lock.js";
import { fileIdentityObservation, fileStatus, sameDirectory } from "../file-identity.js";
import { noSymlinkAncestry, readPrivateFile, removeExactPath, type DirectoryIdentity } from "../configuration/credential-safe-file.js";
import { createPrivateDirectory, fsyncPath, movePrivateDirectoryExclusive, replacePrivateFile, writePrivateStage } from "../private-path.js";
import { hasUnprovedSourceClosure, retainAuthoritySourceClosure } from "../source-closure.js";
import { assertMaintenanceCustodyAvailable } from "./custody-availability.js";
import { proveProfileRootsUnused } from "./process-closure.js";
import { resolveConfigWithProvenance } from "../../app/config/resolve.js";

const Integer = z.number().int().safe().nonnegative();
const Identity = z.strictObject({ device: z.union([Integer, z.string().regex(/^(0|[1-9]\d*)$/u)]),
  inode: z.union([Integer, z.string().regex(/^(0|[1-9]\d*)$/u)]) });
const Digest = z.string().regex(/^[a-f0-9]{64}$/u);
const FileWitness = Identity.extend({ digest: Digest });
const Move = z.strictObject({ source: BrowserRootSchema.shape.directory, target: BrowserRootSchema.shape.directory, identity: Identity.nullable() });
const Common = z.strictObject({ schemaVersion: z.literal(1), operationId: z.uuid(), installationId: z.uuid(),
  prior: PriorDocument, current: BrowserRootsSchema, source: FileWitness, backup: FileWitness, moves: z.array(Move).max(64) });
const PreparedJournal = Common.extend({ phase: z.literal("prepared") });
const ReadyJournal = Common.extend({ phase: z.literal("ready"), stage: FileWitness });
const Journal = z.discriminatedUnion("phase", [Common.extend({ phase: z.literal("probing") }), PreparedJournal, ReadyJournal]);
type UpgradeJournal = z.infer<typeof Journal>;

const encode = (value: unknown): Buffer => Buffer.from(canonicalJsonStringify(value));
const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const same = (left: unknown, right: unknown): boolean => canonicalJsonStringify(left) === canonicalJsonStringify(right);
const refuse = (message: string): never => { throw new BrowserRootUnavailableError({ cause: new Error(`browser-root-upgrade-${message}`) }); };

function upgraded(prior: z.infer<typeof PriorDocument>) {
  return BrowserRootsSchema.parse({ schemaVersion: 2, installationId: prior.installationId, revision: prior.revision + 1,
    nextHandle: prior.roots.length + 1, nextGeneration: prior.nextGeneration,
    roots: prior.roots.map((row, index) => ({ ...row, handle: index + 1,
      directory: row.owner.kind === "signup" ? `${row.profileRoot}/r${(index + 1).toString(36)}` : row.directory })) });
}

export async function upgradeBrowserRoots(lease: InstallationLease, operation: OfflineMaintenanceOperation,
  createProbe: BrowserProfileProbeFactory, clock: Clock): Promise<"current" | "upgraded"> {
  const held = (): void => { assertStoppedMachineMaintenance(lease, operation); lease.lifetime.assertSourceCustody(); };
  held();
  const context = lease.readInstallationContext(), state = lease.locator.stateRoot;
  const control = join(context.workspace, ".tracker", "control"), machine = join(state, "machine");
  const path = join(machine, "browser-roots.json"), journalPath = join(control, "browser-root-upgrade.json");
  const ancestors = new Map<string, DirectoryIdentity>();
  const read = (name: string) => {
    held(); if (!noSymlinkAncestry(dirname(name), ancestors)) return undefined;
    return readPrivateFile(name, { label: "lock", maxBytes: 2 * 1024 * 1024 });
  };
  const required = (name: string) => read(name) ?? refuse("file-missing");
  const decode = (bytes: Buffer): unknown => JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
  const witness = (file: NonNullable<ReturnType<typeof read>>) => ({ ...fileIdentityObservation(file.identity), digest: hash(file.bytes) });
  const assertFile = (name: string, expected: z.infer<typeof FileWitness>) => {
    const file = required(name);
    if (!sameDirectory(file.identity, expected) || hash(file.bytes) !== expected.digest) refuse("file-substituted");
    return file;
  };
  const publish = (name: string, value: unknown): void => {
    const stage = `${name}.${randomUUID()}.tmp`, bytes = encode(value), before = read(name);
    writePrivateStage(stage, bytes); fsyncPath(dirname(name));
    const written = required(stage);
    if (!written.bytes.equals(bytes)) refuse("stage-changed");
    const current = read(name);
    if (before === undefined ? current !== undefined : current === undefined || !sameDirectory(before.identity, current.identity)
      || !before.bytes.equals(current.bytes)) refuse("publication-source-changed");
    replacePrivateFile(stage, name); fsyncPath(dirname(name));
    const observed = required(name);
    if (!sameDirectory(observed.identity, written.identity) || !observed.bytes.equals(bytes)) refuse("publication-unproved");
  };
  let source = read(path), pending = read(journalPath);
  if (source === undefined) {
    const marker = read(join(machine, "profile-registry-version.json"));
    if (pending !== undefined || marker !== undefined && z.object({ schemaVersion: z.number() }).parse(decode(marker.bytes)).schemaVersion === 8) refuse("source-missing");
    return "current";
  }
  const currentSource = BrowserRootsSchema.safeParse(decode(source.bytes));
  if (pending === undefined && currentSource.success) {
    if (currentSource.data.installationId !== lease.locator.installationId) refuse("installation-mismatch");
    return "current";
  }
  if (pending === undefined && PriorDocument.parse(decode(source.bytes)).installationId !== lease.locator.installationId) refuse("installation-mismatch");
  assertMaintenanceCustodyAvailable("layout-migration");
  for (const name of ["journal.json", "profile-publication.json", "profile-control-upgrade.json", "account-deletion.json", "fixed-layout.json"]) {
    if (read(join(control, name)) !== undefined) refuse("other-maintenance-pending");
  }
  const backupRoot = join(control, "browser-root-upgrades");
  const proveUnused = (roots: readonly string[]): void => {
    held();
    try { if (roots.length > 0) proveProfileRootsUnused(roots); }
    catch (error) {
      const failure = retainAuthoritySourceClosure([error], { admission: lease, restore: operation });
      lease.retainSourceClosure(failure); throw failure;
    }
  };
  let journal: UpgradeJournal;
  const rootPath = (relative: string) => join(state, ...relative.split("/"));
  const identityAt = (directory: string) => {
    assertPrivateProfilePath(state, directory);
    const value = fileStatus(directory, true);
    if (value === undefined) return undefined;
    if (!value.isDirectory()) refuse("directory-type");
    return fileIdentityObservation({ device: value.dev, inode: value.ino });
  };
  if (pending === undefined) {
    const prior = PriorDocument.parse(decode(source.bytes));
    if (prior.installationId !== lease.locator.installationId) refuse("installation-mismatch");
    const current = upgraded(prior), moves: z.infer<typeof Move>[] = [];
    for (const [index, row] of prior.roots.entries()) {
      const next = current.roots[index]; if (next === undefined) refuse("membership-changed");
      const identity = identityAt(rootPath(row.directory));
      if (identity === undefined && (row.launch.state !== "closed" || row.native !== undefined)) refuse("source-directory-missing");
      if (row.directory !== next.directory && identityAt(rootPath(next.directory)) !== undefined) refuse("target-exists");
      moves.push({ source: row.directory, target: next.directory, identity: identity ?? null });
    }
    const onboarding = rootPath("browsers/onboarding");
    if (identityAt(onboarding) !== undefined) {
      const names = new Set(prior.roots.filter(row => row.owner.kind === "signup").map(row => basename(row.directory)));
      if (readdirSync(onboarding).some(name => !names.has(name))) refuse("directory-membership-changed");
    }
    const parents = [...new Set(prior.roots.map(row => rootPath(row.profileRoot)))];
    proveUnused(parents);
    assertFile(path, witness(source));
    createPrivateDirectory(backupRoot, { recursive: true, mode: 0o700 });
    const operationId = randomUUID(), backupPath = join(backupRoot, `${operationId}.before.json`);
    writePrivateStage(backupPath, source.bytes); fsyncPath(backupRoot); fsyncPath(control);
    const backup = required(backupPath);
    if (!backup.bytes.equals(source.bytes)) refuse("backup-unproved");
    journal = Journal.parse({ schemaVersion: 1, phase: "probing", operationId, installationId: prior.installationId,
      prior, current, source: witness(source), backup: witness(backup), moves });
    publish(journalPath, journal);
  } else journal = Journal.parse(decode(pending.bytes));
  const validate = (): void => {
    held();
    if (journal.installationId !== lease.locator.installationId || journal.prior.installationId !== journal.installationId
      || !same(upgraded(journal.prior), journal.current)) refuse("journal-binding");
    const actual = Journal.parse(decode(required(journalPath).bytes));
    if (!same(actual, journal)) refuse("journal-changed");
    const backup = assertFile(join(backupRoot, `${journal.operationId}.before.json`), journal.backup);
    if (!same(PriorDocument.parse(decode(backup.bytes)), journal.prior) || hash(backup.bytes) !== journal.source.digest) refuse("backup-changed");
    const current = required(path);
    const prior = PriorDocument.safeParse(decode(current.bytes));
    if (prior.success && same(prior.data, journal.prior)) assertFile(path, journal.source);
    else if (journal.phase !== "ready" || !same(BrowserRootsSchema.parse(decode(current.bytes)), journal.current)
      || !sameDirectory(current.identity, journal.stage) || hash(current.bytes) !== journal.stage.digest) refuse("source-changed");
    if (journal.moves.length !== journal.prior.roots.length) refuse("move-membership");
    let unmoved = false;
    for (const [index, move] of journal.moves.entries()) {
      const row = journal.prior.roots[index];
      if (row === undefined || row.directory !== move.source || journal.current.roots[index]?.directory !== move.target) refuse("move-binding");
      const sourceIdentity = identityAt(rootPath(move.source)), targetIdentity = identityAt(rootPath(move.target));
      if (move.identity === null) {
        if (sourceIdentity !== undefined || targetIdentity !== undefined || row.launch.state !== "closed" || row.native !== undefined) refuse("absent-directory-changed");
        continue;
      }
      if (move.source === move.target) {
        if (sourceIdentity === undefined || !sameDirectory(sourceIdentity, move.identity)) refuse("directory-substituted");
        continue;
      }
      if (row.owner.kind !== "signup") refuse("move-binding");
      if (sourceIdentity !== undefined && sameDirectory(sourceIdentity, move.identity) && targetIdentity === undefined) unmoved = true;
      else if (journal.phase === "probing" || sourceIdentity !== undefined || targetIdentity === undefined || !sameDirectory(targetIdentity, move.identity) || unmoved) refuse("move-prefix-changed");
    }
    const parents = [...new Set(["browsers/onboarding", ...journal.prior.roots.filter(row => row.owner.kind === "signup").map(row => row.profileRoot)])];
    for (const parent of parents) {
      const directory = rootPath(parent);
      if (identityAt(directory) === undefined) continue;
      const names = new Set(journal.moves.filter(move => dirname(move.source) === parent)
        .flatMap(move => [basename(move.source), basename(move.target)]));
      if (readdirSync(directory).some(name => !names.has(name))) refuse("directory-membership-changed");
    }
  };
  try {
    validate();
    if (journal.phase === "probing") {
      const parents = [...new Set(journal.prior.roots.map(row => rootPath(row.profileRoot)))];
      proveUnused(parents);
      const config = resolveConfigWithProvenance({}, { primaryDisplay: null }, clock, { stateRoot: state, artifactRoot: lease.locator.artifactRoot }).config;
      const probe = createProbe({ clock, closeProofMs: config.browser.closeProofMs, launchTimeoutMs: config.timeouts.sessionAcquireMs, signal: new AbortController().signal });
      for (const move of journal.moves) {
        if (move.source === move.target || move.identity === null) continue;
        const directory = rootPath(move.source);
        if (profileReservations.has(directory)) refuse("profile-reserved");
        profileReservations.add(directory);
        try { await probe.probe(dirname(directory), directory); }
        catch (error) {
          const failure = retainAuthoritySourceClosure([error], { admission: lease, restore: operation });
          lease.retainSourceClosure(failure); throw failure;
        } finally { profileReservations.delete(directory); }
        validate();
        if (!sameDirectory(identityAt(directory) ?? refuse("source-directory-missing"), move.identity)) refuse("source-directory-substituted");
      }
      proveUnused(parents);
      journal = PreparedJournal.parse({ ...journal, phase: "prepared" });
      publish(journalPath, journal);
      validate();
    }
    for (const move of journal.moves) {
      if (move.source === move.target || move.identity === null) continue;
      validate();
      if (identityAt(rootPath(move.source)) === undefined) continue;
      proveUnused([rootPath(move.source), rootPath(move.target)]);
      validate();
      movePrivateDirectoryExclusive(rootPath(move.source), rootPath(move.target)); fsyncPath(dirname(rootPath(move.source)));
      validate();
    }
    const stagePath = join(machine, `.browser-roots.${journal.operationId}.compact.tmp`), bytes = encode(journal.current);
    if (journal.phase === "prepared") {
      let staged = read(stagePath);
      if (staged === undefined) { writePrivateStage(stagePath, bytes); fsyncPath(machine); staged = required(stagePath); }
      if (!staged.bytes.equals(bytes)) refuse("stage-changed");
      journal = ReadyJournal.parse({ ...journal, phase: "ready", stage: witness(staged) });
      publish(journalPath, journal);
    }
    validate();
    const parents = [...new Set(journal.current.roots.map(row => rootPath(row.profileRoot)))];
    proveUnused(parents);
    source = required(path);
    if (hash(source.bytes) === journal.source.digest) {
      assertFile(stagePath, journal.stage); assertFile(path, journal.source);
      replacePrivateFile(stagePath, path); fsyncPath(machine);
    }
    validate();
    proveUnused(parents);
    pending = required(journalPath);
    removeExactPath(journalPath, pending.identity, false, "browser-root-upgrade-journal-changed"); fsyncPath(control);
    return "upgraded";
  } catch (error) {
    if (hasUnprovedSourceClosure(error)) {
      lease.retainSourceClosure(error); throw retainAuthoritySourceClosure([error], { admission: lease, restore: operation });
    }
    try { validate(); }
    catch (cleanup) {
      const failure = retainAuthoritySourceClosure([error, cleanup], { admission: lease, restore: operation });
      lease.retainSourceClosure(failure); throw failure;
    }
    throw error;
  }
}
