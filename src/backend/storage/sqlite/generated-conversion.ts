import { sha256Hex } from "../../../rules/validation/sha256.js";

import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fsyncSync, fstatSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { ArtifactRefSchema } from "../../../models/artifacts/artifacts.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { GeneratedArtifactSchema, ArtifactOutboxStorageRecordSchema, ArtifactSinkHeadRecordSchema } from "../../../models/artifacts/generated-artifact.js";
import { OperatorXlsxExportEvidenceSchema, OPERATOR_XLSX_MEDIA_TYPE } from "../../../models/dashboard/xlsx-export.js";
import type { GeneratedSourceBackup } from "./generated-source-backup.js";
import { insertGeneratedArtifact } from "./generated-artifacts.js";

export const GENERATED_ARTIFACT_DDL = `CREATE TABLE generated_artifacts (
 record_key TEXT PRIMARY KEY, sink_id TEXT UNIQUE, export_id TEXT UNIQUE, version INTEGER NOT NULL CHECK(version>0),
 record_json TEXT NOT NULL CHECK(json_valid(record_json)), created_at TEXT NOT NULL,
 CHECK(record_key IS json_extract(record_json,'$.fileId')),
 CHECK(sink_id IS json_extract(record_json,'$.sinkId')),
 CHECK(export_id IS json_extract(record_json,'$.exportId')),
 CHECK(version IS json_extract(record_json,'$.version')),
 CHECK((sink_id IS NULL) <> (export_id IS NULL))
) STRICT`;
export const GENERATED_ARTIFACT_CONSTRAINTS = [
 `CREATE TRIGGER generated_artifact_insert_conflict BEFORE INSERT ON generated_artifacts
 WHEN EXISTS(SELECT 1 FROM generated_artifacts WHERE record_key=NEW.record_key OR sink_id=NEW.sink_id OR export_id=NEW.export_id)
 BEGIN SELECT RAISE(ABORT,'generated artifact insert conflicts with immutable evidence'); END`,
 `CREATE TRIGGER generated_artifact_evidence_immutable BEFORE UPDATE ON generated_artifacts
 WHEN NEW.record_key IS NOT OLD.record_key OR NEW.sink_id IS NOT OLD.sink_id OR NEW.export_id IS NOT OLD.export_id
 OR NEW.created_at IS NOT OLD.created_at OR NEW.version != OLD.version+1
 OR (json_extract(OLD.record_json,'$.exportEvidenceJson') IS NOT NULL AND json_extract(NEW.record_json,'$.exportEvidenceJson') IS NOT json_extract(OLD.record_json,'$.exportEvidenceJson'))
 OR (json_extract(OLD.record_json,'$.exportEvidenceFingerprint') IS NOT NULL AND json_extract(NEW.record_json,'$.exportEvidenceFingerprint') IS NOT json_extract(OLD.record_json,'$.exportEvidenceFingerprint'))
 OR json_extract(NEW.record_json,'$.exportRequest') IS NOT json_extract(OLD.record_json,'$.exportRequest')
 OR json_extract(NEW.record_json,'$.registration') IS NOT json_extract(OLD.record_json,'$.registration')
 OR EXISTS(SELECT 1 FROM json_each(OLD.record_json,'$.versions') old WHERE NOT EXISTS(SELECT 1 FROM json_each(NEW.record_json,'$.versions') next WHERE next.key=old.key AND next.value=old.value))
 OR EXISTS(SELECT 1 FROM json_each(OLD.record_json,'$.updates') old WHERE NOT EXISTS(SELECT 1 FROM json_each(NEW.record_json,'$.updates') next WHERE next.key=old.key
 AND json_remove(next.value,'$.record.state','$.record.projectedAt')=json_remove(old.value,'$.record.state','$.record.projectedAt')
 AND (json_extract(old.value,'$.record.state')='pending' OR next.value=old.value)))
 BEGIN SELECT RAISE(ABORT,'generated artifact evidence is immutable'); END`,
 `CREATE TRIGGER generated_artifact_evidence_retained BEFORE DELETE ON generated_artifacts BEGIN SELECT RAISE(ABORT,'generated artifact evidence is retained'); END`,
] as const;
const FileSchema = z.strictObject({ref:ArtifactRefSchema,payloadBase64:z.string()});
export const GeneratedSourceManifestSchema = z.strictObject({
 format:z.literal(1),backupSha256:z.string().regex(/^[a-f0-9]{64}$/),sourceDatabaseIdentity:z.string().regex(/^[a-f0-9]{64}$/),
 authorityGeneration:z.number().int().nonnegative(),
 files:z.array(FileSchema),sinks:z.array(z.strictObject({sinkId:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),artifact:ArtifactRefSchema})),
 unavailableExports:z.array(z.uuid()),
});
export type GeneratedSourceManifest = z.infer<typeof GeneratedSourceManifestSchema>;
const SinkInputSchema = z.strictObject({format:z.literal(1),sinks:z.array(z.strictObject({sinkId:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),filename:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.xlsx$/)}))});
const RowSchema=z.strictObject({record_json:z.string()});
const digest=(bytes:Buffer|string)=>createHash("sha256").update(bytes).digest("hex");
function fileBytes(path:string):Buffer {
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try { const stat=fstatSync(fd);if(!stat.isFile()||stat.size>64*1024*1024)throw new Error("generated-source-file-invalid");return readFileSync(fd); }
 finally {closeSync(fd);}
}
function directory(path:string):string {
 const absolute=resolve(path);let current=absolute;
 for(;;){const stat=lstatSync(current);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error("generated-source-directory-invalid");const parent=dirname(current);if(parent===current)break;current=parent;}
 return absolute;
}
function validateFile(input:unknown) {
 const file=FileSchema.parse(input);const bytes=Buffer.from(file.payloadBase64,"base64");
 if(bytes.toString("base64")!==file.payloadBase64||bytes.length!==file.ref.bytes||digest(bytes)!==file.ref.sha256)throw new Error("generated-source-bytes-conflict");return file;
}
function validateManifest(input:unknown,backup:GeneratedSourceBackup):GeneratedSourceManifest {
 const manifest=GeneratedSourceManifestSchema.parse(input);
 if(manifest.backupSha256!==backup.manifest.sha256||manifest.sourceDatabaseIdentity!==backup.manifest.sourceDatabaseIdentity||manifest.authorityGeneration!==backup.manifest.authorityGeneration)throw new Error("generated-source-backup-mismatch");
 const files=manifest.files.map(validateFile);if(new Set(files.map(f=>f.ref.sha256)).size!==files.length||new Set(manifest.sinks.map(s=>s.sinkId)).size!==manifest.sinks.length||new Set(manifest.unavailableExports).size!==manifest.unavailableExports.length)throw new Error("generated-source-duplicate-identity");
 for(const sink of manifest.sinks)if(!files.some(f=>canonicalJsonStringify(f.ref)===canonicalJsonStringify(sink.artifact)))throw new Error("generated-source-sink-bytes-missing");
 return manifest;
}
export function generatedSourceDigest(manifest:GeneratedSourceManifest):string{return digest(canonicalJsonStringify(manifest));}
/** --generated-from names either a reviewed sink mapping + files, or a preserved manifest directory. */
export function readGeneratedSources(database:DatabaseSync,stateRoot:string,backup:GeneratedSourceBackup,selected?:string):GeneratedSourceManifest {
 if(selected!==undefined&&existsSync(join(selected,"manifest.json")))return validateManifest(JSON.parse(fileBytes(join(directory(selected),"manifest.json")).toString("utf8")),backup);
 const heads=database.prepare("SELECT record_json FROM artifact_sink_heads ORDER BY record_key").all().map(raw=>ArtifactSinkHeadRecordSchema.parse(JSON.parse(RowSchema.parse(raw).record_json)));
 const exports=(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='operator_xlsx_exports'").get()===undefined ? [] : database.prepare("SELECT record_json FROM operator_xlsx_exports ORDER BY record_key").all()).map(raw=>OperatorXlsxExportEvidenceSchema.parse(JSON.parse(RowSchema.parse(raw).record_json)));
 const files=new Map<string,z.infer<typeof FileSchema>>();const sinks:GeneratedSourceManifest["sinks"]=[];const unavailableExports:string[]=[];
 if(heads.length>0 || selected!==undefined){
  if(selected===undefined)throw new Error("generated-source-heads-require-explicit-mapping");
  const root=directory(selected);const mapping=SinkInputSchema.parse(JSON.parse(fileBytes(join(root,"generated-sinks.json")).toString("utf8")));
  if(new Set(mapping.sinks.map(s=>s.sinkId)).size!==mapping.sinks.length||mapping.sinks.length!==heads.length)throw new Error("generated-source-sink-membership-conflict");
  for(const head of heads){const mapped=mapping.sinks.find(s=>s.sinkId===head.sinkId);if(mapped===undefined)throw new Error("generated-source-head-missing");
   const bytes=fileBytes(join(root,mapped.filename));const hash=digest(bytes);if(hash!==head.contentSha256)throw new Error("generated-source-head-bytes-conflict");
   let artifact=ArtifactRefSchema.parse({id:`${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`,sha256:hash,bytes:bytes.length,mediaType:OPERATOR_XLSX_MEDIA_TYPE});
   const retainedPath=join(stateRoot,"artifacts",`${hash}.artifact`);
   if(existsSync(retainedPath)){directory(dirname(retainedPath));const retained=validateFile(JSON.parse(fileBytes(retainedPath).toString("utf8")));if(retained.ref.sha256!==hash||retained.ref.mediaType!==OPERATOR_XLSX_MEDIA_TYPE)throw new Error("generated-source-retained-head-conflict");artifact=retained.ref;}
   files.set(hash,{ref:artifact,payloadBase64:bytes.toString("base64")});sinks.push({sinkId:head.sinkId,artifact});
  }
 }
 for(const evidence of exports){
  const path=join(stateRoot,"artifacts",`${evidence.artifact.sha256}.artifact`);
  if(!existsSync(path)){unavailableExports.push(evidence.exportId);continue;}
  directory(dirname(path));const file=validateFile(JSON.parse(fileBytes(path).toString("utf8")));
  if(canonicalJsonStringify(file.ref)!==canonicalJsonStringify(evidence.artifact))throw new Error("generated-export-reference-conflict");
  const previous=files.get(file.ref.sha256);if(previous!==undefined&&canonicalJsonStringify(previous.ref)!==canonicalJsonStringify(file.ref)) {

   for(const sink of sinks)if(sink.artifact.sha256===file.ref.sha256)sink.artifact=file.ref;
  }
  files.set(file.ref.sha256,file);
 }
 return validateManifest({format:1,backupSha256:backup.manifest.sha256,sourceDatabaseIdentity:backup.manifest.sourceDatabaseIdentity,authorityGeneration:backup.manifest.authorityGeneration,files:[...files.values()].sort((a,b)=>a.ref.sha256.localeCompare(b.ref.sha256)),sinks,unavailableExports},backup);
}
function sync(path:string){const fd=openSync(path,"r");try{fsyncSync(fd);}finally{closeSync(fd);}}
export function preserveGeneratedSources(manifest:GeneratedSourceManifest,backup:GeneratedSourceBackup):string {
 validateManifest(manifest,backup);const root=join(directory(dirname(backup.manifestPath)),"generated-sources");mkdirSync(root,{recursive:true,mode:0o700});directory(root);
 const target=join(root,generatedSourceDigest(manifest));if(existsSync(target)){readPreservedGeneratedSources(target,generatedSourceDigest(manifest),backup);return target;}
 const temp=mkdtempSync(join(root,".pending-"));try{writeFileSync(join(temp,"manifest.json"),canonicalJsonStringify(manifest),{flag:"wx",mode:0o400});sync(join(temp,"manifest.json"));sync(temp);renameSync(temp,target);sync(root);return target;}finally{if(existsSync(temp))rmSync(temp,{recursive:true});}
}
export function readPreservedGeneratedSources(path:string,expectedDigest:string,backup:GeneratedSourceBackup):GeneratedSourceManifest {
 const manifest=validateManifest(JSON.parse(fileBytes(join(directory(path),"manifest.json")).toString("utf8")),backup);
 if(generatedSourceDigest(manifest)!==expectedDigest)throw new Error("generated-source-copy-digest-conflict");return manifest;
}
export function installGeneratedSources(manifest:GeneratedSourceManifest,stateRoot:string):void {
 const root=join(directory(stateRoot),"artifacts");mkdirSync(root,{recursive:true,mode:0o700});directory(root);
 for(const file of manifest.files){validateFile(file);const target=join(root,`${file.ref.sha256}.artifact`);
  if(existsSync(target)){if(canonicalJsonStringify(validateFile(JSON.parse(fileBytes(target).toString("utf8"))))!==canonicalJsonStringify(file))throw new Error("generated-source-existing-artifact-conflict");continue;}
  const temp=join(root,`.generated-${file.ref.sha256}-${process.pid}.tmp`);writeFileSync(temp,canonicalJsonStringify(file),{flag:"wx",mode:0o600});try{sync(temp);linkSync(temp,target);sync(root);}finally{rmSync(temp);}
 }
}
export function convertGeneratedArtifacts(database:DatabaseSync,manifest:GeneratedSourceManifest|undefined):void {
 const rows=database.prepare("SELECT record_json FROM artifact_outbox ORDER BY created_at,record_key").all().map(raw=>ArtifactOutboxStorageRecordSchema.parse(JSON.parse(RowSchema.parse(raw).record_json)));
 const heads=database.prepare("SELECT record_json FROM artifact_sink_heads ORDER BY record_key").all().map(raw=>ArtifactSinkHeadRecordSchema.parse(JSON.parse(RowSchema.parse(raw).record_json)));
 for(const head of heads)if(!rows.some(row=>row.sinkId===head.sinkId&&row.outboxId===head.lastOutboxId&&row.state==="projected"&&row.projectedAt===head.projectedAt))throw new Error("generated-head-update-link-conflict");
 if(heads.length>0&&manifest===undefined)throw new Error("generated-source-evidence-required");
 if(manifest!==undefined&&(manifest.sinks.length!==heads.length||manifest.sinks.some(s=>!heads.some(h=>h.sinkId===s.sinkId&&h.contentSha256===s.artifact.sha256))))throw new Error("generated-source-head-membership-conflict");
 for(const sinkId of [...new Set(rows.map(r=>r.sinkId))]){
  const owned=rows.filter(r=>r.sinkId===sinkId);const head=heads.find(h=>h.sinkId===sinkId)??null;
  if(head===null&&owned.some(r=>r.state==="projected"))throw new Error("generated-completed-updates-missing-head");
  const artifact=manifest?.sinks.find(s=>s.sinkId===sinkId)?.artifact;
  const versions=artifact===undefined?[]:[{state:"verified" as const,artifact}];
  // Missing retained generation bytes remain explicit gaps.

  insertGeneratedArtifact(database,GeneratedArtifactSchema.parse({format:1,fileId:`sink:${sinkId}`,sinkId,exportId:null,exportRequest:null,registration:null,exportEvidenceJson:null,exportEvidenceFingerprint:null,mediaType:OPERATOR_XLSX_MEDIA_TYPE,
   state:owned.some(r=>r.state==="pending")?"pending":"ready",historyCoverage:head!==null&&head.generation>1?"historical-gaps":"complete",version:1,head,updates:owned.map((record,index)=>({sequence:index+1,record})),versions,prepared:null,createdAt:owned[0]?.createdAt}));
 }
 for(const raw of database.prepare("SELECT record_json FROM operator_xlsx_exports ORDER BY record_key").all()){
  const json=RowSchema.parse(raw).record_json;const evidence=OperatorXlsxExportEvidenceSchema.parse(JSON.parse(json));
  if(manifest===undefined)throw new Error("generated-export-source-evidence-required");
  const file=manifest.files.find(f=>f.ref.id===evidence.artifact.id);const missing=manifest.unavailableExports.includes(evidence.exportId);
  if((file===undefined)===!missing||file!==undefined&&canonicalJsonStringify(file.ref)!==canonicalJsonStringify(evidence.artifact))throw new Error("generated-export-source-identity-conflict");
  insertGeneratedArtifact(database,GeneratedArtifactSchema.parse({format:1,fileId:`export:${evidence.exportId}`,sinkId:null,exportId:evidence.exportId,exportRequest:null,registration:null,exportEvidenceJson:json,exportEvidenceFingerprint:sha256Hex(json),mediaType:evidence.artifact.mediaType,
   state:missing?"unavailable":"ready",historyCoverage:"historical-gaps",version:1,head:null,updates:[],versions:[missing?{state:"unavailable",sha256:evidence.artifact.sha256,reason:"missing-bytes"}:{state:"verified",artifact:evidence.artifact}],prepared:null,createdAt:evidence.createdAt}));
 }
}

export function readGeneratedSourcesAtPath(admission:import("../admission/admission.js").RuntimeAdmission,path:string,stateRoot:string,backup:GeneratedSourceBackup,selected?:string):GeneratedSourceManifest {
 admission.assertReadOnlyAuthorityDatabase(path);
 admission.assertStateRoot(stateRoot);
 const source=new DatabaseSync(path,{readOnly:true});
 try{return readGeneratedSources(source,stateRoot,backup,selected);}finally{source.close();}
}

/** A repeat authenticates selected source files against the preserved copy, never against artifacts the conversion itself installed. */
export function verifyGeneratedSelection(selected:string,manifest:GeneratedSourceManifest,backup:GeneratedSourceBackup):void {
 const root=directory(selected);
 if(existsSync(join(root,"manifest.json"))){
  const source=validateManifest(JSON.parse(fileBytes(join(root,"manifest.json")).toString("utf8")),backup);
  if(generatedSourceDigest(source)!==generatedSourceDigest(manifest))throw new Error("generated-import-source-changed");
  return;
 }
 const mapping=SinkInputSchema.parse(JSON.parse(fileBytes(join(root,"generated-sinks.json")).toString("utf8")));
 if(new Set(mapping.sinks.map(s=>s.sinkId)).size!==mapping.sinks.length||mapping.sinks.length!==manifest.sinks.length)throw new Error("generated-source-sink-membership-conflict");
 for(const sink of manifest.sinks){
  const entry=mapping.sinks.find(s=>s.sinkId===sink.sinkId);if(entry===undefined)throw new Error("generated-source-head-missing");
  const bytes=fileBytes(join(root,entry.filename));if(bytes.length!==sink.artifact.bytes||digest(bytes)!==sink.artifact.sha256)throw new Error("generated-source-head-bytes-conflict");
 }
}
