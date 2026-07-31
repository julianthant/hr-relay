import { z } from "zod";
import { JsonValueSchema } from "../canonical-json.js";
import {
  FailureFingerprintSchema,
  FingerprintSchema,
  FixIdSchema,
  FixtureRefSchema,
  KnowledgeIdSchema,
  NodeIdSchema,
  ScenarioAssertionIdSchema,
  ScenarioIdSchema,
  TaskIdSchema,
  WorkflowIdSchema,
} from "../ids.js";

export const ScenarioScopeSchema = z.strictObject({
  runtime: z.literal("preflight").optional(),
  taskId: TaskIdSchema.optional(),
  workflowId: WorkflowIdSchema.optional(),
  nodeId: NodeIdSchema.optional(),
}).superRefine((scope, context) => {
  if (scope.runtime === undefined && scope.taskId === undefined && scope.workflowId === undefined) {
    context.addIssue({ code: "custom", message: "scenario scope requires runtime, task, or workflow ownership" });
  }
  if (scope.runtime !== undefined && (scope.taskId !== undefined || scope.workflowId !== undefined || scope.nodeId !== undefined)) {
    context.addIssue({ code: "custom", message: "runtime scenarios cannot also claim task/workflow scope" });
  }
  if (scope.nodeId !== undefined && scope.workflowId === undefined) {
    context.addIssue({ code: "custom", path: ["nodeId"], message: "node-scoped scenarios require a workflow" });
  }
});

export const ScenarioInjectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("clock-advance"), wallMs: z.number().int().nonnegative(), monotonicMs: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal("task-failure"), taskId: TaskIdSchema, code: z.string().regex(/^[A-Z][A-Z0-9_]*$/), occurrence: z.number().int().positive() }),
  z.strictObject({ kind: z.literal("page-state"), state: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), occurrence: z.number().int().positive() }),
  z.strictObject({ kind: z.literal("cancel"), afterAssertion: ScenarioAssertionIdSchema }),
  z.strictObject({ kind: z.literal("storage-fault"), fault: z.enum(["disk-full", "corrupt-db", "missing-wal", "torn-wal"]) }),
]);

export const ScenarioExpectationSchema = z.strictObject({
  terminal: z.enum(["verified-done", "done-with-warnings", "failed", "cancelled", "partial", "parked"]),
  actionCount: z.number().int().nonnegative(),
  externalCommitCount: z.number().int().nonnegative(),
  requiredEvidence: z.array(z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/)),
  failureCode: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("absent") }),
    z.strictObject({ state: z.literal("present"), value: z.string().regex(/^[A-Z][A-Z0-9_]*$/) }),
  ]),
}).superRefine((expectation, context) => {
  if (expectation.externalCommitCount > expectation.actionCount) {
    context.addIssue({ code: "custom", path: ["externalCommitCount"], message: "external commits cannot exceed all actions" });
  }
  const failed = expectation.terminal === "failed" || expectation.terminal === "parked";
  if (failed !== (expectation.failureCode.state === "present")) {
    context.addIssue({ code: "custom", path: ["failureCode"], message: "failed or parked expectations require a failure code, and other outcomes forbid one" });
  }
});

export const ScenarioManifestSchema = z.strictObject({
  id: ScenarioIdSchema,
  title: z.string().min(1),
  scope: ScenarioScopeSchema,
  kind: z.enum([
    "happy", "expected-absence", "schema-failure", "unexpected-state", "wrong-subject",
    "transient", "permanent", "timeout", "cancel", "parallel", "branch", "gate",
    "delegation", "command", "proof", "crash", "recovery", "storage",
  ]),
  fixture: FixtureRefSchema,
  input: JsonValueSchema,
  injections: z.array(ScenarioInjectionSchema),
  expect: ScenarioExpectationSchema,
  contractFingerprint: FingerprintSchema,
  requiredAssertions: z.array(ScenarioAssertionIdSchema).min(1),
  source: z.strictObject({
    failureFingerprint: FailureFingerprintSchema.optional(),
    knowledgeId: KnowledgeIdSchema.optional(),
    fixId: FixIdSchema.optional(),
  }).superRefine((source, context) => {
    if (source.failureFingerprint === undefined && source.knowledgeId === undefined && source.fixId === undefined) {
      context.addIssue({ code: "custom", message: "scenario source cannot be empty" });
    }
  }).optional(),
}).superRefine((scenario, context) => {
  if (new Set(scenario.requiredAssertions).size !== scenario.requiredAssertions.length) {
    context.addIssue({ code: "custom", path: ["requiredAssertions"], message: "scenario assertions must be unique" });
  }
});

export type ScenarioManifest = z.infer<typeof ScenarioManifestSchema>;
