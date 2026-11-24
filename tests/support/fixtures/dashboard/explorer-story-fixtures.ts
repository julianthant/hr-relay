/** Explorer fixtures for the state gallery: the served Onboarding workflow, whose review spec has every kind of block, and an in-page
 * server that answers the Explorer read. Browser-safe. */
import { createDashboardClient, type DashboardClient } from "../../../../src/dashboard/client/index.js";
import type { WorkflowCatalogEntry } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { WorkflowExplorerWireSchema } from "../../../../src/models/dashboard/explorer.js";
import wireJson from "./explorer-story-wire.json" with { type: "json" };

/** The `onboarding` workflow as the backend serves it; a test keeps the copy equal. A served review spec must match its workflow's timeline, so the stories do not edit it. */
const WIRE = WorkflowExplorerWireSchema.parse(wireJson);
export const EXPLORER_STORY_WORKFLOW_ID = "onboarding";

export const EXPLORER_STORY_CATALOG: readonly WorkflowCatalogEntry[] = Object.freeze([
  { id: EXPLORER_STORY_WORKFLOW_ID, label: "Onboarding", categoryId: "Onboarding", role: { kind: "composition" }, icon: "UserPlus",
    source: "served", launch: { state: "served" } },
]);

/** How the page's read of the Explorer comes back; `empty` answers with no workflow in it. */
export type ExplorerRead = "answer" | "never" | "fail" | "empty";

export interface ExplorerStoryServerOptions {
  readonly read?: ExplorerRead;
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function explorerStoryClient(options: ExplorerStoryServerOptions = {}): DashboardClient {
  const { read = "answer" } = options;
  const fetchImpl = (url: string): Promise<Response> => {
    if (new URL(url).pathname !== "/api/v1/explorer") return Promise.resolve(json({ code: "NOT_SERVED" }, 404));
    if (read === "never") return new Promise<Response>(() => undefined);
    if (read === "fail") return Promise.resolve(json({ code: "EXPLORER_READ_UNAVAILABLE" }, 500));
    if (read === "empty") return Promise.resolve(json({ ...WIRE, workflows: [] }));
    return Promise.resolve(json(WIRE));
  };
  return createDashboardClient({ baseUrl: "http://relay.story.test", fetchImpl });
}
