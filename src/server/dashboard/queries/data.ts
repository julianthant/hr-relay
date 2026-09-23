import { localDatePart } from "../../../domain/clock.js";
import { deriveSchemaHash } from "../../../domain/schema-bound-value.js";
import { valueFreeProtectedData, retainedRunProtectedBindings } from "../../../domain/protected-input.js";
import type { JsonValue } from "../../../domain/canonical-json.js";
import {
  ContextDataSectionSchema,
  RunDetailSectionResponseSchema,
  type RunDetailSectionResponse,
} from "../../../domain/dashboard/run-detail.js";
import { ContractFieldPathSchema } from "../../../domain/contracts/base.js";
import { BrowserSystemIdSchema, NodeIdSchema } from "../../../domain/ids.js";
import type { RunRecord } from "../../../domain/run/record.js";
import type { RunCheckpointRecord } from "../../../domain/workflow/checkpoint.js";
import type { AnyWorkflowDescriptor } from "../../../base/workflow.js";
import type { RunDetailQueryDeps, RunDetailDescriptorView } from "./run-detail-types.js";
import { TargetNotFoundError, SectionUnavailableError } from "../../failures.js";
import type { z } from "zod";

type ContextDataPayload = z.infer<typeof ContextDataSectionSchema>;
type ContextDataEntry = ContextDataPayload["entries"][number];

function readDataRun(deps: RunDetailQueryDeps, runId: string) {
  const reader = deps.canonical?.reader ?? deps.runReader;
  if (reader === undefined) throw new Error("CANONICAL_DATA_READER_NOT_CONFIGURED");
  const existence = reader.read(runId);
  if (existence.state === "present" && existence.run.envelope.runId !== runId) {
    throw new Error("DATA_SOURCE_IDENTITY_MISMATCH");
  }
  return existence;
}

function requireLiveDataRun(deps: RunDetailQueryDeps, runId: string): RunRecord {
  const existence = readDataRun(deps, runId);
  if (existence.state !== "present") throw new TargetNotFoundError("DATA_SOURCE_" + existence.state);
  if (existence.disposition === "archived") throw new SectionUnavailableError("DATA_SOURCE_ARCHIVED");
  return existence.run;
}

function isJsonRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ScalarLookup =
  | { kind: "scalar"; value: string | number | boolean }
  | { kind: "absent" }
  | { kind: "protected" }
  | { kind: "not-scalar" };

function isProtectedMarker(value: JsonValue): boolean {
  if (!isJsonRecord(value)) return false;
  return value.kind === "protected-store" || value.kind === "test-data-local"
    || value.kind === "legacy-protected-input" || value.state === "withheld-protected-input";
}

function scalarAtPath(output: JsonValue, fieldPath: string): ScalarLookup {
  let current: JsonValue = output;
  for (const part of fieldPath.split(".")) {
    if (!isJsonRecord(current) || !Object.hasOwn(current, part)) return { kind: "absent" };
    current = current[part]!;
    if (isProtectedMarker(current)) return { kind: "protected" };
  }
  return typeof current === "string" || typeof current === "number" || typeof current === "boolean"
    ? { kind: "scalar", value: current }
    : { kind: "not-scalar" };
}

function displayScalar(value: string | number | boolean): string {
  const text = String(value);
  return text.length === 0 ? "(empty)" : text;
}

type FactProvenanceWire = Pick<ContextDataEntry, "observedAt" | "source" | "correctedAt" | "assertedStep">;

function provenanceFor(stored: RunCheckpointRecord, fieldPath: string): FactProvenanceWire {
  let best: RunCheckpointRecord["provenance"][number] | undefined;
  for (const point of stored.provenance) {
    const path = String(point.path);
    if (path !== fieldPath && !fieldPath.startsWith(path + ".")) continue;
    if (best === undefined || path.length > String(best.path).length) best = point;
  }
  const asserted = stored.assertion === undefined ? {} : { assertedStep: String(stored.assertion.step) };
  if (best === undefined) return asserted;
  return {
    observedAt: best.observedAt,
    source: best.source,
    ...(best.correctedAt === undefined ? {} : { correctedAt: best.correctedAt }),
    ...asserted,
  };
}

type ContextDataOriginWire = Pick<ContextDataEntry, "origin" | "freshness">;

function originOf(
  descriptor: RunDetailDescriptorView | undefined,
  nodeId: string,
  fieldPath: string,
): ContextDataOriginWire {
  const origin = descriptor?.dataOrigins?.find((entry) =>
    entry.nodeId === nodeId && (entry.role === undefined || entry.role === "task" || entry.role === "commit"));
  if (origin === undefined) return {};
  const bound = origin.freshness?.find((entry) => entry.fieldPath === fieldPath);
  return {
    origin: {
      nodeId: NodeIdSchema.parse(origin.nodeId),
      step: origin.step,
      dir: origin.dir,
      ...(origin.system === undefined ? {} : { system: BrowserSystemIdSchema.parse(origin.system) }),
    },
    ...(bound === undefined
      ? {}
      : { freshness: { maxAge: bound.maxAge, override: bound.override, feeds: origin.feeds.map((feed) => ({
        nodeId: NodeIdSchema.parse(feed.nodeId), label: feed.label,
      })) } }),
  };
}

function outputSchemaHashOf(descriptor: AnyWorkflowDescriptor, nodeId: string): string | undefined {
  const node = descriptor.nodes.find((candidate) => candidate.id === nodeId);
  if (node?.kind !== "task" || !("uses" in node)) return undefined;
  const contract = node.uses as { readonly output: z.ZodType };
  return deriveSchemaHash(contract.output, "output");
}

function checkpointOf(
  rows: readonly RunCheckpointRecord[],
  run: RunRecord,
  nodeId: string,
): RunCheckpointRecord | "foreign-run" | undefined {
  const matchingAttempt = rows.filter((row) => row.nodeId === nodeId
    && row.attempt === run.envelope.attempt);
  const matching = matchingAttempt.filter((row) => row.runId === run.envelope.runId);
  if (matching.length === 0) return matchingAttempt.length === 0 ? undefined : "foreign-run";
  matching.sort((left, right) => (left.claimGeneration ?? 0) - (right.claimGeneration ?? 0));
  return matching.at(-1);
}

function malformedEntry(label: string, nodeId: string, fieldPath: string,
  reason: "checkpoint-identity-mismatch" | "descriptor-mismatch" | "output-schema-mismatch"): ContextDataEntry {
  return {
    label,
    coordinate: { nodeId: NodeIdSchema.parse(nodeId), fieldPath: ContractFieldPathSchema.parse(fieldPath) },
    checkpoint: { state: "malformed", reason },
    valueState: "malformed",
    valueRedacted: "Checkpoint could not be verified",
  };
}

function entryOf(
  run: RunRecord,
  rows: readonly RunCheckpointRecord[],
  descriptor: RunDetailDescriptorView | undefined,
  exactDescriptor: AnyWorkflowDescriptor,
  field: Readonly<{ nodeId: string; fieldPath: string; label: string }>,
): ContextDataEntry {
  const coordinate = {
    nodeId: NodeIdSchema.parse(field.nodeId),
    fieldPath: ContractFieldPathSchema.parse(field.fieldPath),
  };
  const selected = checkpointOf(rows, run, field.nodeId);
  if (selected === "foreign-run") {
    return malformedEntry(field.label, field.nodeId, field.fieldPath, "checkpoint-identity-mismatch");
  }
  if (selected === undefined) {
    return {
      label: field.label,
      coordinate,
      checkpoint: { state: "absent", reason: "no-checkpoint-for-run" },
      valueState: "absent",
      valueRedacted: "Not recorded for this run",
    };
  }
  const stored = selected;
  if (stored.workflowId !== run.envelope.workflow || stored.itemId !== run.envelope.itemId
    || stored.nodeId !== field.nodeId || stored.runId !== run.envelope.runId
    || stored.attempt !== run.envelope.attempt
    || (stored.claimGeneration !== undefined && stored.claimGeneration > run.claimGeneration)) {
    return malformedEntry(field.label, field.nodeId, field.fieldPath, "checkpoint-identity-mismatch");
  }
  if (stored.descriptorVersion !== run.envelope.descriptorVersion
    || stored.contractFingerprint !== run.envelope.contractFingerprint
    || stored.descriptorVersion !== exactDescriptor.version
    || stored.contractFingerprint !== exactDescriptor.contractFingerprint) {
    return malformedEntry(field.label, field.nodeId, field.fieldPath, "descriptor-mismatch");
  }
  const expectedSchemaHash = outputSchemaHashOf(exactDescriptor, field.nodeId);
  if (expectedSchemaHash === undefined || stored.output.schemaHash !== expectedSchemaHash) {
    return malformedEntry(field.label, field.nodeId, field.fieldPath, "output-schema-mismatch");
  }

  const safeOutput = valueFreeProtectedData(stored.output.value, retainedRunProtectedBindings(run));
  const lookup = scalarAtPath(safeOutput, field.fieldPath);
  const checkpoint = {
    state: "present" as const,
    runId: stored.runId,
    attempt: stored.attempt,
    ...(stored.claimGeneration === undefined ? {} : { claimGeneration: stored.claimGeneration }),
    descriptorVersion: stored.descriptorVersion,
    contractFingerprint: stored.contractFingerprint,
    schemaHash: stored.output.schemaHash,
    writtenAt: stored.writtenAt,
  };
  const attribution = originOf(descriptor, field.nodeId, field.fieldPath);
  const provenance = provenanceFor(stored, field.fieldPath);
  if (lookup.kind === "protected") {
    return {
      label: field.label,
      coordinate,
      checkpoint, valueState: "redacted", valueRedacted: "Protected value withheld",
      ...attribution, ...provenance,
    };
  }
  if (lookup.kind === "absent") {
    return {
      label: field.label,
      coordinate,
      checkpoint, valueState: "absent", valueRedacted: "Not recorded on this outcome",
      ...attribution, ...provenance,
    };
  }
  if (lookup.kind === "not-scalar") {
    return malformedEntry(field.label, field.nodeId, field.fieldPath, "output-schema-mismatch");
  }
  return {
    label: field.label,
    coordinate,
    checkpoint, valueState: "present", valueRedacted: displayScalar(lookup.value),
    ...attribution, ...provenance,
  };
}

function buildContextDataPayload(deps: RunDetailQueryDeps, runId: string): ContextDataPayload {
  const existence = readDataRun(deps, runId);
  if (existence.state === "absent") throw new TargetNotFoundError("DATA_SOURCE_absent");
  if (existence.state === "deleted") {
    return ContextDataSectionSchema.parse({ runId, state: "deleted", entries: [] });
  }
  const run = existence.run;

  const descriptor = deps.descriptors.resolve(run.envelope.workflow);
  const exactDescriptor = deps.canonical?.descriptors.resolve(run.envelope.workflow);
  if (descriptor === undefined || exactDescriptor === undefined) {
    return ContextDataSectionSchema.parse({
      runId, state: "unavailable", reason: "descriptor-unavailable", entries: [],
    });
  }
  if (exactDescriptor.version !== run.envelope.descriptorVersion
    || exactDescriptor.contractFingerprint !== run.envelope.contractFingerprint) {
    return ContextDataSectionSchema.parse({
      runId, state: "unavailable", reason: "descriptor-mismatch", entries: [],
    });
  }
  const fields = typeof descriptor.capabilities?.editData === "object"
    ? descriptor.capabilities.editData.fields
    : [];
  const database = deps.canonical?.database;
  if (database === undefined) {
    return ContextDataSectionSchema.parse({
      runId, state: "unavailable", reason: "checkpoint-reader-unavailable", entries: [],
    });
  }
  const entries = database.withAuthorityReadSnapshot(() => {
    const rowsByNode = new Map<string, readonly RunCheckpointRecord[]>();
    for (const field of fields) {
      const nodeId = String(field.nodeId);
      if (!rowsByNode.has(nodeId)) {
        rowsByNode.set(nodeId, database.authority.runCheckpoints.listByAttempt(
          run.envelope.workflow, run.envelope.itemId, nodeId, run.envelope.attempt,
        ));
      }
    }
    return fields.map((field) => entryOf(
      run, rowsByNode.get(String(field.nodeId)) ?? [], descriptor, exactDescriptor,
      { nodeId: String(field.nodeId), fieldPath: field.fieldPath, label: field.label },
    ));
  });
  return ContextDataSectionSchema.parse({
    runId, state: existence.disposition === "archived" ? "archived" : "available", entries,
  });
}

export function buildDataSection(
  deps: RunDetailQueryDeps,
  runId: string,
  section: "context-data" | "context-attempts",
): RunDetailSectionResponse {
  if (section === "context-data") {
    return RunDetailSectionResponseSchema.parse({
      section,
      payload: buildContextDataPayload(deps, runId),
    });
  }

  const authority = requireLiveDataRun(deps, runId);
  const row = deps.projection.runFold(runId);
  if (row !== undefined && (row.queued.runId !== runId || row.queued.workflow !== authority.envelope.workflow))
    throw new Error("DATA_SOURCE_EVIDENCE_MISMATCH");
  return RunDetailSectionResponseSchema.parse({
    section,
    payload: {
      runId,
      entries: [
        { label: "current-attempt", valueRedacted: String(authority.envelope.attempt) },
        { label: "requeues", valueRedacted: row === undefined ? "not recorded" : String(row.requeues) },
        { label: "enqueued-day", valueRedacted: localDatePart(new Date(authority.envelope.enqueuedAt)) },
      ],
    },
  });
}

export function createDataQueries(deps: RunDetailQueryDeps) {
  return {
    contextData: (runId: string) => buildDataSection(deps, runId, "context-data"),
    contextAttempts: (runId: string) => buildDataSection(deps, runId, "context-attempts"),
    canonical: deps.canonical,
    source: deps,
  };
}
