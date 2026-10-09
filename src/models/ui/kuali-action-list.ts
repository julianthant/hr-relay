/** Kuali Build — the Action List, read as a DOCUMENT → ACTION resolver: strictly read-only, with the action id on the page as the row's own link href. */
import { z } from "zod";
import { IsoInstantSchema, PageStateIdSchema, ScreenIdSchema } from "../../rules/identity/ids.js";
import { ElementIdSchema, ObservationIdSchema } from "../../rules/identity/ids.js";
import { KualiActionIdSchema, KualiDocumentNumberSchema } from "./kuali-document-identity.js";

export const KUALI_ACTION_LIST_SCREEN = ScreenIdSchema.parse("kuali.action-list");

export const KUALI_ACTION_LIST_SEARCH_INPUT = ElementIdSchema.parse(
  "kuali.action-list.search-input",
);
export const KUALI_ACTION_LIST_SEARCH_GO_BUTTON = ElementIdSchema.parse(
  "kuali.action-list.search-go-button",
);
export const KUALI_ACTION_LIST_DOCUMENT_LINK = ElementIdSchema.parse(
  "kuali.action-list.document-link",
);

export const KUALI_ACTION_LIST_READY = PageStateIdSchema.parse("kuali.action-list.ready");

export const KUALI_ACTION_LIST_MATCHED_NUMBER = ObservationIdSchema.parse(
  "kuali.action-list.matched-document-number",
);

/** The Kuali Build space id, 24 hex — the same shape the deep link carries. */
export const KualiSpaceIdSchema = z.string().regex(
  /^[0-9a-f]{24}$/u,
  "Kuali space id must be 24 hex characters",
);

/** ONE Action-List link, verbatim; `href` is nullable because an anchor without one is a REAL rendering. */
export const KualiActionListLinkSchema = z.strictObject({
  /** The link's accessible name, trimmed. */
  name: z.string(),
  /** The `href` attribute exactly as the page carried it, or `null` when absent. */
  href: z.string().nullable(),
});
export type KualiActionListLink = z.infer<typeof KualiActionListLinkSchema>;

/** What the driver saw after filtering the Action List to one document number; it states what is on the page and decides nothing. */
export const KualiActionListObservationSchema = z.strictObject({
  pageStateId: z.literal(KUALI_ACTION_LIST_READY),
  /** The space whose Action List was read — the path prefix every href must carry. */
  space: KualiSpaceIdSchema,
  /** The number the run asked for, echoed so a stored observation explains itself. */
  requestedDocumentNumber: KualiDocumentNumberSchema,
  /** Every link whose accessible name is EXACTLY the requested number (anchored). */
  matchedLinks: z.array(KualiActionListLinkSchema),
    /* Every bare-number link the filtered list rendered, in page order and with duplicates kept; on a miss it is what the refusal shows the operator, because the Action List search returns neighbours. */
  listedDocumentNumbers: z.array(z.string()),
  observedAt: IsoInstantSchema,
});
export type KualiActionListObservation = z.infer<typeof KualiActionListObservationSchema>;

/** The resolved address, and the evidence it was read from. */
export const KualiActionResolutionSchema = z.strictObject({
  pageStateId: z.literal(KUALI_ACTION_LIST_READY),
  /** The number proved by the link's OWN accessible name, anchored. */
  documentNumber: KualiDocumentNumberSchema,
  actionId: KualiActionIdSchema,
  /** The `href` the id was parsed out of, verbatim, so the parse is auditable. */
  actionHref: z.string().min(1),
  /** How many links carried this number. TWO is the ordinary Action-List row. */
  matchedLinkCount: z.number().int().min(1),
  observedAt: IsoInstantSchema,
});
export type KualiActionResolution = z.infer<typeof KualiActionResolutionSchema>;

/** The verdict; every negative names itself, and there is no arm that answers with an action id the page did not show. */
export const KualiActionResolutionVerdictSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("resolved"), resolution: KualiActionResolutionSchema }),
  z.strictObject({
    state: z.literal("not-in-action-list"),
    requestedDocumentNumber: KualiDocumentNumberSchema,
    listedDocumentNumbers: z.array(z.string()),
    reason: z.string().min(1),
  }),
  z.strictObject({
    state: z.literal("ambiguous"),
    requestedDocumentNumber: KualiDocumentNumberSchema,
    actionIds: z.array(KualiActionIdSchema).min(2),
    reason: z.string().min(1),
  }),
  z.strictObject({
    state: z.literal("unreadable-link"),
    requestedDocumentNumber: KualiDocumentNumberSchema,
    observedHrefs: z.array(z.string()),
    reason: z.string().min(1),
  }),
]);
export type KualiActionResolutionVerdict = z.infer<typeof KualiActionResolutionVerdictSchema>;

/** Parse an Action-List href into its action id; the whole path is required to match the documented action-link shape. */
export function parseKualiActionHref(
  href: string,
  space: string,
): string | undefined {
  const path = href.startsWith("/") ? href : safePathname(href);
  if (path === undefined) return undefined;
  const expected = `/build/space/${space}/actions/`;
  if (!path.startsWith(expected)) return undefined;
  const rest = path.slice(expected.length);
  // Accept the same action's /view redirect; no other route suffix is valid.
  const segments = rest.split("/");
  const candidate = segments[0];
  if (candidate === undefined) return undefined;
  if (segments.length > 2) return undefined;
  if (segments.length === 2 && segments[1] !== "" && segments[1] !== "view") return undefined;
  const parsed = KualiActionIdSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

/** An href that is neither an absolute path nor an absolute URL is an address this module cannot read; the check ASKS the question rather than throwing it. */
function safePathname(href: string): string | undefined {
  return URL.canParse(href) ? new URL(href).pathname : undefined;
}

/** Decide what the observation means: pure, exhaustive, and refusal-first; two links for one document is the ORDINARY row, and two DISTINCT action ids is the refusal. */
export function classifyKualiActionResolution(
  observation: KualiActionListObservation,
): KualiActionResolutionVerdict {
  const requested = observation.requestedDocumentNumber;
  if (observation.matchedLinks.length === 0) {
    return KualiActionResolutionVerdictSchema.parse({
      state: "not-in-action-list",
      requestedDocumentNumber: requested,
      listedDocumentNumbers: observation.listedDocumentNumbers,
      reason: `the Kuali Action List has no document ${requested}; it listed `
        + (observation.listedDocumentNumbers.length === 0
          ? "no documents at all"
          : `${[...new Set(observation.listedDocumentNumbers)].join(", ")}`)
        + " — a document nobody is holding an action on cannot be separated by this run",
    });
  }
  const hrefs = observation.matchedLinks.map(({ href }) => href ?? "");
  const unlinked = observation.matchedLinks.filter(({ href }) => href === null);
  if (unlinked.length > 0) {
    return KualiActionResolutionVerdictSchema.parse({
      state: "unreadable-link",
      requestedDocumentNumber: requested,
      observedHrefs: hrefs,
      reason: `${String(unlinked.length)} of ${String(observation.matchedLinks.length)} Action-List links for `
        + `document ${requested} carry no href; the action id is only on the page as a link target and `
        + "there is nothing else to read it from",
    });
  }
  const parsed = observation.matchedLinks.map(({ href }) => ({
    href: href ?? "",
    actionId: parseKualiActionHref(href ?? "", observation.space),
  }));
  const unparseable = parsed.filter(({ actionId }) => actionId === undefined);
  if (unparseable.length > 0) {
    return KualiActionResolutionVerdictSchema.parse({
      state: "unreadable-link",
      requestedDocumentNumber: requested,
      observedHrefs: hrefs,
      reason: `Action-List link(s) for document ${requested} do not address `
        + `/build/space/${observation.space}/actions/<actionId>: `
        + `${unparseable.map(({ href }) => `"${href}"`).join(", ")}`,
    });
  }
  const actionIds = [...new Set(parsed.flatMap(({ actionId }) => actionId === undefined ? [] : [actionId]))];
  const first = actionIds[0];
  if (first === undefined || actionIds.length > 1) {
    return KualiActionResolutionVerdictSchema.parse({
      state: "ambiguous",
      requestedDocumentNumber: requested,
      actionIds,
      reason: `the Kuali Action List offers ${String(actionIds.length)} different actions for document `
        + `${requested} (${actionIds.join(", ")}); a run cannot choose which workflow step it is filing `
        + "against, and choosing for it is how the wrong document gets written",
    });
  }
  const href = parsed[0]?.href;
  if (href === undefined || href.length === 0) {
    return KualiActionResolutionVerdictSchema.parse({
      state: "unreadable-link",
      requestedDocumentNumber: requested,
      observedHrefs: hrefs,
      reason: `document ${requested} resolved an action id with no href behind it`,
    });
  }
  return KualiActionResolutionVerdictSchema.parse({
    state: "resolved",
    resolution: {
      pageStateId: KUALI_ACTION_LIST_READY,
      documentNumber: requested,
      actionId: first,
      actionHref: href,
      matchedLinkCount: observation.matchedLinks.length,
      observedAt: observation.observedAt,
    },
  });
}

/** The driver operation the resolve task calls. */
export const ReadActionListForDocumentOperationSchema = z.custom<(
  input: Readonly<{ documentNumber: string }>,
) => Promise<KualiActionListObservation>>((value) => typeof value === "function");
