import assert from "node:assert/strict";
import { it } from "vitest";
import { ASSISTANT_TOOL_NAMESPACE, assistantToolRegistry, createAssistantPlugins } from "../../../../src/backend/assistant/plugins/registry.js";
import { surfaceLeaves } from "../../../architecture/logs/helpers/redaction-surface-audit.js";

const unused = () => { throw new Error("registry test reads declarations only"); };
const plugins = () => createAssistantPlugins({ search: unused, runDetail: unused, notifications: unused, workbookCatalog: unused, settings: unused, facts: unused });

it("offers every plugin's tools in one strict namespace with unique names", () => {
  const registry = assistantToolRegistry(plugins());
  assert.equal(registry.namespace.name, ASSISTANT_TOOL_NAMESPACE);
  assert.deepEqual(registry.tools.map(tool => tool.name), ["describe_workflow", "find_runs", "read_run", "read_run_logs", "find_people", "list_notifications", "list_spreadsheets", "read_settings"]);
  assert.deepEqual(registry.namespace.tools.map(tool => tool.name), registry.tools.map(tool => tool.name));
  for (const tool of registry.tools) assert.ok(tool.description.length > 40, tool.name);
  const [first] = plugins(); assert.ok(first);
  assert.throws(() => assistantToolRegistry([first, first]), /assistant-tool-registry-invalid/u);
});

it("declares a privacy origin for exactly the free-text leaves of every tool output", () => {
  for (const tool of assistantToolRegistry(plugins()).tools) {
    assert.equal(tool.kind, "read"); if (tool.kind !== "read") continue;
    const free = surfaceLeaves(tool.output).filter(leaf => leaf.kind === "free-text" || leaf.kind === "open-json").map(leaf => leaf.path).sort();
    assert.deepEqual(tool.privacy.map(entry => entry.path).sort(), free, tool.name);
    assert.ok(tool.privacy.every(entry => entry.origin === "repository-authored" || entry.origin === "declared-redacted"), tool.name);
  }
});
