/**
 * The `display` default is the host's primary display (D324) — a runtime value,
 * not a contract value, exactly as D121 made the path defaults.
 *
 * Precedence is `settings > default`; the environment is not a resolver input.
 * A composition establishes the host's primary
 * display once, through an injected probe (`src/infra/host/primary-display.ts`
 * in production), and publishes it as ONE runtime-owned environment value so
 * every child process the dashboard spawns (browser workers, launched with the
 * parent environment) resolves the identical default and therefore the
 * identical config fingerprint. A Settings override still wins over it, and
 * provenance reports it as `default`, which is what it is.
 *
 * A parent's published value is never re-probed: a monitor plugged in between
 * the dashboard boot and a worker spawn must not split the config generation.
 *
 * The fixed schema default remains ONLY for a host that has no display to
 * report (a headless CI runner, an SSH session) — a genuinely valid state for a
 * headless browser viewport. A malformed published value is a refusal, never a
 * fallback.
 *
 * This module never touches `process.env` itself: every function takes the
 * environment it reads, and the ONE write — publishing the probe result — is
 * `hostAwareResolutionEnvironment` in `src/domain/secrets.ts`, the sole owner
 * the secrets-single-source guard lets mutate the environment.
 */
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

/**
 * The `display` group default for one resolution: the published host display
 * when the process tree established one, else the fixed schema default.
 */
export function hostDisplayDefault(env: NodeJS.ProcessEnv): Config["display"] {
  const published = readPublishedValue(env);
  if (published === undefined || published === "none") return DEFAULT_DISPLAY;
  const [width, height] = published.split("x");
  return {
    screenWidth: HostDisplayDimensionSchema.parse(Number(width)),
    screenHeight: HostDisplayDimensionSchema.parse(Number(height)),
  };
}

/**
 * Establish the host display for this process tree: keep a value a parent
 * already published (validated, never re-probed), otherwise run the probe ONCE
 * and publish its encoding. Returns the published value.
 */
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

/**
 * Only the host display leaf of an environment — what a "defaults" resolution
 * needs so it reports the host default rather than the headless fallback,
 * without letting any other environment override leak into that column.
 */
export function hostPrimaryDisplayEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const published = readPublishedValue(env);
  return published === undefined ? {} : { [HOST_PRIMARY_DISPLAY_ENV]: published };
}
