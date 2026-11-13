import { OcrSourceUploadSchema } from "../../../models/ocr/review.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { ContentAddressedArtifactWriter } from "../../../workflow-kit/artifacts.js";
import type { AuthorityDatabase, AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import type { ServerVerifiedArtifactReader, VerifiedByteLease } from "../../storage/artifacts/server-verified-artifact-reader.js";
import type { RunRecordService } from "../lifecycle/run-record-service.js";
import { readOcrReviewAuthority, readOcrSnapshotsAuthority } from "../lifecycle/ocr-review-authority.js";
import { OcrCommandResultWireSchema } from "../../../models/dashboard/run-detail.js";
import { CommandIdSchema } from "../../../rules/identity/ids.js";
import { z } from "zod";

export const OCR_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export class OcrSourceRefusedError extends Error {
  readonly code = "OCR_SOURCE_REFUSED";
  constructor() { super("OCR_SOURCE_REFUSED"); this.name = "OcrSourceRefusedError"; }
}
function readOcrCommandResult(repositories: AuthorityRepositories, reader: Pick<RunRecordService, "read">, runId: string, commandId: string) {
  const review = readOcrReviewAuthority(repositories, reader, runId);
  if (review === undefined) throw new OcrSourceRefusedError();
  const command = repositories.commands.get(CommandIdSchema.parse(commandId));
  if (command === undefined || command.commandId !== commandId || (command.family !== "ocr-review" && command.family !== "gate")
    || command.target.runId !== runId || command.requestedBy !== "local-operator" || command.source !== "dashboard") return { state: "unavailable" as const };
  const audit = repositories.commandAudits.findByCommand(commandId);
  // A refused command settles with an audit but records no OCR change.
  if (audit === undefined || audit.result.state !== "applied") return { state: "unavailable" as const };
  if (canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)
    || audit.result.commandId !== command.commandId) throw new OcrSourceRefusedError();
  if (command.family === "ocr-review") {
    const revision = repositories.ocrReviews.revision(runId, command.target.expectedRevision + 1);
    if (revision?.origin.kind !== "command" || revision.origin.commandId !== commandId) throw new OcrSourceRefusedError();
  } else if (!readOcrSnapshotsAuthority(repositories, review).some(snapshot => snapshot.snapshotId === commandId)) throw new OcrSourceRefusedError();
  return OcrCommandResultWireSchema.parse({ state: "recorded", request: command, result: audit.result });
}
export function createOcrSourceService(input: Readonly<{
  database: AuthorityDatabase; reader: Pick<RunRecordService, "read">; clock: Clock;
  artifacts: ContentAddressedArtifactWriter; artifactReader: ServerVerifiedArtifactReader; assertCurrent(): void;
}>) {
  const pageReference = (runId: string, revision: number, sourcePage: number) => input.database.withAuthorityReadSnapshot(() => {
    input.assertCurrent();
    const review = readOcrReviewAuthority(input.database.authority, input.reader, runId);
    const saved = input.database.authority.ocrReviews.revision(runId, z.number().int().positive().parse(revision));
    if (review === undefined || saved === undefined || revision > review.revision.revision) throw new OcrSourceRefusedError();
    const page = saved.seed.review.accounting.manifest.pages.find(page => page.sourcePage === z.number().int().positive().parse(sourcePage));
    if (page === undefined) throw new OcrSourceRefusedError();
    return page.image;
  });
  return Object.freeze({
    commandResult(runId: string, commandId: string) {
      return input.database.withAuthorityReadSnapshot(() => {
        input.assertCurrent();
        return readOcrCommandResult(input.database.authority, input.reader, runId, commandId);
      });
    },
    async upload(request: Readonly<{ actorId: string; fileName: string; mediaType: string; bytes: Uint8Array }>) {
      input.assertCurrent();
      if (request.actorId !== "local-operator" || request.mediaType !== "application/pdf"
        || request.bytes.byteLength === 0 || request.bytes.byteLength > OCR_UPLOAD_MAX_BYTES
        || !new TextDecoder().decode(request.bytes.subarray(0, 1024)).includes("%PDF-")) throw new OcrSourceRefusedError();
      const fileName = z.string().min(1).max(255).parse(request.fileName);
      const artifact = await input.artifacts.put(request.bytes, { mediaType: "application/pdf" });
      input.assertCurrent();
      return input.database.withAuthorityTransaction(repositories => {
        input.assertCurrent();
        const previous = repositories.ocrReviews.source(artifact.id);
        if (previous !== undefined) {
          if (canonicalJsonStringify(previous.artifact) !== canonicalJsonStringify(artifact)) throw new OcrSourceRefusedError();
          return previous;
        }
        return repositories.ocrReviews.upload(OcrSourceUploadSchema.parse({ artifact, fileName,
          uploadedAt: input.clock.now().toISOString(), uploadedBy: request.actorId }));
      });
    },
    async page(runId: string, revision: number, sourcePage: number, signal?: AbortSignal): Promise<VerifiedByteLease> {
      const ref = pageReference(runId, revision, sourcePage);
      const lease = await input.artifactReader.prepare(ref, signal);
      try {
        input.assertCurrent();
        if (canonicalJsonStringify(pageReference(runId, revision, sourcePage)) !== canonicalJsonStringify(ref)) throw new OcrSourceRefusedError();
        return lease;
      } catch (error) {
        try { await lease.dispose(); }
        catch (closeError) { throw new AggregateError([error, closeError], "ocr-source-lease-closure-unproved", { cause: closeError }); }
        throw error;
      }
    },
  });
}
export type OcrSourceService = ReturnType<typeof createOcrSourceService>;
