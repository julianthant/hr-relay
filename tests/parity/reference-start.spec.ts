import { expect,test } from "@playwright/test";
import { gotoAppState } from "./helpers/app-driver.js";
import {
PARITY_THEMES,
PARITY_VIEWPORTS,
assertThemeApplied,
captureParityPair,
installTheme,
type ParityTheme,
} from "./helpers/capture.js";
import { FIXTURE_APP_VERSION,FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
import { FIXTURE_START_PICKER_DESCRIPTOR_HASH } from "./helpers/fixture-start.js";
import { assertShellGeometry } from "./helpers/geometry.js";
import { REFERENCES,failOnPageErrors,registerReferenceServers } from "./helpers/reference-harness.js";
import { registerReferenceScenes } from "./helpers/reference-scenes.js";
import { ANCHORS,SCENES } from "./helpers/reference-start-scenes.js";
const servers = registerReferenceServers(["server","startPickerServer","separationsStartServer"]);
registerReferenceScenes(SCENES, () => servers.server, ANCHORS);


/**
 * DCF6: Start Run is a three-stage interaction, not only the initial picker.
 * These references deliberately use the real Separations typed-input surface
 * and its locked shape. The fixture plan row is generic layout evidence (see
 * `FIXTURE_SEPARATIONS_START_PLAN`), never a claim about the composition's
 * planner semantics. The final press proves the Close exit returns focus to
 * the still-visible typed document; conflict remains unit-only because this
 * fixture does not have a truthful stale-envelope command path.
 */
const SEPARATIONS_START_VIEWPORTS = PARITY_VIEWPORTS.filter(
  (viewport) => viewport.name === "1440x900" || viewport.name === "narrow-1024x768",
);


/** D296 — the arm is one dialog region; the desktop pair is the whole of it. */
const SPREADSHEET_HANDOFF_VIEWPORTS = PARITY_VIEWPORTS.filter(
  (viewport) => viewport.name === "1440x900",
);


/**
 * The ordinary Start Run fixture stays intentionally small: it proves the
 * Person Lookup input/plan flow. This profile proves the OTHER thing the
 * picker owns — the served registry's composition and its unavailable harness
 * steps — with the real seven modules, including the timekeeping-category
 * Kronos harness. Separations has its typed-input door, while the harnesses
 * honestly disclose below it: none has enough independent input for this
 * dialog to invent a box. Their parent is therefore absent from that filtered
 * list and every row keeps the explicit raw composition id rather than
 * fabricating a label the filtered list does not supply (the grouping rule's
 * orphan arm).
 */
test.describe("start-run picker hierarchy", () => {
  for (const viewport of PARITY_VIEWPORTS) {
    for (const theme of PARITY_THEMES) {
      test(`${theme.name} @ ${viewport.name}`, async ({ page }) => {
        const errors = failOnPageErrors(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await installTheme(page, theme satisfies ParityTheme);
        await gotoAppState(page, servers.startPickerServer.baseUrl, { day: FIXTURE_DAY, start: true });
        await assertThemeApplied(page, theme satisfies ParityTheme);
        await page.waitForTimeout(120);

        const picker = page.getByRole("navigation", { name: "Workflow" });
        await expect(picker.getByRole("button", { name: "Separations sp" })).toBeVisible();
        const unavailable = page.getByRole("button", { name: "5 not startable" });
        await expect(unavailable).toHaveAttribute("aria-expanded", "false");
        await unavailable.click();
        await expect(unavailable).toHaveAttribute("aria-expanded", "true");

        for (const label of [
          "Separation Timecard",
          "Separation Document",
          "Identity Check",
          "UCPath Termination",
          "Kuali Finalization",
        ]) {
          await expect(page.getByText(label, { exact: true })).toBeVisible();
        }
        await expect(
          page.getByTitle("A proving harness of separations — a step of that workflow, not a workflow of its own"),
        ).toHaveCount(5);
        // The parent is startable while its harnesses are not, so the blocked
        // list is an honest orphan view. Kronos retains its own HR category
        // instead of pretending a missing blocked-list parent exists.
        await expect(page.getByText("Timekeeping", { exact: true })).toBeVisible();
        // The blocked disclosure has a deliberate fixed height. Keep the
        // semantic reference over every harness above, then photograph its
        // lower edge too: this puts the cross-category Kronos step in pixels,
        // rather than leaving the most important row only in the a11y tree.
        await page.getByText("Separation Timecard", { exact: true }).scrollIntoViewIfNeeded();

        await assertShellGeometry(page, `start-run-separations @ ${viewport.name} ${theme.name}`);
        expect(errors, "page errors while rendering the separations picker").toEqual([]);

        await captureParityPair(page, REFERENCES, {
          stateId: "start-run-separations",
          viewport: viewport.name,
          theme: theme.name,
          adapter: "fixture",
          fixtureId: "start-run-separations",
          descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
          appVersion: FIXTURE_APP_VERSION,
          capturedAt: FIXTURE_DAY,
          variant: "default",
        });
      });
    }
  }
});


/**
 * D296/D298: the Run Modal's SECOND door, photographed — and since D298 it is
 * the intake's dropzone rather than a paragraph about one.
 *
 * `Import spreadsheet` left the queue toolbar in D296's commit and the
 * workspace's own upload page left in D298's, so this tab is the intake's ONLY
 * entry — a surface with no reference is a surface nobody can tell has broken,
 * and this reference now carries the zone the retired `intake-upload` state
 * used to hold. Person Lookup is the one registered module declaring an intake
 * projection, which is exactly why the base fixture serves the tabs and the
 * separations picker above does not: that pair, not a fixture flag, is the
 * negative control.
 */
test.describe("start-run spreadsheet handoff", () => {
  for (const viewport of SPREADSHEET_HANDOFF_VIEWPORTS) {
    for (const theme of PARITY_THEMES) {
      test(`${theme.name} @ ${viewport.name}`, async ({ page }) => {
        const errors = failOnPageErrors(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await installTheme(page, theme satisfies ParityTheme);
        await gotoAppState(page, servers.server.baseUrl, { day: FIXTURE_DAY, start: true });
        await assertThemeApplied(page, theme satisfies ParityTheme);

        const tabs = page.getByRole("tablist", { name: "How to start this run" });
        await expect(tabs.getByRole("tab", { name: "Type values" })).toHaveAttribute("aria-selected", "true");
        await tabs.getByRole("tab", { name: "Import a spreadsheet" }).click();
        await expect(tabs.getByRole("tab", { name: "Import a spreadsheet" }))
          .toHaveAttribute("aria-selected", "true");

        // The rail collapses to the one stage this arm reaches, and the stage
        // IS the zone. All of it is asserted before the pixels: a `Next` under
        // a one-stage rail, or a lingering `Open the intake…` primary, is the
        // defect this arm exists to avoid and it photographs indistinguishably
        // from a correct frame.
        await expect(page.getByRole("list", { name: "Run configuration path" })
          .getByRole("listitem")).toHaveCount(1);
        await expect(page.getByRole("button", { name: "Next" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Open the intake…" })).toHaveCount(0);
        await expect(page.getByRole("textbox", { name: /employee IDs/u })).toHaveCount(0);
        // D298 — a real `<input type="file">`, which is what makes the zone
        // reachable by keyboard, screen reader and touch alike.
        await expect(page.locator('.fixed input[type="file"]')).toHaveCount(1);
        await expect(page.getByText(/Drop a spreadsheet of people for/u)).toBeVisible();

        await assertShellGeometry(page, `start-run-spreadsheet @ ${viewport.name} ${theme.name}`);
        expect(errors, "page errors while rendering the spreadsheet handoff").toEqual([]);

        await captureParityPair(page, REFERENCES, {
          stateId: "start-run-spreadsheet",
          viewport: viewport.name,
          theme: theme.name,
          adapter: "fixture",
          fixtureId: "start-run-spreadsheet",
          descriptorHash: FIXTURE_DESCRIPTOR_HASH,
          appVersion: FIXTURE_APP_VERSION,
          capturedAt: FIXTURE_DAY,
          variant: "default",
        });

        // The DROP is the whole point of the door (D298): it uploads, and the
        // dialog closes on the workspace for the workflow the picker had
        // selected, with the file already read.
        await page.locator('.fixed input[type="file"]').setInputFiles({
          name: "roster.csv",
          mimeType: "text/csv",
          buffer: Buffer.from("Employee ID,Legal Name\n10873698,Ada Lovelace\n", "utf8"),
        });
        await expect(page.getByRole("region", { name: "Spreadsheet intake" })).toBeVisible();
        // Landed ON the session the upload opened, not on an empty workspace:
        // the source band names the file the fixture served back.
        await expect(page.getByRole("region", { name: "Source file" })).toBeVisible();
        expect(errors, "page errors while opening the intake workspace").toEqual([]);
      });
    }
  }
});



test.describe("separations start-run continuity", () => {
  for (const viewport of SEPARATIONS_START_VIEWPORTS) {
    for (const theme of PARITY_THEMES) {
      test(`${theme.name} @ ${viewport.name}`, async ({ page }) => {
        const errors = failOnPageErrors(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await installTheme(page, theme satisfies ParityTheme);
        await gotoAppState(page, servers.separationsStartServer.baseUrl, { day: FIXTURE_DAY, start: true });
        await assertThemeApplied(page, theme satisfies ParityTheme);

        await page.getByRole("navigation", { name: "Workflow" })
          .getByRole("button", { name: "Separations sp" })
          .click();
        // D296's negative control, and it belongs HERE because the picker
        // opens on Person Lookup, which DOES declare an intake projection.
        // Separations declares none, so its method set is a set of one and the
        // strip is not drawn at all — the demo's own condition. A strip on this
        // workflow would mean the door came from somewhere other than the
        // served `spreadsheetIntake`, and it would offer an intake the kernel
        // refuses by name.
        await expect(page.getByRole("tablist", { name: "How to start this run" })).toHaveCount(0);
        const typedDocument = page.getByPlaceholder(
          "Enter Kuali document numbers, semicolon-separated (e.g. 4502; 4510)",
        );
        await typedDocument.fill("4502");
        await expect(typedDocument).toHaveValue("4502");
        await assertShellGeometry(page, `separations-start-input @ ${viewport.name} ${theme.name}`);
        expect(errors, "page errors while rendering the separations Start Run input").toEqual([]);

        await captureParityPair(page, REFERENCES, {
          stateId: "separations-start-input",
          viewport: viewport.name,
          theme: theme.name,
          adapter: "fixture",
          fixtureId: "separations-start-input",
          descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
          appVersion: FIXTURE_APP_VERSION,
          capturedAt: FIXTURE_DAY,
          variant: "default",
        });

        await page.getByRole("button", { name: "Next" }).click();
        await expect(page.getByRole("checkbox", { name: "Customize steps" })).toBeVisible();

        await captureParityPair(page, REFERENCES, {
          stateId: "separations-start-options",
          viewport: viewport.name,
          theme: theme.name,
          adapter: "fixture",
          fixtureId: "separations-start-options",
          descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
          appVersion: FIXTURE_APP_VERSION,
          capturedAt: FIXTURE_DAY,
          variant: "default",
        });

        await page.getByRole("checkbox", { name: "Customize steps" }).check();
        await page.getByRole("button", { name: "Next" }).click();
        await expect(page.getByRole("heading", { name: "Steps" })).toBeVisible();
        await expect(page.getByText("6 of 6 included", { exact: true })).toBeVisible();

        await captureParityPair(page, REFERENCES, {
          stateId: "separations-start-steps",
          viewport: viewport.name,
          theme: theme.name,
          adapter: "fixture",
          fixtureId: "separations-start-steps",
          descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
          appVersion: FIXTURE_APP_VERSION,
          capturedAt: FIXTURE_DAY,
          variant: "default",
        });

        // D307 — the omission itself. Unchecking an omittable step draws the
        // step folder's OWN declared form inline, and the run reads what is
        // typed there instead of the step. Separations is the only workflow
        // that declares omissions, and Kronos timecard is the one whose form
        // has fields to photograph.
        await page.getByRole("checkbox", { name: "Kronos timecard" }).uncheck();
        await expect(page.getByText("5 of 6 included", { exact: true })).toBeVisible();
        await page.getByLabel("Last day worked").fill("06/30/2026");
        await page.getByLabel("Separation date").fill("07/01/2026");
        await expect(page.getByLabel("Separation date")).toHaveValue("07/01/2026");
        expect(errors, "page errors while rendering the omitted separations step").toEqual([]);

        await captureParityPair(page, REFERENCES, {
          stateId: "separations-start-steps-omitted",
          viewport: viewport.name,
          theme: theme.name,
          adapter: "fixture",
          fixtureId: "separations-start-steps-omitted",
          descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
          appVersion: FIXTURE_APP_VERSION,
          capturedAt: FIXTURE_DAY,
          variant: "default",
        });

        // Put it back, so the plan capture below photographs the same request
        // it always did: the drafts leave with the omission.
        await page.getByRole("checkbox", { name: "Kronos timecard" }).check();
        await expect(page.getByText("6 of 6 included", { exact: true })).toBeVisible();

        await page.getByRole("button", { name: "Next" }).click();
        await expect(page.getByText("Fixture plan row", { exact: true })).toBeVisible();
        await expect(page.getByText("4502", { exact: true })).toBeVisible();
        await expect(page.getByText(/Julian Zaw/u)).toHaveCount(0);
        await assertShellGeometry(page, `separations-start-plan @ ${viewport.name} ${theme.name}`);
        expect(errors, "page errors while rendering the separations Start Run plan").toEqual([]);

        await captureParityPair(page, REFERENCES, {
          stateId: "separations-start-plan",
          viewport: viewport.name,
          theme: theme.name,
          adapter: "fixture",
          fixtureId: "separations-start-plan",
          descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
          appVersion: FIXTURE_APP_VERSION,
          capturedAt: FIXTURE_DAY,
          variant: "default",
        });

        await page.getByRole("button", { name: "Start run" }).click();
        await expect(page.getByText("Start applied", { exact: true })).toBeVisible();
        await expect(page.getByText("4502", { exact: true })).toBeVisible();
        await expect(page.getByText(/Julian Zaw/u)).toHaveCount(0);
        await assertShellGeometry(page, `separations-start-result @ ${viewport.name} ${theme.name}`);
        expect(errors, "page errors while rendering the separations Start Run result").toEqual([]);

        await captureParityPair(page, REFERENCES, {
          stateId: "separations-start-result",
          viewport: viewport.name,
          theme: theme.name,
          adapter: "fixture",
          fixtureId: "separations-start-result",
          descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
          appVersion: FIXTURE_APP_VERSION,
          capturedAt: FIXTURE_DAY,
          variant: "default",
        });

        await page.getByText("Close", { exact: true }).click();
        await expect(typedDocument).toBeFocused();
        await expect(typedDocument).toHaveValue("4502");
      });
    }
  }
});
