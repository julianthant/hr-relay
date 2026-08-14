/**
 * The composition root for workflows (doc 02 §1.2).
 *
 * `WORKFLOW_MODULES` is the ONE unavoidable static module tuple. Every registry
 * and projection below derives from it, so adding a workflow is one import plus
 * one tuple entry rather than ten synchronized lists — which is the whole point
 * of §1.3. Lower layers never import workflows; the arrow only points this way.
 *
 * Doc 02 §1.2 writes this file's path as `src/core/workflow-registry.ts`. It
 * lives under `src/control/` here because this tree's layer matrix (landed in
 * 1a) places `workflows` at the top layer beside `control`, and `core` below
 * it — so a registry in `core` importing workflow modules is a layer inversion
 * the `control-layering` ratchet rejects. Same composition root, same import
 * direction, one layer up.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { workflowProjections } from "../base/workflow.js";
import type { AnyWorkflowDescriptor } from "../base/workflow.js";
import type { RegisteredTaskStore } from "../base/store.js";
import { TaskIdSchema } from "../domain/ids.js";
import type { IntakeProjection } from "../domain/intake/projection.js";
import {
  isFactoryDefinedCaptureIntakeBinding,
  type CaptureIntakeBinding,
} from "../domain/capture-intake.js";
import { taskStoreRegistry } from "../stores/index.js";
import { kualiTimekeeperAnnotationModule } from "../workflows/kuali-timekeeper-annotation/module.js";
import { personLookupModule } from "../workflows/person-lookup/module.js";
import { separationsIdentityCheckModule } from "../workflows/separations-identity-check/module.js";
import { separationsKronosTimecardModule } from "../workflows/separations-kronos-timecard/module.js";
import { separationsKualiFinalizationModule } from "../workflows/separations-kuali-finalization/module.js";
import { separationsKualiReadModule } from "../workflows/separations-kuali-read/module.js";
import { separationsModule } from "../workflows/separations/module.js";
import { separationsUcpathTerminationModule } from "../workflows/separations-ucpath-termination/module.js";

export const WORKFLOW_MODULES = Object.freeze([
  personLookupModule,
  kualiTimekeeperAnnotationModule,
  separationsKronosTimecardModule,
  separationsKualiReadModule,
  separationsIdentityCheckModule,
  separationsUcpathTerminationModule,
  separationsKualiFinalizationModule,
  separationsModule,
]);

export const DESCRIPTORS: readonly AnyWorkflowDescriptor[] = Object.freeze(
  WORKFLOW_MODULES.map((module) => module.descriptor),
);

export const SERVER_REGISTRY = Object.freeze(Object.fromEntries(
  WORKFLOW_MODULES.map((module) => [module.descriptor.id, module]),
));

/**
 * Contracts a registered descriptor uses that no store implements YET.
 *
 * The list is checked in BOTH directions by `descriptor-coverage`: an unlisted
 * unbound contract fails, and a listed contract that a store has since bound
 * fails too. A missing impl is a legitimate mid-program state; a missing impl
 * nobody is tracking is exactly the drift a boot-time throw would only find in
 * production.
 */
export const PENDING_IMPL_BINDINGS_PATH = "config/pending-impl-bindings.json";

export const PendingImplBindingsSchema = z.strictObject({
  milestone: z.literal("1f"),
  reason: z.string().min(1),
  tasks: z.array(z.strictObject({
    taskId: TaskIdSchema,
    workflowId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    note: z.string().min(1),
  })),
});
export type PendingImplBindings = z.infer<typeof PendingImplBindingsSchema>;

export function readPendingImplBindings(repoRoot: string): PendingImplBindings {
  const parsed: unknown = JSON.parse(readFileSync(`${repoRoot}/${PENDING_IMPL_BINDINGS_PATH}`, "utf8"));
  const bindings = PendingImplBindingsSchema.parse(parsed);
  const ids = bindings.tasks.map(({ taskId }) => taskId);
  if (new Set(ids).size !== ids.length) throw new Error(`${PENDING_IMPL_BINDINGS_PATH} repeats a task id`);
  return bindings;
}

/** Task ids every registered store actually implements today. */
export function boundTaskIds(): readonly string[] {
  return Object.freeze(taskStoreRegistry.stores.flatMap((store) =>
    Object.values(store.tasks).map((task) => task.contract.id)));
}

export interface WorkflowModuleBindingView {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly stores: readonly RegisteredTaskStore[];
}

/**
 * Doc 06 §1's spreadsheet-capable declaration, read off the workflow's own
 * server composition value (D170).
 *
 * It lives on the MODULE rather than the descriptor because an intake
 * projection is not part of a run's contract identity — it declares which of
 * the workflow's input fields an operator may bind a column to, which the
 * server needs and a run envelope does not. Putting it on the descriptor would
 * fold it into `contractFingerprint` and re-stamp every existing run's contract
 * for a surface that touches none of them.
 *
 * No workflow declares one yet: person-lookup's input is a UNION, and
 * `defineIntakeProjection` resolves target paths through a strict object, so
 * that declaration is real design work and belongs with the grid surface
 * (2i-E3). Until then, intake refuses BY NAME rather than mapping against an
 * invented target set.
 */
export interface WorkflowIntakeView {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly intake?: IntakeProjection;
}

export function intakeProjectionRegistry(
  modules: readonly WorkflowIntakeView[],
): Readonly<Record<string, IntakeProjection>> {
  const entries: [string, IntakeProjection][] = [];
  for (const module of modules) {
    if (module.intake === undefined) continue;
    /**
     * The projection's `inputSchema` must BE the descriptor's input schema
     * object, not a copy that agrees today (D171).
     *
     * Everything downstream rests on it: validation parses each assembled row
     * through the projection's schema, and enqueue then re-reads that stored
     * value through the DESCRIPTOR's canonical schema and titles it with the
     * descriptor's own presentation. A structurally-similar second schema would
     * make intake produce values the workflow never accepted — the same
     * identity-not-equivalence argument `defineIntakeProjection` already makes
     * per target field, applied to the whole input.
     */
    if (module.intake.inputSchema !== module.descriptor.input) {
      throw new Error(
        `workflow ${String(module.descriptor.id)} declares an intake projection over a different input schema `
        + "object than its descriptor's; it must reuse the descriptor's own schema, not a copy of it",
      );
    }
    entries.push([String(module.descriptor.id), module.intake]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

export const INTAKE_PROJECTIONS = intakeProjectionRegistry(WORKFLOW_MODULES);

/**
 * The same shape for a photographed DOCUMENT source (D174, doc 06 §5.1).
 *
 * A capture handoff may only reach a workflow that has DECLARED how a bundle
 * becomes its input. None has: `person-lookup` is identified by an employee id
 * or a name and `kuali-timekeeper-annotation` by a document number, and
 * neither is derivable from a photograph without an OCR-backed workflow that
 * does not exist yet. So this registry is empty on purpose and the handoff
 * refuses by name — exactly how `INTAKE_PROJECTIONS` stood between D170 and
 * D172, and for the same reason: an invented binding would put a
 * plausible-but-wrong canonical input into a real run.
 */
export interface WorkflowCaptureView {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly captureIntake?: CaptureIntakeBinding;
}

export function captureIntakeRegistry(
  modules: readonly WorkflowCaptureView[],
): Readonly<Record<string, CaptureIntakeBinding>> {
  const entries: [string, CaptureIntakeBinding][] = [];
  for (const module of modules) {
    if (module.captureIntake === undefined) continue;
    if (!isFactoryDefinedCaptureIntakeBinding(module.captureIntake)) {
      throw new Error(
        `workflow ${String(module.descriptor.id)} declares a capture intake binding that did not come from `
        + "defineCaptureIntakeBinding; a hand-built one carries no fingerprint anything can trust",
      );
    }
    // Identity, not equivalence — the same argument `intakeProjectionRegistry`
    // makes: a structurally-similar second schema would let capture produce
    // values the workflow never accepted.
    if (module.captureIntake.inputSchema !== module.descriptor.input) {
      throw new Error(
        `workflow ${String(module.descriptor.id)} declares a capture intake binding over a different input `
        + "schema object than its descriptor's; it must reuse the descriptor's own schema, not a copy of it",
      );
    }
    entries.push([String(module.descriptor.id), module.captureIntake]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

export const CAPTURE_INTAKE_BINDINGS = captureIntakeRegistry(WORKFLOW_MODULES);

/**
 * A globally bound task is not enough: the workflow module itself is the
 * server composition boundary. Every contract must resolve through one of that
 * module's own stores, and every listed store must serve at least one contract
 * in that descriptor.
 */
export function auditWorkflowModuleBindings(
  modules: readonly WorkflowModuleBindingView[],
): readonly string[] {
  const violations: string[] = [];
  for (const module of modules) {
    const contracts = workflowProjections(module.descriptor).contracts;
    const expectedNamespaces = new Set(contracts.map((contract) =>
      String(contract.id).slice(0, String(contract.id).lastIndexOf("/"))));
    const moduleNamespaces = module.stores.map(({ namespace }) => String(namespace));
    if (new Set(moduleNamespaces).size !== moduleNamespaces.length) {
      violations.push(`${module.descriptor.id} module repeats a task store namespace`);
    }
    for (const namespace of moduleNamespaces) {
      if (!expectedNamespaces.has(namespace)) {
        violations.push(`${module.descriptor.id} module lists extra store ${namespace}`);
      }
    }
    for (const namespace of expectedNamespaces) {
      if (!moduleNamespaces.includes(namespace)) {
        violations.push(`${module.descriptor.id} module is missing store ${namespace}`);
      }
    }
    for (const contract of contracts) {
      const owner = module.stores.find(({ namespace }) =>
        String(contract.id).startsWith(`${String(namespace)}/`));
      if (owner === undefined || !Object.values(owner.tasks).some((task) => task.contract === contract)) {
        violations.push(`${module.descriptor.id} module cannot resolve its exact contract ${contract.id}`);
      }
    }
  }
  return violations;
}

/**
 * Audit descriptor↔impl pairing. Returns human-readable violations; an empty
 * array means every contract a descriptor names is either bound in a store or
 * explicitly tracked as pending.
 */
export function auditImplBindings(bindings: PendingImplBindings): readonly string[] {
  const violations: string[] = [...auditWorkflowModuleBindings(WORKFLOW_MODULES)];
  const bound = new Set(boundTaskIds());
  const pending = new Map(bindings.tasks.map((entry) => [String(entry.taskId), entry]));
  const used = new Set<string>();

  for (const descriptor of DESCRIPTORS) {
    for (const contract of workflowProjections(descriptor).contracts) {
      const id = String(contract.id);
      used.add(id);
      if (bound.has(id)) continue;
      const entry = pending.get(id);
      if (entry === undefined) {
        violations.push(`${descriptor.id} uses ${id}, which no store implements and which is not tracked in ${PENDING_IMPL_BINDINGS_PATH}`);
        continue;
      }
      if (entry.workflowId !== String(descriptor.id)) {
        violations.push(`${PENDING_IMPL_BINDINGS_PATH} attributes ${id} to ${entry.workflowId}, but ${descriptor.id} uses it`);
      }
    }
  }
  for (const [id] of pending) {
    if (bound.has(id)) {
      violations.push(`${PENDING_IMPL_BINDINGS_PATH} still lists ${id}, which a store now implements — delete the entry`);
    }
    if (!used.has(id)) {
      violations.push(`${PENDING_IMPL_BINDINGS_PATH} lists ${id}, which no registered descriptor uses`);
    }
  }
  return violations;
}
