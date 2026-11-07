import assert from "node:assert/strict";
import { it } from "vitest";
import { ERROR_CATALOG } from "../../../../src/models/failures/error-catalog.js";
import { BrowserSystemIdSchema } from "../../../../src/rules/identity/ids.js";
import { BrowserLoginError, BrowserLandingStallError, DuoTerminalRefusalError, browserLoginFailure } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import type { BrowserLandingStallCode } from "../../../../src/backend/systems/browser-shared/login-contract.js";

it("maps every browser system to its own fixed sign-in failure and retains diagnostic metadata", () => {
  const cause = new Error("original diagnostic");
  for (const system of BrowserSystemIdSchema.options) {
    const error = new BrowserLoginError(system, "sso-submit", "private diagnostic", "https://example.invalid/login", { cause });
    assert.equal(error.code, `${system.replaceAll("-", "_").toUpperCase()}_SIGN_IN_FAILED`);
    assert.equal(error.message, ERROR_CATALOG[error.code].text);
    assert.equal(error.system, system);
    assert.equal(error.step, "sso-submit");
    assert.equal(error.detail, "private diagnostic");
    assert.equal(error.observedUrl, "https://example.invalid/login");
    assert.equal(error.cause, cause);
    assert.equal(browserLoginFailure(new Error("outer", { cause: error })), error);
    assert.doesNotMatch(error.message, /private diagnostic|example.invalid/);
  }
});

it("uses catalog text for every landing refusal and preserves specialized recovery identities", () => {
  const cause = new Error("original diagnostic");
  const codes = ["TRAINING_REMINDER_REPEATED", "SHIBBOLETH_STALE_REQUEST", "DUO_PROMPT_STALLED", "DUO_REFUSAL_UNPROVEN", "SSO_FIRST_FACTOR_REJECTED", "LANDING_PROBE_UNAVAILABLE", "AUTHENTICATED_LANDING_MISSING"] as const satisfies readonly BrowserLandingStallCode[];
  for (const code of codes) {
    const error = new BrowserLandingStallError("ucpath", code, { host: "a5.ucsd.edu", path: "/sso", title: "SSO https://example.invalid/private" }, { cause });
    assert.equal(error.code, code);
    assert.equal(error.message, ERROR_CATALOG[code].text);
    assert.equal(error.host, "a5.ucsd.edu");
    assert.equal(error.path, "/sso");
    assert.equal(error.title, "SSO [URL]");
    assert.equal(error.cause, cause);
    assert.ok(error instanceof BrowserLoginError);
  }
  const duo = new DuoTerminalRefusalError("crm", "private diagnostic", "https://login.example.invalid/sso", { cause });
  assert.equal(duo.code, "DUO_TERMINAL_REFUSAL");
  assert.equal(duo.message, ERROR_CATALOG.DUO_TERMINAL_REFUSAL.text);
  assert.equal(duo.refusal, "duo-terminal-refusal");
  assert.equal(duo.host, "login.example.invalid");
  assert.equal(duo.path, "/sso");
  assert.equal(duo.detail, "private diagnostic");
  assert.equal(duo.cause, cause);
  assert.ok(duo instanceof BrowserLoginError);
});
