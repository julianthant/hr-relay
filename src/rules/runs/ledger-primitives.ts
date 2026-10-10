/** Browser-reachable modules share these enums without importing node:crypto. */
import { z } from "zod";

/** How a filed write was proved complete. */
export const LedgerCompletionKindSchema = z.enum(["receipt", "save-verify", "upload-verify"]);
export type LedgerCompletionKind = z.infer<typeof LedgerCompletionKindSchema>;

/** Where the proof came from — ref write-safety §4's three sources and no others. */
export const LedgerProofSourceSchema = z.enum(["normal-output", "recovery-probe", "operator-attestation"]);
export type LedgerProofSource = z.infer<typeof LedgerProofSourceSchema>;
