import { z } from "zod";

export const RebuildArtifactRootSchema = z.literal(".tracker-rebuild/artifacts");

const RuntimeIsolationSchema = z.strictObject({
  stateRoot: z.literal(".tracker-rebuild"),
  artifactRoot: RebuildArtifactRootSchema,
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
