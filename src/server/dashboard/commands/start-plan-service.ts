/**
 * POST /api/v1/start-plans — minting the short-lived plan a `start-run`
 * command later consumes (ref frontend-backend-integration §5.1). Planning goes through the D109
 * authority: `planStart` builds the exact raw+canonical record and the
 * `start_plans` repository persists it in one authority transaction.
 *
 * The response wire deliberately does NOT echo `rawInput` back: the plan
 * retains it durably for audit, and reflecting submitted values through an
 * HTTP response would bypass the schema-owned redaction lane. The operator
 * confirms against the served titles/refusals plus the fingerprints that
 * bind the plan.
 */
import { StartPlanIngressSchema, StartPlanWireSchema, type StartPlanWire } from "../../../domain/dashboard/start-plan.js";
import type { AnyWorkflowDescriptor } from "../../../base/workflow.js";
import type { Clock } from "../../../domain/clock.js";
import type { IdFactory } from "../../../domain/identifiers.js";
import type { AuthorityRepositories } from "../../../infra/sqlite/authority-database.js";
import { planStart } from "../../../services/start/plan.js";
import { StartStepOmissionRefusedError, applyStartStepSelection, resolveStartStepOmissions } from "../../../services/start/step-selection.js";
import type { StartPlannerDeps } from "../../../services/start/plan.js";
import { TargetNotFoundError } from "../../failures.js";

export type { StartPlanWire } from "../../../domain/dashboard/start-plan.js";

export interface StartPlanServiceDeps {
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
  plan(input: unknown): StartPlanWire;
}

export function createStartPlanService(deps: StartPlanServiceDeps): StartPlanService {
  return Object.freeze({
    plan(input: unknown): StartPlanWire {
      const ingress = StartPlanIngressSchema.parse(input);
      const descriptor = deps.descriptors.resolve(ingress.workflowId);
      if (descriptor === undefined) {
        throw new TargetNotFoundError(`workflow ${ingress.workflowId} is not registered; nothing to plan`);
      }
      // D307 — the omissions are reconciled against THIS descriptor's forms
      // and cascade BEFORE anything is planned, so a refusal costs no plan row
      // and no run identity. The ingress schema only proved the shape; the
      // descriptor is what proves the step is omittable, that every omitted
      // step carries the facts its own form requires, and that nothing still
      // running would read what the omission leaves unread.
      if (ingress.stepOmissions !== undefined && ingress.submissions.length !== 1) {
        // Typed facts (a last day worked, a transaction number) describe ONE
        // subject; a plan that fans out to several would assert them for all.
        throw new StartStepOmissionRefusedError(
          "single-subject-only",
          `${descriptor.id} step omissions require exactly one submission; this plan carries ${String(ingress.submissions.length)}`,
        );
      }
      const stepOmissions = resolveStartStepOmissions(descriptor, ingress.selectedStepKeys, ingress.stepOmissions);
      const record = planStart(
        {
          authority: deps.authorityRead,
          clock: deps.clock,
          ids: deps.ids,
          planTtlMs: deps.planTtlMs,
        },
        {
          descriptor,
          submissions: ingress.submissions.map((submission) =>
            applyStartStepSelection(descriptor, submission, ingress.selectedStepKeys)),
          ...(ingress.requestedInstance === undefined ? {} : { requestedInstance: ingress.requestedInstance }),
          dryRun: ingress.dryRun,
          browserMode: ingress.browserMode,
          captureBrowserScreenshots: ingress.captureBrowserScreenshots,
          ...(stepOmissions === undefined ? {} : { stepOmissions }),
          priority: ingress.priority,
          shape: "single",
          configFingerprint: deps.configFingerprint,
          configSnapshotId: deps.configSnapshotId,
          plannedBy: deps.plannedBy,
        },
      );
      const stored = deps.authority.withAuthorityTransaction((repositories) => {
        repositories.runtimeConfig.requireSettingsCurrent();
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
        planned: record.planned.map((planned) => ({
          runId: planned.runId,
          traceId: planned.traceId,
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
