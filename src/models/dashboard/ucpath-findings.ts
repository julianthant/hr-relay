import { z } from "zod";
import { UcpathTransactionFindingsReadSchema } from "../ui/ucpath-transaction-findings.js";

export const UcpathFindingsDetailSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("unavailable") }),
  z.strictObject({
    state: z.literal("found"),
    findings: UcpathTransactionFindingsReadSchema,
    selectorVerification: z.literal("pending-live-verification"),
    authoritative: z.literal(false),
    matches: z.array(z.strictObject({ transactionId: z.string().min(1), match: z.enum(["exact", "ambiguous", "different"]) })),
  }).superRefine((detail, context) => {
    if (detail.matches.length !== detail.findings.rows.length
      || detail.matches.some((match, index) => match.transactionId !== detail.findings.rows[index]?.transactionId)) {
      context.addIssue({ code: "custom", message: "UCPath finding matches must preserve the retained row identities" });
    }
  }),
]);
export type UcpathFindingsDetail = z.infer<typeof UcpathFindingsDetailSchema>;
