import { bindRunWorkbookReference, parseRunWorkbookReference } from "../../../models/dashboard/workbooks.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { isStartPlanExpired } from "../../../models/run/start-plan.js";
import { SourceBoundRunSchema } from "../../../models/run/rerun.js";
import { startSupersedeTargets } from "../../../models/run/start-supersede.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { type CommandRequest, CommandResultSchema } from "../../../rules/commands/commands.js";
import { MAX_SELECTED_WORKBOOK_SOURCES } from "../../../rules/spreadsheets/workbook-size.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { runtimeBuildIsCurrent } from "../../runtime/build-id.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-repositories.js";
import { WorkbookLibraryError } from "../../workbooks/workbook-library-error.js";
import { createWorkbookReferenceCapture } from "../../workbooks/workbook-library-service.js";
import { fanOutQueuedRuns, type TargetReference, type VersionChange } from "../lifecycle/run-fan-out.js";
import { assertOcrRecoverySnapshotCurrent } from "../lifecycle/ocr-review-authority.js";
import { RunContinuationRefusedError } from "../../storage/sqlite/run-continuation.js";
import { reviewedRunSettingsCurrent } from "../settings/run-settings.js";
import { workflowPreflightScope } from "../start/preflight-scope.js";
import { assertOcrStartReady } from "../start/ocr-readiness.js";
import { buildRerunPlan, RerunRefusedError } from "../start/rerun.js";
import { applied, type CommandApplication } from "./command-application.js";
import type { CommandKernelDependencies } from "./command-kernel.js";
import { CommandRefusal, conflict, reject } from "./command-refusal.js";
import { lifecycleRefusal, requireRun, resolveDescriptorOrReject } from "./run-command-context.js";

export interface RunConfigIdentity {
  readonly configFingerprint: string;
  readonly configSnapshotId: string;
}

export function readStartPlan(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: Extract<CommandRequest, { family: "start" }>,
  now: string,
) {
  const descriptor = resolveDescriptorOrReject(dependencies, request, request.target.workflowId);
  const plan = repositories.startPlans.get(request.target.startPlanId);
  if (plan === undefined) {
    reject(request, "target-not-found", `start plan ${request.target.startPlanId} does not exist; plan before starting`);
  }
  if (plan.workflowId !== request.target.workflowId) {
    reject(
      request,
      "invalid-state",
      `start plan ${plan.startPlanId} was planned for ${plan.workflowId}, not ${request.target.workflowId}`,
    );
  }
  if (descriptor.version !== plan.descriptorVersion
    || descriptor.contractFingerprint !== plan.descriptorFingerprint) {
    reject(
      request,
      "schema-mismatch",
      `start plan ${plan.startPlanId} was planned against ${plan.workflowId} v${String(plan.descriptorVersion)} `
      + `but the registered descriptor is v${String(descriptor.version)}; re-plan before starting`,
    );
  }
  const currentIngressHash = deriveSchemaHash(descriptor.input, "input");
  const currentCanonicalHash = deriveSchemaHash(descriptor.canonicalInput, "output");
  if (currentIngressHash !== plan.ingressSchemaHash || currentCanonicalHash !== plan.canonicalInputSchemaHash) {
    reject(
      request,
      "schema-mismatch",
      `start plan ${plan.startPlanId} was planned against a different ingress/canonical schema for ${plan.workflowId}; re-plan before starting`,
    );
  }

  const mismatched = [
    ["descriptor", plan.descriptorFingerprint, request.payload.descriptorFingerprint],
    ["config", plan.configFingerprint, request.payload.configFingerprint],
    ["ingress schema", plan.ingressSchemaHash, request.payload.ingressSchemaHash],
    ["canonical-input schema", plan.canonicalInputSchemaHash, request.payload.canonicalInputSchemaHash],
    ["input", plan.inputFingerprint, request.payload.inputFingerprint],
  ].find(([, planned, presented]) => planned !== presented);
  if (mismatched !== undefined) reject(request, "schema-mismatch",
    `start plan ${plan.startPlanId} was planned against a different ${String(mismatched[0])}; re-plan before starting`);
  const confirmationVersion = plan.consumedBy === undefined ? plan.version : plan.version - 1;
  if (request.target.expectedVersion !== confirmationVersion) conflict(request, plan.version,
    `start plan ${plan.startPlanId} confirmation expected revision ${String(confirmationVersion)} but received ${String(request.target.expectedVersion)}; re-plan before starting`);
  if (plan.consumedBy !== undefined) reject(request, "invalid-state",
    `start plan ${plan.startPlanId} was already consumed by command ${plan.consumedBy.commandId}`);
  if (isStartPlanExpired(plan, Date.parse(now))) reject(request, "RUN_START_PLAN_EXPIRED",
    `start plan ${plan.startPlanId} expired at ${plan.expiresAt}`);

  if (!reviewedRunSettingsCurrent(repositories, plan)) {
    reject(request, "replan-required", "Settings changed after this plan was reviewed; review a fresh plan before starting");
  }
  if (plan.rerun !== undefined) {
    let current;
    try {
      current = buildRerunPlan(repositories, descriptor, plan.rerun.source, plan.planned, plan.rerun.acknowledgment, plan.stepOmissions,
        dependencies.authority.evidenceSchemaHash?.bind(dependencies.authority));
    } catch (error) {
      if (error instanceof RunContinuationRefusedError) reject(request, "RUN_CONTINUATION_REFUSED", ERROR_CATALOG.RUN_CONTINUATION_REFUSED.text);
      if (!(error instanceof RerunRefusedError)) throw error;
      reject(request, error.code === "source-stale" ? "replan-required" : error.code, error.message);
    }
    if (canonicalJsonStringify(current.continuation ?? null) !== canonicalJsonStringify(plan.rerun.continuation ?? null)) {
      reject(request, "replan-required", "Interrupted run evidence changed. Review the steps again.");
    }
    if (canonicalJsonStringify(current) !== canonicalJsonStringify(plan.rerun)
      || (current.warnings.length > 0 && current.acknowledgment !== current.warningDigest)) {
      throw new CommandRefusal(CommandResultSchema.parse({ state: "confirmation-required", commandId: request.commandId,
        warningDigest: current.warningDigest, message: "Confirm the current repeat warning before final submission" }));
    }
  }

  if (descriptor.enqueue === "supersede-active" || plan.rerun?.source.gateCorrection !== undefined) {
    for (const entry of plan.planned) {
      const current = startSupersedeTargets(repositories.runs.listByItem({ workflow: plan.workflowId, itemId: entry.itemId }));
      if (entry.supersedeTargets === undefined || canonicalJsonStringify(entry.supersedeTargets) !== canonicalJsonStringify(current)) {
        reject(request, "replan-required", "Active runs changed after the supersede preview; review a fresh plan before starting");
      }
    }
  }
  // The continuation check above binds the retained references to the exact source run.
  if (plan.rerun?.continuation !== undefined) return { descriptor, plan, selectedSources: undefined };
  const captureReference = createWorkbookReferenceCapture(repositories.workbooks);
  let selectedSources: { libraryId: string; sheetId: string }[] | undefined;
  for (const planned of plan.planned) {
    const captured = planned.workbookReferences ?? [];
    const sources: { libraryId: string; sheetId: string }[] = [];
    const requirement = descriptor.workbookReference, check = descriptor.workbookCheck;
    const checkCount = check === undefined ? 0 : captured.filter(bound => parseRunWorkbookReference(bound).request.typeId === check.id).length;
    const requiredCount = captured.length - checkCount;
    if (requirement === undefined ? requiredCount !== 0 : requiredCount < 1 || requiredCount > MAX_SELECTED_WORKBOOK_SOURCES) {
      reject(request, "replan-required", "Workbook source selection changed; review a fresh plan before starting");
    }
    for (const bound of captured) {
      try {
        const reference = parseRunWorkbookReference(bound);
        const snapshot = reference.snapshot;
        const worksheet = snapshot.worksheets[0];
        if (snapshot.worksheets.length !== 1 || worksheet === undefined
          || !("versionId" in snapshot) || snapshot.versionId === undefined) throw new WorkbookLibraryError("WORKBOOK_INVALID");
        if (check !== undefined && reference.request.typeId === check.id) {
          const recaptured = captureReference({ kind: "selected-source", typeId: check.id, keyFieldId: check.keyFieldId,
            fields: [check.keyFieldId], writableFields: [], mode: "keys", keys: [], libraryId: snapshot.libraryId,
            versionId: snapshot.versionId, sheetId: worksheet.sheetId, expectedVersion: snapshot.version });
          if (canonicalJsonStringify(bindRunWorkbookReference(reference.request, recaptured)) !== canonicalJsonStringify(bound))
            throw new WorkbookLibraryError("WORKBOOK_VERSION_CONFLICT");
          continue;
        }
        if (requirement === undefined || reference.request.typeId !== requirement.id) throw new WorkbookLibraryError("WORKBOOK_INVALID");
        const refreshed = captureReference({
          kind: "selected-source", typeId: requirement.id, keyFieldId: requirement.keyFieldId,
          fields: descriptor.requiredWorkbookFields, writableFields: requirement.writableFields,
          mode: requirement.mode, keys: "mode" in reference.request ? [] : reference.request.keys,
          libraryId: snapshot.libraryId, versionId: snapshot.versionId, sheetId: worksheet.sheetId,
          expectedVersion: snapshot.version,
          ...("selectedRow" in reference.request && reference.request.selectedRow !== undefined
            ? { selectedRow: reference.request.selectedRow } : {}),
        });
        if (canonicalJsonStringify(bindRunWorkbookReference(reference.request, refreshed)) !== canonicalJsonStringify(bound))
          throw new WorkbookLibraryError("WORKBOOK_VERSION_CONFLICT");
        sources.push({ libraryId: snapshot.libraryId, sheetId: worksheet.sheetId });
        if (new Set(sources.map(source => JSON.stringify([source.libraryId, source.sheetId]))).size !== sources.length) {
          reject(request, "replan-required", "Workbook source selection changed; review a fresh plan before starting");
        }
      } catch (error) {
        if (!(error instanceof WorkbookLibraryError)) throw error;
        reject(request, "replan-required", "Workbook source changed after planning; review a fresh plan before starting");
      }
    }
    if (selectedSources !== undefined && canonicalJsonStringify(sources) !== canonicalJsonStringify(selectedSources)) {
      reject(request, "replan-required", "Workbook source selection differs between planned entries; review a fresh plan before starting");
    }
    selectedSources = sources;
  }
  return { descriptor, plan, selectedSources };
}

export function executeStartRun(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: Extract<CommandRequest, { family: "start" }>,
  now: string,
): CommandApplication {
  const { descriptor, plan, selectedSources } = readStartPlan(dependencies, repositories, request, now);
  if (!runtimeBuildIsCurrent()) {
    reject(request, "RUN_START_RESTART_REQUIRED", ERROR_CATALOG.RUN_START_RESTART_REQUIRED.text);
  }
  dependencies.preflight?.assertReady(workflowPreflightScope(descriptor, plan));
  assertOcrStartReady(repositories, descriptor, plan, dependencies.ocrProviderAvailable);
  const continuation = plan.rerun?.continuation;
  if (continuation !== undefined && plan.rerun !== undefined) {
    const source = requireRun(repositories, request, plan.rerun.source.runId);
    try {
      assertOcrRecoverySnapshotCurrent(repositories, dependencies.lifecycle, source, workflow => dependencies.descriptors.resolve(workflow));
    } catch (error) {
      if (!(error instanceof RunContinuationRefusedError)) throw error;
      reject(request, "RUN_CONTINUATION_REFUSED", ERROR_CATALOG.RUN_CONTINUATION_REFUSED.text);
    }
  }
  const consumption = repositories.startPlans.consume({
    startPlanId: request.target.startPlanId,
    expectedVersion: request.target.expectedVersion,
    commandId: request.commandId,
    descriptorFingerprint: request.payload.descriptorFingerprint,
    configFingerprint: request.payload.configFingerprint,
    ingressSchemaHash: request.payload.ingressSchemaHash,
    canonicalInputSchemaHash: request.payload.canonicalInputSchemaHash,
    inputFingerprint: request.payload.inputFingerprint,
    now,
  });
  if (consumption.state === "refused") {
    if (consumption.code === "version-mismatch") conflict(request, plan.version, consumption.message);
    if (consumption.code === "fingerprint-mismatch") reject(request, "schema-mismatch", consumption.message);
    reject(request, consumption.code === "expired" ? "RUN_START_PLAN_EXPIRED" : "invalid-state", consumption.message);
  }
  if (consumption.state !== "consumed") {
    throw new Error(
      `start plan ${plan.startPlanId} reported ${consumption.state} for a first execution of command ${request.commandId}; `
      + "an unjournaled command cannot have consumed a plan",
    );
  }

  const startReference: TargetReference = {
    family: "start",
    workflowId: request.target.workflowId,
    startPlanId: request.target.startPlanId,
    expectedVersion: request.target.expectedVersion,
  };
  const affectedTargets: TargetReference[] = [startReference];
  const versionChanges: VersionChange[] = [{
    target: startReference,
    before: request.target.expectedVersion,
    after: consumption.plan.version,
  }];

  const { continuation: _continuation, ...binding } = plan.rerun ?? {};
  const fanOut = fanOutQueuedRuns(
    repositories,
    dependencies.lifecycle,
    (message, refusal) => refusal === undefined ? reject(request, "policy-refused", message) : lifecycleRefusal(request, refusal),
    descriptor,
    {
      commandId: request.commandId, actorId: request.requestedBy,
      ...(plan.rerun === undefined ? {} : { sourceBound: SourceBoundRunSchema.parse({ ...binding, confirmationCommandId: request.commandId }) }),
      ...(continuation === undefined ? {} : { continuation }),
      workflow: plan.workflowId,
      descriptorVersion: plan.descriptorVersion,
      contractFingerprint: plan.descriptorFingerprint,
      ...(plan.requestedInstance === undefined ? {} : { requestedInstance: plan.requestedInstance }),
      resolvedInstance: plan.resolvedInstance,
      configFingerprint: plan.configFingerprint,
      configSnapshotId: plan.configSnapshotId,
      shape: plan.shape,
      priority: plan.priority,
      dryRun: plan.dryRun,
      ...(plan.recovery === undefined ? {} : { recovery: plan.recovery }),
      ...(plan.browserMode === undefined ? {} : { browserMode: plan.browserMode }),
      ...(plan.captureBrowserScreenshots === undefined
        ? {}
        : { captureBrowserScreenshots: plan.captureBrowserScreenshots }),
      ...(plan.stepOmissions === undefined ? {} : { stepOmissions: plan.stepOmissions }),
      ingressSchemaHash: plan.ingressSchemaHash,
      appVersion: dependencies.appVersion,

      session: {
        sessionId: dependencies.ids.uuid(),
        origin: { kind: "start-plan", startPlanId: plan.startPlanId, actorId: request.requestedBy },
      },
    },
    plan.planned.map((planned) => ({
      itemId: planned.itemId,
      title: planned.title, subtitle: planned.subtitle,
      ...(plan.rerun === undefined || repositories.runs.get(plan.rerun.source.runId)?.envelope.itemId !== planned.itemId
        ? {} : { retryOf: plan.rerun.source.runId }),
      matchKey: planned.matchKey,
      rawInput: planned.rawInput,
      parsedInput: planned.input,
      ...(planned.workbookReferences === undefined ? {} : { workbookReferences: planned.workbookReferences }),
    })),
    now,
    `plan ${plan.startPlanId}`,
  );

  if (fanOut.runs.length > 0 && selectedSources !== undefined && selectedSources.length > 0) {
    repositories.workbooks.rememberLastUsed({
      workflowId: plan.workflowId, acceptedCommandId: request.commandId, usedAt: now, sources: selectedSources,
    });
  }

  return applied(
    request,
    [...affectedTargets, ...fanOut.affectedTargets],
    [...versionChanges, ...fanOut.versionChanges],
  );
}
