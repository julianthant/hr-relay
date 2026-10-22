import { runSearchIndexFromRow } from "./run-search-index.js";
import { importedArtifactFromRow } from "./imported-artifacts.js";
import { generatedArtifactFromRow } from "./generated-artifacts.js";
import { extractedArtifactFromRow } from "./extracted-artifact-row.js";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { DeletedRunRecordSchema, type RunDeleteInput } from "../../../models/run/deleted-run.js";
import { DiagnosticAttachmentStorageRecordSchema } from "./storage-records.js";
import { RunCheckpointRecordSchema } from "../../../models/workflow/checkpoint.js";
import type { ArtifactRef } from "../../../models/artifacts/artifacts.js";
import type { RunRecord } from "../../../models/run/record.js";
import { nativeOrdinaryRecordFromRow } from "./native-record-row.js";
import { runRecordFromRow } from "./run-record-row.js";
import { timelineEventFromRow } from "./timeline-repository.js";
import { commandFromRow } from "./command-record-row.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { DeletionFilesSchema, deletedRunFromRow, type DeletionFileSchema } from "./deleted-run-row.js";

export class RunDeletionRefusedError extends Error {
  constructor(readonly reason: "shared-checkpoint" | "unresolved-write") {
    super(reason === "shared-checkpoint" ? "This run owns a checkpoint still referenced by retained evidence." : "This run has an unresolved external write.");
    this.name = "RunDeletionRefusedError";
  }
}
type FileEvidence = z.infer<typeof DeletionFileSchema>;
function containsReference(value: unknown, checkpoint: z.infer<typeof RunCheckpointRecordSchema>, inheritedNodeId?: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(item => containsReference(item,checkpoint,inheritedNodeId));
  const record = z.record(z.string(),z.unknown()).parse(value);
  if (record.runId === checkpoint.runId && record.workflowId === checkpoint.workflowId && record.itemId === checkpoint.itemId
    && (record.nodeId ?? inheritedNodeId) === checkpoint.nodeId && record.attempt === checkpoint.attempt && record.claimGeneration === checkpoint.claimGeneration) return true;
  return Object.values(record).some(item => containsReference(item,checkpoint,record.nodeId ?? inheritedNodeId));
}

function isSettledCascadeTerminalization(database:DatabaseSync,command:ReturnType<typeof commandFromRow>,commandRow:unknown,cascade:Set<string>):boolean {
  const {target_id,state}=z.object({target_id:z.string().nullable(),state:z.string()}).parse(commandRow);
  if(!("kind" in command) || command.kind!=="run-lifecycle" || command.operation!=="terminalize"
    || target_id===null || !cascade.has(target_id) || state!=="succeeded")return false;
  const raw=database.prepare("SELECT * FROM command_audits WHERE command_id=?").get(command.commandId);
  if(raw===undefined)throw new Error("run-deletion-terminal-audit-missing");
  const audit=nativeOrdinaryRecordFromRow("command_audits",raw);
  const owner=z.object({request:z.unknown(),result:z.object({kind:z.literal("run"),runId:z.string()})}).parse(audit);
  if(canonicalJsonStringify(owner.request)!==canonicalJsonStringify(command) || owner.result.runId!==target_id)throw new Error("run-deletion-terminal-owner-mismatch");
  return true;
}

export function containsDeletionArtifactReference(value: unknown, ref: ArtifactRef): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(item => containsDeletionArtifactReference(item,ref));
  const record = z.record(z.string(),z.unknown()).parse(value);
  if (record.artifactId === ref.id || record.sha256 === ref.sha256 || record.digest === ref.sha256) return true;
  return Object.values(record).some(item => containsDeletionArtifactReference(item,ref));
}

export function prepareNativeRunDeletion(database: DatabaseSync, run: RunRecord, request: RunDeleteInput,
  captureFile: (ref: ArtifactRef) => Omit<FileEvidence,"disposition">, phase: "execution" | "preflight" = "execution") {
  const runId = run.envelope.runId;
  const cascade = new Set<string>(request.cascadeRunIds);
  if (!cascade.has(runId)) throw new Error("run-deletion-cascade-owner-missing");
  if (run.lifecycle.state !== "terminal") throw new Error("terminal-run-tombstone-required");
  for (const child of database.prepare("SELECT id FROM runs WHERE parent_id=?").all(runId)) {
    const id = z.object({id:z.string()}).parse(child).id;
    if (phase === "execution" || !cascade.has(id)) throw new Error("run-deletion-children-remain");
  }
  const retained: unknown[] = [];
  const currentCascade = new Map<string,RunRecord>();
  for (const raw of database.prepare("SELECT * FROM runs").all()) {
    const peer = runRecordFromRow(raw);
    if (!cascade.has(peer.envelope.runId)) retained.push(peer);
    else {
      if (peer.lifecycle.state !== "terminal") throw new Error("run-deletion-cascade-nonterminal");
      currentCascade.set(peer.envelope.runId,peer);
    }
  }
  for (const id of cascade) if (!currentCascade.has(id)) {
    const raw = database.prepare("SELECT * FROM deleted_runs WHERE run_id=?").get(id);
    if (raw === undefined || deletedRunFromRow(raw).receipt.commandId !== request.commandId) throw new Error("run-deletion-cascade-member-missing");
  }
  const roots = [...currentCascade.values()].filter(member=>member.envelope.parent === undefined || !cascade.has(member.envelope.parent.runId));
  if (roots.length !== 1) throw new Error("run-deletion-cascade-disconnected");
  const root = roots[0];
  if (root === undefined) throw new Error("run-deletion-cascade-root-missing");
  const commandRaw = database.prepare("SELECT * FROM commands WHERE id=?").get(request.commandId);
  if (commandRaw === undefined) throw new Error("run-deletion-command-missing");
  const command = commandFromRow(commandRaw);
  const publicDelete = "family" in command && command.family === "run" && command.type === "delete" && command.target.runId === root.envelope.runId;
  const internalDelete = "kind" in command && command.kind === "run-lifecycle" && command.operation === "delete"
    && z.object({request:z.object({runId:z.string()})}).safeParse(command).data?.request.runId === root.envelope.runId;
  if (!publicDelete && !internalDelete) throw new Error("run-deletion-command-target-mismatch");
  for (const raw of database.prepare("SELECT * FROM timeline_events").all()) {
    const event = timelineEventFromRow(raw);
    if (event.scope.kind !== "run" || !cascade.has(event.scope.runId)) retained.push(event);
  }
  for (const table of ["run_results","run_receipts","run_checkpoints","diagnostic_snapshots","write_intents","write_attempts","commands","command_audits","artifacts"] as const) {
    for (const raw of database.prepare(`SELECT * FROM ${table}`).all()) {
      if (table === "commands") {
        const command=commandFromRow(raw);
        if(!isSettledCascadeTerminalization(database,command,raw,cascade))retained.push(command);
        continue;
      }
      if(table === "command_audits") {
        const {command_id}=z.object({command_id:z.string()}).parse(raw);
        const owner=database.prepare("SELECT * FROM commands WHERE id=?").get(command_id);
        if(owner===undefined)throw new Error("run-deletion-audit-command-missing");
        const command=commandFromRow(owner);
        const audit=nativeOrdinaryRecordFromRow(table,raw);
        if(canonicalJsonStringify(z.object({request:z.unknown()}).parse(audit).request)!==canonicalJsonStringify(command))throw new Error("run-deletion-audit-command-mismatch");
        if(!isSettledCascadeTerminalization(database,command,owner,cascade))retained.push(audit);
        continue;
      }
      if (table === "artifacts") {
        const {kind} = z.object({kind:z.enum(["imported","generated","extracted"])}).parse(raw);
        retained.push(kind === "imported" ? importedArtifactFromRow(raw) : kind === "generated" ? generatedArtifactFromRow(raw) : extractedArtifactFromRow(raw));
        continue;
      }
      const record = nativeOrdinaryRecordFromRow(table,raw);
      const identity = z.object({runId:z.string().optional()}).parse(record);
      if (table === "write_intents" || table === "write_attempts" || identity.runId === undefined || !cascade.has(identity.runId)) retained.push(record);
      if (table === "write_intents" && identity.runId === runId) {
        const {status} = z.object({status:z.string()}).parse(record);
        if (status === "attempting" || status === "parked") throw new RunDeletionRefusedError("unresolved-write");
      }
    }
  }
  const checkpoints = database.prepare("SELECT * FROM run_checkpoints WHERE run_id=?").all(runId)
    .map(raw => RunCheckpointRecordSchema.parse(nativeOrdinaryRecordFromRow("run_checkpoints",raw)));
  for (const checkpoint of checkpoints) if (retained.some(value => containsReference(value,checkpoint))) throw new RunDeletionRefusedError("shared-checkpoint");
  const steps = [
    {table:"delegation_dependencies",key:"id",where:"delegation_id IN (SELECT id FROM run_delegations WHERE parent_run_id=?)"},
    {table:"run_delegations",key:"id",where:"parent_run_id=?"},
    {table:"diagnostic_files",key:"id",where:"snapshot_id IN (SELECT id FROM diagnostic_snapshots WHERE run_id=?)"},
    {table:"diagnostic_snapshots",key:"id",where:"run_id=?"},
    {table:"run_receipts",key:"id",where:"run_id=?"},
    {table:"run_results",key:"run_id",where:"run_id=?"},
    {table:"run_failures",key:"id",where:"run_id=?"},
    {table:"timeline_events",key:"cursor",where:"run_id=?"},
    {table:"gate_results",key:"id",where:"run_id=?"},
    {table:"run_checkpoints",key:"id",where:"run_id=?"},
    {table:"dryrun_results",key:"id",where:"run_id=?"},
    {table:"run_search",key:"run_id",where:"run_id=?"},
    {table:"runs",key:"id",where:"id=?"},
  ] as const;
  const plan = steps.map(step => ({...step,keys:database.prepare(`SELECT * FROM ${step.table} WHERE ${step.where}`).all(runId).map(raw => {
    if (step.table === "runs") runRecordFromRow(raw);
    else if (step.table === "timeline_events") timelineEventFromRow(raw);
    else if (step.table === "run_search") runSearchIndexFromRow(raw,run,false);
    else nativeOrdinaryRecordFromRow(step.table,raw);
    return z.union([z.string(),z.number()]).parse(Reflect.get(raw,step.key));
  })}));
  const files = new Map<string,FileEvidence>();
  for (const raw of database.prepare("SELECT * FROM diagnostic_files WHERE snapshot_id IN (SELECT id FROM diagnostic_snapshots WHERE run_id=?)").all(runId)) {
    const {attachment} = DiagnosticAttachmentStorageRecordSchema.parse(nativeOrdinaryRecordFromRow("diagnostic_files",raw));
    const captured = captureFile({id:attachment.artifactId,sha256:attachment.digest,bytes:attachment.byteLength,mediaType:attachment.mediaType});
    const file: FileEvidence = {...captured,disposition:retained.some(value => containsDeletionArtifactReference(value,captured.ref)) ? "retain" : "remove"};
    const existing = files.get(file.ref.sha256);
    if (existing !== undefined && canonicalJsonStringify(existing) !== canonicalJsonStringify(file)) throw new Error("run-deletion-file-identity-mismatch");
    files.set(file.ref.sha256,file);
  }
  const receipt = DeletedRunRecordSchema.parse({runId,workflow:run.envelope.workflow,itemId:run.envelope.itemId,attempt:run.envelope.attempt,
    runNumber:run.runNumber ?? null,traceId:run.envelope.traceId,ordinalSource:"tombstone",origin:request.origin,commandId:request.commandId,
    deletedAt:request.now,tallyVersion:3,removed:plan.filter(step => step.keys.length > 0).map(step => ({table:step.table,rows:step.keys.length}))});
  return {receipt,files:DeletionFilesSchema.parse([...files.values()]),plan};
}

export function executeNativeRunDeletion(database: DatabaseSync, prepared: ReturnType<typeof prepareNativeRunDeletion>, afterStep?: (step: "tombstone" | "cascade-complete" | z.infer<typeof DeletedRunRecordSchema>["removed"][number]["table"]) => void) {
  const {receipt,files,plan} = prepared;
  database.prepare("INSERT INTO deleted_runs VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(receipt.runId,receipt.workflow,receipt.itemId,receipt.attempt,
    receipt.runNumber,receipt.traceId,receipt.commandId,receipt.deletedAt,"pending",canonicalJsonStringify(receipt),canonicalJsonStringify(files));
  afterStep?.("tombstone");
  for (const step of plan) {
    let changes = 0;
    for (const key of step.keys) changes += Number(database.prepare(`DELETE FROM ${step.table} WHERE ${step.key}=?`).run(key).changes);
    if (changes !== step.keys.length) throw new Error(`run-deletion-tally-mismatch:${step.table}`);
    afterStep?.(step.table);
  }
  afterStep?.("cascade-complete");
  return receipt;
}
