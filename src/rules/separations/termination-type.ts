/** The Kuali *Type of Termination* → UCPath `{template, reasonCode}` map, as pure domain logic with **exact matching and no default arm**. */
import { z } from "zod";

/** The UCPath termination template the transaction is filed under. */
export const UcpathTerminationTemplateSchema = z.enum(["UC_VOL_TERM", "UC_INVOL_TERM"]);
export type UcpathTerminationTemplate = z.infer<typeof UcpathTerminationTemplateSchema>;

export const TerminationClassificationSchema = z.enum(["voluntary", "involuntary"]);
export type TerminationClassification = z.infer<typeof TerminationClassificationSchema>;

/** Preserve exact DOM option order, including the blank option, to detect a different control. */
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
    /* Which refusal this entry is; it lives on the ENTRY rather than being inferred from the option text, so reachability is a question about the table's DATA. */
  readonly code: "blank-termination-type" | "unmapped-termination-type";
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

/** The map, keyed by the EXACT option text; every captured option has an entry — a `mapped` one or an explicitly reasoned `unmapped` one — which is what makes "exhaustive" a checkable property. */
const TERMINATION_TYPE_MAP: Readonly<Record<string, TerminationTypeEntry>> = Object.freeze({
  [KUALI_TERMINATION_TYPE_BLANK_OPTION]: {
    kind: "unmapped",
    code: "blank-termination-type",
    reason: "the document's Type of Termination is unset (Kuali's blank `- - -` option), so there is "
      + "nothing to map; the separation form has to be completed before a termination can be filed",
  },
  "Accepted Another Job": voluntary("Resign - Accept Another Job"),
  "Attend School": voluntary("Resign - Attend School"),
  "Dissatisfied w/Job": voluntary("Resign - Dissatisfied w/ Job"),
  "Look for Another Job": voluntary("Resign - Look For Another Job"),
  "Military Service": voluntary("Resign - Military Service"),
  "Move out of Area": voluntary("Resign - Moved out of Area"),
    // UC_INVOL_TERM uses the descriptive Action Reason label; NSE means Never Started Employment.
  "Never Started Employment": involuntary("NSE"),
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
      /* Distinguish incomplete forms, missing mappings and unseen control options. */
    code: z.enum(["blank-termination-type", "unmapped-termination-type", "unknown-termination-type"]),
    /** What the document actually said, quoted back so the refusal is actionable. */
    terminationType: z.string(),
    reason: z.string().min(1),
  }),
]);
export type TerminationTypeResolution = z.infer<typeof TerminationTypeResolutionSchema>;

/** Resolve one verbatim Kuali termination type; EXACT match only — nothing trims, lowercases, or normalizes before matching, so there is no second, quieter fuzzy match. */
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
      code: entry.code,
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

/** Every captured option must have an entry, and every entry must be a captured option; a map key nobody can select is dead weight that looks like coverage. */
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

/** Compare the option list a run actually observed against the captured one, so the FIRST run that stands in front of a changed control refuses and names the difference — including a pure REORDER. */
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
