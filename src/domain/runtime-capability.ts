import { z } from "zod";

/** Browser-safe capability vocabulary; runtime ownership metadata lives elsewhere. */
export const RuntimeCapabilitySchema = z.enum([
  "dashboard.serve",
  "executor.run",
  "workflow.kuali-fill",
  "workflow.sharepoint-download",
  "feature.capture",
  "feature.ocr",
  "feature.ai-advisory",
  "system.ucpath.prod", "system.ucpath.test",
  "system.crm.prod", "system.crm.test",
  "system.onbase.prod", "system.onbase.test",
  "system.kuali.prod", "system.kuali.test",
  "system.servicenow.prod", "system.servicenow.test",
  "system.i9.prod", "system.i9.test",
  "system.new-kronos.prod", "system.new-kronos.test",
  "system.old-kronos.prod", "system.old-kronos.test",
  "system.sharepoint.prod", "system.sharepoint.test",
  "provider.gemini", "provider.groq", "provider.mistral", "provider.openrouter", "provider.sambanova",
  "provider.census", "provider.nominatim",
]);

export type RuntimeCapability = z.infer<typeof RuntimeCapabilitySchema>;
