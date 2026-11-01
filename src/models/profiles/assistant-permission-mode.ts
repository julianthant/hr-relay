import { z } from "zod";
export const AssistantPermissionModeSchema = z.literal("every-action");
export type AssistantPermissionMode = z.infer<typeof AssistantPermissionModeSchema>;
export const StoredAssistantPermissionModeSchema = z.enum(["every-action", "before-submits", "without-asking"]);
