import { Hono } from "hono";
import type { DashboardApp } from "../../../src/backend/transports/http/routes/api-types.js";
import { registerWorkbookRoutes } from "../../../src/backend/transports/http/routes/workbooks.js";
import { createWorkbookLibraryService } from "../../../src/backend/workbooks/workbook-library-service.js";
import { WorkbookLibraryError } from "../../../src/backend/workbooks/workbook-library-error.js";
import { openAuthorityHarness } from "../../support/helpers/phase1f-executor-harness.js";
import { startSweepOverlay } from "./sweep-fixtures-server.js";
import type { FixtureDashboardProfile } from "../../support/helpers/dashboard/fixture-bff.js";
import { WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";

export async function startWorkbookSweepServer(profile?: FixtureDashboardProfile, options: { empty?: boolean } = {}) {
  const h = await openAuthorityHarness();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let downloads = 0;
  const library = createWorkbookLibraryService({ repository: h.database.authority.workbooks, clock: h.clock,
    sync: { async withDownload() { downloads++; await held; throw new WorkbookLibraryError("WORKBOOK_SYNC_IMPORT_FAILED"); } } });
  try {
    const seeded = options.empty ? undefined : (() => {
      const general = library.create({ name: "General workbook.xlsx", themes: [], hasFormulas: false,
        sheets: [{ id: "general", name: "General", width: 3, hidden: [], headerRow: 1,
          columnBindings: ["Project", "Status", "Notes"].map((sourceHeader, sourceColumn) => ({ id: `column-${sourceColumn}`, sourceColumn, sourceHeader, fieldId: null, basis: "manual" })), rows: [
          { id: "header", cells: [{ value: "Project" }, { value: "Status" }, { value: "Notes" }] },
          { id: "sample", cells: [{ value: "Fixture project" }, { value: "Ready" }, { value: "Synthetic row" }] },
        ] }] });
      const solid = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
      const filled = library.create({ name: "Status board.xlsx", themes: [], hasFormulas: false,
        sheets: [{ id: "board", name: "Board", width: 3, hidden: [], headerRow: 1,
          columnBindings: ["Project", "Status", "Owner"].map((sourceHeader, sourceColumn) => ({ id: `column-${sourceColumn}`, sourceColumn, sourceHeader, fieldId: null, basis: "manual" })), rows: [
          { id: "header", cells: ["Project", "Status", "Owner"].map(value => ({ value, fill: solid("FFD9E1F2"), background: "#D9E1F2" })) },
          { id: "done", cells: [{ value: "Fixture intake" }, { value: "Done", fill: solid("FFC6EFCE"), background: "#C6EFCE" }, { value: "Example, Avery" }] },
          { id: "waiting", cells: [{ value: "Fixture review" }, { value: "Waiting", fill: solid("FFFFEB9C"), background: "#FFEB9C" }, { value: "Example, Blake" }] },
          { id: "failed", cells: [{ value: "Fixture sync" }, { value: "Failed", fill: solid("FFFFC7CE"), background: "#FFC7CE" }, { value: "Example, Casey" }] },
        ] }] });
      const roster = library.create({ name: "Fixture roster.xlsx", themes: [], hasFormulas: false,
        sheets: [{ id: "people", name: "People", width: 2, hidden: [], headerRow: 1,
          columnBindings: ["eid", "fullName"].map((fieldId, index) => ({ id: fieldId, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: "manual" })),
          rows: [{ id: "header", cells: [{ value: "Employee ID" }, { value: "Name" }] },
            { id: "sample", cells: [{ value: "10800000" }, { value: "Example, Avery" }] }] }] });
      library.putType({ id: "fixture-roster", name: "Fixture roster", keyFieldId: "eid", fields: ["eid", "fullName"], defaultWorkbookId: null });
      library.operatorOperation(roster.libraryId, "fixture-link", { kind: "metadata", expectedVersion: 1,
        metadata: { typeId: "fixture-roster", sharePoint: { url: "https://tenant.sharepoint.com/sites/fixtures/Roster.xlsx", verifiedAt: h.clock.now().toISOString() } } });
      return { general, filled, roster };
    })();
    const app: DashboardApp = new Hono();
    registerWorkbookRoutes(app, { workbooks: { library, workflows: WORKFLOW_MODULES.map(module => module.descriptor), intake: async () => { throw new Error("sweep fixture does not admit workbook intake"); } } });
    const server = await startSweepOverlay(app, profile);
    return { ...server, generalId: seeded?.general.libraryId ?? "", filledId: seeded?.filled.libraryId ?? "", rosterId: seeded?.roster.libraryId ?? "", downloads: () => downloads, release,
      async close() { release(); try { await server.close(); } finally { await h.dispose(); } } };
  } catch (error) { release(); await h.dispose(); throw error; }
}
