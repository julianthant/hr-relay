import { z } from "zod";
import { JsonValueSchema } from "../../../../rules/validation/canonical-json.js";
import { AssistantToolRefusal, type AssistantPlugin } from "../plugin.js";
import { AssistantWorkflowFactSchema, type AssistantWorkflowFacts } from "./facts.js";

export function workflowsPlugin(facts: () => AssistantWorkflowFacts): AssistantPlugin {
  const parameters = z.strictObject({ workflow: z.string().min(1).max(80) });
  return { domain: "workflows", tools: [{
    kind: "read", tier: "read", name: "describe_workflow",
    description: "Describe one served workflow, its input format, examples, steps and Dashboard step omissions. The start fact is for fresh input: a chat dry run or live read, a Dashboard upload or other Dashboard input, or unavailable. For chat reruns, check-run means eligibility must be checked for the selected run. Use the workflow id from the served workflow list.",
    parameters, output: AssistantWorkflowFactSchema,
    privacy: ["id", "label", "summary", "category", "input.placeholder", "input.entries", "input.fields[]", "input.examples[].label", "input.examples[].text",
      "input.examples[].note", "steps[].label", "steps[].description", "omittableSteps[]"].map(path => ({ path, origin: "repository-authored" as const })),
    async invoke(value) {
      const { workflow } = parameters.parse(value);
      const found = facts().facts.find(entry => entry.id === workflow);
      if (found === undefined) throw new AssistantToolRefusal("ASSISTANT_READ_UNAVAILABLE");
      return JsonValueSchema.parse(found);
    },
  }] };
}
