/** The bundle-safe descriptor tuple — the dashboard's aggregation of the one workflow composition root, not a second registry (a test pins every entry equals WORKFLOW_MODULES). */
import { compileWorkflow } from "../workflow-kit/workflow-definition.js";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../workflow-kit/workflow.js";
import { personLookupWorkflow } from "./person-lookup/workflow.js";
import { separationsWorkflow } from "./separations/workflow.js";

export const WORKFLOW_DESCRIPTORS = Object.freeze([
  compileWorkflow(personLookupWorkflow).descriptor,
  compileWorkflow(separationsWorkflow).descriptor,
] as const);

export function createWorkflowDescriptorRegistry(
  publicDescriptors: readonly AnyWorkflowDescriptor[],
  childOnlyDescriptors: readonly AnyWorkflowDescriptor[],
) {
  const descriptors = Object.freeze([...publicDescriptors]);
  const all = new Map<string, AnyWorkflowDescriptor>();
  for (const descriptor of [...descriptors, ...childOnlyDescriptors]) {
    if (all.has(descriptor.id)) throw new Error(`workflow ${descriptor.id} is registered more than once`);
    all.set(descriptor.id, descriptor);
  }
  const children = new Map([...all].map(([id, descriptor]) => [id,
    descriptorRuntimeNodes(descriptor).flatMap(node => node.kind === "child-run" ? [String(node.target.id)] : []),
  ]));
  const visiting = new Set<string>();
  const qualified = new Set<string>();
  const qualify = (id: string): void => {
    if (visiting.has(id)) throw new Error(`workflow delegation cycle at ${id}`);
    if (qualified.has(id)) return;
    const targets = children.get(id);
    if (targets === undefined) throw new Error(`workflow delegation target ${id} is not registered`);
    visiting.add(id);
    for (const target of targets) qualify(target);
    visiting.delete(id);
    qualified.add(id);
  };
  for (const id of all.keys()) qualify(id);

  return Object.freeze({
    descriptors,
    resolve: (id: string) => descriptors.find(descriptor => descriptor.id === id),
    resolveChild(parentId: string, id: string): AnyWorkflowDescriptor {
      const target = all.get(id);
      if (target === undefined) throw new Error(`workflow delegation target ${id} is not registered`);
      if (!children.get(parentId)?.includes(id)) {
        throw new Error(`workflow ${parentId} does not declare delegation to ${id}`);
      }
      return target;
    },
  });
}
