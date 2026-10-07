/**
 * The composition root for workflows (ref workflow-model §1.2).
 *
 * `WORKFLOW_MODULES` is the ONE unavoidable static module tuple. Every registry
 * and projection below derives from it, so adding a workflow is one import plus
 * one tuple entry rather than ten synchronized lists — which is the whole point
 * of §1.3. Lower layers never import workflows; the arrow only points this way.
 *
 * This app-owned registry imports workflow modules and assembles their
 * descriptors. Lower-level runtime packages receive the compiled values.
 */
import { readFileSync } from "node:fs";
import {
  compileWorkflow,
  composeWorkflowModule,
} from "../../../workflow-kit/workflow-definition.js";
import { workflowProjections } from "../../../workflow-kit/workflow.js";
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { PendingImplBindingsSchema } from "../../../workflow-kit/validation/impl-bindings.js";
import type { PendingImplBindings } from "../../../workflow-kit/validation/impl-bindings.js";
import {
  auditWorkflowCodes,
  auditWorkflowModuleBindings,
  auditWorkflowModuleRoles,
  intakeProjectionRegistry,
  workflowCodeRegistry,
  workflowDefinitionRegistry,
  workflowRoleRegistry,
} from "../../../workflow-kit/validation/workflow-module-audit.js";
import { taskStoreRegistry } from "./task-registry.js";
import { personLookupWorkflow } from "../../../workflows/person-lookup/workflow.js";
import { separationsWorkflow } from "../../../workflows/separations/workflow.js";

/**
 * D311/D317 — a definition-backed workflow's server module is DERIVED here,
 * at the composition root, from its one authored `workflow.ts` value and the
 * task-store inventory. Nothing under `src/workflows/` composes stores.
 */
export const personLookupModule = composeWorkflowModule(
  compileWorkflow(personLookupWorkflow),
  taskStoreRegistry.stores,
);
export const separationsModule = composeWorkflowModule(
  compileWorkflow(separationsWorkflow),
  taskStoreRegistry.stores,
);
export const WORKFLOW_MODULES = Object.freeze([
  personLookupModule,
  separationsModule,
]);

/** The registered module for one workflow id, or a loud refusal naming the registry. */
export function workflowModuleOf(workflowId: string): (typeof WORKFLOW_MODULES)[number] {
  const module = WORKFLOW_MODULES.find((candidate) => String(candidate.descriptor.id) === workflowId);
  if (module === undefined) {
    throw new Error(
      `workflow ${workflowId} is not registered; registered: ${WORKFLOW_MODULES.map((candidate) => String(candidate.descriptor.id)).join(", ")}`,
    );
  }
  return module;
}

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
export const PENDING_IMPL_BINDINGS_PATH = "src/backend/app/registries/pending-impl-bindings.json";

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

/** Every definition-backed workflow, derived only from the one module tuple. */
export const WORKFLOW_DEFINITIONS = workflowDefinitionRegistry(WORKFLOW_MODULES);


export const INTAKE_PROJECTIONS = intakeProjectionRegistry(WORKFLOW_MODULES);

export const WORKFLOW_ROLES = workflowRoleRegistry(WORKFLOW_MODULES);

export const WORKFLOW_IDS_BY_CODE = workflowCodeRegistry(DESCRIPTORS);

/**
 * Audit descriptor↔impl pairing. Returns human-readable violations; an empty
 * array means every contract a descriptor names is either bound in a store or
 * explicitly tracked as pending.
 */
export function auditImplBindings(bindings: PendingImplBindings): readonly string[] {
  const violations: string[] = [
    ...auditWorkflowModuleBindings(WORKFLOW_MODULES),
    ...auditWorkflowModuleRoles(WORKFLOW_MODULES),
    ...auditWorkflowCodes(DESCRIPTORS),
  ];
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
