/** Deterministic receipt identities: every id a receipt carries is a pure function of what it identifies, so re-deriving the same terminal run yields the same bytes. */
import {
  EvidenceEntryIdSchema,
  EvidenceReceiptIdSchema,
  EvidenceRefSchema,
} from "../../rules/identity/ids.js";
import type { EvidenceEntryId, EvidenceReceiptId, EvidenceRef } from "../../rules/identity/ids.js";
import { sha256Hex } from "../../rules/validation/sha256.js";

function foldToUuid(namespace: string, seed: string): string {
  const digest = sha256Hex(`${namespace}\0${seed}`);
  const variant = "89ab"[Number.parseInt(digest[16], 16) % 4];
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

/** One terminal run, one receipt id — the `run_receipts.run_id` UNIQUE key's twin. */
export function deriveEvidenceReceiptId(runId: string, attempt: number): EvidenceReceiptId {
  return EvidenceReceiptIdSchema.parse(
    foldToUuid("hrauto:evidence-receipt:v1", `${runId}\0${String(attempt)}`),
  );
}

/** One evidence row's id; `kind` and `key` together must be unique inside a receipt, and the schema's uniqueness refinement is the backstop. */
export function deriveEvidenceEntryId(
  receiptId: string,
  kind: "input" | "observation" | "decision" | "action" | "verification" | "output" | "reuse" | "warning",
  key: string,
): EvidenceEntryId {
  return EvidenceEntryIdSchema.parse(
    foldToUuid("hrauto:evidence-entry:v1", `${receiptId}\0${kind}\0${key}`),
  );
}

/** A reference to another evidence row; an evidence ROW is the observation record, so a row-to-row link is spelled `observation:<entry uuid>`. */
export function evidenceEntryRef(entryId: string): EvidenceRef {
  return EvidenceRefSchema.parse(`observation:${entryId}`);
}

/** A link to the receipt itself, for evidence that qualifies the whole run. */
export function evidenceReceiptRef(receiptId: string): EvidenceRef {
  return EvidenceRefSchema.parse(`receipt:${receiptId}`);
}
