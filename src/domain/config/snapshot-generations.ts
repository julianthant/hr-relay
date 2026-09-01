import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJsonStringify } from "../canonical-json.js";
import { deepFreeze } from "../immutability.js";
import { ConfigLeafPathSchema, configLeafPaths } from "./resolve.js";
import { ConfigSchema } from "./schema.js";

/**
 * THE CONFIG SCHEMA'S OWN VERSION LINE, INDEPENDENT OF THE SQLITE MIGRATION
 * CHAIN (D133, ref clock-config-secrets §4.1).
 *
 * A `config_snapshots` row is EVIDENCE of the configuration one run executed
 * under. Three facts make it un-rewritable:
 *
 *  1. `ConfigSnapshotRecord.fingerprint` is a SHA-256 over exactly the stored
 *     `config` bytes (`./resolve.ts`), and the run envelope retains that same
 *     fingerprint. Editing the row breaks the binding it exists to prove.
 *  2. `config_snapshots` is an insert-only authority repository. Nothing in the
 *     runtime may UPDATE it, so a migration that did would contradict the store.
 *  3. Back-filling today's default MISSTATES HISTORY. A pre-D125 run had no
 *     `timeouts.sessionAcquireMs` at all — that absence is the whole reason a
 *     dead CRM session burned 262.9s inside `withDriver` on the live exit run.
 *     Writing `60000` into that row would claim the run held a bound it did not.
 *
 * So adding a required config leaf changes no TABLE — it changes what a stored
 * ROW must contain — and it is versioned HERE rather than in
 * `src/infra/sqlite/migrations.ts`. Each generation names the decision that
 * introduced it, lists the leaves it introduced, and pins the exact leaf set of
 * the config AT that generation. A snapshot captured at an older generation is
 * read FORWARD: the leaves later generations introduced are permitted to be
 * absent, `configSnapshotAbsentLeaves` reports exactly which, and no value is
 * invented for them. Every OTHER shape defect — a missing baseline leaf, a
 * missing group, an unknown key, a wrong type — still fails loud at database
 * open, because that is corruption rather than schema evolution.
 *
 * Generation 1 is the shape the 2026-08-04 Phase-1 exit database actually
 * carries (`.tracker-rebuild/phase1-exit-state.db`). Anything older is not
 * represented by a surviving database and is deliberately NOT tolerated: an
 * unverifiable historical shape gets a loud refusal, not a guess.
 */
export const ConfigSnapshotGenerationSchema = z.strictObject({
  generation: z.number().int().positive(),
  /** The decision that introduced this generation's leaves. */
  decision: z.string().min(1),
  /** Leaves this generation ADDED. Empty exactly at the baseline generation. */
  introduced: z.array(ConfigLeafPathSchema).readonly(),
  /** Leaves this generation retired from live config while old snapshots retain them. */
  retired: z.array(ConfigLeafPathSchema).readonly(),
  /** SHA-256 over the complete leaf set of the config AT this generation. */
  leafDigest: z.string().regex(/^[0-9a-f]{64}$/),
});

export type ConfigSnapshotGeneration = z.infer<typeof ConfigSnapshotGenerationSchema>;

export const CONFIG_SNAPSHOT_GENERATIONS = deepFreeze([
  {
    generation: 1,
    decision: "D121",
    introduced: [],
    retired: [],
    leafDigest: "92c0c4e5d49dd3a8eb6276a48f91e279dbc512b219fe2ae2c36d61e516aaa045",
  },
  {
    generation: 2,
    decision: "D125",
    introduced: ["timeouts.sessionAcquireMs"],
    retired: [],
    leafDigest: "8cb95d3cdf4ed5012a3e4ba69a9d496f5c86ef38ba0ed3e0da44efc0647af3d8",
  },
  {
    generation: 3,
    decision: "D267",
    introduced: ["timeouts.duoCeremonyLeaseGraceMs"],
    retired: [],
    leafDigest: "fc5c224d9378ec31213cc9b9d86f2ddc619354a38ca798ab538c51e5c9b3cb17",
  },
  {
    generation: 4,
    decision: "D294",
    introduced: [],
    retired: [
      "capture.activeIdleTtlMs",
      "capture.ingress",
      "capture.maxPhotoBytes",
      "capture.maxPhotos",
      "capture.maxSlices",
      "capture.maxWidth",
      "capture.preConnectTtlMs",
      "capture.sliceHeight",
      "capture.sliceOverlap",
      "capture.width",
    ],
    leafDigest: "c513f3a46af935f05e339f117d3d2f6af015d79f24fba775074dd8e932c82a71",
  },
] as const satisfies readonly ConfigSnapshotGeneration[]);

export const CURRENT_CONFIG_SNAPSHOT_GENERATION = 4;

/**
 * The leaves introduced after the baseline generation — precisely the leaves a
 * stored snapshot is permitted to lack, and nothing else.
 */
export const POST_BASELINE_CONFIG_LEAVES = deepFreeze(
  CONFIG_SNAPSHOT_GENERATIONS.flatMap(({ generation, introduced }) => generation === 1 ? [] : [...introduced]),
);

/** SHA-256 over a config's complete leaf set, order-independent. */
export function configLeafDigest(paths: readonly string[]): string {
  return createHash("sha256")
    .update("hrauto:config-leaf-set:v1\0")
    .update(canonicalJsonStringify([...new Set(paths)].sort()))
    .digest("hex");
}

/**
 * `ConfigSchema` as a STORED SNAPSHOT ROW must contain it. Two deliberate
 * differences from the live schema:
 *
 *  1. EVERY GROUP DEFAULT IS STRIPPED. `ConfigSchema`'s `.default(...)`s exist
 *     so a fresh resolve can start from nothing; applying them while READING a
 *     durable row silently fabricates a whole group the run never had. That is
 *     how `browser.headless` / `browser.closeProofMs` slipped in without a
 *     brick — pre-`browser` rows quietly read back as today's launch policy.
 *     A stored row must carry its own values or fail loud.
 *  2. EXACTLY the registered post-baseline leaves are optional, so a genuine
 *     older snapshot is readable while any other hole is still a hard failure.
 *
 * The stored bytes are never modified — `sessionAcquireMs` stays absent in the
 * parsed value, so `configSnapshotAbsentLeaves` can report the truth and the
 * stored fingerprint keeps hashing exactly what it hashed at capture.
 */
const CurrentStoredConfigSchema = z.strictObject({
  actor: ConfigSchema.shape.actor.unwrap(),
  urls: ConfigSchema.shape.urls.unwrap(),
  // Generation 2 (D125) introduced `timeouts.sessionAcquireMs`; generation 3
  // (D267) introduced `timeouts.duoCeremonyLeaseGraceMs`.
  timeouts: ConfigSchema.shape.timeouts.unwrap().partial({ sessionAcquireMs: true, duoCeremonyLeaseGraceMs: true }),
  paths: ConfigSchema.shape.paths,
  annualDates: ConfigSchema.shape.annualDates.unwrap(),
  operator: ConfigSchema.shape.operator.unwrap(),
  display: ConfigSchema.shape.display.unwrap(),
  performance: ConfigSchema.shape.performance.unwrap(),
  ocr: ConfigSchema.shape.ocr.unwrap(),
  browserHealth: ConfigSchema.shape.browserHealth.unwrap(),
  browser: ConfigSchema.shape.browser.unwrap(),
  concurrency: ConfigSchema.shape.concurrency.unwrap(),
  daemon: ConfigSchema.shape.daemon.unwrap(),
  features: ConfigSchema.shape.features.unwrap(),
  providers: ConfigSchema.shape.providers.unwrap(),
});

/** Parse-only compatibility for immutable snapshots written before D294. */
const RetiredPhoneCaptureConfigSchema = z.strictObject({
  ingress: z.enum(["disabled", "on-demand-ngrok", "forwarded"]),
  forwardedUrl: z.url().refine((value) => value.startsWith("https://"), "URL must use HTTPS").optional(),
  preConnectTtlMs: z.number().int().positive(),
  activeIdleTtlMs: z.number().int().positive(),
  maxPhotoBytes: z.number().int().positive(),
  maxPhotos: z.number().int().positive(),
  width: z.number().int().positive(),
  maxWidth: z.number().int().positive(),
  sliceHeight: z.number().int().positive(),
  sliceOverlap: z.number().int().nonnegative(),
  maxSlices: z.number().int().positive(),
});

const LegacyStoredConfigSchema = z.strictObject({
  ...CurrentStoredConfigSchema.shape,
  capture: RetiredPhoneCaptureConfigSchema,
});

export const StoredConfigSchema = z.union([CurrentStoredConfigSchema, LegacyStoredConfigSchema]);

export type StoredConfig = z.infer<typeof StoredConfigSchema>;

/**
 * The registered leaves this stored config DOES NOT CARRY — "these did not
 * exist when the snapshot was captured", which is a different fact from "these
 * were set to today's default".
 */
export function configSnapshotAbsentLeaves(config: StoredConfig): readonly string[] {
  const present = new Set(configLeafPaths(config));
  return Object.freeze(POST_BASELINE_CONFIG_LEAVES.filter((leaf) => !present.has(leaf)));
}

/** The newest generation whose every introduced leaf is present in the row. */
export function configSnapshotGeneration(config: StoredConfig): number {
  const present = new Set(configLeafPaths(config));
  const absent = new Set(configSnapshotAbsentLeaves(config));
  let generation = 1;
  for (const entry of CONFIG_SNAPSHOT_GENERATIONS) {
    if (entry.introduced.some((leaf) => absent.has(leaf))) break;
    if (entry.retired.some((leaf) => present.has(leaf))) break;
    generation = entry.generation;
  }
  return generation;
}

/**
 * The ratchet: the CURRENT config's leaf set must be exactly what the newest
 * generation pinned, and every older generation's pinned set must still be
 * reconstructible by reversing additions and retirements after it. Adding a required
 * leaf without registering it changes the current digest and fails HERE, before
 * it can reach a durable row and brick every existing authority database.
 */
export function auditConfigSnapshotGenerations(currentLeafPaths: readonly string[]): readonly string[] {
  const violations: string[] = [];
  const generations = CONFIG_SNAPSHOT_GENERATIONS;
  const newest = generations.at(-1);
  if (newest === undefined) return ["config snapshot generations must not be empty"];

  for (const [index, entry] of generations.entries()) {
    if (entry.generation !== index + 1) violations.push(`config snapshot generation ${String(entry.generation)} is out of order at position ${String(index)}`);
    if (index === 0 && (entry.introduced.length > 0 || entry.retired.length > 0)) {
      violations.push("the baseline config snapshot generation changes no leaves by definition");
    }
    if (index > 0 && entry.introduced.length === 0 && entry.retired.length === 0) {
      violations.push(`config snapshot generation ${String(entry.generation)} changes no leaf, so it is not a generation`);
    }
  }
  if (CURRENT_CONFIG_SNAPSHOT_GENERATION !== newest.generation) {
    violations.push(`CURRENT_CONFIG_SNAPSHOT_GENERATION ${String(CURRENT_CONFIG_SNAPSHOT_GENERATION)} must name the newest registered generation ${String(newest.generation)}`);
  }
  if (new Set(POST_BASELINE_CONFIG_LEAVES).size !== POST_BASELINE_CONFIG_LEAVES.length) {
    violations.push("a config leaf may be introduced by exactly one generation");
  }

  const retiredLeaves = generations.flatMap(({ retired }) => [...retired]);
  if (new Set(retiredLeaves).size !== retiredLeaves.length) {
    violations.push("a config leaf may be retired by exactly one generation");
  }

  const current = new Set(currentLeafPaths);
  for (const leaf of POST_BASELINE_CONFIG_LEAVES) {
    if (!current.has(leaf)) violations.push(`registered config leaf ${leaf} is absent from the current config schema; a released generation is never rewritten`);
  }

  let leaves = [...current];
  for (const entry of [...generations].reverse()) {
    const digest = configLeafDigest(leaves);
    if (digest !== entry.leafDigest) {
      violations.push(
        `config leaf set at generation ${String(entry.generation)} digests ${digest}, not the pinned ${entry.leafDigest}`
        + " — register every added leaf in CONFIG_SNAPSHOT_GENERATIONS and bump CURRENT_CONFIG_SNAPSHOT_GENERATION,"
        + " because a required leaf added without one invalidates every stored config snapshot",
      );
    }
    const removed = new Set<string>(entry.introduced);
    leaves = leaves.filter((leaf) => !removed.has(leaf));
    leaves.push(...entry.retired);
  }
  return Object.freeze(violations);
}
