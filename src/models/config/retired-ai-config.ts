import { z } from "zod";
import { ProviderBudgetConfigSchema, ProviderBudgetSchema } from "./schema.js";

const RetiredModelsSchema = z.strictObject({ models: z.array(z.string().min(1).max(256).regex(/^[^\s,]+$/u)).min(1).max(32).readonly() });

/** Read-only shape of provider configuration captured before AI retirement. */
export const RetiredAiProviderConfigSchema = z.strictObject({
  ...ProviderBudgetConfigSchema.unwrap().shape,
  aiAdvisory: ProviderBudgetSchema,
  ocrExtract: ProviderBudgetSchema,
  gemini: RetiredModelsSchema.optional(),
  groq: RetiredModelsSchema.optional(),
  mistral: RetiredModelsSchema.optional(),
  openRouter: RetiredModelsSchema.optional(),
  sambanova: RetiredModelsSchema.optional(),
});

export function currentProviderConfig(value: unknown) {
  const parsed = z.union([ProviderBudgetConfigSchema.unwrap(), RetiredAiProviderConfigSchema]).parse(value);
  return ProviderBudgetConfigSchema.unwrap().parse({
    geocodeCensus: parsed.geocodeCensus,
    geocodeNominatim: parsed.geocodeNominatim,
  });
}
