/** The geocode provider payload contract, shared by the normalization task, the Census/Nominatim adapters and every fixture, so one schema owns the wire shape. */
import { z } from "zod";
import { parseHouseNumber } from "./street-safety.js";

export const GeocodeRequestSchema = z.strictObject({
  street: z.string().min(1),
  city: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  zip: z.string().min(1).optional(),
  country: z.string().min(1).optional(),
});
export type GeocodeRequest = z.infer<typeof GeocodeRequestSchema>;

export const GeocodeConfidenceSchema = z.enum(["exact", "approximate", "unverified"]);
export type GeocodeConfidence = z.infer<typeof GeocodeConfidenceSchema>;

/** `no-match` is a real, expected outcome — a geocoder that finds nothing produced an answer, recorded as an observation rather than a provider failure. */
export const GeocodeOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("resolved"),
    street: z.string().min(1).nullable(),
    city: z.string().min(1).nullable(),
    stateCode: z.string().min(1).nullable(),
    zip: z.string().min(1).nullable(),
    matchedAddress: z.string().min(1).nullable(),
    confidence: GeocodeConfidenceSchema,
  }),
  z.strictObject({ state: z.literal("no-match") }),
]);
export type GeocodeOutcome = z.infer<typeof GeocodeOutcomeSchema>;

/** Census: an exact hit requires the SAME house number in the match. */
export function censusConfidence(
  inputStreet: string,
  matchedAddress: string | null,
): GeocodeConfidence {
  const inputHouse = parseHouseNumber(inputStreet);
  const matchedHouse = parseHouseNumber(matchedAddress);
  if (inputHouse === null || matchedHouse === null) return "approximate";
  return inputHouse.toLowerCase() === matchedHouse.toLowerCase() ? "exact" : "approximate";
}

/** Nominatim: importance ≥ 0.5 exact, ≥ 0.3 approximate, else unverified. */
export function confidenceFromImportance(importance: number | undefined): GeocodeConfidence {
  if (importance === undefined || Number.isNaN(importance)) return "approximate";
  if (importance >= 0.5) return "exact";
  if (importance >= 0.3) return "approximate";
  return "unverified";
}
