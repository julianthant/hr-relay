import type { AssistantQueries } from "../../../../src/dashboard/client/index.js";
import type { AssistantRequest, AssistantResult } from "../../../../src/models/dashboard/assistant.js";

type ResultClient = Omit<AssistantQueries, "assistantRespond"> & { assistantRespond(input: AssistantRequest, signal?: AbortSignal): Promise<AssistantResult> };

/** A synthetic client whose replies are results of turns the server refused before acceptance: no receipt, nothing stored. */
export function resultClient<Client extends ResultClient>(client: Client): Omit<Client, "assistantRespond"> & Pick<AssistantQueries, "assistantRespond"> {
  return { ...client, assistantRespond: async (input, signal) => ({ kind: "result", result: await client.assistantRespond(input, signal) }) };
}
