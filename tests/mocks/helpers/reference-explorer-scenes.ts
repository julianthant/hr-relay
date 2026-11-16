import {
FIXTURE_CATALOG_QUERY,
FIXTURE_EXPLORER_WORKFLOW_ID,
} from "./fixture-explorer.js";
import { FIXTURE_DAY } from "./fixture-identity.js";
import type { ReferenceScene,SceneAnchors } from "./reference-scenes.js";
export const SCENES: readonly ReferenceScene[] = [

  { id: "explorer-graph", route: { day: FIXTURE_DAY, explore: FIXTURE_EXPLORER_WORKFLOW_ID } },

  { id: "explorer-transaction", route: { day: FIXTURE_DAY, explore: "separations" } },

  {
    id: "catalog-search",
    route: { day: FIXTURE_DAY, settings: "ui-catalog", catalog: FIXTURE_CATALOG_QUERY },
  }];
export const ANCHORS: SceneAnchors = {
  "explorer-transaction": async (page) => {
    await page.getByRole("button", { name: "Inspect Finalize Kuali Document" }).click();
    await page.getByRole("button", { name: "Full contract" }).click();
    await page.getByRole("dialog", { name: "Finalize Kuali Document contract" }).getByText("Write safety").waitFor();
  },
};
