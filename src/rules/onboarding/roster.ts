import type { z } from "zod";
import { RunWorkbookReferenceSchema, parseRunWorkbookReference } from "../../models/dashboard/workbooks.js";
import { type SchemaBoundCanonicalValue } from "../../models/validation/schema-bound-value.js";
import { collapseWhitespace } from "../../models/fields/cell-coercion.js";
import { ONBOARDING_ROSTER_FIELDS, ONBOARDING_ROSTER_TYPE_ID, OnboardingRosterReadOutputSchema,
  OnboardingRosterReferenceBindingSchema, OnboardingRosterSnapshotRowSchema } from "../../models/workflows/onboarding/roster.js";
import { canonicalJsonStringify } from "../validation/canonical-json.js";
import { sha256Hex } from "../validation/sha256.js";

type Reference = z.infer<typeof RunWorkbookReferenceSchema>;
type Match = Reference["snapshot"]["rows"][number]["matches"][number];

export function onboardingRosterRow(binding: z.input<typeof OnboardingRosterReferenceBindingSchema>, match: Match) {
  const values = match.values;
  if (values.email !== binding.rowKey.email) throw new Error("onboarding-roster-key-mismatch");
  const legal = values.fullName, lived = values.livedName;
  const livedName = typeof lived === "string" ? collapseWhitespace(lived) : lived;
  return OnboardingRosterSnapshotRowSchema.parse({
    binding: { ...binding, sheetId: match.sheetId, rowId: match.rowId },
    references: {
      legalName: typeof legal === "string" ? collapseWhitespace(legal) : legal,
      livedName: livedName === null || livedName === "" ? null : livedName,
    },
  });
}

export function bindOnboardingRoster(bound: SchemaBoundCanonicalValue, email: string, capturedAt: string) {
  const reference = parseRunWorkbookReference(bound);
  if ("mode" in reference.request) throw new Error("onboarding-roster-reference-invalid");
  const { request, snapshot } = reference;
  const selection = "selectedRow" in request ? request.selectedRow : undefined;
  if (request.typeId !== ONBOARDING_ROSTER_TYPE_ID || snapshot.type.keyFieldId !== "email"
    || request.keys.length !== 1 || request.keys[0] !== email
    || request.fields.length !== ONBOARDING_ROSTER_FIELDS.length
    || ONBOARDING_ROSTER_FIELDS.some(field => !request.fields.includes(field) || !snapshot.type.fields.includes(field))) {
    throw new Error("onboarding-roster-reference-invalid");
  }
  const binding = OnboardingRosterReferenceBindingSchema.parse({
    workbookType: snapshot.type.id, workbookId: snapshot.libraryId, workbookVersion: snapshot.version,
    referenceDigest: sha256Hex(canonicalJsonStringify(bound)), capturedAt, rowKey: { email },
  });
  const row = snapshot.rows[0];
  if (row === undefined) throw new Error("onboarding-roster-row-unavailable");
  if (new Set(row.matches.map(match => JSON.stringify([match.sheetId, match.rowId]))).size !== row.matches.length) {
    throw new Error("onboarding-roster-membership-invalid");
  }
  const matches = row.matches.map(match => onboardingRosterRow(binding, match));
  if (selection !== undefined) {
    const selected = matches.find(match => match.binding.sheetId === selection.sheetId && match.binding.rowId === selection.rowId);
    if (selected === undefined) throw new Error("onboarding-roster-row-unavailable");
    return OnboardingRosterReadOutputSchema.parse({ state: "resolved", row: selected });
  }
  if (row.state === "matched") return OnboardingRosterReadOutputSchema.parse({ state: "resolved", row: matches[0] });
  return OnboardingRosterReadOutputSchema.parse({ state: "resolve-required", binding,
    reason: row.state === "missing" ? "row-missing" : "row-ambiguous" });
}

/** Union complete captured sources. One match resolves; two or more stay unresolved even when their values agree. */
export function bindOnboardingRosterSources(bounds: readonly SchemaBoundCanonicalValue[], email: string, capturedAt: string) {
  if (bounds.length === 0) throw new Error("onboarding-roster-reference-invalid");
  const located = bounds.flatMap(bound => {
    const reference = parseRunWorkbookReference(bound);
    if ("mode" in reference.request) throw new Error("onboarding-roster-reference-invalid");
    const { request, snapshot } = reference;
    if (request.typeId !== ONBOARDING_ROSTER_TYPE_ID || snapshot.type.keyFieldId !== "email"
      || request.keys.length !== 1 || request.keys[0] !== email
      || request.fields.length !== ONBOARDING_ROSTER_FIELDS.length
      || ONBOARDING_ROSTER_FIELDS.some(field => !request.fields.includes(field) || !snapshot.type.fields.includes(field))) {
      throw new Error("onboarding-roster-reference-invalid");
    }
    const row = snapshot.rows[0];
    if (row === undefined || row.key !== email) throw new Error("onboarding-roster-row-unavailable");
    if (new Set(row.matches.map(match => JSON.stringify([match.sheetId, match.rowId]))).size !== row.matches.length) {
      throw new Error("onboarding-roster-membership-invalid");
    }
    return row.matches.map(match => ({ bound, match }));
  });
  if (bounds.length === 1 || located.length <= 1) return bindOnboardingRoster(located[0]?.bound ?? bounds[0], email, capturedAt);
  const anchor = parseRunWorkbookReference(bounds[0]);
  return OnboardingRosterReadOutputSchema.parse({ state: "resolve-required", reason: "row-ambiguous",
    binding: OnboardingRosterReferenceBindingSchema.parse({
      workbookType: anchor.snapshot.type.id, workbookId: anchor.snapshot.libraryId, workbookVersion: anchor.snapshot.version,
      referenceDigest: sha256Hex(canonicalJsonStringify(bounds[0])), capturedAt, rowKey: { email },
    }) });
}
