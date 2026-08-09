/**
 * `normalization/read-contact-advice` — the implementation.
 *
 * Deterministic rules first, each change naming its rule id; then — only
 * under the caller's declared `geocode` policy — census-before-nominatim
 * advice through the admitted clients, each observation recorded with its
 * instant and confidence. Provider exhaustion is the `advisory-unavailable`
 * disposition; a field the rules cannot decide is `ambiguous`; and nothing
 * here APPLIES anything — the output is advice for the review gate.
 *
 * D178 unparks the `ai` arm behind the caller's separate `ai` flag: the
 * fields the rules could not decide are asked about, but ONLY those whose
 * canonical classification permits the `allow` transform. `relationship` is
 * `sensitive-hr`, so the field legacy's LLM fallback existed for is the one
 * this arm withholds — it stays `ambiguous` for the operator rather than
 * being sent in a redacted form no model could read anyway.
 *
 * Street-LINE advice is deliberately not offered yet (D165): the 2026-07-13
 * incident lives on that surface, `composeResolvedStreet` did not port, and
 * the EC migration owns the live re-verification that would make a street
 * suggestion trustworthy. City/state/ZIP advice is offered only from a
 * `resolved` outcome whose confidence is not `unverified`.
 */
import { defineTask } from "../../../base/task.js";
import {
  ContactFieldIdSchema,
  NormalizeContact,
  NormalizeContactOutputSchema,
  RedactedContactValueSchema,
  type ContactFieldId,
  type NormalizationChange,
} from "../../../domain/contracts/normalization/normalize-contact.js";
import { CANONICAL_FIELDS } from "../../../domain/fields/registry.js";
import {
  ContactAdviceSchema,
  canonicalizeRelationshipRule,
  isLikelyUsAddress,
  isUsCountry,
  normalizeCountryHint,
  normalizePhoneDigitsRule,
  normalizeUsStateRule,
  normalizeZipRule,
  type NormalizationRuleId,
} from "../../../domain/normalization/contact-rules.js";
import {
  GeocodeOutcomeSchema,
  GeocodeRequestSchema,
  type GeocodeOutcome,
} from "../../../domain/normalization/geocode.js";
import { RedactedFieldSchema, redactValue } from "../../../domain/redaction.js";
import {
  ADVISORY_PROMPT_SCHEMA_HASH,
  AdvisoryAnswerEnvelopeSchema,
  CONTACT_ADVICE_SCHEMA_HASH,
  buildAdvisoryPrompt,
  parseAdvisoryAnswer,
} from "../../../domain/trust/advisory.js";
import { deriveSchemaHash } from "../../../domain/schema-bound-value.js";
import type { ProviderResponseEnvelope } from "../../../domain/providers.js";

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
  // The ONE transform implementation, narrowed to the contract's boundary.
  return RedactedContactValueSchema.parse(redactValue(canonical.classification, canonical.redactTransform, raw));
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
      capability: "geocode.census" | "geocode.nominatim" | "ai.advisory";
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

    // ── the ai advice arm (D178) ───────────────────────────────────────────
    //
    // Redaction happens BEFORE the wire, and the declared classification —
    // not the usefulness of the answer — decides what may be asked about. A
    // contact field is askable only when its canonical redaction transform is
    // `allow`; `relationship` is `sensitive-hr`, so the one field legacy's LLM
    // fallback existed for is precisely the one this arm will not send. It
    // stays `ambiguous` for the operator, which is the honest outcome.
    let aiAnswered = false;
    let aiAsked = false;
    if (input.ai && ambiguous.size > 0) {
      const askable = [...ambiguous].filter((field) => FIELD_CANONICAL[field].redactTransform === "allow");
      const withheld = [...ambiguous].filter((field) => FIELD_CANONICAL[field].redactTransform !== "allow");
      if (withheld.length > 0) {
        ctx.log.info("contact advisory withheld fields whose classification forbids provider use", {
          fields: withheld.join(","),
        });
      }
      if (askable.length > 0) {
        aiAsked = true;
        const facts = askable.map((field) => {
          const raw = contact[field];
          if (raw === undefined) throw new Error(`contact field ${field} is ambiguous but carries no value`);
          const canonical = FIELD_CANONICAL[field];
          return RedactedFieldSchema.parse({
            key: field,
            ...redactValue(canonical.classification, canonical.redactTransform, raw),
          });
        });
        const prompt = buildAdvisoryPrompt("contact-normalization", facts);
        const response = await ctx.providers["ai.advisory"].call({
          schemaHash: ADVISORY_PROMPT_SCHEMA_HASH,
          value: prompt,
        });
        if (response.state === "unavailable") {
          unavailable.push({ capability: "ai.advisory", reason: response.reason });
        } else if (response.state === "invalid-response") {
          unavailable.push({
            capability: "ai.advisory",
            reason: { code: "adapter-unavailable", message: response.reason },
          });
        } else {
          aiAnswered = true;
          const envelope = AdvisoryAnswerEnvelopeSchema.parse(response.value.value);
          const parsed = parseAdvisoryAnswer(envelope, ContactAdviceSchema, CONTACT_ADVICE_SCHEMA_HASH);
          if (!parsed.ok) {
            // A malformed answer is a REFUSAL, never a partial accept: the
            // fields stay ambiguous and the reason names the failing paths.
            aiAnswered = false;
            unavailable.push({
              capability: "ai.advisory",
              reason: { code: "adapter-unavailable", message: parsed.reason },
            });
          } else {
            const asked = new Set(askable);
            for (const advised of parsed.advice.fields) {
              // An answer for a field nobody asked about is dropped LOUDLY —
              // it is the model volunteering a value for a withheld field.
              if (!asked.has(advised.field)) {
                throw new Error(
                  `contact advisory answered unasked field ${advised.field}; the prompt carried only ${askable.join(",")}`,
                );
              }
              const raw = contact[advised.field];
              if (raw === undefined || advised.value === raw) continue;
              changes.push({
                field: advised.field,
                before: redactedBefore(advised.field, raw),
                after: advised.value,
                source: {
                  kind: "ai",
                  provider: envelope.provider,
                  model: envelope.model,
                  confidence: advised.confidence,
                },
              });
              normalized[advised.field] = advised.value;
              ambiguous.delete(advised.field);
            }
          }
        }
      }
    }

    const ambiguousFields = [...ambiguous].map((field) => ContactFieldIdSchema.parse(field));
    const geocodeAsked = input.geocode && normalized.address1 !== undefined;
    const answered = (geocodeAsked ? geocodeAnswered : true) && (aiAsked ? aiAnswered : true);
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
