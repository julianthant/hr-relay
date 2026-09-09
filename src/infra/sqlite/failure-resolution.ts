import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { FailureResolutionSchema, FailureResolutionCaptureSchema } from "../../domain/trust/failure-resolution.js";
interface FailureResolutionPorts {
 database: DatabaseSync;
 mutate<T>(work:()=>Readonly<{result:T;changes:number}>):T;
}
const RowSchema=z.strictObject({record_key:z.string(),run_id:z.string(),resolution_json:z.string(),resolution_version:z.number().int().positive()});
export function createFailureResolutionRepository(ports:FailureResolutionPorts) {
 const read=(runId:string,failureId:string)=>{
  const raw=ports.database.prepare("SELECT record_key,run_id,resolution_json,resolution_version FROM run_failures WHERE record_key=? AND run_id=?").get(failureId,runId);
  if(raw===undefined)return undefined;
  const row=RowSchema.parse(raw);const resolution=FailureResolutionSchema.parse(JSON.parse(row.resolution_json));
  if(resolution.version!==row.resolution_version)throw new Error("failure-resolution-version-mismatch");
  return FailureResolutionCaptureSchema.parse({failureId:row.record_key,runId:row.run_id,resolution});
 };
 return Object.freeze({read,
  update(input:unknown){
   const request=z.strictObject({runId:z.uuid(),failureId:z.uuid(),expectedVersion:z.number().int().positive(),resolution:FailureResolutionSchema}).parse(input);
   return ports.mutate(()=>{
    const existing=read(request.runId,request.failureId);
    if(existing===undefined||existing.resolution.version!==request.expectedVersion||request.resolution.version!==request.expectedVersion+1)throw new Error("failure-resolution-version-conflict");
    const owner=ports.database.prepare("SELECT 1 FROM workflow_runs WHERE record_key=? AND NOT EXISTS(SELECT 1 FROM deleted_runs WHERE record_key=?)").get(request.runId,request.runId);
    if(owner===undefined)throw new Error("failure-resolution-owner-unavailable");
    const changes=Number(ports.database.prepare("UPDATE run_failures SET resolution_json=?,resolution_version=? WHERE record_key=? AND run_id=? AND resolution_version=?")
     .run(JSON.stringify(request.resolution),request.resolution.version,request.failureId,request.runId,request.expectedVersion).changes);
    if(changes!==1)throw new Error("failure-resolution-version-conflict");
    return {result:FailureResolutionCaptureSchema.parse({failureId:request.failureId,runId:request.runId,resolution:request.resolution}),changes};
   });
  },
 });
}
