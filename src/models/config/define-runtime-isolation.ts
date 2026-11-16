import { z } from "zod";

export const RebuildArtifactRootSchema = z.literal(".tracker/data/artifacts");

const RuntimeIsolationSchema = z.strictObject({
  stateRoot: z.literal(".tracker/data"),
  artifactRoot: RebuildArtifactRootSchema,
  backendPort: z.literal(3938),
  lockPort: z.literal(3939),
  frontendPort: z.literal(5174),
  processLockRoot: z.literal(".tracker/data/locks"),
  // Repo-relative roots keep runtime directories separate.
  browserProfileRoot: z.literal(".tracker/data/browsers"),
  browserSessionNamespace: z.literal("hrauto-rebuild"),
});

export type RuntimeIsolation = z.infer<typeof RuntimeIsolationSchema>;

export function defineRuntimeIsolation(input: unknown): RuntimeIsolation {
  return Object.freeze(RuntimeIsolationSchema.parse(input));
}
