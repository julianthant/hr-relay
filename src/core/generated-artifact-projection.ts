import type { AuthorityRepositories } from "../infra/sqlite/authority-database.js";
import type { RunCheckpointRecord } from "../domain/workflow/checkpoint.js";
/** The checkpoint and every distinct output update share the actual outer transaction. */
export function commitGeneratedCheckpoint(input:Readonly<{
 withTransaction<T>(work:(repositories:AuthorityRepositories)=>T):T;
 checkpoint:RunCheckpointRecord;
 updates:readonly unknown[];
}>):void {
 input.withTransaction(repositories=>{
  repositories.runCheckpoints.insert(input.checkpoint);
  for(const update of input.updates)repositories.artifactOutbox.insert(update);
 });
}
export async function projectGeneratedUpdates(projector:Readonly<{projectOutbox(ids:readonly string[]):Promise<Readonly<{projected:number}>>}>,ids:readonly string[]):Promise<void>{
 await projector.projectOutbox(ids);
}
