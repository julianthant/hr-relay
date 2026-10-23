import { parseCanonicalInputSnapshot } from "../../../models/workflow/canonical-input.js";
import { planDelegationFanOut } from "../../../models/workflow/delegation.js";
import { retainedRunProtectedBindings } from "../../../models/write-safety/protected-input.js";
import { deriveItemId } from "../../../rules/identity/identifiers.js";
import { ItemIdSchema } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify, JsonValueSchema } from "../../../rules/validation/canonical-json.js";
import { workflowPlanning, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import type { ChildRunContext } from "../../runtime/execution/run-executor.js";
import { hasProtectedSubject, protectedSubjectMatchKey } from "../start/protected-input.js";

export function canonicalDelegationChild(context: ChildRunContext, target: AnyWorkflowDescriptor, bound: unknown) {
  const input = JsonValueSchema.parse(target.canonicalInput.parse(bound));
  const parentInput = parseCanonicalInputSnapshot(context.descriptor.canonicalInput, context.run.input.parsed);
  const bindings = retainedRunProtectedBindings(context.run).filter(binding => input !== null && typeof input === "object"
    && !Array.isArray(input) && Object.hasOwn(input, binding.inputPath));
  for (const binding of retainedRunProtectedBindings(context.run)) {
    const source: unknown = Reflect.get(Object(parentInput), binding.inputPath);
    const contains = (value: unknown): boolean => value !== null && typeof value === "object" ? Object.values(value).some(contains) : value === source;
    const remaining = input !== null && typeof input === "object" && !Array.isArray(input)
      ? Object.fromEntries(Object.entries(input).filter(([key]) => key !== binding.inputPath)) : input;
    if (contains(remaining)) throw new Error("delegation-protected-input-mapping-unavailable");
    if (bindings.includes(binding) && canonicalJsonStringify(Reflect.get(Object(input), binding.inputPath)) !== canonicalJsonStringify(source)) {
      throw new Error("delegation-protected-input-mismatch");
    }
  }
  const matchKey = hasProtectedSubject(bindings) ? protectedSubjectMatchKey(bindings, input) : workflowPlanning(target).matchKey(input);
  return { input, bindings, matchKey, canonicalItemId: ItemIdSchema.parse(deriveItemId(target.id, matchKey)) };
}

export function planCanonicalDelegation(context: ChildRunContext, target: AnyWorkflowDescriptor) {
  const { node } = context;
  return planDelegationFanOut({ edgeId: node.edgeId, target: node.target, cardinality: node.cardinality, join: node.join,
    policy: node.policy, bound: node.bind(context.scope), deriveChildItemId: input => {
      const { canonicalItemId } = canonicalDelegationChild(context, target, input);
      return node.deriveChildItemId(input, Object.freeze({ canonicalItemId }));
    } });
}
