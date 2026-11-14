import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { i9LoginRecipe, isAuthenticatedI9Url, verifyI9AuthenticatedApplication } from "../../../../src/backend/systems/i9/login.js";
import { createSystemSessionTestWorld } from "../../../support/helpers/backend/system-session-world.js";
import { resolveSystemEntryUrl, resolveSystemLoginUrl } from "../../../../src/models/config/instance.js";

const { CONFIG, SSO, NO_SIGN_IN_FORMS, contextFor } = createSystemSessionTestWorld();
const APP = "https://wwwe.i9complete.com";
const WAYF = "https://samlproxy.ucop.edu/wayf";
const TRAINING = `${APP}/Training`;
const appElements = { ...NO_SIGN_IN_FORMS, "i9-search-options": {}, "i9-training-dismiss": { count: 0 } } as const;

describe("I-9 UCOP login", () => {
  it("requires an exact application origin, rendered app control and absent SSO form", async () => {
    assert.equal(isAuthenticatedI9Url(`${APP}/employee/profile/900001`), true);
    for (const url of [`${APP}/Account/Login`, TRAINING, "https://wwwe.i9complete.com.example.test", "https://user:secret@wwwe.i9complete.com", "http://wwwe.i9complete.com"]) assert.equal(isAuthenticatedI9Url(url), false);
    const warm = await contextFor({ url: APP, elements: appElements }, undefined, "i9");
    assert.equal((await verifyI9AuthenticatedApplication(warm.context)).authenticated, true);
    assert.equal(await i9LoginRecipe(warm.context), "already-authenticated");
    assert.deepEqual(warm.harness.filled(), []);
    const missing = await contextFor({ url: APP, elements: { ...appElements, "i9-search-options": { count: 0 } } }, undefined, "i9");
    assert.equal((await verifyI9AuthenticatedApplication(missing.context)).authenticated, false);
    const form = await contextFor({ url: APP, elements: { ...appElements, "sso-submit": {} } }, undefined, "i9");
    assert.equal((await verifyI9AuthenticatedApplication(form.context)).authenticated, false);
  });

  it("returns a signed-in session to the I-9 application on the neutral reset; login alone starts at the launch page", async () => {
    // The worker's neutral reset opens the entry URL and then requires this proof (live run 7 failed it on the launch page).
    const entry = resolveSystemEntryUrl(CONFIG, "i9", "prod", "i9 neutral reset");
    const world = await contextFor({ url: `${APP}/form-I9/summary/900001/900002`,
      navigation: { [CONFIG.urls.i9.prod.entry]: CONFIG.urls.i9.prod.entry, [CONFIG.urls.i9.prod.app]: APP },
      elementsByUrl: { [APP]: appElements } }, undefined, "i9");
    await world.context.page.goto(entry);
    assert.equal((await verifyI9AuthenticatedApplication(world.context)).authenticated, true);
    assert.equal(resolveSystemLoginUrl(CONFIG, "i9", "prod", "i9 login"), CONFIG.urls.i9.prod.entry);
  });

  it("uses the campus picker and the shared signed Duo ceremony before dismissing training", async () => {
    const world = await contextFor({
      url: "about:blank",
      navigation: { [CONFIG.urls.i9.prod.entry]: CONFIG.urls.i9.prod.entry },
      elements: {
        "i9-launch": { navigatesTo: WAYF }, "i9-campus": {}, "i9-campus-select": { navigatesTo: SSO },
        "sso-submit": {}, "sso-username": {}, "sso-password": {},
        "i9-training-dismiss": { navigatesTo: TRAINING }, "i9-training-confirm": { navigatesTo: APP },
      },
      elementsByUrl: { [APP]: appElements },
      settlesTo: [WAYF, SSO, TRAINING],
    }, undefined, "i9");
    let scopes = 0;
    assert.equal(await i9LoginRecipe({ ...world.context,
      withDuoSigningScope: async (_token, run) => { scopes++; return run(); },
    }), "logged-in");
    assert.equal(scopes, 1);
    assert.ok(world.harness.actions().includes("select:i9-campus"));
    assert.ok(world.harness.actions().includes("click:i9-training-confirm"));
    assert.equal(world.evidence().length, 1);
    assert.equal(world.harness.filled().length, 2);
  });

  it("accepts a remembered campus and refuses failed training dismissal", async () => {
    const remembered = await contextFor({
      url: "about:blank", elements: { "i9-launch": { navigatesTo: SSO }, "sso-submit": {}, "sso-username": {}, "sso-password": {} },
      elementsByUrl: { [APP]: appElements }, settlesTo: [SSO, APP],
    }, undefined, "i9");
    assert.equal(await i9LoginRecipe(remembered.context), "logged-in");
    assert.equal(remembered.harness.actions().includes("select:i9-campus"), false);
    const failed = await contextFor({ url: "about:blank", navigation: { [CONFIG.urls.i9.prod.entry]: TRAINING },
      elements: { "i9-training-dismiss": { failWith: "training confirmation failed" } } }, undefined, "i9");
    await assert.rejects(i9LoginRecipe(failed.context), (error: unknown) => {
      assert.ok(error instanceof Error && error.cause instanceof Error);
      assert.match(error.cause.message, /training confirmation failed/u);
      return true;
    });
    assert.equal(failed.evidence().length, 0);
  });

  it("waits for a confirmed training dismissal to leave the training route before proving the application", async () => {
    const notice = `${APP}/training/RequiredTrainingNotification`;
    const world = await contextFor({
      url: "about:blank",
      elements: { "i9-launch": { navigatesTo: SSO }, "sso-submit": {}, "sso-username": {}, "sso-password": {} },
      elementsByUrl: {
        [notice]: { ...NO_SIGN_IN_FORMS, "i9-search-options": {}, "i9-training-dismiss": {}, "i9-training-confirm": {} },
        [APP]: appElements,
      },
      settlesTo: [SSO, notice, APP],
    }, undefined, "i9");
    assert.equal(await i9LoginRecipe(world.context), "logged-in");
    assert.ok(world.harness.actions().includes("click:i9-training-confirm"));
    assert.equal(world.harness.url(), APP);
    assert.equal(world.evidence().length, 1);
  });

  it("waits for campus selection to reach an existing app session without requiring an SSO form", async () => {
    const world = await contextFor({
      url: "about:blank",
      elements: { "i9-launch": { navigatesTo: WAYF }, "i9-campus": {}, "i9-campus-select": {}, "sso-submit": { count: 0 } },
      elementsByUrl: { [APP]: appElements },
      settlesTo: [WAYF, APP],
    }, undefined, "i9");
    assert.equal(await i9LoginRecipe(world.context), "logged-in");
    assert.ok(world.harness.actions().includes("click:i9-campus-select"));
    assert.deepEqual(world.harness.filled(), []);
    assert.equal(world.evidence().length, 1);
  });

  it("stops credential effects when cancelled", async () => {
    const controller = new AbortController(); controller.abort();
    const world = await contextFor({ url: "about:blank" }, controller.signal, "i9");
    await assert.rejects(i9LoginRecipe(world.context), /sign-in failed/u);
    assert.deepEqual(world.harness.actions(), []);
    assert.deepEqual(world.harness.filled(), []);
  });

  it("clears a warm-session training banner even when Search Options is visible beside it", async () => {
    const cleared = `${APP}/employee`;
    const world = await contextFor({
      url: APP, navigation: { [CONFIG.urls.i9.prod.entry]: APP },
      elementsByUrl: {
        [APP]: { ...appElements, "i9-training-dismiss": {}, "i9-training-confirm": { navigatesTo: cleared } },
        [cleared]: appElements,
      },
    }, undefined, "i9");
    assert.equal((await verifyI9AuthenticatedApplication(world.context)).authenticated, false);
    assert.equal(await i9LoginRecipe(world.context), "already-authenticated");
    assert.ok(world.harness.actions().includes("click:i9-training-confirm"));
    assert.equal(world.harness.actions().some(action => action.startsWith("goto:")), false);
    assert.deepEqual(world.harness.filled(), []);
  });
});
