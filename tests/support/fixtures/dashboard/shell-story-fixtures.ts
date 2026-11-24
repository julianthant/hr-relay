/** Shell fixtures for the state gallery: the workflow rail's catalogue and counts, what search holds, and a client that never answers. Browser-safe. */
import { createDashboardClient, type DashboardClient } from "../../../../src/dashboard/client/index.js";
import type { WorkflowCatalogEntry } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import type { WorkflowCountWire } from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import type { NavbarData } from "../../../../src/dashboard/surfaces/shell/search/navbar-view-model.js";
import type { PaletteSheet, PaletteWorkflow } from "../../../../src/dashboard/surfaces/shell/search/search-palette-model.js";
import { WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { buildWorkspaceSearchData } from "./search-sample.js";
import { QUEUE_STORY_DAY, queueStoryRow } from "./queue-row-story-surfaces.js";

const entry = (id: string, label: string, categoryId: string, icon: WorkflowCatalogEntry["icon"]): WorkflowCatalogEntry =>
  ({ id, label, categoryId, role: { kind: "standalone" }, icon, source: "served", launch: { state: "served" } });

export const SHELL_STORY_WORKFLOWS: readonly WorkflowCatalogEntry[] = Object.freeze([
  entry("person-lookup", "Person Lookup", "Lookup", "Search"),
  entry("separations", "Separations", "Separations", "UserMinus"),
  entry("onboarding", "Onboarding", "Onboarding", "UserPlus"),
  entry("work-study", "Work-Study", "Work-Study", "ClipboardCheck"),
]);

const counts = (workflowId: string, running: number): WorkflowCountWire =>
  ({ workflowId: WorkflowIdSchema.parse(workflowId), count: running + 1, statusCounts: running > 0 ? [{ status: "running", count: running }, { status: "done", count: 1 }] : [{ status: "done", count: 1 }] });

/** No run is going, and three workflows have runs going. */
export const SHELL_STORY_COUNTS_IDLE: readonly WorkflowCountWire[] = Object.freeze(SHELL_STORY_WORKFLOWS.map(({ id }) => counts(id, 0)));
export const SHELL_STORY_COUNTS_RUNNING: readonly WorkflowCountWire[] = Object.freeze(SHELL_STORY_WORKFLOWS.map(({ id }, index) => counts(id, [3, 0, 12, 1][index] ?? 0)));

export const SEARCH_STORY_WORKFLOWS: readonly PaletteWorkflow[] = Object.freeze(SHELL_STORY_WORKFLOWS.map(({ id, label, icon }) => ({ id, label, icon })));
const SHEETS: readonly PaletteSheet[] = Object.freeze([{ id: "sheet-1", name: "Spring roster", detail: "Updated today" }, { id: "sheet-2", name: "Separations tracker", detail: "Updated yesterday" }]);

const ROWS = [queueStoryRow("running", 2), queueStoryRow("failed", 7), queueStoryRow("done", 6)];
const SEARCH_TODAY = QUEUE_STORY_DAY;
const served = buildWorkspaceSearchData({ today: SEARCH_TODAY, day: QUEUE_STORY_DAY, rows: ROWS, workflowLabel: () => "Person Lookup" });

export const SEARCH_STORY_DATA = Object.freeze({
  results: Object.freeze<NavbarData>({ ...served, sheets: SHEETS }),
  loading: Object.freeze<NavbarData>({ today: SEARCH_TODAY, counts: {}, results: [], loading: true }),
  unavailable: Object.freeze<NavbarData>({ today: SEARCH_TODAY, counts: {}, results: [], unavailable: "Search is unavailable. Try again shortly." }),
  "sheets-unavailable": Object.freeze<NavbarData>({ ...served, sheetsUnavailable: "Spreadsheets are unavailable." }),
});

/** A client whose reads and writes never answer: a story shows the state and nothing moves on. */
export function inertDashboardClient(): DashboardClient {
  return createDashboardClient({ baseUrl: "http://relay.story.test", fetchImpl: () => new Promise<Response>(() => undefined) });
}
