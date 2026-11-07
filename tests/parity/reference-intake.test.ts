import { registerReferenceServers } from "./helpers/reference-harness.js";
import { ANCHORS,SCENES } from "./helpers/reference-intake-scenes.js";
import { registerReferenceScenes } from "./helpers/reference-scenes.js";
const servers = registerReferenceServers(["server"]);
registerReferenceScenes(SCENES, () => servers.server, ANCHORS);

// The parity wrapper requires a body-backed accessibility receipt as well as
// the committed PNG/tree/provenance reference triples.
import { createHash } from "node:crypto";
import { test } from "./helpers/fixtures.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_INTAKE_IDS } from "../support/fixtures/dashboard/fixture-intake.js";
test("intake-review accessibility receipt", { annotation: [{ type: "required-a11y-evidence", description: "intake-reference-review.a11y.yml" }] }, async ({ page }) => {
  await gotoAppState(page, servers.server.baseUrl, { day: FIXTURE_DAY, intake: FIXTURE_INTAKE_IDS.validated });
  const snapshot = await page.locator("body").ariaSnapshot();
  test.info().annotations.push({ type: "a11y-attachment-sha256:intake-reference-review.a11y.yml", description: createHash("sha256").update(snapshot).digest("hex") });
  await test.info().attach("intake-reference-review.a11y.yml", { body: snapshot, contentType: "text/yaml" });
});
