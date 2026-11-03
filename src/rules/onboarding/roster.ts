import type { z } from "zod";
import { RunWorkbookReferenceSchema } from "../../models/dashboard/workbooks.js";
import { deriveSchemaHash, schemaBoundValueSchema, type SchemaBoundCanonicalValue } from "../../models/validation/schema-bound-value.js";
import { ONBOARDING_ROSTER_FIELDS, ONBOARDING_ROSTER_TYPE_ID, OnboardingRosterReadOutputSchema,
  OnboardingRosterReferenceBindingSchema, OnboardingRosterSnapshotRowSchema } from "../../models/workflows/onboarding/roster.js";
import { canonicalJsonStringify } from "../validation/canonical-json.js";
import { sha256Hex } from "../validation/sha256.js";

type Reference = z.infer<typeof RunWorkbookReferenceSchema>;
type Match = Reference["snapshot"]["rows"][number]["matches"][number];

export function onboardingRosterRow(binding: z.input<typeof OnboardingRosterReferenceBindingSchema>, match: Match) {
  const values = match.values;
  if (values.email !== binding.rowKey.email) throw new Error("onboarding-roster-key-mismatch");
  const lived = ONBOARDING_ROSTER_FIELDS.slice(4).map(field => values[field]);
  return OnboardingRosterSnapshotRowSchema.parse({
    binding: { ...binding, sheetId: match.sheetId, rowId: match.rowId },
    references: {
      legalName: { firstName: values.firstName, lastName: values.lastName, middleName: values.middleName },
      livedName: lived.every(value => value === null) ? null
        : { firstName: values["roster.livedFirstName"], lastName: values["roster.livedLastName"], middleName: values["roster.livedMiddleName"] },
    },
  });
}

export function bindOnboardingRoster(bound: SchemaBoundCanonicalValue, email: string, capturedAt: string) {
  const reference = schemaBoundValueSchema(RunWorkbookReferenceSchema, deriveSchemaHash(RunWorkbookReferenceSchema, "output")).parse(bound).value;
  const { request, snapshot } = reference;
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
  if (row.state === "matched") return OnboardingRosterReadOutputSchema.parse({ state: "resolved", row: matches[0] });
  return OnboardingRosterReadOutputSchema.parse({ state: "resolve-required", binding,
    reason: row.state === "missing" ? "row-missing" : "row-ambiguous" });
}
