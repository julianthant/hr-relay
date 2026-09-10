import { DatabaseSync } from "node:sqlite";
import { existsSync, lstatSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync, fsyncSync, constants } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";

const JournalSchema = z.strictObject({schemaVersion:z.literal(1), sourceIdentity:z.string().regex(/^[a-f0-9]{64}$/u),
  backupSha256:z.string().regex(/^[a-f0-9]{64}$/u), recordedAt:z.string().datetime()});
const pathFor = (root:string) => join(root,".archive-conversion.json");
function syncRoot(root:string) { const fd=openSync(root,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);} }
export function readArchiveUpgradeJournal(root:string) {
  const path=pathFor(root);
  if(!existsSync(path))return undefined;
  if(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink())throw new Error("archive-conversion-journal-invalid");
  return JournalSchema.parse(JSON.parse(readFileSync(path,"utf8")));
}
export function beginArchiveUpgrade(root:string,input:z.input<typeof JournalSchema>) {
  const record=JournalSchema.parse(input),prior=readArchiveUpgradeJournal(root);
  if(prior!==undefined){if(canonicalJsonStringify(prior)!==canonicalJsonStringify(record))throw new Error("archive-conversion-resume-mismatch");return;}
  writeFileSync(pathFor(root),canonicalJsonStringify(record),{flag:"wx",mode:0o600,flush:true});syncRoot(root);
}
export function finishArchiveUpgrade(root:string) {
  if(readArchiveUpgradeJournal(root)===undefined)return;
  unlinkSync(pathFor(root));syncRoot(root);
}

export function hasHistoricalArchiveSources(path:string):boolean {
  if(!existsSync(path))return false;
  const database=new DatabaseSync(path,{readOnly:true});
  try{return database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='archived_runs'").get()!==undefined
    && database.prepare("SELECT 1 FROM archived_runs LIMIT 1").get()!==undefined;}
  finally{database.close();}
}
