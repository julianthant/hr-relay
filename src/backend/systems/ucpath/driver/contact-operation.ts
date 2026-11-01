import type { z } from "zod";
import { EidSchema, FingerprintSchema, IsoInstantSchema } from "../../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../rules/validation/sha256.js";
import { scoreNameMatch } from "../../../../rules/matching/name-match.js";
import { normalizePhoneDigitsRule } from "../../../../rules/normalization/contact-rules.js";
import {
  UcpathContactEffectSchema, UcpathContactRefusedError, UcpathContactRelationshipSchema,
  UcpathContactSetSchema, UcpathEmergencyContactInputSchema,
} from "../../../../models/systems/ucpath/emergency-contacts.js";
import type {
  UcpathContactDecision, UcpathContactEffect, UcpathContactRefusalCode,
  UcpathContactRow, UcpathContactSet, UcpathEmergencyContactInput,
} from "../../../../models/systems/ucpath/emergency-contacts.js";
import { UcpathContactPageSnapshotSchema } from "../../../../models/ui/ucpath-emergency-contact.js";
import type { UcpathContactPageSnapshot } from "../../../../models/ui/ucpath-emergency-contact.js";

/** Fixture seam for editor preparation; no save or primary-change operation is exposed. */
export interface UcpathContactPagePort {
  snapshot(): Promise<UcpathContactPageSnapshot>;
  viewAll(): Promise<void>;
  addBlankRow(): Promise<void>;
  fillFields(rowIndex: number, effect: Omit<UcpathContactEffect, "name">): Promise<void>;
  fillName(rowIndex: number, name: string): Promise<void>;
}

function refuse(code: UcpathContactRefusalCode): never {
  throw new UcpathContactRefusedError(code);
}

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function sameEffect(a: UcpathContactEffect, b: UcpathContactEffect): boolean {
  return canonicalJsonStringify({ ...a, name: normalizedName(a.name) })
    === canonicalJsonStringify({ ...b, name: normalizedName(b.name) });
}

function assertContactSubject(
  page: UcpathContactPageSnapshot,
  subject: Pick<UcpathEmergencyContactInput, "emplId" | "expectedName">,
): void {
  if (page.pageStateId !== "ucpath.emergency-contact.editor-ready") refuse("unexpected-contact-page");
  const eid = EidSchema.safeParse(page.displayedEid.trim());
  if (!eid.success || page.displayedName.trim() === "") refuse("contact-identity-unreadable");
  if (eid.data !== subject.emplId) refuse("contact-subject-mismatch");
  if (normalizedName(page.displayedName) !== normalizedName(subject.expectedName)) refuse("contact-name-mismatch");
}

function contactRowFields(row: UcpathContactPageSnapshot["rows"][number]): Omit<UcpathContactEffect, "name"> {
  if (row.sameAddressAsEmployee && row.address === null) refuse("unreadable-contact-row");
  const relationship = UcpathContactRelationshipSchema.safeParse(row.relationship.trim());
  if (!relationship.success) refuse("unreadable-contact-row");
  return {
    relationship: relationship.data, primary: row.primary,
    phone: phone(row.phone),
    address: row.address === null ? { kind: "unspecified" } : {
      kind: row.sameAddressAsEmployee ? "same-as-employee" : "explicit", fields: row.address,
    },
  };
}

function phone(raw: string): string | null {
  if (raw.trim() === "") return null;
  const digits = normalizePhoneDigitsRule(raw);
  if (digits === null) refuse("unreadable-contact-row");
  return digits;
}

export function contactSetFingerprint(set: UcpathContactSet): z.infer<typeof FingerprintSchema> {
  return FingerprintSchema.parse(sha256Hex(canonicalJsonStringify({
    emplId: set.emplId, displayedName: set.displayedName, rows: set.rows,
  })));
}

export function interpretContactPage(
  raw: UcpathContactPageSnapshot,
  subject: Pick<UcpathEmergencyContactInput, "emplId" | "expectedName">,
  viewAll: UcpathContactSet["viewAll"] = "already-complete",
): UcpathContactSet {
  const page = UcpathContactPageSnapshotSchema.parse(raw);
  assertContactSubject(page, subject);
  if (page.view !== "all" || page.rows.length === 0 || page.totalRows !== page.rows.length
    || page.rows.some((row, i) => row.rowIndex !== i)) refuse("contact-set-incomplete");
  const rows: UcpathContactRow[] = page.rows.map(row => {
    if (row.name.trim() === "" && row.relationship.trim() === "" && row.phone.trim() === "" && row.address === null) {
      return { kind: "blank", rowIndex: row.rowIndex, primary: row.primary, sameAddressAsEmployee: row.sameAddressAsEmployee };
    }
    const parsed = UcpathContactEffectSchema.safeParse({ name: row.name.trim(), ...contactRowFields(row) });
    if (!parsed.success) refuse("unreadable-contact-row");
    return { kind: "contact", rowIndex: row.rowIndex, effect: parsed.data };
  });
  return UcpathContactSetSchema.parse({
    pageStateId: page.pageStateId, emplId: EidSchema.parse(page.displayedEid.trim()), displayedName: page.displayedName.trim(),
    observation: page.observation, viewAll, rows, rowCount: page.totalRows,
    observedAt: IsoInstantSchema.parse(page.observedAt),
  });
}

export async function readContactSetWithPort(
  port: Pick<UcpathContactPagePort, "snapshot" | "viewAll">,
  subject: Pick<UcpathEmergencyContactInput, "emplId" | "expectedName">,
): Promise<UcpathContactSet> {
  const initial = UcpathContactPageSnapshotSchema.parse(await port.snapshot());
  assertContactSubject(initial, subject);
  if (initial.view === "all") return interpretContactPage(initial, subject);
  await port.viewAll();
  return interpretContactPage(await port.snapshot(), subject, "expanded");
}

const RELATIONSHIP_LABELS: Readonly<Record<string, z.infer<typeof UcpathContactRelationshipSchema>>> = {
  mother: "Parent", father: "Parent", mom: "Parent", dad: "Parent",
  brother: "Sibling", sister: "Sibling", grandmother: "Grand Parent", grandfather: "Grand Parent",
  grandparent: "Grand Parent", relative: "Other Relative", aunt: "Other Relative", uncle: "Other Relative",
  cousin: "Other Relative", partner: "Domestic Partner Adult", husband: "Spouse", wife: "Spouse",
  son: "Child", daughter: "Child",
};

export function contactEffect(input: UcpathEmergencyContactInput): UcpathContactEffect {
  const { contact } = UcpathEmergencyContactInputSchema.parse(input);
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

function contactEffects(set: UcpathContactSet): UcpathContactEffect[] {
  return set.rows.flatMap(row => row.kind === "contact" ? [row.effect] : []);
}

function sameContactMultiset(a: UcpathContactEffect[], b: UcpathContactEffect[]): boolean {
  const remaining = [...b];
  for (const effect of a) {
    const index = remaining.findIndex(value => canonicalJsonStringify(effect) === canonicalJsonStringify(value));
    if (index === -1) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === 0;
}

export async function stageContactAdditionWithPort(
  port: UcpathContactPagePort,
  input: UcpathEmergencyContactInput,
  expected: Extract<UcpathContactDecision, { state: "add" }>,
): Promise<UcpathContactSet> {
  const effect = contactEffect(input);
  const before = await readContactSetWithPort(port, input);
  if (contactSetFingerprint(before) !== expected.setFingerprint) refuse("contact-set-changed");
  const decision = decideContactAddition(before, effect);
  if (decision.state !== "add" || canonicalJsonStringify(decision) !== canonicalJsonStringify(expected)) refuse("contact-plan-refused");
  if (decision.target.kind === "insert-row") await port.addBlankRow();
  const ready = await readContactSetWithPort(port, input);
  if (!sameContactMultiset(contactEffects(before), contactEffects(ready))) refuse("contact-set-changed");
  const blanks = ready.rows.filter(row => row.kind === "blank");
  if (blanks.length !== 1) refuse("blank-row-unavailable");
  const target = blanks[0];
  if (decision.target.kind === "reuse-blank" && target.rowIndex !== decision.target.rowIndex) refuse("contact-set-changed");
  const { name, ...fields } = effect;
  await port.fillFields(target.rowIndex, fields);
  const afterFields = UcpathContactPageSnapshotSchema.parse(await port.snapshot());
  assertContactSubject(afterFields, input);
  if (afterFields.view !== "all" || afterFields.totalRows !== ready.rowCount
    || afterFields.rows.length !== ready.rowCount
    || afterFields.rows.some((row, i) => row.rowIndex !== i)) refuse("contact-set-changed");
  const prepared = afterFields.rows[target.rowIndex];
  if (prepared === undefined || prepared.name.trim() !== ""
    || canonicalJsonStringify(contactRowFields(prepared)) !== canonicalJsonStringify(fields)) refuse("staged-effect-mismatch");
  const protectedRows = ready.rows.filter(row => row.rowIndex !== target.rowIndex);
  for (const row of protectedRows) {
    const raw = afterFields.rows.find(value => value.rowIndex === row.rowIndex);
    if (raw === undefined) refuse("contact-set-changed");
    if (row.kind !== "contact" || canonicalJsonStringify({ name: raw.name.trim(), ...contactRowFields(raw) })
      !== canonicalJsonStringify(row.effect)) refuse("contact-set-changed");
  }
  await port.fillName(target.rowIndex, name);
  const afterName = UcpathContactPageSnapshotSchema.parse(await port.snapshot());
  assertContactSubject(afterName, input);
  if (afterName.rows.find(row => row.rowIndex === target.rowIndex)?.name.trim() !== name.trim()) refuse("contact-name-lost");
  const staged = interpretContactPage(afterName, input);
  const actual = staged.rows[target.rowIndex];
  if (actual?.kind !== "contact" || !sameEffect(actual.effect, effect)
    || staged.observation !== "staged"
    || staged.rowCount !== ready.rowCount || staged.rows.some(row => row.kind === "blank")
    || !sameContactMultiset(contactEffects(before), staged.rows.flatMap(row =>
      row.kind === "contact" && row.rowIndex !== target.rowIndex ? [row.effect] : []))) refuse("staged-effect-mismatch");
  return staged;
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
