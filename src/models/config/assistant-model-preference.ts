import { z } from "zod";

export const AssistantModelSlugSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
export const AssistantModelPreferenceSchema = z.strictObject({ slug: AssistantModelSlugSchema, effort: z.enum(["low", "medium", "high"]) });
export type AssistantModelPreference = z.infer<typeof AssistantModelPreferenceSchema>;
/** The display name of a model slug, e.g. "gpt-6.1-sol" → "GPT-6.1 Sol".
 * shortcut: derived from the slug, not the served catalog name; read the catalog's displayName if a slug ever renders wrong. */
export function assistantModelLabel(slug: string): string {
  const [family = "", version, ...rest] = slug.split("-");
  return [[family.toUpperCase(), version].filter(part => part !== undefined).join("-"), ...rest.map(word => word.charAt(0).toUpperCase() + word.slice(1))].join(" ");
}
export const ASSISTANT_EFFORT_LABELS = Object.freeze({ low: "Low", medium: "Medium", high: "High" } as const);
