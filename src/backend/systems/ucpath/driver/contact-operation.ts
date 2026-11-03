import { sameEffect, contactEffects, sameContactMultiset, contactSetFingerprint,
  contactEffect, decideContactAddition, contactPlanMatches, assertContactSubject } from "../../../../rules/ucpath/emergency-contact.js";
import { EidSchema, IsoInstantSchema } from "../../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { normalizePhoneDigitsRule } from "../../../../rules/normalization/contact-rules.js";
import {
  UcpathContactEffectSchema, UcpathContactRefusedError, UcpathContactRelationshipSchema,
  UcpathContactSetSchema,
  UcpathContactPlanSchema,
} from "../../../../models/systems/ucpath/emergency-contacts.js";
import type {
  UcpathContactDecision, UcpathContactEffect, UcpathContactRefusalCode,
  UcpathContactRow, UcpathContactSet, UcpathEmergencyContactInput,
  UcpathContactPlan,
} from "../../../../models/systems/ucpath/emergency-contacts.js";
import { UcpathContactPageSnapshotSchema } from "../../../../models/ui/ucpath-emergency-contact.js";
import type { UcpathContactPageSnapshot } from "../../../../models/ui/ucpath-emergency-contact.js";

/** Preparation exposes no Save operation. */
export interface UcpathContactPagePort {
  snapshot(): Promise<UcpathContactPageSnapshot>;
  viewAll(): Promise<void>;
  addBlankRow(): Promise<void>;
  fillFields(rowIndex: number, effect: Omit<UcpathContactEffect, "name">): Promise<void>;
  fillName(rowIndex: number, name: string): Promise<void>;
  demotePrimary(rowIndex: number, expected: UcpathContactEffect): Promise<void>;
}

function refuse(code: UcpathContactRefusalCode): never {
  throw new UcpathContactRefusedError(code);
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

export async function stageContactPlanWithPort(port: UcpathContactPagePort, input: UcpathEmergencyContactInput, candidate: UcpathContactPlan): Promise<UcpathContactSet> {
  const plan = UcpathContactPlanSchema.parse(candidate);
  const before = await readContactSetWithPort(port, input);
  if (before.observation !== "persisted" || contactSetFingerprint(before) !== plan.setFingerprint
    || !contactPlanMatches(plan, before, contactEffect(input))
    || plan.state !== "prepare") refuse("contact-plan-refused");
  let prepared = before;
  if (plan.demotion !== null) {
    await port.demotePrimary(plan.demotion.rowIndex, plan.demotion.effect);
    prepared = await readContactSetWithPort(port, input);
    const expectedRows = before.rows.map(row => row.rowIndex === plan.demotion?.rowIndex && row.kind === "contact"
      ? { ...row, effect: { ...row.effect, primary: false } } : row);
    if (prepared.observation !== "staged" || canonicalJsonStringify(prepared.rows) !== canonicalJsonStringify(expectedRows)) refuse("staged-effect-mismatch");
  }
  const addition = decideContactAddition(prepared, plan.effect);
  if (addition.state !== "add" || canonicalJsonStringify(addition.target) !== canonicalJsonStringify(plan.target)) refuse("contact-plan-refused");
  return stageContactAdditionWithPort(port, input, addition);
}
