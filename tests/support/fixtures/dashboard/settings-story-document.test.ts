import { describe, expect, it } from "vitest";
import bootstrap from "./settings-story-bootstrap.json" with { type: "json" };
import baseDocument from "./settings-story-document.json" with { type: "json" };
import { FIXTURE_BOOTSTRAP } from "./fixture-bootstrap.js";
import { fixtureSettingsDocument } from "./fixture-settings.js";

/** The Settings stories run in the page, where the backend builders behind these fixtures cannot; they start from copies. */
describe("the Settings story copies", () => {
  it("hold the editable settings of a fresh install at revision 2", () => {
    expect(baseDocument).toEqual(JSON.parse(JSON.stringify(fixtureSettingsDocument({}, 2))));
  });

  it("hold the fixture bootstrap", () => {
    expect(bootstrap).toEqual(JSON.parse(JSON.stringify(FIXTURE_BOOTSTRAP)));
  });
});
