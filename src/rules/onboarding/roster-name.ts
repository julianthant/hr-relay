import type { z } from "zod";
import type { OnboardingRosterSnapshotRowSchema } from "../../models/workflows/onboarding/roster.js";
import type { CrmHireFields } from "../../models/systems/crm/read-hire-data.js";

export class RosterNameUnresolvedError extends Error {
  constructor() { super("Roster name cannot be split against the CRM record"); }
}

type RosterPersonName = Readonly<{ firstName: string; middleName: string; lastName: string }>;
type Anchors = Readonly<{ last: readonly string[]; first: readonly string[]; middle: readonly string[] }>;

const words = (value: string) => value.split(/\s+/u).filter(word => word !== "");
const key = (word: string) => word.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const matches = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((word, index) => key(word) === key(right[index] ?? ""));
const anchorWords = (anchors: readonly string[]) => anchors.map(words).filter(anchor => anchor.length > 0);

function splitGiven(given: readonly string[], anchors: Anchors): Pick<RosterPersonName, "firstName" | "middleName"> {
  const n = given.length;
  if (n === 1) return { firstName: given[0] ?? "", middleName: "" };
  const points = new Set<number>();
  for (const anchor of anchorWords(anchors.first)) if (anchor.length <= n && matches(given.slice(0, anchor.length), anchor)) points.add(anchor.length);
  for (const anchor of anchorWords(anchors.middle)) {
    if (anchor.length < n && matches(given.slice(n - anchor.length), anchor)) points.add(n - anchor.length);
    const initial = anchor.length === 1 ? key(anchor[0] ?? "") : "";
    if (initial.length === 1 && initial === key(given[n - 1] ?? "").charAt(0)) points.add(n - 1);
  }
  const [point] = points;
  if (points.size !== 1 || point === undefined) throw new RosterNameUnresolvedError();
  return { firstName: given.slice(0, point).join(" "), middleName: given.slice(point).join(" ") };
}

/** Split a whole roster name cell, accepting only a split its own comma or a CRM anchor proves. */
export function splitRosterName(name: string, anchors: Anchors): RosterPersonName {
  const sides = name.split(",");
  if (sides.length > 2) throw new RosterNameUnresolvedError();
  if (sides.length === 2) {
    const last = words(sides[0] ?? ""), given = words(sides[1] ?? "");
    if (last.length === 0 || given.length === 0) throw new RosterNameUnresolvedError();
    return { ...splitGiven(given, anchors), lastName: last.join(" ") };
  }
  const all = words(name);
  const [last] = anchorWords(anchors.last).filter(anchor => anchor.length < all.length && matches(all.slice(all.length - anchor.length), anchor))
    .sort((left, right) => right.length - left.length);
  if (last === undefined) throw new RosterNameUnresolvedError();
  return { ...splitGiven(all.slice(0, all.length - last.length), anchors), lastName: all.slice(all.length - last.length).join(" ") };
}

/** `crm` holds the CRM name fields after placeholder cleaning. */
export function rosterHireNames(references: z.output<typeof OnboardingRosterSnapshotRowSchema>["references"],
  crm: Pick<CrmHireFields, "firstName" | "middleName" | "lastName">): { legal: RosterPersonName; preferred: RosterPersonName } {
  const legal = splitRosterName(references.legalName, { last: [crm.lastName], first: [crm.firstName], middle: [crm.middleName] });
  const lived = references.livedName;
  if (lived === null || matches(words(lived), words(references.legalName))) return { legal, preferred: legal };
  if (!lived.includes(",") && matches(words(lived), words(crm.firstName))) {
    return { legal, preferred: { firstName: words(lived).join(" "), middleName: "", lastName: legal.lastName } };
  }
  return { legal, preferred: splitRosterName(lived, { last: [legal.lastName, crm.lastName], first: [crm.firstName, legal.firstName],
    middle: [legal.middleName, crm.middleName] }) };
}
