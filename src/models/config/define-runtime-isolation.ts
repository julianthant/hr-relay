import { z } from "zod";

export const RuntimeProfileSchema = z.enum(["production", "staging", "development"]);
export type RuntimeProfile = z.infer<typeof RuntimeProfileSchema>;
export const runtimeProfiles = Object.freeze({
  production: Object.freeze({ backendPort: 3938, lockPort: 3939, frontendPort: 5174, namespace: "Relay" } as const),
  staging: Object.freeze({ backendPort: 3941, lockPort: 3942, frontendPort: 5175, namespace: "Relay-staging" } as const),
  development: Object.freeze({ backendPort: 3940, lockPort: 3943, frontendPort: 5176, namespace: "Relay-development" } as const),
});

export function profileForDashboardPort(port: string): RuntimeProfile | undefined {
  return RuntimeProfileSchema.options.find(profile => {
    const { backendPort, frontendPort } = runtimeProfiles[profile];
    return port === String(backendPort) || port === String(frontendPort);
  });
}

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

export type RuntimeIsolation = ReturnType<typeof defineRuntimeIsolation>;

export function defineRuntimeIsolation(input: unknown, profile: RuntimeProfile) {
  const base = RuntimeIsolationSchema.parse(input);
  if (profile === "production") return Object.freeze(base);
  const { backendPort, frontendPort, lockPort } = runtimeProfiles[profile];
  return Object.freeze({ ...base, backendPort, frontendPort, lockPort });
}
