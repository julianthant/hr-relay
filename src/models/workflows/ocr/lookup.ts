import { z } from "zod";
import { PersonLookupInput, PersonLookupCanonicalInput } from "../person-lookup/input.js";
import { deriveItemId } from "../../../rules/identity/logical-item.js";
import { StableRecordIdSchema } from "../../../rules/identity/ids.js";
import type { OcrReviewSeed } from "./review-seed.js";

export const OcrLookupRequestSchema = z.strictObject({ recordIds: z.array(StableRecordIdSchema).min(1), input: PersonLookupCanonicalInput });

export function ocrLookupItemId(input: z.output<typeof PersonLookupInput>) {
  if (input.mode !== "search") throw new Error("OCR only delegates identity search.");
  return deriveItemId("person-lookup", "emplId" in input ? `eid:${input.emplId}` : `name:${input.name.toLowerCase()}`);
}

export function ocrLookupRequests(seed: OcrReviewSeed) {
  const requests = new Map<string, z.output<typeof OcrLookupRequestSchema>>();
  for (const record of seed.records) {
    if (record.lookup.state === "unavailable") continue;
    const { eid, name } = record.lookup;
    if (eid === null && name === null) throw new Error("Required OCR lookup has no identity facts.");
    const input = PersonLookupInput.parse({ ...(eid === null ? { name } : { emplId: eid }),
      crmCheck: true, keepNonHdh: false, includeCrmDates: false });
    const key = ocrLookupItemId(input);
    const existing = requests.get(key);
    if (existing === undefined) requests.set(key, { recordIds: [record.recordId], input });
    else existing.recordIds.push(record.recordId);
  }
  return [...requests.values()];
}

export function bindOcrLookupOutcomes<Outcome extends { readonly itemId: string; readonly runId: string }>(
  seed: OcrReviewSeed, outcomes: readonly Outcome[],
) {
  const requests = ocrLookupRequests(seed);
  if (requests.length !== outcomes.length || new Set(outcomes.map(outcome => outcome.runId)).size !== outcomes.length) {
    throw new Error("OCR lookup outcomes must cover every requested identity exactly once.");
  }
  return requests.map((request, index) => {
    const outcome = outcomes[index];
    if (outcome === undefined || outcome.itemId !== ocrLookupItemId(request.input)) {
      throw new Error("OCR lookup outcome does not match the requested identity in order.");
    }
    return { ...request, outcome };
  });
}
