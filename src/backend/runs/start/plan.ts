import { type ProtectedInputBinding } from "../../../models/write-safety/protected-input.js";
import { admitProtectedInput, hasProtectedSubject, protectedSubjectDisplay, protectedSubjectMatchKey } from "./protected-input.js";
import { errorText } from "../lifecycle/support.js";
import type { ProtectedSecretSource } from "../../../models/config/secrets.js";
import type { SchemaBoundCanonicalValue } from "../../../models/validation/schema-bound-value.js";

import type { RerunPlan } from "../../../models/run/rerun.js";
import { workflowDryRunSupport, workflowPlanning, workflowProjections } from "../../../workflow-kit/workflow.js";
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { JsonValueSchema } from "../../../rules/validation/canonical-json.js";
import type { JsonValue } from "../../../rules/validation/canonical-json.js";
import type { Clock } from "../../../rules/time/clock.js";
import { deriveItemId } from "../../../rules/identity/identifiers.js";
import type { IdFactory } from "../../../rules/identity/identifiers.js";
import {
  IsoInstantSchema,
  PositiveIntSchema,
} from "../../../rules/identity/ids.js";
import type { BrowserPresentationMode, InstanceSelection, RunPriority, RunShape, RunWorkers } from "../../../models/run/envelope.js";
import type { StepOmissions } from "../../../models/workflow/step-omission.js";
import { InstanceSelectionSchema } from "../../../models/run/envelope.js";
import { isTerminalRunState, type RunRecord } from "../../../models/run/record.js";
import { startSupersedeTargets } from "../../../models/run/start-supersede.js";
import {
  deriveCanonicalInputDigest,
  derivePlannedInputFingerprint,
  PlannedRunSchema,
  StartPlanRecordSchema,
} from "../../../models/run/start-plan.js";
import type { PlannedRun, StartPlanRecord, StartRefusal } from "../../../models/run/start-plan.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";


export interface StartPlannerDeps {
  readonly protectedSecrets?: ProtectedSecretSource;

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
  readonly protectedSubmissionBindings?: readonly ProtectedInputBinding[];
  readonly retainedInputs?: readonly SchemaBoundCanonicalValue[];
  /** Raw submissions in the operator's order; entry numbers are 1-based. */
  readonly submissions: readonly unknown[];
  readonly requestedInstance?: InstanceSelection;
  readonly dryRun: boolean;
  readonly workers?: RunWorkers;
  // Dashboard starts require explicit choices; retained non-dashboard callers may omit them.
  readonly browserMode?: BrowserPresentationMode;
  /** Omission retains the pre-capture behavior (no browser screenshot). */
  readonly captureBrowserScreenshots?: boolean;

  readonly stepOmissions?: StepOmissions;
  readonly priority: RunPriority;
  readonly shape: RunShape;
  readonly configFingerprint: string;
  readonly configSnapshotId: string;
  readonly plannedBy: string;
  readonly rerun?: RerunPlan;
}

export function resolveInstances(
  descriptor: AnyWorkflowDescriptor,
  requested: InstanceSelection | undefined,
): InstanceSelection {
  const systems = workflowProjections(descriptor).systems;
  const resolved: Record<string, string> = {};
  for (const system of systems) resolved[system] = "prod";
  for (const [system, instance] of Object.entries(requested ?? {})) {
    if (instance === "test") {
      throw new Error(`${descriptor.id} requested a retired test instance for ${system}`);
    }
    if (!systems.includes(system)) {
      throw new Error(`${descriptor.id} never reaches ${system}; it cannot resolve an instance for it`);
    }
    resolved[system] = instance;
  }
  return InstanceSelectionSchema.parse(resolved);
}


export function supportsDryRun(descriptor: AnyWorkflowDescriptor): boolean {
  return workflowDryRunSupport(descriptor).state === "supported";
}


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

  const admittedSubmissions = admitProtectedInput(descriptor, request.submissions, deps.protectedSecrets, request.retainedInputs, request.protectedSubmissionBindings);
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
      parsed = planning.parseInput(admittedSubmissions[index].admitted);
      canonicalInput = planning.parseCanonicalInput(parsed);
    } catch (error) {
      refuse("input-invalid", admittedSubmissions[index].bindings.length > 0 ? "workflow input is invalid" : errorText(error));
      continue;
    }

    const bindings = admittedSubmissions[index].bindings;
    const protectedSubject = hasProtectedSubject(bindings);
    const matchKey = protectedSubject ? protectedSubjectMatchKey(bindings, canonicalInput) : planning.matchKey(parsed);
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

    const display = protectedSubjectDisplay(bindings, () => ({ title: planning.title(parsed), subtitle: planning.subtitle(parsed) }));
    seenItemIds.add(itemId);
    planned.push(PlannedRunSchema.parse({
      ...(descriptor.enqueue !== "supersede-active" ? {} : { supersedeTargets: startSupersedeTargets(
        deps.authority.authority.runs.listByItem({ workflow: descriptor.id, itemId })) }),
      itemId,
      ...display,
      rawInput,
      input: { schemaHash: canonicalSchemaHash, value: canonicalInput,
        protectedBindings: admittedSubmissions[index].bindings },
      canonicalInputDigest: deriveCanonicalInputDigest(canonicalInput, admittedSubmissions[index].bindings),
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
    workers: request.workers ?? "auto",
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
