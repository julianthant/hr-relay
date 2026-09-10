import type { createRunLifecycleStorage } from "../../core/run-lifecycle-storage.js";
/** A owns reviewed selection policy; shared storage owns immutable membership and progress fencing. */
export function createVersionChanges(storage: ReturnType<typeof createRunLifecycleStorage>) {
  return Object.freeze({read:storage.readVersionChange,write:storage.writeVersionChange});
}

import type { CommandKernelDependencies, ArchiveCommandTools } from "../../core/command-kernel.js";
import type { CommandApplication } from "../../core/command-application.js";
import type { AuthorityRepositories } from "../../infra/sqlite/authority-database.js";
import type { CommandRequest } from "../../domain/commands.js";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { lifecycleCommandId } from "../../core/run-record-service.js";
import { runTarget, fanOutQueuedRuns, type TargetReference } from "../../core/run-fan-out.js";
import { selectNewRunIdentity } from "../../core/run-settings.js";
import { retainedRawSubmission } from "../start/protected-input.js";
import { planStart } from "../start/plan.js";
import { assessVersionBump, deriveArchivedRunRecord, describeBlocker, resolveBumpEffect } from "./archive-service.js";
import { archivedRunReferenceFingerprint, CURRENT_ARCHIVE_SCHEMA_GENERATION, VersionBumpApplicationSchema,
  VersionBumpPlanSchema, versionBumpPlanFingerprint, type WorkflowVersionIdentity } from "../../domain/archive/model.js";
import { VersionPlanStorageRecordSchema } from "../../infra/sqlite/storage-records.js";

/** Production command policy belongs to A. The kernel retains journal/audit and transaction authority. */
export function executeArchiveCommand(dependencies: CommandKernelDependencies, repositories: AuthorityRepositories,
  request: Extract<CommandRequest,{family:"version-archive"}>, now: string, tools: ArchiveCommandTools): CommandApplication {
  const reject: ArchiveCommandTools["reject"] = tools.reject;
  const conflict: ArchiveCommandTools["conflict"] = tools.conflict;
  const applied: ArchiveCommandTools["applied"] = tools.applied;
  const requireRun: ArchiveCommandTools["requireRun"] = tools.requireRun;
  const deleteTreeOrder: ArchiveCommandTools["deleteTreeOrder"] = tools.deleteTreeOrder;
  const lifecycleRun: ArchiveCommandTools["lifecycleRun"] = tools.lifecycleRun;
  const lifecycleRefusal: ArchiveCommandTools["lifecycleRefusal"] = tools.lifecycleRefusal;
/* ── version-archive: the D80 archive model (D179) ───────────────────────── */

type VersionArchiveCommand = Extract<CommandRequest, { family: "version-archive" }>;

/**
 * A relaunch mints its plan and consumes it inside ONE transaction, so the TTL
 * never expires in practice. It is stated rather than omitted because the plan
 * row is durable and a reader must be able to see what window it was minted
 * for.
 */
const RELAUNCH_PLAN_TTL_MS = 60_000;

function versionPlanTarget(versionPlanId: string): TargetReference {
  return { family: "version-archive", versionPlanId };
}

/**
 * The registry's identity for a workflow. `undefined` means the descriptor is
 * no longer registered — a real state for an application-scope sweep, and a
 * refusal for a workflow-scope one, because there is nothing to bump TO.
 */
function currentIdentityOf(
  dependencies: CommandKernelDependencies,
  workflowId: string,
): WorkflowVersionIdentity | undefined {
  const descriptor = dependencies.descriptors.resolve(workflowId);
  if (descriptor === undefined) return undefined;
  return {
    workflowId: descriptor.id,
    descriptorVersion: descriptor.version,
    contractFingerprint: descriptor.contractFingerprint,
  } as WorkflowVersionIdentity;
}

function assessOrReject(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: VersionArchiveCommand,
  scope: Extract<VersionArchiveCommand, { type: "plan-version-bump" }>["target"]["scope"],
): ReturnType<typeof assessVersionBump> {
  try {
    return assessVersionBump(
      {
        repositories,
        currentIdentity: (workflowId) => currentIdentityOf(dependencies, workflowId),
        appVersion: dependencies.appVersion,
      },
      scope,
    );
  } catch (error) {
    reject(request, "target-not-found", error instanceof Error ? error.message : String(error));
  }
}

function executeVersionBumpPlan(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: Extract<VersionArchiveCommand, { type: "plan-version-bump" }>,
  now: string,
): CommandApplication {
  const { scope } = request.target;
  // The operator's claimed application version is checked against the build
  // that is actually running. A scope nobody can verify is a scope that could
  // archive every run on the strength of a typo.
  if (scope.kind === "application" && scope.applicationVersion !== dependencies.appVersion) {
    reject(
      request,
      "invalid-state",
      `an application-scope bump must name the RUNNING build (${dependencies.appVersion}); `
      + `this plan names ${scope.applicationVersion}`,
    );
  }
  const assessment = assessOrReject(dependencies, repositories, request, scope);
  /**
   * D274: the run sets the plan records are the ones its KIND will act on. A
   * major plan lists what apply will archive and what will refuse it; a minor
   * plan lists neither, because a minor bump archives nothing and cannot be
   * blocked — recording the assessment's raw lists on it would be a review
   * copy that lies about the sweep it reviews.
   */
  const effect = resolveBumpEffect(request.payload.changeRecord.kind, assessment);
  const versionPlanId = dependencies.ids.uuid();
  const plan = VersionBumpPlanSchema.parse({
    archiveSchemaGeneration: CURRENT_ARCHIVE_SCHEMA_GENERATION,
    versionPlanId,
    scope,
    targetVersion: request.payload.targetVersion,
    changeFingerprint: request.payload.changeFingerprint,
    // Charter §25's change record, authored by the person making the change.
    // It rides the PLAN, so the fingerprint the operator's apply cites back
    // covers the words as well as the run sets — an apply cannot rewrite the
    // reason it was reviewed under.
    changeRecord: request.payload.changeRecord,
    observedAppVersion: dependencies.appVersion,
    observedIdentities: assessment.identities,
    candidates: effect.candidates,
    // Charter §25: the flow LISTS the runs that block it. A plan is minted
    // even when it cannot be applied, because the list is the thing the
    // operator needs in order to clear it. (For a MINOR bump the list is
    // empty by D274's definition, not by observation.)
    blockers: effect.blockers,
    plannedBy: request.requestedBy,
    plannedAt: now,
  });
  const stored = repositories.versionPlans.insert(VersionPlanStorageRecordSchema.parse({
    versionPlanId,
    version: 1,
    planFingerprint: versionBumpPlanFingerprint(plan),
    state: "planned",
    plan,
    createdAt: now,
  }));
  if (stored.state !== "inserted") {
    throw new Error(`version plan ${versionPlanId} collided with an existing plan; refusing to reuse it`);
  }
  return applied(request, [versionPlanTarget(versionPlanId)], []);
}

function executeVersionBumpApply(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: Extract<VersionArchiveCommand, { type: "apply-version-bump" }>,
  now: string,
): CommandApplication {
  const stored = repositories.versionPlans.get(request.target.versionPlanId);
  if (stored === undefined) {
    reject(request, "target-not-found", `version plan ${request.target.versionPlanId} does not exist; plan before applying`);
  }
  const { plan } = stored;

  /**
   * D274 branches every archive/blocker decision on the bump KIND, and the
   * kind lives on the plan's change record — never on the apply request, so a
   * kind cannot be rewritten between review and apply (the plan fingerprint
   * covers it). A generation-1 plan predates the change record entirely: it
   * declares NO kind, and guessing one — major would archive runs nobody
   * reviewed for archival, minor would silently downgrade a sweep to a no-op —
   * is exactly the substitution fail-loud forbids.
   */
  if (plan.changeRecord === undefined) {
    reject(
      request,
      "policy-refused",
      `version plan ${plan.versionPlanId} predates charter §25's change record and declares no bump kind `
      + "(major archives and can be blocked; minor archives nothing and cannot be — D274); re-plan so the "
      + "kind is reviewed",
    );
  }
  const bumpKind = plan.changeRecord.kind;

  /**
   * Drift, checked BEFORE anything is archived: the plan is a review copy of
   * what the registry looked like, and applying it against a registry that has
   * moved would sweep runs the operator never saw the shape of.
   */
  if (plan.observedAppVersion !== dependencies.appVersion) {
    reject(
      request,
      "policy-refused",
      `version plan ${plan.versionPlanId} was reviewed under app build ${plan.observedAppVersion}; `
      + `this process is ${dependencies.appVersion}. Re-plan against the build you are applying from.`,
    );
  }
  const assessment = assessOrReject(dependencies, repositories, request, plan.scope);
  const planned = canonicalJsonStringify(plan.observedIdentities);
  const current = canonicalJsonStringify(assessment.identities);
  if (planned !== current) {
    reject(
      request,
      "policy-refused",
      `version plan ${plan.versionPlanId} was reviewed against ${planned} but the registry now serves ${current}; `
      + "re-plan before applying",
    );
  }

  /**
   * Charter §25's non-negotiable, and it is checked HERE — inside the applying
   * transaction — not against the plan's own list. A run that went queued
   * between planning and applying is exactly the possible-submit this refusal
   * exists to keep out of an archive. D274 scopes it to the bump's KIND: a
   * minor bump archives nothing, so `resolveBumpEffect` gives it no blockers
   * and no candidates and nothing can refuse it here.
   */
  const effect = resolveBumpEffect(bumpKind, assessment);
  if (effect.blockers.length > 0) {
    reject(
      request,
      "active-version-blockers",
      `${String(effect.blockers.length)} prior-version run(s) are not terminal and must be settled first: `
      + `${effect.blockers.map(describeBlocker).join(", ")}`,
    );
  }

  const consumption = repositories.versionPlans.consume({
    versionPlanId: request.target.versionPlanId,
    expectedVersion: request.target.expectedVersion,
    planFingerprint: request.payload.planFingerprint,
    now,
  });
  if (consumption.state === "refused") {
    if (consumption.code === "version-mismatch") conflict(request, stored.version, consumption.message);
    if (consumption.code === "fingerprint-mismatch") reject(request, "schema-mismatch", consumption.message);
    reject(request, "invalid-state", consumption.message);
  }
  if (consumption.state !== "consumed") {
    throw new Error(
      `version plan ${plan.versionPlanId} reported ${consumption.state} for a first execution of command `
      + `${request.commandId}; an unjournaled command cannot have applied a plan`,
    );
  }

  const applicationId = dependencies.ids.uuid();
  const archivedRunIds = effect.candidates.map(({ runId }) => runId);
  repositories.versionBumpApplications.insert(VersionBumpApplicationSchema.parse({
    archiveSchemaGeneration: CURRENT_ARCHIVE_SCHEMA_GENERATION,
    applicationId,
    versionPlanId: plan.versionPlanId,
    scope: plan.scope,
    targetVersion: plan.targetVersion,
    changeFingerprint: plan.changeFingerprint,
    appliedAppVersion: dependencies.appVersion,
    appliedIdentities: assessment.identities,
    archivedRunIds,
    // Verbatim from the reviewed plan. Re-authoring it at apply would let the
    // recorded reason differ from the one the plan fingerprint covers.
    changeRecord: plan.changeRecord,
    appliedBy: request.requestedBy,
    appliedAt: now,
  }));

  const affectedTargets: TargetReference[] = [versionPlanTarget(plan.versionPlanId)];
  // Freeze the complete batch while every candidate is still live. UUID order
  // must not erase a child from its parent's immutable archived membership.
  const snapshots = dependencies.archiveSnapshots.snapshotBatch(archivedRunIds);
  for (const candidate of effect.candidates) {
    const run = repositories.runs.get(candidate.runId);
    if (run === undefined) {
      throw new Error(`run ${candidate.runId} vanished between assessment and archival inside one transaction`);
    }
    const drift = assessment.driftByRunId.get(candidate.runId);
    if (drift === undefined) {
      throw new Error(`run ${candidate.runId} was assessed as prior-version with no recorded drift`);
    }
    // ONE lookup, both frozen facts (D179 label, D242 code). Resolving twice
    // would let a registry that moved between the two calls freeze a label
    // beside a blank code — a half-resolved descriptor the record refuses.
    const registered = dependencies.descriptors.resolve(candidate.workflowId);
    const snapshot = snapshots.get(candidate.runId);
    if (snapshot === undefined) throw new Error(`archive batch omitted candidate ${candidate.runId}`);
    lifecycleRun(request, dependencies.lifecycle.archive({
      commandId: lifecycleCommandId("operator-archive", { commandId: request.commandId, runId: run.envelope.runId }),
      expectedVersion: run.version, archive: deriveArchivedRunRecord({
      repositories,
      run,
      snapshot,
      applicationId,
      drift,
      archivedBy: request.requestedBy,
      archivedAt: now,
      workflowLabel: registered?.label,
      workflowCode: registered?.code,
    }) }));
    affectedTargets.push(runTarget(candidate.runId));
  }

  return applied(request, affectedTargets, [{
    target: versionPlanTarget(plan.versionPlanId),
    before: request.target.expectedVersion,
    after: consumption.plan.version,
  }]);
}

/**
 * D308 — the Archive's delete door. The archived record's content digest is
 * cited exactly as a relaunch cites it (ref frontend-backend-integration §5):
 * a mismatch means the operator is looking at a different record than the one
 * their command names, and nothing is removed. The retained `tasks` row and
 * everything under it go with the archive record; the tombstone records the
 * `archive` origin.
 */
function executeArchivedRunDelete(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: Extract<VersionArchiveCommand, { type: "delete-archived-run" }>,
  _now: string,
): CommandApplication {
  const archived = repositories.archivedRuns.get(request.target.archivedRunId);
  if (archived === undefined) {
    reject(request, "target-not-found", `archived run ${request.target.archivedRunId} is not in the archive`);
  }
  if (archivedRunReferenceFingerprint(archived) !== request.target.archiveFingerprint) {
    reject(
      request,
      "schema-mismatch",
      `archived run ${archived.runId} does not match the archive reference this delete cited`,
    );
  }
  const retained = requireRun(repositories, request, archived.runId);
  const order = deleteTreeOrder(repositories, request, retained);
  const outcome = dependencies.lifecycle.deleteArchived({ commandId: lifecycleCommandId("operator-delete-archive", request.commandId),
    runId: archived.runId, archiveFingerprint: request.target.archiveFingerprint });
  if (outcome.state === "refused") lifecycleRefusal(request, outcome.refusal);
  if (outcome.state !== "deleted" && outcome.state !== "applied-already") throw new Error(`archive delete: ${outcome.state}`);
  return applied(request, order.map((run) => runTarget(run.envelope.runId)), []);
}

function executeArchivedRunRelaunch(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: Extract<VersionArchiveCommand, { type: "relaunch-archived-run" }>,
  now: string,
): CommandApplication {
  const archived = repositories.archivedRuns.get(request.target.archivedRunId);
  if (archived === undefined) {
    reject(request, "target-not-found", `archived run ${request.target.archivedRunId} is not in the archive`);
  }
  // ref frontend-backend-integration §5's "integrity": a relaunch cites the exact bytes it read. A
  // mismatch means the operator is looking at a different record than the one
  // their command names.
  if (archivedRunReferenceFingerprint(archived) !== request.target.archiveFingerprint) {
    reject(
      request,
      "schema-mismatch",
      `archived run ${archived.runId} does not match the archive reference this relaunch cited`,
    );
  }
  const descriptor = dependencies.descriptors.resolve(archived.workflowId);
  if (descriptor === undefined) {
    reject(
      request,
      "policy-refused",
      `${archived.workflowId} is no longer registered; an archived run can only be relaunched on a CURRENT `
      + "version, and there is none",
    );
  }

  /**
   * Charter §25: a relaunch is a FRESH run on the current version, planned
   * from the archived RAW submission through today's ingress and canonical
   * schemas. It is never a resume, and it never replays the archived canonical
   * value — that value was validated by a schema which has, by definition,
   * since moved.
   */
  let record;
  try {
    record = planStart(
      {
        authority: { authority: { runs: repositories.runs } },
        clock: dependencies.clock,
        ids: dependencies.ids,
        planTtlMs: RELAUNCH_PLAN_TTL_MS,
      },
      {
        descriptor,
        submissions: [retainedRawSubmission(descriptor, archived.input.raw)],
        retainedInputs: [archived.input.parsed],
        dryRun: false,
        priority: "interactive",
        shape: "single",
        ...selectNewRunIdentity(repositories, dependencies.configIdentity),
        plannedBy: request.requestedBy,
      },
    );
  } catch (error) {
    reject(
      request,
      "policy-refused",
      `archived run ${archived.runId}'s input cannot be planned against the current ${archived.workflowId}: `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (record.planned.length !== 1) {
    reject(
      request,
      "policy-refused",
      `archived run ${archived.runId} could not be relaunched: `
      + `${record.refused.map((refusal) => `${refusal.code} — ${refusal.message}`).join("; ")}`,
    );
  }
  const created = repositories.startPlans.create(record);
  if (created.state !== "inserted") {
    throw new Error(`relaunch of ${archived.runId} minted start plan ${record.startPlanId}, which already exists`);
  }
  const consumption = repositories.startPlans.consume({
    startPlanId: record.startPlanId,
    expectedVersion: record.version,
    commandId: request.commandId,
    descriptorFingerprint: record.descriptorFingerprint,
    configFingerprint: record.configFingerprint,
    ingressSchemaHash: record.ingressSchemaHash,
    canonicalInputSchemaHash: record.canonicalInputSchemaHash,
    inputFingerprint: record.inputFingerprint,
    now,
  });
  if (consumption.state !== "consumed") {
    throw new Error(
      `relaunch of ${archived.runId} could not consume the plan it just minted (${consumption.state}); `
      + "the durable record is inconsistent",
    );
  }

  const fanOut = fanOutQueuedRuns(
    repositories,
    dependencies.lifecycle,
    (message, refusal) => refusal === undefined ? reject(request, "policy-refused", message) : lifecycleRefusal(request, refusal),
    descriptor,
    {
      commandId: request.commandId, actorId: request.requestedBy,
      relaunch: { archivedRunId: archived.runId, archiveFingerprint: request.target.archiveFingerprint },
      workflow: record.workflowId,
      descriptorVersion: record.descriptorVersion,
      contractFingerprint: record.descriptorFingerprint,
      resolvedInstance: record.resolvedInstance,
      configFingerprint: record.configFingerprint,
      configSnapshotId: record.configSnapshotId,
      shape: record.shape,
      priority: record.priority,
      dryRun: record.dryRun,
      ...(record.browserMode === undefined ? {} : { browserMode: record.browserMode }),
      ...(record.captureBrowserScreenshots === undefined
        ? {}
        : { captureBrowserScreenshots: record.captureBrowserScreenshots }),
      ...(record.stepOmissions === undefined ? {} : { stepOmissions: record.stepOmissions }),
      ingressSchemaHash: record.ingressSchemaHash,
      appVersion: dependencies.appVersion,
      // D269: a relaunch is a dashboard-started group of one, and the archived
      // run it relaunches is the origin the session names.
      session: {
        sessionId: dependencies.ids.uuid(),
        origin: { kind: "archive-relaunch", archivedRunId: archived.runId, actorId: request.requestedBy },
      },
    },
    record.planned.map((entry) => ({
      itemId: entry.itemId,
      title: entry.title, subtitle: entry.subtitle,
      matchKey: entry.matchKey,
      rawInput: entry.rawInput,
      parsedInput: entry.input,
    })),
    now,
    `relaunch of archived run ${archived.runId}`,
  );

  return applied(request, fanOut.affectedTargets, fanOut.versionChanges);
}

function dispatchArchive(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: VersionArchiveCommand,
  now: string,
): CommandApplication {
  switch (request.type) {
    case "plan-version-bump": return executeVersionBumpPlan(dependencies, repositories, request, now);
    case "apply-version-bump": return executeVersionBumpApply(dependencies, repositories, request, now);
    case "relaunch-archived-run": return executeArchivedRunRelaunch(dependencies, repositories, request, now);
    case "delete-archived-run": return executeArchivedRunDelete(dependencies, repositories, request, now);
  }
}


return dispatchArchive(dependencies,repositories,request,now);
}

/** A owns cross-store orchestration outside the kernel's final atomic journal/audit callback.
 * The baseline preserves existing execution until A replaces its own selection/conversion policy.
 */
export function runArchiveCommand(request: Extract<CommandRequest,{family:"version-archive"}>,
  dependencies: CommandKernelDependencies, executeAtomic: () => import("../../domain/commands.js").CommandResult) {
  void request; void dependencies;
  return executeAtomic();
}
