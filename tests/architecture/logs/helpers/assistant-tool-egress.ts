import { createAssistantPlugins } from "../../../../src/backend/assistant/plugins/registry.js";
import { sessionsPlugin } from "../../../../src/backend/assistant/plugins/sessions/index.js";

/** Each plugin's module, so its tool output surfaces sit inside the audited module set. */
export const ASSISTANT_PLUGIN_MODULES: readonly string[] = Object.freeze(["notifications", "people", "runs", "sessions", "settings", "spreadsheets", "workflows"]
  .map(domain => `src/backend/assistant/plugins/${domain}/index.ts`));

const unused = () => { throw new Error("assistant tool egress audit reads schemas only"); };

/** Every assistant tool output as a process-egress surface, with the tool's own privacy declaration as its leaf origins. */
export function assistantToolEgress() {
  const plugins = [...createAssistantPlugins({ findLookupRuns: unused, runReferenceLabel: unused, search: unused, runDetail: unused, notifications: unused, workbooks: unused, attachment: unused, settings: unused, facts: unused }), sessionsPlugin()];
  const tools = plugins.flatMap(plugin => plugin.tools.flatMap(tool => tool.kind !== "proposal" ? [{ tool, module: `src/backend/assistant/plugins/${plugin.domain}/index.ts` }] : []));
  return {
    surfaces: tools.map(({ tool, module }) => ({ id: `egress/assistant-tool/${tool.name}`, egress: "process-egress" as const, module, schema: tool.output })),
    origins: tools.flatMap(({ tool }) => tool.privacy.map(({ path, origin }) => ({ surface: `egress/assistant-tool/${tool.name}`, path, origin }))),
  };
}
