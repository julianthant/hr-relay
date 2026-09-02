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
import { z } from "zod";
import type { AnyWorkflowDescriptor } from "../../../base/workflow.js";
import { JsonValueSchema } from "../../../domain/canonical-json.js";
import type { Clock } from "../../../domain/clock.js";
import type { IdFactory } from "../../../domain/identifiers.js";
import {
  ActorIdSchema,
  ConfigSnapshotIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  RunIdSchema,
  StartPlanIdSchema,
  TraceIdSchema,
  WorkflowIdSchema,
} from "../../../domain/ids.js";
import { BrowserPresentationModeSchema, InstanceSelectionSchema, RunPrioritySchema } from "../../../domain/run/envelope.js";
import { StartRefusalCodeSchema } from "../../../domain/run/start-plan.js";
import type { AuthorityRepositories } from "../../../infra/sqlite/authority-database.js";
import { planStart } from "../../../services/start/plan.js";
import { applyStartStepSelection } from "../../../services/start/step-selection.js";
import { StepOmissionsSchema } from "../../../domain/workflow/step-omission.js";
import type { StartPlannerDeps } from "../../../services/start/plan.js";
import { TargetNotFoundError } from "../../failures.js";

const StartPlanIngressSchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  submissions: z.array(JsonValueSchema).min(1),
  dryRun: z.boolean(),
  // Historical/programmatic request callers retain the established headless
  // default; every dashboard submission sends an explicit value.
  browserMode: BrowserPresentationModeSchema.default("headless"),
  captureBrowserScreenshots: z.boolean().default(false),
  /** Trusted server stamp; the surface may request `bulk` explicitly. */
  priority: RunPrioritySchema.default("interactive"),
  requestedInstance: InstanceSelectionSchema.optional(),
  selectedStepKeys: z.array(z.string().min(1)).min(1).optional(),
  /** D307 — typed facts for each omitted step; validated against the descriptor's forms before planning. */
  stepOmissions: StepOmissionsSchema.optional(),
});

const StartPlanWireSchema = z.strictObject({
  wireVersion: z.literal(1),
  startPlanId: StartPlanIdSchema,
  workflowId: WorkflowIdSchema,
  /** The CAS token the `start-run` command target carries. */
  expectedVersion: z.number().int().positive(),
  expiresAt: IsoInstantSchema,
  dryRun: z.boolean(),
  browserMode: BrowserPresentationModeSchema.optional(),
  captureBrowserScreenshots: z.boolean().optional(),
  stepOmissions: StepOmissionsSchema.optional(),
  priority: RunPrioritySchema,
  plannedBy: ActorIdSchema,
  configSnapshotId: ConfigSnapshotIdSchema,
  /** Everything the `start-run` command payload must echo back, verbatim. */
  fingerprints: z.strictObject({
    descriptorFingerprint: FingerprintSchema,
    configFingerprint: FingerprintSchema,
    ingressSchemaHash: FingerprintSchema,
    canonicalInputSchemaHash: FingerprintSchema,
    inputFingerprint: FingerprintSchema,
  }),
  planned: z.array(z.strictObject({
    runId: RunIdSchema,
    traceId: TraceIdSchema,
    title: z.string().min(1),
    subtitle: z.string().min(1).optional(),
    matchKey: z.string().min(1),
  })),
  refused: z.array(z.strictObject({
    entry: z.number().int().positive(),
    code: StartRefusalCodeSchema,
    message: z.string().min(1),
  })),
});
export type StartPlanWire = z.infer<typeof StartPlanWireSchema>;

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
          ...(ingress.stepOmissions === undefined ? {} : { stepOmissions: ingress.stepOmissions }),
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
        ...(record.stepOmissions === undefined ? {} : { stepOmissions: record.stepOmissions }),
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
