import { createNominatimService } from "./nominatim-owner.js";
// Census fromAddress/toAddress are block ranges, never street names.
import { z } from "zod";
import type { ProviderAdapter, ProviderCallOptions } from "../../../workflow-kit/providers.js";
import type { Clock } from "../../../rules/time/clock.js";
import { censusConfidence, confidenceFromImportance, GeocodeOutcomeSchema, GeocodeRequestSchema } from "../../../rules/normalization/geocode.js";
import { ProviderAdapterOutcomeSchema, ProviderRequestEnvelopeSchema, type ProviderAdapterOutcome, type ProviderRequestEnvelope } from "../../../models/providers/providers.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";

const CENSUS_BASE = "https://geocoding.geo.census.gov/geocoder/locations";
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_USER_AGENT = "hr-automation/1.0 (UCSD HR automation; address enrichment)";
const GEOCODE_OUTCOME_SCHEMA_HASH = deriveSchemaHash(GeocodeOutcomeSchema, "output");

export interface GeocodeAdapterDependencies {
  readonly clock: Clock;
  /** Injected for tests; production uses the platform fetch. */
  readonly fetchFn?: typeof fetch;
}

/** Only what the adapters consume from each provider's response. */
const CensusResponseSchema = z.looseObject({
  result: z.looseObject({
    addressMatches: z.array(z.looseObject({
      matchedAddress: z.string().optional(),
      addressComponents: z.looseObject({
        preDirection: z.string().optional(),
        streetName: z.string().optional(),
        suffixType: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        zip: z.string().optional(),
      }).optional(),
    })).optional(),
  }).optional(),
});

const NominatimResponseSchema = z.array(z.looseObject({
  importance: z.number().optional(),
  display_name: z.string().optional(),
  address: z.looseObject({
    house_number: z.string().optional(),
    road: z.string().optional(),
    city: z.string().optional(),
    town: z.string().optional(),
    village: z.string().optional(),
    state: z.string().optional(),
    postcode: z.string().optional(),
  }).optional(),
}));

function unavailableOutcome(reason: unknown, clock: Clock): ProviderAdapterOutcome {
  return ProviderAdapterOutcomeSchema.parse({
    response: { state: "unavailable", reason },

    evidence: { summary: "geocode request did not produce an answer", capturedAt: clock.now().toISOString() },
  });
}

function producedOutcome(value: unknown, summary: string, clock: Clock): ProviderAdapterOutcome {
  return ProviderAdapterOutcomeSchema.parse({
    response: {
      state: "produced",
      value: { schemaHash: GEOCODE_OUTCOME_SCHEMA_HASH, value: GeocodeOutcomeSchema.parse(value) },
    },

    evidence: { summary, capturedAt: clock.now().toISOString() },
  });
}

async function fetchJson(
  fetchFn: typeof fetch,
  url: string,
  headers: Readonly<Record<string, string>>,
  options: ProviderCallOptions,
  clock: Clock,
): Promise<Readonly<{ ok: true; body: unknown }> | Readonly<{ ok: false; outcome: ProviderAdapterOutcome }>> {
  const response = await fetchFn(url, { headers, signal: options.signal });
  if (response.status === 429) {
    return {
      ok: false,
      outcome: unavailableOutcome({
        code: "adapter-unavailable",
        message: "Geocoder rate limit was reached; the request was not retried.",
      }, clock),
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      outcome: unavailableOutcome({
        code: "adapter-unavailable",
        message: `geocoder answered HTTP ${String(response.status)}`,
      }, clock),
    };
  }
  const text = await response.text();
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    // The body could contain anything; report SHAPE only, never an excerpt.
    return {
      ok: false,
      outcome: ProviderAdapterOutcomeSchema.parse({
        response: {
          state: "invalid-response",
          reason: `the provider answered ${String(text.length)} chars that are not JSON`,
        },

        evidence: { summary: "geocode response was not JSON", capturedAt: clock.now().toISOString() },
      }),
    };
  }
}

export function createCensusGeocodeAdapter(
  dependencies: GeocodeAdapterDependencies,
): ProviderAdapter<"geocode.census"> {
  const fetchFn = dependencies.fetchFn ?? fetch;
  return Object.freeze({
    capability: "geocode.census" as const,
    async invoke(requestInput: ProviderRequestEnvelope, options: ProviderCallOptions) {
      const request = ProviderRequestEnvelopeSchema.parse(requestInput);
      const address = GeocodeRequestSchema.parse(request.payload.value);
      const hasLocality = address.city !== undefined || address.state !== undefined || address.zip !== undefined;
      const url = new URL(hasLocality ? `${CENSUS_BASE}/address` : `${CENSUS_BASE}/onelineaddress`);
      url.searchParams.set("benchmark", "4");
      url.searchParams.set("format", "json");
      if (hasLocality) {
        url.searchParams.set("street", address.street);
        if (address.city !== undefined) url.searchParams.set("city", address.city);
        if (address.state !== undefined) url.searchParams.set("state", address.state);
        if (address.zip !== undefined) url.searchParams.set("zip", address.zip);
      } else {
        url.searchParams.set(
          "address",
          [address.street, address.city, address.state, address.zip].filter((part) => part !== undefined).join(", "),
        );
      }

      const fetched = await fetchJson(fetchFn, url.toString(), {}, options, dependencies.clock);
      if (!fetched.ok) return fetched.outcome;
      const parsed = CensusResponseSchema.safeParse(fetched.body);
      if (!parsed.success) {
        return unavailableOutcome({
          code: "adapter-unavailable",
          message: "geocoder response body did not carry the documented shape",
        }, dependencies.clock);
      }
      const match = parsed.data.result?.addressMatches?.[0];
      if (match === undefined) {
        return producedOutcome({ state: "no-match" }, "census found no match", dependencies.clock);
      }
      const components = match.addressComponents;
      // The street NAME only — never TIGER's fromAddress/toAddress ranges.
      const streetName = [components?.preDirection, components?.streetName, components?.suffixType]
        .filter((part) => part !== undefined && part.trim() !== "")
        .join(" ");
      return producedOutcome({
        state: "resolved",
        street: streetName === "" ? null : streetName,
        city: components?.city ?? null,
        stateCode: components?.state ?? null,
        zip: components?.zip ?? null,
        matchedAddress: match.matchedAddress ?? null,
        confidence: censusConfidence(address.street, match.matchedAddress ?? null),
      }, "census resolved the address", dependencies.clock);
    },
  });
}

function createOwnedNominatimAdapter(
  dependencies: GeocodeAdapterDependencies,
): ProviderAdapter<"geocode.nominatim"> {
  const fetchFn = dependencies.fetchFn ?? fetch;
  return Object.freeze({
    capability: "geocode.nominatim" as const,
    async invoke(requestInput: ProviderRequestEnvelope, options: ProviderCallOptions) {
      const request = ProviderRequestEnvelopeSchema.parse(requestInput);
      const address = GeocodeRequestSchema.parse(request.payload.value);
      const url = new URL(NOMINATIM_BASE);
      url.searchParams.set(
        "q",
        [address.street, address.city, address.state, address.zip, address.country]
          .filter((part) => part !== undefined)
          .join(", "),
      );
      url.searchParams.set("format", "json");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("limit", "1");
      if (address.country !== undefined && /^[A-Za-z]{2}$/u.test(address.country)) {
        url.searchParams.set("countrycodes", address.country.toLowerCase());
      }

      const fetched = await fetchJson(
        fetchFn,
        url.toString(),
        { "User-Agent": NOMINATIM_USER_AGENT },
        options,
        dependencies.clock,
      );
      if (!fetched.ok) return fetched.outcome;
      const parsed = NominatimResponseSchema.safeParse(fetched.body);
      if (!parsed.success) {
        return unavailableOutcome({
          code: "adapter-unavailable",
          message: "geocoder response body did not carry the documented shape",
        }, dependencies.clock);
      }
      const hit = parsed.data[0];
      if (hit === undefined) {
        return producedOutcome({ state: "no-match" }, "nominatim found no match", dependencies.clock);
      }
      const parts = hit.address;
      const street = [parts?.house_number, parts?.road]
        .filter((part) => part !== undefined && part.trim() !== "")
        .join(" ");
      return producedOutcome({
        state: "resolved",
        street: street === "" ? null : street,
        city: parts?.city ?? parts?.town ?? parts?.village ?? null,
        stateCode: parts?.state ?? null,
        zip: parts?.postcode ?? null,
        matchedAddress: hit.display_name ?? null,
        confidence: confidenceFromImportance(hit.importance),
      }, "nominatim resolved the address", dependencies.clock);
    },
  });
}

export function createNominatimGeocodeAdapter(dependencies: GeocodeAdapterDependencies) {
  const service = createNominatimService({
    clock: dependencies.clock,
    fetchFn: dependencies.fetchFn,
    adapter: fetchFn => createOwnedNominatimAdapter({ clock: dependencies.clock, fetchFn }),
  });
  return Object.freeze({ capability: "geocode.nominatim" as const, invoke: service.invoke, stop: service.stop, attach: service.attach });
}
