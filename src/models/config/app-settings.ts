import { z } from "zod";
import { SettingsCurrentRecordSchema } from "./settings-current.js";
import { ActiveRuntimeConfigRecordSchema } from "./runtime-generation.js";
/** One physical authority retains the saved journal and currently selected execution snapshot. */
export const AppSettingsSchema = z.strictObject({ format: z.literal(1), saved: SettingsCurrentRecordSchema.nullable(), active: ActiveRuntimeConfigRecordSchema.nullable() });
export type AppSettings = z.infer<typeof AppSettingsSchema>;
