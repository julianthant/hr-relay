import { workflowDefinitionOf } from "../workflow-definition.js";
import type { AnyWorkflowDefinition } from "../workflow-definition.js";
import { workflowProjections } from "../workflow.js";
import type { AnyWorkflowDescriptor } from "../workflow.js";
import type { RegisteredTaskStore } from "../task-registry.js";
import type { IntakeProjection } from "../../models/intake/projection.js";
import type { WorkflowModuleRole } from "./module-role.js";
import { workflowSourceFolder } from "./source-layout.js";

export interface WorkflowModuleBindingView {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly stores: readonly RegisteredTaskStore[];
}

/** A definition-backed module as the compiler's registry audit sees it. */
export interface WorkflowDefinitionModuleView extends WorkflowModuleBindingView {
  /** Every registered module is compiled from its one authored workflow.ts or step.ts definition. */
  readonly definition: AnyWorkflowDefinition;
}

/** One definition and the exact descriptor it compiled, as registered at the composition root. */
export interface WorkflowDefinitionRegistration {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly definition: AnyWorkflowDefinition;
}

// Reject a definition that did not compile this descriptor.
export function workflowDefinitionRegistry(
  modules: readonly WorkflowDefinitionModuleView[],
): readonly WorkflowDefinitionRegistration[] {
  const registrations: WorkflowDefinitionRegistration[] = [];
  for (const module of modules) {
    if (workflowDefinitionOf(module.descriptor) !== module.definition) {
      throw new Error(
        `workflow ${String(module.descriptor.id)} registers a definition that did not compile its own descriptor`,
      );
    }
    registrations.push(Object.freeze({ descriptor: module.descriptor, definition: module.definition }));
  }
  return Object.freeze(registrations);
}


// Keep intake outside the descriptor fingerprint.
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
      // Reuse the canonical schema object; copies can accept different rows.
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


// Require an explicit role; never infer one.
export interface WorkflowRoleView {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly role: WorkflowModuleRole;
}

// Harnesses target declared composition steps, not derived node timelines.
export function auditWorkflowModuleRoles(
  modules: readonly WorkflowRoleView[],
): readonly string[] {
  const violations: string[] = [];
  // One entry per module, so the role and the steps a harness may name can
  // never be looked up from two maps that disagree about who is registered.
  const registered = new Map<string, {
    role: WorkflowModuleRole;
    /** DECLARED keys only, `undefined` when the descriptor declared no timeline. */
    steps: readonly string[] | undefined;
  }>();
  for (const module of modules) {
    registered.set(String(module.descriptor.id), {
      role: module.role,
      steps: module.descriptor.timelineDeclared
        ? module.descriptor.timeline.map((category) => category.key)
        : undefined,
    });
  }
  // `(of, step)` is an ADDRESS: two harnesses claiming the same pair claim the same
  // folder. Checked in its own pass so a collision is still reported when the step is undeclared.
  const byAddress = new Map<string, { of: string; step: string; claimants: string[] }>();
  for (const module of modules) {
    if (module.role.kind !== "chunk-harness") continue;
    const address = workflowSourceFolder(String(module.descriptor.id), module.role);
    const claim = byAddress.get(address)
      ?? { of: String(module.role.of), step: module.role.step, claimants: [] };
    claim.claimants.push(String(module.descriptor.id));
    byAddress.set(address, claim);
  }
  for (const [address, { of, step, claimants }] of byAddress) {
    if (claimants.length < 2) continue;
    violations.push(
      `workflows ${claimants.join(" and ")} both declare role chunk-harness of ${of} `
      + `step ${step}; a step has ONE harness and ${address}/ is the one folder they would share`,
    );
  }
  for (const module of modules) {
    if (module.role.kind !== "chunk-harness") continue;
    const workflowId = String(module.descriptor.id);
    const target = String(module.role.of);
    const registration = registered.get(target);
    if (registration === undefined) {
      violations.push(
        `workflow ${workflowId} declares role chunk-harness of ${target}, which is not a registered workflow`,
      );
      continue;
    }
    if (registration.role.kind !== "composition") {
      violations.push(
        `workflow ${workflowId} declares role chunk-harness of ${target}, whose own role is `
        + `${registration.role.kind} rather than composition`,
      );
      continue;
    }
    const declaredSteps = registration.steps;
    if (declaredSteps === undefined) {
      // The rule bites only when a timeline is DECLARED; the factory always supplies a default
      // timeline, so checking it would accept node ids as steps — check the declared list.
      violations.push(
        `workflow ${workflowId} declares role chunk-harness of ${target} step ${module.role.step}, `
        + `but ${target} declares no timeline steps; a harness cannot be a step of it`,
      );
      continue;
    }
    if (!declaredSteps.includes(module.role.step)) {
      violations.push(
        `workflow ${workflowId} declares role chunk-harness of ${target} step ${module.role.step}, `
        + `which ${target} does not declare as a timeline category — it declares: `
        + `${declaredSteps.join(", ")}`,
      );
    }
  }
  return violations;
}

export function workflowRoleRegistry(
  modules: readonly WorkflowRoleView[],
): Readonly<Record<string, WorkflowModuleRole>> {
  const violations = auditWorkflowModuleRoles(modules);
  if (violations.length > 0) throw new Error(violations.join("; "));
  return Object.freeze(Object.fromEntries(
    modules.map((module) => [String(module.descriptor.id), module.role]),
  ));
}


// Duplicate codes make trace and archive identity ambiguous.
export function auditWorkflowCodes(
  descriptors: readonly AnyWorkflowDescriptor[],
): readonly string[] {
  const byCode = new Map<string, string[]>();
  for (const descriptor of descriptors) {
    const owners = byCode.get(descriptor.code) ?? [];
    owners.push(String(descriptor.id));
    byCode.set(descriptor.code, owners);
  }
  return [...byCode.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([code, owners]) =>
      `workflow code ${code} is declared by ${owners.join(" and ")}; a short code names exactly one workflow`);
}

export function workflowCodeRegistry(
  descriptors: readonly AnyWorkflowDescriptor[],
): Readonly<Record<string, string>> {
  const violations = auditWorkflowCodes(descriptors);
  if (violations.length > 0) throw new Error(violations.join("; "));
  return Object.freeze(Object.fromEntries(
    descriptors.map((descriptor) => [descriptor.code, String(descriptor.id)]),
  ));
}


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
