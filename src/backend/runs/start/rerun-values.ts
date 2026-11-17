import type { EvidenceSchemaReader } from "../../../models/storage/evidence-schema-admission.js";
import { checkpointRecordKey } from "../../../models/workflow/checkpoint.js";
import { validateRerunSourcePlan, RerunRefusedError, rerunEvidenceReader, validateRerunWriteProof, validateRerunTransactionEvidence } from "./rerun.js";
import { z } from "zod";
import { descriptorRuntimeNodes, workflowDelegatedDescriptor, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { RunExistenceSchema, type RunExistence } from "../../../models/config/authority.js";
import { canonicalJsonStringify, JsonValueSchema, type JsonValue } from "../../../rules/validation/canonical-json.js";
import { RerunValuesRequestSchema, RerunValuesResponseSchema,
  type RerunValuesRefusalCode, type RerunValuesResponse, type RerunValuesSnapshot } from "../../../models/dashboard/rerun-values.js";
import { retainedRunProtectedBindings, valueFreeProtectedData } from "../../../models/write-safety/protected-input.js";
import { FingerprintSchema } from "../../../rules/identity/ids.js";
import { repeatEvidenceDigest } from "../../../models/run/rerun.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { projectTransactionOutcome } from "../../../models/workflow/graph.js";
import type { RuntimeFlowNode } from "../../../models/workflow/graph.js";
import type { RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import type { RunRecord } from "../../../models/run/record.js";
import { RerunValueMappingsSchema } from "../../../models/workflow/rerun-values.js";
import { TransactionOutcomeSchema } from "../../../rules/write-safety/write-safety-primitives.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import { rerunInputFieldAccepts, rerunTargetAccepts } from "../../../models/validation/rerun-values.js";
import { workbookInputBinding } from "../workbooks.js";

export interface RerunValuesDependencies {
  readonly reader: { read(runId: string): RunExistence };
  readonly database: Pick<AuthorityDatabase, "authority" | "withAuthorityReadSnapshot"> & Partial<Pick<AuthorityDatabase, "evidenceSchemaHash">>;
  readonly descriptors: { resolve(workflow: string): AnyWorkflowDescriptor | undefined };
  /** Source-owned task observations only; never the fold's run lifecycle. */
  readonly executions?: (runId: string) => readonly Readonly<{
    nodeId: string; attempt: number; startedAt?: string; endedAt?: string;
    outcome?: "done" | "failed" | "cancelled" | "discarded" | "skipped" | "interrupted" | "superseded";
  }>[];
}

class SourceRefused extends Error {
  constructor(readonly code: RerunValuesRefusalCode) { super(`RERUN_VALUES_${code}`); }
}
function refuse(code: RerunValuesRefusalCode): never { throw new SourceRefused(code); }

function atPath(value: JsonValue, path: string): JsonValue | undefined {
  let current = value;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, key)
      || (Array.isArray(current) && !/^(?:0|[1-9][0-9]*)$/u.test(key))) return undefined;
    const next: unknown = Reflect.get(current, key);
    if (next === undefined) return undefined;
    current = JsonValueSchema.parse(next);
  }
  return current;
}

function validateCheckpoint(checkpoint: RunCheckpointRecord, node: RuntimeFlowNode, schemaReader?: EvidenceSchemaReader): void {
  const schema = node.kind === "task" ? node.uses.output : node.kind === "transaction" ? TransactionOutcomeSchema : undefined;
  if (schema === undefined || (schemaReader?.({ kind: "task-output", id: checkpointRecordKey(checkpoint) }, checkpoint, checkpoint.output.schemaHash, deriveSchemaHash(schema, "output")) ?? checkpoint.output.schemaHash) !== deriveSchemaHash(schema, "output")
    || !schema.safeParse(checkpoint.output.value).success) refuse("source-invalid");
  if (node.kind === "transaction") {
    // This authenticates both nested schemas, not merely the JSON wrapper.
    try { projectTransactionOutcome(node.commit.uses, checkpoint.output.value, "Rerun source", { checkpoint, schemaReader }); }
    catch { refuse("source-invalid"); }
  }
}

function containsProtected(value: JsonValue, privateValues: readonly string[]): boolean {
  if (typeof value === "string") return privateValues.some((secret) => value.includes(secret));
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((child) => containsProtected(JsonValueSchema.parse(child), privateValues));
}

type NodeFact = RerunValuesSnapshot["steps"][number]["nodes"][number];
type StepFact = RerunValuesSnapshot["steps"][number];
const ADVANCE = { unfinished: 0, failed: 1, completed: 2 } as const;

function childWorkflows(descriptor: AnyWorkflowDescriptor): readonly string[] {
  return [...new Set(descriptor.startRows.flatMap(({ members }) => members.flatMap(({ workflow }) => workflow === undefined ? [] : [workflow])))];
}

/** One child run's node states, from what it recorded; display only, so nothing here refuses the source. */
function childNodeFacts(repositories: AuthorityDatabase["authority"], descriptor: AnyWorkflowDescriptor, run: RunRecord): ReadonlyMap<string, NodeFact> {
  const runId = run.envelope.runId;
  const checkpoints = new Map(repositories.runCheckpoints.listByItem(descriptor.id, run.envelope.itemId)
    .filter((checkpoint) => checkpoint.runId === runId).map((checkpoint) => [checkpoint.nodeId, checkpoint]));
  const gates = new Set(repositories.gateResults.listByRun(runId).map(({ gateId }) => String(gateId)));
  const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
  const failed = failureId === undefined ? undefined : repositories.failures.listByRun(runId).find((failure) => failure.failureId === failureId)?.nodeId;
  const settled = new Set(repositories.writeIntents.listByRun(runId)
    .filter(({ status }) => status === "committed" || status === "observed-present").map(({ taskId }) => String(taskId)));
  return new Map(descriptorRuntimeNodes(descriptor).map((node): [string, NodeFact] => {
    const nodeId = String(node.id), checkpoint = checkpoints.get(nodeId);
    const fact: Pick<NodeFact, "state" | "reason"> = checkpoint?.assertion !== undefined ? { state: "unfinished", reason: "operator-asserted" }
      : failed === nodeId ? { state: "failed", reason: "failure" }
        : checkpoint !== undefined ? { state: "completed", reason: "checkpoint" }
          : gates.has(nodeId) ? { state: "completed", reason: "gate-result" }
            : node.kind === "transaction" && settled.has(String(node.commit.uses.id)) ? { state: "completed", reason: "settled-transaction" }
              : { state: "unfinished", reason: "not-recorded" };
    return [nodeId, { nodeId: node.id, ...fact }];
  }));
}

/** Each step as the least advanced child run left it; with no child run, nothing is recorded. */
function leastAdvancedSteps(descriptor: AnyWorkflowDescriptor, runs: readonly ReadonlyMap<string, NodeFact>[]): readonly StepFact[] {
  return descriptor.timeline.map((step) => {
    const views = (runs.length === 0 ? [new Map<string, NodeFact>()] : runs).map((facts): StepFact => {
      const nodes = step.nodes.map(({ id }) => facts.get(String(id)) ?? { nodeId: id, state: "unfinished", reason: "not-recorded" });
      const state = nodes.some(({ state }) => state === "failed") ? "failed" : nodes.every(({ state }) => state === "completed") ? "completed" : "unfinished";
      return { key: step.key, state, nodes };
    });
    return views.reduce((least, view) => ADVANCE[view.state] < ADVANCE[least.state] ? view : least);
  });
}

/** One snapshot, only reads. This response carries no plan or repeat authorization. */
export function readRerunValues(deps: RerunValuesDependencies, input: unknown): RerunValuesResponse {
  const request = RerunValuesRequestSchema.parse(input);
  try {
    const schemaReader = rerunEvidenceReader(deps.database.evidenceSchemaHash?.bind(deps.database));
    return deps.database.withAuthorityReadSnapshot(() => {
      const existence = RunExistenceSchema.parse(deps.reader.read(request.runId));
      if (existence.state === "deleted") refuse("target-deleted");
      if (existence.state === "absent") refuse("target-not-found");
      const run = existence.run;
      if (run.envelope.runId !== request.runId) refuse("source-invalid");
      if (run.version !== request.expectedVersion) refuse("source-stale");
      const descriptor = deps.descriptors.resolve(run.envelope.workflow);
      if (descriptor === undefined || descriptor.id !== run.envelope.workflow) refuse("descriptor-mismatch");
      const older = descriptor.version !== run.envelope.descriptorVersion
        || descriptor.contractFingerprint !== run.envelope.contractFingerprint;
      const { lifecycle } = run;
      if (lifecycle.state !== "terminal" || !["done", "failed", "interrupted"].includes(lifecycle.outcome)) refuse("source-ineligible");
      if (!older && ((schemaReader?.({ kind: "run-input", id: run.envelope.runId }, run.input, run.input.parsed.schemaHash, deriveSchemaHash(descriptor.canonicalInput, "output")) ?? run.input.parsed.schemaHash) !== deriveSchemaHash(descriptor.canonicalInput, "output")
        || !descriptor.canonicalInput.safeParse(run.input.parsed.value).success)) refuse("source-invalid");
      const repositories = deps.database.authority;
      try { validateRerunSourcePlan(repositories, run); }
      catch (error) { if (error instanceof RerunRefusedError) refuse("source-invalid"); throw error; }
      const intents = repositories.writeIntents.listByRun(request.runId);
      if (intents.some((intent) => !("runId" in intent) || intent.runId !== request.runId
        || intent.workflowId !== descriptor.id || intent.itemId !== run.envelope.itemId || intent.runAttempt > run.envelope.attempt)) refuse("source-invalid");
      if (intents.some(({ status }) => status === "parked" || status === "attempting")
        || repositories.writeIntents.listAttemptingByItem({ workflowId: descriptor.id, itemId: run.envelope.itemId }).length > 0) refuse("source-ineligible");
      const nodes = descriptorRuntimeNodes(descriptor);
      const nodeById = new Map(nodes.map((node) => [String(node.id), node]));
      const checkpoints = new Map<string, RunCheckpointRecord>();
      for (const checkpoint of repositories.runCheckpoints.listByItem(descriptor.id, run.envelope.itemId)) {
        if (checkpoint.runId !== request.runId) continue;
        if (checkpoint.workflowId !== descriptor.id || checkpoint.itemId !== run.envelope.itemId
          || checkpoint.attempt > run.envelope.attempt
          || (checkpoint.claimGeneration !== undefined && checkpoint.claimGeneration > run.claimGeneration)) refuse("source-invalid");
        if (checkpoint.descriptorVersion !== run.envelope.descriptorVersion
          || checkpoint.contractFingerprint !== run.envelope.contractFingerprint) refuse("source-invalid");
        const node = nodeById.get(checkpoint.nodeId);
        if (node === undefined) {
          if (older && !TransactionOutcomeSchema.safeParse(checkpoint.output.value).success) continue;
          refuse("source-invalid");
        }
        if (!older || node.kind === "transaction") validateCheckpoint(checkpoint, node, schemaReader);
        const previous = checkpoints.get(checkpoint.nodeId);
        if (previous === undefined || checkpoint.attempt > previous.attempt
          || (checkpoint.attempt === previous.attempt && checkpoint.claimGeneration !== undefined
            && (previous.claimGeneration === undefined || checkpoint.claimGeneration > previous.claimGeneration))) checkpoints.set(checkpoint.nodeId, checkpoint);
      }
      const gates = repositories.gateResults.listByRun(request.runId).filter(gate => {
        if (gate.runId !== request.runId) refuse("source-invalid");
        const node = nodeById.get(gate.gateId);
        return !older || (node?.kind === "gate" && (schemaReader?.({ kind: "gate-result", id: canonicalJsonStringify([gate.runId, gate.gateId]) }, gate, gate.result.schemaHash, deriveSchemaHash(node.result, "output")) ?? gate.result.schemaHash) === deriveSchemaHash(node.result, "output")
          && node.result.safeParse(gate.result.value).success);
      });
      for (const gate of gates) {
        const node = nodeById.get(gate.gateId);
        if (gate.runId !== request.runId || node?.kind !== "gate" || (schemaReader?.({ kind: "gate-result", id: canonicalJsonStringify([gate.runId, gate.gateId]) }, gate, gate.result.schemaHash, deriveSchemaHash(node.result, "output")) ?? gate.result.schemaHash) !== deriveSchemaHash(node.result, "output")
          || !node.result.safeParse(gate.result.value).success) refuse("source-invalid");
      }
      const failures = repositories.failures.listByRun(request.runId);
      const failure = lifecycle.failureId === undefined ? undefined : failures.find(({ failureId }) => failureId === lifecycle.failureId);
      if (lifecycle.failureId !== undefined && (failure === undefined || failure.runId !== request.runId
        || failure.workflowId !== descriptor.id || failure.attempt !== run.envelope.attempt)) refuse("source-invalid");
      if (!older && failure?.nodeId !== undefined && !nodeById.has(failure.nodeId)) refuse("source-invalid");
      const executions = deps.executions?.(request.runId) ?? [];
      if (executions.some(({ attempt }) => !Number.isSafeInteger(attempt) || attempt < 1 || attempt > run.envelope.attempt)) refuse("source-invalid");
      const bindings = retainedRunProtectedBindings(run);
      const privateValues = bindings.map(({ inputPath }) => {
        const value = atPath(run.input.parsed.value, inputPath);
        if (typeof value !== "string" || value.length === 0) refuse("source-invalid");
        return value;
      });
      const facts = new Map<string, NodeFact>();
      for (const node of nodes) {
        const checkpoint = checkpoints.get(node.id);
        const omitted = run.envelope.stepOmissions?.some(({ workflow, step }) => workflow === undefined
          && descriptor.stepOmissions.find((spec) => spec.step === step)?.skips?.includes(String(node.id)) === true) === true;
        const observed = executions.filter(({ nodeId }) => nodeId === node.id).sort((a, b) =>
          a.attempt - b.attempt || (a.startedAt ?? a.endedAt ?? "").localeCompare(b.startedAt ?? b.endedAt ?? "")).at(-1);
        let fact: NodeFact;
        if (checkpoint?.assertion !== undefined || omitted) fact = { nodeId: node.id, state: "unfinished", reason: checkpoint?.assertion === undefined ? "step-omitted" : "operator-asserted" };
        else if (failure?.nodeId === node.id || (observed?.outcome === "failed"
          && (checkpoint === undefined || observed.attempt > checkpoint.attempt
            || (observed.attempt === checkpoint.attempt && (observed.endedAt === undefined || observed.endedAt >= checkpoint.writtenAt))))) fact = { nodeId: node.id, state: "failed", reason: "failure" };
        else if (observed !== undefined && observed.outcome !== "done"
          && (checkpoint === undefined || observed.attempt > checkpoint.attempt
            || (observed.attempt === checkpoint.attempt && observed.startedAt !== undefined && observed.startedAt > checkpoint.writtenAt))) {
          fact = { nodeId: node.id, state: "unfinished", reason: "incomplete-execution" };
        } else if (checkpoint !== undefined) fact = { nodeId: node.id, state: "completed", reason: "checkpoint" };
        else if (gates.some(({ gateId }) => String(gateId) === String(node.id))) fact = { nodeId: node.id, state: "completed", reason: "gate-result" };
        else fact = { nodeId: node.id, state: "unfinished", reason: "not-recorded" };
        facts.set(node.id, fact);
      }
      const transactions: RerunValuesSnapshot["transactions"] = [];
      for (const intent of intents) {
        if (intent.status !== "committed") continue;
        const node = nodes.find((candidate) => candidate.kind === "transaction" && "bindingProof" in intent
          && intent.bindingProof.afterPrepareSpanPath === `${run.envelope.traceId}/${candidate.id}/prepare`);
        if (node?.kind !== "transaction" || intent.taskId !== node.commit.uses.id) refuse("source-invalid");
        const step = descriptor.timeline.find((category) => category.nodes.some(({ id }) => id === node.id));
        if (step === undefined) refuse("source-invalid");
        const proof = validateRerunWriteProof(node.commit.uses, intent, schemaReader);
        if (containsProtected(valueFreeProtectedData(proof, bindings), privateValues)) refuse("source-invalid");
        transactions.push({ stepKey: step.key, nodeId: node.id, taskId: intent.taskId, writeIntentId: intent.writeIntentId,
          evidenceDigest: FingerprintSchema.parse(repeatEvidenceDigest(intent, bindings)), disposition: intent.status });
        const fact = facts.get(node.id);
        if (fact?.state === "unfinished" && fact.reason === "not-recorded") facts.set(node.id, { nodeId: node.id, state: "completed", reason: "settled-transaction" });
      }
      // An observed-present intent has no runId by design. Authenticate its
      // source relationship through the exact checkpoint and natural business key.
      for (const node of nodes) {
        const checkpoint = checkpoints.get(node.id);
        if (node.kind !== "transaction" || checkpoint === undefined || checkpoint.assertion !== undefined) continue;
        const linked = validateRerunTransactionEvidence({ repositories, descriptor, run, node, checkpoint, checkpoints, gates, schemaReader });
        const step = descriptor.timeline.find((category) => category.nodes.some(({ id }) => id === node.id));
        if (step === undefined) refuse("source-invalid");
        for (const intent of linked) {
          if (intent.status !== "committed" && intent.status !== "observed-present") refuse("source-invalid");
          const proof = validateRerunWriteProof(node.commit.uses, intent, schemaReader);
          if (containsProtected(valueFreeProtectedData(proof, bindings), privateValues)) refuse("source-invalid");
          if (!transactions.some((entry) => entry.nodeId === node.id && entry.writeIntentId === intent.writeIntentId)) {
            transactions.push({ stepKey: step.key, nodeId: node.id, taskId: intent.taskId, writeIntentId: intent.writeIntentId,
              evidenceDigest: FingerprintSchema.parse(repeatEvidenceDigest(intent, bindings)), disposition: intent.status });
          }
        }
      }
      const mappings = RerunValueMappingsSchema.parse(descriptor.rerunValues ?? []);
      const values: RerunValuesSnapshot["values"] = mappings.map((mapping) => {
        const step = descriptor.timeline.find((category) => category.nodes.some(({ id }) => id === mapping.nodeId));
        if (step === undefined) refuse("source-invalid");
        const coordinates = { ...mapping, sourceStepKey: step.key };
        const checkpoint = checkpoints.get(mapping.nodeId);
        if (facts.get(mapping.nodeId)?.state !== "completed" || checkpoint === undefined)
          return { ...coordinates, state: "unavailable", reason: "not-completed" };
        const value = atPath(checkpoint.output.value, mapping.fieldPath);
        if (value === undefined) return { ...coordinates, state: "unavailable", reason: "not-recorded" };
        const safe = atPath(valueFreeProtectedData(checkpoint.output.value, bindings), mapping.fieldPath);
        if (safe === undefined || canonicalJsonStringify(safe) !== canonicalJsonStringify(value) || containsProtected(value, privateValues))
          return { ...coordinates, state: "unavailable", reason: "protected" };
        if (!rerunTargetAccepts(descriptor, mapping, value)
          || !rerunTargetAccepts({ input: descriptor.canonicalInput, stepOmissions: descriptor.stepOmissions }, mapping, value)) return { ...coordinates, state: "unavailable", reason: "target-invalid" };
        const provenance = [...checkpoint.provenance].filter(({ path }) => path === mapping.fieldPath || mapping.fieldPath.startsWith(`${path}.`))
          .sort((a, b) => b.path.length - a.path.length)[0];
        if (provenance === undefined) return { ...coordinates, state: "unavailable", reason: "provenance-unavailable" };
        return { ...coordinates, state: "available", value, provenance,
          checkpoint: { attempt: checkpoint.attempt, writtenAt: checkpoint.writtenAt,
            ...(checkpoint.claimGeneration === undefined ? {} : { claimGeneration: checkpoint.claimGeneration }) } };
      });
      const steps = descriptor.timeline.map((step) => {
        const members = step.nodes.map(({ id }) => { const fact = facts.get(id); if (fact === undefined) refuse("source-invalid"); return fact; });
        const state = members.some(({ state }) => state === "failed") ? "failed"
          : members.every(({ state }) => state === "completed") ? "completed" : "unfinished";
        return older ? { key: step.key, state: "unfinished", nodes: members.map(member => ({
          nodeId: member.nodeId, state: "unfinished", reason: "not-recorded",
        })) } : { key: step.key, state, nodes: members };
      });
      const children = childWorkflows(descriptor).map((workflow) => {
        const child = workflowDelegatedDescriptor(descriptor, workflow);
        const latest = new Map<string, RunRecord>();
        for (const member of repositories.runs.listChildren(run.envelope.runId)) {
          if (member.envelope.workflow !== workflow) continue;
          const known = latest.get(member.envelope.itemId);
          if (known === undefined || member.envelope.attempt > known.envelope.attempt) latest.set(member.envelope.itemId, member);
        }
        return { workflow, steps: leastAdvancedSteps(child, [...latest.values()].map((member) => childNodeFacts(repositories, child, member))) };
      });
      // The source's typed facts refill a step it had typed, its own or a child's a row targets; they stay typed by hand.
      const typed = (run.envelope.stepOmissions ?? []).filter((entry) => (entry.workflow === undefined
        ? descriptor.stepOmissions.some((spec) => spec.step === entry.step)
        : descriptor.startRows.some(({ target }) => target?.workflow === entry.workflow && target.step === entry.step))
        && !containsProtected(JsonValueSchema.parse(entry.facts), privateValues));
      let sourceInput: RerunValuesSnapshot["sourceInput"] = { state: "available", value: run.input.parsed.value };
      if (canonicalJsonStringify(valueFreeProtectedData(run.input.parsed.value, bindings)) !== canonicalJsonStringify(run.input.parsed.value)
        || containsProtected(run.input.parsed.value, privateValues)) sourceInput = { state: "unavailable", reason: "protected" };
      else if (older && descriptor.surfaces.inputRun?.typedInput !== undefined) {
        const input = run.input.parsed.value;
        const parsed = descriptor.input.safeParse(input);
        const canonical = descriptor.canonicalInput.safeParse(input);
        if (!parsed.success || !canonical.success || canonicalJsonStringify(parsed.data) !== canonicalJsonStringify(input)
          || canonicalJsonStringify(canonical.data) !== canonicalJsonStringify(input)) {
          const declaration = descriptor.surfaces.inputRun.typedInput;
          const mode = declaration.modes.find(mode => atPath(input, declaration.modeField) === mode.value);
          const accepted: Record<string, JsonValue> = {};
          if (mode !== undefined) for (const field of [declaration.modeField, ...mode.defaults.map(entry => entry.field), ...mode.identityFields]) {
            const value = atPath(input, field);
            if (value !== undefined && rerunInputFieldAccepts(descriptor.input, field, value)
              && rerunInputFieldAccepts(descriptor.canonicalInput, field, value)) accepted[field] = value;
          }
          const identityCopied = mode !== undefined && mode.identityFields.every(field => atPath(input, field) === undefined || Object.hasOwn(accepted, field))
            && (mode.parser.kind === "name-tuple" ? Object.hasOwn(accepted, mode.parser.familyName) && Object.hasOwn(accepted, mode.parser.givenName)
              && mode.parser.identifiers.some(identifier => Object.hasOwn(accepted, identifier.field))
              : mode.identityFields.some(field => Object.hasOwn(accepted, field)));
          if (!identityCopied) for (const field of mode?.identityFields ?? []) delete accepted[field];
          sourceInput = { state: "partial", value: accepted, identityCopied };
        }
      }
      const surface = descriptor.surfaces.inputRun;
      if (sourceInput.state === "unavailable" && surface !== undefined && surface.typedInput === undefined) {
        const accepted: Record<string, JsonValue> = {};
        const safeInput = valueFreeProtectedData(run.input.parsed.value, bindings);
        for (const field of new Set(surface.parser.rules.map(rule => rule.emit))) {
          const value = atPath(run.input.parsed.value, field);
          const safe = atPath(safeInput, field);
          if (typeof value !== "string" || value.length === 0 || safe !== value || containsProtected(value, privateValues)) continue;
          if (rerunInputFieldAccepts(descriptor.input, field, value)
            && rerunInputFieldAccepts(descriptor.canonicalInput, field, value)) accepted[field] = value;
        }
        if (Object.keys(accepted).length > 0) sourceInput = { state: "partial", value: accepted, identityCopied: true };
      }
      if (sourceInput.state === "available") {
        const binding = workbookInputBinding(descriptor.canonicalInput);
        if (binding?.sourceToIngress !== undefined) {
          const canonical = descriptor.canonicalInput.safeParse(sourceInput.value);
          if (canonical.success && canonicalJsonStringify(canonical.data) === canonicalJsonStringify(sourceInput.value))
            sourceInput = { state: "available", value: JsonValueSchema.parse(binding.sourceToIngress(canonical.data)) };
        }
      }
      return RerunValuesResponseSchema.parse({ state: "available", snapshot: {
        sourceInput,
        source: { runId: request.runId, version: run.version, workflow: descriptor.id,
          descriptorVersion: run.envelope.descriptorVersion, contractFingerprint: run.envelope.contractFingerprint, outcome: lifecycle.outcome },
        steps, values, transactions,
        ...(children.length === 0 ? {} : { children }),
        ...(typed.length === 0 ? {} : { typed }),
      } });
    });
  } catch (error) {
    if (error instanceof RerunRefusedError) return { state: "refused", code: "source-invalid" };
    if (error instanceof SourceRefused) return { state: "refused", code: error.code };
    if (error instanceof z.ZodError || error instanceof SyntaxError) return { state: "refused", code: "source-invalid" };
    throw error;
  }
}
