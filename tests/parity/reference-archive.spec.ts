import { expect,test } from "@playwright/test";
import { SavedRuntimeVersionIndexWireSchema } from "../../src/domain/dashboard/archive.js";
import { gotoAppState } from "./helpers/app-driver.js";
import {
PARITY_THEMES,
assertThemeApplied,
captureParityPair,
installTheme,
type ParityTheme
} from "./helpers/capture.js";
import { FIXTURE_APP_VERSION,FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
import { ANCHORS,SCENES } from "./helpers/reference-archive-scenes.js";
import { REFERENCES,failOnPageErrors,registerReferenceServers } from "./helpers/reference-harness.js";
import { registerReferenceScenes } from "./helpers/reference-scenes.js";
const servers = registerReferenceServers(["server"]);
registerReferenceScenes(SCENES, () => servers.server, ANCHORS);


/** Both version choices and an active run blocker remain visible before apply. */
test.describe("version bump", () => {
  for (const theme of PARITY_THEMES) {
    test(`archive-version-bump @ ${theme.name}`, async ({ page }) => {
      const errors = failOnPageErrors(page);
      const blocker="00000000-0000-4000-8000-000000000099";
      const before={dashboard:{major:1,minor:2},workflows:[
        {workflowId:"person-lookup",version:{major:1,minor:1}},
        {workflowId:"separations-kuali-read",version:{major:1,minor:2}},
      ]};
      const blocked=SavedRuntimeVersionIndexWireSchema.parse({revision:2,dashboard:before.dashboard,
        workflows:[{...before.workflows[0],label:"Person lookup"},{...before.workflows[1],label:"Separation documents"}],
        changes:[{changeId:"00000000-0000-4000-8000-000000000098",actorId:"synthetic-operator",
          reviewedAt:"2026-08-03T12:00:00.000Z",reviewFingerprint:"a".repeat(64),
          scope:{kind:"workflows",workflowIds:["person-lookup"]},before,
          after:{...before,workflows:[{workflowId:"person-lookup",version:{major:1,minor:2}},before.workflows[1]]},
          state:"planned",members:[{runId:blocker,workflowId:"person-lookup",recordVersion:1,attribution:"stamped",state:"running"}],completedRunIds:[]}]});
      await page.route("**/api/v1/archive/runtime-versions",route=>route.fulfill({json:blocked}));
      await page.setViewportSize({ width: 1440, height: 900 });
      await installTheme(page, theme satisfies ParityTheme);
      await gotoAppState(page, servers.server.baseUrl, {
        day: FIXTURE_DAY,
        archive: "",
        archiveView: "versions",
      });
      await assertThemeApplied(page, theme satisfies ParityTheme);

      const bump=page.getByRole("region",{name:"Plan a version bump"});
      await expect(bump).toBeVisible();
      await expect(bump.getByRole("radio",{name:"Selected workflow"})).toBeChecked();
      await expect(bump.getByRole("radio",{name:"All workflows"})).toBeVisible();
      await expect(page.getByRole("button",{name:"Apply reviewed change"})).toBeDisabled();
      await expect(bump).toContainText(`person-lookup · ${blocker} · Blocked · running`);
      expect(errors,"page errors while opening the served version review").toEqual([]);

      await captureParityPair(page, REFERENCES, {
        stateId: "archive-version-bump",
        viewport: "1440x900",
        theme: theme.name,
        adapter: "fixture",
        fixtureId: "archive-version-bump",
        descriptorHash: FIXTURE_DESCRIPTOR_HASH,
        appVersion: FIXTURE_APP_VERSION,
        capturedAt: FIXTURE_DAY,
        variant: "default",
      });
    });
  }
});
