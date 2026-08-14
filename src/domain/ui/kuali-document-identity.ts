/**
 * The identifiers and shared value shapes every Kuali Build document surface is
 * addressed by.
 *
 * They live in their own module because ALL the Kuali surfaces need them — the
 * timekeeper write's `kuali-rrss-document.ts`, the read's
 * `kuali-separation-document.ts` and the finalization write's
 * `kuali-separation-finalization.ts` — and the timekeeper module names the
 * other two's operation schemas on its one driver declaration. Keeping the
 * shared facts here is what makes that one arrow instead of a cycle.
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

/**
 * A Kuali timekeeper value the automation may write.
 *
 * Deliberately narrow: printable ASCII, no leading/trailing whitespace, no
 * control characters, bounded length. Kuali inputs return whitespace-padded
 * values (legacy `kuali/LESSONS.md:49-54`, doc #4241), so every read trims and
 * every comparison is against the trimmed form.
 *
 * Both write surfaces stage this control — the Phase-2 timekeeper annotation
 * and the chunk-5 finalization — so the shape lives here rather than on either
 * one of them.
 */
export const KualiTimekeeperNameSchema = z.string()
  .min(1)
  .max(64)
  .regex(/^[\x20-\x7E]+$/, "timekeeper name must be printable ASCII")
  .refine((value) => value === value.trim(), "timekeeper name may not be whitespace-padded");

/**
 * The `formKey` Kuali's own save mutation uses for the `Timekeeper Name:*`
 * control — NOT the control's DOM id.
 *
 * A Kuali Build gadget carries two identifiers: the template gadget id, which
 * it renders as the DOM `id` (`BWmkKqx40` here), and the `formKey`, which is
 * what the document's `data` map and the `submitDocumentV2` mutation are keyed
 * by. They are unrelated strings, so a payload check written against the DOM id
 * would never match anything and would silently pass or silently fail depending
 * on which way it was phrased.
 *
 * Read live 2026-08-04 off the app's own `ActionPage` query for docs 4489/4490
 * (`action.document.form.template`, gadget `BWmkKqx40` →
 * `{"formKey":"QGJ63YrCom","label":"Timekeeper Name:","type":"Textarea"}`), and
 * confirmed on the wire: a save that carries the staged value sends
 * `variables.data["QGJ63YrCom"]`. If Kuali ever republishes the form under a
 * new key, the commit's payload check fails LOUD — it can never pass by
 * accident, because the check is an equality against the staged value.
 */
export const KUALI_RRSS_TIMEKEEPER_FORM_KEY = "QGJ63YrCom";
