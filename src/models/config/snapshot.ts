import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { z } from "zod";
import { ActorIdSchema, ConfigSnapshotIdSchema, FingerprintSchema, IsoInstantSchema, PositiveIntSchema } from "../../rules/identity/ids.js";
import { ConfigLeafPathSchema } from "./provenance.js";
import { ConfigSchema } from "./schema.js";

/** Stored configuration requires every current leaf and applies no live defaults. */
export const StoredConfigSchema = z.strictObject({
  actor: ConfigSchema.shape.actor.unwrap(),
  urls: ConfigSchema.shape.urls.unwrap(),
  timeouts: ConfigSchema.shape.timeouts.unwrap(),
  paths: ConfigSchema.shape.paths,
  annualDates: ConfigSchema.shape.annualDates.unwrap(),
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

export type StoredConfig = z.infer<typeof StoredConfigSchema>;

export const ConfigSnapshotRecordSchema = z.strictObject({
  configSnapshotId: ConfigSnapshotIdSchema,
  revision: PositiveIntSchema,
  fingerprint: FingerprintSchema,
  capturedAt: IsoInstantSchema,
  capturedBy: ActorIdSchema,
  config: StoredConfigSchema,
  provenance: z.record(ConfigLeafPathSchema, z.enum(["settings", "default"])),
}).superRefine((record,context)=>{
  if(record.fingerprint !== sha256Hex(canonicalJsonStringify(record.config)))context.addIssue({code:"custom",path:["fingerprint"],message:"config-snapshot-fingerprint-mismatch"});
});

export const ConfigSnapshotWriteSchema = ConfigSnapshotRecordSchema;
export type ConfigSnapshotRecord = z.infer<typeof ConfigSnapshotRecordSchema>;
