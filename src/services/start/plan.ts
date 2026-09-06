/**
 * Start planning — the step between "the operator typed something" and "runs
 * exist" (ref frontend-backend-integration §5.1).
 *
 * The planner parses every submission, derives its logical identity, evaluates
 * the descriptor's enqueue policy against authority, and returns exactly what
 * would start plus exactly what will not and why. Nothing here writes a run.
 *
 * **A refusal is an outcome, not an omission.** A submission that cannot start
 * is a named `refused` entry carrying the reason, so the confirmation surface
 * can show "3 will start, 1 refused: an active run already exists" rather than
 * silently planning three. Dropping the fourth would be the same failure mode
 * as a fallback: the operator would act on a lie.
 */
import type { RerunPlan } from "../../domain/run/rerun.js";
import { workflowDryRunSupport, workflowPlanning, workflowProjections } from "../../base/workflow.js";
import type { AnyWorkflowDescriptor } from "../../base/workflow.js";
import { JsonValueSchema } from "../../domain/canonical-json.js";
import type { JsonValue } from "../../domain/canonical-json.js";
import type { Clock } from "../../domain/clock.js";
import { deriveItemId } from "../../domain/identifiers.js";
import type { IdFactory } from "../../domain/identifiers.js";
import {
  BrowserSystemIdSchema,
  IsoInstantSchema,
  PositiveIntSchema,
} from "../../domain/ids.js";
import type { BrowserPresentationMode, InstanceSelection, RunPriority, RunShape } from "../../domain/run/envelope.js";
import type { StepOmissions } from "../../domain/workflow/step-omission.js";
import { InstanceSelectionSchema } from "../../domain/run/envelope.js";
import { isTerminalRunState, type RunRecord } from "../../domain/run/record.js";
import {
  deriveCanonicalInputDigest,
  derivePlannedInputFingerprint,
  PlannedRunSchema,
  StartPlanRecordSchema,
} from "../../domain/run/start-plan.js";
import type { PlannedRun, StartPlanRecord, StartRefusal } from "../../domain/run/start-plan.js";
import { deriveSchemaHash } from "../../domain/schema-bound-value.js";


export interface StartPlannerDeps {
  /**
   * Narrowed to the ONE read the planner makes (D179). An `AuthorityDatabase`
   * satisfies it structurally, so every existing caller is unchanged; the
   * relaunch arm, which runs INSIDE a command transaction and holds only the
   * repositories, can now plan through this same function instead of growing
   * a second, divergent copy of ingress parsing.
   */
  readonly authority: Readonly<{
    authority: Readonly<{ runs: Readonly<{ listByItem(input: unknown): readonly RunRecord[] }> }>;
  }>;
  readonly clock: Clock;
  readonly ids: IdFactory;
  /** How long a confirmation stays valid before it must be re-planned. */
  readonly planTtlMs: number;
}

export interface StartPlanRequest {
  readonly descriptor: AnyWorkflowDescriptor;
  /** Raw submissions in the operator's order; entry numbers are 1-based. */
  readonly submissions: readonly unknown[];
  readonly requestedInstance?: InstanceSelection;
  readonly dryRun: boolean;
  /** Dashboard starts are explicit; other historical/non-dashboard callers may omit it. */
  readonly browserMode?: BrowserPresentationMode;
  /** Omission retains the pre-capture behavior (no browser screenshot). */
  readonly captureBrowserScreenshots?: boolean;
  /** D307 — already validated against the descriptor's omission forms and cascade by the caller. */
  readonly stepOmissions?: StepOmissions;
  readonly priority: RunPriority;
  readonly shape: RunShape;
  readonly configFingerprint: string;
  readonly configSnapshotId: string;
  readonly plannedBy: string;
  readonly rerun?: RerunPlan;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Every browser system the descriptor reaches, resolved to an instance.
 *
 * Production is the default and test is opt-in, which is the documented
 * direction: an unrequested system resolving to `test` would run a "real" job
 * against a sandbox and report success. A request for a system the descriptor
 * never touches is a mistake worth surfacing, so it throws rather than being
 * dropped.
 */
export function resolveInstances(
  descriptor: AnyWorkflowDescriptor,
  requested: InstanceSelection | undefined,
): InstanceSelection {
  const systems = workflowProjections(descriptor).systems;
  const resolved: Record<string, string> = {};
  for (const system of systems) resolved[system] = "prod";
  for (const [system, instance] of Object.entries(requested ?? {})) {
    if (!systems.includes(system)) {
      throw new Error(`${descriptor.id} never reaches ${system}; it cannot resolve an instance for it`);
    }
    resolved[system] = instance;
  }
  return InstanceSelectionSchema.parse(resolved);
}

/**
 * Whether this GRAPH can be previewed (ref workflow-model §2, D209) — never whether it has
 * a paste-a-line input surface. The derivation lives on the descriptor's own
 * projection so the planner, the command kernel and the explorer wire all read
 * ONE answer.
 */
export function supportsDryRun(descriptor: AnyWorkflowDescriptor): boolean {
  return workflowDryRunSupport(descriptor).state === "supported";
}

/**
 * The refusal a dry-run start earns, in the graph's own words. The two arms are
 * genuinely different situations and a single message would misdescribe one of
 * them: a read-only graph HAS no write to stop before, while a write graph with
 * an `unsupported` transaction node has one and declares no preview arm for it.
 */
export function dryRunRefusalMessage(descriptor: AnyWorkflowDescriptor): string {
  const support = workflowDryRunSupport(descriptor);
  if (support.state === "supported") {
    throw new Error(`${descriptor.id} supports a dry run; there is no refusal to describe`);
  }
  if (support.reason === "no-transaction-node") {
    return `${descriptor.id} has no transaction node, so a dry run would be indistinguishable from a real `
      + "run; start it for real or not at all";
  }
  return `${descriptor.id} transaction node "${support.nodeId}" declares dryRun:"unsupported"; `
    + "start it for real or not at all";
}

export function planStart(deps: StartPlannerDeps, request: StartPlanRequest): StartPlanRecord {
  const { descriptor } = request;
  /**
   * A non-JSON value cannot be preserved in the durable plan faithfully. Reject
   * the whole planning request before minting any proposal rather than turning
   * it into a plausible refusal with fabricated or dropped ingress.
   */
  const rawSubmissions: JsonValue[] = [];
  for (let index = 0; index < request.submissions.length; index += 1) {
    if (!Object.hasOwn(request.submissions, index)) {
      throw new Error(
        `start plan ${descriptor.id} entry ${String(index + 1)} is missing; submissions must be a dense array`,
      );
    }
    const submission = request.submissions[index];
    try {
      rawSubmissions.push(JsonValueSchema.parse(submission));
    } catch (error) {
      throw new Error(
        `start plan ${descriptor.id} entry ${String(index + 1)} is not strict JSON and cannot be retained: ${errorText(error)}`,
        { cause: error },
      );
    }
  }
  const planning = workflowPlanning(descriptor);
  const now = IsoInstantSchema.parse(deps.clock.now().toISOString());
  const ingressSchemaHash = deriveSchemaHash(descriptor.input, "input");
  const canonicalSchemaHash = deriveSchemaHash(descriptor.canonicalInput, "output");
  const resolvedInstance = resolveInstances(descriptor, request.requestedInstance);

  const planned: PlannedRun[] = [];
  const refused: StartRefusal[] = [];
  const seenItemIds = new Set<string>();

  for (const [index, rawInput] of rawSubmissions.entries()) {
    const entry = PositiveIntSchema.parse(index + 1);
    const refuse = (code: StartRefusal["code"], message: string): void => {
      refused.push({ entry, rawInput, code, message });
    };

    if (request.dryRun && !supportsDryRun(descriptor)) {
      refuse("dry-run-unsupported", dryRunRefusalMessage(descriptor));
      continue;
    }

    let parsed: unknown;
    let canonicalInput: unknown;
    try {
      // This is the one and only ingress parse for this raw submission.
      parsed = planning.parseInput(rawInput);
      canonicalInput = planning.parseCanonicalInput(parsed);
    } catch (error) {
      refuse("input-invalid", errorText(error));
      continue;
    }

    const matchKey = planning.matchKey(parsed);
    const itemId = deriveItemId(descriptor.id, matchKey);
    if (seenItemIds.has(itemId)) {
      refuse("active-run-exists", `entry ${String(entry)} repeats ${matchKey}, which is already in this plan`);
      continue;
    }

    if (descriptor.enqueue === "reject-active") {
      const active = deps.authority.authority.runs
        .listByItem({ workflow: descriptor.id, itemId })
        .filter((run) => !isTerminalRunState(run.lifecycle));
      if (active.length > 0) {
        refuse("active-run-exists", `${matchKey} already has an active run (${active[0].envelope.traceId})`);
        continue;
      }
    }

    const subtitle = planning.subtitle(parsed);
    seenItemIds.add(itemId);
    planned.push(PlannedRunSchema.parse({
      itemId,
      title: planning.title(parsed),
      ...(subtitle === undefined ? {} : { subtitle }),
      rawInput,
      input: { schemaHash: canonicalSchemaHash, value: canonicalInput },
      canonicalInputDigest: deriveCanonicalInputDigest(canonicalInput),
      matchKey,
    }));
  }

  return StartPlanRecordSchema.parse({
    startPlanId: deps.ids.uuid(),
    workflowId: descriptor.id,
    descriptorVersion: descriptor.version,
    descriptorFingerprint: descriptor.contractFingerprint,
    configFingerprint: request.configFingerprint,
    configSnapshotId: request.configSnapshotId,
    ingressSchemaHash,
    canonicalInputSchemaHash: canonicalSchemaHash,
    inputFingerprint: derivePlannedInputFingerprint(planned, ingressSchemaHash, canonicalSchemaHash, request.rerun, request.stepOmissions),
    ...(request.requestedInstance === undefined ? {} : { requestedInstance: request.requestedInstance }),
    resolvedInstance,
    shape: request.shape,
    priority: request.priority,
    dryRun: request.dryRun,
    ...(request.browserMode === undefined ? {} : { browserMode: request.browserMode }),
    captureBrowserScreenshots: request.captureBrowserScreenshots ?? false,
    ...(request.stepOmissions === undefined ? {} : { stepOmissions: request.stepOmissions }),
    ...(request.rerun === undefined ? {} : { rerun: request.rerun }),
    planned,
    refused,
    plannedBy: request.plannedBy,
    plannedAt: now,
    expiresAt: IsoInstantSchema.parse(new Date(deps.clock.nowMs() + deps.planTtlMs).toISOString()),
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
}

/** The browser systems a planned run will touch, for preflight and session accounting. */
export function plannedSystems(descriptor: AnyWorkflowDescriptor): readonly string[] {
  return workflowProjections(descriptor).systems.map((system) => BrowserSystemIdSchema.parse(system));
}
