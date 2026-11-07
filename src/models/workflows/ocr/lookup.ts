import { z } from "zod";
import { PersonLookupInput, PersonLookupCanonicalInput } from "../person-lookup/input.js";
import { deriveItemId } from "../../../rules/identity/logical-item.js";
import { StableRecordIdSchema } from "../../../rules/identity/ids.js";
import type { OcrReviewSeed } from "./review-seed.js";
import { ocrForm } from "../../ocr/form-registry.js";
import { I9LookupInputSchema, i9LookupMatchKey } from "../../systems/i9/read-section2-signer.js";

export const OcrPersonLookupRequestSchema = z.strictObject({ recordIds: z.array(StableRecordIdSchema).min(1), input: PersonLookupCanonicalInput });
export const OcrSignerLookupRequestSchema = z.strictObject({ recordIds: z.array(StableRecordIdSchema).min(1), input: I9LookupInputSchema });

export function ocrLookupItemId(input: z.output<typeof PersonLookupInput> | z.output<typeof I9LookupInputSchema>) {
  if (!("mode" in input)) return deriveItemId("i9-lookup", i9LookupMatchKey(input));
  if (input.mode !== "search") throw new Error("OCR only delegates identity search.");
  return deriveItemId("person-lookup", "emplId" in input ? ["eid", input.emplId].join(":") : `name:${input.name.toLowerCase()}`);
}

export function ocrPersonLookupRequests(seed: OcrReviewSeed) {
  if (ocrForm(seed.formType).lookup !== "person-lookup") return [];
  const requests = new Map<string, z.output<typeof OcrPersonLookupRequestSchema>>();
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

export function ocrSignerLookupRequests(seed: OcrReviewSeed) {
  if (ocrForm(seed.formType).lookup !== "i9-lookup") return [];
  const requests = new Map<string, z.output<typeof OcrSignerLookupRequestSchema>>();
  for (const record of seed.records) {
    const text = (path: string) => {
      const answer = record.fields.answers.find(answer => answer.path === path);
      return answer?.state === "read" && typeof answer.value === "string" ? answer.value : null;
    };
    const lastName = text("lastName"), firstName = text("firstName");
    if (lastName === null || firstName === null) continue;
    const ssn = text("ssn");
    const input = I9LookupInputSchema.parse({ lastName, firstName, ...(ssn === null ? {} : { ssn }) });
    const key = ocrLookupItemId(input);
    const existing = requests.get(key);
    if (existing === undefined) requests.set(key, { recordIds: [record.recordId], input });
    else existing.recordIds.push(record.recordId);
  }
  return [...requests.values()];
}

export function ocrLookupRequests(seed: OcrReviewSeed) {
  return [...ocrPersonLookupRequests(seed), ...ocrSignerLookupRequests(seed)];
}

export function bindOcrLookupOutcomes<Outcome extends { readonly itemId: string; readonly runId: string }>(
  seed: OcrReviewSeed, outcomes: readonly Outcome[], family?: "person-lookup" | "i9-lookup",
) {
  const requests = family === "person-lookup" ? ocrPersonLookupRequests(seed)
    : family === "i9-lookup" ? ocrSignerLookupRequests(seed) : ocrLookupRequests(seed);
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
