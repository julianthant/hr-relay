import type { z } from "zod";
import { RunWorkbookReferenceSchema, parseRunWorkbookReference } from "../../models/dashboard/workbooks.js";
import { type SchemaBoundCanonicalValue } from "../../models/validation/schema-bound-value.js";
import { collapseWhitespace } from "../../models/fields/cell-coercion.js";
import { ONBOARDING_ROSTER_FIELDS, ONBOARDING_ROSTER_TYPE_ID, OnboardingRosterReadOutputSchema,
  OnboardingRosterReferenceBindingSchema, OnboardingRosterSnapshotRowSchema } from "../../models/workflows/onboarding/roster.js";
import { canonicalJsonStringify } from "../validation/canonical-json.js";
import { sha256Hex } from "../validation/sha256.js";
import { resolveWorksheetRows } from "../spreadsheets/reference-rows.js";

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

function captureOnboardingRoster(bound: SchemaBoundCanonicalValue, email: string, capturedAt: string) {
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
  if (row === undefined || row.key !== email) throw new Error("onboarding-roster-row-unavailable");
  if (new Set(row.matches.map(match => JSON.stringify([match.sheetId, match.rowId]))).size !== row.matches.length) {
    throw new Error("onboarding-roster-membership-invalid");
  }
  return { binding, selection, matches: row.matches.map(match => ({ match, row: onboardingRosterRow(binding, match) })) };
}

export function bindOnboardingRosterSources(bounds: readonly SchemaBoundCanonicalValue[], email: string, capturedAt: string) {
  const sources = bounds.map(bound => captureOnboardingRoster(bound, email, capturedAt));
  const first = sources[0];
  if (first === undefined) throw new Error("onboarding-roster-reference-invalid");
  if (first.selection !== undefined) {
    const { sheetId, rowId } = first.selection;
    const selected = first.matches.find(({ match }) => match.sheetId === sheetId && match.rowId === rowId);
    if (sources.length !== 1 || selected === undefined) throw new Error("onboarding-roster-row-unavailable");
    return { roster: OnboardingRosterReadOutputSchema.parse({ state: "resolved", row: selected.row }), copies: [], anchor: first.binding };
  }
  if (sources.some(source => source.selection !== undefined)) throw new Error("onboarding-roster-reference-invalid");
  const matches = sources.flatMap(source => source.matches);
  const resolution = resolveWorksheetRows(matches, item => item.match.values);
  if (resolution.state === "resolved") return { roster: OnboardingRosterReadOutputSchema.parse({ state: "resolved", row: resolution.row.row }),
    copies: matches.slice(1).map(match => match.row.binding), anchor: first.binding };
  return { roster: OnboardingRosterReadOutputSchema.parse({ state: "resolve-required", binding: first.binding,
    reason: resolution.state === "missing" ? "row-missing" : "row-ambiguous" }), copies: [], anchor: first.binding };
}
