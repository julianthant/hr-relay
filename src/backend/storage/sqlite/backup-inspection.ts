import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { createReadonlyAuthoritySnapshot } from "./readonly-authority-snapshot.js";
import { resolve } from "node:path";
import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { inspectNormalAuthority } from "./authority-database.js";
import { requireRuntimeAdmission, type RuntimeAdmission } from "../admission/admission.js";
import { requireSupportedRecoverySchema, requireDatabaseSourcePath } from "./recovery-admission.js";
import { AUTHORITY_APPLICATION_ID } from "./migrations.js";

export type BackupCopyInspection = ReturnType<typeof inspectOpenDatabase>;
export type AuthorityBackupSourceReadOnly = Readonly<{
 getMeta(): Readonly<{schemaVersion:number;authorityGeneration:number;updatedAt:string}>;
 getSourceDatabaseIdentity(): string;
 onlineBackupTo(destinationPath:string):Promise<number>;
 close():void;
}>;
function openReadOnlyDatabase(path: string, busyTimeoutMs: number): DatabaseSync {
  return new DatabaseSync(path, {
    readOnly: true,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    timeout: z.number().int().positive().parse(busyTimeoutMs),
    readBigInts: false,
    returnArrays: false,
    allowBareNamedParameters: false,
    allowUnknownNamedParameters: false,
    defensive: true,
  });
}


export function inspectOpenDatabase(database:DatabaseSync,expectedSchemaVersion?:number) {
 if(expectedSchemaVersion!==undefined) requireSupportedRecoverySchema(expectedSchemaVersion);
 const inspection=inspectNormalAuthority(database);
 return Object.freeze({...inspection,invariantViolations:inspection.invariants.violations,exactTableRegistry:true as const});
}

export function withAuthorityDatabaseReadOnly<Result>(admission:RuntimeAdmission,pathInput:string,read:(database:DatabaseSync)=>Result,busyTimeoutMs=250):Result {
 const path=resolve(pathInput);
 requireRuntimeAdmission(admission).assertReadOnlyAuthorityDatabase(path);
 requireDatabaseSourcePath(path);
 if(!existsSync(path)||statSync(path).size===0)throw new Error("authority-backup-source-missing");
 const snapshot=createReadonlyAuthoritySnapshot(path);
 let database:DatabaseSync;
 try {database=openReadOnlyDatabase(snapshot.path,busyTimeoutMs);} catch(error){snapshot.dispose();throw error;}
 let open=false;
 try { database.exec("PRAGMA query_only=ON; BEGIN");open=true;const result=read(database);database.exec("COMMIT");open=false;return result; }
 finally {try{if(open)database.exec("ROLLBACK");}finally{try{database.close();}finally{try{snapshot.assertUnchanged();}finally{snapshot.dispose();}}} }
}

export function inspectAuthorityBackupReadOnly(admission:RuntimeAdmission,path:string,expectedSchemaVersion?:number,busyTimeoutMs=250):BackupCopyInspection {
 return withAuthorityDatabaseReadOnly(admission,path,database=>inspectOpenDatabase(database,expectedSchemaVersion),busyTimeoutMs);
}
export function authorityBackupSourceDatabaseIdentity(path:string):string {
 return createHash("sha256").update(`${String(AUTHORITY_APPLICATION_ID)}:${resolve(path)}`).digest("hex");
}
export function openAuthorityBackupSourceReadOnly(admission:RuntimeAdmission,pathInput:string,busyTimeoutMs=250):AuthorityBackupSourceReadOnly {
 const path=resolve(pathInput);
 inspectAuthorityBackupReadOnly(admission,path,undefined,busyTimeoutMs);
 const snapshot=createReadonlyAuthoritySnapshot(path);
 let database:DatabaseSync;
 try {database=openReadOnlyDatabase(snapshot.path,busyTimeoutMs);}
 catch(error){snapshot.dispose();throw error;}
 try {database.exec("PRAGMA query_only=ON");}
 catch(error){try{database.close();}finally{snapshot.dispose();}throw error;}
 let closed=false;
 const assertOpen=()=>{admission.assertLive();if(closed)throw new Error("authority-backup-source-closed");snapshot.assertUnchanged();};
 return Object.freeze({
 getMeta(){assertOpen();const row=z.strictObject({schema_version:z.number().int().positive(),authority_generation:z.number().int().nonnegative(),updated_at:z.string().datetime()}).parse(database.prepare("SELECT schema_version,authority_generation,updated_at FROM database_states WHERE id=1").get());requireSupportedRecoverySchema(row.schema_version);return Object.freeze({schemaVersion:row.schema_version,authorityGeneration:row.authority_generation,updatedAt:row.updated_at});},
 getSourceDatabaseIdentity(){assertOpen();return authorityBackupSourceDatabaseIdentity(path);},
 async onlineBackupTo(destinationPath:string){assertOpen();admission.assertWritable();admission.assertStateRoot(destinationPath);const pages=await sqliteBackup(database,resolve(destinationPath),{rate:100});snapshot.assertUnchanged();return pages;},
 close(){if(closed)return;closed=true;try{database.close();}finally{try{snapshot.assertUnchanged();}finally{snapshot.dispose();}}},
 });
}
