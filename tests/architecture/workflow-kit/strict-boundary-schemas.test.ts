import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { z } from "zod";
import { gitVisibleFiles, REPO_ROOT } from "../support/helpers/guard-files.js";
import { BOUNDARY_SCHEMA_FIXTURES } from "./boundary-schema-fixtures.js";
import { assertDiscoveredBoundarySchemasAreStrict, strictnessViolations } from "./boundary-schema-scan.js";

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
  // These relocated pure modules expose in-process repository and schema-walk
  // shapes. Durable event and validation values retain their own schemas.
  "src/models/events/timeline.ts:TimelineRepository",
  "src/models/validation/contract-boundary.ts:ContractSchemaLeaf",
  "src/models/validation/proof-shape.ts:ProofShapeField",
  "src/models/validation/proof-shape.ts:ProofShape",
  "src/models/validation/rerun-values.ts:RerunMappingView",
  "src/models/validation/schema-path.ts:ResolvedSchemaPath",
  "src/models/validation/schema-path.ts:SchemaPathFailure",
  // In-process transaction/reader methods, not wire data. Their values and receipts are strict schemas.
  // In-process credential authority port: methods consume and return schema-derived data.
  "src/models/config/credential-store.ts:CredentialStore",
  "src/backend/app/composition/runtime-composition.ts:RebuildRuntimeStart",
  // The dashboard composition seam handed to the CLI (1g): a process-lifetime
  // handle (port + stop), operational like RebuildRuntimeStart, not wire data.
  "src/backend/app/composition/runtime-composition.ts:RunningDashboard",
  // The injected subscription function and disposer remain in-process and cannot be schema-described.
  "src/backend/app/composition/runtime-composition.ts:RuntimeShutdownSignals",
  "src/rules/validation/canonical-json.ts:JsonObject",
  "src/rules/time/clock.ts:Clock",
  "src/rules/time/clock.ts:TestClock",
  // The id source is injected exactly like the clock, and for the same reason:
  // a value the caller cannot pin makes a durable record unassertable.
  "src/rules/identity/identifiers.ts:IdFactory",
  "src/models/preflight/preflight.ts:BuildPreflightReportInput",
  // The deadline scheduler is an injected process-timer surface: it carries
  // callbacks and cancellation functions, never durable or wire data.
  "src/models/preflight/preflight.ts:PreflightDeadlineHandle",
  "src/models/preflight/preflight.ts:PreflightDeadlineScheduler",
  "src/models/preflight/preflight.ts:PreflightRunner",
  // In-process admission capability consumes a strict retained preflight report.
  "src/rules/preflight/preflight-admission.ts:PreflightAdmission",
  "src/models/preflight/preflight.ts:PreflightRunnerContext",

  "src/models/workflow/node-condition.ts:NodeConditionOperandSpec",
  "src/models/workflow/node-condition.ts:NodeConditionSpec",
  "src/models/ui/driver.ts:MutationCapability",
  "src/models/ui/driver.ts:CommitCapableSystemDriver",
  "src/models/ui/driver.ts:SystemDriver",
  "src/models/ui/ucpath-person-org.ts:UcpathPersonOrgScreens",
  "src/models/ui/ucpath-person-org.ts:UcpathPersonOrgStates",
  "src/models/ui/ucpath-person-org.ts:UcpathPersonOrgFields",
  "src/models/ui/ucpath-person-org.ts:UcpathPersonOrgObservations",
  "src/models/ui/ucpath-person-org.ts:UcpathPersonOrgDriver",

  "src/models/ui/ucpath-smart-hr-termination.ts:UcpathSmartHrScreens",
  "src/models/ui/ucpath-smart-hr-termination.ts:UcpathSmartHrStates",
  "src/models/ui/ucpath-smart-hr-termination.ts:UcpathSmartHrObservations",
  "src/models/ui/ucpath-smart-hr-termination.ts:UcpathSmartHrTerminationDriver",

  "src/models/ui/ucpath-emergency-contact.ts:UcpathEmergencyContactDriver",
  "src/models/ui/ucpath-emergency-contact.ts:UcpathContactObservations",
  "src/models/ui/ucpath-driver.ts:UcpathStoreDriver",
  "src/models/task/task-contract.ts:ReadTaskContract",
  "src/models/task/task-contract.ts:PrepareTaskContract",
  "src/models/task/task-contract.ts:CommitTaskContract",
  "src/models/task/task-contract.ts:SealedReadContract",
  "src/models/task/task-contract.ts:SealedPrepareContract",
  "src/models/task/task-contract.ts:SealedCommitContract",
  "src/models/task/task-contract.ts:AnyReadTaskContract",
  "src/models/task/task-contract.ts:AnyPrepareTaskContract",
  "src/models/task/task-contract.ts:AnyCommitTaskContract",
  "src/models/task/task-contract.ts:AnyTaskContract",
  "src/models/task/write-safety.ts:CanonicalJsonSchema",
  "src/models/task/write-safety.ts:ProbeVerdict",
  "src/models/task/write-safety.ts:ProofCheck",
  "src/models/task/write-safety.ts:ReceiptCheck",
  "src/models/task/write-safety.ts:SaveVerifyCheck",
  "src/models/task/write-safety.ts:UploadVerifyCheck",
  "src/models/task/write-safety.ts:CompletionCheck",
  "src/models/task/write-safety.ts:Idempotency",
  "src/models/task/write-safety.ts:WriteSafety",
  "src/rules/identity/ids.ts:LiteralTaskId",
  "src/models/sessions/session.ts:SessionNeed",
  // Graph bind, choose and resolve functions are generic in-process values; crossing data uses strict schemas.
  "src/models/workflow/canonical-input.ts:CanonicalInputSchema",

  "src/models/config/test-data.ts:TestDataLocalInputEntry",
  "src/models/config/test-data.ts:TestDataInputSource",
  "src/models/workflow/graph.ts:ProofOf",
  "src/models/workflow/graph.ts:WorkflowRef",
  "src/models/workflow/graph.ts:AnyWorkflowRef",
  "src/models/workflow/graph.ts:RuntimeScope",
  "src/models/workflow/graph.ts:WorkflowGateSource",
  "src/models/workflow/graph.ts:ExternalGateSource",
  "src/models/workflow/graph.ts:GraphNodeBase",
  "src/models/workflow/graph.ts:TaskStepNode",
  "src/models/workflow/graph.ts:TypedTransactionOutcome",
  "src/models/workflow/graph.ts:TransactionNode",
  "src/models/workflow/graph.ts:BranchNode",
  "src/models/workflow/graph.ts:ParallelNode",
  "src/models/workflow/graph.ts:ChildRunOutcome",
  "src/models/workflow/graph.ts:ChildRunNode",
  "src/models/workflow/graph.ts:OperatorGateNode",
  "src/models/workflow/graph.ts:ChildrenGateNode",
  "src/models/workflow/graph.ts:ExternalGateNode",
  "src/models/workflow/graph.ts:AnyGateNode",
  "src/models/workflow/graph.ts:RuntimeFlowNode",
  // Fan-out plans are generic in-process values; their durable manifests are schema-bound.
  "src/models/workflow/delegation.ts:PlannedChild",
  "src/models/workflow/delegation.ts:DelegationPlan",
  "src/models/workflow/delegation.ts:DelegationFanOutRequest",
  "src/models/workflow/delegation.ts:DelegationJoin",
  // Completion programs carry in-process derivation functions; crossing values remain schema-bound.
  "src/models/workflow/completion.ts:NamedPredicate",
  "src/models/workflow/completion.ts:PerRecordStage",
  "src/models/workflow/completion.ts:PerDocumentStage",
  "src/models/workflow/completion.ts:AnyFanOutStage",
  "src/models/workflow/completion.ts:FanOutStages",
  "src/models/workflow/completion.ts:StagedFanOut",
  "src/models/workflow/completion.ts:CompleteThenEnqueue",
  "src/models/workflow/completion.ts:CompletionProgram",
  "src/models/workflow/completion.ts:CompletionRevealKey",
  "src/models/workflow/completion.ts:SealedCompletionProgram",
  // Checkpoint load results are generic over the producing output schema.
  "src/models/workflow/checkpoint.ts:CheckpointLoad",
  "src/models/workflow/checkpoint.ts:ReplayedCheckpoint",
  "src/models/workflow/checkpoint.ts:FreshnessWalkInput",
  // Canonical fields carry coercion functions and their own schema, so no static data schema describes them.
  "src/models/fields/registry.ts:CanonicalField",
  "src/models/fields/cell-coercion.ts:CellLocation",
  // Intake projections carry a live schema and lookup function; their durable representation is schema-bound.
  "src/models/intake/projection.ts:IntakeProjection",
  // Validation inputs carry derivation functions and are consumed in-process.
  "src/models/intake/validate.ts:IntakeValidationInput",
  "src/models/intake/validate.ts:ValidatedRow",
  "src/models/intake/validate.ts:IntakeValidationResult",

  "src/models/intake/enqueue.ts:IntakeEnqueueSessionView",
  "src/models/intake/enqueue.ts:IntakeEnqueuePlan",
  "src/models/intake/enqueue.ts:IntakeEnqueuePlanInput",
  // Omission declarations carry producer functions and plans use Maps; crossing values have strict schemas.
  "src/models/workflow/step-omission.ts:StepOmissionProduceContext",
  "src/models/workflow/step-omission.ts:StepManualDeclaration",
  "src/models/workflow/step-omission.ts:StepOmissionSpec",
  "src/models/workflow/step-omission.ts:StepOmissionGraphView",
  "src/models/workflow/step-omission.ts:StepOmissionRefusal",
  "src/models/workflow/step-omission.ts:StepOmissionPlan",
  "src/models/workflow/step-omission.ts:StepOmissionCascadeRow",
]);

// These four existing pure implementations inspect Zod internals or freeze a
// generic result; their assertions do not admit unschematized boundary data.
const ZOD_INTROSPECTION_IMPLEMENTATIONS = new Set([
  "src/models/validation/canonical-input-schema.ts",
  "src/models/validation/contract-boundary.ts",
  "src/models/validation/proof-shape.ts",
  "src/models/validation/schema-path.ts",
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
    if (ts.isTypeAliasDeclaration(node) && node.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)) {
      const identity = `${path}:${node.name.text}`;
      const type = node.type;
      const schemaDerived = ts.isTypeReferenceNode(type) && ts.isQualifiedName(type.typeName)
        && ts.isIdentifier(type.typeName.left) && type.typeName.left.text === "z"
        && ["infer", "input", "output"].includes(type.typeName.right.text);
      if (!schemaDerived && !EXPORTED_OPERATIONAL_INTERFACE_ALLOWLIST.has(identity)
        && !(path === "src/rules/validation/canonical-json.ts" && node.name.text === "JsonValue")) {
        violations.push(`${identity}: exported boundary type is not schema-derived`);
      }
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === "Record"
      && node.typeArguments?.length === 2) {
      const value = node.typeArguments[1];
      const proofShapeIntrospection = path === "src/models/validation/proof-shape.ts"
        && node.typeArguments[0]?.kind === ts.SyntaxKind.StringKeyword
        && value.kind === ts.SyntaxKind.UnknownKeyword;
      if (!proofShapeIntrospection && (value.kind === ts.SyntaxKind.UnknownKeyword
        || ts.isTypeReferenceNode(value) && ts.isIdentifier(value.typeName) && value.typeName.text === "JsonValue")) {
        violations.push(`${path}: decision-bearing open Record is forbidden at a boundary`);
      }
    }
    const constAssertion = ts.isAsExpression(node) && ts.isTypeReferenceNode(node.type)
      && ts.isIdentifier(node.type.typeName) && node.type.typeName.text === "const";
    if (!ZOD_INTROSPECTION_IMPLEMENTATIONS.has(path)
      && ((ts.isAsExpression(node) && !constAssertion) || ts.isTypeAssertionExpression(node))) {
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
  it("keeps discovered boundary schemas recursively strict", assertDiscoveredBoundarySchemasAreStrict);

  it("keeps boundary fixture names unique", () => {
    assert.equal(new Set(BOUNDARY_SCHEMA_FIXTURES.map(({ name }) => name)).size, BOUNDARY_SCHEMA_FIXTURES.length);
  });

  for (const entry of BOUNDARY_SCHEMA_FIXTURES) for (const [index, fixture] of entry.fixtures.entries()) {
    it(`parses and checks unknown keys: ${entry.name} fixture ${index}`, () => {
      const parsed = entry.schema.parse(fixture);
      const paths = objectPaths(parsed).filter(path => {
        const text = pathText(path);
        return !entry.openFixturePaths?.some(open => text === open || text.startsWith(`${open}.`));
      });
      for (const path of paths) {
        const text = pathText(path);
        assert.equal(entry.schema.safeParse(addUnknown(parsed, path)).success, false,
          `${entry.name} accepted unknown key at ${text || "$"}`);
      }
    });
  }

  it("walks every object arm nested under arrays, unions, lazies, and wrappers", () => {
    const nested = z.lazy(() => z.strictObject({
      entries: z.array(z.union([
        z.strictObject({ kind: z.literal("left"), value: z.strictObject({ label: z.string() }) }),
        z.strictObject({ kind: z.literal("right"), value: z.strictObject({ count: z.number() }) }),
      ])).optional(),
    }));
    assert.deepEqual(strictnessViolations(nested), []);
    assert.deepEqual(strictnessViolations(z.lazy(() => z.union([
      z.strictObject({ safe: z.string() }), z.object({ unsafe: z.string() }),
    ]))), ["$<lazy>|1"]);
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


  it("keeps relocated validation classifications exact to their reviewed files and types", () => {
    const path = "src/domain/validation/new-boundary.ts";
    const source = [
      "export interface TimelineRepository { read(): unknown }",
      "export interface ContractSchemaLeaf { value: string }",
      "export type ProofShapeField = { value: string };",
      "export type ProofShape = { value: string };",
      "export interface RerunMappingView { value: string }",
      "export interface ResolvedSchemaPath { value: string }",
      "export type SchemaPathFailure = { value: string };",
      "export const inspected = raw as Record<string, unknown>;",
      "export const anything: any = inspected;",
      "export const open = z.object({ value: z.string() });",
      "export const parsed = open.parse(input ?? {});",
    ].join("\n");
    const violations = boundarySourceViolations(path, source);
    for (const name of ["TimelineRepository", "ContractSchemaLeaf", "ProofShapeField", "ProofShape",
      "RerunMappingView", "ResolvedSchemaPath", "SchemaPathFailure"]) {
      assert.ok(violations.some((violation) => violation.includes(`${path}:${name}:`)), name);
    }
    for (const rule of ["unchecked type assertion", "decision-bearing open Record", "any is forbidden",
      "z.object is open", "parse cannot default malformed boundary input"]) {
      assert.ok(violations.some((violation) => violation.includes(rule)), rule);
    }
    assert.ok(boundarySourceViolations("src/models/validation/proof-shape.ts",
      "export const dynamic = input as Record<string, JsonValue>;")
      .some((violation) => violation.includes("decision-bearing open Record")));
  });

  it("keeps every current domain boundary source free of unsafe escape hatches", () => {
    const violations = gitVisibleFiles(["src/domain", "src/backend/app/composition/runtime-composition.ts"])
      .filter((path) => path.endsWith(".ts"))
      .flatMap((path) => boundarySourceViolations(path, readFileSync(join(REPO_ROOT, path), "utf8")));
    assert.deepEqual(violations, []);
  });
});
