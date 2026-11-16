/** The identifiers and shared value shapes every Kuali Build document surface is addressed by, in their own module so the timekeeper module names the other two's schemas without a cycle. */
import { z } from "zod";
import { ProfileDisplayNameSchema } from "../profiles/profile-identity.js";

/** The opaque Action-List action id in the document deep link; it is NOT the document number and is NOT stable across workflow steps, so a run carries both. */
export const KualiActionIdSchema = z.string().regex(
  /^[0-9a-f]{24}$/,
  "Kuali action id must be 24 hex characters",
);
export const KualiDocumentNumberSchema = z.string().regex(
  /^\d{3,8}$/,
  "Kuali document number must be 3-8 digits",
);

export const KualiTimekeeperNameSchema = ProfileDisplayNameSchema;

/** Save payloads use formKey, not DOM ID; republished keys must fail the check. */
export const KUALI_RRSS_TIMEKEEPER_FORM_KEY = "QGJ63YrCom";
