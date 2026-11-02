import { BrowserRootOwnerSchema, BrowserRootSchema, BrowserRootsSchema, type BrowserRootOwner, type BrowserRoot, type BrowserRootsDocument } from "./browser-root-contract.js";
import { BrowserProfileStillClosingError } from "../../workflow-kit/session.js";
import type { ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { AbsolutePathSchema } from "../../models/config/schema.js";
import type { Clock } from "../../rules/time/clock.js";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { ERROR_CATALOG } from "../../models/failures/error-catalog.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { BrowserSystemIdSchema, PositiveIntSchema, type BrowserSystemId } from "../../rules/identity/ids.js";
import type { RuntimeAdmission } from "./admission/admission.js";
import { assertInstallationLease, inspectFlatOfflineRunMaintenance, requireStoppedControlProfileInventory, type StoppedControlProfileInventory } from "./admission/installation.js";
import { retainedBrowserProfiles, assertCredentialCopyResourcesClosed } from "./maintenance/profile-custody.js";
import type { ProfileBrowserClosure } from "./maintenance/profile-inventory.js";
import { proveProfileRootsUnused } from "./maintenance/process-closure.js";
import { resolveConfigWithProvenance } from "../app/config/resolve.js";
import { initialSettingsFileRecord } from "../../models/config/settings.js";
import { requireRuntimeAdmission } from "./admission/admission-identity.js";
import { RuntimeLifetimeLock } from "./admission/lifetime-lock.js";
import { AuthorityDatabase } from "./sqlite/authority-database.js";
import { noSymlinkAncestry, readPrivateFile, withPrivateFileLock, type DirectoryIdentity } from "./configuration/credential-safe-file.js";
import { fsyncPath, privatePathRejects, replacePrivateFile, writePrivateStage } from "./private-path.js";
import { hasUnprovedSourceClosure, retainAuthoritySourceClosure, retainUnprovedSourceOwners } from "./source-closure.js";

export const PROFILE_CUSTODY_UNAVAILABLE_TEXT = "Browser profile custody is unavailable. The browser cannot open until its current profile revision is admitted.";
export class ProfileCustodyUnavailableError extends Error {
  readonly code = "browser-profile-custody-unavailable";
  constructor() { super(PROFILE_CUSTODY_UNAVAILABLE_TEXT); this.name = "ProfileCustodyUnavailableError"; }
}

export function workerProfileDirectory(input: Readonly<{ profileRoot: string; slotOrdinal: number; system: BrowserSystemId }>): string {
  return resolve(AbsolutePathSchema.parse(input.profileRoot), `w${String(PositiveIntSchema.parse(input.slotOrdinal))}`, BrowserSystemIdSchema.parse(input.system));
}

export function onboardingProfileDirectory(profileRoot: string, owner: Readonly<{
  operationId: string; profileId: string; accountId: string; generation: number;
}>): string {
  const operationId=z.uuid().parse(owner.operationId),profileId=z.uuid().parse(owner.profileId),accountId=z.uuid().parse(owner.accountId);
  const generation=PositiveIntSchema.parse(owner.generation);
  return resolve(AbsolutePathSchema.parse(profileRoot),`onboarding-${operationId}-${profileId}-${accountId}-g${String(generation)}`);
}

async function runNativeBrowserProbe(profileRoot: string, profileDirectory: string, probe: BrowserProfileProbeOptions): Promise<void> {
  probe.signal.throwIfAborted();
  const root = AbsolutePathSchema.parse(profileRoot), directory = AbsolutePathSchema.parse(profileDirectory);
  assertPrivateProfilePath(root, directory);
  for (const path of [root, directory]) {
    const info = lstatSync(path, { throwIfNoEntry: false });
    if (info === undefined || !info.isDirectory()) throw new ProfileCustodyUnavailableError();
  }
  if (!profileReservations.has(directory)) throw new ProfileCustodyUnavailableError();
  await probe.probe(root, directory);
}

export const profileReservations = new Set<string>();

export function assertPrivateProfilePath(root: string, path: string): void {
  if (!path.startsWith(`${root}${sep}`)) throw new ProfileCustodyUnavailableError();
  for (let cursor = path; cursor !== dirname(cursor); cursor = dirname(cursor)) {
    const metadata = lstatSync(cursor, { throwIfNoEntry: false });
    if (metadata !== undefined && (!metadata.isDirectory() || metadata.isSymbolicLink()
      || privatePathRejects(cursor, metadata, "private"))) throw new ProfileCustodyUnavailableError();
    if (cursor === root) return;
  }
  throw new ProfileCustodyUnavailableError();
}


export interface BrowserProfileProbeOptions {
  readonly signal: AbortSignal;
  probe(profileRoot: string, profileDirectory: string): Promise<void>;
}
export type BrowserProfileProbeFactory = (input: Readonly<{
  clock: Clock; closeProofMs: number; launchTimeoutMs: number; signal: AbortSignal;
}>) => BrowserProfileProbeOptions;

const Generation = BrowserRootsSchema.shape.nextGeneration;
const RelativePath = BrowserRootSchema.shape.directory;
const [WorkerOwner, SignupOwner] = BrowserRootOwnerSchema.options;
const Launch = BrowserRootSchema.shape.launch;
export type BrowserLaunchOwner = Readonly<{ kind: "worker"; database: AuthorityDatabase; workerId: string; stoppedProcess?: ChildProcess }>
  | Readonly<z.infer<typeof SignupOwner>>;
export interface BrowserRootLaunchInput {
  readonly profileId: string;
  readonly profileRoot: string;
  readonly profileDirectory: string;
  readonly owner: BrowserLaunchOwner;
  readonly credentialFingerprint: string | null;
}
export class BrowserRootUnavailableError extends Error {
  readonly code = "BROWSER_ROOT_UNAVAILABLE";
  constructor(options?: ErrorOptions) { super(ERROR_CATALOG.BROWSER_ROOT_UNAVAILABLE.text, options); this.name = "BrowserRootUnavailableError"; }
}
const encode = (value: unknown) => Buffer.from(canonicalJsonStringify(value));
const digest = (value: unknown) => createHash("sha256").update(encode(value)).digest("hex");
const same = (left: unknown, right: unknown) => canonicalJsonStringify(left) === canonicalJsonStringify(right);
function increment(value: number): number {
  return Generation.parse(value + 1);
}

export function createBrowserRoots(input: RuntimeAdmission) {
  const admission = requireRuntimeAdmission(input), binding = admission.captureBrowserRegistryContext(), lifetime = admission.lifetime;
  const directory = join(binding.machineRoot, "machine"), path = join(directory, "browser-roots.json");
  const ancestry = new Map<string, DirectoryIdentity>();
  const stages = new Set<string>();
  function assertHeld(): void { admission.assertBrowserRegistryCustody(); lifetime.assertSourceCustody(); }
  function retain(error: unknown): never {
    if (hasUnprovedSourceClosure(error)) {
      admission.retainSourceClosure(error); lifetime.retainSourceClosure(error);
      retainUnprovedSourceOwners(error, { admission, directory: { path, lifetime } });
    }
    throw error instanceof BrowserRootUnavailableError ? error : new BrowserRootUnavailableError({ cause: error });
  }
  function read(): BrowserRootsDocument {
    try {
    assertHeld();
    if (!noSymlinkAncestry(directory, ancestry)) throw new BrowserRootUnavailableError();
    if (readdirSync(directory).some(name => name.startsWith(".browser-roots.") && name !== ".browser-roots.lock"
      && !stages.has(join(directory, name)))) throw new BrowserRootUnavailableError();
    const file = readPrivateFile(path, { label: "lock", maxBytes: 1_048_576 });
    if (file === undefined) throw new BrowserRootUnavailableError();
    const document = BrowserRootsSchema.parse(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(file.bytes)));
    if (document.installationId !== binding.installationId) throw new BrowserRootUnavailableError();
    return document;
    } catch (error) { return retain(error); }
  }
  function mutate<T>(body: (document: BrowserRootsDocument) => Readonly<{ document: BrowserRootsDocument; result: T }>,
    guard: () => void = assertHeld): T {
    let publicationStarted = false;
    try { return withPrivateFileLock(directory, ".browser-roots.lock", () => {
      const prior = read(), outcome = body(prior), next = BrowserRootsSchema.parse({ ...outcome.document, revision: increment(prior.revision) });
      if (next.installationId !== prior.installationId) throw new BrowserRootUnavailableError();
      const stage = join(directory, `.browser-roots.${randomUUID()}.tmp`), bytes = encode(next);
      guard(); publicationStarted = true; writePrivateStage(stage, bytes); stages.add(stage); fsyncPath(directory);
      const current = read();
      if (!same(current, prior)) throw new BrowserRootUnavailableError();
      guard(); replacePrivateFile(stage, path); stages.delete(stage); fsyncPath(directory);
      if (!same(read(), next)) throw new BrowserRootUnavailableError();
      return outcome.result;
    }); } catch (error) {
      if (publicationStarted) retain(retainAuthoritySourceClosure([error], { admission, directory: { path, stages, lifetime } }));
      retain(error);
    }
  }
  function relativeDirectory(value: string): string {
    if (!isAbsolute(value) || resolve(value) !== value) throw new BrowserRootUnavailableError();
    return RelativePath.parse(relative(binding.machineRoot, value).split(sep).join("/"));
  }
  function ownerOf(owner: BrowserLaunchOwner, profileId: string, profileDirectory: string, cleanup = false): BrowserRootOwner {
    if (owner.kind === "worker") {
      admission.assertBrowserRegistryLaunch(profileId);
      if (owner.stoppedProcess !== undefined && !cleanup) throw new BrowserRootUnavailableError();
      return WorkerOwner.parse(AuthorityDatabase.prototype.browserWorkerOwner.call(owner.database, admission, owner.workerId, profileDirectory, owner.stoppedProcess));
    }
    const parsed = SignupOwner.parse(owner);
    if (cleanup) admission.assertBrowserRegistryCleanup(profileId, parsed);
    else admission.assertBrowserRegistryLaunch(profileId, parsed);
    return parsed;
  }
  function current(input: BrowserRootLaunchInput, cleanup = false): BrowserRootOwner {
    const owner = ownerOf(input.owner, input.profileId, input.profileDirectory, cleanup), captured = admission.captureBrowserRegistryContext();
    if (!(cleanup && owner.kind === "signup") && !same(captured, binding)) throw new BrowserRootUnavailableError();
    return owner;
  }
  function assertRow(document: BrowserRootsDocument, expected: BrowserRoot): BrowserRoot {
    const row = document.roots.find(row => row.directory === expected.directory);
    if (row === undefined || !same(row, expected)) throw new BrowserRootUnavailableError();
    return row;
  }
  function replaceRow(document: BrowserRootsDocument, before: BrowserRoot, after: BrowserRoot) {
    assertRow(document, before);
    return { ...document, roots: document.roots.map(row => row.directory === before.directory ? after : row) };
  }
  function beginLaunch(input: BrowserRootLaunchInput) {
    const owner = current(input), profileRoot = relativeDirectory(input.profileRoot), root = relativeDirectory(input.profileDirectory);
    const assertCurrent = () => { if (!same(current(input), owner)) throw new BrowserRootUnavailableError(); };
    let captured = mutate(document => {
      assertCurrent();
      const prior = document.roots.find(row => row.directory === root);
      if (prior !== undefined && (prior.native !== undefined || prior.launch.state !== "closed" || prior.profileId !== input.profileId
        || !same(prior.owner, owner) || prior.profileRoot !== profileRoot || prior.credentialFingerprint !== null && prior.credentialFingerprint !== input.credentialFingerprint)) throw new BrowserRootUnavailableError();
      if (prior === undefined && lstatSync(input.profileDirectory, { throwIfNoEntry: false }) !== undefined) throw new BrowserRootUnavailableError();
      const row = BrowserRootSchema.parse({ profileId: input.profileId, profileRoot, directory: root, owner,
        sessionGeneration: binding.sessionGeneration, credentialFingerprint: input.credentialFingerprint,
        launch: { launchId: randomUUID(), generation: document.nextGeneration, state: "launching" } });
      return { document: { ...document, nextGeneration: increment(document.nextGeneration), roots: prior === undefined
        ? [...document.roots, row] : document.roots.map(entry => entry === prior ? row : entry) }, result: row };
    }, assertCurrent);
    function transition(state: BrowserRoot["launch"]["state"], requireCurrent: boolean): void {
      if (requireCurrent) assertCurrent(); else assertHeld();
      captured = mutate(document => {
        assertRow(document, captured);
        if (captured.native !== undefined || captured.launch.state === "unknown" || captured.launch.state === "closed") throw new BrowserRootUnavailableError();
        const row = BrowserRootSchema.parse({ ...captured, launch: { ...captured.launch, state } });
        return { document: replaceRow(document, captured, row), result: row };
      }, () => { if (requireCurrent) assertCurrent(); else assertHeld(); });
    }
    return Object.freeze({ launchId: captured.launch.launchId, generation: captured.launch.generation,
      opened() { transition("open", true); }, closing() { transition("closing", false); }, closed() { transition("closed", false); },
      uncertain(error: unknown): never {
        try { transition("unknown", false); }
        catch (publication) {
          const failure = retainAuthoritySourceClosure([error, publication], { admission, directory: { path, captured, lifetime } });
          admission.retainSourceClosure(failure); lifetime.retainSourceClosure(failure); throw failure;
        }
        const failure = retainAuthoritySourceClosure([error], { admission, directory: { path, captured, lifetime } });
        admission.retainSourceClosure(failure); lifetime.retainSourceClosure(failure); throw failure;
      } });
  }
  async function withUnused<T>(profileDirectory: string, probe: BrowserProfileProbeOptions, body: (unused: Readonly<{ remove(): void; assertCurrent(): void }>) => Promise<T>, owner?: BrowserRootLaunchInput): Promise<T> {
    assertHeld();
    if (profileReservations.has(profileDirectory)) throw new ProfileCustodyUnavailableError();
    profileReservations.add(profileDirectory);
    try { return await withUnusedExclusive(profileDirectory, probe, body, owner); }
    finally { profileReservations.delete(profileDirectory); }
  }
  async function withUnusedExclusive<T>(profileDirectory: string, probe: BrowserProfileProbeOptions, body: (unused: Readonly<{ remove(): void; assertCurrent(): void }>) => Promise<T>, owner?: BrowserRootLaunchInput): Promise<T> {
    const root = relativeDirectory(profileDirectory), operation = owner === undefined ? admission.assertBrowserRegistryMaintenance() : undefined;
    const expectedOwner = owner === undefined ? undefined : current(owner, true);
    const stoppedProcess = owner?.owner.kind === "worker" ? owner.owner.stoppedProcess : undefined;
    const assertStoppedRecovery = () => {
      if (stoppedProcess === undefined) throw new BrowserRootUnavailableError();
      const context = admission.readInstallationContext();
      if (context === undefined || !(lifetime instanceof RuntimeLifetimeLock)) throw new BrowserRootUnavailableError();
      lifetime.assertExclusiveWorkspace(context.workspace); lifetime.assertOwnedChildClosed(stoppedProcess);
    };
    const signupOperation = owner?.owner.kind === "signup" ? admission.assertBrowserRegistryCleanup(owner.profileId, owner.owner) : undefined;
    let stoppedRecoveryRequired = false;
    const assertOwner = () => { if (stoppedRecoveryRequired) assertStoppedRecovery(); if (owner === undefined) { if (admission.assertBrowserRegistryMaintenance() !== operation) throw new BrowserRootUnavailableError(); }
      else if (!same(current(owner, true), expectedOwner)
        || owner.owner.kind === "signup" && admission.assertBrowserRegistryCleanup(owner.profileId, owner.owner) !== signupOperation) throw new BrowserRootUnavailableError(); assertHeld(); };
    assertOwner();
    let captured = mutate(document => {
      assertOwner();
      const prior = document.roots.find(row => row.directory === root);
      if (prior === undefined || owner !== undefined && (prior.native !== undefined && stoppedProcess === undefined && expectedOwner?.kind !== "signup" || prior.profileId !== owner.profileId)) throw new BrowserRootUnavailableError();
      if (expectedOwner !== undefined && !same(prior.owner, expectedOwner)) {
        if (prior.owner.kind !== "worker" || expectedOwner.kind !== "worker" || prior.owner.workerId !== expectedOwner.workerId
          || prior.owner.workflowId !== expectedOwner.workflowId || prior.owner.ordinal !== expectedOwner.ordinal
          || prior.owner.membershipRevision > expectedOwner.membershipRevision || prior.owner.leaseGeneration >= expectedOwner.leaseGeneration
          || prior.launch.state !== "closed") throw new BrowserRootUnavailableError();
      } else if (owner !== undefined && expectedOwner?.kind !== "signup" && prior.launch.state !== "closed") {
        stoppedRecoveryRequired = true; assertStoppedRecovery();
      }
      if (prior.native !== undefined && stoppedProcess !== undefined) { stoppedRecoveryRequired = true; assertStoppedRecovery(); }
      const source = lstatSync(profileDirectory, { throwIfNoEntry: false });
      if (source === undefined || !source.isDirectory() || source.isSymbolicLink() || privatePathRejects(profileDirectory, source, "private")
        || prior.native !== undefined && (prior.native.source.device !== source.dev || prior.native.source.inode !== source.ino)) throw new BrowserRootUnavailableError();
      const row = BrowserRootSchema.parse({ ...prior, native: { operationId: operation?.operationId ?? randomUUID(),
        launchId: randomUUID(), generation: document.nextGeneration, source: { device: source.dev, inode: source.ino },
        priorLaunchDigest: digest(prior.launch), phase: "probing" } });
      return { document: { ...replaceRow(document, prior, row), nextGeneration: increment(document.nextGeneration) }, result: row };
    }, assertOwner);
    let removed = false;
    function assertExcluded(): void {
      assertOwner(); assertRow(read(), captured);
      const source = lstatSync(profileDirectory, { throwIfNoEntry: false });
      if (removed ? source !== undefined : source === undefined || captured.native === undefined
        || source.dev !== captured.native.source.device || source.ino !== captured.native.source.inode) throw new BrowserRootUnavailableError();
    }
    try {
      assertExcluded();
      await runNativeBrowserProbe(join(binding.machineRoot, captured.profileRoot), profileDirectory, probe);
      assertExcluded();
      captured = mutate(document => {
        assertExcluded();
        const row = BrowserRootSchema.parse({ ...captured, native: { ...captured.native, phase: "observed" } });
        return { document: replaceRow(document, captured, row), result: row };
      }, assertOwner);
      assertExcluded();
      let bodyActive = true, result: T;
      try { result = await body(Object.freeze({ assertCurrent: assertOwner, remove() {
        if (!bodyActive) throw new BrowserRootUnavailableError();
        assertExcluded();
        if (captured.native?.phase !== "observed" || removed) throw new BrowserRootUnavailableError();
        captured = mutate(document => {
          assertExcluded();
          const row = BrowserRootSchema.parse({ ...captured, native: { ...captured.native, phase: "deleting" } });
          return { document: replaceRow(document, captured, row), result: row };
        }, assertOwner);
        const verify = (path: string): void => {
          const file = lstatSync(path);
          if (file.isSymbolicLink() || privatePathRejects(path, file, "group-write")
            || !(file.isDirectory() || file.isFile()) || file.isFile() && file.nlink !== 1) throw new BrowserRootUnavailableError();
          if (file.isDirectory()) for (const name of readdirSync(path)) verify(join(path, name));
        };
        verify(profileDirectory); assertExcluded(); rmSync(profileDirectory, { recursive: true });
        if (lstatSync(profileDirectory, { throwIfNoEntry: false }) !== undefined) throw new BrowserRootUnavailableError();
        fsyncPath(join(binding.machineRoot, captured.profileRoot)); removed = true;
      } })); } finally { bodyActive = false; }
      assertExcluded();
      mutate(document => {
        assertExcluded();
        if (removed) {
          return { document: { ...document, roots: document.roots.filter(row => row.directory !== root) }, result: undefined };
        }
        const { native: _native, ...prior } = captured;
        if (owner !== undefined && expectedOwner !== undefined && (prior.owner.kind === "worker" && expectedOwner.kind === "worker"
          && prior.owner.membershipRevision !== expectedOwner.membershipRevision
          || owner.credentialFingerprint !== null && owner.credentialFingerprint !== prior.credentialFingerprint)) throw new BrowserRootUnavailableError();
        const row = BrowserRootSchema.parse({ ...prior, launch: { ...prior.launch, state: "closed" } });
        if (expectedOwner !== undefined) { row.owner = expectedOwner; row.sessionGeneration = binding.sessionGeneration; }
        return { document: replaceRow(document, captured, row), result: undefined };
      }, assertOwner);
      return result;
    } catch (error) {
      if (error instanceof BrowserProfileStillClosingError) throw error;
      const failure = hasUnprovedSourceClosure(error) ? error : retainAuthoritySourceClosure([error], { admission, directory: { path, captured, lifetime } });
      admission.retainSourceClosure(failure); lifetime.retainSourceClosure(failure);
      retainUnprovedSourceOwners(failure, { admission, directory: { path, captured, lifetime } });
      throw failure;
    }
  }
  async function probe(input: BrowserRootLaunchInput, options: BrowserProfileProbeOptions): Promise<void> {
    current(input);
    const known = read().roots.find(row => row.directory === relativeDirectory(input.profileDirectory));
    if (known !== undefined) {
      await withUnused(input.profileDirectory, options, async () => undefined, input);
      return;
    }
    if (profileReservations.has(input.profileDirectory)) throw new ProfileCustodyUnavailableError();
    const launch = beginLaunch(input);
    profileReservations.add(input.profileDirectory);
    try {
      current(input);
      assertPrivateProfilePath(input.profileRoot, input.profileDirectory);
      mkdirSync(input.profileDirectory, { recursive: true, mode: 0o700 });
      await runNativeBrowserProbe(input.profileRoot, input.profileDirectory, options);
      current(input); launch.closing(); launch.closed();
    } catch (error) { launch.uncertain(error); }
    finally { profileReservations.delete(input.profileDirectory); }
  }
  return Object.freeze({
    inventory() { assertHeld(); return deepFreeze(read()); }, beginLaunch, withUnused, probe,
  });
}
export type BrowserRoots = ReturnType<typeof createBrowserRoots>;
export type BrowserRootLaunch = ReturnType<BrowserRoots["beginLaunch"]>;


export function planStoppedBrowserRoots(admission: RuntimeAdmission, claim: StoppedControlProfileInventory, nextGeneration: number, clock: Clock): BrowserRootsDocument {
  const source = admission.readStoppedControlCredentialInventorySource(claim);
  if (source !== requireStoppedControlProfileInventory(claim)) throw new BrowserRootUnavailableError();
  source.assertHeld(); source.lifetime.assertSourceCustody();
  const custody = AuthorityDatabase.readProfileMaintenanceInventory(admission);
  assertCredentialCopyResourcesClosed(custody);
  const settings = custody.settingsAuthority.state === "never-initialized" ? initialSettingsFileRecord().settings
    : custody.settingsAuthority.record.saved?.settings ?? custody.settingsAuthority.record.initialization.settings.settings;
  const config = resolveConfigWithProvenance(settings, { primaryDisplay: null }, clock,
    { stateRoot: source.stateRoot, artifactRoot: source.artifactRoot }).config;
  const retained = retainedBrowserProfiles(source.stateRoot, custody, config.paths.browserProfileRoot, { workerDirectory: workerProfileDirectory });
  const roots: BrowserRoot[] = [];
  const relativePath = (path: string) => RelativePath.parse(relative(source.machineRoot, path).split(sep).join("/"));
  const bases = new Set([config.paths.browserProfileRoot, ...custody.configSnapshots.map(snapshot => snapshot.config.paths.browserProfileRoot)
    .filter(path => path.startsWith(`${source.stateRoot}${sep}`)), ...retained.map(row => row.profileRoot)]);
  for (const base of bases) {
    assertPrivateProfilePath(source.stateRoot, base);
    if (lstatSync(base, { throwIfNoEntry: false }) === undefined) continue;
    for (const worker of readdirSync(base)) {
      if (!/^w[1-9]\d*$/u.test(worker)) throw new BrowserRootUnavailableError();
      const workerPath = join(base, worker); assertPrivateProfilePath(base, workerPath);
      for (const system of readdirSync(workerPath)) if (!retained.some(row => row.profileDirectory === join(workerPath, system))) throw new BrowserRootUnavailableError();
    }
  }
  for (const profile of retained) {
    assertPrivateProfilePath(profile.profileRoot, profile.profileDirectory);
    const file = lstatSync(profile.profileDirectory, { throwIfNoEntry: false });
    if (file === undefined) { if (!profile.cleanupCompleted) throw new BrowserRootUnavailableError(); continue; }
    if (!file.isDirectory() || file.isSymbolicLink() || privatePathRejects(profile.profileDirectory, file, "private")) throw new BrowserRootUnavailableError();
    const browser = custody.browsers.find(row => row.profileDirectory === profile.profileDirectory), slot = custody.slots.find(row => row.workerId === browser?.workerId);
    const lease = custody.leases.find(row => row.workerId === slot?.workerId);
    if (browser === undefined || slot === undefined || lease === undefined || browser.health !== "closed" || lease.lifecycle.state !== "stopped") throw new BrowserRootUnavailableError();
    const launch = Launch.parse({ launchId: randomUUID(), generation: nextGeneration++, state: "unknown" });
    const row = BrowserRootSchema.parse({ profileId: source.binding.profileId, profileRoot: relativePath(profile.profileRoot), directory: relativePath(profile.profileDirectory),
      owner: { kind: "worker", workerId: slot.workerId, workflowId: slot.workflow, ordinal: slot.ordinal, membershipRevision: slot.membershipRevision, leaseGeneration: lease.leaseGeneration },
      sessionGeneration: source.sessionGeneration, credentialFingerprint: browser.signInFingerprint, launch,
      native: { operationId: source.conversionOperationId, launchId: randomUUID(), generation: nextGeneration++,
        source: { device: file.dev, inode: file.ino }, priorLaunchDigest: digest(launch), phase: "probing" } });
    roots.push(row);
  }
  source.revalidateSource(); source.assertHeld();
  return BrowserRootsSchema.parse({ schemaVersion: 1, installationId: source.binding.installationId, revision: 0, nextGeneration, roots });
}

export async function probeStoppedControlBrowserRoots(admission: RuntimeAdmission, claim: StoppedControlProfileInventory, options: BrowserProfileProbeOptions): Promise<void> {
  const source = admission.readStoppedControlCredentialInventorySource(claim);
  if (source !== requireStoppedControlProfileInventory(claim)) throw new BrowserRootUnavailableError();
  const current = () => { source.assertHeld(); source.revalidateSource(); source.lifetime.assertSourceCustody(); };
  try {
    current();
    const initial = source.browserPlan();
    if (initial === undefined) throw new BrowserRootUnavailableError();
    const directories = initial.roots.filter(row => row.profileId === source.binding.profileId).map(row => row.directory);
    for (const directory of directories) {
      current();
      let plan = source.browserPlan();
      if (plan === undefined) throw new BrowserRootUnavailableError();
      const row = plan.roots.find(row => row.directory === directory);
      if (row?.native === undefined || row.profileId !== source.binding.profileId || row.native.operationId !== source.conversionOperationId) throw new BrowserRootUnavailableError();
      const path = join(source.machineRoot, directory), before = lstatSync(path);
      if (before.dev !== row.native.source.device || before.ino !== row.native.source.inode || !before.isDirectory() || before.isSymbolicLink()) throw new BrowserRootUnavailableError();
      if (profileReservations.has(path)) throw new ProfileCustodyUnavailableError();
      profileReservations.add(path);
      try {
        const probing = BrowserRootSchema.parse({ ...row, native: { ...row.native, phase: "probing" } });
        const intended = BrowserRootsSchema.parse({ ...plan, revision: increment(plan.revision), roots: plan.roots.map(value => value.directory === directory ? probing : value) });
        source.publishBrowserPlan(plan, intended); plan = intended;
        current();
        await runNativeBrowserProbe(join(source.machineRoot, row.profileRoot), path, options);
        current(); const after = lstatSync(path);
        if (after.dev !== before.dev || after.ino !== before.ino) throw new BrowserRootUnavailableError();
        const observed = BrowserRootSchema.parse({ ...probing, launch: { ...probing.launch, state: "closed" }, native: { ...probing.native, phase: "observed" } });
        source.publishBrowserPlan(plan, BrowserRootsSchema.parse({ ...plan, revision: increment(plan.revision), roots: plan.roots.map(value => value.directory === directory ? observed : value) }));
      } finally { profileReservations.delete(path); }
    }
    current();
  } catch (error) {
    if (hasUnprovedSourceClosure(error)) { admission.retainSourceClosure(error); source.retainSourceClosure(error); source.lifetime.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission, directory: { source } }); }
    throw error;
  }
}

export function createProfileBrowserClosure(createProbe: BrowserProfileProbeFactory): ProfileBrowserClosure {
  return {
    workerDirectory: workerProfileDirectory,
    async probeClosed(profiles, timing, clock, signal, owner, operation) {
      const options = createProbe({ ...timing, clock, signal });
      if ("assertLive" in owner && !owner.isFlatBackup()) {
        const admission = requireRuntimeAdmission(owner), roots = createBrowserRoots(admission);
        for (const profile of profiles) {
          const present = lstatSync(profile.profileDirectory, { throwIfNoEntry: false });
          if (present === undefined) { if (!profile.cleanupCompleted) throw new BrowserRootUnavailableError(); continue; }
          await roots.withUnused(profile.profileDirectory, options, async () => undefined);
        }
        return;
      }
      const admission = "assertLive" in owner ? requireRuntimeAdmission(owner) : undefined;
      const lease = "assertLive" in owner ? undefined : owner;
      if (lease !== undefined) assertInstallationLease(lease);
      const heldOperation = admission === undefined ? operation : admission.maintenanceOperation();
      if (heldOperation === undefined) throw new BrowserRootUnavailableError();
      const held = () => {
        if (admission !== undefined) { admission.assertOfflineMaintenance(heldOperation); if (!admission.isFlatBackup()) throw new BrowserRootUnavailableError(); }
        else { if (lease === undefined) throw new BrowserRootUnavailableError(); assertInstallationLease(lease); lease.assertOfflineMaintenance(heldOperation); }
      };
      held();
      const context = owner.readInstallationContext();
      if (context === undefined) throw new BrowserRootUnavailableError();
      const root = admission?.stateRoot ?? inspectFlatOfflineRunMaintenance(context.workspace).roots[0]?.path;
      if (root === undefined) throw new BrowserRootUnavailableError();
      const { flatBackupBrowserCensus } = await import("./maintenance/profile-inventory.js");
      const capture = () => {
        held();
        const census = flatBackupBrowserCensus(root, heldOperation, clock, admission?.flatBackupTiming());
        if (profiles.some(profile => !census.profiles.some(row => same(row, profile))) || census.profiles.length !== profiles.length) throw new BrowserRootUnavailableError();
        return census.identity;
      };
      const before = capture();
      proveProfileRootsUnused([root]);
      for (const profile of profiles) {
        assertPrivateProfilePath(root, profile.profileDirectory);
        if (profile.profileRoot !== join(root, "browsers")) throw new BrowserRootUnavailableError();
        if (lstatSync(profile.profileDirectory, { throwIfNoEntry: false }) === undefined) { if (!profile.cleanupCompleted) throw new BrowserRootUnavailableError(); continue; }
        if (profileReservations.has(profile.profileDirectory)) throw new ProfileCustodyUnavailableError();
        profileReservations.add(profile.profileDirectory);
        try { await runNativeBrowserProbe(profile.profileRoot, profile.profileDirectory, options); }
        catch (error) {
          if (hasUnprovedSourceClosure(error)) { owner.retainSourceClosure(error); owner.lifetime.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission: owner, restore: heldOperation }); }
          throw error;
        } finally { profileReservations.delete(profile.profileDirectory); }
      }
      held(); proveProfileRootsUnused([root]);
      if (capture() !== before) throw new BrowserRootUnavailableError();
    },
  };
}
