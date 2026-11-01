import { retainAuthoritySourceClosure } from "../source-closure.js";
import { authoritySourceDatabaseIdentity } from "./database-identity.js";
import { createReadonlyAuthoritySnapshot, openReadOnlyDatabase, withAuthorityDatabaseReadOnly } from "./readonly-authority-snapshot.js";
import { resolve } from "node:path";
import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { inspectNativeAuthority, inspectNormalAuthority } from "./authority-database.js";
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
 return Object.freeze({...inspection,invariantViolations:inspection.invariants.violations,exactTableRegistry:true as const});
}


export function inspectAuthorityBackupReadOnly(admission:RuntimeAdmission,path:string,expectedSchemaVersion?:number,busyTimeoutMs=250):BackupCopyInspection {
 return withAuthorityDatabaseReadOnly(admission,path,database=>inspectOpenDatabase(database,expectedSchemaVersion),busyTimeoutMs);
}
export function openAuthorityBackupSourceReadOnly(admission:RuntimeAdmission,pathInput:string,busyTimeoutMs=250,expectedSchemaVersion:number=CURRENT_AUTHORITY_SCHEMA_VERSION):AuthorityBackupSourceReadOnly {
 const path=resolve(pathInput);
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
 const assertOpen=()=>{if(closeFailure!==undefined)throw closeFailure.error;admission.assertLive();if(closed)throw new Error("authority-backup-source-closed");snapshot.assertUnchanged();};
 return Object.freeze({
 getMeta(){assertOpen();const row=z.strictObject({schema_version:z.number().int().positive(),authority_generation:z.number().int().nonnegative(),updated_at:z.string().datetime(),installation_id:z.uuid().optional(),profile_id:z.uuid().optional()}).parse(database.prepare(expectedSchemaVersion >= 7 ? "SELECT schema_version,authority_generation,updated_at,installation_id,profile_id FROM database_states WHERE id=1" : "SELECT schema_version,authority_generation,updated_at FROM database_states WHERE id=1").get());if(row.schema_version!==expectedSchemaVersion)throw new Error("authority-backup-source-schema-mismatch");return Object.freeze({schemaVersion:row.schema_version,authorityGeneration:row.authority_generation,updatedAt:row.updated_at,installationId:row.installation_id,profileId:row.profile_id});},
 getSourceDatabaseIdentity(){assertOpen();return authoritySourceDatabaseIdentity(admission.authorityBackupExpectedSource());},
 async onlineBackupTo(destinationPath:string){assertOpen();admission.assertAuthorityBackupWrite(destinationPath);admission.assertStateRoot(destinationPath);const pages=await sqliteBackup(database,resolve(destinationPath),{rate:100});snapshot.assertUnchanged();return pages;},
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
