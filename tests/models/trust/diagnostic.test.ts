import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { DiagnosticBundleSchema } from "../../../src/models/trust/diagnostic.js";
import { FailureRecordSchema } from "../../../src/models/trust/failure.js";

const UUID_1 = "11111111-1111-4111-8111-111111111111";
const UUID_2 = "22222222-2222-4222-8222-222222222222";
const UUID_3 = "33333333-3333-4333-8333-333333333333";
const UUID_4 = "44444444-4444-4444-8444-444444444444";
const FINGERPRINT = "a".repeat(64);
const FAILURE_FINGERPRINT = "b".repeat(64);
const INSTANT = "2026-07-31T17:00:00.000Z";

const FAILURE = {
  failureId: UUID_1,
  fingerprint: FAILURE_FINGERPRINT,
  runId: UUID_2,
  traceId: "on-120000-2222",
  attempt: 1,
  workflowId: "onboarding",
  nodeId: "search-person",
  taskId: "ucpath/search-person",
  code: "UNEXPECTED_PAGE_STATE",
  summary: "Expected search results did not render",
  transient: false,
  writeState: "not-attempted",
  page: { screen: "ucpath.person-search", state: "ucpath.person-search-ready", titleRedacted: "Person search" },
  action: { elementId: "ucpath.person-search.submit", operation: "click", sequence: 3 },
  causeChain: [{ code: "UNEXPECTED_PAGE_STATE", summary: "Page state mismatch", role: "primary", transient: false }],
  remediation: [{ kind: "code-change", message: "Verify and update the registered page-state recipe" }],
  occurredAt: INSTANT,
};

describe("strict trust records", () => {
  it("parses valid failure and diagnostic records and rejects nested unknowns or invalid write states", () => {
    assert.equal(FailureRecordSchema.safeParse(FAILURE).success, true);
    assert.equal(FailureRecordSchema.safeParse({
      ...FAILURE,
      page: { ...FAILURE.page, rawHtml: "secret" },
    }).success, false);
    assert.equal(FailureRecordSchema.safeParse({
      ...FAILURE,
      writeState: "unknown",
    }).success, false);
    assert.equal(FailureRecordSchema.safeParse({
      ...FAILURE,
      causeChain: [...FAILURE.causeChain, { ...FAILURE.causeChain[0], role: "primary" }],
    }).success, false);

    const bundle = {
      bundleId: UUID_1,
      runId: UUID_2,
      origin: { kind: "failure", failureId: UUID_3 },
      createdAt: INSTANT,
      contentDigest: FINGERPRINT,
      configFingerprint: FINGERPRINT,
      descriptorFingerprint: FINGERPRINT,
      redaction: { fields: [], warnings: [] },
      attachments: [{
        kind: "screenshot", artifactId: UUID_4, mediaType: "image/png", byteLength: 100,
        digest: FINGERPRINT, width: 1280, height: 720, sensitivity: "redacted",
      }],
      retention: { kind: "ordinary", purgeAfter: "2026-08-31T17:00:00.000Z" },
    };
    assert.equal(DiagnosticBundleSchema.safeParse(bundle).success, true);
    assert.equal(DiagnosticBundleSchema.safeParse({ ...bundle, attachments: [...bundle.attachments, bundle.attachments[0]] }).success, false);
    assert.equal(DiagnosticBundleSchema.safeParse({ ...bundle, origin: { ...bundle.origin, requestedBy: "local-operator" } }).success, false);
  });
});
