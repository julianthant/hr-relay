import { z } from "zod";
import type { CrossDateSearchPage, CrossDateSearchQueryInput, CrossDateSearchResult } from "../../../models/dashboard/search.js";
import type { RunDetailWire } from "../../../models/dashboard/run-detail.js";
import type { NotificationWire } from "../../../models/dashboard/projection.js";
import type { WorkbookLibraryService } from "../../workbooks/workbook-library-service.js";
import { AssistantFunctionNamespaceSchema, type AssistantAttachmentRecord, type AssistantFunctionNamespace, type AssistantToolTier } from "../../../models/dashboard/assistant.js";
import type { AssistantPlugin, AssistantTool } from "./plugin.js";
import type { AssistantWorkflowFacts } from "./workflows/facts.js";
import { workflowsPlugin } from "./workflows/index.js";
import { runsPlugin } from "./runs/index.js";
import { peoplePlugin } from "./people/index.js";
import { notificationsPlugin } from "./notifications/index.js";
import { spreadsheetsPlugin } from "./spreadsheets/index.js";
import { settingsPlugin } from "./settings/index.js";

/** Existing read owners; every getter is read at call time so later composition stays current. */
export interface AssistantPluginDeps {
  search(query: CrossDateSearchQueryInput): CrossDateSearchPage;
  runDetail(runId: string): RunDetailWire;
  runReferenceLabel(runId: string, expectedVersion: number): string;
  findLookupRuns(eid: string): readonly Readonly<{ runId: string; version: number; day: string; status: CrossDateSearchResult["state"]; label: string }>[];
  notifications(actorId: string): readonly NotificationWire[];
  /** The Spreadsheets library owner; every read and change goes through it. */
  workbooks(): Pick<WorkbookLibraryService, "catalog" | "read" | "types">;
  /** An accepted attachment of the chat, with authenticated bytes. */
  attachment(conversationId: string, id: string): (AssistantAttachmentRecord & Readonly<{ bytes: Uint8Array }>) | undefined;
  settings(): unknown;
  facts(): AssistantWorkflowFacts;
}

export const ASSISTANT_TOOL_NAMESPACE = "relay";
const MAX_TOOLS = 16;
const KIND_TIERS: Readonly<Record<AssistantTool["kind"], readonly AssistantToolTier[]>> = {
  read: ["read"], session: ["session"], change: ["write-local"], proposal: ["write-local", "leaves-machine"], "typed-proposal": ["write-local", "leaves-machine"] };

export function createAssistantPlugins(deps: AssistantPluginDeps): readonly AssistantPlugin[] {
  const workflowLabel = (id: string) => deps.facts().facts.find(entry => entry.id === id)?.label ?? id;
  return [workflowsPlugin(() => deps.facts()), runsPlugin(deps, workflowLabel), peoplePlugin(deps, workflowLabel),
    notificationsPlugin(deps), spreadsheetsPlugin(deps), settingsPlugin(deps)];
}

export function assistantToolRegistry(plugins: readonly AssistantPlugin[]): Readonly<{ tools: readonly AssistantTool[]; namespace: AssistantFunctionNamespace }> {
  const tools = plugins.flatMap(plugin => plugin.tools);
  if (tools.length > MAX_TOOLS || new Set(tools.map(tool => tool.name)).size !== tools.length
    || tools.some(tool => !KIND_TIERS[tool.kind].includes(tool.tier))) throw new Error("assistant-tool-registry-invalid");
  const namespace = AssistantFunctionNamespaceSchema.parse({ type: "namespace", name: ASSISTANT_TOOL_NAMESPACE,
    description: "Relay's local reads and proposals. Reads return opaque [[…]] references instead of names and IDs; proposals only prepare a card the operator confirms.",
    tools: tools.map(tool => ({ type: "function", name: tool.name, description: tool.description, strict: true, parameters: z.toJSONSchema(tool.parameters) })) });
  return Object.freeze({ tools, namespace });
}
