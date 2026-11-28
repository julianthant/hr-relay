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
  if (row.matches.some(match => match.values.email !== email)) throw new Error("onboarding-roster-key-mismatch");
  return { binding, selection, matches: row.matches.map(match => ({ match, binding })) };
}

export function bindOnboardingRosterSources(bounds: readonly SchemaBoundCanonicalValue[], email: string, capturedAt: string) {
  const sources = bounds.map(bound => captureOnboardingRoster(bound, email, capturedAt));
  const first = sources[0];
  if (first === undefined) throw new Error("onboarding-roster-reference-invalid");
  const matches = sources.flatMap(source => source.matches);
  if (new Set(matches.map(({ binding, match }) => JSON.stringify([binding.workbookId, binding.workbookVersion, match.sheetId, match.rowId]))).size !== matches.length) {
    throw new Error("onboarding-roster-membership-invalid");
  }
  const selected = sources.filter(source => source.selection !== undefined);
  if (selected.length > 1) throw new Error("onboarding-roster-reference-invalid");
  const pickedSource = selected[0];
  const picked = pickedSource?.matches.find(({ match }) => match.sheetId === pickedSource.selection?.sheetId && match.rowId === pickedSource.selection?.rowId);
  if (pickedSource !== undefined && picked === undefined) throw new Error("onboarding-roster-row-unavailable");
  const resolution = resolveWorksheetRows(matches, item => item.match.values);
  const primary = picked ?? (resolution.state === "resolved" ? resolution.row : undefined);
  if (primary !== undefined) {
    const row = onboardingRosterRow(primary.binding, primary.match);
    const copies = matches.filter(candidate => candidate !== primary
      && resolveWorksheetRows([primary, candidate], item => item.match.values).state === "resolved")
      .map(({ match, binding }) => ({ ...binding, sheetId: match.sheetId, rowId: match.rowId }));
    return { roster: OnboardingRosterReadOutputSchema.parse({ state: "resolved", row }), copies, anchor: first.binding };
  }
  return { roster: OnboardingRosterReadOutputSchema.parse({ state: "resolve-required", binding: first.binding,
    reason: resolution.state === "missing" ? "row-missing" : "row-ambiguous" }), copies: [], anchor: first.binding };
}
