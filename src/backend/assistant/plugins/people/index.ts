import { z } from "zod";
import { CROSS_DATE_SEARCH_QUERY_LIMIT, CrossDateSearchStateFacetSchema } from "../../../../models/dashboard/search.js";
import { WorkflowIdSchema } from "../../../../rules/identity/ids.js";
import { JsonValueSchema } from "../../../../rules/validation/canonical-json.js";
import { AssistantToolRefusal, referenceSchema, type AssistantPlugin } from "../plugin.js";
import type { AssistantPluginDeps } from "../registry.js";
import { runReferences } from "../runs/index.js";

const MAX_PEOPLE = 20, MAX_RUNS = 5;

export function peoplePlugin(deps: AssistantPluginDeps, workflowLabel: (id: string) => string): AssistantPlugin {
  const parameters = z.strictObject({ query: z.string().trim().min(1).max(160) });
  const Output = z.strictObject({ people: z.array(z.strictObject({ person: referenceSchema("P"), runs: z.array(z.strictObject({
    run: referenceSchema("R"), workflow: WorkflowIdSchema, status: CrossDateSearchStateFacetSchema, day: z.iso.date() })).max(MAX_RUNS) })).max(MAX_PEOPLE), more: z.boolean() });
  return { domain: "people", tools: [{
    kind: "read", name: "find_people",
    description: "Find people by the name the operator typed, or by a person or EID reference. Returns one person reference per distinct person with their most recent runs. Copy references exactly; never write a name yourself.",
    parameters, output: Output, privacy: [],
    async invoke(value, context) {
      const query = context.references.expandArgument(parameters.parse(value).query, ["P", "E"]);
      if (query.length > CROSS_DATE_SEARCH_QUERY_LIMIT) throw new AssistantToolRefusal("ASSISTANT_LIMIT");
      const page = deps.search({ q: query, scope: "subject", facets: {}, limit: 50 });
      context.assertCurrent();
      const people = new Map<string, { person: string; runs: z.infer<typeof Output>["people"][number]["runs"] }>();
      for (const result of page.results) {
        const { run, person } = runReferences(result, context, workflowLabel);
        if (person === null) continue;
        const entry = people.get(person) ?? { person, runs: [] };
        if (entry.runs.length < MAX_RUNS) entry.runs.push({ run, workflow: result.workflowId, status: result.state, day: result.partitionDay });
        people.set(person, entry);
      }
      const all = [...people.values()];
      return JsonValueSchema.parse({ people: all.slice(0, MAX_PEOPLE), more: all.length > MAX_PEOPLE || page.totalMatches > page.results.length });
    },
  }] };
}
