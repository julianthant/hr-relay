import { createHmac } from "node:crypto";
import { z } from "zod";
import {
  EidSchema,
  RunIdSchema,
  WorkflowIdSchema,
} from "../ids.js";

const HMAC_DOMAIN = "hrauto:activity-person-pseudonym:v1\0";
const KEY_COMMITMENT_DOMAIN = "hrauto:activity-person-pseudonym:key-commitment:v1\0";

export const ActivityPersonPseudonymKeyGenerationSchema = z.string()
  .regex(
    /^activity-person-[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "activity person pseudonym key generation must be a domain-qualified kebab-case id",
  )
  .brand<"ActivityPersonPseudonymKeyGeneration">();

export const ActivityPersonPseudonymSchema = z.string()
  .regex(/^[0-9a-f]{64}$/, "activity person pseudonym must be an HMAC-SHA-256 hex value")
  .brand<"ActivityPersonPseudonym">();

export const ActivityPersonPseudonymKeyCommitmentSchema = z.string()
  .regex(/^[0-9a-f]{64}$/, "activity person pseudonym key commitment must be an HMAC-SHA-256 hex value")
  .brand<"ActivityPersonPseudonymKeyCommitment">();

export const ActivityPersonPseudonymGenerationBindingSchema = z.strictObject({
  keyGeneration: ActivityPersonPseudonymKeyGenerationSchema,
  keyCommitment: ActivityPersonPseudonymKeyCommitmentSchema,
  derivation: z.literal("hmac-sha-256/activity-person-key-commitment/v1"),
});

export const ActivityPersonPseudonymEvidenceSchema = z.strictObject({
  runId: RunIdSchema,
  workflowId: WorkflowIdSchema,
  keyGeneration: ActivityPersonPseudonymKeyGenerationSchema,
  pseudonym: ActivityPersonPseudonymSchema,
  derivation: z.literal("hmac-sha-256/activity-person/v1"),
});

export const ActivityPersonPseudonymRunSetSchema = z.array(RunIdSchema).superRefine(
  (runIds, context) => {
    if (new Set(runIds).size !== runIds.length) {
      context.addIssue({
        code: "custom",
        message: "activity person pseudonym run set must not repeat a run id",
      });
    }
  },
);

const ActivityPersonPseudonymDomainSecretSchema = z.strictObject({
  keyGeneration: ActivityPersonPseudonymKeyGenerationSchema,
  keyHex: z.string().regex(
    /^[0-9a-f]{64}$/,
    "activity person pseudonym HMAC key must be 32 bytes encoded as lowercase hex",
  ),
});

const ActivityPersonPseudonymDerivationRequestSchema = z.strictObject({
  runId: RunIdSchema,
  workflowId: WorkflowIdSchema,
  canonicalSubject: EidSchema,
});

export type ActivityPersonPseudonymKeyGeneration = z.infer<
  typeof ActivityPersonPseudonymKeyGenerationSchema
>;
export type ActivityPersonPseudonymEvidence = z.infer<typeof ActivityPersonPseudonymEvidenceSchema>;
export type ActivityPersonPseudonymGenerationBinding = z.infer<
  typeof ActivityPersonPseudonymGenerationBindingSchema
>;

export interface ActivityPersonPseudonymDomain {
  readonly keyGeneration: ActivityPersonPseudonymKeyGeneration;
  readonly generationBinding: ActivityPersonPseudonymGenerationBinding;
  deriveEvidence(input: unknown): ActivityPersonPseudonymEvidence;
}

const AUTHENTIC_ACTIVITY_PERSON_PSEUDONYM_DOMAINS = new WeakSet<object>();

/**
 * The persistence authority accepts only a domain minted by the dedicated
 * HMAC factory. A structurally similar object could otherwise return any
 * caller-chosen 64-hex value while falsely claiming the reviewed derivation.
 */
export function assertAuthenticActivityPersonPseudonymDomain(
  domain: ActivityPersonPseudonymDomain,
): void {
  if (!AUTHENTIC_ACTIVITY_PERSON_PSEUDONYM_DOMAINS.has(domain)) {
    throw new Error("activity person pseudonym domain lacks the reviewed HMAC capability");
  }
}

export function activityPersonPseudonymEvidenceKey(
  runIdInput: unknown,
  keyGenerationInput: unknown,
): string {
  const runId = RunIdSchema.parse(runIdInput);
  const keyGeneration = ActivityPersonPseudonymKeyGenerationSchema.parse(keyGenerationInput);
  return `${runId}:${keyGeneration}`;
}

/**
 * D288's dedicated secret-backed HMAC domain. The key is captured inside this
 * closure and cannot be read back; only the public generation and keyed
 * pseudonym evidence cross the boundary.
 */
export function createActivityPersonPseudonymDomain(input: unknown): ActivityPersonPseudonymDomain {
  const configured = ActivityPersonPseudonymDomainSecretSchema.parse(input);
  const keyBytes = Buffer.from(configured.keyHex, "hex");
  const keyGeneration = configured.keyGeneration;
  const generationBinding = Object.freeze(ActivityPersonPseudonymGenerationBindingSchema.parse({
    keyGeneration,
    keyCommitment: createHmac("sha256", keyBytes)
      .update(KEY_COMMITMENT_DOMAIN)
      .update(keyGeneration)
      .digest("hex"),
    derivation: "hmac-sha-256/activity-person-key-commitment/v1",
  }));
  const domain = Object.freeze({
    keyGeneration,
    generationBinding,
    deriveEvidence: (requestInput: unknown) => {
      const request = ActivityPersonPseudonymDerivationRequestSchema.parse(requestInput);
      const pseudonym = createHmac("sha256", keyBytes)
        .update(HMAC_DOMAIN)
        .update(keyGeneration)
        .update("\0")
        .update(request.canonicalSubject)
        .digest("hex");
      return Object.freeze(ActivityPersonPseudonymEvidenceSchema.parse({
        runId: request.runId,
        workflowId: request.workflowId,
        keyGeneration,
        pseudonym,
        derivation: "hmac-sha-256/activity-person/v1",
      }));
    },
  });
  AUTHENTIC_ACTIVITY_PERSON_PSEUDONYM_DOMAINS.add(domain);
  return domain;
}
