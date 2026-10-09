/** Deterministic contact rules and optional Census/Nominatim observations for operator review. */
import { defineTask } from "../../../../workflow-kit/task.js";
import { ContactFieldIdSchema, NormalizeContact, NormalizeContactOutputSchema, RedactedContactValueSchema, type ContactFieldId, type NormalizationChange } from "../../../../models/processing/normalization/normalize-contact.js";
import { CANONICAL_FIELDS } from "../../../../models/fields/registry.js";
import { canonicalizeRelationshipRule, isLikelyUsAddress, isUsCountry, normalizeCountryHint, normalizePhoneDigitsRule, normalizeUsStateRule, normalizeZipRule, type NormalizationRuleId } from "../../../../rules/normalization/contact-rules.js";
import { GeocodeOutcomeSchema, GeocodeRequestSchema, type GeocodeOutcome } from "../../../../rules/normalization/geocode.js";
import { retainLocalEvidenceValue } from "../../../../rules/redaction/redaction.js";
import { deriveSchemaHash } from "../../../../models/validation/schema-bound-value.js";
import type { ProviderResponseEnvelope } from "../../../../models/providers/providers.js";

const GEOCODE_REQUEST_SCHEMA_HASH = deriveSchemaHash(GeocodeRequestSchema, "input");

/** Contact field → its canonical registry entry, for redaction identity. */
const FIELD_CANONICAL = {
  relationship: CANONICAL_FIELDS.relationship,
  cellPhone: CANONICAL_FIELDS.cellPhone,
  homePhone: CANONICAL_FIELDS.homePhone,
  address1: CANONICAL_FIELDS.address1,
  address2: CANONICAL_FIELDS.address2,
  city: CANONICAL_FIELDS.city,
  state: CANONICAL_FIELDS.state,
  postalCode: CANONICAL_FIELDS.postalCode,
  country: CANONICAL_FIELDS.country,
} as const;

function redactedBefore(field: ContactFieldId, raw: string) {
  const canonical = FIELD_CANONICAL[field];
  // This result stays local; provider facts use the closed egress transform.
  return RedactedContactValueSchema.parse(retainLocalEvidenceValue(canonical.classification, canonical.redactTransform, raw));
}

export const readContactAdviceTask = defineTask(NormalizeContact, {
  sessions: [],
  async run({ input, ctx }) {
    const contact = { ...input.contact };
    if (Object.values(contact).every((value) => value === undefined)) {
      return ctx.fail("empty-contact", "the contact carries no fields; there is nothing to advise on");
    }

    const changes: NormalizationChange[] = [];
    const ambiguous = new Set<ContactFieldId>();
    const normalized: Partial<Record<ContactFieldId, string>> = { ...contact };

    const applyRule = (field: ContactFieldId, ruleId: NormalizationRuleId, next: string | null): void => {
      const raw = contact[field];
      if (raw === undefined) return;
      if (next === null) {
        ambiguous.add(field);
        return;
      }
      if (next === raw) return;
      changes.push({
        field,
        before: redactedBefore(field, raw),
        after: next,
        source: { kind: "rule", ruleId },
      });
      normalized[field] = next;
    };

    applyRule("cellPhone", "phone-digits", normalizePhoneDigitsRule(contact.cellPhone ?? null));
    applyRule("homePhone", "phone-digits", normalizePhoneDigitsRule(contact.homePhone ?? null));
    applyRule("country", "country-alias", normalizeCountryHint(contact.country ?? null));
    const domestic = isUsCountry(normalized.country ?? null);
    if (domestic) {
      applyRule("state", "state-usps-code", normalizeUsStateRule(contact.state ?? null));
      applyRule("postalCode", "zip-five-or-nine", normalizeZipRule(contact.postalCode ?? null));
    }
    const relationshipCanonical = contact.relationship === undefined
      ? null
      : canonicalizeRelationshipRule(contact.relationship);
    if (contact.relationship !== undefined && relationshipCanonical === null) {
      ambiguous.add("relationship");
    }
    if (relationshipCanonical !== null) {
      applyRule("relationship", "relationship-canonical", relationshipCanonical);
    }

    // The declared provider policy: census first for a US-shaped address,
    // nominatim as the fallback — each observation recorded, never silent.
    const unavailable: {
      capability: "geocode.census" | "geocode.nominatim";
      reason: unknown;
    }[] = [];
    let geocodeAnswered = false;
    if (input.geocode && normalized.address1 !== undefined) {
      const request = GeocodeRequestSchema.parse({
        street: normalized.address1,
        ...(normalized.city === undefined ? {} : { city: normalized.city }),
        ...(normalized.state === undefined ? {} : { state: normalized.state }),
        ...(normalized.postalCode === undefined ? {} : { zip: normalized.postalCode }),
        ...(normalized.country === undefined ? {} : { country: normalized.country }),
      });
      const usShaped = isLikelyUsAddress({
        country: normalized.country ?? null,
        zip: normalized.postalCode ?? null,
        state: normalized.state ?? null,
      });
      const order: ("geocode.census" | "geocode.nominatim")[] = usShaped
        ? ["geocode.census", "geocode.nominatim"]
        : ["geocode.nominatim"];

      for (const capability of order) {
        const response: ProviderResponseEnvelope = await ctx.providers[capability].call({
          schemaHash: GEOCODE_REQUEST_SCHEMA_HASH,
          value: request,
        });
        if (response.state === "unavailable") {
          unavailable.push({ capability, reason: response.reason });
          continue;
        }
        if (response.state === "invalid-response") {
          unavailable.push({
            capability,
            reason: { code: "adapter-unavailable", message: response.reason },
          });
          continue;
        }
        geocodeAnswered = true;
        const outcome: GeocodeOutcome = GeocodeOutcomeSchema.parse(response.value.value);
        if (outcome.state === "resolved" && outcome.confidence !== "unverified") {
          const advise = (field: ContactFieldId, suggestion: string | null): void => {
            const currentValue = normalized[field];
            if (suggestion === null || currentValue === undefined) return;
            if (suggestion.toLowerCase() === currentValue.toLowerCase()) return;
            changes.push({
              field,
              before: redactedBefore(field, currentValue),
              after: suggestion,
              source: {
                kind: capability === "geocode.census" ? "census" : "nominatim",
                observedAt: input.readAt,
                confidence: outcome.confidence,
              },
            });
            normalized[field] = suggestion;
          };
          advise("city", outcome.city);
          advise("state", outcome.stateCode === null ? null : normalizeUsStateRule(outcome.stateCode));
          advise("postalCode", outcome.zip === null ? null : normalizeZipRule(outcome.zip));
        }
        break;
      }
    }

    const ambiguousFields = [...ambiguous].map((field) => ContactFieldIdSchema.parse(field));
    const geocodeAsked = input.geocode && normalized.address1 !== undefined;
    const answered = (geocodeAsked ? geocodeAnswered : true);
    const disposition = ambiguousFields.length > 0
      ? { kind: "ambiguous" as const, fields: ambiguousFields }
      : !answered && unavailable.length > 0
        ? { kind: "advisory-unavailable" as const, unavailable }
        : { kind: "complete" as const };

    const output = NormalizeContactOutputSchema.parse({
      normalized,
      relationshipCanonical,
      changes,
      disposition,
    });
    ctx.recordData([
      { direction: "read", field: "normalized", value: output.normalized },
      { direction: "read", field: "relationshipCanonical", value: output.relationshipCanonical },
      { direction: "read", field: "changes", value: output.changes },
      { direction: "read", field: "disposition", value: output.disposition },
    ]);
    return output;
  },
});
