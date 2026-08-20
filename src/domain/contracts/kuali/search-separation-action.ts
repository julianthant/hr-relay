/**
 * `kuali/search-separation-action` — ONE document number in, ONE Kuali action
 * id out (D261).
 *
 * ## Why this task exists
 *
 * **D260** measured `separations` as needing TWO varying values per run —
 * `documentNumber` and `actionId` — and therefore as having no typed start box,
 * because `EntryRule.emit` is a single field and `constants[]` can only carry a
 * value that does not vary. It named two ways out and left the choice to the
 * operator, who ruled on 2026-08-20: *"document number should work. no need
 * action id."* This is the second shape D260 named — **make the action id a
 * GRAPH OUTPUT** — and it is why the composed workflow now starts from the one
 * number a human actually knows.
 *
 * D260 is not rewritten and is not wrong: its rule (one varying value per run)
 * still holds exactly as stated, and this task is what changes the SCHEMA the
 * rule is applied to.
 *
 * ## What it reads, and what it refuses
 *
 * The Action List's own route, filtered through the list's own search box. The
 * action id is on the page as the row's link `href`, so this is strictly
 * read-only: no click into a document, no navigation to one, nothing staged.
 *
 * Four error codes, because four different things go wrong (D196):
 *
 *  - `document-not-in-action-list` — nobody is holding an action on this
 *    document. That is a REAL and common state (a completed step leaves the
 *    list) and it is a refusal, never an empty answer: the refusal names the
 *    numbers the list did show.
 *  - `ambiguous-action-list-match` — one document number, two different action
 *    ids. A run cannot choose which workflow step it is filing against, and
 *    choosing for it is how the wrong thing gets written.
 *  - `unreadable-action-link` — the matched link carries no href, or an href
 *    that does not address `…/build/space/<space>/actions/<actionId>`. There is
 *    no second place to read the id from, and inventing one is the substitution
 *    this program bans.
 *  - `unexpected-page-state` — the driver answered about a different document
 *    than the task asked for.
 *
 * ## Why an anchored name match is the safety property
 *
 * Kuali's Action-List search is SUBSTRING-based — legacy records that a search
 * for `414` returns 4140–4149 — so the link recipe matches the accessible name
 * ANCHORED (`^\s*<n>\s*$`), ported verbatim from `actionList.docLink()`. TWO
 * matched links for one document is the ordinary row (Kuali publishes the
 * number in both `Document #` and `Document Title`); two DISTINCT action ids
 * is the refusal.
 */
import { z } from "zod";
import { ObservationIdSchema, taskId } from "../../ids.js";
import {
  KUALI_ACTION_LIST_READY,
  KualiActionResolutionSchema,
} from "../../ui/kuali-action-list.js";
import { KualiDocumentNumberSchema } from "../../ui/kuali-document-identity.js";
import { ContractFieldPathSchema, defineTaskContract } from "../base.js";

export const SearchSeparationActionInputSchema = z.strictObject({
  /** The ONE thing an operator knows about a separation, and the read's subject. */
  documentNumber: KualiDocumentNumberSchema,
});

export const SearchSeparationActionOutputSchema = KualiActionResolutionSchema;
export type SearchSeparationActionOutput = z.infer<typeof SearchSeparationActionOutputSchema>;

export const KualiSearchSeparationAction = defineTaskContract({
  id: taskId("kuali/search-separation-action"),
  title: "Search Kuali Action List",
  effect: "read",
  input: SearchSeparationActionInputSchema,
  output: SearchSeparationActionOutputSchema,
  errorCodes: [
    "kuali-unavailable",
    "unexpected-page-state",
    "document-not-in-action-list",
    "ambiguous-action-list-match",
    "unreadable-action-link",
  ],
  subject: {
    kind: "artifact",
    expected: {
      fromInput: ContractFieldPathSchema.parse("documentNumber"),
      identity: "document-id",
    },
    /**
     * The LINK's own accessible name, anchored — not the id it is about to
     * return. A read that proved its subject from its own answer would prove
     * nothing.
     */
    observe: ObservationIdSchema.parse("kuali.action-list.matched-document-number"),
    match: "exact",
    requiredAt: "before-subject-read",
  },
  /**
   * `Infinity`, on §5A's argument applied one node earlier.
   *
   * An `actionId` genuinely CAN go stale — it names a workflow step, and doc
   * 4453's captured id silently redirected to the Action List a fortnight later
   * (D129). What makes an age check the wrong instrument here is that the
   * staleness is already caught LOUD and at the only place it matters:
   * `openDocument` proves the document number off the page's level-1 heading
   * before anything else runs, so a stale id refuses by name with both numbers
   * printed. An age bound would instead fire mid-run on a gate park — exactly
   * what §5A removed from the three reads beside this one — and would replace a
   * precise refusal with a timer.
   */
  freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "audited" },
  provenance: { default: "live" },
  scenarios: [
    "separations/action-resolved",
    "separations/action-not-in-action-list",
    "separations/action-ambiguous",
  ],
  example: {
    pageStateId: KUALI_ACTION_LIST_READY,
    documentNumber: "4502",
    actionId: "6a766ae6f0549046f7f0dc06",
    actionHref: "/build/space/5e47518b90adda9474c14adb/actions/6a766ae6f0549046f7f0dc06",
    matchedLinkCount: 2,
    observedAt: "2026-08-20T17:24:11.000Z",
  },
});
