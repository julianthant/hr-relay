import { canonicalJsonStringify, JsonValueSchema } from "../../../rules/validation/canonical-json.js";
import type { JsonObject, JsonValue } from "../../../rules/validation/canonical-json.js";
import { localDatePart } from "../../../rules/time/clock.js";
import type { Clock } from "../../../rules/time/clock.js";
import { GateIdSchema, FingerprintSchema, PositiveIntSchema, RunIdSchema } from "../../../rules/identity/ids.js";
import { deriveGateResultCheckpointFingerprint, SourceGateResultRecordSchema } from "../../../models/workflow/gates.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { lifecycleCommandId } from "../../../rules/commands/lifecycle-command-id.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import type { RunRecord } from "../../../models/run/record.js";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import type { RuntimeFlowNode } from "../../../models/workflow/graph.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import { requireLifecycleApplied, type RunRecordService } from "../../runs/lifecycle/run-record-service.js";
import { z } from "zod";

type GateNode = Extract<RuntimeFlowNode, { kind: "gate" }>;
type SourceGateNode = Extract<GateNode, { resolvedBy: "children-terminal" | "external" }>;

export interface GateSourceCorrelationInput {
  readonly run: RunRecord;
  readonly canonicalInput: JsonValue;
  readonly dependencyOutputs: JsonObject;
}

/** A registered adapter can see retained run authority, but receives no external lookup capability. */
export interface GateSourcePort {
  readonly kind: "workflow" | "external";
  readonly sourceId: string;
  bindCorrelation(input: GateSourceCorrelationInput): unknown;
  subscribe(
    deliver: (event: GateSourceEnvelope) => Promise<GateSourceDelivery>,
    signal: AbortSignal,
  ): Promise<() => void | Promise<void>>;
}

export const GateSourceEnvelopeSchema = z.strictObject({
  eventId: z.string().min(1),
  runId: RunIdSchema,
  attempt: PositiveIntSchema,
  gateId: GateIdSchema,
  expectedVersion: PositiveIntSchema,
  event: JsonValueSchema,
});
export type GateSourceEnvelope = z.infer<typeof GateSourceEnvelopeSchema>;

export type GateSourceDelivery =
  | Readonly<{ state: "settled" | "replayed"; result: unknown }>
  | Readonly<{ state: "refused"; reason: string }>;

export function gateSourceIdentity(node: SourceGateNode): Readonly<{
  kind: "workflow" | "external";
  sourceId: string;
}> {
  return node.resolvedBy === "external"
    ? { kind: "external", sourceId: node.subscribes.sourceId }
    : { kind: "workflow", sourceId: node.subscribes.workflow.id };
}

function correlationAt(event: unknown, key: string): JsonValue {
  let value: unknown = event;
  for (const segment of key.split(".")) {
    if (value === null || typeof value !== "object" || Array.isArray(value)
      || !Object.hasOwn(value, segment)) {
      throw new Error(`source event has no correlation field "${key}"`);
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return JsonValueSchema.parse(value);
}

function digest(value: unknown): z.infer<typeof FingerprintSchema> {
  return FingerprintSchema.parse(sha256Hex(canonicalJsonStringify(JsonValueSchema.parse(value))));
}

export interface GateSourceRuntime {
  bind(
    node: SourceGateNode,
    input: Readonly<{
      run: RunRecord;
      canonicalInput: JsonValue;
      dependencyOutputs: JsonObject;
      parkedVersion: number;
    }>,
  ): NonNullable<Extract<RunRecord["lifecycle"], { state: "parked-gate" }>["sourceBinding"]>;
  start(signal: AbortSignal): Promise<() => Promise<void>>;
}

/** Production worker composition and synthetic descriptor tests share this authority-bound runtime. */
export function createGateSourceRuntime(input: Readonly<{
  database: AuthorityDatabase;
  lifecycle: RunRecordService;
  descriptors: Readonly<{ resolve(workflowId: string): AnyWorkflowDescriptor | undefined }>;
  ports: readonly GateSourcePort[];
  clock: Clock;
}>): GateSourceRuntime {
  const ports = new Map<string, GateSourcePort>();
  for (const port of input.ports) {
    const key = `${port.kind}:${port.sourceId}`;
    if (ports.has(key)) throw new Error(`duplicate gate source registration ${key}`);
    ports.set(key, port);
  }

  const portForNode = (node: SourceGateNode): GateSourcePort => {
    const identity = gateSourceIdentity(node);
    const port = ports.get(`${identity.kind}:${identity.sourceId}`);
    if (port === undefined) {
      throw new Error(`gate ${node.id} requires registered ${identity.kind} source ${identity.sourceId}`);
    }
    return port;
  };

  function bind(
    node: SourceGateNode,
    bindingInput: Readonly<{
      run: RunRecord;
      canonicalInput: JsonValue;
      dependencyOutputs: JsonObject;
      parkedVersion: number;
    }>,
  ) {
    const port = portForNode(node);
    const identity = gateSourceIdentity(node);
    const correlationKey = node.subscribes.correlationKey;
    const correlation = JsonValueSchema.parse(port.bindCorrelation(bindingInput));
    const attempt = PositiveIntSchema.parse(bindingInput.run.envelope.attempt);
    const parkedVersion = PositiveIntSchema.parse(bindingInput.parkedVersion);
    return {
      kind: identity.kind,
      sourceId: identity.sourceId,
      correlationKey,
      correlationDigest: digest(correlation),
      eventSchemaHash: deriveSchemaHash(node.subscribes.event, "output"),
      resultSchemaHash: deriveSchemaHash(node.result, "output"),
      attempt,
      parkedVersion,
    };
  }

  function settle(port: GateSourcePort, envelopeInput: unknown): GateSourceDelivery {
    const parsedEnvelope = GateSourceEnvelopeSchema.safeParse(envelopeInput);
    if (!parsedEnvelope.success) {
      return { state: "refused", reason: `source event envelope is malformed: ${parsedEnvelope.error.message}` };
    }
    const envelope = parsedEnvelope.data;
    const eventDigest = digest(envelope.event);
    return input.database.withAuthorityTransaction((repositories) => {
      const run = repositories.runs.get(envelope.runId);
      if (run === undefined) return { state: "refused" as const, reason: "run is absent from authority" };
      const descriptor = input.descriptors.resolve(run.envelope.workflow);
      if (descriptor === undefined || descriptor.version !== run.envelope.descriptorVersion
        || descriptor.contractFingerprint !== run.envelope.contractFingerprint) {
        return { state: "refused" as const, reason: "run descriptor binding is unavailable or changed" };
      }
      const candidate = descriptorRuntimeNodes(descriptor).find((node) =>
        node.kind === "gate" && String(node.id) === String(envelope.gateId));
      if (candidate === undefined || candidate.kind !== "gate") {
        return { state: "refused" as const, reason: "event gate is not declared by the retained descriptor" };
      }
      if (candidate.resolvedBy === "operator") {
        return { state: "refused" as const, reason: "source dispatch cannot settle an operator gate" };
      }
      const identity = gateSourceIdentity(candidate);
      if (identity.kind !== port.kind || identity.sourceId !== port.sourceId) {
        return { state: "refused" as const, reason: "registered source identity does not match the declared gate" };
      }
      const parsedEvent = candidate.subscribes.event.safeParse(envelope.event);
      if (!parsedEvent.success) {
        return { state: "refused" as const, reason: `source event does not match its schema: ${parsedEvent.error.message}` };
      }
      if (candidate.resolvedBy === "children-terminal" && candidate.subscribes.terminal !== undefined) {
        const terminal = parsedEvent.data !== null && typeof parsedEvent.data === "object"
          && !Array.isArray(parsedEvent.data) && "terminal" in parsedEvent.data
          ? parsedEvent.data.terminal
          : undefined;
        if (typeof terminal !== "string" || !candidate.subscribes.terminal.includes(terminal)) {
          return { state: "refused" as const, reason: "child terminal event is outside the gate's declared terminal set" };
        }
      }
      const correlationKey = candidate.subscribes.correlationKey;
      let correlationDigest: string;
      let result: unknown;
      let resultSchemaHash: string;
      let boundResult: Readonly<{ schemaHash: string; value: unknown }>;
      let checkpointFingerprint: string;
      try {
        correlationDigest = digest(correlationAt(parsedEvent.data, correlationKey));
        result = candidate.result.parse(candidate.resolve(parsedEvent.data));
        resultSchemaHash = deriveSchemaHash(candidate.result, "output");
        boundResult = { schemaHash: resultSchemaHash, value: result };
        checkpointFingerprint = deriveGateResultCheckpointFingerprint(boundResult);
      } catch (error) {
        return { state: "refused" as const, reason: error instanceof Error ? error.message : "source event could not be resolved" };
      }
      const existing = repositories.gateResults.get(`${envelope.runId}:${envelope.gateId}`);
      if (existing !== undefined) {
        if (!("source" in existing)
          || existing.expectedVersion !== envelope.expectedVersion
          || existing.source.kind !== identity.kind
          || existing.source.sourceId !== identity.sourceId
          || existing.source.eventId !== envelope.eventId
          || existing.source.eventDigest !== eventDigest
          || existing.source.correlationKey !== correlationKey
          || existing.source.correlationDigest !== correlationDigest
          || existing.source.attempt !== envelope.attempt
          || existing.checkpointFingerprint !== checkpointFingerprint
          || canonicalJsonStringify(existing.result) !== canonicalJsonStringify(boundResult)) {
          return { state: "refused" as const, reason: "gate already has a conflicting source result" };
        }
        return { state: "replayed" as const, result: existing.result };
      }
      if (run.envelope.attempt !== envelope.attempt || run.lifecycle.state !== "parked-gate"
        || run.lifecycle.gateId !== envelope.gateId || run.version !== envelope.expectedVersion
        || run.lifecycle.sourceBinding === undefined) {
        return { state: "refused" as const, reason: "run is not parked at this source gate, attempt and version" };
      }
      const binding = run.lifecycle.sourceBinding;
      if (binding.kind !== identity.kind || binding.sourceId !== identity.sourceId
        || binding.correlationKey !== correlationKey || binding.correlationDigest !== correlationDigest
        || binding.eventSchemaHash !== deriveSchemaHash(candidate.subscribes.event, "output")
        || binding.resultSchemaHash !== resultSchemaHash || binding.attempt !== envelope.attempt
        || binding.parkedVersion !== envelope.expectedVersion) {
        return { state: "refused" as const, reason: "source event differs from the exact retained park binding" };
      }
      const now = input.clock.now().toISOString();
      const record = SourceGateResultRecordSchema.parse({
        nodeId: candidate.id,
        runId: envelope.runId,
        gateId: envelope.gateId,
        expectedVersion: envelope.expectedVersion,
        resolvedAt: now,
        checkpointFingerprint,
        source: {
          kind: identity.kind,
          sourceId: identity.sourceId,
          eventId: envelope.eventId,
          eventDigest,
          correlationKey,
          correlationDigest,
          attempt: envelope.attempt,
        },
        result: boundResult,
      });
      const inserted = repositories.gateResults.insert(record);
      if (inserted.state !== "inserted") throw new Error(`source gate ${envelope.gateId} lost its result insert fence`);
      const commandId = lifecycleCommandId("source-gate", {
        sourceKind: identity.kind,
        sourceId: identity.sourceId,
        eventId: envelope.eventId,
        runId: envelope.runId,
        gateId: envelope.gateId,
        expectedVersion: envelope.expectedVersion,
      });
      repositories.timelineEvents.append({
        schemaVersion: 1,
        eventId: lifecycleCommandId("timeline-gate-resolved", commandId),
        workflow: run.envelope.workflow,
        scope: { kind: "run", runId: run.envelope.runId },
        occurredAt: now,
        recordedAt: now,
        retentionDate: localDatePart(new Date(now)),
        source: { kind: "native" },
        payload: { kind: "span", event: {
          t: "gate.resolved", ts: now, pid: process.pid, workflow: run.envelope.workflow,
          runId: run.envelope.runId, attempt: run.envelope.attempt, traceId: run.envelope.traceId,
          spanPath: run.envelope.traceId, gate: envelope.gateId, resolutionKey: "resolved",
          resultHash: sha256Hex(`hrauto:gate-resolved-span:v1\0${canonicalJsonStringify(boundResult)}`),
        } },
      });
      const resumed = input.lifecycle.transition({
        commandId,
        runId: envelope.runId,
        expectedVersion: envelope.expectedVersion,
        lifecycle: { state: "queued" },
      });
      requireLifecycleApplied(resumed);
      return { state: "settled" as const, result: record.result };
    });
  }

  return Object.freeze({
    bind,
    async start(signal: AbortSignal): Promise<() => Promise<void>> {
      const stops: Array<() => void | Promise<void>> = [];
      try {
        for (const port of ports.values()) {
          stops.push(await port.subscribe((event) => Promise.resolve(settle(port, event)), signal));
        }
      } catch (error) {
        await Promise.allSettled(stops.map((stop) => Promise.resolve().then(stop)));
        throw error;
      }
      return async () => { await Promise.all(stops.map((stop) => Promise.resolve().then(stop))); };
    },
  });
}
