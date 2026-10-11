import { Hono } from "hono";
import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { z } from "zod";
import { composeDataQueries } from "../../../../../src/backend/app/composition/dashboard/data.js";
import type { RunDetailDescriptorView,RunDetailQueryDeps } from "../../../../../src/backend/runs/queries/run-detail-types.js";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { registerDataRoutes } from "../../../../../src/backend/transports/http/routes/data.js";
import { RunDetailSectionResponseSchema } from "../../../../../src/models/dashboard/run-detail.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../../../src/models/workflow/checkpoint.js";
import type { AnyWorkflowDescriptor } from "../../../../../src/workflow-kit/workflow.js";
import { HASH_A,HASH_B,NOW } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
import {
makeWorld,
runRecordOf,
type DashboardWorld
} from "../../../../support/helpers/backend/dashboard-harness.js";
import { sqliteRunReader } from "../../../../support/helpers/canonical-run-reader.js";

const worlds: DashboardWorld[] = [];
function world(): DashboardWorld {
  const created = makeWorld();
  worlds.push(created);
  return created;
}
afterEach(() => {
  for (const current of worlds.splice(0)) current.dispose();
});

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

describe("read-only Context Data projection", () => {

  it("serves prior-run data through the production section route with exact source identity", async () => {
    const current = world();
    const source = sourceRun(current, { seed: 21, attempt: 1, claimGeneration: 1 });
    const laterBase = runRecordOf({ seed: 22, attempt: 2, claimGeneration: 1 });
    const later = RunRecordSchema.parse({
      ...laterBase,
      envelope: { ...laterBase.envelope, itemId: source.envelope.itemId, retryOf: source.envelope.runId },
    });
    current.database.authority.runs.enqueue(later);
    storeCheckpoint(current, checkpointFor(source, { outputValue: {
      invitedOn: { state: "present", value: "PRIOR_RUN_VALUE" },
    } }));
    storeCheckpoint(current, checkpointFor(later, { outputValue: {
      invitedOn: { state: "present", value: "CURRENT_RUN_VALUE" },
    } }));
    const deps = depsOf(current);
    const app: DashboardApp = new Hono();
    registerDataRoutes(app, () => composeDataQueries(deps));
    const response = await app.request("/api/v1/runs/" + source.envelope.runId + "/context-data");
    assert.equal(response.status, 200);
    const section = RunDetailSectionResponseSchema.parse(await response.json());
    assert.equal(section.section, "context-data");
    if (section.section !== "context-data") throw new Error("wrong section");
    assert.equal(section.payload.runId, source.envelope.runId);
    assert.equal(section.payload.entries.find((entry) => entry.label === "Invited on")?.valueRedacted, "PRIOR_RUN_VALUE");
    assert.equal(JSON.stringify(section).includes("CURRENT_RUN_VALUE"), false);
  });
});
