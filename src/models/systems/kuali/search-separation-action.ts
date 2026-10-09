/** ONE document number in, ONE Kuali action id out: the action id is a GRAPH OUTPUT, so the workflow starts from the one number a human actually knows. */
import { z } from "zod";
import { ObservationIdSchema, taskId } from "../../../rules/identity/ids.js";
import {
  KUALI_ACTION_LIST_READY,
  KualiActionResolutionSchema,
} from "../../ui/kuali-action-list.js";
import { KualiDocumentNumberSchema } from "../../ui/kuali-document-identity.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";

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
        /* The LINK's own accessible name, anchored — not the id it is about to return; a read that proved its subject from its own answer would prove nothing. */
    observe: ObservationIdSchema.parse("kuali.action-list.matched-document-number"),
    match: "exact",
    requiredAt: "before-subject-read",
  },
    /* Recheck action identity at openDocument; an age limit cannot replace page-heading proof. */
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
