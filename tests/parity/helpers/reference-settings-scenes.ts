import { expect } from "@playwright/test";
import { FIXTURE_DAY } from "./fixture-identity.js";
import type { ReferenceScene,SceneAnchors } from "./reference-scenes.js";
export const SCENES: readonly ReferenceScene[] = [
  /*
    THE SETTINGS TAKEOVER (D274 item 6). The gear has been in the top bar of
    every reference in this corpus since it was written, and what it opens had
    never been photographed once — while the fixture served a single invented
    `general` section, so the only page reachable behind it was the "this build
    has no renderer for it" gap. The bootstrap now lists the SERVER's own three
    sections and the lane serves `settings/facts`, so this opens on the first
    one exactly as the operator's gear does.
  */
  { id: "settings", route: { day: FIXTURE_DAY, settings: "" } }];
export const ANCHORS: SceneAnchors = {
  "settings": async (page) => {
    // DCC3's server-listed editor resolves the blank route to General. Waiting
    // on its real form control prevents a loading/no-renderer arm from being
    // deliberately re-frozen as the editable Settings reference.
    await expect(page.getByRole("textbox", { name: "Operator label" })).toBeVisible();
  }};
