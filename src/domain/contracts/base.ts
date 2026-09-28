import { z } from "zod";
import { canonicalJsonStringify } from "../canonical-json.js";
import {
  BrowserSystemIdSchema,
  ObservationIdSchema,
  ProviderCapabilityIdSchema,
  ScenarioIdSchema,
  ServiceSystemIdSchema,
  TaskIdSchema,
} from "../ids.js";
import type { TaskId } from "../ids.js";
import { SecretNameSchema } from "../secret-names.js";
import {
  UNSCOPED_COMMIT_REASON_REGISTRY,
  UnscopedCommitReasonIdSchema,
} from "../unscoped-commit.js";
import { NegativeSettlementPolicySchema, probeVerdictSchema } from "../write-safety-primitives.js";
import {
  assertContractBoundarySchema,
  assertSchemaOwnsPath,
  sealDeclarativeMetadata,
} from "../../validation/contract-boundary.js";
import { assertTaskOperationDeclaration } from "../workflow/operation-display.js";
import type { TaskOperationDeclaration } from "../workflow/operation-display.js";
import {
  REVIEWED_UNVERIFIABLE_BY_PAGE_POLICY,
  ReadTaskReferenceSchema,
  WriteSafetyRuntimeSchema,
} from "./write-safety.js";
import type { CanonicalJsonSchema, ReadTaskReference, WriteSafety } from "./write-safety.js";

export {
  BrowserSystemIdSchema,
  ProviderCapabilityIdSchema,
  ServiceSystemIdSchema,
  TaskIdSchema,
} from "../ids.js";
export type {
  BrowserSystemId,
  ProviderCapabilityId,
  ServiceSystemId,
  TaskId,
  TaskStoreId,
} from "../ids.js";
export { auditContractBoundarySchema } from "../../validation/contract-boundary.js";

export const TaskEffectSchema = z.enum(["read", "prepare", "commit"]);
export const TaskErrorCodeSchema = z.string().regex(
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
  "task error code must be kebab-case",
);
export const ContractFieldPathSchema = z.string().regex(
  /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/,
  "contract field path must be a dot-delimited object path",
).brand<"ContractFieldPath">();
export const FreshnessLimitSchema = z.union([
  z.number().int().nonnegative().finite(),
  z.literal(Number.POSITIVE_INFINITY),
]);
export const FreshnessPolicySchema = z.strictObject({
  defaultMaxAgeMs: FreshnessLimitSchema,
  defaultOverride: z.enum(["forbidden", "audited"]).optional(),
  byField: z.array(z.strictObject({
    path: ContractFieldPathSchema,
    maxAgeMs: FreshnessLimitSchema,
    override: z.enum(["forbidden", "audited"]).optional(),
  })).optional(),
});
export const ProvenancePolicySchema = z.strictObject({
  default: z.enum(["live", "derived"]),
  byField: z.array(z.strictObject({
    path: ContractFieldPathSchema,
    source: z.enum(["live", "derived"]),
  })).optional(),
}).superRefine((policy, context) => {
  const seen = new Map<string, "live" | "derived">();
  for (const [index, rule] of (policy.byField ?? []).entries()) {
    const previous = seen.get(rule.path);
    if (previous !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["byField", index, "path"],
        message: previous === rule.source
          ? `duplicate provenance rule for ${rule.path}`
          : `conflicting provenance rules for ${rule.path}: ${previous} and ${rule.source}`,
      });
    } else {
      seen.set(rule.path, rule.source);
    }
  }
});
export const SubjectBindingSpecSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("none"),
    reason: z.string().min(1).optional(),
    reviewedReasonId: UnscopedCommitReasonIdSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("person"),
    expected: z.strictObject({
      fromInput: ContractFieldPathSchema,
      identity: z.enum(["eid", "name", "eid-and-name"]),
    }),
    observe: ObservationIdSchema,
    match: z.enum(["normalized-exact-eid", "normalized-exact-name", "eid-and-name"]),
    requiredAt: z.enum(["before-subject-read", "after-prepare-before-fence"]),
  }),
  z.strictObject({
    kind: z.literal("artifact"),
    expected: z.strictObject({
      fromInput: ContractFieldPathSchema,
      identity: z.enum(["artifact-id", "sha256", "document-id"]),
    }),
    observe: ObservationIdSchema,
    match: z.literal("exact"),
    requiredAt: z.enum(["before-subject-read", "after-prepare-before-fence"]),
  }),
]);
export const TaskContractResolutionCorpusSchema = z.strictObject({
  scenarioIds: z.array(ScenarioIdSchema),
  tasks: z.array(z.strictObject({
    id: TaskIdSchema,
    effect: TaskEffectSchema,
  })),
});

export type TaskEffect = z.infer<typeof TaskEffectSchema>;
export type TaskErrorCode = z.infer<typeof TaskErrorCodeSchema>;
export type ContractFieldPath = z.infer<typeof ContractFieldPathSchema>;
export type FreshnessPolicy = z.infer<typeof FreshnessPolicySchema>;
export type ProvenancePolicy = z.infer<typeof ProvenancePolicySchema>;
export type SubjectBindingSpec = z.infer<typeof SubjectBindingSpecSchema>;
export type TaskContractResolutionCorpus = z.infer<typeof TaskContractResolutionCorpusSchema>;

type ErrorCodes = readonly [string, ...string[]];
interface TaskContractBase<
  Id extends TaskId,
  Input extends z.ZodType,
  Output extends z.ZodType,
  Codes extends ErrorCodes,
> {
  readonly id: Id;
  readonly title: string;
  readonly input: Input;
  readonly output: CanonicalJsonSchema<Output>;
  readonly errorCodes: Codes;
  readonly requires?: readonly z.input<typeof SecretNameSchema>[];
  readonly providers?: readonly z.input<typeof ProviderCapabilityIdSchema>[];
  readonly subject: SubjectBindingSpec;
  readonly scenarios: readonly z.input<typeof ScenarioIdSchema>[];
  readonly example: z.input<Output>;
  /** Bundle-safe reusable action structure, when this task participates in complete display format v1. */
  readonly operation?: TaskOperationDeclaration;
}

export interface ReadTaskContract<
  Id extends TaskId,
  Input extends z.ZodType,
  Output extends z.ZodType,
  Codes extends ErrorCodes,
> extends TaskContractBase<Id, Input, Output, Codes> {
  readonly effect: "read";
  readonly freshness: FreshnessPolicy;
  readonly provenance: ProvenancePolicy;
  readonly artifacts?: "content-addressed";
}

export interface PrepareTaskContract<
  Id extends TaskId,
  Input extends z.ZodType,
  Output extends z.ZodType,
  Codes extends ErrorCodes,
> extends TaskContractBase<Id, Input, Output, Codes> {
  readonly effect: "prepare";
  readonly checkpoint: "in-memory-only";
}

export interface CommitTaskContract<
  Id extends TaskId,
  Input extends z.ZodType,
  Output extends z.ZodType,
  Proof extends z.ZodType,
  Codes extends ErrorCodes,
> extends TaskContractBase<Id, Input, Output, Codes> {
  readonly effect: "commit";
  readonly writeSafety: WriteSafety<Input, Output, Proof>;
}

type Sealed<Contract, Output extends z.ZodType> = Omit<Contract, "example"> & {
  readonly example: z.output<Output>;
  readonly __sealed: true;
};
export type SealedReadContract<
  Id extends TaskId,
  Input extends z.ZodType,
  Output extends z.ZodType,
  Codes extends ErrorCodes,
> = Sealed<ReadTaskContract<Id, Input, Output, Codes>, Output>;
export type SealedPrepareContract<
  Id extends TaskId,
  Input extends z.ZodType,
  Output extends z.ZodType,
  Codes extends ErrorCodes,
> = Sealed<PrepareTaskContract<Id, Input, Output, Codes>, Output>;
export type SealedCommitContract<
  Id extends TaskId,
  Input extends z.ZodType,
  Output extends z.ZodType,
  Proof extends z.ZodType,
  Codes extends ErrorCodes,
> = Sealed<CommitTaskContract<Id, Input, Output, Proof, Codes>, Output>;

interface RuntimeTaskContractBase {
  readonly id: TaskId;
  readonly title: string;
  readonly input: z.ZodType;
  readonly output: z.ZodType;
  readonly errorCodes: ErrorCodes;
  readonly requires?: readonly z.input<typeof SecretNameSchema>[];
  readonly providers?: readonly z.input<typeof ProviderCapabilityIdSchema>[];
  readonly subject: SubjectBindingSpec;
  readonly scenarios: readonly z.input<typeof ScenarioIdSchema>[];
  readonly example: unknown;
  readonly operation?: TaskOperationDeclaration;
}
interface RuntimeReadTaskContract extends RuntimeTaskContractBase {
  readonly effect: "read";
  readonly freshness: FreshnessPolicy;
  readonly provenance: ProvenancePolicy;
  readonly artifacts?: "content-addressed";
}
interface RuntimePrepareTaskContract extends RuntimeTaskContractBase {
  readonly effect: "prepare";
  readonly checkpoint: "in-memory-only";
}
interface RuntimeCommitTaskContract extends RuntimeTaskContractBase {
  readonly effect: "commit";
  readonly writeSafety: z.output<typeof WriteSafetyRuntimeSchema>;
}
export type AnyReadTaskContract = RuntimeReadTaskContract & { readonly __sealed: true };
export type AnyPrepareTaskContract = RuntimePrepareTaskContract & { readonly __sealed: true };
export type AnyCommitTaskContract = RuntimeCommitTaskContract & { readonly __sealed: true };
export type AnyTaskContract = AnyReadTaskContract | AnyPrepareTaskContract | AnyCommitTaskContract;
type RuntimeTaskContract = RuntimeReadTaskContract | RuntimePrepareTaskContract | RuntimeCommitTaskContract;
const FACTORY_SEALED_TASK_CONTRACTS = new WeakSet<object>();
type ReadTaskDefinitionShape = Omit<
  ReadTaskContract<TaskId, z.ZodType, z.ZodType, ErrorCodes>,
  "output" | "example"
> & Readonly<{ output: z.ZodType; example: unknown }>;

const RuntimeZodSchema = z.custom<z.ZodType>(
  (value) => value instanceof z.ZodType,
  "expected a Zod schema",
);
const RuntimeDeferredExampleSchema = z.custom<unknown>(() => true);
const RuntimeTaskContractCommonShape = {
  id: TaskIdSchema,
  title: z.string().min(1),
  input: RuntimeZodSchema,
  output: RuntimeZodSchema,
  errorCodes: z.array(TaskErrorCodeSchema).min(1),
  requires: z.array(SecretNameSchema).optional(),
  providers: z.array(ProviderCapabilityIdSchema).optional(),
  subject: SubjectBindingSpecSchema,
  scenarios: z.array(ScenarioIdSchema),
  example: RuntimeDeferredExampleSchema,
  operation: z.unknown().optional(),
};
export const RuntimeTaskContractDefinitionSchema = z.discriminatedUnion("effect", [
  z.strictObject({
    ...RuntimeTaskContractCommonShape,
    effect: z.literal("read"),
    freshness: FreshnessPolicySchema,
    provenance: ProvenancePolicySchema,
    artifacts: z.literal("content-addressed").optional(),
  }),
  z.strictObject({
    ...RuntimeTaskContractCommonShape,
    effect: z.literal("prepare"),
    checkpoint: z.literal("in-memory-only"),
  }),
  z.strictObject({
    ...RuntimeTaskContractCommonShape,
    effect: z.literal("commit"),
    writeSafety: WriteSafetyRuntimeSchema,
  }),
]);

const EFFECT_VERBS: Readonly<Record<TaskEffect, readonly string[]>> = {
  read: ["read", "search", "list", "extract", "match", "verify"],
  prepare: ["fill", "stage"],
  commit: ["save", "submit", "upload", "create", "update", "delete"],
};

function namespaceOf(taskId: string): string {
  return taskId.slice(0, taskId.lastIndexOf("/"));
}

function taskVerb(taskId: string): string {
  return taskId.slice(taskId.lastIndexOf("/") + 1).split("-")[0] ?? "";
}

function assertReadTaskReference(referenceInput: unknown, owner: string, namespace: string): ReadTaskReference {
  const reference = ReadTaskReferenceSchema.parse(referenceInput);
  if (namespaceOf(reference.taskId) !== namespace) throw new Error(`${owner} crosses stores`);
  if (!EFFECT_VERBS.read.includes(taskVerb(reference.taskId))) {
    throw new Error(`${owner} must reference a read-effect task id`);
  }
  return reference;
}

function assertCommon(contract: RuntimeTaskContract): void {
  const id = TaskIdSchema.parse(contract.id);
  if (contract.title.trim().length === 0) throw new Error(`${id} requires a non-empty title`);
  assertContractBoundarySchema(contract.input, `${id} input`);
  assertContractBoundarySchema(contract.output, `${id} output`);
  const parsedExample = contract.output.parse(contract.example);
  canonicalJsonStringify(parsedExample);
  if (contract.operation !== undefined) assertTaskOperationDeclaration(contract.operation, contract);
  const codes = contract.errorCodes.map((code) => TaskErrorCodeSchema.parse(code));
  if (new Set(codes).size !== codes.length) throw new Error(`${id} errorCodes must be unique`);
  for (const name of contract.requires ?? []) SecretNameSchema.parse(name);
  for (const capability of contract.providers ?? []) ProviderCapabilityIdSchema.parse(capability);
  for (const scenario of contract.scenarios) ScenarioIdSchema.parse(scenario);
  const subject = SubjectBindingSpecSchema.parse(contract.subject);
  const namespace = namespaceOf(id);
  const browser = BrowserSystemIdSchema.safeParse(namespace);
  const service = ServiceSystemIdSchema.safeParse(namespace);
  if (!browser.success && !service.success && !namespace.startsWith("workflow:")) {
    throw new Error(`${id} has an unknown task-store namespace`);
  }
  if (!service.success && contract.providers !== undefined) {
    throw new Error(`${id} provider capabilities are legal only for service-store reads`);
  }
  if (contract.effect !== "read" && !browser.success) {
    throw new Error(`${id} ${contract.effect} contracts require a browser-system namespace`);
  }
  if (!namespace.startsWith("workflow:") && contract.scenarios.length === 0) {
    throw new Error(`${id} requires scenarios at its derived declaration tier`);
  }
  if (subject.kind !== "none") {
    if (!browser.success) throw new Error(`${id} cannot bind a browser observation outside a browser store`);
    if (!subject.observe.startsWith(`${browser.data}.`)) throw new Error(`${id} subject observation crosses systems`);
    assertSchemaOwnsPath(contract.input, subject.expected.fromInput, `${id} subject`);
    if (subject.kind === "person") {
      const expectedMatch = {
        eid: "normalized-exact-eid",
        name: "normalized-exact-name",
        "eid-and-name": "eid-and-name",
      }[subject.expected.identity];
      if (subject.match !== expectedMatch) throw new Error(`${id} subject identity and match are incompatible`);
    }
  } else if (contract.effect === "commit") {
    if (subject.reason !== undefined || subject.reviewedReasonId === undefined) {
      throw new Error(`${id} unscoped commit requires a reviewed UnscopedCommitReasonId, not free text`);
    }
    if (!UNSCOPED_COMMIT_REASON_REGISTRY.some(({ id: reasonId }) => reasonId === subject.reviewedReasonId)) {
      throw new Error(`${id} references an unreviewed unscoped commit reason`);
    }
  } else if (subject.reason === undefined || subject.reviewedReasonId !== undefined) {
    throw new Error(`${id} non-commit subject.none requires a reason and cannot claim commit review`);
  }
  if (contract.effect === "commit" && subject.kind !== "none"
    && subject.requiredAt !== "after-prepare-before-fence") {
    throw new Error(`${id} commit subject proof must be observed after prepare and before fence`);
  }
  const allowedVerbs = EFFECT_VERBS[contract.effect];
  if (!allowedVerbs.includes(taskVerb(id))) {
    throw new Error(`${id} verb does not agree with effect ${contract.effect}`);
  }
}

function assertRead(contract: RuntimeReadTaskContract): void {
  const freshness = FreshnessPolicySchema.parse(contract.freshness);
  const provenance = ProvenancePolicySchema.parse(contract.provenance);
  for (const rule of freshness.byField ?? []) {
    assertSchemaOwnsPath(contract.output, rule.path, `${contract.id} freshness`);
  }
  for (const rule of provenance.byField ?? []) {
    assertSchemaOwnsPath(contract.output, rule.path, `${contract.id} provenance`);
  }
}

function assertWriteSafety(contract: RuntimeCommitTaskContract): void {
  WriteSafetyRuntimeSchema.parse(contract.writeSafety);
  const { completion, idempotency } = contract.writeSafety;
  assertContractBoundarySchema(completion.proofSchema, `${contract.id} completion proof`);
  const parsedOutput = contract.output.parse(contract.example);
  const proof = completion.proofSchema.parse(
    Reflect.apply(completion.proofFromOutput, undefined, [parsedOutput]),
  );
  const proofCanonical = canonicalJsonStringify(proof);
  const reconstructedOutput = contract.output.parse(
    Reflect.apply(completion.outputFromProof, undefined, [proof]),
  );
  if (canonicalJsonStringify(parsedOutput) !== canonicalJsonStringify(reconstructedOutput)) {
    throw new Error(`${contract.id} completion proof does not reconstruct the canonical output`);
  }
  const verdict = probeVerdictSchema(completion.proofSchema).parse({ state: "present", proof });
  if (verdict.state !== "present") throw new Error(`${contract.id} present proof verdict did not remain present`);
  const probeProof = completion.proofSchema.parse(
    Reflect.apply(completion.proofFromPresentProbe, undefined, [verdict]),
  );
  if (proofCanonical !== canonicalJsonStringify(probeProof)) {
    throw new Error(`${contract.id} present-probe proof disagrees with output proof`);
  }
  const namespace = namespaceOf(contract.id);
  assertReadTaskReference(idempotency.probe, `${contract.id} idempotency probe`, namespace);
  NegativeSettlementPolicySchema.parse(idempotency.recoveryAbsence);
  if (completion.kind !== "receipt") {
    assertReadTaskReference(completion.verify, `${contract.id} completion verifier`, namespace);
  }
  if (completion.kind === "upload-verify" && completion.unverifiableByPage !== undefined) {
    const reviewed = REVIEWED_UNVERIFIABLE_BY_PAGE_POLICY.contracts.find(({ taskId }) => taskId === contract.id);
    if (!reviewed || reviewed.reason !== completion.unverifiableByPage.reason) {
      throw new Error(`${contract.id} unverifiableByPage is not in the reviewed always-park policy`);
    }
    const attestation = completion.proofSchema.parse(
      completion.unverifiableByPage.operatorAttestationExample,
    );
    if (attestation === null || typeof attestation !== "object" || Array.isArray(attestation)
      || !Object.hasOwn(attestation, "kind") || Reflect.get(attestation, "kind") !== "operator-attestation") {
      throw new Error(`${contract.id} unverifiableByPage must exercise an operator-attestation proof arm`);
    }
    canonicalJsonStringify(attestation);
  }
}

export function assertTaskContractReferences(
  contract: RuntimeTaskContract,
  corpusInput: unknown,
): void {
  const corpus = TaskContractResolutionCorpusSchema.parse(corpusInput);
  const scenarioIds = new Set<string>(corpus.scenarioIds);
  for (const scenario of contract.scenarios) {
    if (!scenarioIds.has(scenario)) throw new Error(`${contract.id} references unresolved scenario ${scenario}`);
  }
  if (contract.effect !== "commit") return;
  const references = [
    contract.writeSafety.idempotency.probe,
    ...(contract.writeSafety.completion.kind === "receipt" ? [] : [contract.writeSafety.completion.verify]),
  ];
  const tasks = new Map(corpus.tasks.map((task) => [task.id, task.effect]));
  for (const reference of references) {
    const effect = tasks.get(reference.taskId);
    if (effect === undefined) throw new Error(`${contract.id} references unresolved read task ${reference.taskId}`);
    if (effect !== "read") throw new Error(`${contract.id} reference ${reference.taskId} is not a read contract`);
  }
}

export function assertFactorySealedTaskContract(input: unknown): asserts input is AnyTaskContract {
  if (input === null || typeof input !== "object" || !FACTORY_SEALED_TASK_CONTRACTS.has(input)) {
    throw new Error("defineTask requires the exact contract object returned by defineTaskContract");
  }
}

export function defineTaskContract<
  const Contract extends ReadTaskDefinitionShape,
>(contract: Contract & Readonly<{
  output: CanonicalJsonSchema<Contract["output"]>;
  example: z.input<Contract["output"]>;
}>): Sealed<Contract, Contract["output"]>;
export function defineTaskContract<
  Id extends TaskId,
  Input extends z.ZodType,
  Output extends z.ZodType,
  const Codes extends ErrorCodes,
>(contract: PrepareTaskContract<Id, Input, Output, Codes>): SealedPrepareContract<Id, Input, Output, Codes>;
export function defineTaskContract<
  Id extends TaskId,
  Input extends z.ZodType,
  Output extends z.ZodType,
  Proof extends z.ZodType,
  const Codes extends ErrorCodes,
>(contract: CommitTaskContract<Id, Input, Output, Proof, Codes>): SealedCommitContract<Id, Input, Output, Proof, Codes>;
export function defineTaskContract(contract: RuntimeTaskContract): RuntimeTaskContract & { readonly __sealed: true } {
  RuntimeTaskContractDefinitionSchema.parse(contract);
  assertCommon(contract);
  if (contract.effect === "read") assertRead(contract);
  if (contract.effect === "commit") assertWriteSafety(contract);
  const parsedExample = contract.output.parse(contract.example);
  const sealed = sealDeclarativeMetadata({ ...contract, example: parsedExample, __sealed: true as const });
  FACTORY_SEALED_TASK_CONTRACTS.add(sealed);
  return sealed;
}
