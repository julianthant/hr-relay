import { z } from "zod";
import { ActorIdSchema, ConfigSnapshotIdSchema, FingerprintSchema, IsoInstantSchema, PositiveIntSchema } from "../ids.js";
import { ConfigProvenanceSchema, ConfigLeafPathSchema } from "./resolve.js";
import {
  StoredConfigSchema,
  configSnapshotAbsentLeaves,
} from "./snapshot-generations.js";

/**
 * The durable snapshot as it is READ. `config` is exactly the stored bytes —
 * see `./snapshot-generations.ts` for why an older row is read forward instead
 * of rewritten, and for what "older" is allowed to mean.
 */
export const ConfigSnapshotRecordSchema = z.strictObject({
  configSnapshotId: ConfigSnapshotIdSchema,
  revision: PositiveIntSchema,
  fingerprint: FingerprintSchema,
  capturedAt: IsoInstantSchema,
  capturedBy: ActorIdSchema,
  config: StoredConfigSchema,
  provenance: z.record(ConfigLeafPathSchema, ConfigProvenanceSchema),
});

/**
 * The same record as it is WRITTEN. Reading an older generation forward is a
 * concession to history; MINTING one is a bug, so a new snapshot must carry
 * every leaf of the current generation. Without this arm the read tolerance
 * would quietly become a licence to persist a hole.
 */
export const ConfigSnapshotWriteSchema = ConfigSnapshotRecordSchema.superRefine((record, context) => {
  const absent = configSnapshotAbsentLeaves(record.config);
  if (absent.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["config"],
      message: `config snapshot ${record.configSnapshotId} omits current config leaves ${absent.join(", ")}`,
    });
  }
});

export type ConfigSnapshotRecord = z.infer<typeof ConfigSnapshotRecordSchema>;
