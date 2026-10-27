import { type RunDetailDescriptorView } from "../../../../src/backend/runs/queries/run-detail.js";
import { makeWorld, runRecordOf, uuidOf, type DashboardWorld } from "./dashboard-harness.js";
import { z } from "zod";
import { type RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail-types.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { HASH_A, HASH_B, NOW } from "../../fixtures/phase1c-contract-fixtures.js";
import { sqliteRunReader } from "../canonical-run-reader.js";





export function createRunDetailTestWorld() {
  const worlds: DashboardWorld[] = [];

  async function world(): Promise<DashboardWorld> {
    const created = await makeWorld();
    worlds.push(created);
    return created;
  }

  const DATE_VALUE_SCHEMA = z.strictObject({
    state: z.enum(["present", "absent"]),
    value: z.string().optional(),
    reason: z.string().optional(),
  });

  const OUTPUT_SCHEMA = z.strictObject({
    emplId: z.string().optional(),
    invitedOn: DATE_VALUE_SCHEMA.optional(),
    startsOn: DATE_VALUE_SCHEMA.optional(),
    completedOn: DATE_VALUE_SCHEMA.optional(),
  });

  const OUTPUT_SCHEMA_HASH = deriveSchemaHash(OUTPUT_SCHEMA, "output");

  const DATE_FIELDS = [
    { nodeId: "crm-dates", fieldPath: "invitedOn.value", label: "Invited on" },
    { nodeId: "crm-dates", fieldPath: "startsOn.value", label: "Starts on" },
    { nodeId: "crm-dates", fieldPath: "completedOn.value", label: "Completed on" },
  ] as const;

  const EXACT_DESCRIPTOR = {
    id: "person-lookup",
    version: 1,
    contractFingerprint: HASH_A,
    nodes: [{ kind: "task", id: "crm-dates", uses: { output: OUTPUT_SCHEMA } }],
  } as unknown as AnyWorkflowDescriptor;

  function descriptorView(fields: readonly Readonly<{ nodeId: string; fieldPath: string; label: string }>[]
    = DATE_FIELDS): RunDetailDescriptorView {
    return {
      capabilities: { editData: { fields } },
      dataOrigins: [{
        nodeId: "crm-dates",
        step: "CRM dates",
        taskId: "crm-read",
        role: "task",
        dir: "read",
        system: "crm",
        feeds: [],
      }],
    };
  }

  function depsOf(
    current: DashboardWorld,
    options: Readonly<{
      fields?: readonly Readonly<{ nodeId: string; fieldPath: string; label: string }>[];
      reader?: RunDetailQueryDeps["runReader"];
      database?: NonNullable<RunDetailQueryDeps["canonical"]>["database"];
      exactDescriptor?: AnyWorkflowDescriptor | undefined;
    }> = {},
  ): RunDetailQueryDeps {
    const reader = options.reader ?? sqliteRunReader(current.database, current.clock);
    return {
      runReader: reader,
      timeline: current.timeline,
      stateRoot: current.stateRoot,
      projection: current.projection,
      authority: current.authority,
      descriptors: { resolve: () => descriptorView(options.fields) },
      canonical: {
        reader,
        database: options.database ?? current.database,
        descriptors: { resolve: () => options.exactDescriptor === undefined
          ? EXACT_DESCRIPTOR
          : options.exactDescriptor },
      },
    };
  }

  function sourceRun(current: DashboardWorld, input: Parameters<typeof runRecordOf>[0]) {
    const run = runRecordOf(input);
    current.database.authority.runs.enqueue(run);
    return run;
  }

  function checkpointFor(
    run: ReturnType<typeof runRecordOf>,
    overrides: Readonly<{
      outputValue?: unknown;
      nodeId?: string;
      runId?: string;
      attempt?: number;
      claimGeneration?: number;
      descriptorVersion?: number;
      contractFingerprint?: string;
      schemaHash?: string;
      provenance?: readonly unknown[];
    }> = {},
  ) {
    return RunCheckpointRecordSchema.parse({
      workflowId: run.envelope.workflow,
      itemId: run.envelope.itemId,
      nodeId: overrides.nodeId ?? "crm-dates",
      attempt: overrides.attempt ?? run.envelope.attempt,
      claimGeneration: overrides.claimGeneration ?? 1,
      runId: overrides.runId ?? run.envelope.runId,
      output: {
        schemaHash: overrides.schemaHash ?? OUTPUT_SCHEMA_HASH,
        value: overrides.outputValue ?? {
          emplId: "10000023",
          invitedOn: { state: "present", value: "2026-06-01" },
          startsOn: { state: "present", value: "2026-07-15" },
          completedOn: { state: "absent", reason: "No completed transition" },
        },
      },
      descriptorVersion: overrides.descriptorVersion ?? run.envelope.descriptorVersion,
      contractFingerprint: overrides.contractFingerprint ?? run.envelope.contractFingerprint,
      implFingerprint: HASH_B,
      provenance: overrides.provenance ?? [],
      writtenAt: NOW,
    });
  }

  function storeCheckpoint(current: DashboardWorld, record: ReturnType<typeof checkpointFor>) {
    current.database.authority.runCheckpoints.insert(record);
  }

  const RUN_ID = uuidOf(1);
  const cleanup = async () => {
    for (const w of worlds.splice(0)) await w.dispose();
  };
  return { worlds, world, OUTPUT_SCHEMA_HASH, EXACT_DESCRIPTOR, depsOf, sourceRun, checkpointFor, storeCheckpoint, RUN_ID, cleanup };
}
