import { RuntimeConfigClaimTokenSchema } from "../domain/config/runtime-generation.js";
import type { AuthorityRepositories } from "../infra/sqlite/authority-database.js";
/** S owns new-run selection; callers retain the chosen immutable snapshot. */
export function selectRunRuntime(repositories:Pick<AuthorityRepositories,"runtimeConfig">) {
 const active=repositories.runtimeConfig.get();
 if(active===undefined)throw new Error("operator lifecycle command has no active runtime config");
 return RuntimeConfigClaimTokenSchema.parse({generation:active.generation,settingsRevision:active.settingsRevision,settingsFingerprint:active.settingsFingerprint,configFingerprint:active.configFingerprint});
}
export function selectRunSettings(repositories:Pick<AuthorityRepositories,"configSnapshots">,identity:Readonly<{configSnapshotId:string;configFingerprint:string}>) {
 const snapshot=repositories.configSnapshots.get(identity.configSnapshotId);
 if(snapshot===undefined||snapshot.fingerprint!==identity.configFingerprint)throw new Error("run-settings-snapshot-mismatch");
 return snapshot;
}

/** New identities are selected in the caller's creation/planning transaction. */
export function selectNewRunIdentity<T extends Readonly<{configSnapshotId:string;configFingerprint:string}>>(repositories:Pick<AuthorityRepositories,"configSnapshots"|"runtimeConfig">,candidate:T):T {
 selectRunSettings(repositories,candidate);
 const active=selectActiveRunSettings(repositories);
 return {...candidate,configSnapshotId:active.configSnapshotId,configFingerprint:active.fingerprint};
}
export function selectActiveRunSettings(repositories:Pick<AuthorityRepositories,"configSnapshots"|"runtimeConfig">) {
 const active=repositories.runtimeConfig.get();
 if(active===undefined)throw new Error("run-settings-active-missing");
 return selectRunSettings(repositories,active);
}
/** Reviewed plans cannot silently retarget; accepted command replay precedes this check. */
export function reviewedRunSettingsCurrent(repositories:Pick<AuthorityRepositories,"configSnapshots"|"runtimeConfig">,identity:Readonly<{configSnapshotId:string;configFingerprint:string}>):boolean {
 const active=selectActiveRunSettings(repositories);
 return active.configSnapshotId===identity.configSnapshotId && active.fingerprint===identity.configFingerprint;
}
export function runSettingsAvailable(repositories:Pick<AuthorityRepositories,"configSnapshots">,identity:Readonly<{configSnapshotId:string;configFingerprint:string}>) {
 const snapshot=repositories.configSnapshots.get(identity.configSnapshotId);
 return snapshot!==undefined && snapshot.fingerprint===identity.configFingerprint;
}
