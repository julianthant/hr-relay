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
import { SecretNameSchema } from "../secrets.js";
import { NegativeSettlementPolicySchema, probeVerdictSchema } from "../write-safety.js";
import type { CanonicalJsonSchema, WriteSafety } from "./write-safety.js";

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
});
export const SubjectBindingSpecSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none"), reason: z.string().min(1) }),
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

export type TaskEffect = z.infer<typeof TaskEffectSchema>;
export type TaskErrorCode = z.infer<typeof TaskErrorCodeSchema>;
export type ContractFieldPath = z.infer<typeof ContractFieldPathSchema>;
export type FreshnessPolicy = z.infer<typeof FreshnessPolicySchema>;
export type ProvenancePolicy = z.infer<typeof ProvenancePolicySchema>;
export type SubjectBindingSpec = z.infer<typeof SubjectBindingSpecSchema>;

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

type Sealed<Contract> = Contract & { readonly __sealed: true };
export type SealedReadContract<
  Id extends TaskId,
  Input extends z.ZodType,
  Output extends z.ZodType,
  Codes extends ErrorCodes,
> = Sealed<ReadTaskContract<Id, Input, Output, Codes>>;
export type SealedPrepareContract<
  Id extends TaskId,
  Input extends z.ZodType,
  Output extends z.ZodType,
  Codes extends ErrorCodes,
> = Sealed<PrepareTaskContract<Id, Input, Output, Codes>>;
export type SealedCommitContract<
  Id extends TaskId,
  Input extends z.ZodType,
  Output extends z.ZodType,
  Proof extends z.ZodType,
  Codes extends ErrorCodes,
> = Sealed<CommitTaskContract<Id, Input, Output, Proof, Codes>>;

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
  readonly writeSafety: WriteSafety<z.ZodType, z.ZodType, z.ZodType>;
}
type RuntimeTaskContract = RuntimeReadTaskContract | RuntimePrepareTaskContract | RuntimeCommitTaskContract;

const EFFECT_VERBS: Readonly<Record<TaskEffect, readonly string[]>> = {
  read: ["read", "search", "list", "extract", "match", "verify"],
  prepare: ["fill", "stage"],
  commit: ["save", "submit", "upload", "create", "update", "delete"],
};

function assertStrictBoundarySchema(schema: z.core.$ZodType, label: string): void {
  if (schema instanceof z.ZodObject) {
    if (!(schema._zod.def.catchall instanceof z.ZodNever)) throw new Error(`${label} must use z.strictObject`);
    return;
  }
  if (schema instanceof z.ZodUnion) {
    for (const option of schema.options) assertStrictBoundarySchema(option, label);
    return;
  }
  throw new Error(`${label} must be a strict object or strict-object union`);
}

function valueHasPath(value: unknown, parts: readonly string[]): boolean {
  if (parts.length === 0) return true;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const [head, ...tail] = parts;
  if (!(head in value)) return false;
  return valueHasPath(Reflect.get(value, head), tail);
}

function assertFieldPath(example: unknown, path: ContractFieldPath, owner: string): void {
  if (!valueHasPath(example, path.split("."))) throw new Error(`${owner} references unknown output field ${path}`);
}

function namespaceOf(taskId: string): string {
  return taskId.slice(0, taskId.lastIndexOf("/"));
}

function taskVerb(taskId: string): string {
  return taskId.slice(taskId.lastIndexOf("/") + 1).split("-")[0] ?? "";
}

function assertCommon(contract: RuntimeTaskContract): void {
  const id = TaskIdSchema.parse(contract.id);
  if (contract.title.trim().length === 0) throw new Error(`${id} requires a non-empty title`);
  assertStrictBoundarySchema(contract.input, `${id} input`);
  assertStrictBoundarySchema(contract.output, `${id} output`);
  const parsedExample = contract.output.parse(contract.example);
  canonicalJsonStringify(parsedExample);
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
  if (subject.kind !== "none") {
    if (!browser.success) throw new Error(`${id} cannot bind a browser observation outside a browser store`);
    if (!subject.observe.startsWith(`${browser.data}.`)) throw new Error(`${id} subject observation crosses systems`);
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
  const example = contract.output.parse(contract.example);
  for (const rule of freshness.byField ?? []) assertFieldPath(example, rule.path, `${contract.id} freshness`);
  for (const rule of provenance.byField ?? []) assertFieldPath(example, rule.path, `${contract.id} provenance`);
}

function assertWriteSafety(contract: RuntimeCommitTaskContract): void {
  const { completion, idempotency } = contract.writeSafety;
  assertStrictBoundarySchema(completion.proofSchema, `${contract.id} completion proof`);
  const parsedOutput = contract.output.parse(contract.example);
  const proof = completion.proofSchema.parse(completion.proofFromOutput(parsedOutput));
  canonicalJsonStringify(proof);
  contract.output.parse(completion.outputFromProof(proof));
  const verdict = probeVerdictSchema(completion.proofSchema).parse({ state: "present", proof });
  if (verdict.state !== "present") throw new Error(`${contract.id} present proof verdict did not remain present`);
  completion.proofSchema.parse(completion.proofFromPresentProbe(verdict));
  const namespace = namespaceOf(contract.id);
  if (namespaceOf(idempotency.probe) !== namespace) throw new Error(`${contract.id} idempotency probe crosses stores`);
  TaskIdSchema.parse(idempotency.probe);
  NegativeSettlementPolicySchema.parse(idempotency.recoveryAbsence);
  if (completion.kind !== "receipt") {
    TaskIdSchema.parse(completion.verify);
    if (namespaceOf(completion.verify) !== namespace) throw new Error(`${contract.id} completion verifier crosses stores`);
  }
  if (completion.kind === "upload-verify" && completion.unverifiableByPage !== undefined) {
    if (completion.unverifiableByPage.reason.trim().length === 0) {
      throw new Error(`${contract.id} unverifiableByPage requires a reason`);
    }
    completion.proofSchema.parse(completion.unverifiableByPage.operatorAttestationExample);
  }
}

export function defineTaskContract<
  Id extends TaskId,
  Input extends z.ZodType,
  Output extends z.ZodType,
  const Codes extends ErrorCodes,
>(contract: ReadTaskContract<Id, Input, Output, Codes>): SealedReadContract<Id, Input, Output, Codes>;
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
  assertCommon(contract);
  if (contract.effect === "read") assertRead(contract);
  if (contract.effect === "commit") assertWriteSafety(contract);
  return Object.freeze({ ...contract, __sealed: true });
}
