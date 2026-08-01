import { z } from "zod";
import { NegativeSettlementPolicySchema, probeVerdictSchema } from "../write-safety.js";
import type { JsonValue } from "../canonical-json.js";
import type { TaskId } from "../ids.js";

type IsAny<Value> = 0 extends (1 & Value) ? true : false;
export type CanonicalJsonSchema<Schema extends z.ZodType> =
  IsAny<z.output<Schema>> extends true
    ? Schema extends z.ZodAny ? never : Schema
    : unknown extends z.output<Schema>
      ? Schema
      : z.output<Schema> extends JsonValue ? Schema : never;

export type ProbeVerdict<Proof extends z.ZodType> = z.output<ReturnType<typeof probeVerdictSchema<Proof>>>;

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
  readonly verify: TaskId;
}

export interface UploadVerifyCheck<Output extends z.ZodType, Proof extends z.ZodType>
  extends ProofCheck<Output, Proof> {
  readonly kind: "upload-verify";
  readonly verify: TaskId;
  readonly unverifiableByPage?: Readonly<{
    reason: string;
    operatorAttestationExample: z.input<Proof>;
  }>;
}

export type CompletionCheck<Output extends z.ZodType, Proof extends z.ZodType> =
  | ReceiptCheck<Output, Proof>
  | SaveVerifyCheck<Output, Proof>
  | UploadVerifyCheck<Output, Proof>;

export interface Idempotency<Input extends z.ZodType> {
  readonly probe: TaskId;
  readonly key: (input: z.output<Input>) => string;
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
