import { z } from "zod";
import {
  ElementIdSchema,
  EvidenceRefSchema,
  FailureFingerprintSchema,
  FixIdSchema,
  IsoInstantSchema,
  KnowledgeIdSchema,
  PageStateIdSchema,
  ScenarioIdSchema,
  SystemIdSchema,
  TaskIdSchema,
  WorkflowIdSchema,
} from "../../rules/identity/ids.js";

const KnowledgeScopeSchema = z.strictObject({
  system: SystemIdSchema.optional(),
  workflow: WorkflowIdSchema.optional(),
  task: TaskIdSchema.optional(),
  element: ElementIdSchema.optional(),
  pageState: PageStateIdSchema.optional(),
}).superRefine((scope, context) => {
  if (Object.keys(scope).length === 0) context.addIssue({ code: "custom", message: "knowledge scope cannot be empty" });
});

export const KnowledgeRecordSchema = z.strictObject({
  id: KnowledgeIdSchema,
  status: z.enum(["active", "superseded", "retired", "unverified"]),
  scope: KnowledgeScopeSchema,
  title: z.string().min(1),
  symptom: z.string().min(1),
  trigger: z.string().min(1),
  rootCause: z.string().min(1),
  invariant: z.string().min(1),
  fix: z.string().min(1),
  regressionScenarios: z.array(ScenarioIdSchema).min(1),
  evidence: z.array(EvidenceRefSchema).min(1),
  verifiedAt: IsoInstantSchema.optional(),
  supersedes: z.array(KnowledgeIdSchema).min(1).optional(),
  sourceCommits: z.array(z.string().regex(/^[0-9a-f]{7,64}$/)).min(1).optional(),
}).superRefine((record, context) => {
  if (new Set(record.regressionScenarios).size !== record.regressionScenarios.length) {
    context.addIssue({ code: "custom", path: ["regressionScenarios"], message: "regression scenarios must be unique" });
  }
  if (record.status === "active" && record.verifiedAt === undefined) {
    context.addIssue({ code: "custom", path: ["verifiedAt"], message: "active knowledge requires verification time" });
  }
  if (record.status === "superseded" && record.supersedes === undefined) {
    context.addIssue({ code: "custom", path: ["supersedes"], message: "superseded knowledge must name related prior knowledge" });
  }
});

export const FixRecordSchema = z.strictObject({
  id: FixIdSchema,
  failureFingerprint: FailureFingerprintSchema.optional(),
  status: z.enum(["draft", "verified"]),
  requestedBy: z.enum(["operator", "codex", "claude"]),
  summary: z.string().min(1),
  affected: z.array(z.union([TaskIdSchema, WorkflowIdSchema, ElementIdSchema, PageStateIdSchema])).min(1),
  files: z.array(z.string().regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/)).min(1),
  scenarios: z.array(ScenarioIdSchema).min(1),
  verification: z.array(EvidenceRefSchema),
  commit: z.string().regex(/^[0-9a-f]{7,64}$/).optional(),
  knowledge: z.array(KnowledgeIdSchema).min(1).optional(),
  createdAt: IsoInstantSchema,
}).superRefine((record, context) => {
  for (const [path, values] of [["files", record.files], ["scenarios", record.scenarios]] as const) {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", path: [path], message: `${path} must be unique` });
    }
  }
  if (record.status === "verified") {
    if (record.commit === undefined) context.addIssue({ code: "custom", path: ["commit"], message: "verified fixes require a commit" });
    if (record.verification.length === 0) context.addIssue({ code: "custom", path: ["verification"], message: "verified fixes require evidence" });
  } else if (record.commit !== undefined || record.verification.length > 0) {
    context.addIssue({ code: "custom", message: "draft fixes cannot claim commit or verification evidence" });
  }
});

export type KnowledgeRecord = z.infer<typeof KnowledgeRecordSchema>;
export type FixRecord = z.infer<typeof FixRecordSchema>;
