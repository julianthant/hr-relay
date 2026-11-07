import type { RunDiagnosticCapture } from "../../../workflow-kit/diagnostics.js";
import { localDatePart } from "../../../rules/time/clock.js";
import { FailureResolutionSchema } from "../../../models/trust/failure-resolution.js";
import type { CommandApplication } from "../commands/command-application.js";
import type { FailureResolutionCommand } from "../../../rules/commands/commands.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import { rejectCommandRequest } from "../commands/command-refusal.js";
import { lifecycleCommandId } from "./run-record-service.js";

export { failureResolutionCapability } from "../../../models/trust/failure-resolution.js";

/** The command kernel owns the surrounding annotation/journal/audit/event transaction. */
export function executeFailureResolution(
  repositories: AuthorityRepositories, request: FailureResolutionCommand, now: string,
): CommandApplication {
  const { runId, failureId, expectedVersion } = request.target;
  if (repositories.deletedRuns.get(runId) !== undefined) {
    rejectCommandRequest(request, "target-deleted", "The failure's run was deleted.");
  }
  const run = repositories.runs.get(runId);
  const failure = repositories.failures.get(failureId);
  if (run === undefined || failure === undefined || failure.runId !== runId) {
    rejectCommandRequest(request, "target-not-found", "The exact live run and failure are unavailable.");
  }
  const current = repositories.failureResolution.read(runId, failureId);
  if (current === undefined) throw new Error("failure-resolution-annotation-missing");
  if (current.resolution.version !== expectedVersion) {
    rejectCommandRequest(request, "invalid-state", "The failure resolution changed. Refresh before trying again.");
  }
  const status = request.payload.action === "resolve" ? "resolved" : "unresolved";
  if (current.resolution.status === status) {
    rejectCommandRequest(request, "invalid-state", "The failure already has this resolution status. Refresh before trying again.");
  }
  const resolution = FailureResolutionSchema.parse(status === "resolved" && request.payload.action === "resolve"
    ? { status, version: expectedVersion + 1, by: request.requestedBy, at: now,
        ...(request.payload.note === undefined ? {} : { note: request.payload.note }) }
    : { status, version: expectedVersion + 1 });
  repositories.failureResolution.update({ runId, failureId, expectedVersion, resolution });
  // History carries identity and action, never free text. The raw note belongs to
  // the annotation/command evidence; the served projection protects it separately.
  repositories.timelineEvents.append({
    schemaVersion: 1,
    eventId: lifecycleCommandId("failure-resolution", { commandId: request.commandId }),
    workflow: run.envelope.workflow, scope: { kind: "run", runId },
    occurredAt: now, recordedAt: now, retentionDate: localDatePart(new Date(now)), source: { kind: "native" },
    payload: { kind: "failure-resolution", runId, workflow: run.envelope.workflow, failureId,
      commandId: request.commandId, actorId: request.requestedBy, action: request.payload.action,
      annotationVersion: resolution.version, at: now },
  });
  const target = { family: "failure-resolution" as const, runId, failureId };
  return { result: { state: "applied", commandId: request.commandId, affectedTargets: [target] },
    versionChanges: [{ target, before: expectedVersion, after: resolution.version }], affectedDependencyIds: [] };
}
/** Real capture preserves immutable failure evidence. */
export function bindFailureCapture(capture:RunDiagnosticCapture):RunDiagnosticCapture {
 return Object.freeze({captureForFailure:(context:Parameters<RunDiagnosticCapture["captureForFailure"]>[0])=>capture.captureForFailure(context),persist:(bundle:Parameters<RunDiagnosticCapture["persist"]>[0])=>capture.persist(bundle),discard:(bundle:Parameters<RunDiagnosticCapture["discard"]>[0])=>capture.discard(bundle)});
}
