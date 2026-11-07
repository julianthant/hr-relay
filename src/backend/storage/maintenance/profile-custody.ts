import { fileStatus } from "../file-identity.js";
import type { StoppedBrowserRoot } from "../browser-root-contract.js";
import { dirname,isAbsolute,join,relative,resolve,sep } from "node:path";
import { ProfileBrowserRootRefusalError,requireRuntimeAdmission } from "../admission/admission-identity.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { privatePathRejects } from "../private-path.js";
import type { AuthorityDatabase } from "../sqlite/authority-database.js";
import { runClaim } from "../../../models/run/record.js";
import { BrowserSystemIdSchema } from "../../../rules/identity/ids.js";
import type { ProfileBrowserClosure,RetainedBrowserProfile } from "./profile-inventory.js";

type CredentialMembershipCustody = ReturnType<AuthorityDatabase["readProfileResourceCustody"]>;
export type BrowserProfileCustody = Pick<CredentialMembershipCustody, "slots" | "configSnapshots">;

export function configuredBrowserRoots(root: string, custody: BrowserProfileCustody, savedBrowserRoot: string): string[] {
  // Unreferenced historical snapshots carry paths, not custody of another profile's files.
  const historical = custody.configSnapshots.map(snapshot => snapshot.config.paths.browserProfileRoot).filter(path => {
    const child = relative(root, path);
    return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
  });
  return [...new Set([savedBrowserRoot, ...historical])];
}

export type BrowserRegistryMembership = Readonly<{ machineRoot: string; profileId: string; roots: readonly StoppedBrowserRoot[] }>;
export function retainedBrowserProfiles(root: string, custody: BrowserProfileCustody, savedBrowserRoot: string, browserClosure: Pick<ProfileBrowserClosure, "workerDirectory">, registry?: BrowserRegistryMembership) {
  const profiles = new Map<string, RetainedBrowserProfile>();
  for (const path of configuredBrowserRoots(root, custody, savedBrowserRoot)) assertBrowserRoot(root, path);
  const profileRoot = join(root, "browsers");
  // Worker profiles are the deterministic w<ordinal>/<system> folders that exist on disk.
  for (const slot of custody.slots) for (const system of BrowserSystemIdSchema.options) {
    const profileDirectory = browserClosure.workerDirectory({ profileRoot, slotOrdinal: slot.ordinal, system });
    if (fileStatus(profileDirectory, true) === undefined) continue;
    assertBrowserRoot(root, profileRoot);
    profiles.set(profileDirectory, { profileRoot, profileDirectory, cleanupCompleted: slot.retiredAt !== null });
  }
  if (registry !== undefined) for (const row of registry.roots) {
    if (row.profileId !== registry.profileId || row.owner.kind !== 'command') continue;
    const profileRoot = join(registry.machineRoot, row.profileRoot), profileDirectory = join(registry.machineRoot, row.directory);
    assertBrowserRoot(root, profileRoot);
    if (!configuredBrowserRoots(root, custody, savedBrowserRoot).includes(profileRoot) || profileDirectory !== join(profileRoot, 'commands', 'sharepoint')
      || profiles.has(profileDirectory)) throw new Error('profile-inventory-browser-membership-unavailable');
    profiles.set(profileDirectory, { profileRoot, profileDirectory, cleanupCompleted: row.launch.state === 'closed' && row.native === undefined });
  }
  return [...profiles.values()];
}

export function assertRetainedProfileBrowserRoot(admissionInput: RuntimeAdmission, path: string): void {
  const admission = requireRuntimeAdmission(admissionInput), root = admission.stateRoot;
  assertBrowserRoot(root, path);
  admission.assertStateRoot(path);
}

function assertBrowserRoot(root: string, path: string): void {
  const child = relative(root, path);
  if (!isAbsolute(path) || resolve(path) !== path || child === "" || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new ProfileBrowserRootRefusalError();
  if (["credentials", "backups", "artifacts", "logs", "scratch", "state.db", "state.db-wal", "state.db-shm"].includes(child.split(sep)[0] ?? "")) throw new ProfileBrowserRootRefusalError();
  for (let current = path;; current = dirname(current)) {
    const info = fileStatus(current, true);
    if (info !== undefined && (!info.isDirectory() || info.isSymbolicLink() || privatePathRejects(current, info, "group-write"))) throw new ProfileBrowserRootRefusalError();
    if (current === root) break;
  }
}

export function assertStoppedProfileResourcesClosed(facts: ReturnType<AuthorityDatabase["readProfileResourceCustody"]>) {
  if (facts.exclusiveSessionLeases.some(lease => lease.releasedAt === null)
    || facts.duoLeases.some(lease => lease.state === "held")) throw new Error("credential-maintenance-custody-unproved");
}

export function assertCredentialCopyResourcesClosed(facts: ReturnType<AuthorityDatabase["readProfileResourceCustody"]>) {
  assertStoppedProfileResourcesClosed(facts);
  if (facts.writeIntents.some(intent => intent.status !== "committed" && intent.status !== "observed-present") || facts.pendingArtifacts.length > 0
    || facts.runs.some(run => run.lifecycle.state !== "terminal")) throw new Error("credential-maintenance-custody-unproved");
}

export function assertShutdownResourcesClosed(facts: ReturnType<AuthorityDatabase["readProfileResourceCustody"]>) {
  assertStoppedProfileResourcesClosed(facts);
  const unresolved = facts.writeIntents.filter(intent => intent.status !== "committed" && intent.status !== "observed-present");
  const owns = (run: typeof facts.runs[number], intent: typeof unresolved[number]) => "runId" in intent
    && run.envelope.runId === intent.runId && run.envelope.workflow === intent.workflowId
    && run.envelope.itemId === intent.itemId && run.envelope.attempt === intent.runAttempt
    && run.lifecycle.state === "parked-write" && run.lifecycle.writeIntentId === intent.writeIntentId
    && run.lifecycle.intentGeneration === intent.generation;
  if (facts.pendingArtifacts.length > 0 || facts.runs.some(run => runClaim(run) !== undefined
    || run.lifecycle.state !== "terminal" && run.pause?.state !== "paused" && run.lifecycle.state !== "parked-write"
    || run.lifecycle.state === "parked-write" && !unresolved.some(intent => owns(run, intent)))
    || unresolved.some(intent => !facts.runs.some(run => owns(run, intent)))) {
    throw new Error("profile-shutdown-custody-unproved");
  }
}
