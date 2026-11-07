import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { verifyCrmAuthenticatedApplication } from "../../../../src/backend/systems/crm/session.js";
import { verifyKualiAuthenticatedApplication } from "../../../../src/backend/systems/kuali/session.js";
import { verifyNewKronosAuthenticatedApplication } from "../../../../src/backend/systems/new-kronos/session.js";
import { isAuthenticatedUcpathAppUrl, isUcpathPostSsoLanding, verifyUcpathAuthenticatedApplication } from "../../../../src/backend/systems/ucpath/session.js";
import { createSystemSessionTestWorld } from "../../../support/helpers/backend/system-session-world.js";

const { CONFIG, NO_SIGN_IN_FORMS, contextFor } = createSystemSessionTestWorld();
const cases = [
  { system: "crm", host: "act-crm.my.site.com", path: "/hr/ONB_SearchOnboardings",
    verify: verifyCrmAuthenticatedApplication, cookies: [{ name: "sid", domain: "act-crm.my.site.com", value: "synthetic-session" }],
    legitimate: [CONFIG.urls.crm.prod.onboardingSearch, CONFIG.urls.crm.prod.onboardingHistory] },
  { system: "kuali", host: "ucsd.kualibuild.com", path: "/build/space/synthetic/actions",
    verify: verifyKualiAuthenticatedApplication, cookies: [],
    legitimate: [CONFIG.urls.kuali.prod.entry, "https://ucsd.kualibuild.com/app/api/v0/graphql"] },
  { system: "new-kronos", host: "ucsd-sso.prd.mykronos.com", path: "/wfd/home",
    verify: verifyNewKronosAuthenticatedApplication, cookies: [{ name: "kronosAuthToken", domain: "ucsd-sso.prd.mykronos.com", value: "synthetic-session" }],
    legitimate: [CONFIG.urls.newKronos.prod.entry, "https://ucsd-sso.prd.mykronos.com/wfd", "https://ucsd-sso.prd.mykronos.com/wfd/timekeeping#/timecard"] },
  { system: "ucpath", host: "ucphrprdpub.universityofcalifornia.edu", path: "/psc/ucphrprd/EMPLOYEE/HRMS/c/app",
    verify: verifyUcpathAuthenticatedApplication, cookies: [{ name: "PS_TOKEN", domain: "ucphrprdpub.universityofcalifornia.edu", value: "synthetic-session" }],
    legitimate: [CONFIG.urls.ucpath.prod.smartHr, CONFIG.urls.ucpath.prod.personProfile] },
] as const;

const elements = { ...NO_SIGN_IN_FORMS, "sso-username": { count: 0 }, "sso-password": { count: 0 },
  "kuali-app-chrome": { count: 1 } };

describe("authenticated application URL identity", () => {
  for (const fixture of cases) {
    const rejected = [
      ["unrelated query", `https://unrelated.invalid/?next=https://${fixture.host}${fixture.path}`],
      ["userinfo host text", `https://${fixture.host}@unrelated.invalid${fixture.path}`],
      ["lookalike suffix", `https://${fixture.host}.unrelated.invalid${fixture.path}`],
      ["subdomain", `https://unrelated.${fixture.host}${fixture.path}`],
      ["HTTP", `http://${fixture.host}${fixture.path}`],
      ["non-default port", `https://${fixture.host}:8443${fixture.path}`],
      ["wrong path with expected path in query", `https://${fixture.host}/unrelated?next=${fixture.path}`],
      ["malformed URL", `https://[invalid/?next=${fixture.host}${fixture.path}`],
    ];
    for (const [name, url] of rejected) {
      it(`${fixture.system} refuses ${name} despite retained positive application evidence`, async () => {
        const { context } = await contextFor({ url, elements, cookies: fixture.cookies }, undefined, fixture.system);
        const probe = await fixture.verify(context);
        assert.equal(probe.authenticated, false);
      });
    }
    for (const url of fixture.legitimate) {
      it(`${fixture.system} retains the evidenced application route ${new URL(url).pathname}`, async () => {
        const { context } = await contextFor({ url, elements, cookies: fixture.cookies }, undefined, fixture.system);
        assert.equal((await fixture.verify(context)).authenticated, true);
      });
    }
  }
  for (const [fixture, pathname] of [[cases[0], "/hr-other/app"], [cases[1], "/application/app"],
    [cases[1], "/build/spaces/synthetic"], [cases[2], "/wfd-other/home"],
    [cases[3], "/psc/ucphrprd/EMPLOYEE/HRMS-other/c/app"],
    [cases[3], "/psc/foreign/EMPLOYEE/HRMS/c/app"], [cases[3], "/other/psc/ucphrprd/EMPLOYEE/HRMS/c/app"],
    [cases[0], "/HR/ONB_SearchOnboardings"], [cases[1], "/APP/api/v0/graphql"],
    [cases[2], "/WFD/home"], [cases[3], "/psc/ucphrprd/employee/hrms/c/app"]] as const) {
    it(`${fixture.system} requires the evidenced path-segment boundary ${pathname}`, async () => {
      const { context } = await contextFor({ url: `https://${fixture.host}${pathname}`, elements, cookies: fixture.cookies }, undefined, fixture.system);
      assert.equal((await fixture.verify(context)).authenticated, false);
    });
  }
  it("keeps the exact HTTPS public UCPath portal a wait target only", () => {
    assert.equal(isUcpathPostSsoLanding("https://ucpath.universityofcalifornia.edu/"), true);
    assert.equal(isAuthenticatedUcpathAppUrl("https://ucpath.universityofcalifornia.edu/psc/ucphrprd/EMPLOYEE/HRMS/c/app"), false);
    for (const url of ["https://unrelated.invalid/?next=universityofcalifornia.edu", "https://ucpath.universityofcalifornia.edu.unrelated.invalid/",
      "http://ucpath.universityofcalifornia.edu/", "https://ucpath.universityofcalifornia.edu:8443/"]) {
      assert.equal(isUcpathPostSsoLanding(url), false);
    }
  });
});
