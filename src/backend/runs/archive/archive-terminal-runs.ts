import type { RunRecord } from "../../../domain/run/record.js";
import type { CommandRequest } from "../../../domain/commands.js";
import { FingerprintSchema } from "../../../domain/ids.js";
import { deriveStableUuid } from "../../../domain/identifiers.js";
import { canonicalJsonStringify, JsonValueSchema } from "../../../domain/canonical-json.js";
import { sha256Hex } from "../../../domain/sha256.js";
import { DiagnosticAttachmentStorageRecordSchema } from "../../storage/sqlite/storage-records.js";
import type { createRunLifecycleStorage } from "../../storage/sqlite/lifecycle-storage.js";
import type { ArchiveSnapshotSource } from "./archive-service.js";
import { captureArchiveReport, genericArchiveSection } from "../../storage/archive/report-capture.js";

type Storage = ReturnType<typeof createRunLifecycleStorage>;
type Request = Extract<CommandRequest, { type: "archive" }>;
const transferId = (request: Request, runId: string) => deriveStableUuid("manual-archive", `${request.commandId}:${runId}`);

/** The caller's authority transaction owns membership, cleanup and the command audit. */
export function prepareManualArchive(storage: Storage, displays: ArchiveSnapshotSource, request: Request,
  order: readonly RunRecord[], now: string) {
  const requestedClaim = { commandId: request.commandId, actorId: request.requestedBy, requestFingerprint: FingerprintSchema.parse(sha256Hex(canonicalJsonStringify(request))),
    rootRunId: request.target.runId, members: order.map(run => ({ runId: run.envelope.runId, version: run.version })) };
  const retained = order.map(run => storage.readManualReport(run.envelope.runId)).find(report => report !== undefined);
  const manualArchive = retained?.content.manualArchive ?? requestedClaim;
  if (manualArchive.actorId !== request.requestedBy || manualArchive.rootRunId !== request.target.runId
    || canonicalJsonStringify(manualArchive.members) !== canonicalJsonStringify(requestedClaim.members)
    || (manualArchive.commandId === request.commandId && manualArchive.requestFingerprint !== requestedClaim.requestFingerprint)) {
    throw new Error("manual-archive-replay-conflict");
  }
  const displayed = displays.snapshotBatch(order.map(run => run.envelope.runId));
  const reports = order.map(run => {
    const runId = run.envelope.runId;
    const prior = storage.readManualReport(runId);
    if (prior !== undefined) {
      const claim = prior.content.manualArchive;
      if (claim === undefined || claim.rootRunId !== manualArchive.rootRunId || claim.actorId !== manualArchive.actorId
        || canonicalJsonStringify(claim.members) !== canonicalJsonStringify(manualArchive.members)
        || (claim.commandId === request.commandId && claim.requestFingerprint !== manualArchive.requestFingerprint)) {
        throw new Error("manual-archive-replay-conflict");
      }
      return prior;
    }
    const snapshot = storage.capture(runId);
    const display = displayed.get(runId);
    if (display === undefined) throw new Error("archive-display-capture-missing");
    const files = (snapshot.records.find(group => group.table === "diagnostic_files")?.rows ?? []).map(row => {
      const { attachment } = DiagnosticAttachmentStorageRecordSchema.parse(JSON.parse(row.json));
      return { digest: attachment.digest, byteLength: attachment.byteLength, mediaType: attachment.mediaType,
        name: attachment.kind, artifactIds: [attachment.artifactId] };
    });
    const unique = [...new Map(files.map(file => [file.digest, file])).values()];
    for (const file of unique) storage.retainFile(file, storage.readSourceFile(file));
    return captureArchiveReport({ snapshot, transferId: transferId(request, runId), capturedAt: now, files: unique,
      manualArchive, sections: [genericArchiveSection("Displayed run", JsonValueSchema.parse(display))] });
  });
  for (const report of reports) {
    storage.saveReport(report);
    storage.verifyReport(report.content.runId, report.digest);
  }
  for (const report of reports) {
    const member = manualArchive.members.find(member => member.runId === report.content.runId);
    if (member === undefined) throw new Error("manual-archive-member-missing");
    storage.transfer({ runId: member.runId, digest: report.digest, expectedVersion: member.version });
  }
  return reports;
}

/** Exact replay repairs a crash after live commit and before report publication. */
export function publishManualArchive(storage: Storage, request: Request, runIds: readonly string[]) {
  if (!runIds.includes(request.target.runId)) throw new Error("manual-archive-root-missing");
  for (const runId of runIds) {
    const pending = storage.readManualReport(runId);
    const claim = pending?.content.manualArchive;
    if (pending === undefined || claim === undefined || claim.rootRunId !== request.target.runId
      || claim.actorId !== request.requestedBy || canonicalJsonStringify(claim.members.map(member => member.runId).sort()) !== canonicalJsonStringify([...runIds].sort())
      || claim.members.find(member => member.runId === request.target.runId)?.version !== request.target.expectedVersion
      || (claim.commandId === request.commandId && claim.requestFingerprint !== sha256Hex(canonicalJsonStringify(request)))) {
      throw new Error("manual-archive-publication-binding-mismatch");
    }
    storage.publishReport(runId, pending.digest);
  }
}
