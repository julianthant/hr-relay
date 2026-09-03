/**
 * The composition root for workflows (ref workflow-model §1.2).
 *
 * `WORKFLOW_MODULES` is the ONE unavoidable static module tuple. Every registry
 * and projection below derives from it, so adding a workflow is one import plus
 * one tuple entry rather than ten synchronized lists — which is the whole point
 * of §1.3. Lower layers never import workflows; the arrow only points this way.
 *
 * Ref workflow-model §1.2 writes this file's path as `src/core/workflow-registry.ts`. It
 * lives under `src/control/` here because this tree's layer matrix (landed in
 * 1a) places `workflows` at the top layer beside `control`, and `core` below
 * it — so a registry in `core` importing workflow modules is a layer inversion
 * the `control-layering` ratchet rejects. Same composition root, same import
 * direction, one layer up.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  compileWorkflow,
  composeWorkflowModule,
  workflowDefinitionOf,
} from "../base/workflow-definition.js";
import type { AnyWorkflowDefinition } from "../base/workflow-definition.js";
import { workflowProjections } from "../base/workflow.js";
import type { AnyWorkflowDescriptor } from "../base/workflow.js";
import type { RegisteredTaskStore } from "../base/store.js";
import { TaskIdSchema } from "../domain/ids.js";
import type { IntakeProjection } from "../domain/intake/projection.js";
import type { WorkflowModuleRole } from "../domain/workflow/module-role.js";
import { workflowSourceFolder } from "../domain/workflow/source-layout.js";
import { taskStoreRegistry } from "../stores/index.js";
import { personLookupWorkflow } from "../workflows/person-lookup/workflow.js";
import { separationsIdentityCheckWorkflow } from "../workflows/separations/identity-check/workflow.js";
import { separationsKronosTimecardWorkflow } from "../workflows/separations/kronos-timecard/workflow.js";
import { separationsKualiFinalizationWorkflow } from "../workflows/separations/kuali-finalization/workflow.js";
import { separationsKualiReadWorkflow } from "../workflows/separations/kuali-extraction/workflow.js";
import { separationsWorkflow } from "../workflows/separations/workflow.js";
import { separationsUcpathTerminationWorkflow } from "../workflows/separations/ucpath-transaction/workflow.js";

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
export const separationsKronosTimecardModule = composeWorkflowModule(
  compileWorkflow(separationsKronosTimecardWorkflow),
  taskStoreRegistry.stores,
);
export const separationsUcpathTerminationModule = composeWorkflowModule(
  compileWorkflow(separationsUcpathTerminationWorkflow),
  taskStoreRegistry.stores,
);
export const separationsKualiFinalizationModule = composeWorkflowModule(
  compileWorkflow(separationsKualiFinalizationWorkflow),
  taskStoreRegistry.stores,
);
export const separationsKualiReadModule = composeWorkflowModule(
  compileWorkflow(separationsKualiReadWorkflow),
  taskStoreRegistry.stores,
);
export const separationsIdentityCheckModule = composeWorkflowModule(
  compileWorkflow(separationsIdentityCheckWorkflow),
  taskStoreRegistry.stores,
);

export const WORKFLOW_MODULES = Object.freeze([
  personLookupModule,
  separationsKronosTimecardModule,
  separationsKualiReadModule,
  separationsIdentityCheckModule,
  separationsUcpathTerminationModule,
  separationsKualiFinalizationModule,
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

/** A definition-backed module as the compiler's registry audit sees it. */
export interface WorkflowDefinitionModuleView extends WorkflowModuleBindingView {
  /** D317 — every registered module is compiled from its one authored `workflow.ts` definition. */
  readonly definition: AnyWorkflowDefinition;
}

/** One definition and the exact descriptor it compiled, as registered at the composition root. */
export interface WorkflowDefinitionRegistration {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly definition: AnyWorkflowDefinition;
}

/**
 * D311/D317's registry-facing definition population.
 *
 * A module may expose a definition only when that exact object compiled its
 * own descriptor. The compiler's identity ledger is deliberately checked again
 * at the composition boundary: otherwise a module could be registered with a
 * definition that describes a different workflow while each value looks valid
 * in isolation. Since 3c-A's deletion acceptance every registered module is
 * definition-backed; there is no unconverted arm to skip.
 */
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

/** Every definition-backed workflow, derived only from the one module tuple. */
export const WORKFLOW_DEFINITIONS = workflowDefinitionRegistry(WORKFLOW_MODULES);


/**
 * Ref data-intake-and-edit-data §1's spreadsheet-capable declaration, read off the workflow's own
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
 * A module as the role audit needs to see it (ref workflow-model §1.2.1, D219).
 *
 * `role` is REQUIRED here for the same reason it is required on the module: an
 * optional field is one a new module forgets to fill while every surface still
 * renders, and there is no honest default — a workflow that declared nothing
 * would be silently standalone.
 */
export interface WorkflowRoleView {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly role: WorkflowModuleRole;
}

/**
 * Every `chunk-harness` names a registered COMPOSITION, and a step that
 * composition declares.
 *
 * A dangling `of`, or an `of` pointing at a standalone workflow or at another
 * harness, is a membership claim nothing can render — and the surfaces that
 * consume it (rail, picker, explorer) would each have to invent a fallback,
 * which is how three surfaces come to disagree about what is a step and what is
 * a workflow. Refusing it here makes both states unrepresentable rather than
 * banned.
 *
 * D265 (ref workflow-model §1.2.2 rule 3) adds the second half: `step` names
 * one of `of`'s DECLARED timeline category keys — the step folder the harness
 * lives in. The word declared is load-bearing, and `descriptor.timeline` cannot
 * supply it: the factory hands every descriptor a timeline, so D225's per-node
 * default (keyed by node id) is indistinguishable from a real declaration by
 * shape alone. §1.2.2 rule 2 says the rule bites exactly when a timeline is
 * declared, so the audit reads `timelineDeclared` and takes two different
 * paths: a composition that declared none has NO steps to be of and every
 * harness of it is refused by that name, while a composition that declared some
 * is checked against those keys only. Either violation names the workflow and
 * the step, and the second names every key the composition does declare,
 * because "not a step" is unactionable without the list.
 */
export function auditWorkflowModuleRoles(
  modules: readonly WorkflowRoleView[],
): readonly string[] {
  const violations: string[] = [];
  // One entry per module, so the role and the steps a harness may name can
  // never be looked up from two maps that disagree about who is registered.
  const registered = new Map<string, {
    role: WorkflowModuleRole;
    /** DECLARED keys only, `undefined` when the descriptor declared no timeline (D265). */
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
  // `(of, step)` is an ADDRESS, not a label: §1.2.2 rule 3 puts the harness's
  // `descriptor.ts` and `module.ts` at `src/workflows/<of>/<step>/`, so two
  // harnesses claiming the same pair claim the same two files — a state the
  // filesystem cannot represent. Left unrefused, `workflow-layout` arm (a)
  // would read that folder's descriptor, find the OTHER id declared, and blame
  // whichever module it visited first; naming both here says what actually
  // happened. Checked in its own pass so a collision is still reported when the
  // shared step is also undeclared — otherwise adding the missing folder would
  // silently promote a collision to green.
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
      // §1.2.2 rule 2 — the rule bites exactly when a timeline is DECLARED. The
      // factory still hands this descriptor a timeline (D225's per-node
      // default, keyed by node id), so checking the normalized list would
      // accept any of its NODE IDS as a step and admit a harness of a workflow
      // that has no step folders at all.
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

/**
 * The id → role projection, validated at LOAD.
 *
 * Fail-loud at the composition root, exactly as `intakeProjectionRegistry`
 * does: a process that cannot say what a registered workflow IS must not serve
 * a surface that groups by it. The audit above is the one implementation — the
 * throw and the CI guard can never disagree about what a violation is.
 */
export function workflowRoleRegistry(
  modules: readonly WorkflowRoleView[],
): Readonly<Record<string, WorkflowModuleRole>> {
  const violations = auditWorkflowModuleRoles(modules);
  if (violations.length > 0) throw new Error(violations.join("; "));
  return Object.freeze(Object.fromEntries(
    modules.map((module) => [String(module.descriptor.id), module.role]),
  ));
}

export const WORKFLOW_ROLES = workflowRoleRegistry(WORKFLOW_MODULES);

/**
 * Every registered workflow's SHORT CODE names exactly one workflow
 * (ref workflow-model §1.1, D242).
 *
 * The descriptor factory already refuses a malformed code, and a code cannot
 * check its own uniqueness — one descriptor never sees its siblings. Here is
 * the only place the whole registry is in scope, and uniqueness is not a nice
 * property: the code is the trace id's leading segment, so two workflows
 * sharing `sd` would make `sd-141203-9a1c` name two different things at once,
 * and it is the archive index's leading token, so an operator scanning 800
 * rows would read one code as two workflows' work. Both are silent — nothing
 * throws, the rows just mean something other than what they say.
 */
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

/**
 * The code → workflow projection, validated at LOAD, exactly as
 * `workflowRoleRegistry` validates roles: a process that cannot say which
 * workflow a code names must not serve a surface that prints codes, and must
 * not mint a trace id whose prefix is ambiguous.
 */
export function workflowCodeRegistry(
  descriptors: readonly AnyWorkflowDescriptor[],
): Readonly<Record<string, string>> {
  const violations = auditWorkflowCodes(descriptors);
  if (violations.length > 0) throw new Error(violations.join("; "));
  return Object.freeze(Object.fromEntries(
    descriptors.map((descriptor) => [descriptor.code, String(descriptor.id)]),
  ));
}

export const WORKFLOW_IDS_BY_CODE = workflowCodeRegistry(DESCRIPTORS);

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
