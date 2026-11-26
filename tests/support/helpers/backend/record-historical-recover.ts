import { ERROR_CATALOG } from "../../../../src/models/failures/error-catalog.js";
import { retainedRunProtectedBindings } from "../../../../src/models/write-safety/protected-input.js";
import { CommandRequestSchema, CommandResultSchema } from "../../../../src/rules/commands/commands.js";
import { lifecycleCommandId } from "../../../../src/rules/identity/identifiers.js";
import type { Clock } from "../../../../src/rules/time/clock.js";
import { workflowPlanning, type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { CommandRefusal } from "../../../../src/backend/runs/commands/command-refusal.js";
import { replay } from "../../../../src/backend/runs/commands/command-replay.js";
import { lifecycleRun, requireRun } from "../../../../src/backend/runs/commands/run-command-context.js";
import { runTarget, type VersionChange } from "../../../../src/backend/runs/lifecycle/run-fan-out.js";
import type { RelatedRunChange, RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { protectedSubjectDisplay } from "../../../../src/backend/runs/start/protected-input.js";
import { planRunRecovery } from "../../../../src/backend/runs/start/recovery-plan.js";
import { RerunRefusedError } from "../../../../src/backend/runs/start/rerun.js";
import type { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { withCanonicalRunCommandScope } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { RunContinuationRefusedError } from "../../../../src/backend/storage/sqlite/run-continuation.js";
import { randomUUID } from "node:crypto";

/** Seeds the journal a prior release left, using the original native lifecycle path. */
export function recordHistoricalRecover({ database, clock, lifecycle }: { database: AuthorityDatabase; clock: Clock; lifecycle: RunRecordService },
  descriptorOf: AnyWorkflowDescriptor | ((workflow: string) => AnyWorkflowDescriptor | undefined), input: unknown) {
  const request = CommandRequestSchema.parse(input);
  if (request.family !== "run" || request.type !== "recover-run") throw new Error("Expected a historical Recover request");
  const now = clock.now().toISOString();
  const replayed = database.withAuthorityTransaction(repositories => {
    repositories.commands.assertIdentity(request);
    repositories.commands.insert(request);
    if (repositories.commandAudits.findByCommand(request.commandId) !== undefined) return replay({}, repositories, request, now);
  });
  if (replayed !== undefined) return replayed;
  const audit = (result: ReturnType<typeof CommandResultSchema.parse>, versionChanges: VersionChange[]) =>
    ({ auditId: randomUUID(), request, result, versionChanges, completedAt: now, affectedDependencyIds: [] });
  try {
    return database.withAuthorityTransaction(repositories => {
      const outcome = withCanonicalRunCommandScope(repositories, request, () => {
        const source = requireRun(repositories, request, request.target.runId);
        const descriptor = typeof descriptorOf === "function" ? descriptorOf(source.envelope.workflow) : descriptorOf;
        if (descriptor === undefined) throw new Error("Historical Recover needs the source descriptor");
        repositories.runtimeConfig.requireSettingsCurrent();
        planRunRecovery(repositories, descriptor, source, request.commandId, database.evidenceSchemaHash.bind(database));
        const planning = workflowPlanning(descriptor);
        const related: RelatedRunChange[] = [];
        const run = lifecycleRun(request, lifecycle.recover({ commandId: lifecycleCommandId("operator-recover-run", request.commandId),
          ...request.target, runtimeConfig: selectRunRuntime(repositories), appVersion: source.appVersion ?? "0.1.0", sourceCommandId: request.commandId }, descriptor,
        { ...protectedSubjectDisplay(retainedRunProtectedBindings(source), () => ({ title: planning.title(source.input.parsed.value), subtitle: planning.subtitle(source.input.parsed.value) })),
          actorId: request.requestedBy }), related);
        const children = lifecycle.continueDelegations(run, request.commandId, related);
        const targets = new Map([run, source, ...children].map(row => [row.envelope.runId, runTarget(row.envelope.runId)]));
        const changes = new Map<string, VersionChange>();
        for (const row of [run, ...children]) {
          const current = repositories.runs.get(row.envelope.runId);
          if (current === undefined) throw new Error("Historical continuation result is missing");
          changes.set(row.envelope.runId, { target: runTarget(row.envelope.runId), before: 0, after: current.version });
        }
        for (const change of related) {
          const target = runTarget(change.runId);
          targets.set(change.runId, target);
          changes.set(change.runId, { target, before: changes.get(change.runId)?.before ?? change.before, after: change.after });
        }
        return { result: CommandResultSchema.parse({ state: "applied", commandId: request.commandId, affectedTargets: [...targets.values()] }),
          changes: [...changes.values()] };
      });
      repositories.commandAudits.insert(audit(outcome.result, outcome.changes));
      return outcome.result;
    });
  } catch (error) {
    const result = error instanceof CommandRefusal ? error.result
      : error instanceof RerunRefusedError || error instanceof RunContinuationRefusedError
        ? CommandResultSchema.parse({ state: "rejected", commandId: request.commandId, code: "RUN_CONTINUATION_REFUSED", message: ERROR_CATALOG.RUN_CONTINUATION_REFUSED.text })
        : undefined;
    if (result === undefined) throw error;
    database.withAuthorityTransaction(repositories => repositories.commandAudits.insert(audit(result, [])));
    return result;
  }
}
