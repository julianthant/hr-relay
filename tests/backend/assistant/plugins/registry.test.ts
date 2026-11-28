import assert from "node:assert/strict";
import { it } from "vitest";
import { ASSISTANT_TOOL_NAMESPACE, assistantToolRegistry, createAssistantPlugins } from "../../../../src/backend/assistant/plugins/registry.js";
import { createAssistantTypedProposals } from "../../../../src/backend/assistant/typed-proposals.js";
import { sessionsPlugin } from "../../../../src/backend/assistant/plugins/sessions/index.js";
import { surfaceLeaves } from "../../../architecture/logs/helpers/redaction-surface-audit.js";

const unused = () => { throw new Error("registry test reads declarations only"); };
const plugins = (edits = false) => createAssistantPlugins({ findLookupRuns: unused, runReferenceLabel: unused, search: unused, runDetail: unused, notifications: unused, workbooks: unused, attachment: unused, settings: unused, facts: unused,
  ...(edits ? { settingsRecord: unused, edits: { apply: unused, notification: unused, workbooks: unused },
    appliedEdits: { clock: { now: unused }, list: unused } } : {}) });

it("offers every plugin's tools in one strict namespace with unique names", () => {
  const registry = assistantToolRegistry(plugins());
  assert.equal(registry.namespace.name, ASSISTANT_TOOL_NAMESPACE);
  assert.deepEqual(registry.tools.map(tool => tool.name), ["describe_workflow", "find_runs", "read_run", "read_run_logs", "find_people", "list_notifications", "read_spreadsheets", "inspect_attachment", "read_settings"]);
  assert.deepEqual(registry.namespace.tools.map(tool => tool.name), registry.tools.map(tool => tool.name));
  for (const tool of registry.tools) assert.ok(tool.description.length > 40, tool.name);
  const [first] = plugins(); assert.ok(first);
  assert.throws(() => assistantToolRegistry([first, first]), /assistant-tool-registry-invalid/u);
});

it("fits the full served tool set (18 tools) exactly at the cap", () => {
  // Construction reads no owner; the declarations alone are registered.
  const proposals = createAssistantTypedProposals({} as Parameters<typeof createAssistantTypedProposals>[0]);
  const registry = assistantToolRegistry([...plugins(true), proposals.plugin, sessionsPlugin()]);
  assert.equal(registry.tools.length, 18);
  assert.deepEqual(registry.tools.filter(tool => ["list_today_edits", "undo_edit"].includes(tool.name)).map(tool => tool.name), ["list_today_edits", "undo_edit"]);
  assert.deepEqual(registry.namespace.tools.find(tool => tool.name === "list_today_edits")?.parameters.required, []);
  // Strict function schemas refuse `oneOf` (discriminated unions); unions must emit `anyOf`.
  for (const tool of registry.namespace.tools) assert.doesNotMatch(JSON.stringify(tool.parameters), /"oneOf"/u, tool.name);
  assert.deepEqual(proposals.plugin.tools.map(tool => tool.name), ["propose_workflow_start", "propose_rerun", "propose_run_action"]);
  const [first] = plugins(true); assert.ok(first);
  assert.throws(() => assistantToolRegistry([...plugins(true), proposals.plugin, sessionsPlugin(), { domain: "extra", tools: [{ ...first.tools[0], name: "extra_read" }] }]),
    /assistant-tool-registry-invalid/u, "a nineteenth tool refuses");
});

it("declares a privacy origin for exactly the free-text leaves of every tool output", () => {
  for (const tool of assistantToolRegistry(plugins(true)).tools) {
    if (tool.kind === "proposal") continue;
    const free = surfaceLeaves(tool.output).filter(leaf => leaf.kind === "free-text" || leaf.kind === "open-json").map(leaf => leaf.path).sort();
    assert.deepEqual(tool.privacy.map(entry => entry.path).sort(), free, tool.name);
    assert.ok(tool.privacy.every(entry => entry.origin === "repository-authored" || entry.origin === "declared-redacted"), tool.name);
  }
});
