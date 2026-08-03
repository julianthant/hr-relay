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
import { TaskIdSchema } from "../domain/ids.js";
import { taskStoreRegistry } from "../stores/index.js";
import { personLookupModule } from "../workflows/person-lookup/module.js";

export const WORKFLOW_MODULES = Object.freeze([personLookupModule]);

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

/**
 * Audit descriptor↔impl pairing. Returns human-readable violations; an empty
 * array means every contract a descriptor names is either bound in a store or
 * explicitly tracked as pending.
 */
export function auditImplBindings(bindings: PendingImplBindings): readonly string[] {
  const violations: string[] = [];
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
