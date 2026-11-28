import type { EvidenceSchemaReader } from "../../../models/storage/evidence-schema-admission.js";
import { checkpointRecordKey } from "../../../models/workflow/checkpoint.js";
import { rerunEvidenceReader, validateRerunWriteProof, validateRerunTransactionEvidence } from "./rerun.js";
import { validateRerunSourcePlan, RerunRefusedError } from "./rerun-source.js";
import { z } from "zod";
import { descriptorRuntimeNodes, workflowDelegatedDescriptor, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { RunExistenceSchema, type RunExistence } from "../../../models/config/authority.js";
import { canonicalJsonStringify, JsonValueSchema, type JsonValue } from "../../../rules/validation/canonical-json.js";
import { RerunValuesRequestSchema, RerunValuesResponseSchema,
  type RerunValuesRefusalCode, type RerunValuesResponse, type RerunValuesSnapshot } from "../../../models/dashboard/rerun-values.js";
import { retainedRunProtectedBindings, valueFreeProtectedData } from "../../../models/write-safety/protected-input.js";
import { FingerprintSchema, NodeIdSchema } from "../../../rules/identity/ids.js";
import { repeatEvidenceDigest } from "../../../models/run/rerun.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { projectTransactionOutcome } from "../../../models/workflow/graph.js";
import { DelegationOutcomePolicyUnsatisfiedError, readRunPreviewResult, resolveDelegationEvidenceOutput } from "../../../models/run/result.js";
import { currentDelegationManifests } from "../../storage/sqlite/delegation-authority.js";
import { DelegationInvocationRequestSchema } from "../../storage/sqlite/delegation-contracts.js";
import type { RuntimeFlowNode } from "../../../models/workflow/graph.js";
import type { RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { BrowserPresentationMode } from "../../../models/run/envelope.js";
import { RerunValueMappingsSchema } from "../../../models/workflow/rerun-values.js";
import { TransactionOutcomeSchema } from "../../../rules/write-safety/write-safety-primitives.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import { rerunInputFieldAccepts, rerunTargetAccepts } from "../../../models/validation/rerun-values.js";
import { workbookInputBinding } from "../workbooks.js";
import { parseRunWorkbookReference } from "../../../models/dashboard/workbooks.js";
import { interruptedRetainedSteps, isInterruptedRerunSource } from "./recovery-plan.js";
import { RunContinuationRefusedError } from "../../storage/sqlite/run-continuation.js";

export interface RerunValuesDependencies {
  readonly reader: { read(runId: string): RunExistence };
  readonly database: Pick<AuthorityDatabase, "authority" | "withAuthorityReadSnapshot"> & Partial<Pick<AuthorityDatabase, "evidenceSchemaHash">>;
  readonly descriptors: { resolve(workflow: string): AnyWorkflowDescriptor | undefined };
  /** Source-owned task spans and opened gates; never the fold's run lifecycle. */
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
/** A manual omission keeps its badge when other members completed, but cannot hide unfinished or failed work. */
function advance(fact: NodeFact): number {
  if (fact.reason === "step-omitted" || fact.reason === "operator-asserted") return 1.5;
  return fact.reason === "condition-skipped" ? 0.5 : ADVANCE[fact.state];
}

function omissionFact(descriptor: AnyWorkflowDescriptor, run: RunRecord, node: RuntimeFlowNode, checkpoint: RunCheckpointRecord | undefined): NodeFact | undefined {
  if (checkpoint?.assertion !== undefined) return { nodeId: node.id, state: "unfinished", reason: "operator-asserted" };
  const omitted = run.envelope.stepOmissions?.some(({ workflow, step }) => workflow === undefined
    && descriptor.stepOmissions.find((spec) => spec.step === step)?.skips?.includes(String(node.id)) === true);
  return omitted === true ? { nodeId: node.id, state: "unfinished", reason: "step-omitted" } : undefined;
}

function childWorkflows(descriptor: AnyWorkflowDescriptor): readonly string[] {
  return [...new Set(descriptor.startRows.flatMap(({ members }) => members.flatMap(({ workflow }) => workflow === undefined ? [] : [workflow])))];
}

/** Whether a child-run node's delegation settled: invoked, every member terminal, and the join satisfied (a dry-run preview counts). Not invoked, a member still running, or an unsatisfied join is simply not settled; any other failure means the retained delegation does not authenticate, which refuses the source. */
function delegationSettled(repositories: AuthorityDatabase["authority"], runId: string, node: RuntimeFlowNode): boolean {
  if (node.kind !== "child-run") return false;
  try {
    const invoked = currentDelegationManifests(repositories, runId).filter((manifest) =>
      DelegationInvocationRequestSchema.parse(repositories.lifecycleJournal.findDelegationInvocation(manifest.manifestId)?.request).nodeId === node.id);
    const [manifest] = invoked;
    if (manifest === undefined) return false;
    if (manifest.join !== "none" && repositories.dependencies.members(manifest.manifestId)
      .some((member) => (member.terminal?.run ?? member.child).lifecycle.state !== "terminal")) return false;
    return delegationJoin(repositories.dependencies.evidence(runId, String(node.id)), node.target.result) === "satisfied";
  } catch { refuse("source-invalid"); }
}

/** An unsatisfied join is a fact of the retained evidence; any other resolution failure propagates. */
function delegationJoin(...args: Parameters<typeof resolveDelegationEvidenceOutput>): "satisfied" | "unsatisfied" {
  try {
    resolveDelegationEvidenceOutput(...args);
    return "satisfied";
  } catch (error) {
    if (error instanceof DelegationOutcomePolicyUnsatisfiedError) return "unsatisfied";
    throw error;
  }
}

/** Transaction nodes whose prepare task span ended done in this run; the timeline keeps it even when execution refused before the fence. */
function preparedBySpan(repositories: AuthorityDatabase["authority"], run: RunRecord, nodes: readonly RuntimeFlowNode[]): ReadonlySet<string> {
  const prefixes = new Map(nodes.flatMap((node) => node.kind === "transaction" ? [[`${run.envelope.traceId}/${String(node.id)}/prepare#`, String(node.id)] as const] : []));
  const prepared = new Set<string>();
  if (prefixes.size === 0) return prepared;
  for (let after = 0; ;) {
    const page = repositories.timelineEvents.page({ runId: run.envelope.runId, after, limit: 1000 });
    for (const record of page) {
      const event = record.payload.kind === "span" ? record.payload.event : undefined;
      if (event?.t !== "span.ended" || event.kind !== "task" || event.outcome !== "done") continue;
      for (const [prefix, nodeId] of prefixes) if (event.spanPath.startsWith(prefix)) prepared.add(nodeId);
    }
    const last = page.at(-1);
    if (page.length < 1000 || last === undefined) return prepared;
    after = last.cursor;
  }
}

function unitKey(nodeId: string, phase?: "prepare" | "commit"): string { return phase === undefined ? nodeId : `${nodeId}#${phase}`; }

/** One child run's states per node, and per phase of a transaction node, from what it recorded; display only, so nothing here refuses the source. */
function childUnitFacts(repositories: AuthorityDatabase["authority"], descriptor: AnyWorkflowDescriptor, run: RunRecord,
  executions: ReturnType<NonNullable<RerunValuesDependencies["executions"]>>): ReadonlyMap<string, NodeFact> {
  // A child run of an older descriptor reports every current step unfinished, as an older source does.
  if (run.envelope.descriptorVersion !== descriptor.version || run.envelope.contractFingerprint !== descriptor.contractFingerprint) return new Map();
  const runId = run.envelope.runId;
  const checkpoints = new Map(repositories.runCheckpoints.listByItem(descriptor.id, run.envelope.itemId)
    .filter((checkpoint) => checkpoint.runId === runId).map((checkpoint) => [checkpoint.nodeId, checkpoint]));
  const gates = new Set(repositories.gateResults.listByRun(runId).map(({ gateId }) => String(gateId)));
  const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
  const failed = failureId === undefined ? undefined : repositories.failures.listByRun(runId).find((failure) => failure.failureId === failureId)?.nodeId;
  const intents = repositories.writeIntents.listByRun(runId);
  const settledTasks = new Set(intents.filter(({ status }) => status === "committed" || status === "observed-present").map(({ taskId }) => String(taskId)));
  const preparedTasks = new Set(intents.map(({ taskId }) => String(taskId)));
  const result = repositories.runResults.get(runId);
  const previews = new Map((result === undefined ? undefined : readRunPreviewResult(result))?.steps
    .flatMap((step) => step.state === "transaction-preview" ? [[String(step.nodeId), step.preview.outcome.state] as const] : []));
  const nodes = descriptorRuntimeNodes(descriptor);
  const preparedSpans = preparedBySpan(repositories, run, nodes);
  const facts = new Map<string, NodeFact>();
  for (const node of nodes) {
    const nodeId = String(node.id), checkpoint = checkpoints.get(node.id);
    const omission = omissionFact(descriptor, run, node, checkpoint);
    if (omission !== undefined) {
      if (node.kind === "transaction") {
        facts.set(unitKey(nodeId, "prepare"), { ...omission, phase: "prepare" });
        facts.set(unitKey(nodeId, "commit"), { ...omission, phase: "commit" });
      } else facts.set(nodeId, omission);
      continue;
    }
    if (node.kind === "transaction") {
      const taskId = String(node.commit.uses.id);
      const settled = checkpoint !== undefined || settledTasks.has(taskId) || previews.get(nodeId) === "already-present";
      const previewed = previews.get(nodeId) === "would-prepare";
      const prepared = settled || previewed || preparedTasks.has(taskId) || preparedSpans.has(nodeId);
      const prepare: Pick<NodeFact, "state" | "reason"> = settled ? { state: "completed", reason: checkpoint !== undefined ? "checkpoint" : previews.has(nodeId) ? "already-present" : "settled-transaction" }
        : prepared ? { state: "completed", reason: previewed ? "previewed" : "prepared" }
          : failed === nodeId ? { state: "failed", reason: "failure" } : { state: "unfinished", reason: "not-recorded" };
      const commit: Pick<NodeFact, "state" | "reason"> = settled ? prepare
        : failed === nodeId && prepared ? { state: "failed", reason: "failure" } : { state: "unfinished", reason: "not-recorded" };
      facts.set(unitKey(nodeId, "prepare"), { nodeId: node.id, phase: "prepare", ...prepare });
      facts.set(unitKey(nodeId, "commit"), { nodeId: node.id, phase: "commit", ...commit });
      continue;
    }
    const observed = executions.filter((execution) => String(execution.nodeId) === nodeId).sort((a, b) =>
      a.attempt - b.attempt || (a.startedAt ?? a.endedAt ?? "").localeCompare(b.startedAt ?? b.endedAt ?? "")).at(-1);
    const fact: Pick<NodeFact, "state" | "reason"> = failed === nodeId ? { state: "failed", reason: "failure" }
      : checkpoint !== undefined ? { state: "completed", reason: "checkpoint" }
        : gates.has(nodeId) ? { state: "completed", reason: "gate-result" }
          : observed?.outcome === "skipped" ? { state: "completed", reason: "condition-skipped" }
            : observed !== undefined && observed.outcome !== "done" ? { state: "unfinished", reason: "incomplete-execution" }
              : delegationSettled(repositories, runId, node) ? { state: "completed", reason: "delegation-settled" }
                : { state: "unfinished", reason: "not-recorded" };
    facts.set(nodeId, { nodeId: node.id, ...fact });
  }
  return facts;
}

/** Each step from its units (a node, or a transaction node's phase), each as the least advanced child run left it; with no child run, nothing is recorded. */
function leastAdvancedSteps(descriptor: AnyWorkflowDescriptor, runs: readonly ReadonlyMap<string, NodeFact>[]): readonly StepFact[] {
  const kinds = new Map(descriptorRuntimeNodes(descriptor).map((node) => [String(node.id), node.kind]));
  return descriptor.timeline.map((step) => {
    const nodes = step.nodes.flatMap(({ id }) => (kinds.get(String(id)) === "transaction" ? (["prepare", "commit"] as const) : [undefined]).map((phase): NodeFact => {
      const blank: NodeFact = { nodeId: NodeIdSchema.parse(id), ...(phase === undefined ? {} : { phase }), state: "unfinished", reason: "not-recorded" };
      const facts = runs.map((run) => run.get(unitKey(String(id), phase)) ?? blank);
      return facts.reduce((least, fact) => advance(fact) < advance(least) ? fact : least, facts[0] ?? blank);
    }));
    const state = nodes.some(({ state }) => state === "failed") ? "failed" : nodes.every(({ state }) => state === "completed") ? "completed" : "unfinished";
    return { key: step.key, state, nodes };
  });
}

function acceptsExactly(schema: z.ZodType, value: JsonValue): boolean {
  const parsed = schema.safeParse(value);
  return parsed.success && canonicalJsonStringify(parsed.data) === canonicalJsonStringify(value);
}

/** The browser mode the run used: recorded, or for a run from before it was, the headless setting of the exact configuration it ran under. Undefined when that configuration is gone. */
export function sourceBrowserMode(repositories: AuthorityDatabase["authority"], { envelope }: RunRecord): BrowserPresentationMode | undefined {
  if (envelope.browserMode !== undefined) return envelope.browserMode;
  const settings = repositories.configSnapshots.get(envelope.configSnapshotId);
  if (settings === undefined || settings.fingerprint !== envelope.configFingerprint) return undefined;
  return settings.config.browser.headless ? "headless" : "headed";
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
      if (lifecycle.state !== "terminal" || !["done", "failed", "interrupted", "cancelled"].includes(lifecycle.outcome)) refuse("source-ineligible");
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
        const omission = omissionFact(descriptor, run, node, checkpoint);
        const observed = executions.filter(({ nodeId }) => nodeId === node.id).sort((a, b) =>
          a.attempt - b.attempt || (a.startedAt ?? a.endedAt ?? "").localeCompare(b.startedAt ?? b.endedAt ?? "")).at(-1);
        let fact: NodeFact;
        if (omission !== undefined) fact = omission;
        else if (failure?.nodeId === node.id || (observed?.outcome === "failed"
          && (checkpoint === undefined || observed.attempt > checkpoint.attempt
            || (observed.attempt === checkpoint.attempt && (observed.endedAt === undefined || observed.endedAt >= checkpoint.writtenAt))))) fact = { nodeId: node.id, state: "failed", reason: "failure" };
        else if (observed?.outcome === "skipped" && checkpoint === undefined) fact = { nodeId: node.id, state: "completed", reason: "condition-skipped" };
        else if (observed !== undefined && observed.outcome !== "done" && observed.outcome !== "skipped"
          && (checkpoint === undefined || observed.attempt > checkpoint.attempt
            || (observed.attempt === checkpoint.attempt && observed.startedAt !== undefined && observed.startedAt > checkpoint.writtenAt))) {
          fact = { nodeId: node.id, state: "unfinished", reason: "incomplete-execution" };
        } else if (checkpoint !== undefined) fact = { nodeId: node.id, state: "completed", reason: "checkpoint" };
        else if (gates.some(({ gateId }) => String(gateId) === String(node.id))) fact = { nodeId: node.id, state: "completed", reason: "gate-result" };
        else if (!older && delegationSettled(repositories, request.runId, node)) fact = { nodeId: node.id, state: "completed", reason: "delegation-settled" };
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
          evidenceDigest: FingerprintSchema.parse(repeatEvidenceDigest(intent, bindings)), disposition: intent.status, filedBySource: true });
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
              evidenceDigest: FingerprintSchema.parse(repeatEvidenceDigest(intent, bindings)), disposition: intent.status, filedBySource: false });
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
      const members = repositories.runs.listChildren(run.envelope.runId);
      const retried = new Set(members.map(({ envelope }) => envelope.retryOf));
      const failedMembers = members.filter(({ envelope, lifecycle: settled }) => !retried.has(envelope.runId)
        && settled.state === "terminal" && ["failed", "cancelled", "interrupted"].includes(settled.outcome)).map(({ envelope }) => envelope.runId);
      const children = childWorkflows(descriptor).map((workflow) => {
        const child = workflowDelegatedDescriptor(descriptor, workflow);
        const latest = new Map<string, RunRecord>();
        for (const member of members) {
          if (member.envelope.workflow !== workflow) continue;
          const known = latest.get(member.envelope.itemId);
          if (known === undefined || member.envelope.attempt > known.envelope.attempt) latest.set(member.envelope.itemId, member);
        }
        return { workflow, steps: leastAdvancedSteps(child, older ? [] : [...latest.values()].map((member) => childUnitFacts(repositories, child, member, deps.executions?.(member.envelope.runId) ?? []))) };
      });
      // The source's typed facts refill a step it had typed, its own or a child's a row targets; they stay typed by hand.
      const typed = (run.envelope.stepOmissions ?? []).filter((entry) => {
        if (entry.workflow !== undefined && !descriptor.startRows.some(({ target }) => target?.workflow === entry.workflow && target?.step === entry.step)) return false;
        const owner = entry.workflow === undefined ? descriptor : workflowDelegatedDescriptor(descriptor, entry.workflow);
        const spec = owner.stepOmissions.find(({ step }) => step === entry.step);
        return spec !== undefined
          && !spec.form.fields.some(field => field.withheld === true && Object.hasOwn(entry.facts, field.key) && entry.facts[field.key] !== null)
          && !containsProtected(JsonValueSchema.parse(entry.facts), privateValues);
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
      // A PDF run's input is resubmitted whole, so it must be exactly what the current workflow accepts.
      if (sourceInput.state === "available" && descriptor.surfaces.uploadRun?.pdfInput !== undefined
        && !(acceptsExactly(descriptor.canonicalInput, run.input.parsed.value) && acceptsExactly(descriptor.input, sourceInput.value)))
        sourceInput = { state: "unavailable", reason: "incompatible" };
      const spreadsheets = (run.input.workbookReferences ?? []).flatMap((bound) => {
        const { request: picked, snapshot } = parseRunWorkbookReference(bound);
        return "versionId" in snapshot && snapshot.versionId !== undefined ? snapshot.worksheets.map(({ sheetId }) => ({ typeId: picked.typeId,
          libraryId: snapshot.libraryId, versionId: snapshot.versionId, sheetId,
          ...("selectedRow" in picked && picked.selectedRow?.sheetId === sheetId ? { selectedRow: picked.selectedRow } : {}) })) : [];
      });
      const browserMode = sourceBrowserMode(repositories, run);
      const retainedSteps = !older && isInterruptedRerunSource(repositories, run) && run.envelope.parent === undefined
        ? interruptedRetainedSteps(repositories, descriptor, run) : undefined;
      return RerunValuesResponseSchema.parse({ state: "available", snapshot: {
        sourceInput,
        source: { runId: request.runId, version: run.version, workflow: descriptor.id,
          descriptorVersion: run.envelope.descriptorVersion, contractFingerprint: run.envelope.contractFingerprint, outcome: lifecycle.outcome,
          dryRun: run.envelope.dryRun, priority: run.envelope.priority, ...(browserMode === undefined ? {} : { browserMode }) },
        ...(spreadsheets.length === 0 ? {} : { spreadsheets }),
        steps, values, transactions, ...(retainedSteps === undefined ? {} : { retainedSteps }),
        ...(children.length === 0 ? {} : { children }),
        ...(failedMembers.length === 0 ? {} : { failedMembers }),
        ...(typed.length === 0 ? {} : { typed }),
      } });
    });
  } catch (error) {
    if (error instanceof RerunRefusedError || error instanceof RunContinuationRefusedError) return { state: "refused", code: "source-invalid" };
    if (error instanceof SourceRefused) return { state: "refused", code: error.code };
    if (error instanceof z.ZodError || error instanceof SyntaxError) return { state: "refused", code: "source-invalid" };
    throw error;
  }
}
