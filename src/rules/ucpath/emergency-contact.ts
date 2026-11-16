import type { UcpathContactPageSnapshot } from "../../models/ui/ucpath-emergency-contact.js";
import type { OcrReviewRecordSchema } from "../../models/ocr/review-record.js";
import type { z } from "zod";
import { EidSchema, FingerprintSchema } from "../identity/ids.js";
import { canonicalJsonStringify } from "../validation/canonical-json.js";
import { sha256Hex } from "../validation/sha256.js";
import { scoreNameMatch } from "../matching/name-match.js";
import { UcpathContactEffectSchema, UcpathContactRefusedError, UcpathContactRelationshipSchema,
  UcpathContactSetSchema, UcpathEmergencyContactInputSchema, UcpathContactPlanSchema, contactEffectIdentity } from "../../models/systems/ucpath/emergency-contacts.js";
import type { UcpathContactDecision, UcpathContactEffect, UcpathContactRefusalCode, UcpathContactSet,
  UcpathEmergencyContactInput, UcpathContactPlan } from "../../models/systems/ucpath/emergency-contacts.js";
function refuse(code: UcpathContactRefusalCode): never { throw new UcpathContactRefusedError(code); }
export function normalizedName(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

export function sameEffect(a: UcpathContactEffect, b: UcpathContactEffect): boolean {
  return contactEffectIdentity(a) === contactEffectIdentity(b);
}

export function contactSetFingerprint(set: UcpathContactSet): z.infer<typeof FingerprintSchema> {
  return FingerprintSchema.parse(sha256Hex(canonicalJsonStringify({
    emplId: set.emplId, displayedName: set.displayedName, rows: set.rows,
  })));
}

const RELATIONSHIP_LABELS: Readonly<Record<string, z.infer<typeof UcpathContactRelationshipSchema>>> = {
  mother: "Parent", father: "Parent", mom: "Parent", dad: "Parent",
  brother: "Sibling", sister: "Sibling", grandmother: "Grand Parent", grandfather: "Grand Parent",
  grandparent: "Grand Parent", relative: "Other Relative", aunt: "Other Relative", uncle: "Other Relative",
  cousin: "Other Relative", partner: "Domestic Partner Adult", husband: "Spouse", wife: "Spouse",
  son: "Child", daughter: "Child",
};

export function contactEffect(input: UcpathEmergencyContactInput): UcpathContactEffect {
  const contact = UcpathEmergencyContactInputSchema.shape.contact.parse(input.contact);
  if (contact.address.kind === "unspecified") refuse("address-choice-unresolved");
  const key = contact.relationship.trim().toLowerCase();
  const label = UcpathContactRelationshipSchema.options.find(value => value.toLowerCase() === key)
    ?? (Object.hasOwn(RELATIONSHIP_LABELS, key) ? RELATIONSHIP_LABELS[key] : undefined);
  if (label === undefined) refuse("relationship-unmapped");
  return UcpathContactEffectSchema.parse({
    name: contact.name, relationship: label, primary: contact.primary,
    phone: contact.cellPhone ?? contact.homePhone ?? contact.workPhone, address: contact.address,
  });
}

export function decideContactAddition(set: UcpathContactSet, effect: UcpathContactEffect): UcpathContactDecision {
  UcpathContactSetSchema.parse(set);
  UcpathContactEffectSchema.parse(effect);
  if (effect.address.kind === "unspecified") refuse("address-choice-unresolved");
  const contacts = set.rows.filter(row => row.kind === "contact");
  const primary = contacts.filter(row => row.effect.primary);
  if (primary.length > 1) return { state: "conflict", code: "multiple-primary-contacts", rowIndices: primary.map(row => row.rowIndex) };
  const similar = contacts.filter(row => normalizedName(row.effect.name) === normalizedName(effect.name)
    || scoreNameMatch(row.effect.name, effect.name).reason !== "none");
  if (similar.length > 1) return { state: "conflict", code: "ambiguous-contact", rowIndices: similar.map(row => row.rowIndex) };
  const match = similar[0];
  if (match !== undefined) return sameEffect(match.effect, effect)
    ? { state: "already-present", rowIndex: match.rowIndex }
    : { state: "conflict", code: "contact-conflict", rowIndices: [match.rowIndex] };
  if (effect.primary && primary.length > 0) return { state: "conflict", code: "primary-change-required", rowIndices: primary.map(row => row.rowIndex) };
  const blanks = set.rows.filter(row => row.kind === "blank");
  if (blanks.length > 1) return { state: "conflict", code: "ambiguous-blank-rows", rowIndices: blanks.map(row => row.rowIndex) };
  return {
    state: "add", setFingerprint: contactSetFingerprint(set), effect,
    target: blanks[0] === undefined ? { kind: "insert-row" } : { kind: "reuse-blank", rowIndex: blanks[0].rowIndex },
  };
}

export function planEmergencyContact(set: UcpathContactSet, effect: UcpathContactEffect): UcpathContactPlan {
  if (set.observation !== "persisted") refuse("contact-plan-refused");
  const decision = decideContactAddition(set, effect);
  const base = { before: set, effect, setFingerprint: contactSetFingerprint(set) };
  if (decision.state === "already-present") return UcpathContactPlanSchema.parse({ ...base, state: "already-present", rowIndex: decision.rowIndex });
  if (decision.state === "add") return UcpathContactPlanSchema.parse({ ...base, state: "prepare", demotion: null, target: decision.target });
  if (decision.code !== "primary-change-required" || decision.rowIndices.length !== 1) refuse("contact-plan-refused");
  const index = decision.rowIndices[0], existing = set.rows.find(row => row.rowIndex === index);
  if (existing?.kind !== "contact" || !existing.effect.primary
    || set.rows.filter(row => row.kind === "contact" && sameEffect(row.effect, existing.effect)).length !== 1) refuse("contact-plan-refused");
  const demoted = UcpathContactSetSchema.parse({ ...set, rows: set.rows.map(row => row.rowIndex === index && row.kind === "contact"
    ? { ...row, effect: { ...row.effect, primary: false } } : row) });
  const addition = decideContactAddition(demoted, effect);
  if (addition.state !== "add") refuse("contact-plan-refused");
  return UcpathContactPlanSchema.parse({ ...base, state: "prepare", demotion: { rowIndex: index, effect: existing.effect }, target: addition.target });
}

export function contactPlanMatches(plan: UcpathContactPlan, observed: UcpathContactSet, effect: UcpathContactEffect): boolean {
  if (plan.before.observation !== "persisted" || observed.observation !== "persisted"
    || contactSetFingerprint(plan.before) !== plan.setFingerprint || contactSetFingerprint(observed) !== plan.setFingerprint) return false;
  const { before: _originalEvidence, ...approved } = plan;
  const { before: _freshEvidence, ...fresh } = planEmergencyContact(observed, effect);
  return canonicalJsonStringify(approved) === canonicalJsonStringify(fresh);
}

export function contactPlanChanges(plan: UcpathContactPlan): [string] | [string, string] {
  if (plan.state === "already-present") return [`Exact contact already present on row ${String(plan.rowIndex + 1)} (${plan.effect.name})`];
  const addition = `Add ${plan.effect.name}${plan.effect.primary ? " as Primary" : " as a non-primary contact"}`;
  return plan.demotion === null ? [addition] : [`Uncheck Primary on row ${String(plan.demotion.rowIndex + 1)} (${plan.demotion.effect.name})`, addition];
}

export function contactEffects(set: UcpathContactSet): UcpathContactEffect[] {
  return set.rows.flatMap(row => row.kind === "contact" ? [row.effect] : []);
}

export function sameContactMultiset(a: UcpathContactEffect[], b: UcpathContactEffect[]): boolean {
  const remaining = [...b];
  for (const effect of a) {
    const index = remaining.findIndex(value => canonicalJsonStringify(effect) === canonicalJsonStringify(value));
    if (index === -1) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === 0;
}

function contactPlanEffectsMatch(plan: UcpathContactPlan, observed: UcpathContactSet): boolean {
  if (observed.emplId !== plan.before.emplId
    || normalizedName(observed.displayedName) !== normalizedName(plan.before.displayedName)) return false;
  if (plan.state === "already-present") return decideContactAddition(observed, plan.effect).state === "already-present";
  const expected = plan.before.rows.flatMap(row => row.kind !== "contact" ? [] : [{ ...row.effect,
    primary: row.rowIndex === plan.demotion?.rowIndex ? false : row.effect.primary }]);
  expected.push(plan.effect);
  return observed.rows.every(row => row.kind === "contact") && sameContactMultiset(expected, contactEffects(observed));
}

export function contactPlanPresent(plan: UcpathContactPlan, observed: UcpathContactSet): boolean {
  return observed.observation === "persisted" && contactPlanEffectsMatch(plan, observed);
}
export function preparedContactPlanMatches(plan: UcpathContactPlan, observed: UcpathContactSet): boolean {
  return plan.state === "prepare" && observed.observation === "staged" && contactPlanEffectsMatch(plan, observed);
}

/** Compares fixture observations only; it grants no fence, receipt or retry authority. */
export function compareSavedContactAddition(
  before: UcpathContactSet,
  after: UcpathContactSet,
  effect: UcpathContactEffect,
): "present" | "absent" | "ambiguous" | "unknown" {
  UcpathContactSetSchema.parse(before);
  UcpathContactSetSchema.parse(after);
  if (before.observation !== "persisted" || after.emplId !== before.emplId || normalizedName(after.displayedName) !== normalizedName(before.displayedName)
    || after.observation !== "persisted" || Date.parse(after.observedAt) <= Date.parse(before.observedAt)) return "unknown";
  if (decideContactAddition(before, effect).state !== "add") return "unknown";
  const observed = contactEffects(after);
  const matches = observed.filter(value => sameEffect(value, effect));
  if (matches.length > 1) return "ambiguous";
  if (sameContactMultiset(contactEffects(before), contactEffects(after))) return "absent";
  if (matches.length !== 1 || !sameContactMultiset(contactEffects(before), observed.filter(value => value !== matches[0]))) return "unknown";
  if (after.rows.some(row => row.kind === "blank")) return "unknown";
  return "present";
}

export function approvedEmergencyContact(record: z.output<typeof OcrReviewRecordSchema>) {
  function value(path: string, required = false): string | null {
    const answers = record.fields.answers.filter(answer => answer.path === path);
    const answer = answers[0];
    if (answers.length !== 1 || answer === undefined || answer.state === "unreadable"
      || answer.state === "read" && typeof answer.value !== "string"
      || answer.state === "absent" && (required || answer.reason !== "blank")) throw new Error("invalid-approved-contact-field");
    return answer.state === "read" ? String(answer.value) : null;
  }
  return UcpathEmergencyContactInputSchema.parse({ emplId: record.assertedEid, expectedName: value("employee.name", true), contact: {
    name: value("contact.name", true), relationship: value("contact.relationship", true), primary: true,
    cellPhone: value("contact.cellPhone"), homePhone: value("contact.homePhone"), workPhone: value("contact.workPhone"),
    address: { kind: "explicit", fields: { address1: value("contact.address1"), address2: null,
      city: value("contact.city"), state: value("contact.state"), postalCode: value("contact.postalCode"), country: null } },
  } });
}

export function assertContactSubject(
  page: Pick<UcpathContactPageSnapshot, "pageStateId" | "displayedEid" | "displayedName">,
  subject: Pick<UcpathEmergencyContactInput, "emplId" | "expectedName">,
): void {
  if (page.pageStateId !== "ucpath.emergency-contact.editor-ready") refuse("unexpected-contact-page");
  const eid = EidSchema.safeParse(page.displayedEid.trim());
  if (!eid.success || page.displayedName.trim() === "") refuse("contact-identity-unreadable");
  if (eid.data !== subject.emplId) refuse("contact-subject-mismatch");
  if (normalizedName(page.displayedName) !== normalizedName(subject.expectedName)) refuse("contact-name-mismatch");
}

