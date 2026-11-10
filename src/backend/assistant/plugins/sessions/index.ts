import { z } from "zod";
import { ASSISTANT_START_ROWS_MAX } from "../../../../models/dashboard/assistant.js";
import { referenceSchema, type AssistantPlugin } from "../plugin.js";

export const AssistantSessionOutputSchema = z.strictObject({ runs: z.array(referenceSchema("R")).min(1).max(ASSISTANT_START_ROWS_MAX) });

export function sessionsPlugin(): AssistantPlugin {
  const parameters = z.strictObject({ workflow: z.string().min(1).max(80), entries: z.array(z.string().min(1).max(400)).min(1).max(ASSISTANT_START_ROWS_MAX) });
  return { domain: "sessions", tools: [{
    kind: "session", tier: "session", name: "start_session",
    description: "Start a read-only workflow (one with no saving step, see describe_workflow) for 1 to 20 entries now, without a card. Each entry is one line of that workflow's input format; use references exactly as given. Returns run references. A workflow that saves starts here only as a dry run when the operator chose Full access; otherwise it is refused and needs propose_workflow_start.",
    parameters, output: AssistantSessionOutputSchema, privacy: [],
    request(value, context) {
      const { workflow, entries } = parameters.parse(value);
      return { workflowId: workflow, entries: entries.map(entry => context.references.expandArgument(entry, ["E", "P"])) };
    },
  }] };
}
