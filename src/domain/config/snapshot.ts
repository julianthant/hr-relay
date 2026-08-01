import { z } from "zod";
import { ActorIdSchema, ConfigSnapshotIdSchema, FingerprintSchema, IsoInstantSchema, PositiveIntSchema } from "../ids.js";
import { ConfigProvenanceSchema, ConfigLeafPathSchema } from "./resolve.js";
import { ConfigSchema } from "./schema.js";

export const ConfigSnapshotRecordSchema = z.strictObject({
  configSnapshotId: ConfigSnapshotIdSchema,
  revision: PositiveIntSchema,
  fingerprint: FingerprintSchema,
  capturedAt: IsoInstantSchema,
  capturedBy: ActorIdSchema,
  config: ConfigSchema,
  provenance: z.record(ConfigLeafPathSchema, ConfigProvenanceSchema),
});

export type ConfigSnapshotRecord = z.infer<typeof ConfigSnapshotRecordSchema>;
