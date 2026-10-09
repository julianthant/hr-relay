/** The host's primary display, published once per process tree as ONE runtime-owned value, so every spawned worker resolves the identical default and config fingerprint. */
import { z } from "zod";
import { DEFAULT_DISPLAY, type Config } from "./schema.js";

export const HOST_PRIMARY_DISPLAY_ENV = "HRAUTO_HOST_PRIMARY_DISPLAY";

const HostDisplayDimensionSchema = z.number().int().positive().max(65_535);

/** Decoded host facts, never an environment-shaped override input. */
export const HostConfigFactsSchema = z.strictObject({
  primaryDisplay: z.strictObject({
    screenWidth: HostDisplayDimensionSchema,
    screenHeight: HostDisplayDimensionSchema,
  }).nullable(),
});
export type HostConfigFacts = z.infer<typeof HostConfigFactsSchema>;

export function hostConfigFacts(environment: NodeJS.ProcessEnv): HostConfigFacts {
  const published = readPublishedValue(environment);
  return HostConfigFactsSchema.parse({
    primaryDisplay: published === undefined || published === "none" ? null : hostDisplayDefault(environment),
  });
}

export const HostPrimaryDisplayObservationSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("detected"),
    screenWidth: HostDisplayDimensionSchema,
    screenHeight: HostDisplayDimensionSchema,
    source: z.enum(["system_profiler", "powershell", "xrandr"]),
  }),
  z.strictObject({
    state: z.literal("unavailable"),
    reason: z.enum(["unsupported-platform", "no-display", "probe-missing"]),
  }),
]);
export type HostPrimaryDisplayObservation = z.infer<typeof HostPrimaryDisplayObservationSchema>;

/** The exact published grammar: `WxH` for a detected display, `none` for a host without one. */
const HostPrimaryDisplayValueSchema = z.union([
  z.literal("none"),
  z.string().regex(/^[1-9]\d{0,4}x[1-9]\d{0,4}$/u),
]);

/** The injected probe seam: production hands `probePrimaryDisplay`, tests a fixed observation. */
export const HostDisplayProbeSchema = z.custom<() => HostPrimaryDisplayObservation>(
  (value) => typeof value === "function",
);
export type HostDisplayProbe = z.infer<typeof HostDisplayProbeSchema>;

export function encodeHostPrimaryDisplay(observation: HostPrimaryDisplayObservation): string {
  const parsed = HostPrimaryDisplayObservationSchema.parse(observation);
  return parsed.state === "detected"
    ? `${String(parsed.screenWidth)}x${String(parsed.screenHeight)}`
    : "none";
}

function readPublishedValue(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env[HOST_PRIMARY_DISPLAY_ENV];
  if (raw === undefined) return undefined;
  const result = HostPrimaryDisplayValueSchema.safeParse(raw.trim());
  if (!result.success) {
    throw new Error(
      `${HOST_PRIMARY_DISPLAY_ENV} is not a host display value; expected <width>x<height> or none`,
    );
  }
  return result.data;
}

/** The `display` group default for one resolution: the published host display when the process tree established one, else the fixed schema default. */
export function hostDisplayDefault(env: NodeJS.ProcessEnv): Config["display"] {
  const published = readPublishedValue(env);
  if (published === undefined || published === "none") return DEFAULT_DISPLAY;
  const [width, height] = published.split("x");
  return {
    screenWidth: HostDisplayDimensionSchema.parse(Number(width)),
    screenHeight: HostDisplayDimensionSchema.parse(Number(height)),
  };
}

/** Establish the host display for this process tree: keep a published value (validated, never re-probed), otherwise run the probe ONCE and publish it. */
export function establishHostPrimaryDisplay(
  probe: HostDisplayProbe,
  env: NodeJS.ProcessEnv,
): string {
  const published = readPublishedValue(env);
  if (published !== undefined) return published;
  const value = encodeHostPrimaryDisplay(probe());
  env[HOST_PRIMARY_DISPLAY_ENV] = value;
  return value;
}

/** Only the host display leaf of an environment, so no other environment override can leak into the defaults column. */
export function hostPrimaryDisplayEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const published = readPublishedValue(env);
  return published === undefined ? {} : { [HOST_PRIMARY_DISPLAY_ENV]: published };
}
