import { sha256Hex } from "../../../rules/validation/sha256.js";
import type { RunRecord } from "../../../models/run/record.js";
import { retainedRunProtectedBindings, valueFreeProtectedData } from "../../../models/write-safety/protected-input.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { lifecycleCommandId } from "../../../rules/identity/identifiers.js";
import type { AuthorityRepositories } from "./authority-database.js";
import { validateNativeLifecycleRequest } from "./native-lifecycle-request.js";
import { CanonicalCreateRunRequestSchema, CanonicalRetrySourceRequestSchema, CanonicalTransitionRequestSchema } from "./run-store-contracts.js";

function same(left: unknown, right: unknown): boolean {
  return canonicalJsonStringify(left ?? null) === canonicalJsonStringify(right ?? null);
}

export function authenticateRunPriority(repositories: AuthorityRepositories, run: RunRecord,
  original: RunRecord["envelope"]["priority"], actorId: string): void {
  if (run.envelope.priority === original) return;
  if (original !== "bulk" || run.envelope.priority !== "interactive") throw new Error("delegation-priority-authority-unavailable");
  const proofs = repositories.commands.listRunBumpCommands(run.envelope.runId).filter(source => {
    if (source.family !== "run" || source.type !== "bump" || source.target.runId !== run.envelope.runId || source.requestedBy !== actorId) return false;
    const audit = repositories.commandAudits.findByCommand(source.commandId);
    if (audit?.result.state !== "applied" || !same(audit.request, source)) return false;
    const changes = audit.versionChanges;
    if (changes.length !== 1 || changes[0]?.target.family !== "run" || changes[0].target.runId !== run.envelope.runId
      || Number(changes[0].before) !== Number(source.target.expectedVersion) || changes[0].after !== source.target.expectedVersion + 1
      || run.version < changes[0].after || audit.result.affectedTargets.length !== 1
      || audit.result.affectedTargets[0]?.family !== "run" || audit.result.affectedTargets[0].runId !== run.envelope.runId) return false;
    const commandId = lifecycleCommandId("operator-bump", source.commandId);
    const command = repositories.lifecycleJournal.getCommand(commandId), settled = repositories.lifecycleJournal.findAuditByCommand(commandId);
    if (command === undefined || !("kind" in command) || command.kind !== "run-lifecycle" || command.operation !== "transition"
      || settled === undefined || !("kind" in settled) || settled.kind !== "run-lifecycle" || !same(settled.request, command)
      || settled.result.kind !== "run" || settled.result.runId !== run.envelope.runId || settled.result.appliedVersion !== source.target.expectedVersion + 1) return false;
    validateNativeLifecycleRequest(command);
    return same(CanonicalTransitionRequestSchema.parse(command.request), { commandId, runId: run.envelope.runId,
      expectedVersion: source.target.expectedVersion, priority: "interactive" });
  });
  if (proofs.length !== 1) throw new Error("delegation-priority-authority-unavailable");
}

export function authenticateStartPlanRun(repositories: AuthorityRepositories, run: RunRecord) {
  if (run.envelope.parent !== undefined || run.sessionId === undefined) {
    throw new Error("delegation-root-start-authority-unavailable");
  }
  const session = repositories.runSessions.get(run.sessionId);
  if (session?.origin.kind !== "start-plan") throw new Error("delegation-root-session-authority-unavailable");
  const plan = repositories.startPlans.get(session.origin.startPlanId);
  if (plan?.consumedBy === undefined) throw new Error("delegation-root-plan-authority-unavailable");
  const command = repositories.commands.get(plan.consumedBy.commandId);
  const audit = repositories.commandAudits.findByCommand(plan.consumedBy.commandId);
  if (command?.family !== "start" || command.type !== "start-run"
    || command.target.startPlanId !== plan.startPlanId || command.target.workflowId !== plan.workflowId
    || command.target.expectedVersion !== plan.version - 1
    || command.payload.descriptorFingerprint !== plan.descriptorFingerprint
    || command.payload.configFingerprint !== plan.configFingerprint
    || command.payload.ingressSchemaHash !== plan.ingressSchemaHash
    || command.payload.canonicalInputSchemaHash !== plan.canonicalInputSchemaHash
    || command.payload.inputFingerprint !== plan.inputFingerprint
    || command.requestedBy !== session.origin.actorId || plan.plannedBy !== session.origin.actorId
    || audit === undefined || !same(audit.request, command)
    || audit.completedAt !== plan.consumedBy.consumedAt || audit.result.state !== "applied"
    || !audit.result.affectedTargets.some(target => target.family === "run" && target.runId === run.envelope.runId)
    || !audit.versionChanges.some(change => change.target.family === "run" && change.target.runId === run.envelope.runId
      && change.before === 0 && change.after === 1)) {
    throw new Error("delegation-root-command-authority-unavailable");
  }
  const matches = plan.planned.flatMap((entry, index) => entry.itemId === run.envelope.itemId
    && same(entry.rawInput, run.input.raw) && same(entry.input, run.input.parsed) ? [{ entry, index }] : []);
  if (matches.length !== 1 || matches[0] === undefined) throw new Error("delegation-root-plan-membership-unavailable");
  const { entry, index } = matches[0];
  const envelope = run.envelope;
  if (session.workflow !== envelope.workflow || plan.workflowId !== envelope.workflow
    || plan.descriptorVersion !== envelope.descriptorVersion || plan.descriptorFingerprint !== envelope.contractFingerprint
    || plan.configFingerprint !== envelope.configFingerprint || plan.configSnapshotId !== envelope.configSnapshotId
    || plan.shape !== envelope.shape || plan.dryRun !== envelope.dryRun
    || plan.ingressSchemaHash !== run.input.ingressSchemaHash
    || plan.canonicalInputSchemaHash !== run.input.parsed.schemaHash
    || !same(plan.requestedInstance, envelope.requestedInstance) || !same(plan.resolvedInstance, envelope.resolvedInstance)
    || !same(plan.browserMode, envelope.browserMode) || !same(plan.captureBrowserScreenshots, envelope.captureBrowserScreenshots)
    || !same(plan.recovery, envelope.recovery) || !same(plan.stepOmissions, envelope.stepOmissions)
    || !same(envelope.sourceBound, plan.rerun === undefined ? undefined : { ...plan.rerun, confirmationCommandId: command.commandId })) {
    throw new Error("delegation-root-plan-binding-mismatch");
  }
  const createId = lifecycleCommandId("operator-create", { commandId: command.commandId, entry: index });
  const created = repositories.lifecycleJournal.getCommand(createId);
  const creation = repositories.lifecycleJournal.findAuditByCommand(createId);
  if (created === undefined || !("kind" in created) || created.kind !== "run-lifecycle" || created.operation !== "create"
    || creation === undefined || !("kind" in creation) || creation.kind !== "run-lifecycle"
    || !same(creation.request, created) || creation.result.kind !== "run"
    || creation.result.runId !== envelope.runId || creation.result.appliedVersion !== 1) {
    throw new Error("delegation-root-create-authority-unavailable");
  }
  validateNativeLifecycleRequest(created);
  const request = CanonicalCreateRunRequestSchema.parse(created.request);
  const source = plan.rerun === undefined ? undefined : repositories.runs.get(plan.rerun.source.runId);
  const expectedRetry = source?.envelope.itemId === entry.itemId ? source.envelope.runId : undefined;
  if (request.commandId !== createId || request.sessionId !== session.sessionId
    || !same(request.input, valueFreeProtectedData(run.input, retainedRunProtectedBindings(run)))
    || request.matchKey !== entry.matchKey || request.retryOf !== expectedRetry
    || envelope.retryOf !== expectedRetry || request.appVersion !== run.appVersion
    || envelope.startAt !== undefined || envelope.injected !== undefined || envelope.freshnessOverride !== undefined) {
    throw new Error("delegation-root-create-binding-mismatch");
  }
  authenticateRunPriority(repositories, run, request.priority, command.requestedBy);
  if (request.priority !== plan.priority) throw new Error("delegation-root-create-binding-mismatch");
  const fields = ["workflow", "descriptorVersion", "contractFingerprint", "operationDisplayCapability", "operationDisplaySnapshot",
    "requestedInstance", "resolvedInstance", "configFingerprint", "configSnapshotId", "shape", "dryRun",
    "recovery", "browserMode", "captureBrowserScreenshots", "stepOmissions", "sourceBound", "parent", "retryOf"] as const;
  if (fields.some(field => !same(request[field], envelope[field]))) throw new Error("delegation-root-create-binding-mismatch");
  return { session, plan, command, audit, create: created, creation };
}

export function authenticateRootRun(repositories: AuthorityRepositories, candidate: RunRecord): ReturnType<typeof authenticateStartPlanRun> {
  const visited = new Set<string>(), actors: string[] = [];
  let current = candidate;
  for (;;) {
    const run = current;
    if (visited.has(run.envelope.runId) || run.envelope.parent !== undefined) {
      throw new Error("delegation-root-ancestry-cycle");
    }
    visited.add(run.envelope.runId);
    const origin = repositories.lifecycleJournal.findRunOrigin(run.envelope.runId);
    if (origin === undefined) throw new Error("delegation-root-origin-unavailable");
    if (origin.operation === "create") {
      const root = authenticateStartPlanRun(repositories, run);
      if (actors.some(actor => actor !== root.session.origin.actorId)) throw new Error("delegation-root-retry-binding-mismatch");
      return root;
    }
    if (origin.operation !== "retry" && origin.operation !== "restart") throw new Error("delegation-root-origin-unavailable");
    validateNativeLifecycleRequest(origin);
    const request = CanonicalRetrySourceRequestSchema.parse(origin.request);
    const previous = repositories.runs.get(request.runId);
    const source = request.sourceCommandId === undefined ? undefined : repositories.commands.get(request.sourceCommandId);
    const audit = request.sourceCommandId === undefined ? undefined : repositories.commandAudits.findByCommand(request.sourceCommandId);
    const settled = repositories.lifecycleJournal.findAuditByCommand(origin.commandId);
    if (previous === undefined || previous.envelope.parent !== undefined || previous.lifecycle.state !== "terminal"
      || previous.version < request.expectedVersion || source?.family !== "run" || source.type !== origin.operation
      || source.target.runId !== previous.envelope.runId || source.target.expectedVersion !== request.expectedVersion
      || origin.commandId !== lifecycleCommandId(`operator-${origin.operation}`, source.commandId)
      || audit?.result.state !== "applied" || !same(audit.request, source)
      || !audit.result.affectedTargets.some(target => target.family === "run" && target.runId === run.envelope.runId)
      || !audit.versionChanges.some(change => change.target.family === "run" && change.target.runId === run.envelope.runId
        && change.before === 0 && change.after === 1)
      || settled === undefined || !("kind" in settled) || settled.kind !== "run-lifecycle"
      || !same(settled.request, origin) || settled.result.kind !== "run"
      || settled.result.runId !== run.envelope.runId || settled.result.appliedVersion !== 1
      || repositories.writeIntents.listByRun(previous.envelope.runId).some(intent => intent.status === "attempting" || intent.status === "parked")) {
      throw new Error("delegation-root-retry-authority-unavailable");
    }
    authenticateRunPriority(repositories, run, previous.envelope.priority, source.requestedBy);
    const fields = ["workflow", "itemId", "descriptorVersion", "contractFingerprint", "operationDisplayCapability", "operationDisplaySnapshot",
      "requestedInstance", "resolvedInstance", "shape", "dryRun",
      "browserMode", "captureBrowserScreenshots", "stepOmissions"] as const;
    const snapshot = repositories.configSnapshots.get(run.envelope.configSnapshotId);
    if (run.envelope.runId === previous.envelope.runId || run.envelope.retryOf !== previous.envelope.runId
      || run.envelope.attempt <= previous.envelope.attempt || run.sessionId !== previous.sessionId
      || fields.some(field => !same(run.envelope[field], previous.envelope[field]))
      || !same(valueFreeProtectedData(run.input, retainedRunProtectedBindings(run)), valueFreeProtectedData(previous.input, retainedRunProtectedBindings(previous)))
      || !same(run.envelope.recovery, origin.operation === "restart" ? "restart-from-start" : undefined)
      || run.envelope.startAt !== undefined || run.envelope.injected !== undefined || run.envelope.freshnessOverride !== undefined
      || run.envelope.sourceBound !== undefined || request.runtimeConfig.configFingerprint !== run.envelope.configFingerprint
      || snapshot === undefined
      || snapshot.fingerprint !== run.envelope.configFingerprint || sha256Hex(canonicalJsonStringify(snapshot.config)) !== snapshot.fingerprint) {
      throw new Error("delegation-root-retry-binding-mismatch");
    }
    actors.push(source.requestedBy);
    current = previous;
  }
}
