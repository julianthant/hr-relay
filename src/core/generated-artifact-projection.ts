import { canonicalJsonStringify } from "../domain/canonical-json.js";
import { deriveStableUuid } from "../domain/identifiers.js";
import { deriveArtifactProjectionRows, type DerivedArtifactProjectionRow } from "../domain/workflow/artifact-projection.js";
import type { AuthorityRepositories } from "../backend/storage/sqlite/authority-database.js";
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

/** IDs commit to the complete source checkpoint, not the workbook's reusable key. */
export function generatedUpdateId(checkpoint: RunCheckpointRecord, row: DerivedArtifactProjectionRow): string {
 return deriveStableUuid("hrauto:checkpoint-artifact-update:v1", canonicalJsonStringify({ checkpoint, row }));
}

/** Call within one authority transaction: checkpoint witnesses and pending rows must share a view.
 * Historical random IDs require a unique source witness; ambiguity never consumes work.
 */
export function pendingGeneratedUpdateIds(repositories: AuthorityRepositories, checkpoint: RunCheckpointRecord, specs: readonly unknown[]): readonly string[] {
 const derive = (record: RunCheckpointRecord) => deriveArtifactProjectionRows({ specs,
  nodeId: record.nodeId, outputValue: record.output.value });
 const target = derive(checkpoint);
 const targetIdentity = canonicalJsonStringify(checkpoint);
 const expected = new Set(target.map(row => generatedUpdateId(checkpoint, row)));
 const candidates = repositories.runCheckpoints.listByItem(checkpoint.workflowId, checkpoint.itemId)
  .filter(record => record.runId === checkpoint.runId && record.nodeId === checkpoint.nodeId
   && record.output.schemaHash === checkpoint.output.schemaHash)
  .flatMap(record => derive(record).map(row => ({ record, row, id: generatedUpdateId(record, row) })));
 const bound = new Set(candidates.map(candidate => candidate.id));
 const matches = (update: ReturnType<typeof repositories.artifactOutbox.listPending>[number], record: RunCheckpointRecord, row: DerivedArtifactProjectionRow) =>
  update.sourceRunId === record.runId && update.sourceNodeId === record.nodeId
  && update.projectionId === row.projectionId && update.sinkId === row.sinkId
  && update.stableKeyFingerprint === row.stableKeyFingerprint
  && canonicalJsonStringify(update.keyValues) === canonicalJsonStringify(row.keyValues)
  && canonicalJsonStringify(update.payload) === canonicalJsonStringify({ schemaHash: record.output.schemaHash, value: row.value });
 return repositories.artifactOutbox.listPending().filter(update => {
  if (expected.has(update.outboxId)) {
   if (!target.some(row => matches(update, checkpoint, row))) throw new Error("generated-artifact-checkpoint-mismatch");
   return true;
  }
  if (bound.has(update.outboxId) || !target.some(row => matches(update, checkpoint, row))) return false;
  // New writers mint version-five commitments. An unbound commitment is never
  // reinterpreted as a historical random ID, even if its row values coincide.
  if (update.outboxId[14] === "5") throw new Error("generated-artifact-checkpoint-unresolved");
  const witnesses = candidates.filter(candidate => matches(update, candidate.record, candidate.row));
  if (witnesses.length !== 1 || canonicalJsonStringify(witnesses[0]?.record) !== targetIdentity) {
   throw new Error("generated-artifact-checkpoint-ambiguous");
  }
  return true;
 }).map(update => update.outboxId);
}
