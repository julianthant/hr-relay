import { expect,test } from "@playwright/test";
import { gotoAppState } from "../helpers/app-driver.js";
import { PARITY_THEMES,assertThemeApplied,captureParityPair,installTheme } from "../helpers/capture.js";
import { FIXTURE_IDENTITY_GATE } from "../helpers/run-detail/gates-park.js";
import { FIXTURE_APP_VERSION,FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH } from "../helpers/fixture-identity.js";
import { FIXTURE_IDS } from "../helpers/fixture-queue.js";
import { REFERENCES,failOnPageErrors } from "../helpers/reference-harness.js";
import { GATES_PARK_SCENES } from "../helpers/run-detail/gates-park-scenes.js";
import { referenceSceneGroups,servers } from "./shared.js";

for (const group of referenceSceneGroups(Object.values(GATES_PARK_SCENES))) {
  test.describe(group.title, () => {
    for (const scene of group.tests) test(scene.title, scene.run);
  });
}

test.describe("park resolutions", () => {
  const ARMS: readonly { variant: string; label: string }[] = [
    { variant: "resolve-absent", label: "I confirmed it is NOT there" },
    { variant: "resolve-present", label: "I confirmed it IS there" },
  ];
  for (const arm of ARMS) {
    test(`run-parked-write ${arm.variant}`, async ({ page }) => {
      const errors = failOnPageErrors(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await installTheme(page, PARITY_THEMES[0]);
      await gotoAppState(page, servers.server.baseUrl, { day: FIXTURE_DAY, run: FIXTURE_IDS.parkedRun });
      await assertThemeApplied(page, PARITY_THEMES[0]);

      // The record's own control, by its SERVED label — a rename on the server
      // must fail this test rather than silently re-photograph a new word.
      //
      // ANCHORED, NOT EXACT, since R8's `ParkResolutions` port: the two
      // resolutions are no longer bare pills, they are the demo's tinted CARDS,
      // and each card's accessible name is now the label FOLLOWED BY the
      // server's own `detail` sentence — which is the whole reason they became
      // cards (a pill can carry a verb; what separates these two verbs is a
      // sentence about what each one unlocks). A leading-anchored regex keeps
      // the property this locator was written for — the served label must still
      // be the first thing the control says — without pinning the sentence
      // beside it, which the reference images already review.
      const control = new RegExp(`^${arm.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
      await page.getByRole("button", { name: control }).click();
      // Radix moves focus into the dialog on open; wait for the surface itself
      // rather than a duration, so the capture is never of a half-mounted box.
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.waitForTimeout(250);
      expect(errors, `page errors while opening ${arm.variant}`).toEqual([]);

      await captureParityPair(page, REFERENCES, {
        stateId: "run-parked-write",
        viewport: "1440x900",
        theme: PARITY_THEMES[0].name,
        adapter: "fixture",
        fixtureId: "run-parked-write",
        descriptorHash: FIXTURE_DESCRIPTOR_HASH,
        appVersion: FIXTURE_APP_VERSION,
        capturedAt: FIXTURE_DAY,
        variant: arm.variant,
      });
    });
  }
});


/**
 * THE IDENTITY-APPROVAL CEREMONIES, OPEN (ref write-safety §14.4/§14.6, D226).
 *
 * `run-open-gate` above photographs the decision CARD. The control that
 * actually authorises a real termination against a named human lives one click
 * further in, and until D226 it did not exist: the corpus served no
 * `identity-gate` section at all, so the card drew no way to answer it.
 *
 * The current name-only path uses the typed-EID ceremony. These references
 * show it with agreeing and disconfirming names, plus the rejection/refusal:
 *
 *  - **typed EID, names agree** — one exact-looking candidate still requires
 *    the EID to be stated because it came from a name search.
 *  - **typed EID, names differ** — the disagreement remains above the same
 *    empty field rather than changing the source-based trigger.
 *  - **reject** — the arm that ends the run, with the operator's own reason.
 *
 * And one refusal, because a surface photographed only in its happy state
 * proves nothing: the gated run is also the fixture BFF's conflict run, so
 * pressing the verb after typing the EID answers `409` and photographs the
 * "nothing was recorded" copy with the operator's answer still in the dialog.
 *
 * One viewport and one theme apiece: these are about the copy, the ceremony and
 * the refusal, which are the same pixels at every width.
 */
test.describe("identity gate ceremonies", () => {
  const CEREMONIES: readonly {
    variant: string;
    stateId: string;
    run: string;
    control: string;
  }[] = [
    {
      variant: "gate-choose",
      stateId: "run-open-gate",
      run: FIXTURE_IDS.openGateRun,
      control: "Approve the chosen EID",
    },
    {
      variant: "gate-reject",
      stateId: "run-open-gate",
      run: FIXTURE_IDS.openGateRun,
      control: "Reject — this is not the right person",
    },
    {
      variant: "gate-type-eid",
      stateId: "run-member-gate",
      run: FIXTURE_IDS.gateTypedEidRun,
      control: "Approve the chosen EID",
    },
  ];
  for (const ceremony of CEREMONIES) {
    test(`${ceremony.stateId} ${ceremony.variant}`, async ({ page }) => {
      const errors = failOnPageErrors(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await installTheme(page, PARITY_THEMES[0]);
      await gotoAppState(page, servers.server.baseUrl, { day: FIXTURE_DAY, run: ceremony.run });
      await assertThemeApplied(page, PARITY_THEMES[0]);

      // The decision card's own control, by its SERVED label — a rename on the
      // server must fail this test rather than silently re-photograph a new
      // word. Leading-anchored, since `BannerActions` may append the server's
      // `detail` sentence to the accessible name.
      const control = new RegExp(`^${ceremony.control.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`);
      await page.getByRole("button", { name: control }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.waitForTimeout(250);
      expect(errors, `page errors while opening ${ceremony.variant}`).toEqual([]);

      await captureParityPair(page, REFERENCES, {
        stateId: ceremony.stateId,
        viewport: "1440x900",
        theme: PARITY_THEMES[0].name,
        adapter: "fixture",
        fixtureId: ceremony.stateId,
        descriptorHash: FIXTURE_DESCRIPTOR_HASH,
        appVersion: FIXTURE_APP_VERSION,
        capturedAt: FIXTURE_DAY,
        variant: ceremony.variant,
      });
    });
  }

  /**
   * THE REFUSAL, with the answer still in the dialog.
   *
   * The gated run is also the fixture BFF's `conflictRun`, so this is a real
   * round trip through the real command client that comes back `409`. The
   * reference is here because "nothing was recorded" is the sentence an
   * operator reads when a second tab moved the row under them, and a refusal
   * whose copy nobody photographs is copy reviewed once by whoever wrote it.
   */
  test("run-open-gate gate-refused", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await installTheme(page, PARITY_THEMES[0]);
    await gotoAppState(page, servers.server.baseUrl, { day: FIXTURE_DAY, run: FIXTURE_IDS.openGateRun });
    await assertThemeApplied(page, PARITY_THEMES[0]);

    await page.getByRole("button", { name: /^Approve the chosen EID/u }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    // The EID came from a name search, so D309 requires the operator to type
    // one of the candidates the packet actually showed.
    const candidate = FIXTURE_IDENTITY_GATE.options[0];
    if (candidate === undefined) throw new Error("the refusal fixture served no identity candidate");
    await page.getByRole("textbox", {
      name: "Type the employee ID this separation is about (required)",
    }).fill(candidate.eid);
    await page.getByRole("button", { name: "Approve" }).click();
    // The refusal lands in TWO places on purpose (a dialog can be scrolled), so
    // this waits on the one INSIDE the dialog — the record beside the answer it
    // refused, which is what the reference is of.
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await page.waitForTimeout(300);
    /*
      A 409 is a VALUE here, not a page error (ref frontend-backend-integration §3.4): the client reports
      it, the dialog keeps the answer, and Chromium logs the non-2xx response to
      the console because every non-2xx response is logged there.

      So the expectation is the EXACT one line, not a filter that would swallow
      anything shaped like it. Pinning it both ways is the point: an empty array
      would mean the refusal never round-tripped, and a second entry would mean
      the page threw something this reference is about to photograph as normal.
    */
    expect(errors, "page errors while photographing the refused approval").toEqual([
      "Failed to load resource: the server responded with a status of 409 (Conflict)",
    ]);

    await captureParityPair(page, REFERENCES, {
      stateId: "run-open-gate",
      viewport: "1440x900",
      theme: PARITY_THEMES[0].name,
      adapter: "fixture",
      fixtureId: "run-open-gate",
      descriptorHash: FIXTURE_DESCRIPTOR_HASH,
      appVersion: FIXTURE_APP_VERSION,
      capturedAt: FIXTURE_DAY,
      variant: "gate-refused",
    });
  });
});
