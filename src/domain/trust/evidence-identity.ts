/**
 * Deterministic receipt identities (D140).
 *
 * A receipt is DERIVED from authority, not minted beside it, so every id it
 * carries has to be a pure function of what it identifies. A fresh UUID per
 * derivation would make the receipt a different record each time it was built
 * — and the whole point of deriving it is that re-deriving the same terminal
 * run yields the same bytes, so the durable row can refuse a divergent rebuild
 * instead of quietly overwriting one.
 *
 * The fold is `deriveItemId`'s, with `sha256Hex` rather than `node:crypto` so
 * nothing here blocks a browser-reachable import later.
 */
import {
  EvidenceEntryIdSchema,
  EvidenceReceiptIdSchema,
  EvidenceRefSchema,
} from "../ids.js";
import type { EvidenceEntryId, EvidenceReceiptId, EvidenceRef } from "../ids.js";
import { sha256Hex } from "../sha256.js";

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

/**
 * One evidence row's id. `kind` and `key` together must be unique inside a
 * receipt; the schema's own uniqueness refinement is the backstop, and a
 * collision there means this seed was not specific enough.
 */
export function deriveEvidenceEntryId(
  receiptId: string,
  kind: "input" | "observation" | "decision" | "action" | "verification" | "output" | "reuse" | "warning",
  key: string,
): EvidenceEntryId {
  return EvidenceEntryIdSchema.parse(
    foldToUuid("hrauto:evidence-entry:v1", `${receiptId}\0${kind}\0${key}`),
  );
}

/**
 * A reference to another evidence row. `EvidenceRef`'s grammar admits
 * `artifact:`, `observation:`, and `receipt:` — an evidence ROW is the
 * observation record ref operator-trust §2.3 describes ("the semantic observation that a
 * row refers to remains a dotted ObservationId in the UI vocabulary"), so a
 * row-to-row link is spelled `observation:<entry uuid>`.
 */
export function evidenceEntryRef(entryId: string): EvidenceRef {
  return EvidenceRefSchema.parse(`observation:${entryId}`);
}

/** A link to the receipt itself, for evidence that qualifies the whole run. */
export function evidenceReceiptRef(receiptId: string): EvidenceRef {
  return EvidenceRefSchema.parse(`receipt:${receiptId}`);
}
