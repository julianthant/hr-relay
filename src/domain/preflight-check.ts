import { z } from "zod";

/** Browser-safe identity contract shared by bootstrap wires and runtime registries. */
export const PreflightCheckIdSchema = z.string()
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/)
  .brand<"PreflightCheckId">();

export type PreflightCheckId = z.infer<typeof PreflightCheckIdSchema>;
