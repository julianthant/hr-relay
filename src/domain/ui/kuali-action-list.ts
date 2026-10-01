/**
 * Kuali Build — the Action List, read as a DOCUMENT → ACTION resolver (D261).
 *
 * ## Why this surface exists at all
 *
 * Kuali's only address for a document is `…/actions/<actionId>`, and an
 * `actionId` names a workflow STEP rather than a document (2026-08-04,
 * `src/backend/systems/kuali/CLAUDE.md`). So until this module a separations run had to
 * be handed BOTH identifiers, which is what **D260** measured as two varying
 * values per run and therefore no typed start box. The operator's ruling of
 * 2026-08-20 — *"document number should work. no need action id."* — is
 * **D261**: the action is RESOLVED by the graph, from the one number a human
 * knows, through the Action List's own search box.
 *
 * ## What the page actually carries (live-verified 2026-08-20)
 *
 * `…/build/space/<space>/actions` renders a table whose every cell is an
 * anchor at that row's document, so the action id is on the page as an `href`
 * and needs no click to read:
 *
 * ```
 * <a href="/build/space/5e47…/actions/6a766ae6f0549046f7f0dc06">4502</a>
 * ```
 *
 * A row publishes its number TWICE — once in `Document #` and once in
 * `Document Title` — so two matched links for one document is the ORDINARY
 * observation, not an ambiguity. What would be an ambiguity is two DISTINCT
 * action ids behind one number, and that is what this module refuses on.
 *
 * ## The read classifies nothing (D201)
 *
 * The driver returns `KualiActionListObservation` — the matched links verbatim,
 * plus every bare-number link the filtered list rendered — and
 * `classifyKualiActionResolution` decides what it means. The refusal is the
 * load-bearing half: reading a document that is not in the list as "some other
 * action id" would open a DIFFERENT person's separation, so every negative is a
 * named verdict and none of them is a fallback.
 */
import { z } from "zod";
import { IsoInstantSchema, PageStateIdSchema, ScreenIdSchema } from "../ids.js";
import { ElementIdSchema, ObservationIdSchema } from "../ids.js";
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

/**
 * ONE Action-List link, verbatim.
 *
 * `href` is nullable because an anchor without one is a REAL rendering — a
 * Kuali row whose cell is not linked — and the honest record of it is `null`,
 * not an invented path. `classifyKualiActionResolution` refuses on it by name.
 */
export const KualiActionListLinkSchema = z.strictObject({
  /** The link's accessible name, trimmed. */
  name: z.string(),
  /** The `href` attribute exactly as the page carried it, or `null` when absent. */
  href: z.string().nullable(),
});
export type KualiActionListLink = z.infer<typeof KualiActionListLinkSchema>;

/**
 * What the driver saw after filtering the Action List to one document number.
 * It states what is on the page and decides nothing.
 */
export const KualiActionListObservationSchema = z.strictObject({
  pageStateId: z.literal(KUALI_ACTION_LIST_READY),
  /** The space whose Action List was read — the path prefix every href must carry. */
  space: KualiSpaceIdSchema,
  /** The number the run asked for, echoed so a stored observation explains itself. */
  requestedDocumentNumber: KualiDocumentNumberSchema,
  /** Every link whose accessible name is EXACTLY the requested number (anchored). */
  matchedLinks: z.array(KualiActionListLinkSchema),
  /**
   * Every bare-number link the filtered list rendered, in page order and with
   * duplicates kept. On a miss it is what the refusal shows the operator: the
   * Action List's substring search returns neighbours, so "4502 is not here,
   * these are" is a legible sentence and "not found" is not.
   */
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

/**
 * The verdict. Every negative names itself, and there is no arm that answers
 * with an action id the page did not show.
 */
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

/**
 * Parse an Action-List href into its action id.
 *
 * The whole path is required to match `…/build/space/<space>/actions/<24 hex>`.
 * A looser parse — "the last path segment" — would happily read an id out of a
 * pagination or profile link and hand a run a plausible address for the wrong
 * thing, which is the substitution this program bans. Returns `undefined` so
 * the caller decides; it never throws and never guesses.
 */
export function parseKualiActionHref(
  href: string,
  space: string,
): string | undefined {
  const path = href.startsWith("/") ? href : safePathname(href);
  if (path === undefined) return undefined;
  const expected = `/build/space/${space}/actions/`;
  if (!path.startsWith(expected)) return undefined;
  const rest = path.slice(expected.length);
  // Kuali redirects a document route to `…/<actionId>/view`; both spellings
  // name the same action, so the trailing view segment is accepted and nothing
  // else is.
  const segments = rest.split("/");
  const candidate = segments[0];
  if (candidate === undefined) return undefined;
  if (segments.length > 2) return undefined;
  if (segments.length === 2 && segments[1] !== "" && segments[1] !== "view") return undefined;
  const parsed = KualiActionIdSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

/**
 * An href that is neither an absolute path nor an absolute URL is an address
 * this module cannot read. `URL.canParse` ASKS the question rather than
 * throwing it, so there is no catch here to mistake for a swallow — the
 * `undefined` is a verdict the caller turns into a named refusal.
 */
function safePathname(href: string): string | undefined {
  return URL.canParse(href) ? new URL(href).pathname : undefined;
}

/**
 * Decide what the observation means. Pure, exhaustive, and refusal-first.
 *
 * Two links for one document is the ORDINARY row (Kuali publishes the number in
 * both `Document #` and `Document Title`), so the ambiguity test is on DISTINCT
 * action ids — the thing a wrong answer would actually be wrong about.
 */
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
