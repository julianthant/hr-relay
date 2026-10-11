import { hostConfigFacts } from "../../../../src/models/config/host-display.js";

import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import type {
AuthenticatedApplicationEvidence,
SystemLoginContext,
} from "../../../../src/backend/systems/browser-shared/login-contract.js";
import { verifyKualiAuthenticatedApplication } from "../../../../src/backend/systems/kuali/session.js";
import type { BrowserSystemId } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import {
fakeLoginPage,
type FakePageScript
} from "../../../support/helpers/browser/fake-login-page.js";
import { fixtureDuoCeremonyGate } from "../../../support/helpers/duo-ceremony-fixtures.js";

const CONFIG = resolveConfigWithProvenance({}, hostConfigFacts({}), manualClock(new Date("2026-08-03T09:00:00.000Z"))).config;
const CREDENTIALS = Object.freeze({ userId: "fixture-user", password: "fixture-value" });
const SSO = "https://a5.ucsd.edu/idp/profile/SAML2/Redirect/SSO";


const NO_SIGN_IN_FORMS = {
  "campus-link": { count: 0 },
  "sso-submit": { count: 0 },
  "peoplesoft-signon": { count: 0 },
  "communities-login": { count: 0 },
} as const;

function contextFor(
  script: FakePageScript,
  signal = new AbortController().signal,
  system: BrowserSystemId = "ucpath",
): {
  context: SystemLoginContext;
  harness: ReturnType<typeof fakeLoginPage>;
  evidence: () => readonly AuthenticatedApplicationEvidence[];
} {
  const harness = fakeLoginPage(script);
  const recorded: AuthenticatedApplicationEvidence[] = [];
  return {
    harness,
    evidence: () => Object.freeze([...recorded]),
    context: {
      page: harness.page,
      config: CONFIG,
      instance: "prod",
      label: "worker person-lookup-worker-1 session",
      signal,
      credentials: CREDENTIALS,
      recordEvidence: (evidence) => recorded.push(evidence),

      duoCeremony: fixtureDuoCeremonyGate(system),
    },
  };
}

// Kuali renders controls after the authenticated URL; wait for the control before reading it.
describe("kuali landing verification — a client-rendered positive fact", () => {
  const KUALI_APP = CONFIG.urls.kuali.prod.entry;

  it("proves the session when the application chrome renders AFTER the landing URL settles", async () => {
    const { context } = contextFor({
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
    const { context } = contextFor({
      url: KUALI_APP,
      elements: { ...NO_SIGN_IN_FORMS, "kuali-app-chrome": { count: 0 } },
    });
    const probe = await verifyKualiAuthenticatedApplication(context);
    assert.equal(probe.authenticated, false);
    assert.match(probe.authenticated ? "" : probe.reason, /no Kuali Build application chrome/);
  });

  it("never pays the wait off the application host: the URL is checked first", async () => {
    const { context } = contextFor({
      url: SSO,
      elements: { "kuali-app-chrome": { count: 0 } },
    });
    const probe = await verifyKualiAuthenticatedApplication(context);
    assert.equal(probe.authenticated, false);
    assert.match(probe.authenticated ? "" : probe.reason, /not the Kuali Build application/);
  });
});
