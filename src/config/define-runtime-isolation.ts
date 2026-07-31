import { z } from "zod";

const RuntimeIsolationSchema = z.strictObject({
  stateRoot: z.literal(".tracker-rebuild"),
  artifactRoot: z.literal(".tracker-rebuild/artifacts"),
  backendPort: z.literal(3938),
  frontendPort: z.literal(5174),
  processLockRoot: z.literal(".tracker-rebuild/locks"),
  browserProfileRoot: z.literal(".auth-rebuild"),
  browserSessionNamespace: z.literal("hrauto-rebuild"),
});

export type RuntimeIsolation = z.infer<typeof RuntimeIsolationSchema>;

export function defineRuntimeIsolation(input: unknown): RuntimeIsolation {
  return Object.freeze(RuntimeIsolationSchema.parse(input));
}
