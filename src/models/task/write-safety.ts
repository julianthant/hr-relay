import { z } from "zod";
import { NegativeSettlementPolicySchema, probeVerdictSchema } from "../../rules/write-safety/write-safety-primitives.js";
import type { JsonValue } from "../../rules/validation/canonical-json.js";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { TaskIdSchema } from "../../rules/identity/ids.js";

type IsAny<Value> = 0 extends (1 & Value) ? true : false;
export type CanonicalJsonSchema<Schema extends z.ZodType> =
  IsAny<z.output<Schema>> extends true
    ? never
    : unknown extends z.output<Schema>
      ? never
      : z.output<Schema> extends JsonValue ? Schema : never;

export type ProbeVerdict<Proof extends z.ZodType> = z.output<ReturnType<typeof probeVerdictSchema<Proof>>>;

export const ReadTaskReferenceSchema = z.strictObject({
  taskId: TaskIdSchema,
  effect: z.literal("read"),
});
export type ReadTaskReference = z.infer<typeof ReadTaskReferenceSchema>;

export interface ProofCheck<Output extends z.ZodType, Proof extends z.ZodType> {
  readonly proofSchema: CanonicalJsonSchema<Proof>;
  readonly proofFromOutput: (output: z.output<Output>) => z.input<Proof>;
  readonly proofFromPresentProbe: (
    verdict: Extract<ProbeVerdict<Proof>, { readonly state: "present" }>,
  ) => z.input<Proof>;
  readonly outputFromProof: (proof: z.output<Proof>) => z.input<Output>;
}

export interface ReceiptCheck<Output extends z.ZodType, Proof extends z.ZodType>
  extends ProofCheck<Output, Proof> {
  readonly kind: "receipt";
}

export interface SaveVerifyCheck<Output extends z.ZodType, Proof extends z.ZodType>
  extends ProofCheck<Output, Proof> {
  readonly kind: "save-verify";
  readonly verify: ReadTaskReference;
}

export interface UploadVerifyCheck<Output extends z.ZodType, Proof extends z.ZodType>
  extends ProofCheck<Output, Proof> {
  readonly kind: "upload-verify";
  readonly verify: ReadTaskReference;
  readonly unverifiableByPage?: Readonly<{
    policy: "always-park";
    reason: string;
    operatorAttestationExample: z.input<Proof>;
  }>;
}

export type CompletionCheck<Output extends z.ZodType, Proof extends z.ZodType> =
  | ReceiptCheck<Output, Proof>
  | SaveVerifyCheck<Output, Proof>
  | UploadVerifyCheck<Output, Proof>;

export interface Idempotency<Input extends z.ZodType> {
  readonly probe: ReadTaskReference;
  readonly key: (input: z.output<Input>) => string;
  /**
   * Earlier permanent-key contracts whose immutable intents cannot be
   * reinterpreted under this contract. Presence of one is a loud refusal.
   */
  readonly retiredKeys?: Array<Readonly<{
    key: (input: z.output<Input>) => string;
    reason: string;
  }>>;
  readonly recoveryAbsence: z.input<typeof NegativeSettlementPolicySchema>;
}

export interface WriteSafety<
  Input extends z.ZodType,
  Output extends z.ZodType,
  Proof extends z.ZodType,
> {
  readonly completion: CompletionCheck<Output, Proof>;
  readonly idempotency: Idempotency<Input>;
}

const RuntimeZodTypeSchema = z.custom<z.ZodType>(
  (value) => value instanceof z.ZodType,
  "expected a Zod schema",
);
const RuntimeFunctionSchema = z.custom<(...args: never[]) => unknown>(
  (value) => typeof value === "function",
  "expected a function",
);
const RuntimeExampleSchema = z.custom<unknown>(() => true);
const RuntimeProofCheckShape = {
  proofSchema: RuntimeZodTypeSchema,
  proofFromOutput: RuntimeFunctionSchema,
  proofFromPresentProbe: RuntimeFunctionSchema,
  outputFromProof: RuntimeFunctionSchema,
};

export const CompletionCheckRuntimeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("receipt"), ...RuntimeProofCheckShape }),
  z.strictObject({
    kind: z.literal("save-verify"),
    verify: ReadTaskReferenceSchema,
    ...RuntimeProofCheckShape,
  }),
  z.strictObject({
    kind: z.literal("upload-verify"),
    verify: ReadTaskReferenceSchema,
    unverifiableByPage: z.strictObject({
      policy: z.literal("always-park"),
      reason: z.string().min(1),
      operatorAttestationExample: RuntimeExampleSchema,
    }).optional(),
    ...RuntimeProofCheckShape,
  }),
]);

export const WriteSafetyRuntimeSchema = z.strictObject({
  completion: CompletionCheckRuntimeSchema,
  idempotency: z.strictObject({
    probe: ReadTaskReferenceSchema,
    key: RuntimeFunctionSchema,
    retiredKeys: z.array(z.strictObject({
      key: RuntimeFunctionSchema,
      reason: z.string().min(1),
    })).optional(),
    recoveryAbsence: NegativeSettlementPolicySchema,
  }),
});

export const ReviewedUnverifiableByPagePolicySchema = z.strictObject({
  schemaVersion: z.literal(1),
  contracts: z.array(z.strictObject({
    taskId: TaskIdSchema,
    reason: z.string().min(1),
  })),
});

/** Empty until a store earns an argued always-park exception through review. */
export function defineReviewedUnverifiableByPagePolicy(input: unknown) {
  return deepFreeze(ReviewedUnverifiableByPagePolicySchema.parse(input));
}
export const REVIEWED_UNVERIFIABLE_BY_PAGE_POLICY = defineReviewedUnverifiableByPagePolicy({
  schemaVersion: 1,
  contracts: [],
});
