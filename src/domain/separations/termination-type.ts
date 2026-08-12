/**
 * The Kuali *Type of Termination* → UCPath `{template, reasonCode}` map — the
 * §4a answer, as pure domain logic with **exact matching and no default arm**.
 *
 * ## What this replaces, and why the counterexample is in the code
 *
 * Legacy resolves a reason code through three tiers
 * (`legacy:src/workflows/separations/schema.ts:200-223` @
 * `1bffbd658db34ce84a08e69484db3a40b3658d6e`): an exact map hit, then a
 * **bidirectional substring** match, then the constant `"Resign - No Reason
 * Given"`. The middle tier is the dangerous one, and its own worked example is
 * the reason this file exists: a Kuali type of `"Other"` matches the map key
 * `"Accepted Another Job"` — because `"accepted an`**`other`**` job"` contains
 * `"other"` — and would file a **resignation-for-another-job** reason on a real
 * HR termination, silently, with no warning logged on either path. Vol/Invol
 * defaults the same way: `isVoluntaryTermination` is `!INVOLUNTARY_TYPES.includes(type)`
 * over a three-string deny-list (`legacy:src/systems/kuali/navigate.ts:230-241`),
 * so every type the code has never seen is **voluntary**.
 *
 * Neither tier ports. There is **no substring matching in either direction and
 * no default arm**: an unmapped or blank type is a structured refusal that
 * names the verbatim value. The type is ONE closed enum with ONE
 * `{template, reasonCode}` mapping, which also kills S11's divergent-constant
 * class structurally — legacy carries a second, two-entry `INVOLUNTARY_TYPES`
 * (`legacy:src/workflows/separations/config.ts:25-28`) exported through its
 * barrel and waiting to be picked up by mistake.
 *
 * ## Why the map can be exhaustive at all
 *
 * The complete option list was captured live, read-only, on **2026-08-12** from
 * the `Type of Termination*` control of real RRSS separation documents 4510,
 * 4502 and 4495 — three documents at two different workflow steps, all serving
 * the IDENTICAL 17-option list (16 real options plus Kuali's `- - -` blank
 * sentinel). It is recorded in `docs/migrations/separations.md` §9.3 with its
 * observation date, and `KUALI_TERMINATION_TYPE_OPTIONS` below is that capture.
 *
 * Two findings from comparing the capture with legacy's map, both recorded in
 * the migration doc:
 *
 *  - **`Death` is not an option on this form at all.** §4a's worked example
 *    (`Death` → voluntary `Resign - No Reason Given`) cannot arise from this
 *    dropdown. The hazard was real in shape and absent in fact.
 *  - **`Never Started Employment` is genuinely unmapped, and legacy misfiles
 *    it.** It is in legacy's involuntary deny-list but NOT in its
 *    `REASON_CODE_MAP`, and no fuzzy tier matches it, so legacy files an
 *    **involuntary** template with the **voluntary** default reason
 *    `Resign - No Reason Given`. UCPath's own INVOL_TERM list does carry a
 *    `Never Started Employment` reason code (per legacy's own comment block),
 *    but nobody in this repository has verified that pairing against the live
 *    UCPath control, and inventing it here is precisely what §4a forbids. It is
 *    therefore an EXPLICIT unmapped entry with its reason, and a run on it
 *    refuses by name until the operator confirms the code.
 *
 * ## The operational cost, accepted explicitly (§4a)
 *
 * If Kuali adds or renames an option, runs on that option **fail** until this
 * map is extended. `auditTerminationTypeOptionList` makes that mechanical: a
 * run compares the option list it actually observed against this capture and
 * refuses on any drift, so a new option is discovered by the first run that
 * sees it rather than by a wrong reason code nobody downstream can see.
 */
import { z } from "zod";

/** The UCPath termination template the transaction is filed under. */
export const UcpathTerminationTemplateSchema = z.enum(["UC_VOL_TERM", "UC_INVOL_TERM"]);
export type UcpathTerminationTemplate = z.infer<typeof UcpathTerminationTemplateSchema>;

export const TerminationClassificationSchema = z.enum(["voluntary", "involuntary"]);
export type TerminationClassification = z.infer<typeof TerminationClassificationSchema>;

/**
 * The COMPLETE `Type of Termination*` option list, verbatim, as captured live
 * 2026-08-12. Order is the DOM order of the `<option>` nodes — Kuali does not
 * sort it, and preserving the observed order is what lets a run compare the
 * live list against this one without inventing a canonical ordering.
 *
 * `- - -` is Kuali's blank sentinel and is deliberately included: it is part of
 * what the control renders, and a run that observed a list WITHOUT it observed
 * a different control.
 */
export const KUALI_TERMINATION_TYPE_OPTIONS: readonly string[] = Object.freeze([
  "- - -",
  "Accepted Another Job",
  "Attend School",
  "Dissatisfied w/Job",
  "Look for Another Job",
  "Military Service",
  "Move out of Area",
  "Never Started Employment",
  "No Reason Given",
  "Personal Reasons",
  "Quit without Notice",
  "Retirement",
  "Self-Employment",
  "Transferring to a different UCSD department (outside of RRSS)",
  "Transferring to another UC Campus (outside of UCSD)",
  "Graduated/No longer a Student",
  "Appointment Expired",
]);

/** Kuali's own "nothing selected" option text. */
export const KUALI_TERMINATION_TYPE_BLANK_OPTION = "- - -";

interface MappedTerminationType {
  readonly kind: "mapped";
  readonly classification: TerminationClassification;
  readonly template: UcpathTerminationTemplate;
  readonly reasonCode: string;
}
interface UnmappedTerminationType {
  readonly kind: "unmapped";
  /** Why this captured option has no reason code, in the refusal's own words. */
  readonly reason: string;
}
type TerminationTypeEntry = MappedTerminationType | UnmappedTerminationType;

function voluntary(reasonCode: string): TerminationTypeEntry {
  return { kind: "mapped", classification: "voluntary", template: "UC_VOL_TERM", reasonCode };
}
function involuntary(reasonCode: string): TerminationTypeEntry {
  return { kind: "mapped", classification: "involuntary", template: "UC_INVOL_TERM", reasonCode };
}

/**
 * The map, keyed by the EXACT option text. Every captured option has an entry —
 * a `mapped` one or an explicitly reasoned `unmapped` one — which is what makes
 * "exhaustive" a checkable property rather than a claim
 * (`auditTerminationTypeMapCoverage`).
 *
 * The reason codes are legacy's exact-tier entries, ported verbatim from
 * `legacy:src/workflows/separations/schema.ts:177-195` @ `1bffbd65`; the
 * classification is legacy's three-entry `INVOLUNTARY_TYPES`
 * (`legacy:src/systems/kuali/navigate.ts:230-241`). Only the FALL-THROUGH is
 * dropped, and dropping it is the whole decision.
 */
const TERMINATION_TYPE_MAP: Readonly<Record<string, TerminationTypeEntry>> = Object.freeze({
  [KUALI_TERMINATION_TYPE_BLANK_OPTION]: {
    kind: "unmapped",
    reason: "the document's Type of Termination is unset (Kuali's blank `- - -` option), so there is "
      + "nothing to map; the separation form has to be completed before a termination can be filed",
  },
  "Accepted Another Job": voluntary("Resign - Accept Another Job"),
  "Attend School": voluntary("Resign - Attend School"),
  "Dissatisfied w/Job": voluntary("Resign - Dissatisfied w/ Job"),
  "Look for Another Job": voluntary("Resign - Look For Another Job"),
  "Military Service": voluntary("Resign - Military Service"),
  "Move out of Area": voluntary("Resign - Moved out of Area"),
  "Never Started Employment": {
    kind: "unmapped",
    reason: "legacy classifies this INVOLUNTARY but has no reason-code entry for it, so it files the "
      + "voluntary default `Resign - No Reason Given` under `UC_INVOL_TERM`. UCPath's involuntary "
      + "reason list does carry a `Never Started Employment` code, but that pairing has never been "
      + "verified against the live UCPath control by this repository and §4a forbids inventing one",
  },
  "No Reason Given": voluntary("Resign - No Reason Given"),
  "Personal Reasons": voluntary("Resign - Personal Reasons"),
  "Quit without Notice": voluntary("Resign - Quit Without Notice"),
  "Retirement": voluntary("Voluntary Separation Program"),
  "Self-Employment": voluntary("Resign - Self Employment"),
  "Transferring to a different UCSD department (outside of RRSS)": voluntary("Transfer - Intra Location"),
  "Transferring to another UC Campus (outside of UCSD)": voluntary("Interlocation (BU) Transfer"),
  "Graduated/No longer a Student": involuntary("No Longer Student"),
  "Appointment Expired": involuntary("Appointment Expired"),
});

export const TerminationTypeResolutionSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("resolved"),
    /** The Kuali option text this resolution was keyed by, verbatim. */
    terminationType: z.string().min(1),
    classification: TerminationClassificationSchema,
    template: UcpathTerminationTemplateSchema,
    reasonCode: z.string().min(1),
  }),
  z.strictObject({
    state: z.literal("refused"),
    /**
     * A closed reason vocabulary, because these three are operationally
     * different: the form is incomplete, the map is missing a code the operator
     * has to supply, or Kuali published an option nobody has seen.
     */
    code: z.enum(["blank-termination-type", "unmapped-termination-type", "unknown-termination-type"]),
    /** What the document actually said, quoted back so the refusal is actionable. */
    terminationType: z.string(),
    reason: z.string().min(1),
  }),
]);
export type TerminationTypeResolution = z.infer<typeof TerminationTypeResolutionSchema>;

/**
 * Resolve one verbatim Kuali termination type. EXACT match only.
 *
 * Nothing here trims, lowercases, or normalizes the input before matching: the
 * driver already trims what it reads off the control, and a normalization step
 * at this layer would be a second, quieter kind of fuzzy match.
 */
export function resolveTerminationType(terminationType: string): TerminationTypeResolution {
  const entry = TERMINATION_TYPE_MAP[terminationType];
  if (entry === undefined) {
    return TerminationTypeResolutionSchema.parse({
      state: "refused",
      code: "unknown-termination-type",
      terminationType,
      reason: `${JSON.stringify(terminationType)} is not one of the `
        + `${String(KUALI_TERMINATION_TYPE_OPTIONS.length)} Type of Termination options captured live on `
        + "2026-08-12. Either Kuali published a new or renamed option, or this value did not come from "
        + "that control. Refusing to guess a UCPath template or reason code — a wrong reason code on a "
        + "filed termination is invisible to everyone downstream.",
    });
  }
  if (entry.kind === "unmapped") {
    return TerminationTypeResolutionSchema.parse({
      state: "refused",
      code: terminationType === KUALI_TERMINATION_TYPE_BLANK_OPTION
        ? "blank-termination-type"
        : "unmapped-termination-type",
      terminationType,
      reason: `${JSON.stringify(terminationType)} carries no UCPath reason code in this map: ${entry.reason}.`,
    });
  }
  return TerminationTypeResolutionSchema.parse({
    state: "resolved",
    terminationType,
    classification: entry.classification,
    template: entry.template,
    reasonCode: entry.reasonCode,
  });
}

/**
 * Every captured option must have an entry, and every entry must be a captured
 * option. A map key nobody can select is as much a defect as a selectable
 * option nobody mapped — the first is dead weight that looks like coverage.
 */
export function auditTerminationTypeMapCoverage(): readonly string[] {
  const issues: string[] = [];
  const keys = Object.keys(TERMINATION_TYPE_MAP);
  for (const option of KUALI_TERMINATION_TYPE_OPTIONS) {
    if (!keys.includes(option)) issues.push(`captured option ${JSON.stringify(option)} has no map entry`);
  }
  for (const key of keys) {
    if (!KUALI_TERMINATION_TYPE_OPTIONS.includes(key)) {
      issues.push(`map entry ${JSON.stringify(key)} is not a captured live option`);
    }
  }
  return issues;
}

export const TerminationTypeOptionAuditSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("matches") }),
  z.strictObject({
    state: z.literal("drifted"),
    added: z.array(z.string().min(1)),
    removed: z.array(z.string().min(1)),
    reordered: z.boolean(),
  }),
]);
export type TerminationTypeOptionAudit = z.infer<typeof TerminationTypeOptionAuditSchema>;

/**
 * Compare the option list a run actually observed against the captured one.
 *
 * This is §4a's accepted operational cost made mechanical. Without it, a new
 * Kuali option is discovered only when somebody happens to select it; with it,
 * the FIRST run that stands in front of the changed control refuses and names
 * the difference — including a pure REORDER, which is not dangerous by itself
 * but means the control was republished and the map deserves a second look.
 */
export function auditTerminationTypeOptionList(
  observed: readonly string[],
): TerminationTypeOptionAudit {
  const captured = KUALI_TERMINATION_TYPE_OPTIONS;
  const added = observed.filter((option) => !captured.includes(option));
  const removed = captured.filter((option) => !observed.includes(option));
  const reordered = added.length === 0 && removed.length === 0
    && observed.join("\u0000") !== captured.join("\u0000");
  if (added.length === 0 && removed.length === 0 && !reordered) {
    return TerminationTypeOptionAuditSchema.parse({ state: "matches" });
  }
  return TerminationTypeOptionAuditSchema.parse({ state: "drifted", added, removed, reordered });
}
