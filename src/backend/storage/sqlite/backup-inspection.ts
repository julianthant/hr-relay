import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { applicationDataWorkspace } from "../../app/config/runtime-isolation.js";
import { isUpgradeableAuthoritySchemaVersion } from "../../../models/config/authority-schema-versions.js";
import type { ProfileDatabaseBinding } from "../../../models/profiles/profile.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import { assertMaintenanceCustodyAvailable } from "../maintenance/custody-availability.js";
import { createPrivateDirectory } from "../private-path.js";
import { retainAuthoritySourceClosure } from "../source-closure.js";
import { authoritySourceDatabaseIdentity } from "./database-identity.js";
import { createReadonlyAuthoritySnapshot, openReadOnlyDatabase, readonlyAuthorityCopyPrefix, readonlyAuthorityImage, withAuthorityDatabaseReadOnly } from "./readonly-authority-snapshot.js";
import { applyAuthorityMigrationsAfter } from "./authority-upgrades.js";
import { inspectNativeAuthority, inspectNativeBackupCopy, inspectNormalAuthority } from "./authority-inspection.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "./migrations.js";

export type BackupCopyInspection = ReturnType<typeof inspectOpenDatabase>;
export type AuthorityBackupSourceReadOnly = Readonly<{
 getMeta(): Readonly<{schemaVersion:number;authorityGeneration:number;updatedAt:string;installationId?:string;profileId?:string}>;
 getSourceDatabaseIdentity(): string;
 onlineBackupTo(destinationPath:string):Promise<number>;
 close():void;
}>;


export function inspectOpenDatabase(database:DatabaseSync,expectedSchemaVersion?:number) {
 const inspection=expectedSchemaVersion===undefined?inspectNormalAuthority(database):inspectNativeAuthority(database,expectedSchemaVersion);
 return backupInspection(inspection);
}

function backupInspection(inspection: ReturnType<typeof inspectNativeAuthority>) {
 return Object.freeze({...inspection,invariantViolations:inspection.invariants.violations,exactTableRegistry:true as const});
}

/** A SHA-bound backup copy can retain its SQLite inspection across publication at a new path. */
export function inspectVerifiedBackupCopyReadOnly(admission: RuntimeAdmission, path: string, expectedSchemaVersion: number): BackupCopyInspection {
  return withAuthorityDatabaseReadOnly(admission, path, database => backupInspection(inspectNativeBackupCopy(database, expectedSchemaVersion)));
}

export function isolatedBackupScratchRoot(admission: RuntimeAdmission, sourcePath: string): string {
  const context = requireRuntimeAdmission(admission).readInstallationContext();
  if (context === undefined) throw new Error("authority-backup-upgrade-destination-unbound");
  const root = realpathSync(tmpdir());
  const protectedRoots = [applicationDataWorkspace(undefined, "production"), context.workspace, admission.stateRoot,
    admission.artifactRoot, dirname(sourcePath)];
  if (protectedRoots.some(path => {
    const offset = relative(existsSync(path) ? realpathSync(path) : path, root);
    return !isAbsolute(offset) && offset.split(sep)[0] !== "..";
  })) throw new Error("authority-backup-upgrade-temp-root-refused");
  return root;
}

/** Migrates a disposable clone of the verifier's read-only image for the duration of the import read. */
export function withUpgradedBackupCopy<T>(admission: RuntimeAdmission, source: DatabaseSync, version: number,
  binding: ProfileDatabaseBinding, now: string, read: (database: DatabaseSync) => T): T {
  const image = readonlyAuthorityImage(source);
  const sourcePath = source.location();
  if (image === undefined || sourcePath === null || resolve(sourcePath) === image.path) throw new Error("authority-backup-snapshot-required");
  if (!isUpgradeableAuthoritySchemaVersion(version) || source.prepare("PRAGMA user_version").get()?.user_version !== version) {
    throw new Error("authority-backup-upgrade-source-schema-mismatch");
  }
  const root = isolatedBackupScratchRoot(admission, image.path);
  const directory = { path: join(root, `${readonlyAuthorityCopyPrefix}${String(process.pid)}-import-${randomUUID()}`) };
  createPrivateDirectory(directory.path, { mode: 0o700 });
  let database: DatabaseSync | undefined;
  let result: { value: T } | { error: unknown };
  try {
    const path = join(directory.path, "authority.sqlite");
    writeFileSync(path, source.serialize(), { flag: "wx", mode: 0o600 });
    database = new DatabaseSync(path, { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false,
      allowExtension: false, allowBareNamedParameters: false, allowUnknownNamedParameters: false, defensive: true });
    database.exec("BEGIN EXCLUSIVE");
    applyAuthorityMigrationsAfter(database, version, { now, binding,
      captureFile: () => { throw new Error("authority-backup-upgrade-artifact-unavailable"); } });
    database.prepare("UPDATE database_states SET schema_version=? WHERE id=1").run(CURRENT_AUTHORITY_SCHEMA_VERSION);
    database.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
    inspectNormalAuthority(database);
    database.exec("COMMIT; PRAGMA query_only=ON");
    result = { value: read(database) };
  } catch (error) { result = { error }; }
  const failures = "error" in result ? [result.error] : [];
  if (database !== undefined) {
    try { database.close(); }
    catch (error) { throw retainAuthoritySourceClosure([...failures, error], { database, directory }); }
  }
  try { rmSync(directory.path, { recursive: true, force: true, maxRetries: 3 }); }
  catch (error) { throw retainAuthoritySourceClosure([...failures, error], { directory }); }
  if ("error" in result) throw result.error;
  return result.value;
}


export function inspectAuthorityBackupReadOnly(admission:RuntimeAdmission,path:string,expectedSchemaVersion?:number,busyTimeoutMs=250):BackupCopyInspection {
 return withAuthorityDatabaseReadOnly(admission,path,database=>inspectOpenDatabase(database,expectedSchemaVersion),busyTimeoutMs);
}
export function openAuthorityBackupSourceReadOnly(admission:RuntimeAdmission,pathInput:string,busyTimeoutMs=250,expectedSchemaVersion:number=CURRENT_AUTHORITY_SCHEMA_VERSION):AuthorityBackupSourceReadOnly {
 const path=resolve(pathInput);
 requireRuntimeAdmission(admission).assertReadOnlyAuthorityDatabase(path);
 assertMaintenanceCustodyAvailable("backup");
 const inspection=inspectAuthorityBackupReadOnly(admission,path,expectedSchemaVersion,busyTimeoutMs);
 admission.assertAuthorityBackupSource(path,inspection.authorityContentFingerprint);
 const snapshot=createReadonlyAuthoritySnapshot(path);
 let database:DatabaseSync;
 try {database=openReadOnlyDatabase(snapshot.path,busyTimeoutMs);}
 catch(error){
  const failures:unknown[]=[];
  try{snapshot.dispose();}catch(cleanupError){failures.push(cleanupError);}
  if(failures.length!==0)throw retainAuthoritySourceClosure([error,...failures], { snapshot });
  throw error;
 }
 try {database.exec("PRAGMA query_only=ON");}
 catch(error){
  const failures:unknown[]=[];
  try{database.close();}catch(cleanupError){throw retainAuthoritySourceClosure([error,cleanupError], { snapshot, database });}
  try{snapshot.dispose();}catch(cleanupError){failures.push(cleanupError);}
  if(failures.length!==0)throw retainAuthoritySourceClosure([error,...failures], { snapshot });
  throw error;
 }
 let closed=false;
 let closeFailure: { error: unknown } | undefined;
 const assertOwnerOpen=()=>{if(closeFailure!==undefined)throw closeFailure.error;admission.assertLive();if(closed)throw new Error("authority-backup-source-closed");};
 const assertOpen=()=>{assertOwnerOpen();snapshot.assertUnchanged();};
 return Object.freeze({
 getMeta(){assertOpen();const row=z.strictObject({schema_version:z.number().int().positive(),authority_generation:z.number().int().nonnegative(),updated_at:z.string().datetime(),installation_id:z.uuid().optional(),profile_id:z.uuid().optional()}).parse(database.prepare(expectedSchemaVersion >= 7 ? "SELECT schema_version,authority_generation,updated_at,installation_id,profile_id FROM database_states WHERE id=1" : "SELECT schema_version,authority_generation,updated_at FROM database_states WHERE id=1").get());if(row.schema_version!==expectedSchemaVersion)throw new Error("authority-backup-source-schema-mismatch");return Object.freeze({schemaVersion:row.schema_version,authorityGeneration:row.authority_generation,updatedAt:row.updated_at,installationId:row.installation_id,profileId:row.profile_id});},
 getSourceDatabaseIdentity(){assertOpen();return authoritySourceDatabaseIdentity(admission.authorityBackupExpectedSource());},
 async onlineBackupTo(destinationPath:string){assertOwnerOpen();admission.assertAuthorityBackupWrite(destinationPath);admission.assertStateRoot(destinationPath);assertMaintenanceCustodyAvailable("backup");assertOpen();const pages=await sqliteBackup(database,resolve(destinationPath),{rate:100});snapshot.assertUnchanged();return pages;},
 close(){
  if(closeFailure!==undefined)throw closeFailure.error;
  if(closed)return;
  try{database.close();}
  catch(error){const failure=retainAuthoritySourceClosure([error], { snapshot, database });closeFailure={error:failure};throw failure;}
  let validation: { error: unknown } | undefined;
  try{snapshot.assertUnchanged();}catch(error){validation={error};}
  try{snapshot.dispose();}
  catch(error){const failure=retainAuthoritySourceClosure(validation===undefined?[error]:[validation.error,error], { snapshot });closeFailure={error:failure};throw failure;}
  closed=true;
  if(validation!==undefined)throw validation.error;
 },
 });
}
