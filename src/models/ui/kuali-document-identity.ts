/** The identifiers and shared value shapes every Kuali Build document surface is addressed by, in their own module so the timekeeper module names the other two's schemas without a cycle. */
import { z } from "zod";

/** The opaque Action-List action id in the document deep link; it is NOT the document number and is NOT stable across workflow steps, so a run carries both. */
export const KualiActionIdSchema = z.string().regex(
  /^[0-9a-f]{24}$/,
  "Kuali action id must be 24 hex characters",
);
export const KualiDocumentNumberSchema = z.string().regex(
  /^\d{3,8}$/,
  "Kuali document number must be 3-8 digits",
);

/** Compare trimmed printable ASCII; never write control characters or surrounding whitespace. */
export const KualiTimekeeperNameSchema = z.string()
  .min(1)
  .max(64)
  .regex(/^[\x20-\x7E]+$/, "timekeeper name must be printable ASCII")
  .refine((value) => value === value.trim(), "timekeeper name may not be whitespace-padded");

/** Save payloads use formKey, not DOM ID; republished keys must fail the check. */
export const KUALI_RRSS_TIMEKEEPER_FORM_KEY = "QGJ63YrCom";
