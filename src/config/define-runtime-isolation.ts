import { z } from "zod";

export const RebuildArtifactRootSchema = z.literal(".tracker/artifacts");

const RuntimeIsolationSchema = z.strictObject({
  stateRoot: z.literal(".tracker"),
  artifactRoot: RebuildArtifactRootSchema,
  backendPort: z.literal(3938),
  frontendPort: z.literal(5174),
  processLockRoot: z.literal(".tracker/locks"),
  // D216: the same NAME as legacy's on purpose — the roots are repo-relative so
  // the two runtimes never share the directory, and the browser-state identity
  // that must stay distinct is `browserSessionNamespace`, which still does.
  browserProfileRoot: z.literal(".auth"),
  browserSessionNamespace: z.literal("hrauto-rebuild"),
});

export type RuntimeIsolation = z.infer<typeof RuntimeIsolationSchema>;

export function defineRuntimeIsolation(input: unknown): RuntimeIsolation {
  return Object.freeze(RuntimeIsolationSchema.parse(input));
}
