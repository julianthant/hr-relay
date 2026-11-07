import { createSystemSessionTestWorld } from "../../../support/helpers/backend/system-session-world.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { verifyKualiAuthenticatedApplication } from "../../../../src/backend/systems/kuali/session.js";

const { CONFIG, SSO, NO_SIGN_IN_FORMS, contextFor } = createSystemSessionTestWorld();


// Kuali renders controls after the authenticated URL; wait for the control before reading it.
describe("kuali landing verification — a client-rendered positive fact", () => {
  const KUALI_APP = CONFIG.urls.kuali.prod.entry;

  it("proves the session when the application chrome renders AFTER the landing URL settles", async () => {
    const { context } = await contextFor({
      url: KUALI_APP,
      elements: {
        ...NO_SIGN_IN_FORMS,
        "sso-username": { count: 0 },
        "sso-password": { count: 0 },
        "kuali-app-chrome": { count: 1, rendersAfterWait: true },
      },
    });
    const probe = await verifyKualiAuthenticatedApplication(context);
    assert.equal(probe.authenticated, true, "a late-painting menubar is still a rendered menubar");
  });

  it("still refuses when the application chrome never renders", async () => {
    const { context } = await contextFor({
      url: KUALI_APP,
      elements: { ...NO_SIGN_IN_FORMS, "kuali-app-chrome": { count: 0 } },
    });
    const probe = await verifyKualiAuthenticatedApplication(context);
    assert.equal(probe.authenticated, false);
    assert.match(probe.authenticated ? "" : probe.reason, /no Kuali Build application chrome/);
  });

  it("never pays the wait off the application host: the URL is checked first", async () => {
    const { context } = await contextFor({
      url: SSO,
      elements: { "kuali-app-chrome": { count: 0 } },
    });
    const probe = await verifyKualiAuthenticatedApplication(context);
    assert.equal(probe.authenticated, false);
    assert.match(probe.authenticated ? "" : probe.reason, /not the Kuali Build application/);
  });
});
