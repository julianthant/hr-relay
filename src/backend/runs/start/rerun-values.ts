import { validateRerunSourcePlan, RerunRefusedError } from "./rerun.js";
import { z } from "zod";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { RunExistenceSchema, type RunExistence } from "../../../models/config/authority.js";
import { canonicalJsonStringify, JsonValueSchema, type JsonValue } from "../../../rules/validation/canonical-json.js";
import { RerunValuesRequestSchema, RerunValuesResponseSchema,
  type RerunValuesRefusalCode, type RerunValuesResponse, type RerunValuesSnapshot } from "../../../models/dashboard/rerun-values.js";
import { retainedRunProtectedBindings, valueFreeProtectedData } from "../../../models/write-safety/protected-input.js";
import { FingerprintSchema, BrowserSystemIdSchema } from "../../../rules/identity/ids.js";
import { deriveIdempotencyKeyDigest, IdempotencyKeySchema } from "../../../rules/write-safety/write-safety.js";
import { repeatEvidenceDigest } from "../../../models/run/rerun.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { projectTransactionOutcome } from "../../../models/workflow/graph.js";
import type { RuntimeFlowNode } from "../../../models/workflow/graph.js";
import type { RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import { RerunValueMappingsSchema } from "../../../models/workflow/rerun-values.js";
import { TransactionOutcomeSchema } from "../../../rules/write-safety/write-safety-primitives.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import { rerunInputFieldAccepts, rerunTargetAccepts } from "../../../models/validation/rerun-values.js";

export interface RerunValuesDependencies {
  readonly reader: { read(runId: string): RunExistence };
  readonly database: Pick<AuthorityDatabase, "authority" | "withAuthorityReadSnapshot">;
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
    if (current === null || typeof current !== "object" || Array.isArray(current) || !Object.hasOwn(current, key)) return undefined;
    const next: unknown = Reflect.get(current, key);
    if (next === undefined) return undefined;
    current = JsonValueSchema.parse(next);
  }
  return current;
}

function validateCheckpoint(checkpoint: RunCheckpointRecord, node: RuntimeFlowNode): void {
  const schema = node.kind === "task" ? node.uses.output : node.kind === "transaction" ? TransactionOutcomeSchema : undefined;
  if (schema === undefined || checkpoint.output.schemaHash !== deriveSchemaHash(schema, "output")
    || !schema.safeParse(checkpoint.output.value).success) refuse("source-invalid");
  if (node.kind === "transaction") {
    // This authenticates both nested schemas, not merely the JSON wrapper.
    try { projectTransactionOutcome(node.commit.uses, checkpoint.output.value, "Rerun source"); }
    catch { refuse("source-invalid"); }
  }
}

function containsProtected(value: JsonValue, privateValues: readonly string[]): boolean {
  if (typeof value === "string") return privateValues.some((secret) => value.includes(secret));
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((child) => containsProtected(JsonValueSchema.parse(child), privateValues));
}

/** One snapshot, only reads. This response carries no plan or repeat authorization. */
export function readRerunValues(deps: RerunValuesDependencies, input: unknown): RerunValuesResponse {
  const request = RerunValuesRequestSchema.parse(input);
  try {
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
      if (!older && (run.input.parsed.schemaHash !== deriveSchemaHash(descriptor.canonicalInput, "output")
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
        if (!older || node.kind === "transaction") validateCheckpoint(checkpoint, node);
        const previous = checkpoints.get(checkpoint.nodeId);
        if (previous === undefined || checkpoint.attempt > previous.attempt
          || (checkpoint.attempt === previous.attempt && checkpoint.claimGeneration !== undefined
            && (previous.claimGeneration === undefined || checkpoint.claimGeneration > previous.claimGeneration))) checkpoints.set(checkpoint.nodeId, checkpoint);
      }
      const gates = repositories.gateResults.listByRun(request.runId).filter(gate => {
        if (gate.runId !== request.runId) refuse("source-invalid");
        const node = nodeById.get(gate.gateId);
        return !older || (node?.kind === "gate" && gate.result.schemaHash === deriveSchemaHash(node.result, "output")
          && node.result.safeParse(gate.result.value).success);
      });
      for (const gate of gates) {
        const node = nodeById.get(gate.gateId);
        if (gate.runId !== request.runId || node?.kind !== "gate" || gate.result.schemaHash !== deriveSchemaHash(node.result, "output")
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
      type NodeFact = RerunValuesSnapshot["steps"][number]["nodes"][number];
      const facts = new Map<string, NodeFact>();
      for (const node of nodes) {
        const checkpoint = checkpoints.get(node.id);
        const omitted = run.envelope.stepOmissions?.some(({ step }) => descriptor.timeline.some((category) =>
          category.key === step && category.nodes.some(({ id }) => id === node.id))) === true;
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
        const proof = intent.completionProof;
        const proofSchema = node.commit.uses.writeSafety.completion.proofSchema;
        if (proof === undefined || proof.schemaHash !== deriveSchemaHash(proofSchema, "output") || !proofSchema.safeParse(proof.value).success) refuse("source-invalid");
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
        const outcome = TransactionOutcomeSchema.parse(checkpoint.output.value);
        if (outcome.disposition === "committed") {
          const matching = intents.some((intent) => intent.status === "committed" && intent.taskId === node.commit.uses.id
            && intent.bindingProof.afterPrepareSpanPath === `${run.envelope.traceId}/${node.id}/prepare`
            && canonicalJsonStringify(intent.completionProof) === canonicalJsonStringify(outcome.proof));
          if (!matching) refuse("source-invalid");
          continue;
        }
        const outputs: Record<string, JsonValue> = {};
        for (const dependency of node.dependsOn) {
          const stored = checkpoints.get(dependency);
          if (stored !== undefined) {
            const dependencyNode = nodeById.get(dependency);
            outputs[dependency] = dependencyNode?.kind === "transaction"
              ? JsonValueSchema.parse(projectTransactionOutcome(dependencyNode.commit.uses, stored.output.value, "Rerun dependency"))
              : stored.output.value;
          }
          else {
            const gate = gates.find(({ gateId }) => String(gateId) === String(dependency));
            if (gate === undefined) refuse("source-invalid");
            outputs[dependency] = gate.result.value;
          }
        }
        const commitInput = node.commit.uses.input.parse(node.commit.bind({ input: run.input.parsed.value, outputs }));
        const key = IdempotencyKeySchema.parse(Reflect.apply(node.commit.uses.writeSafety.idempotency.key, undefined, [commitInput]));
        const system = BrowserSystemIdSchema.parse(node.commit.uses.id.split("/")[0]);
        const linked = repositories.writeIntents.listByBusinessKey(system, deriveIdempotencyKeyDigest(system, key))
          .filter((intent) => intent.taskId === node.commit.uses.id && intent.workflowId === descriptor.id
            && intent.itemId === run.envelope.itemId && (intent.status === "committed" || intent.status === "observed-present")
            && canonicalJsonStringify(intent.status === "committed" ? intent.completionProof : intent.observedProof)
              === canonicalJsonStringify(outcome.proof));
        if (linked.length === 0) refuse("source-invalid");
        const step = descriptor.timeline.find((category) => category.nodes.some(({ id }) => id === node.id));
        if (step === undefined) refuse("source-invalid");
        for (const intent of linked) {
          if (intent.status !== "committed" && intent.status !== "observed-present") refuse("source-invalid");
          const proof = intent.status === "committed" ? intent.completionProof : intent.observedProof;
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
      return RerunValuesResponseSchema.parse({ state: "available", snapshot: {
        sourceInput,
        source: { runId: request.runId, version: run.version, workflow: descriptor.id,
          descriptorVersion: run.envelope.descriptorVersion, contractFingerprint: run.envelope.contractFingerprint, outcome: lifecycle.outcome },
        steps, values, transactions,
      } });
    });
  } catch (error) {
    if (error instanceof SourceRefused) return { state: "refused", code: error.code };
    if (error instanceof z.ZodError || error instanceof SyntaxError) return { state: "refused", code: "source-invalid" };
    throw error;
  }
}
