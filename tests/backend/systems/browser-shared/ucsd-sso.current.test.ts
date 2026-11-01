import assert from "node:assert/strict";
import type { Page } from "playwright";
import { it } from "vitest";
import { submitOnboardingSsoCredentials } from "../../../../src/backend/systems/browser-shared/ucsd-sso.js";

it.each([false, true])("guards credential effects and retains element disposal after username fill revocation (%s)", async revoke => {
  let current = true;
  const refusal = new Error("fixture session revoked");
  const effects: string[] = [], disposed: string[] = [];
  const handles = new Map(["ssousername", "ssopassword", "sso-submit"].map(name => [name, {
    isVisible: async () => true, isEditable: async () => true, isEnabled: async () => true,
    evaluate: async () => true,
    fill: async () => { effects.push(`fill:${name}`); if (revoke && name === "ssousername") current = false; },
    click: async () => { effects.push(`click:${name}`); },
    dispose: async () => { disposed.push(name); },
  }]));
  const page = {
    url: () => "https://a5.ucsd.edu/tritON/profile/SAML2/Redirect/SSO",
    locator: (selector: string) => {
      const key = [...handles.keys()].find(name => selector.includes(name === "sso-submit" ? "_eventId_proceed" : name));
      assert.ok(key);
      return { count: async () => 1, elementHandle: async () => handles.get(key) };
    },
  } as unknown as Page;
  const operation = submitOnboardingSsoCredentials(page, async () => ({ userId: "fixture-user", password: "fixture-password" }),
    () => { if (!current) throw refusal; }, 1000);
  if (revoke) await assert.rejects(operation, error => error === refusal);
  else await operation;
  assert.deepEqual(effects, revoke ? ["fill:ssousername"] : ["fill:ssousername", "fill:ssopassword", "click:sso-submit"]);
  assert.deepEqual(disposed, ["ssousername", "ssopassword", "sso-submit"]);
});
