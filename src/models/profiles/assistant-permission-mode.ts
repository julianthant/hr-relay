import { z } from "zod";
export const AssistantPermissionModeSchema = z.enum(["every-action", "before-submits", "without-asking"]);
export type AssistantPermissionMode = z.infer<typeof AssistantPermissionModeSchema>;
