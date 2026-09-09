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

/** This single S-owned selection point covers direct, intake, start and relaunch identities. */
export function selectNewRunIdentity(repositories:Pick<AuthorityRepositories,"configSnapshots">,candidate:Readonly<{configSnapshotId:string;configFingerprint:string}>) {
 selectRunSettings(repositories,candidate);
 return candidate;
}
export function runSettingsAvailable(repositories:Pick<AuthorityRepositories,"configSnapshots">,identity:Readonly<{configSnapshotId:string;configFingerprint:string}>) {
 const snapshot=repositories.configSnapshots.get(identity.configSnapshotId);
 return snapshot!==undefined && snapshot.fingerprint===identity.configFingerprint;
}
