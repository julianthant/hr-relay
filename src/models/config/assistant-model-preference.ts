import { z } from "zod";

export const AssistantModelSlugSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
export const AssistantModelPreferenceSchema = z.strictObject({ slug: AssistantModelSlugSchema, effort: z.enum(["low", "medium", "high"]) });
export type AssistantModelPreference = z.infer<typeof AssistantModelPreferenceSchema>;
