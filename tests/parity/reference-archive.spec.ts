import { expect,test } from "@playwright/test";
import { SavedVersionIndexWireSchema } from "../../src/domain/dashboard/archive.js";
import { gotoAppState } from "./helpers/app-driver.js";
import {
PARITY_THEMES,
assertThemeApplied,
captureParityPair,
installTheme,
type ParityTheme
} from "./helpers/capture.js";
import {
FIXTURE_SAVED_VERSIONS
} from "./helpers/fixture-archive.js";
import { FIXTURE_APP_VERSION,FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
import { ANCHORS,SCENES } from "./helpers/reference-archive-scenes.js";
import { REFERENCES,dismissWorkflowWindow,failOnPageErrors,registerReferenceServers } from "./helpers/reference-harness.js";
import { registerReferenceScenes } from "./helpers/reference-scenes.js";
const servers = registerReferenceServers(["server"]);
registerReferenceScenes(SCENES, () => servers.server, ANCHORS);


/**
 * THE VERSION-BUMP AUTHORING DIALOG (D179, charter §25).
 *
 * `archive-ledger` photographs the RUNS view. The Archive's other half — the
 * version registry, and the change record the operator authors before a bump —
 * had never been photographed at all, and it is the surface where a wrong word
 * is most expensive: a MAJOR bump is what moves finished runs into the archive,
 * the record is the only place anyone says WHY, and the dialog's kind radio
 * decides which of those two things happens. Copy that nobody photographs is
 * copy reviewed once, by whoever wrote it.
 *
 * Both themes at one viewport: the dialog is a fixed-width box, and the tinted
 * effect line beneath the kind radio is a colour claim in both palettes.
 */
test.describe("version bump", () => {
  for (const theme of PARITY_THEMES) {
    test(`archive-version-bump @ ${theme.name}`, async ({ page }) => {
      const errors = failOnPageErrors(page);
      const blocker="00000000-0000-4000-8000-000000000099";
      const blocked=SavedVersionIndexWireSchema.parse({...FIXTURE_SAVED_VERSIONS,changes:[{
        changeId:"00000000-0000-4000-8000-000000000098",state:"planned",targetVersion:"0.2.0",
        change:{kind:"major",what:"Synthetic blocked version change",why:"A current run must finish before this reviewed archive transfer",commit:{state:"absent",reason:"Synthetic review"}},
        reviewFingerprint:"a".repeat(64),scope:{kind:"workflows",workflowIds:["person-lookup"]},memberRunIds:[],blockerRunIds:[blocker],completedRunIds:[],
      }]});
      await page.route("**/api/v1/archive/versions",route=>route.fulfill({json:blocked}));
      await page.setViewportSize({ width: 1440, height: 900 });
      await installTheme(page, theme satisfies ParityTheme);
      await gotoAppState(page, servers.server.baseUrl, {
        day: FIXTURE_DAY,
        archive: "",
        archiveView: "versions",
      });
      await dismissWorkflowWindow(page);
      await assertThemeApplied(page, theme satisfies ParityTheme);

      await expect(page.getByRole("region",{name:"Versions and saved changes"})).toBeVisible();
      await expect(page.getByRole("heading",{name:"Review a version change"})).toBeVisible();
      await expect(page.getByRole("combobox",{name:"Change kind"})).toHaveValue("major");
      await expect(page.getByRole("textbox",{name:"What changed"})).toHaveAttribute("maxlength","200");
      await expect(page.getByRole("textbox",{name:"Why",exact:true})).toHaveAttribute("maxlength","1000");
      await expect(page.getByRole("button",{name:"Apply reviewed change"})).toBeDisabled();
      const plannedChange = page.getByRole("region", { name: /^Version change /u });
      await expect(plannedChange.locator("dt", { hasText: "Blockers" })).toBeVisible();
      await expect(plannedChange).toContainText(blocker);
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
