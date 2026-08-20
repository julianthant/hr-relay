/**
 * The browser-safe half of the ledger entry's vocabulary.
 *
 * It exists for the same reason `write-safety-primitives.ts` does (D144):
 * `src/domain/ledger.ts` imports `write-safety.js`, which imports
 * `node:crypto`, so a module the dashboard bundle can reach may not import it.
 * The Archive's ledger read-through IS reachable — it lands on the archived
 * detail wire — so the two closed enums it presents live here and
 * `src/domain/ledger.ts` imports them, which is what keeps ONE definition of
 * each rather than a restatement that quietly forks (D215's parity-twin
 * lesson, one directory over).
 */
import { z } from "zod";

/** How a filed write was proved complete. */
export const LedgerCompletionKindSchema = z.enum(["receipt", "save-verify", "upload-verify"]);
export type LedgerCompletionKind = z.infer<typeof LedgerCompletionKindSchema>;

/** Where the proof came from — ref write-safety §4's three sources and no others. */
export const LedgerProofSourceSchema = z.enum(["normal-output", "recovery-probe", "operator-attestation"]);
export type LedgerProofSource = z.infer<typeof LedgerProofSourceSchema>;
