import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { z } from "zod";
import { BoundaryFailureSchema } from "../../../src/domain/boundary-failure.js";
import { manualClock } from "../../../src/domain/clock.js";
import {
  CONFIG_ENV_BINDINGS,
  ConfigEnvBindingRegistrySchema,
  ResolvedConfigSchema,
  resolveConfigWithProvenance,
} from "../../../src/domain/config/resolve.js";
import { ConfigSchema, SettingsOverrideSchema } from "../../../src/domain/config/schema.js";
import { ArtifactRefWireSchema, ArtifactResourceWireSchema, CapturePointerWireSchema } from "../../../src/domain/dashboard/artifacts.js";
import { FrontendBootstrapWireSchema } from "../../../src/domain/dashboard/bootstrap.js";
import { DashboardDayWireSchema } from "../../../src/domain/dashboard/projection.js";
import { RunDetailSectionResponseSchema, RunDetailWireSchema } from "../../../src/domain/dashboard/run-detail.js";
import { DashboardStreamEnvelopeSchema, DashboardTopicPatchSchema, DashboardTopicSnapshotSchema } from "../../../src/domain/dashboard/subscription.js";
import {
  buildPreflightReport,
  PreflightObservationSchema,
  PreflightReportSchema,
  PreflightResultSchema,
  requiredPreflightChecks,
} from "../../../src/domain/preflight.js";
import { ClassifiedDiagnosticValueSchema, RedactionResultSchema } from "../../../src/domain/redaction.js";
import { RUNTIME_DEPENDENCY_REGISTRY, RuntimeDependencyRegistrySchema } from "../../../src/domain/runtime-dependencies.js";
import { RUNTIME_ENVIRONMENT_REGISTRY, RuntimeEnvironmentRegistrySchema } from "../../../src/domain/runtime-environment.js";
import {
  SECRET_FAMILY_SPECS,
  SECRET_FILE_SPECS,
  SECRET_SPECS,
  SecretFamilySpecSchema,
  SecretFileSpecSchema,
  SecretAvailabilitySchema,
  SecretSpecSchema,
} from "../../../src/domain/secrets.js";
import { DiagnosticBundleSchema } from "../../../src/domain/trust/diagnostic.js";
import {
  ActionEvidenceSchema,
  DecisionEvidenceSchema,
  EvidenceFactSchema,
  ReuseEvidenceSchema,
  RunEvidenceReceiptSchema,
  UncertaintyEvidenceSchema,
  VerificationEvidenceSchema,
} from "../../../src/domain/trust/evidence.js";
import { FailureRecordSchema } from "../../../src/domain/trust/failure.js";
import { FixRecordSchema, KnowledgeRecordSchema } from "../../../src/domain/trust/knowledge.js";
import { PREFLIGHT_SCENARIO_MANIFESTS } from "../../../src/domain/trust/preflight-scenarios.js";
import { ScenarioManifestSchema } from "../../../src/domain/trust/scenario.js";
import { gitVisibleFiles, REPO_ROOT } from "./helpers/guard-files.js";

const UUID_1 = "11111111-1111-4111-8111-111111111111";
const UUID_2 = "22222222-2222-4222-8222-222222222222";
const UUID_3 = "33333333-3333-4333-8333-333333333333";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const NOW = "2026-07-31T17:00:00.000Z";
const CLOCK = manualClock(new Date("2026-07-31T10:00:00-07:00"));

const FAILURE = {
  failureId: UUID_1, fingerprint: HASH_B, runId: UUID_2, traceId: "on-120000-2222", attempt: 1,
  workflowId: "onboarding", nodeId: "search-person", taskId: "ucpath/search-person",
  code: "UNEXPECTED_PAGE_STATE", summary: "Expected state did not render", transient: false,
  writeState: "not-attempted",
  causeChain: [{ code: "UNEXPECTED_PAGE_STATE", summary: "Page mismatch", role: "primary", transient: false }],
  remediation: [{ kind: "code-change", message: "Repair the state recipe" }], occurredAt: NOW,
};

const RECEIPT = {
  receiptId: UUID_1, runId: UUID_2, traceId: "on-120000-2222", workflowId: "onboarding", attempt: 1,
  generatedAt: NOW, descriptorFingerprint: HASH_A, configFingerprint: HASH_A,
  retryOf: { state: "absent" }, failure: { state: "absent" }, input: [], observations: [], decisions: [],
  actions: [], verification: [{ id: UUID_3, obligation: "run.completed", mandatory: true, verdict: "verified", evidence: [`observation:${UUID_2}`] }],
  output: [], reuse: [], warnings: [], confidence: "verified", result: "verified-done",
};
const EVIDENCE_FACT = {
  id: UUID_1,
  field: "employeeId",
  mandatory: true,
  state: "satisfied",
  source: { kind: "system", taskId: "ucpath/search-person", observedAt: NOW },
  value: { state: "transformed", key: "employeeId", classification: "direct-identifier", transform: "last4", value: "1234" },
};
const DECISION_EVIDENCE = {
  id: UUID_1,
  kind: "identity",
  outcome: "taken",
  reason: "the observed EID matched",
  evidence: [`observation:${UUID_2}`],
};
const ACTION_EVIDENCE = {
  id: UUID_1,
  taskId: "ucpath/search-person",
  kind: "external-read",
  writeState: "not-attempted",
  occurredAt: NOW,
};
const VERIFICATION_EVIDENCE = {
  id: UUID_1,
  obligation: "person.match",
  mandatory: true,
  verdict: "verified",
  evidence: [`observation:${UUID_2}`],
};
const REUSE_EVIDENCE = {
  id: UUID_1,
  kind: "checkpoint",
  source: `observation:${UUID_2}`,
  ageMs: 1_000,
  freshnessLimitMs: 60_000,
};
const UNCERTAINTY_EVIDENCE = {
  id: UUID_1,
  code: "OPTIONAL_FACT_MISSING",
  summary: "an optional note was absent",
  loadBearing: false,
  evidence: [],
};

const KNOWLEDGE = {
  id: UUID_1, status: "active", scope: { system: "ucpath" }, title: "Search state", symptom: "Controls absent",
  trigger: "Frame race", rootCause: "Incomplete state", invariant: "Ready state is complete", fix: "Add condition",
  regressionScenarios: ["ucpath/person-search-frame-race"], evidence: [`observation:${UUID_2}`],
  verifiedAt: NOW, sourceCommits: ["abcdef1"],
};

const FIX = {
  id: UUID_3, failureFingerprint: HASH_B, status: "verified", requestedBy: "codex", summary: "Close race",
  affected: ["ucpath/search-person"], files: ["src/stores/ucpath/driver/person-search.ts"],
  scenarios: ["ucpath/person-search-frame-race"], verification: [`observation:${UUID_2}`], commit: "abcdef1",
  knowledge: [UUID_1], createdAt: NOW,
};

const BOOTSTRAP = {
  wireVersion: 1, appVersion: "1.0.0", descriptorHash: HASH_A, settingsSchemaHash: HASH_B,
  projectionGeneration: 1, actor: { id: "local-operator", label: "Local operator" },
  serverClock: { now: NOW, zone: "America/Los_Angeles" },
  storage: { authority: "healthy", backup: "current", checkedAt: NOW }, workflows: [], workflowCategories: [],
  systemInstances: [], settingsSections: [], featureAvailability: [],
};
const DAY = {
  day: "2026-07-31", descriptorHash: HASH_A, projectionGeneration: 1, snapshotCursor: "pc:1",
  monthCounts: [], workflowCounts: [], statusCounts: [], queueSurfaces: [], workerCards: [], notifications: [],
};
const DETAIL = {
  runId: UUID_1, rowRevision: 1, panelKind: "run",
  header: { runId: UUID_1, traceId: "on-120000-1111", workflowId: "onboarding", actorId: "local-operator", title: "Run", status: "running", attempt: 1 },
  timeline: { events: [] }, gate: { state: "absent", reason: "no gate" },
  outcome: { state: "absent", reason: "active" }, context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 },
  availableSections: ["logs"],
};
const ARTIFACT = { state: "missing", artifactId: UUID_1, reason: "not captured" };
const ARTIFACT_REF = {
  artifactId: UUID_1, sha256: HASH_A, byteLength: 10, sensitivity: "redacted", redaction: "applied",
  mediaKind: "image", mediaType: "image/png", width: 10, height: 10,
};

const requestedCapabilities = ["dashboard.serve"] as const;
const preflightObservations = requiredPreflightChecks(requestedCapabilities).map((check) => ({
  check, state: "healthy" as const, summary: `${check} healthy`,
}));
const PREFLIGHT_REPORT = buildPreflightReport({
  configFingerprint: HASH_A, requestedCapabilities, observations: preflightObservations, clock: CLOCK,
});

interface BoundaryCatalogEntry {
  readonly name: string;
  readonly schema: z.ZodType;
  readonly fixtures: readonly unknown[];
  /** Deliberately dynamic JSON payloads are data records, not typed decision records. */
  readonly openFixturePaths?: readonly string[];
}

const BOUNDARY_SCHEMA_CATALOG: readonly BoundaryCatalogEntry[] = [
  { name: "BoundaryFailure", schema: BoundaryFailureSchema, fixtures: [{ kind: "boundary-failure", source: "config", summary: "invalid config", issues: [{ path: ["urls"], code: "invalid", message: "invalid URL" }] }] },
  { name: "Config", schema: ConfigSchema, fixtures: [ConfigSchema.parse({})] },
  { name: "SettingsOverride", schema: SettingsOverrideSchema, fixtures: [{}] },
  { name: "ResolvedConfig", schema: ResolvedConfigSchema, fixtures: [resolveConfigWithProvenance({}, {}, CLOCK)] },
  { name: "ConfigEnvBindings", schema: ConfigEnvBindingRegistrySchema, fixtures: [CONFIG_ENV_BINDINGS] },
  { name: "ClassifiedDiagnosticValue", schema: ClassifiedDiagnosticValueSchema, fixtures: [{ key: "state", classification: "safe-diagnostic", transform: "allow", value: "healthy" }] },
  { name: "RedactionResult", schema: RedactionResultSchema, fixtures: [{ fields: [], warnings: [] }] },
  { name: "PreflightObservation", schema: PreflightObservationSchema, fixtures: [preflightObservations[0]] },
  { name: "PreflightResult", schema: PreflightResultSchema, fixtures: [PREFLIGHT_REPORT.results[0]] },
  { name: "PreflightReport", schema: PreflightReportSchema, fixtures: [PREFLIGHT_REPORT] },
  { name: "RuntimeEnvironmentRegistry", schema: RuntimeEnvironmentRegistrySchema, fixtures: [RUNTIME_ENVIRONMENT_REGISTRY] },
  { name: "RuntimeDependencyRegistry", schema: RuntimeDependencyRegistrySchema, fixtures: [RUNTIME_DEPENDENCY_REGISTRY] },
  { name: "SecretSpec", schema: SecretSpecSchema, fixtures: [SECRET_SPECS[0]] },
  { name: "SecretFamilySpec", schema: SecretFamilySpecSchema, fixtures: [SECRET_FAMILY_SPECS[0]] },
  { name: "SecretFileSpec", schema: SecretFileSpecSchema, fixtures: [SECRET_FILE_SPECS[0]] },
  { name: "SecretAvailability", schema: SecretAvailabilitySchema, fixtures: [{ name: "ngrokCredential", source: "local-ngrok-config", state: "unknown", diagnostic: "registered source could not be read" }] },
  { name: "ScenarioManifest", schema: ScenarioManifestSchema, fixtures: [PREFLIGHT_SCENARIO_MANIFESTS[0]], openFixturePaths: ["input"] },
  { name: "FailureRecord", schema: FailureRecordSchema, fixtures: [FAILURE] },
  { name: "DiagnosticBundle", schema: DiagnosticBundleSchema, fixtures: [{ bundleId: UUID_1, runId: UUID_2, origin: { kind: "operator-request", requestedBy: "local-operator" }, createdAt: NOW, contentDigest: HASH_A, configFingerprint: HASH_A, descriptorFingerprint: HASH_B, redaction: { fields: [], warnings: [] }, attachments: [], retention: { kind: "pinned", reason: "fix" } }] },
  { name: "EvidenceFact", schema: EvidenceFactSchema, fixtures: [EVIDENCE_FACT] },
  { name: "DecisionEvidence", schema: DecisionEvidenceSchema, fixtures: [DECISION_EVIDENCE] },
  { name: "ActionEvidence", schema: ActionEvidenceSchema, fixtures: [ACTION_EVIDENCE] },
  { name: "VerificationEvidence", schema: VerificationEvidenceSchema, fixtures: [VERIFICATION_EVIDENCE] },
  { name: "ReuseEvidence", schema: ReuseEvidenceSchema, fixtures: [REUSE_EVIDENCE] },
  { name: "UncertaintyEvidence", schema: UncertaintyEvidenceSchema, fixtures: [UNCERTAINTY_EVIDENCE] },
  { name: "RunEvidenceReceipt", schema: RunEvidenceReceiptSchema, fixtures: [RECEIPT] },
  { name: "KnowledgeRecord", schema: KnowledgeRecordSchema, fixtures: [KNOWLEDGE] },
  { name: "FixRecord", schema: FixRecordSchema, fixtures: [FIX] },
  { name: "FrontendBootstrap", schema: FrontendBootstrapWireSchema, fixtures: [BOOTSTRAP] },
  { name: "DashboardDay", schema: DashboardDayWireSchema, fixtures: [DAY] },
  { name: "RunDetail", schema: RunDetailWireSchema, fixtures: [DETAIL] },
  { name: "RunDetailSectionResponse", schema: RunDetailSectionResponseSchema, fixtures: [{ section: "logs", payload: { runId: UUID_1, notes: [], nextCursor: { state: "absent", reason: "end-of-page" } } }] },
  { name: "ArtifactRef", schema: ArtifactRefWireSchema, fixtures: [ARTIFACT_REF] },
  { name: "CapturePointer", schema: CapturePointerWireSchema, fixtures: [{ artifactId: UUID_1, dimensions: { state: "missing", reason: "not captured" } }] },
  { name: "ArtifactResource", schema: ArtifactResourceWireSchema, fixtures: [ARTIFACT] },
  { name: "DashboardTopicSnapshot", schema: DashboardTopicSnapshotSchema, fixtures: [{ topic: "artifact", payload: ARTIFACT }] },
  { name: "DashboardTopicPatch", schema: DashboardTopicPatchSchema, fixtures: [{ topic: "artifact", payload: { operation: "replace-artifact-resource", target: { artifactId: UUID_1 }, replacement: ARTIFACT } }] },
  { name: "DashboardStreamEnvelope", schema: DashboardStreamEnvelopeSchema, fixtures: [{ type: "health", state: "live" }] },
];

interface ZodInternals { readonly _zod: { readonly def: Record<string, unknown> } }

function strictnessViolations(schema: z.ZodType, path = "$", seen = new Set<z.ZodType>()): readonly string[] {
  if (seen.has(schema)) return [];
  seen.add(schema);
  const def = (schema as unknown as ZodInternals)._zod.def;
  const type = def.type;
  if (type === "object") {
    const catchall = def.catchall as ZodInternals | undefined;
    const violations = catchall?._zod.def.type === "never" ? [] : [`${path}: object schema is not strict`];
    const shape = def.shape as Record<string, z.ZodType>;
    return [...violations, ...Object.entries(shape).flatMap(([key, child]) => strictnessViolations(child, `${path}.${key}`, seen))];
  }
  if (type === "union") return (def.options as z.ZodType[]).flatMap((child, index) => strictnessViolations(child, `${path}|${index}`, seen));
  if (type === "array") return strictnessViolations(def.element as z.ZodType, `${path}[]`, seen);
  if (type === "record") return [
    ...strictnessViolations(def.keyType as z.ZodType, `${path}{key}`, seen),
    ...strictnessViolations(def.valueType as z.ZodType, `${path}{value}`, seen),
  ];
  if (type === "lazy") return strictnessViolations((def.getter as () => z.ZodType)(), `${path}<lazy>`, seen);
  if (["optional", "nullable", "default", "readonly", "nonoptional", "catch"].includes(String(type))) {
    return strictnessViolations(def.innerType as z.ZodType, `${path}?`, seen);
  }
  if (type === "pipe") return [
    ...strictnessViolations(def.in as z.ZodType, `${path}<in>`, seen),
    ...strictnessViolations(def.out as z.ZodType, `${path}<out>`, seen),
  ];
  if (type === "intersection") return [
    ...strictnessViolations(def.left as z.ZodType, `${path}&left`, seen),
    ...strictnessViolations(def.right as z.ZodType, `${path}&right`, seen),
  ];
  if (type === "tuple") return [
    ...(def.items as z.ZodType[]).flatMap((child, index) => strictnessViolations(child, `${path}[${index}]`, seen)),
    ...(def.rest ? strictnessViolations(def.rest as z.ZodType, `${path}[...]`, seen) : []),
  ];
  return [];
}

type Segment = string | number;
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function objectPaths(value: unknown, path: readonly Segment[] = []): readonly (readonly Segment[])[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => objectPaths(item, [...path, index]));
  if (!isObject(value)) return [];
  return [path, ...Object.entries(value).flatMap(([key, child]) => objectPaths(child, [...path, key]))];
}
function addUnknown(value: unknown, target: readonly Segment[], depth = 0): unknown {
  if (depth === target.length) return { ...(value as Record<string, unknown>), unexpectedBoundaryKey: true };
  const segment = target[depth];
  if (typeof segment === "number") return (value as unknown[]).map((child, index) => index === segment ? addUnknown(child, target, depth + 1) : child);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) =>
    key === segment ? [key, addUnknown(child, target, depth + 1)] : [key, child]
  ));
}
function pathText(path: readonly Segment[]): string {
  return path.map(String).join(".");
}

const EXPORTED_OPERATIONAL_INTERFACE_ALLOWLIST = new Set([
  "src/core/runtime-composition.ts:RebuildRuntimeStart",
  "src/domain/canonical-json.ts:JsonObject",
  "src/domain/clock.ts:Clock",
  "src/domain/clock.ts:TestClock",
  "src/domain/preflight.ts:BuildPreflightReportInput",
  "src/domain/preflight.ts:PreflightRunner",
  "src/domain/preflight.ts:PreflightRunnerContext",
]);

export function boundarySourceViolations(path: string, content: string): readonly string[] {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isInterfaceDeclaration(node) && node.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)) {
      const identity = `${path}:${node.name.text}`;
      if (!EXPORTED_OPERATIONAL_INTERFACE_ALLOWLIST.has(identity)) violations.push(`${identity}: exported boundary interface has no schema`);
    }
    if (node.kind === ts.SyntaxKind.AnyKeyword) violations.push(`${path}: any is forbidden at a boundary`);
    if (ts.isTypeAliasDeclaration(node) && node.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)
      && !(path === "src/domain/canonical-json.ts" && node.name.text === "JsonValue")) {
      const type = node.type;
      const schemaDerived = ts.isTypeReferenceNode(type) && ts.isQualifiedName(type.typeName)
        && ts.isIdentifier(type.typeName.left) && type.typeName.left.text === "z"
        && ["infer", "input", "output"].includes(type.typeName.right.text);
      if (!schemaDerived) violations.push(`${path}:${node.name.text}: exported boundary type is not schema-derived`);
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === "Record"
      && node.typeArguments?.length === 2) {
      const value = node.typeArguments[1];
      if (value.kind === ts.SyntaxKind.UnknownKeyword
        || ts.isTypeReferenceNode(value) && ts.isIdentifier(value.typeName) && value.typeName.text === "JsonValue") {
        violations.push(`${path}: decision-bearing open Record is forbidden at a boundary`);
      }
    }
    const constAssertion = ts.isAsExpression(node) && ts.isTypeReferenceNode(node.type)
      && ts.isIdentifier(node.type.typeName) && node.type.typeName.text === "const";
    if ((ts.isAsExpression(node) && !constAssertion) || ts.isTypeAssertionExpression(node)) {
      violations.push(`${path}: unchecked type assertion at a boundary`);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const call = node.expression;
      if (ts.isIdentifier(call.expression) && call.expression.text === "z" && call.name.text === "object") {
        violations.push(`${path}: z.object is open; use z.strictObject`);
      }
      if (["passthrough", "strip"].includes(call.name.text)) violations.push(`${path}: ${call.name.text} opens or silently strips a boundary`);
      if (call.name.text === "parse" && node.arguments[0] && ts.isBinaryExpression(node.arguments[0])
        && node.arguments[0].operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
        && ts.isObjectLiteralExpression(node.arguments[0].right)) {
        violations.push(`${path}: parse cannot default malformed boundary input to an empty object`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return violations;
}

describe("strict boundary schemas", () => {
  it("keeps the explicit top-level boundary catalog unique, valid, and recursively strict", () => {
    assert.equal(new Set(BOUNDARY_SCHEMA_CATALOG.map(({ name }) => name)).size, BOUNDARY_SCHEMA_CATALOG.length);
    for (const entry of BOUNDARY_SCHEMA_CATALOG) {
      assert.deepEqual(strictnessViolations(entry.schema), [], entry.name);
      for (const fixture of entry.fixtures) assert.equal(entry.schema.safeParse(fixture).success, true, entry.name);
    }
  });

  it("rejects an unknown key at every exercised nested object boundary", () => {
    for (const entry of BOUNDARY_SCHEMA_CATALOG) for (const fixture of entry.fixtures) {
      const parsed = entry.schema.parse(fixture);
      for (const path of objectPaths(parsed)) {
        const text = pathText(path);
        if (entry.openFixturePaths?.some((open) => text === open || text.startsWith(`${open}.`))) continue;
        assert.equal(entry.schema.safeParse(addUnknown(parsed, path)).success, false,
          `${entry.name} accepted unknown key at ${text || "$"}`);
      }
    }
  });

  it("walks every object arm nested under arrays, unions, lazies, and wrappers", () => {
    const nested = z.lazy(() => z.strictObject({
      entries: z.array(z.union([
        z.strictObject({ kind: z.literal("left"), value: z.strictObject({ label: z.string() }) }),
        z.strictObject({ kind: z.literal("right"), value: z.strictObject({ count: z.number() }) }),
      ])).optional(),
    }));
    assert.deepEqual(strictnessViolations(nested), []);
    assert.notDeepEqual(strictnessViolations(z.lazy(() => z.union([
      z.strictObject({ safe: z.string() }), z.object({ unsafe: z.string() }),
    ]))), []);
    const fixtures = [
      { entries: [{ kind: "left", value: { label: "x" } }] },
      { entries: [{ kind: "right", value: { count: 1 } }] },
    ];
    for (const fixture of fixtures) for (const path of objectPaths(fixture)) {
      assert.equal(nested.safeParse(addUnknown(fixture, path)).success, false);
    }
  });

  it("rejects unschematized interfaces, open schemas, any, assertions, and catch/default parsing", () => {
    const fixture = [
      "export interface DurableThing { value: any }",
      "export const Schema = z.object({ value: z.string() }).passthrough();",
      "export const value = input as DurableThing;",
      "export const parsed = Schema.parse(input ?? {});",
    ].join("\n");
    assert.equal(boundarySourceViolations("src/domain/new-boundary.ts", fixture).length >= 5, true);
  });

  it("keeps every current domain boundary source free of unsafe escape hatches", () => {
    const violations = gitVisibleFiles(["src/domain", "src/core/runtime-composition.ts"])
      .filter((path) => path.endsWith(".ts"))
      .flatMap((path) => boundarySourceViolations(path, readFileSync(join(REPO_ROOT, path), "utf8")));
    assert.deepEqual(violations, []);
  });
});
