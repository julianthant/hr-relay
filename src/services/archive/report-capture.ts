import { NoteWireSchema, projectNoteForOperator } from "../../events/types.js";
import { hasProtectedTransactionInput } from "../../domain/protected-input.js";
import { DiagnosticAttachmentStorageRecordSchema } from "../../infra/sqlite/storage-records.js";
import { retainedRunProtectedBindings, valueFreeProtectedData } from "../../domain/protected-input.js";
import { sealArchiveReport, type ArchiveReport } from "../../domain/archive/report.js";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { sha256Hex } from "../../domain/sha256.js";
import { lifecycleSourceDigest, type LifecycleSourceSnapshot } from "../../core/run-lifecycle-storage.js";

/** Baseline source capture preserves source bytes separately from generic display content. */
export function captureArchiveReport(input: Readonly<{
  snapshot: LifecycleSourceSnapshot; transferId: string; capturedAt: string;
  sections: ArchiveReport["content"]["sections"]; files: ArchiveReport["content"]["files"];
}>): ArchiveReport {
  const { run } = input.snapshot;
  if (run.lifecycle.state !== "terminal") throw new Error("archive-source-not-terminal");
  const json = canonicalJsonStringify(input.snapshot);
  const files=input.files.map(file=>({...file,artifactIds:[...(file.artifactIds??[])]}));
  for(const row of input.snapshot.records.find(group=>group.table==="diagnostic_files")?.rows??[]) {
    const {attachment}=DiagnosticAttachmentStorageRecordSchema.parse(JSON.parse(row.json));
    const retained=files.find(file=>file.digest===attachment.digest && file.byteLength===attachment.byteLength && file.mediaType===attachment.mediaType);
    if(retained===undefined)throw new Error("archive-capture-file-omitted");
    if(!retained.artifactIds.includes(attachment.artifactId))retained.artifactIds.push(attachment.artifactId);
  }
  const bindings=retainedRunProtectedBindings(run);
  const sections:ArchiveReport["content"]["sections"]=[
    {kind:"text",title:"Frozen inputs",text:canonicalJsonStringify(valueFreeProtectedData(run.input,bindings))},
    ...input.snapshot.records.map(group=>group.rows.length===0
      ? {kind:"unavailable" as const,title:group.table,reason:"No source record was retained at capture"}
      : {kind:"text" as const,title:group.table,text:canonicalJsonStringify(group.rows.map(row=>valueFreeProtectedData(group.table === "notes_files" ? projectNoteForOperator(NoteWireSchema.parse(JSON.parse(row.json)),hasProtectedTransactionInput(run)) : JSON.parse(row.json),bindings)))}),
    ...input.sections,
  ];
  return sealArchiveReport({ schemaVersion:1, runId:run.envelope.runId, transferId:input.transferId,
    workflow:run.envelope.workflow,itemId:run.envelope.itemId,attempt:run.envelope.attempt,runNumber:run.runNumber ?? null,
    title:run.displayName ?? run.envelope.workflow,descriptorVersion:String(run.envelope.descriptorVersion),
    outcome:run.lifecycle.outcome,completedAt:run.lifecycle.endedAt,capturedAt:input.capturedAt,
    sourceDigest:lifecycleSourceDigest(input.snapshot),sources:[{kind:"authority-snapshot",json,digest:sha256Hex(json)}],
    sections,files,
  });
}
