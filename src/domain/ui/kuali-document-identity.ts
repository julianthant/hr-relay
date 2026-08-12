/**
 * The two identifiers every Kuali Build document surface is addressed by.
 *
 * They live in their own module because BOTH Kuali surfaces need them — the
 * write's `kuali-rrss-document.ts` and the read's
 * `kuali-separation-document.ts` — and the write module names the read's
 * operation schema on its one driver declaration. Keeping the identities here
 * is what makes that one arrow instead of a cycle.
 */
import { z } from "zod";

/**
 * The opaque 24-hex Action-List action id in the document deep link
 * `…/build/space/<space>/actions/<actionId>` (it redirects to `…/view`).
 *
 * It is NOT the document number, there is no query-param form, and it is NOT
 * stable across workflow steps: doc 4453's 2026-07-23 action id
 * (`6a613869d3863ae06c634407`) no longer resolved to a form on 2026-08-04 — it
 * redirected to the Action List. A run therefore carries BOTH the action id and
 * the document number, and the driver refuses when the opened document's
 * displayed number is not the expected one.
 */
export const KualiActionIdSchema = z.string().regex(
  /^[0-9a-f]{24}$/,
  "Kuali action id must be 24 hex characters",
);
export const KualiDocumentNumberSchema = z.string().regex(
  /^\d{3,8}$/,
  "Kuali document number must be 3-8 digits",
);
