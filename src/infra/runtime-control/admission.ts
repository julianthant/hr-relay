import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { acquireInstallation, assertInstallationLease, type ExistingAuthorityEvidence, type InstallationLease,
  type ExclusiveInstallationLease, type FreshInitializationWitness, type RelocationCompletionReceipt, type RelocationInventory,
  type RelocationPlanBinding, type RelocationPreparationVerifier, type RelocationVerifier, type RuntimeLocator, type RuntimePair } from "./installation.js";
import { rebuildRuntimeIsolation } from "../../config/runtime-isolation.js";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import type { RestoreAdmissionHandle } from "../sqlite/runtime-process-locks.js";

const issued = new WeakSet<RuntimeAdmission>();
const issuanceToken = Symbol("runtime-admission-issuance");

function within(parent: string, child: string): boolean {
  const part = relative(parent, child);
  return part === "" || (part !== ".." && !part.startsWith("../") && !part.startsWith("..\\") && !isAbsolute(part));
}

function assertSyntheticDirectory(path: string): void {
  if (!isAbsolute(path) || resolve(path) !== path) throw new Error("runtime-admission: fixture path must be absolute");
  const temp = [resolve(tmpdir()), realpathSync(tmpdir())].find((candidate) => within(candidate, path) && path !== candidate);
  if (temp === undefined) throw new Error("runtime-admission: fixture must be beneath system temp");
  let ancestor = path;
  while (ancestor !== temp) {
    const info = lstatSync(ancestor, { throwIfNoEntry: false });
    if (info !== undefined && (!info.isDirectory() || info.isSymbolicLink()
      || (process.getuid && info.uid !== process.getuid()) || (info.mode & 0o022) !== 0)) {
      throw new Error("runtime-admission: unsafe synthetic fixture ancestor");
    }
    if (lstatSync(join(ancestor, ".runtime-control"), { throwIfNoEntry: false }) !== undefined
      || lstatSync(join(ancestor, ".runtime-owner.json"), { throwIfNoEntry: false }) !== undefined
      || lstatSync(join(ancestor, ".runtime-source-fence.json"), { throwIfNoEntry: false }) !== undefined) {
      throw new Error("runtime-admission: fixture overlaps installation witness");
    }
    ancestor = dirname(ancestor);
  }
}

function assertActiveRootSafe(path: string): void {
  let component = parse(path).root;
  for (const part of relative(component, path).split(/[\\/]/u)) {
    if (part === "") continue;
    component = join(component, part);
    const info = lstatSync(component);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("runtime-admission: storage root path changed shape");
  }
  const root = lstatSync(path);
  if ((process.getuid && root.uid !== process.getuid()) || (root.mode & 0o022) !== 0) {
    throw new Error("runtime-admission: storage root ownership changed");
  }
}

type AdmissionAuthority = Readonly<{
  assertHeld(): void;
  readRelocationReceipts?(): readonly RelocationCompletionReceipt[];
  release(): void;
}>;

export type RuntimeRelocationOperation = Readonly<{
  operationId: string;
  inventory(): RelocationInventory;
  readPriorReceipts(): readonly RelocationCompletionReceipt[];
  destinationAdmission(): RuntimeAdmission;
  sourceVerificationAdmission(): RuntimeAdmission;
  recordVerifiedPreparation(verify: RelocationPreparationVerifier): void;
  recordVerifiedStage(verify: RelocationVerifier): void;
  fenceRelocationSource(): void;
  retainRelocationSources(): void;
  switchRelocationLocator(verify: RelocationVerifier): RuntimeLocator;
  settleRelocation(verify: RelocationVerifier): void;
}>;

type AdmissionScope = "installation" | "adoption-inspection" | "stopped-staged" | "synthetic-stopped-staged"
  | "verified-copy" | "synthetic-verified-copy" | "synthetic" | "relocation-destination" | "relocation-source-verification"
  | "adoption-initialization";

/** A lifetime-bound, path-specific authority to open this installation's physical storage. */
export class RuntimeAdmission {
  readonly #authority: AdmissionAuthority;
  readonly #stateRoot: string;
  readonly #artifactRoot: string;
  readonly #authorityDatabasePaths: ReadonlySet<string>;
  readonly #archiveDatabasePaths: ReadonlySet<string>;
  readonly #locator: RuntimeLocator | undefined;
  readonly #scope: AdmissionScope;
  readonly #mode: "shared" | "exclusive" | "synthetic";
  #released = false;

  private constructor(token: typeof issuanceToken, authority: AdmissionAuthority, stateRoot: string, artifactRoot: string,
    authorityDatabasePaths: readonly string[], archiveDatabasePaths: readonly string[],
    scope: AdmissionScope,
    mode: "shared" | "exclusive" | "synthetic", locator?: RuntimeLocator) {
    if (token !== issuanceToken) throw new Error("runtime-admission: unissued capability");
    this.#authority = authority;
    this.#stateRoot = stateRoot;
    this.#artifactRoot = artifactRoot;
    this.#authorityDatabasePaths = new Set(authorityDatabasePaths);
    this.#archiveDatabasePaths = new Set(archiveDatabasePaths);
    this.#scope = scope;
    this.#mode = mode;
    this.#locator = locator === undefined ? undefined : Object.freeze({ ...locator });
    issued.add(this);
    Object.freeze(this);
  }

  get locator(): RuntimeLocator {
    this.assertLive();
    if (this.#locator === undefined) throw new Error("runtime-admission: synthetic fixture has no installation locator");
    return this.#locator;
  }
  get stateRoot(): string { this.assertLive(); return this.#stateRoot; }
  get artifactRoot(): string { this.assertLive(); return this.#artifactRoot; }
  assertFixedProcessLockRoot(workspaceRoot: string, processLockRoot: string): void {
    this.assertLive();
    if (this.#scope !== "installation") throw new Error("runtime-admission: installation lock authority required");
    const lease = this.#authority as InstallationLease;
    assertInstallationLease(lease);
    lease.assertFixedProcessLockRoot(workspaceRoot, processLockRoot);
  }
  readRelocationReceipts(): readonly RelocationCompletionReceipt[] {
    this.assertLive();
    if (this.#scope !== "installation" || this.#authority.readRelocationReceipts === undefined) {
      throw new Error("runtime-admission: installation receipt authority required");
    }
    return this.#authority.readRelocationReceipts();
  }
  assertLive(): void {
    if (!issued.has(this) || this.#released) throw new Error("runtime-admission: missing or released admission");
    this.#authority.assertHeld();
  }
  assertStorageRootsSafe(): void {
    this.assertLive();
    if (this.#scope === "synthetic" || this.#scope === "synthetic-verified-copy" || this.#scope === "synthetic-stopped-staged") {
      if (this.#stateRoot !== ":memory:") assertSyntheticDirectory(this.#stateRoot);
      if (this.#artifactRoot !== ":memory:") assertSyntheticDirectory(this.#artifactRoot);
      return;
    }
    assertActiveRootSafe(this.#stateRoot);
    assertActiveRootSafe(this.#artifactRoot);
  }
  assertExclusive(): void {
    this.assertLive();
    if (this.#mode !== "exclusive" && this.#mode !== "synthetic") throw new Error("runtime-admission: exclusive offline admission required");
  }
  assertWritable(): void {
    this.assertLive();
    if (this.#scope === "adoption-inspection") throw new Error("runtime-admission: adoption inspection is read-only");
    if (this.#scope === "adoption-initialization") throw new Error("runtime-admission: fresh initialization has database-only write authority");
    if (this.#scope === "verified-copy" || this.#scope === "synthetic-verified-copy"
      || this.#scope === "relocation-source-verification") throw new Error("runtime-admission: verification is read-only");
  }
  assertAuthorityDatabase(path: string): void {
    if (this.#scope === "adoption-initialization") this.assertLive();
    else this.assertWritable();
    this.assertStorageRootsSafe();
    if (path === ":memory:" && this.#scope !== "relocation-destination" && this.#scope !== "adoption-initialization") return;
    if (!this.#authorityDatabasePaths.has(path === ":memory:" ? path : resolve(path))) throw new Error("runtime-admission: authority database path is outside admission");
  }
  assertReadOnlyAuthorityDatabase(path: string): void {
    this.assertLive();
    if (this.#scope === "relocation-source-verification" || this.#scope === "adoption-initialization") {
      throw new Error("runtime-admission: inspection database authority unavailable");
    }
    this.assertStorageRootsSafe();
    if (path === ":memory:" && this.#scope !== "relocation-destination") return;
    const checked = resolve(path);
    if (this.#authorityDatabasePaths.has(checked)) return;
    if (this.#scope === "adoption-inspection") throw new Error("runtime-admission: adoption inspection path is outside known default authority");
    const parent = dirname(checked);
    if (parent === join(this.#stateRoot, "suspects") && /^suspect-\d{17}-[0-9a-f-]{36}\.sqlite$/u.test(checked.slice(parent.length + 1))) return;
    if (parent === join(this.#stateRoot, "backups", "authority")
      && /^(?:\.authority-[0-9a-f-]{36}\.sqlite\.tmp|authority-g\d+-\d+-[0-9a-f-]{36}\.sqlite)$/u.test(checked.slice(parent.length + 1))) {
      this.assertStateRoot(parent);
      return;
    }
    throw new Error("runtime-admission: read-only authority database path is outside admission");
  }
  assertArchiveDatabase(path: string, mode: "read-only" | "read-write" = "read-write"): void {
    this.assertLive();
    if (this.#scope === "relocation-source-verification") throw new Error("runtime-admission: source verification cannot open archive database");
    this.assertStorageRootsSafe();
    if (mode !== "read-only" && this.#scope !== "adoption-initialization") this.assertWritable();
    if (path === ":memory:" && this.#scope !== "relocation-destination" && this.#scope !== "adoption-initialization") return;
    const checked = resolve(path);
    if (this.#archiveDatabasePaths.has(checked)) return;
    if (this.#scope === "adoption-initialization") throw new Error("runtime-admission: archive path is outside fresh initialization");
    const parent = dirname(checked);
    if (mode === "read-only" && parent === join(this.#stateRoot, "backups", "authority")
      && /^[0-9a-f-]{36}\.archive\.sqlite$/u.test(checked.slice(parent.length + 1))) {
      this.assertStateRoot(parent);
      return;
    }
    throw new Error("runtime-admission: archive database path is outside admission");
  }
  assertStateRoot(path: string): void {
    this.assertLive();
    this.assertStorageRootsSafe();
    if (this.#scope === "adoption-initialization" && ![this.#stateRoot, join(this.#stateRoot, "state.db"),
      join(this.#stateRoot, rebuildRuntimeIsolation.archiveDatabaseFile)].includes(resolve(path))) {
      throw new Error("runtime-admission: fresh initialization path is outside database authority");
    }
    if (!within(this.#stateRoot, resolve(path))) throw new Error("runtime-admission: state path is outside admission");
  }
  assertArtifactRoot(path: string): void {
    this.assertLive();
    if (this.#scope === "adoption-initialization") throw new Error("runtime-admission: fresh initialization cannot write artifacts");
    this.assertStorageRootsSafe();
    if (!within(this.#artifactRoot, resolve(path))) throw new Error("runtime-admission: artifact path is outside admission");
  }
  release(): void {
    if (this.#released) return;
    this.#authority.release();
    this.#released = true;
  }

  #exclusiveRelocationLease(): ExclusiveInstallationLease {
    this.assertLive();
    if (this.#scope !== "installation" || this.#mode !== "exclusive") {
      throw new Error("runtime-admission: exclusive installation relocation authority required");
    }
    const lease = this.#authority as ExclusiveInstallationLease;
    assertInstallationLease(lease);
    if (lease.mode !== "exclusive") throw new Error("runtime-admission: exclusive installation lease required");
    return lease;
  }

  beginRelocation(destination: RuntimePair, plan: RelocationPlanBinding,
    restore: RestoreAdmissionHandle): RuntimeRelocationOperation {
    const lease = this.#exclusiveRelocationLease();
    const operationId = lease.beginRelocation(destination, plan, restore);
    return this.#relocationOperation(lease, operationId);
  }

  resumeRelocation(operationId: string): RuntimeRelocationOperation {
    return this.#relocationOperation(this.#exclusiveRelocationLease(), operationId);
  }

  #relocationOperation(lease: ExclusiveInstallationLease, operationId: string): RuntimeRelocationOperation {
    const initial = lease.relocationInventory();
    if (initial.operationId !== operationId || initial.installationId !== this.locator.installationId
      || initial.fromGeneration !== this.locator.generation && initial.fromGeneration + 1 !== this.locator.generation) {
      throw new Error("runtime-admission: relocation operation binding mismatch");
    }
    const binding = canonicalJsonStringify({ operationId: initial.operationId, installationId: initial.installationId,
      fromGeneration: initial.fromGeneration, source: initial.source, destination: initial.destination,
      plan: initial.plan, pinnedEntries: initial.pinnedEntries, retentions: initial.retentions });
    const inventory = (): RelocationInventory => {
      this.assertLive();
      const current = lease.relocationInventory();
      const currentBinding = canonicalJsonStringify({ operationId: current.operationId, installationId: current.installationId,
        fromGeneration: current.fromGeneration, source: current.source, destination: current.destination,
        plan: current.plan, pinnedEntries: current.pinnedEntries, retentions: current.retentions });
      if (currentBinding !== binding) throw new Error("runtime-admission: relocation operation changed");
      return current;
    };
    const child = (pair: RuntimePair, scope: AdmissionScope): RuntimeAdmission => new RuntimeAdmission(issuanceToken,
      { assertHeld: () => { inventory(); }, release() {} }, pair.stateRoot, pair.artifactRoot,
      scope === "relocation-destination" ? [join(pair.stateRoot, "state.db")] : [],
      scope === "relocation-destination" ? [join(pair.stateRoot, rebuildRuntimeIsolation.archiveDatabaseFile)] : [],
      scope, "exclusive");
    return Object.freeze({ operationId, inventory,
      readPriorReceipts: () => { inventory(); return lease.readPriorReceipts(); },
      destinationAdmission: () => child(inventory().destination, "relocation-destination"),
      sourceVerificationAdmission: () => {
        const current = inventory();
        if (current.phase !== "retained" && current.phase !== "switched") {
          throw new Error("runtime-admission: fully retained source required for verification");
        }
        const state = current.retentions.find((row) => row.role === "state");
        const artifact = current.retentions.find((row) => row.role === "artifact");
        const stateRoot = state?.retained ?? current.source.stateRoot;
        const artifactRoot = artifact?.retained ?? (state !== undefined
          && (current.source.artifactRoot === current.source.stateRoot
            || current.source.artifactRoot.startsWith(`${current.source.stateRoot}/`))
          ? join(state.retained, relative(current.source.stateRoot, current.source.artifactRoot))
          : current.source.artifactRoot);
        return child({ stateRoot, artifactRoot }, "relocation-source-verification");
      },
      recordVerifiedStage: (verify: RelocationVerifier) => { inventory(); lease.recordVerifiedStage(verify); },
      recordVerifiedPreparation: (verify: RelocationPreparationVerifier) => { inventory(); lease.recordVerifiedPreparation(verify); },
      fenceRelocationSource: () => { inventory(); lease.fenceRelocationSource(); },
      retainRelocationSources: () => { inventory(); lease.retainRelocationSources(); },
      switchRelocationLocator: (verify: RelocationVerifier) => { inventory(); return lease.switchRelocationLocator(verify); },
      settleRelocation: (verify: RelocationVerifier) => { inventory(); lease.settleRelocation(verify); },
    });
  }

  stoppedStagedAuthority(path: string): RuntimeAdmission {
    this.assertExclusive();
    if ((this.#scope !== "installation" && this.#scope !== "synthetic") || dirname(resolve(path)) !== this.#stateRoot
      || !/^\.restore-[0-9a-f-]{36}\.sqlite\.tmp$/u.test(resolve(path).slice(this.#stateRoot.length + 1))) {
      throw new Error("runtime-admission: staged authority path is not an owned restore copy");
    }
    return new RuntimeAdmission(issuanceToken, { assertHeld: () => this.assertLive(), release() {} },
      this.#stateRoot, this.#artifactRoot, [resolve(path)], [], this.#scope === "synthetic" ? "synthetic-stopped-staged" : "stopped-staged", "exclusive");
  }

  verifiedReadOnlyCopy(path: string, expectedSha256: string, kind: "authority" | "archive"): RuntimeAdmission {
    this.assertLive();
    if (this.#scope === "adoption-initialization") throw new Error("runtime-admission: fresh initialization cannot delegate copy authority");
    if (this.#scope === "relocation-source-verification") {
      throw new Error("runtime-admission: source verification is limited to retained roots");
    }
    if (!/^[0-9a-f]{64}$/u.test(expectedSha256)) throw new Error("runtime-admission: invalid copy digest");
    const checked = resolve(path);
    if (!within(this.#stateRoot, checked)) this.assertExclusive();
    const canonical = realpathSync(checked);
    const temp = resolve(tmpdir());
    if (canonical !== checked && !(within(temp, checked)
      && canonical === join(realpathSync(tmpdir()), relative(temp, checked)))) {
      throw new Error("runtime-admission: inspected copy path contains symlink");
    }
    let component = parse(canonical).root;
    for (const part of relative(component, canonical).split(/[\\/]/u)) {
      if (part === "") continue;
      component = join(component, part);
      const info = lstatSync(component);
      if (info.isSymbolicLink()) throw new Error("runtime-admission: inspected copy contains symlink");
    }
    const verifyBytes = () => {
      this.assertLive();
      const file = lstatSync(canonical);
      if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || (process.getuid && file.uid !== process.getuid()) || (file.mode & 0o022) !== 0) {
        throw new Error("runtime-admission: inspected copy has unsafe shape");
      }
      const descriptor = openSync(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = fstatSync(descriptor);
        if (opened.dev !== file.dev || opened.ino !== file.ino || opened.size !== file.size) {
          throw new Error("runtime-admission: inspected copy changed during open");
        }
        const hash = createHash("sha256");
        const buffer = Buffer.allocUnsafe(64 * 1024);
        let read = 0;
        while ((read = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
        const final = fstatSync(descriptor);
        if (final.dev !== opened.dev || final.ino !== opened.ino || final.size !== opened.size
          || final.mtimeMs !== opened.mtimeMs || hash.digest("hex") !== expectedSha256) {
          throw new Error("runtime-admission: inspected copy digest changed");
        }
      } finally { closeSync(descriptor); }
    };
    verifyBytes();
    return new RuntimeAdmission(issuanceToken, { assertHeld: verifyBytes, release() {} },
      this.#stateRoot, this.#artifactRoot, kind === "authority" ? [checked] : [], kind === "archive" ? [checked] : [],
      this.#scope === "synthetic" || this.#scope === "synthetic-verified-copy" ? "synthetic-verified-copy" : "verified-copy", this.#mode);
  }

  static fromInstallationLease(lease: InstallationLease): RuntimeAdmission {
    assertInstallationLease(lease);
    const { stateRoot, artifactRoot } = lease.locator;
    return new RuntimeAdmission(issuanceToken, lease, stateRoot, artifactRoot,
      [join(stateRoot, "state.db")], [join(stateRoot, rebuildRuntimeIsolation.archiveDatabaseFile)], "installation", lease.mode, lease.locator);
  }

  static acquireInitial(workspace: string,
    verifyExisting: (pair: RuntimePair, inspection: RuntimeAdmission) => ExistingAuthorityEvidence,
    initializeFresh: (pair: RuntimePair, initialization: RuntimeAdmission) => void): RuntimeAdmission {
    const canonical = realpathSync(workspace);
    const defaults = Object.freeze({
      stateRoot: resolve(canonical, rebuildRuntimeIsolation.stateRoot),
      artifactRoot: resolve(canonical, rebuildRuntimeIsolation.artifactRoot),
    });
    const lease = acquireInstallation(canonical, "exclusive", {
      defaultPair: defaults,
      verifyExisting: (pair) => {
        const inspection = new RuntimeAdmission(issuanceToken, { assertHeld() {}, release() {} }, pair.stateRoot, pair.artifactRoot,
          [join(pair.stateRoot, "state.db")], [join(pair.stateRoot, rebuildRuntimeIsolation.archiveDatabaseFile)], "adoption-inspection", "exclusive");
        try { return verifyExisting(pair, inspection); }
        finally { inspection.release(); }
      },
      initializeFresh: (witness: FreshInitializationWitness) => {
        const initialization = new RuntimeAdmission(issuanceToken,
          { assertHeld: () => witness.assertHeld(), release() {} }, witness.pair.stateRoot, witness.pair.artifactRoot,
          [join(witness.pair.stateRoot, "state.db")],
          [join(witness.pair.stateRoot, rebuildRuntimeIsolation.archiveDatabaseFile)], "adoption-initialization", "exclusive");
        try {
          const completed: unknown = initializeFresh(witness.pair, initialization);
          if (completed !== undefined) throw new Error("runtime-admission: fresh initialization must complete synchronously");
        }
        finally { initialization.release(); }
      },
    });
    return RuntimeAdmission.fromInstallationLease(lease);
  }

  /** Bounded synthetic authority for tests; never accepts an installation or checkout path. */
  static syntheticFixture(databasePath: string, kind: "authority" | "archive"): RuntimeAdmission {
    if (databasePath !== ":memory:") {
      assertSyntheticDirectory(dirname(databasePath));
      const file = lstatSync(databasePath, { throwIfNoEntry: false });
      if (file !== undefined && (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1
        || (process.getuid && file.uid !== process.getuid()) || (file.mode & 0o022) !== 0)) {
        throw new Error("runtime-admission: unsafe synthetic fixture database");
      }
      for (const forbidden of [".runtime-control", ".runtime-owner.json", ".runtime-source-fence.json"]) {
        if (databasePath.split(/[\\/]/u).includes(forbidden)) throw new Error("runtime-admission: fixture overlaps installation control");
      }
    }
    const stateRoot = databasePath === ":memory:" ? ":memory:" : dirname(databasePath);
    const artifactRoot = databasePath === ":memory:" ? ":memory:" : join(stateRoot, "artifacts");
    const authority: AdmissionAuthority = { assertHeld() {}, release() {} };
    return new RuntimeAdmission(issuanceToken, authority, stateRoot, artifactRoot,
      kind === "authority" ? [databasePath] : [],
      kind === "archive" ? [databasePath] : databasePath === ":memory:" ? [] : [join(stateRoot, rebuildRuntimeIsolation.archiveDatabaseFile)], "synthetic", "synthetic");
  }

  static syntheticRoots(stateRoot: string, artifactRoot: string): RuntimeAdmission {
    assertSyntheticDirectory(stateRoot);
    assertSyntheticDirectory(artifactRoot);
    const authority: AdmissionAuthority = { assertHeld() {}, release() {} };
    return new RuntimeAdmission(issuanceToken, authority, stateRoot, artifactRoot,
      [join(stateRoot, "state.db")], [join(stateRoot, rebuildRuntimeIsolation.archiveDatabaseFile)], "synthetic", "synthetic");
  }
}
Object.freeze(RuntimeAdmission.prototype);

export function requireRuntimeAdmission(value: RuntimeAdmission | undefined): RuntimeAdmission {
  if (value === undefined || !issued.has(value)) throw new Error("runtime-admission: required");
  value.assertLive();
  return value;
}

export function acquireSharedRuntimeAdmission(workspace: string): RuntimeAdmission {
  return RuntimeAdmission.fromInstallationLease(acquireInstallation(workspace, "shared"));
}

export function acquireExclusiveRuntimeAdmission(workspace: string): RuntimeAdmission {
  return RuntimeAdmission.fromInstallationLease(acquireInstallation(workspace, "exclusive"));
}

export function acquireInitialRuntimeAdmission(workspace: string,
  verifyExisting: (pair: RuntimePair, inspection: RuntimeAdmission) => ExistingAuthorityEvidence,
  initializeFresh: (pair: RuntimePair, initialization: RuntimeAdmission) => void): RuntimeAdmission {
  return RuntimeAdmission.acquireInitial(workspace, verifyExisting, initializeFresh);
}

export function acquireRecoveryRuntimeRelocation(workspace: string,
  binding: Readonly<{ installationId: string; fromGeneration: number; operationId: string }>,
  restore: RestoreAdmissionHandle): Readonly<{ admission: RuntimeAdmission; operation: RuntimeRelocationOperation }> {
  const lease = acquireInstallation(workspace, "exclusive", { recoverRelocation: { ...binding, restoreAdmission: restore } });
  try {
    const admission = RuntimeAdmission.fromInstallationLease(lease);
    return Object.freeze({ admission, operation: admission.resumeRelocation(binding.operationId) });
  } catch (error) {
    lease.release();
    throw error;
  }
}
