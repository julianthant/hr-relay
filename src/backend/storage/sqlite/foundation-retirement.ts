import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { VerifiedBackup } from "./backup-service.js";
import type { RuntimeAdmission } from "../admission/admission.js";
const CountSchema=z.strictObject({count:z.number().int().nonnegative()});
/** No producer ever owned these placeholders. Population requires classification, never deletion. */
export function assertFoundationRetirement(admission:RuntimeAdmission,database:DatabaseSync,backup:VerifiedBackup|undefined):void {
 for(const table of ["spans","gates","notes","ocr_approvals"] as const){
  if(CountSchema.parse(database.prepare(`SELECT count(*) AS count FROM ${table}`).get()).count!==0)throw new Error(`foundation-retirement-unclassified:${table}`);
 }
 const history=["knowledge_records","fix_records"].some(table=>CountSchema.parse(database.prepare(`SELECT count(*) AS count FROM ${table}`).get()).count>0);
 if(history&&backup===undefined)throw new Error("foundation-retirement-verified-backup-required");
 if(history&&backup!==undefined){
  const copyAdmission=admission.verifiedReadOnlyCopy(backup.backupPath,backup.manifest.sha256,"authority");
  try {
   copyAdmission.assertReadOnlyAuthorityDatabase(backup.backupPath);
   const preserved=new DatabaseSync(backup.backupPath,{readOnly:true});
   try {for(const table of ["knowledge_records","fix_records"]){
    const retained=preserved.prepare(`SELECT * FROM ${table} ORDER BY record_key`).all();
    const current=database.prepare(`SELECT * FROM ${table} ORDER BY record_key`).all();
    if(JSON.stringify(retained)!==JSON.stringify(current))throw new Error("foundation-retirement-backup-content-mismatch");
   }}finally{preserved.close();}
  } finally {copyAdmission.release();}
 }
}
