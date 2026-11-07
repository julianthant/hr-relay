import { z } from "zod";
import { FingerprintSchema } from "../identity/ids.js";
import { sha256Hex } from "../validation/sha256.js";

/** Authority-only classification for a refused or indeterminate write path. */
export const WriteAuthorityReasonCodeSchema = z.enum([
  "recovery-probe-exception",
  "recovery-probe-ambiguous",
  "recovery-probe-unknown",
  "recovery-present-proof-schema-failure",
  "negative-settlement-operator-only",
  "negative-settlement-present",
  "negative-settlement-ambiguous",
  "negative-settlement-unknown",
  "negative-settlement-inconsistent-evidence",
  "inline-recovery-probe-exception",
  "inline-recovery-present-proof-schema-failure",
  "inline-recovery-absent",
  "inline-recovery-ambiguous",
  "inline-recovery-unknown",
  "prewrite-probe-exception",
  "prewrite-probe-ambiguous",
  "prewrite-probe-unknown",
  "prewrite-probe-foreign-absence",
  "preview-probe-exception",
  "preview-probe-ambiguous",
  "preview-probe-unknown",
  "preview-probe-foreign-absence",
  "write-fence-state-invalid",
  "commit-output-schema-failure",
  "commit-receipt-proof-schema-failure",
  "manual-confirmation-required",
  "post-click-verifier-exception",
  "post-click-verifier-absent",
  "post-click-verifier-ambiguous",
  "post-click-verifier-unknown",
  "post-click-present-proof-schema-failure",
  "post-fence-commit-exception",
  "post-fence-observation-exception",
  "post-fence-commit-and-observation-exception",
  "post-fence-session-exception",
]);
export type WriteAuthorityReasonCode = z.infer<typeof WriteAuthorityReasonCodeSchema>;

export const WriteAuthorityReasonSchema = z.strictObject({
  version: z.literal(1),
  code: WriteAuthorityReasonCodeSchema,
  evidence: z.strictObject({
    kind: z.enum(["exception", "probe", "proof", "settlement", "fence", "session", "authority-row"]),
    digest: FingerprintSchema,
  }),
});
export type WriteAuthorityReason = z.infer<typeof WriteAuthorityReasonSchema>;

/** The source detail contributes to the digest and is never stored or replayed. */
export function deriveWriteAuthorityReason(
  codeInput: unknown,
  kindInput: unknown,
  detailInput: string,
): WriteAuthorityReason {
  const code = WriteAuthorityReasonCodeSchema.parse(codeInput);
  const kind = WriteAuthorityReasonSchema.shape.evidence.shape.kind.parse(kindInput);
  const digest = FingerprintSchema.parse(sha256Hex(
    `hrauto:write-authority-reason:v1\0${code}\0${kind}\0${detailInput}`,
  ));
  return WriteAuthorityReasonSchema.parse({ version: 1, code, evidence: { kind, digest } });
}

/** A safe refusal carrying source detail only as a strict authority digest. */
export class WriteSafetyAuthorityError extends Error {
  readonly authorityReason: WriteAuthorityReason;

  constructor(message: string, authorityReasonInput: unknown, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WriteSafetyAuthorityError";
    this.authorityReason = WriteAuthorityReasonSchema.parse(authorityReasonInput);
  }
}
