import { bindWorkflowDelegationTargets, descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../workflow-kit/workflow.js";
export { WORKFLOW_DESCRIPTORS } from "./generated-descriptors.js";
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
  bindWorkflowDelegationTargets([...all.values()]);

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
