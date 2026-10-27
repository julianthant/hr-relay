import assert from "node:assert/strict";
import { it } from "vitest";
import { BrowserDocumentIdSchema, DuoEnrollmentScopeSchema } from "../../../src/models/config/duo-credential-store.js";

it("retains the browser document token verbatim while keeping issued identities as UUIDs", () => {
  const token = "A0000000000040008000000000000007";
  assert.equal(BrowserDocumentIdSchema.parse(token), token);
  assert.equal(BrowserDocumentIdSchema.parse(token.toLowerCase()), token.toLowerCase());
  const scope = { armId: "00000000-0000-4000-8000-000000000001", contextId: token, tabId: 7,
    accountId: "00000000-0000-4000-8000-000000000002", origin: "https://test.duosecurity.com", rpId: "duosecurity.com",
    armedAt: "2026-10-26T12:00:00.000Z", expiresAt: "2026-10-26T12:10:00.000Z" };
  assert.equal(DuoEnrollmentScopeSchema.parse(scope).contextId, token);
  for (const value of [undefined, "", "x".repeat(32), token.slice(1), `${token}0`, ` ${token}`, scope.armId]) {
    assert.equal(BrowserDocumentIdSchema.safeParse(value).success, false);
    assert.equal(DuoEnrollmentScopeSchema.safeParse({ ...scope, contextId: value }).success, false);
  }
  for (const field of ["accountId", "armId"] as const) {
    assert.equal(DuoEnrollmentScopeSchema.safeParse({ ...scope, [field]: token }).success, false);
  }
});
