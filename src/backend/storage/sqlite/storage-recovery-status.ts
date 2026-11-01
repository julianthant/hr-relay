import { privatePathRejects } from "../private-path.js";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, type Stats } from "node:fs";
import { join } from "node:path";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { RUNTIME_ROOT_AUTHORITY_ENTRY_NAMES } from "../admission/installation.js";
import { requireDatabaseSourcePath } from "./recovery-admission.js";
import { AuthorityDatabase } from "./authority-database.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "./migrations.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { StorageRecoveryInspectionSchema, type RestoreCandidate } from "./recovery-contracts.js";

const RestoreEntry = /^\.restore-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.sqlite\.tmp(?:-(?:wal|shm)(?:\.live-companion)?)?$/u;
function fileIdentity(stat: Stats) {
  return canonicalJsonStringify({dev:stat.dev,ino:stat.ino,size:stat.size,mode:stat.mode,uid:stat.uid,nlink:stat.nlink,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs});
}

/** Stable evidence identity fences the doctor's awaited backup inspection. */
export function inspectStorageRecovery(admission: Readonly<Pick<RuntimeAdmission, "stateRoot" | "assertLive" | "authorityBackupExpectedSource">>, sourceIdentity: string) {
  admission.assertLive();
  const stateRoot=admission.stateRoot;
  const findings: {marker:"authority-restore" | "unowned-recovery-entry";state:"interrupted" | "unavailable"}[]=[];
  const identities:string[]=[sourceIdentity];
  try {
    requireDatabaseSourcePath(join(stateRoot,"state.db"));
    if(sourceIdentity !== AuthorityDatabase.sourceDatabaseIdentity(admission.authorityBackupExpectedSource()))throw new Error("recovery-source-identity-mismatch");
    const root=lstatSync(stateRoot);
    if(!root.isDirectory())throw new Error("recovery-root-unavailable");
    const entries=readdirSync(stateRoot).sort();
    for(const name of entries.filter(name=>(name.startsWith(".") && !RUNTIME_ROOT_AUTHORITY_ENTRY_NAMES.includes(name))
      || (/\.(?:sqlite|db)(?:-(?:wal|shm))?$/u.test(name) && !["state.db","state.db-wal","state.db-shm"].includes(name)))) {
      const marker=RestoreEntry.test(name) ? "authority-restore" as const : "unowned-recovery-entry" as const;
      if(marker === "unowned-recovery-entry") {
        findings.push({marker,state:"unavailable"});identities.push(`${name}:unowned`);continue;
      }
      const path=join(stateRoot,name);
      let descriptor:number | undefined;
      try {
        const before=lstatSync(path);
        if(!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
          || privatePathRejects(path, before, "group-write"))throw new Error("recovery-evidence-unavailable");
        descriptor=openSync(path,constants.O_RDONLY | constants.O_NOFOLLOW);
        if(fileIdentity(fstatSync(descriptor)) !== fileIdentity(before)
          || fileIdentity(lstatSync(path)) !== fileIdentity(before))throw new Error("recovery-evidence-changed");
        identities.push(`${name}:${fileIdentity(before)}`);findings.push({marker,state:"interrupted"});
      } catch {
        identities.push(`${name}:unavailable`);findings.push({marker,state:"unavailable"});
      } finally {if(descriptor !== undefined)closeSync(descriptor);}
    }
    if(fileIdentity(lstatSync(stateRoot)) !== fileIdentity(root)
      || canonicalJsonStringify(readdirSync(stateRoot).sort()) !== canonicalJsonStringify(entries))throw new Error("recovery-inventory-changed");
  } catch {
    return {identity:"recovery-inventory-unavailable",report:StorageRecoveryInspectionSchema.parse({state:"unavailable",findings,
      cause:{code:"authority-unavailable",summary:"Recovery evidence could not be inspected safely. Preserve it before recovery."}})};
  }
  const report=findings.some(row=>row.state === "unavailable")
    ? {state:"unavailable",findings,cause:{code:"authority-unavailable",summary:"Recovery evidence is unsafe or has no current owner. Preserve it before recovery."}}
    : findings.length > 0 ? {state:"interrupted",findings} : {state:"clear"};
  return {identity:createHash("sha256").update(canonicalJsonStringify(identities)).digest("hex"),report:StorageRecoveryInspectionSchema.parse(report)};
}

type Eligibility = Extract<RestoreCandidate, {state: "verified-compatible"}>["restoreEligibility"];
export function inspectRestoreEligibility(admission: RuntimeAdmission,input: {schemaVersion:number; backupPath:string; backupSha256:string;stateRoot:string;authorityAvailable:boolean}):Eligibility {
 admission.assertLive();
 if(input.schemaVersion!==CURRENT_AUTHORITY_SCHEMA_VERSION)return {state:"unsupported",reason:"The backup uses an unsupported authority schema. Preserve it and use its compatible release."};
 if(!input.authorityAvailable)return {state:"unavailable",reason:"Current authority could not be inspected safely. Preserve it before recovery."};
 return {state:"eligible"};
}
