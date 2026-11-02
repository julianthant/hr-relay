import type { BrowserRoot } from "../browser-root-contract.js";
import { lstatSync } from "node:fs";
import { dirname,isAbsolute,join,relative,resolve,sep } from "node:path";
import { ProfileBrowserRootRefusalError,requireRuntimeAdmission } from "../admission/admission-identity.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { privatePathRejects } from "../private-path.js";
import type { AuthorityDatabase } from "../sqlite/authority-database.js";
import type { ProfileBrowserClosure,RetainedBrowserProfile } from "./profile-inventory.js";

type CredentialMembershipCustody = ReturnType<AuthorityDatabase["readProfileResourceCustody"]>;
export type BrowserProfileCustody = Pick<CredentialMembershipCustody, "slots" | "verificationProfiles" | "browsers" | "configSnapshots" | "controls">;

export function configuredBrowserRoots(root: string, custody: BrowserProfileCustody, savedBrowserRoot: string): string[] {
  // Unreferenced historical snapshots carry paths, not custody of another profile's files.
  const historical = custody.configSnapshots.map(snapshot => snapshot.config.paths.browserProfileRoot).filter(path => {
    const child = relative(root, path);
    return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
  });
  return [...new Set([savedBrowserRoot, ...historical])];
}

export type BrowserRegistryMembership = Readonly<{ machineRoot: string; profileId: string; roots: readonly BrowserRoot[] }>;
export function retainedBrowserProfiles(root: string, custody: BrowserProfileCustody, savedBrowserRoot: string, browserClosure: Pick<ProfileBrowserClosure, "workerDirectory">, registry?: BrowserRegistryMembership) {
  const profiles = new Map<string, RetainedBrowserProfile>();
  for (const path of configuredBrowserRoots(root, custody, savedBrowserRoot)) assertBrowserRoot(root, path);
  for (const browser of custody.browsers) {
    const slot = custody.slots.find(value => value.workerId === browser.workerId);
    if (slot === undefined) throw new Error("profile-inventory-browser-membership-unavailable");
    const verification = custody.verificationProfiles.find(value => value.workerId === slot.workerId);
    const selectedRoots = verification === undefined
      ? custody.configSnapshots.some(snapshot => snapshot.fingerprint === browser.configFingerprint) ? [join(root, "browsers")] : []
      : [join(root, "scratch", "live-smoke", verification.profileRunId, "browsers")];
    const profileRoot = selectedRoots[0];
    if (profileRoot !== undefined && verification === undefined) assertBrowserRoot(root, profileRoot);
    if (selectedRoots.length !== 1 || profileRoot === undefined || verification !== undefined && verification.system !== browser.system
      || browser.profileDirectory !== browserClosure.workerDirectory({profileRoot,slotOrdinal:slot.ordinal,system:browser.system})) throw new Error("profile-inventory-browser-membership-unavailable");
    const control = custody.controls.find(value => value.commandId === slot.retirementCommandId);
    const acknowledgement = control?.phase.state === "succeeded" && control.auditedAt !== undefined ? control.phase.acknowledgement : undefined;
    const proof = acknowledgement?.kind === "remove" ? acknowledgement.retirement
      : acknowledgement?.kind === "plan" ? acknowledgement.retirements.find(value => value.workerId === slot.workerId) : undefined;
    const cleanupCompleted = slot.retiredAt !== null && (verification !== undefined ? verification.cleanup === "closed"
      : proof !== undefined && proof.workerId === slot.workerId && proof.membershipRevision + 1 === slot.membershipRevision);
    profiles.set(browser.profileDirectory, {profileRoot,profileDirectory:browser.profileDirectory,cleanupCompleted});
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
    const info = lstatSync(current, { throwIfNoEntry: false });
    if (info !== undefined && (!info.isDirectory() || info.isSymbolicLink() || privatePathRejects(current, info, "group-write"))) throw new ProfileBrowserRootRefusalError();
    if (current === root) break;
  }
}

export function assertStoppedProfileResourcesClosed(facts: ReturnType<AuthorityDatabase["readProfileResourceCustody"]>) {
  if (facts.reservations.some(reservation => reservation.state === "pending")
    || facts.slots.some(slot => slot.retiredAt === null && !facts.leases.some(lease => lease.workerId === slot.workerId))
    || facts.leases.some(lease => !facts.slots.some(slot => slot.workerId === lease.workerId))
    || facts.leases.some(lease => lease.lifecycle.state !== "stopped") || facts.browsers.some(browser => browser.health !== "closed")
    || facts.duoLeases.some(lease => lease.state === "held") || facts.controls.some(control => control.auditedAt === undefined)) throw new Error("credential-maintenance-custody-unproved");
}

export function assertCredentialCopyResourcesClosed(facts: ReturnType<AuthorityDatabase["readProfileResourceCustody"]>) {
  assertStoppedProfileResourcesClosed(facts);
  if (facts.writeIntents.some(intent => intent.status !== "committed" && intent.status !== "observed-present") || facts.pendingArtifacts.length > 0
    || facts.runs.some(run => run.lifecycle.state !== "terminal")) throw new Error("credential-maintenance-custody-unproved");
}
