import { z } from "zod";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { CANONICAL_FIELDS } from "../../fields/registry.js";
import { ERROR_CATALOG } from "../../failures/error-catalog.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { taskId } from "../../../rules/identity/ids.js";

export const I9LookupInputSchema = z.strictObject({
  lastName: z.string().trim().min(1),
  firstName: z.string().trim().min(1),
  ssn: CANONICAL_FIELDS.ssn.schema.optional(),
});
export type I9LookupInput = z.output<typeof I9LookupInputSchema>;

export function i9LookupMatchKey(input: I9LookupInput): string {
  const identityDigest = sha256Hex(JSON.stringify([input.lastName.toLowerCase(), input.firstName.toLowerCase(), input.ssn]));
  return `i9:${identityDigest}`;
}

export const I9RecordIdsSchema = z.strictObject({
  profileId: z.string().regex(/^[1-9]\d*$/u),
  i9Id: z.string().regex(/^[1-9]\d*$/u),
});

export const I9SignerOutputSchema = z.discriminatedUnion("i9Status", [
  z.strictObject({ i9Status: z.literal("signed"), signerName: z.string().trim().min(1), ...I9RecordIdsSchema.shape }),
  z.strictObject({ i9Status: z.literal("unsigned"), signerName: z.literal(""), profileId: I9RecordIdsSchema.shape.profileId.optional(), i9Id: I9RecordIdsSchema.shape.i9Id.optional() }),
  z.strictObject({ i9Status: z.literal("historical"), signerName: z.literal(""), ...I9RecordIdsSchema.shape }),
  z.strictObject({ i9Status: z.literal("not-found"), signerName: z.literal("") }),
  z.strictObject({ i9Status: z.literal("unable-to-access"), signerName: z.literal("") }),
]);
export type I9SignerOutput = z.output<typeof I9SignerOutputSchema>;

export const I9ReadSection2Signer = defineTaskContract({
  id: taskId("i9/read-section2-signer"),
  title: "Read Section 2 signer",
  effect: "read",
  input: I9LookupInputSchema,
  output: I9SignerOutputSchema,
  errorCodes: ["I9_LOOKUP_FAILED", "I9_LOOKUP_AMBIGUOUS"],
  subject: { kind: "none", reason: "Name discovery binds one exact displayed name and profile before reading its I-9 summary; I-9 employee IDs are not UCPath EIDs." },
  freshness: { defaultMaxAgeMs: 60 * 60 * 1000, defaultOverride: "forbidden" },
  provenance: { default: "live" },
  scenarios: ["i9-lookup/signed", "i9-lookup/unsigned", "i9-lookup/historical", "i9-lookup/not-found", "i9-lookup/restricted", "i9-lookup/ambiguous", "i9-lookup/read-failed"],
  example: { i9Status: "signed", signerName: "Example Representative", profileId: "900001", i9Id: "900002" },
});

export class I9LookupError extends Error {
  constructor(readonly code: "I9_LOOKUP_FAILED" | "I9_LOOKUP_AMBIGUOUS" = "I9_LOOKUP_FAILED", options?: ErrorOptions) {
    super(ERROR_CATALOG[code].text, options);
    this.name = "I9LookupError";
  }
}
