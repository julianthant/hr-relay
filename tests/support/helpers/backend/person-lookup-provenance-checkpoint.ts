import { z } from "zod";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import {
  RunCheckpointRecordSchema,
  type FactProvenance,
  type RunCheckpointRecord,
} from "../../../../src/models/workflow/checkpoint.js";
import { JsonValueSchema } from "../../../../src/rules/validation/canonical-json.js";

export function createPersonLookupProvenanceCheckpoint(input: {
  readonly itemId: string;
  readonly runId: string;
  readonly contractFingerprint: string;
  readonly implFingerprint: string;
  readonly now: string;
}) {
  function checkpointFrom(
    nodeId: string,
    outputSchema: z.ZodType,
    output: unknown,
    provenance: readonly FactProvenance[],
    writtenAt = input.now,
  ): RunCheckpointRecord {
    return RunCheckpointRecordSchema.parse({
      workflowId: "person-lookup",
      itemId: input.itemId,
      nodeId,
      attempt: 1,
      claimGeneration: 1,
      runId: input.runId,
      output: {
        schemaHash: deriveSchemaHash(outputSchema, "output"),
        value: JsonValueSchema.parse(outputSchema.parse(output)),
      },
      descriptorVersion: 1,
      contractFingerprint: input.contractFingerprint,
      implFingerprint: input.implFingerprint,
      provenance,
      writtenAt,
    });
  }
  return { checkpointFrom };
}
