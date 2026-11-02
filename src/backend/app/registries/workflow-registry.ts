import { FingerprintSchema, type Fingerprint } from "../../../rules/identity/ids.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";

import { readFileSync } from "node:fs";
import {
  compileWorkflow,
  composeWorkflowModule,
  type WorkflowModule,
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
import { createWorkflowDescriptorRegistry } from "../../../workflows/descriptor-registry.js";

export function createWorkflowRegistry<PublicModule extends WorkflowModule>(
  publicEntries: readonly PublicModule[],
  childOnlyEntries: readonly WorkflowModule[],
) {
  const publicModules = Object.freeze([...publicEntries]);
  const modules = new Map([...publicModules, ...childOnlyEntries].map(module => [String(module.descriptor.id), module]));
  const descriptors = createWorkflowDescriptorRegistry(
    publicModules.map(module => module.descriptor),
    childOnlyEntries.map(module => module.descriptor),
  );
  const publicRegistry = Object.fromEntries(publicModules.map(module => [module.descriptor.id, module]));
  Object.setPrototypeOf(publicRegistry, null);
  return Object.freeze({
    publicModules,
    descriptors: descriptors.descriptors,
    publicRegistry: Object.freeze(publicRegistry),
    moduleOf(workflowId: string): PublicModule {
      const module = publicModules.find(candidate => candidate.descriptor.id === workflowId);
      if (module === undefined) {
        throw new Error(
          `workflow ${workflowId} is not registered; registered: ${publicModules.map(candidate => String(candidate.descriptor.id)).join(", ")}`,
        );
      }
      return module;
    },
    childModuleOf(parentId: string, workflowId: string): WorkflowModule {
      const descriptor = descriptors.resolveChild(parentId, workflowId);
      const module = modules.get(workflowId);
      if (module === undefined || module.descriptor !== descriptor) throw new Error(`workflow ${workflowId} module does not match its admitted descriptor`);
      return module;
    },
  });
}

export const personLookupModule = composeWorkflowModule(
  compileWorkflow(personLookupWorkflow),
  taskStoreRegistry.stores,
);
export const separationsModule = composeWorkflowModule(
  compileWorkflow(separationsWorkflow),
  taskStoreRegistry.stores,
);
const registry = createWorkflowRegistry([
  personLookupModule,
  separationsModule,
], []);

export const WORKFLOW_MODULES = registry.publicModules;

/** Resolve a public workflow, or refuse with its registered alternatives. */
export const workflowModuleOf = registry.moduleOf;

export const childWorkflowModuleOf = registry.childModuleOf;

export const DESCRIPTORS: readonly AnyWorkflowDescriptor[] = registry.descriptors;

export const SERVER_REGISTRY = registry.publicRegistry;


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

export function descriptorSetHash(fingerprints: readonly string[]): Fingerprint {
  return FingerprintSchema.parse(
    sha256Hex(`hrauto:descriptor-set:v1\0${[...fingerprints].sort().join("\n")}`),
  );
}
