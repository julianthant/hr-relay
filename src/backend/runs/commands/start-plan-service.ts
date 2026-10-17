import type { RunRecoveryMode } from "../../../models/run/envelope.js";
import { workflowPreflightScope } from "../start/preflight-scope.js";
import type { PreflightAdmission } from "../../../rules/preflight/preflight-admission.js";
import { selectNewRunIdentity } from "../settings/run-settings.js";
import type { ProtectedInputBinding } from "../../../models/write-safety/protected-input.js";
import type { ProtectedSecretSource } from "../../../models/config/secrets.js";

import { StartPlanIngressSchema, StartPlanWireSchema, type StartPlanWire } from "../../../models/dashboard/start-plan.js";
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { IdFactory } from "../../../rules/identity/identifiers.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import { buildRerunPlan, previewRerunWarnings, rerunWorkers, RerunRefusedError } from "../start/rerun.js";
import { RerunWarningRequestSchema, RerunWarningWireSchema, type RerunWarningWire } from "../../../models/dashboard/rerun-warning.js";
import { projectRerunPlanForOperator } from "../../../models/run/rerun.js";
import { StartPlanRecordSchema, derivePlannedInputFingerprint } from "../../../models/run/start-plan.js";
import { planStart } from "../start/plan.js";
import { StartStepOmissionRefusedError, applyStartStepSelection, resolveStartStepOmissions } from "../start/step-selection.js";
import type { StartPlannerDeps } from "../start/plan.js";
import { TargetNotFoundError } from "./refusals.js";

export type { StartPlanWire } from "../../../models/dashboard/start-plan.js";

export interface StartPlanServiceDeps {
  readonly preflight?: PreflightAdmission;
  readonly recovery?: RunRecoveryMode;
  readonly protectedSecrets?: ProtectedSecretSource;
  /** Internal test admission only; never accepted by the public ingress schema. */
  readonly protectedSubmissionBindings?: readonly ProtectedInputBinding[];
  readonly authority: {
    withAuthorityTransaction<Result>(work: (repositories: AuthorityRepositories) => Result): Result;
  };
  readonly authorityRead: StartPlannerDeps["authority"];
  readonly descriptors: { resolve(workflowId: string): AnyWorkflowDescriptor | undefined };
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly planTtlMs: number;
  readonly configFingerprint: string;
  readonly configSnapshotId: string;
  readonly plannedBy: string;
}

export interface StartPlanService {
  previewWarnings(input: unknown): RerunWarningWire;
  prepare?(input: unknown, signal: AbortSignal): Promise<void>;
  plan(input: unknown): StartPlanWire;
}

export function createStartPlanService(deps: StartPlanServiceDeps): StartPlanService {
  const scopeFor = (input: unknown) => {
    const ingress = StartPlanIngressSchema.parse(input);
    const descriptor = deps.descriptors.resolve(ingress.workflowId);
    if (descriptor === undefined) throw new TargetNotFoundError("Preflight workflow is not registered.");
    const identity = deps.authority.withAuthorityTransaction(repositories => {
      repositories.runtimeConfig.requireSettingsCurrent();
      return selectNewRunIdentity(repositories, deps);
    });
    return workflowPreflightScope(descriptor, { ...identity, ...(ingress.requestedInstance === undefined ? {} : { resolvedInstance: ingress.requestedInstance }) });
  };
  return Object.freeze({
    previewWarnings(input: unknown): RerunWarningWire {
      const request = RerunWarningRequestSchema.parse(input);
      const descriptor = deps.descriptors.resolve(request.workflowId);
      if (descriptor === undefined) throw new TargetNotFoundError("Rerun workflow is not registered.");
      return deps.authority.withAuthorityTransaction((repositories) => RerunWarningWireSchema.parse({
        workflowId: descriptor.id,
        rerun: projectRerunPlanForOperator(previewRerunWarnings(repositories, descriptor, request.source)),
      }));
    },
    async prepare(input: unknown, signal: AbortSignal): Promise<void> {
      if (deps.preflight === undefined) return;
      const scope = scopeFor(input);
      await deps.preflight.prepare(scope, signal);
      deps.preflight.assertReady(scope);
    },
    plan(input: unknown): StartPlanWire {
      const ingress = StartPlanIngressSchema.parse(input);
      if (deps.preflight !== undefined) deps.preflight.assertReady(scopeFor(input));
      const descriptor = deps.descriptors.resolve(ingress.workflowId);
      if (descriptor === undefined) {
        throw new TargetNotFoundError(`workflow ${ingress.workflowId} is not registered; nothing to plan`);
      }

      if (ingress.stepOmissions !== undefined && ingress.submissions.length !== 1) {
        // Typed facts (a last day worked, a transaction number) describe ONE
        // subject; a plan that fans out to several would assert them for all.
        throw new StartStepOmissionRefusedError(
          "single-subject-only",
          `${descriptor.id} step omissions require exactly one submission; this plan carries ${String(ingress.submissions.length)}`,
        );
      }
      const stepOmissions = resolveStartStepOmissions(descriptor, ingress.selectedStepKeys, ingress.stepOmissions);
      const sourceSelection = ingress.rerunSource?.selectedStepKeys;
      if (sourceSelection !== undefined && JSON.stringify(sourceSelection) !== JSON.stringify(ingress.selectedStepKeys)) {
        throw new Error("Rerun source selection must equal submitted selection");
      }
      const rerunSource = ingress.rerunSource;
      const source = rerunSource === undefined ? undefined : deps.authority.withAuthorityTransaction(repositories => {
        if (repositories.deletedRuns.get(rerunSource.runId) !== undefined) throw new RerunRefusedError("target-deleted", "Rerun source was deleted");
        const run = repositories.runs.get(rerunSource.runId);
        if (run === undefined) throw new RerunRefusedError("target-not-found", "Rerun source does not exist");
        return { input: run.input.parsed, workers: rerunWorkers(repositories, run) };
      });
      let record = planStart(
        {
          authority: deps.authorityRead,
          ...(deps.protectedSecrets === undefined ? {} : { protectedSecrets: deps.protectedSecrets }),
          clock: deps.clock,
          ids: deps.ids,
          planTtlMs: deps.planTtlMs,
        },
        {
          descriptor,
          ...(deps.protectedSubmissionBindings === undefined ? {} : { protectedSubmissionBindings: deps.protectedSubmissionBindings }),
          ...(source === undefined ? {} : { retainedInputs: [source.input] }),
          submissions: ingress.submissions.map((submission) =>
            applyStartStepSelection(descriptor, submission, ingress.selectedStepKeys)),
          ...(ingress.requestedInstance === undefined ? {} : { requestedInstance: ingress.requestedInstance }),
          dryRun: ingress.dryRun,
          workers: ingress.workers ?? source?.workers ?? "auto",
          browserMode: ingress.browserMode,
          captureBrowserScreenshots: ingress.captureBrowserScreenshots,
          ...(stepOmissions === undefined ? {} : { stepOmissions }),
          priority: ingress.priority,
          shape: "single",
          configFingerprint:deps.configFingerprint,
          configSnapshotId:deps.configSnapshotId,
          plannedBy: deps.plannedBy,
        },
      );
      if (deps.recovery !== undefined) record = StartPlanRecordSchema.parse({ ...record, recovery: deps.recovery });
      const stored = deps.authority.withAuthorityTransaction((repositories) => {
        const selected=selectNewRunIdentity(repositories,record);
        record=StartPlanRecordSchema.parse({...record,...selected});
        repositories.runtimeConfig.requireSettingsCurrent();
        deps.preflight?.assertReady(workflowPreflightScope(descriptor, { ...record, resolvedInstance: record.resolvedInstance }));
        if (ingress.rerunSource !== undefined) {
          const rerun = buildRerunPlan(repositories, descriptor, ingress.rerunSource, record.planned, ingress.warningAcknowledgment, record.stepOmissions);
          record = StartPlanRecordSchema.parse({ ...record, rerun, inputFingerprint: derivePlannedInputFingerprint(
            record.planned, record.ingressSchemaHash, record.canonicalInputSchemaHash, rerun, record.stepOmissions) });
        } else if (ingress.warningAcknowledgment !== undefined) {
          throw new Error("warning acknowledgment requires a Rerun source");
        }
        return repositories.startPlans.create(record);
      });
      if (stored.state !== "inserted") {
        throw new Error(`start plan ${record.startPlanId} collided with an existing plan; refusing to reuse it`);
      }
      return StartPlanWireSchema.parse({
        wireVersion: 1,
        startPlanId: record.startPlanId,
        workflowId: record.workflowId,
        expectedVersion: record.version,
        expiresAt: record.expiresAt,
        dryRun: record.dryRun,
        workers: record.workers,
        ...(record.browserMode === undefined ? {} : { browserMode: record.browserMode }),
        ...(record.captureBrowserScreenshots === undefined
          ? {}
          : { captureBrowserScreenshots: record.captureBrowserScreenshots }),
        ...(record.stepOmissions === undefined
          ? {}
          : { omittedSteps: record.stepOmissions.map((entry) => entry.step) }),
        priority: record.priority,
        plannedBy: record.plannedBy,
        configSnapshotId: record.configSnapshotId,
        fingerprints: {
          descriptorFingerprint: record.descriptorFingerprint,
          configFingerprint: record.configFingerprint,
          ingressSchemaHash: record.ingressSchemaHash,
          canonicalInputSchemaHash: record.canonicalInputSchemaHash,
          inputFingerprint: record.inputFingerprint,
        },
        ...(record.rerun === undefined ? {} : { rerun: projectRerunPlanForOperator(record.rerun) }),
        planned: record.planned.map((planned) => ({
          ...(planned.supersedeTargets === undefined ? {} : { supersedeTargets: planned.supersedeTargets }),
          logicalKey: planned.itemId,
          title: planned.title,
          ...(planned.subtitle === undefined ? {} : { subtitle: planned.subtitle }),
          matchKey: planned.matchKey,
        })),
        refused: record.refused.map((refusal) => ({
          entry: refusal.entry,
          code: refusal.code,
          message: refusal.message,
        })),
      });
    },
  });
}
