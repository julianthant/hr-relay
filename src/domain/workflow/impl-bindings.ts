import { z } from "zod";
import { TaskIdSchema } from "../ids.js";

export const PendingImplBindingsSchema = z.strictObject({
  milestone: z.literal("1f"),
  reason: z.string().min(1),
  tasks: z.array(z.strictObject({
    taskId: TaskIdSchema,
    workflowId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    note: z.string().min(1),
  })),
});
export type PendingImplBindings = z.infer<typeof PendingImplBindingsSchema>;

