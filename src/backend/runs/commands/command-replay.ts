import { ProtectedSettingsReadbackSchema } from "../../../models/config/protected-settings.js";
import { type CommandRequest, type CommandResult, CommandResultSchema, deriveSettingsCommandFingerprint } from "../../../rules/commands/commands.js";
import { FingerprintSchema } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { OcrReviewRefusedError } from "../../processing/ocr/review-authority.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-repositories.js";
import { readOcrReviewAuthority, readOcrSnapshotsAuthority } from "../lifecycle/ocr-review-authority.js";
import type { CommandKernelDependencies } from "./command-kernel.js";
import { z } from "zod";

const OrdinarySettingsReplayVerificationSchema = z.strictObject({
  revision: z.number().int().positive(),
  settingsFingerprint: FingerprintSchema,
});

const ProtectedSettingsReplayVerificationSchema = ProtectedSettingsReadbackSchema;

export function replay(
  dependencies: Pick<CommandKernelDependencies, "settings"> & Partial<Pick<CommandKernelDependencies, "lifecycle">>,
  repositories: AuthorityRepositories,
  request: CommandRequest,
  now: string,
): CommandResult {
  const audit = repositories.commandAudits.findByCommand(request.commandId);
  if (audit === undefined) {
    throw new Error(
      `command ${request.commandId} is journaled but has no recorded outcome; refusing to guess what it did`,
    );
  }
  if (audit.result.state === "rejected" || audit.result.state === "conflict" || audit.result.state === "confirmation-required") return audit.result;
  if (request.family === "ocr-review" || request.family === "gate" && request.payload.ocrApproval !== undefined) {
    if (dependencies.lifecycle === undefined) throw new OcrReviewRefusedError();
    const review = readOcrReviewAuthority(repositories, dependencies.lifecycle, request.target.runId);
    if (review === undefined) throw new OcrReviewRefusedError();
    if (request.family === "ocr-review") {
      const revision = repositories.ocrReviews.revision(request.target.runId, request.target.expectedRevision + 1);
      if (revision?.origin.kind !== "command" || revision.origin.commandId !== request.commandId) throw new OcrReviewRefusedError();
    } else if (!readOcrSnapshotsAuthority(repositories, review).some(snapshot => snapshot.snapshotId === request.commandId)) throw new OcrReviewRefusedError();
  }
  if (audit.result.state !== "applied") {
    throw new Error(
      `command ${request.commandId} recorded outcome ${audit.result.state}; only applied or refused commands are journaled`,
    );
  }
  if (request.family === "start") {

    const revalidation = repositories.startPlans.consume({
      startPlanId: request.target.startPlanId,
      expectedVersion: request.target.expectedVersion,
      commandId: request.commandId,
      descriptorFingerprint: request.payload.descriptorFingerprint,
      configFingerprint: request.payload.configFingerprint,
      ingressSchemaHash: request.payload.ingressSchemaHash,
      canonicalInputSchemaHash: request.payload.canonicalInputSchemaHash,
      inputFingerprint: request.payload.inputFingerprint,
      now,
    });
    if (revalidation.state !== "already-consumed") {
      throw new Error(
        `replay of start command ${request.commandId} could not revalidate plan `
        + `${request.target.startPlanId} (${revalidation.state}); the durable record is inconsistent`,
      );
    }
  }
  let settingsVerification:
    | Readonly<{ kind: "ordinary"; value: z.infer<typeof OrdinarySettingsReplayVerificationSchema> }>
    | Readonly<{ kind: "protected"; value: z.infer<typeof ProtectedSettingsReplayVerificationSchema> }>
    | undefined;
  if (request.family === "settings") {
    if (dependencies.settings === undefined) {
      throw new Error(
        `settings/${request.type} replay reached a composition with no settings application executor`,
      );
    }
    if (request.type === "apply-settings"
      && deriveSettingsCommandFingerprint(audit.request) !== deriveSettingsCommandFingerprint(request)) {
      throw new Error(`settings replay ${request.commandId} does not match its immutable result`);
    }
    const verified = request.type === "apply-settings"
      ? OrdinarySettingsReplayVerificationSchema.parse(
          { revision: audit.result.settingsRevision, settingsFingerprint: audit.result.settingsFingerprint },
        )
      : ProtectedSettingsReplayVerificationSchema.parse(
          dependencies.settings.reconcileReplay(request),
        );
    const expectedRevision = request.target.expectedRevision + 1;
    const verifiedRevision = "revision" in verified ? verified.revision : undefined;
    if (("state" in verified && verified.state !== "applied") || verifiedRevision !== expectedRevision) {
      throw new Error(
        `settings replay ${request.commandId} verified revision ${String(verifiedRevision)}; `
        + `exactly ${String(expectedRevision)} was required`,
      );
    }
    settingsVerification = request.type === "apply-settings"
      ? { kind: "ordinary", value: verified as z.infer<typeof OrdinarySettingsReplayVerificationSchema> }
      : { kind: "protected", value: verified as z.infer<typeof ProtectedSettingsReplayVerificationSchema> };
  }
  return CommandResultSchema.parse({
    state: "already-applied",
    commandId: request.commandId,
    affectedTargets: audit.result.affectedTargets,
    ...(audit.result.noChange === undefined ? {} : { noChange: audit.result.noChange }),
    ...(settingsVerification?.kind === "ordinary" ? {
      restartRequired: audit.result.restartRequired,
      settingsRevision: settingsVerification.value.revision,
      settingsFingerprint: settingsVerification.value.settingsFingerprint,
    } : settingsVerification?.kind === "protected" ? {
      restartRequired: false,
      revision: settingsVerification.value.revision,
      entries: settingsVerification.value.entries,
    } : {}),
  });
}

/** An exact journaled command with no audit: admitted, and its effect resumes on an exact retry. */
export function isAdmittedUnsettled(repositories: AuthorityRepositories, request: CommandRequest): boolean {
  const journaled = repositories.commands.get(request.commandId);
  return journaled !== undefined && canonicalJsonStringify(journaled) === canonicalJsonStringify(request)
    && repositories.commandAudits.findByCommand(request.commandId) === undefined;
}
