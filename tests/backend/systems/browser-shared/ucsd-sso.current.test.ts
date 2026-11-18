import assert from "node:assert/strict";
import type { Page } from "playwright";
import { it } from "vitest";
import { submitPinnedUcsdSsoCredentials } from "../../../../src/backend/systems/browser-shared/ucsd-sso.js";

it.each([false, true])("guards credential effects and retains element disposal after username fill revocation (%s)", async revoke => {
  const url = "https://a5.ucsd.edu/tritON/profile/SAML2/Redirect/SSO";
  let current = true;
  const refusal = new Error("fixture session revoked");
  const effects: string[] = [], disposed: string[] = [];
  const handles = new Map(["ssousername", "ssopassword", "sso-submit"].map(name => [name, {
    evaluateHandle: async () => ({ dispose: async () => { disposed.push("form"); } }),
    evaluate: async (_fn: unknown, input: { action: { kind: string } }) => {
      if (input.action.kind === "username") {
        effects.push("fill:ssousername");
        if (revoke) current = false;
      }
      if (input.action.kind === "password") effects.push("fill:ssopassword");
      if (input.action.kind === "submit") { effects.push("click:sso-submit"); return url; }
      return true;
    },
    dispose: async () => { disposed.push(name); },
  }]));
  const page = {
    waitForNavigation: async () => ({ request: () => ({ method: () => "POST", url: () => url, redirectedFrom: () => null }) }),
    url: () => url,
    locator: (selector: string) => {
      const key = [...handles.keys()].find(name => selector.includes(name === "sso-submit" ? "_eventId_proceed" : name));
      assert.ok(key);
      return { count: async () => 1, elementHandle: async () => handles.get(key) };
    },
  } as unknown as Page;
  const operation = submitPinnedUcsdSsoCredentials(page, async () => ({ userId: "fixture-user", password: "fixture-password" }),
    () => { if (!current) throw refusal; }, 1000, "/tritON/profile/SAML2/Redirect/SSO");
  if (revoke) await assert.rejects(operation, error => error === refusal);
  else await operation;
  assert.deepEqual(effects, revoke ? ["fill:ssousername"] : ["fill:ssousername", "fill:ssopassword", "click:sso-submit"]);
  assert.deepEqual(disposed, ["ssousername", "ssopassword", "sso-submit", "form"]);
});
