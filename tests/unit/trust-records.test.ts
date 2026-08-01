import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DiagnosticBundleSchema } from "../../src/domain/trust/diagnostic.js";
import { RunEvidenceReceiptSchema } from "../../src/domain/trust/evidence.js";
import { FailureRecordSchema } from "../../src/domain/trust/failure.js";
import { FixRecordSchema, KnowledgeRecordSchema } from "../../src/domain/trust/knowledge.js";
import { ScenarioManifestSchema } from "../../src/domain/trust/scenario.js";

const UUID_1 = "11111111-1111-4111-8111-111111111111";
const UUID_2 = "22222222-2222-4222-8222-222222222222";
const UUID_3 = "33333333-3333-4333-8333-333333333333";
const UUID_4 = "44444444-4444-4444-8444-444444444444";
const UUID_5 = "55555555-5555-4555-8555-555555555555";
const FINGERPRINT = "a".repeat(64);
const FAILURE_FINGERPRINT = "b".repeat(64);
const INSTANT = "2026-07-31T17:00:00.000Z";
const EVIDENCE_REF = `observation:${UUID_2}`;

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

const SATISFIED_FACT = {
  id: UUID_1,
  field: "employeeId",
  mandatory: true,
  state: "satisfied",
  source: { kind: "system", taskId: "ucpath/search-person", observedAt: INSTANT },
  value: { state: "transformed", key: "employeeId", classification: "direct-identifier", transform: "last4", value: "1234" },
};

const RECEIPT = {
  receiptId: UUID_1,
  runId: UUID_2,
  traceId: "on-120000-2222",
  workflowId: "onboarding",
  attempt: 1,
  generatedAt: INSTANT,
  descriptorFingerprint: FINGERPRINT,
  configFingerprint: FINGERPRINT,
  retryOf: { state: "absent" },
  failure: { state: "absent" },
  input: [SATISFIED_FACT],
  observations: [],
  decisions: [],
  actions: [],
  verification: [{ id: UUID_3, obligation: "person.match", mandatory: true, verdict: "verified", evidence: [EVIDENCE_REF] }],
  output: [],
  reuse: [],
  warnings: [],
  confidence: "verified",
  result: "verified-done",
};

const SCENARIO = {
  id: "preflight/browser-missing",
  title: "Missing browser asset blocks executor start",
  scope: { workflowId: "onboarding" },
  kind: "permanent",
  fixture: "fixtures/preflight/browser-missing.json",
  input: { requestedCapability: "executor.run" },
  injections: [{ kind: "task-failure", taskId: "ucpath/search-person", code: "BROWSER_MISSING", occurrence: 1 }],
  expect: {
    terminal: "failed",
    actionCount: 0,
    externalCommitCount: 0,
    requiredEvidence: ["preflight.browser-assets"],
    failureCode: { state: "present", value: "BROWSER_MISSING" },
  },
  contractFingerprint: FINGERPRINT,
  requiredAssertions: ["blocks-executor"],
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

  it("enforces terminal receipt evidence and uncertainty invariants", () => {
    assert.equal(RunEvidenceReceiptSchema.safeParse(RECEIPT).success, true);
    assert.equal(RunEvidenceReceiptSchema.safeParse({
      ...RECEIPT,
      input: [{ ...SATISFIED_FACT, id: "ucpath.person-search.employee-eid" }],
    }).success, false);
    assert.equal(RunEvidenceReceiptSchema.safeParse({
      ...RECEIPT,
      input: [{
        ...SATISFIED_FACT,
        source: { kind: "operator-correction", supersedes: "ucpath.person-search.employee-eid" },
      }],
    }).success, false);
    assert.equal(RunEvidenceReceiptSchema.safeParse({
      ...RECEIPT,
      input: [{ ...SATISFIED_FACT, source: { kind: "operator-correction", supersedes: UUID_5 } }],
    }).success, true);
    assert.equal(RunEvidenceReceiptSchema.safeParse({ ...RECEIPT, confidence: "partial" }).success, false);
    assert.equal(RunEvidenceReceiptSchema.safeParse({
      ...RECEIPT,
      input: [{ ...SATISFIED_FACT, state: "unresolved", reason: "not observed", value: undefined }],
    }).success, false);
    assert.equal(RunEvidenceReceiptSchema.safeParse({ ...RECEIPT, result: "failed" }).success, false);
    assert.equal(RunEvidenceReceiptSchema.safeParse({
      ...RECEIPT,
      result: "done-with-warnings",
      confidence: "partial",
      warnings: [{ id: UUID_4, code: "OPTIONAL_FACT_MISSING", summary: "Optional note missing", loadBearing: true, evidence: [] }],
    }).success, false);
    assert.equal(RunEvidenceReceiptSchema.safeParse({
      ...RECEIPT,
      verification: [{ ...RECEIPT.verification[0], id: UUID_1 }],
    }).success, false);
  });

  it("validates scenario scope, closed injections, outcomes, and assertion identity", () => {
    assert.equal(ScenarioManifestSchema.safeParse(SCENARIO).success, true);
    assert.equal(ScenarioManifestSchema.safeParse({ ...SCENARIO, scope: { nodeId: "search-person" } }).success, false);
    assert.equal(ScenarioManifestSchema.safeParse({
      ...SCENARIO,
      injections: [{ ...SCENARIO.injections[0], fallback: true }],
    }).success, false);
    assert.equal(ScenarioManifestSchema.safeParse({
      ...SCENARIO,
      expect: { ...SCENARIO.expect, terminal: "verified-done" },
    }).success, false);
    assert.equal(ScenarioManifestSchema.safeParse({
      ...SCENARIO,
      requiredAssertions: ["blocks-executor", "blocks-executor"],
    }).success, false);
  });

  it("keeps active knowledge and verified fixes evidence-backed", () => {
    const knowledge = {
      id: UUID_1,
      status: "active",
      scope: { system: "ucpath", element: "ucpath.person-search.submit" },
      title: "Person search state",
      symptom: "Search appears loaded but controls are absent",
      trigger: "Page transition races the content frame",
      rootCause: "The ready state omitted the content-frame condition",
      invariant: "Search actions require the registered ready state",
      fix: "Include the content-frame condition in the page-state recipe",
      regressionScenarios: ["ucpath/person-search-frame-race"],
      evidence: [EVIDENCE_REF],
      verifiedAt: INSTANT,
      sourceCommits: ["abcdef1"],
    };
    assert.equal(KnowledgeRecordSchema.safeParse(knowledge).success, true);
    assert.equal(KnowledgeRecordSchema.safeParse({ ...knowledge, verifiedAt: undefined }).success, false);
    assert.equal(KnowledgeRecordSchema.safeParse({ ...knowledge, scope: { unexpected: "value" } }).success, false);

    const verifiedFix = {
      id: UUID_5,
      failureFingerprint: FAILURE_FINGERPRINT,
      status: "verified",
      requestedBy: "codex",
      summary: "Close the page-state race",
      affected: ["ucpath/search-person", "ucpath.person-search.submit"],
      files: ["src/stores/ucpath/driver/person-search.ts"],
      scenarios: ["ucpath/person-search-frame-race"],
      verification: [EVIDENCE_REF],
      commit: "abcdef1",
      knowledge: [UUID_1],
      createdAt: INSTANT,
    };
    assert.equal(FixRecordSchema.safeParse(verifiedFix).success, true);
    assert.equal(FixRecordSchema.safeParse({ ...verifiedFix, commit: undefined }).success, false);
    assert.equal(FixRecordSchema.safeParse({ ...verifiedFix, verification: [] }).success, false);
    assert.equal(FixRecordSchema.safeParse({
      ...verifiedFix,
      status: "draft",
      verification: [],
      commit: undefined,
      unexpected: true,
    }).success, false);
  });
});
