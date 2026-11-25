import { deriveIntakeEnqueuePlan } from "../../../models/intake/enqueue.js";
import type { IntakePlanManifest } from "../../../models/intake/manifest.js";
import { confirmBinding } from "../../../models/intake/mapping.js";
import { type IntakeLayout, IntakeParseSchema, resolveInspectSelection } from "../../../models/intake/parse.js";
import type { IntakeProjection } from "../../../models/intake/projection.js";
import { intakeReviewBinding, resolveIntakeComparison } from "../../../models/intake/review.js";
import { validateIntakeRows } from "../../../models/intake/validate.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import type { CommandRequest } from "../../../rules/commands/commands.js";
import { deriveItemId } from "../../../rules/identity/identifiers.js";
import { ItemIdSchema } from "../../../rules/identity/ids.js";
import { workflowPlanning } from "../../../workflow-kit/workflow.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-repositories.js";
import { fanOutQueuedRuns, type TargetReference } from "../lifecycle/run-fan-out.js";
import { selectNewRunIdentity } from "../settings/run-settings.js";
import { dryRunRefusalMessage, resolveInstances, supportsDryRun } from "../start/plan.js";
import { admitProtectedInput } from "../start/protected-input.js";
import { applied, type CommandApplication } from "./command-application.js";
import type { CommandKernelDependencies } from "./command-kernel.js";
import { conflict, reject } from "./command-refusal.js";
import { lifecycleRefusal, resolveDescriptorOrReject } from "./run-command-context.js";

type IntakeCommand = Extract<CommandRequest, { family: "intake" }>;

export interface IntakeProjectionResolver {
  resolve(workflowId: string): IntakeProjection | undefined;
}

function intakeTarget(intakeSessionId: string): TargetReference {
  return { family: "intake", intakeSessionId };
}

export function executeIntake(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: IntakeCommand,
  now: string,
): CommandApplication {
  const sessionId = request.target.intakeSessionId;
  const current = repositories.intakeSessions.get(sessionId);
  if (current === undefined) reject(request, "target-not-found", `intake session ${sessionId} does not exist`);
  if (request.type !== "enqueue-intake-manifest"
    && current.state !== "mapping" && current.state !== "validated") {
    reject(
      request,
      "invalid-state",
      `intake session ${sessionId} is ${current.state}; only an open session accepts mapping commands`,
    );
  }

  const target = intakeTarget(sessionId);
  const noOp = (): CommandApplication => applied(request, [target], []);
  const applyUpdate = (next: unknown): CommandApplication => {
    const updated = repositories.intakeSessions.update(next);
    return applied(request, [target], [{ target, before: current.version, after: updated.version }]);
  };

  const requireProjection = (): IntakeProjection => {
    const projection = dependencies.intakeProjections.resolve(current.workflow);
    if (projection === undefined) {
      reject(
        request,
        "policy-refused",
        `workflow ${current.workflow} declares no intake projection; it is not spreadsheet-capable, `
        + "so no column can be bound to it",
      );
    }
    return projection;
  };

  const parseAt = (sheet: string, headerRowIndex: number | null) => {
    const parse = IntakeParseSchema.parse(dependencies.intakeParser.parse({
      artifact: current.artifact,
      sheet,
      headerRowIndex,
    }));
    if (parse.state === "refused") {
      reject(
        request,
        "invalid-state",
        `intake session ${sessionId} cannot read its source (${parse.code}): ${parse.message}`,
      );
    }
    return parse;
  };

  // Commands use the settled session header selection; never rediscover an unrecorded header row.
  const currentLayout = (): IntakeLayout => {
    const headerRowIndex = current.headerRowIndex;
    if (headerRowIndex === null) {
      reject(
        request,
        "invalid-state",
        `intake session ${sessionId} has no settled header row on sheet ${JSON.stringify(current.sheet)}; `
        + "choose one with inspect-intake before mapping",
      );
    }
    const parse = parseAt(current.sheet, headerRowIndex);
    if (parse.layout === null) {
      throw new Error(
        `intake session ${sessionId} names header row ${String(headerRowIndex)} on sheet `
        + `${JSON.stringify(current.sheet)}, but the parser settled no layout for it`,
      );
    }
    return parse.layout;
  };

  const boundedSourceRow = (layout: IntakeLayout, sourceRow: number): void => {
    if (sourceRow > layout.rows.length) {
      reject(
        request,
        "invalid-state",
        `source row ${String(sourceRow)} is beyond the ${String(layout.rows.length)} data rows sheet `
        + `${JSON.stringify(current.sheet)} holds under header row ${String(layout.headerRowIndex)}`,
      );
    }
  };

  switch (request.type) {
    case "inspect-intake": {
      const comparisonManifestId = request.payload.comparisonManifestId ?? current.comparisonManifestId;
      if (request.payload.comparisonManifestId !== undefined) {
        if (current.version !== request.target.expectedVersion) conflict(request, current.version, "the comparison was selected from a stale Intake review");
        try { resolveIntakeComparison({ ...current, comparisonManifestId }, repositories.intakeManifests); }
        catch (error) { reject(request, "invalid-state", error instanceof Error ? error.message : String(error)); }
      }
      const selection = resolveInspectSelection(current, request.payload);
      const parse = parseAt(selection.sheet, selection.headerRowIndex);
      // Discovery settles the header row when the operator has not chosen one,
      // so the settled index is the parse's, never the request's.
      const settled = parse.layout === null ? null : parse.layout.headerRowIndex;
      if (selection.sheet === current.sheet && settled === current.headerRowIndex) {
        if (comparisonManifestId === current.comparisonManifestId) return noOp();
        return applyUpdate({ ...current, comparisonManifestId, updatedAt: now, version: current.version + 1 });
      }
      return applyUpdate({
        ...current,
        sheet: selection.sheet,
        ...(comparisonManifestId === undefined ? {} : { comparisonManifestId }),
        headerRowIndex: settled,
        bindings: [],
        corrections: [],
        exclusions: [],
        state: "mapping",
        validation: { state: "none" },
        updatedAt: now,
        version: current.version + 1,
      });
    }

    case "confirm-intake-mapping": {
      const projection = requireProjection();
      const layout = currentLayout();
      if (layout.headerFingerprint !== request.payload.headerFingerprint) {
        reject(
          request,
          "schema-mismatch",
          `this file's layout is ${layout.headerFingerprint.slice(0, 12)}…, not the `
          + `${request.payload.headerFingerprint.slice(0, 12)}… the confirmation was built against; `
          + "reload the mapping grid before confirming a binding",
        );
      }
      if (projection.target(request.payload.targetFieldId) === undefined) {
        reject(
          request,
          "invalid-state",
          `${current.workflow} does not declare intake target ${request.payload.targetFieldId}`,
        );
      }
      const column = layout.columns.find((entry) => entry.sourceColumnId === request.payload.sourceColumnId);
      if (column === undefined) {
        reject(
          request,
          "invalid-state",
          `no column with id ${request.payload.sourceColumnId} is present in this file under header row `
          + `${String(layout.headerRowIndex)}`,
        );
      }
      const held = current.bindings.find((entry) => entry.targetFieldId === request.payload.targetFieldId);
      if (held !== undefined && held.sourceColumnId === request.payload.sourceColumnId) return noOp();
      // THE one mint (ref data-intake-and-edit-data ). It re-proves both checks above against the
      // projection and the detected columns; a suggestion cannot reach it.
      const binding = confirmBinding({
        projection,
        detected: layout.columns,
        targetFieldId: request.payload.targetFieldId,
        sourceColumnId: request.payload.sourceColumnId,
        confirmedAt: now,
      });
      return applyUpdate({
        ...current,
        bindings: [
          ...current.bindings.filter((entry) => entry.targetFieldId !== binding.targetFieldId),
          binding,
        ].sort((left, right) => left.targetFieldId.localeCompare(right.targetFieldId)),
        state: "mapping",
        validation: { state: "none" },
        updatedAt: now,
        version: current.version + 1,
      });
    }

    case "correct-intake-row": {
      const projection = requireProjection();
      const layout = currentLayout();
      boundedSourceRow(layout, request.payload.sourceRow);
      if (projection.target(request.payload.field) === undefined) {
        reject(
          request,
          "invalid-state",
          `${current.workflow} does not declare intake target ${request.payload.field}`,
        );
      }
      if (!current.bindings.some((entry) => entry.targetFieldId === request.payload.field)) {
        reject(
          request,
          "invalid-state",
          `${request.payload.field} has no bound column, so there is no cell to correct; `
          + "bind a column first",
        );
      }
      const held = current.corrections.find((entry) =>
        entry.sourceRow === request.payload.sourceRow && entry.field === request.payload.field);
      if (held !== undefined && held.correctedValue === request.payload.correctedValue) return noOp();
      return applyUpdate({
        ...current,
        corrections: [
          ...current.corrections.filter((entry) =>
            entry.sourceRow !== request.payload.sourceRow || entry.field !== request.payload.field),
          {
            sourceRow: request.payload.sourceRow,
            field: request.payload.field,
            correctedValue: request.payload.correctedValue,
            correctedAt: now,
          },
        ],
        state: "mapping",
        validation: { state: "none" },
        updatedAt: now,
        version: current.version + 1,
      });
    }

    case "exclude-intake-row": {
      const layout = currentLayout();
      boundedSourceRow(layout, request.payload.sourceRow);
      const held = current.exclusions.find((entry) => entry.sourceRow === request.payload.sourceRow);
      if (held !== undefined) {
        if (held.reason === request.payload.reason) return noOp();
        reject(
          request,
          "invalid-state",
          `source row ${String(request.payload.sourceRow)} is already excluded (${held.reason}); `
          + "an exclusion records the reason it was made with",
        );
      }
      return applyUpdate({
        ...current,
        exclusions: [
          ...current.exclusions,
          { sourceRow: request.payload.sourceRow, reason: request.payload.reason, excludedAt: now },
        ].sort((left, right) => left.sourceRow - right.sourceRow),
        state: "mapping",
        validation: { state: "none" },
        updatedAt: now,
        version: current.version + 1,
      });
    }

    case "validate-intake": {
      const projection = requireProjection();
      const descriptor = resolveDescriptorOrReject(dependencies, request, current.workflow);
      const layout = currentLayout();
      const planning = workflowPlanning(descriptor);
      // Re-derive dispositions from retained inputs and `readAt`; never store the result of this pass.
      validateIntakeRows({
        workflow: current.workflow,
        sourceSha256: current.artifact.sha256,
        projection,
        detected: layout.columns,
        bindings: current.bindings,
        rows: layout.rows,
        constants: current.constants,
        corrections: current.corrections,
        excludedRows: current.exclusions.map((entry) => entry.sourceRow),
        readAt: now,
        deriveItemId: (parsedInput) =>
          ItemIdSchema.parse(deriveItemId(current.workflow, planning.matchKey(parsedInput))),
      });
      return applyUpdate({
        ...current,
        state: "validated",
        validation: { state: "validated", validatedAt: now, readAt: now },
        updatedAt: now,
        version: current.version + 1,
      });
    }

    case "enqueue-intake-manifest": {
      if (current.state === "enqueued") {
        reject(
          request,
          "invalid-state",
          `intake session ${sessionId} already enqueued as manifest ${String(current.intakeManifestId)}; `
          + "a manifest fans out exactly once",
        );
      }
      if (current.state !== "validated" || current.validation.state !== "validated") {
        reject(
          request,
          "invalid-state",
          `intake session ${sessionId} is ${current.state}; the pre-run rejection review is mandatory `
          + "(ref data-intake-and-edit-data §5) — validate this mapping, review what it rejects, then run",
        );
      }

      if (current.version !== request.target.expectedVersion) {
        conflict(
          request,
          current.version,
          `intake session ${sessionId} is at version ${String(current.version)}, not `
          + `${String(request.target.expectedVersion)}; the plan you reviewed has moved — reload before running`,
        );
      }
      const sourceName = current.sourceName;
      if (sourceName === undefined) {
        reject(
          request,
          "invalid-state",
          `intake session ${sessionId} retains no source file name, so its manifest could not name the file `
          + "it ran; re-upload the file to start a session that does",
        );
      }
      const reservedManifestId = current.reservedManifestId;
      if (reservedManifestId === undefined) {
        reject(
          request,
          "invalid-state",
          `intake session ${sessionId} predates reserved manifest identities and cannot enqueue without one`,
        );
      }
      const projection = requireProjection();
      const descriptor = resolveDescriptorOrReject(dependencies, request, current.workflow);
      if (request.payload.dryRun && !supportsDryRun(descriptor)) {
        reject(request, "policy-refused", dryRunRefusalMessage(descriptor));
      }
      const layout = currentLayout();
      const planning = workflowPlanning(descriptor);
      const canonicalInputSchemaHash = deriveSchemaHash(descriptor.canonicalInput, "output");
      // Re-derived against the RETAINED `readAt`, so the manifest this writes is
      // the plan the operator reviewed — never one the clock moved underneath.
      const plan = deriveIntakeEnqueuePlan({
        session: {
          workflow: current.workflow,
          artifact: current.artifact,
          sourceName,
          sheet: current.sheet,
          bindings: current.bindings,
          constants: current.constants,
          corrections: current.corrections,
          exclusions: current.exclusions,
          readAt: current.validation.readAt,
        },
        projection,
        layout,
        manifestId: reservedManifestId,
        createdAt: now,
        workflowContractFingerprint: descriptor.contractFingerprint,
        canonicalInputSchemaHash,
        deriveItemId: (parsedInput) =>
          ItemIdSchema.parse(deriveItemId(current.workflow, planning.matchKey(parsedInput))),
      });
      if (!plan.readiness.ready) {
        const rows = plan.readiness.unresolvedRows;
        reject(
          request,
          "policy-refused",
          `${plan.readiness.message} [${plan.readiness.reason}${rows.length === 0 ? "" : `: source rows ${rows.join(", ")}`}]`,
        );
      }

      const assigned = new Set([...current.bindings.map(row => row.targetFieldId), ...current.constants.map(row => row.targetFieldId)]);
      if (projection.targets.some(field => field.required && !assigned.has(field.targetFieldId))) {
        reject(request, "policy-refused", "required intake fields are not bound; review the mapping before running");
      }
      let prior: IntakePlanManifest | undefined;
      try { prior = resolveIntakeComparison(current, repositories.intakeManifests); }
      catch (error) { reject(request, "invalid-state", error instanceof Error ? error.message : String(error)); }
      if (request.payload.reviewBinding === undefined || request.payload.reviewBinding !== intakeReviewBinding(current, plan.manifest, prior)) {
        reject(request, "policy-refused", "the exact current Intake review must be confirmed; reload and review before running");
      }

      // Every enqueued config identity must resolve to its retained snapshot.
      const { configFingerprint, configSnapshotId } = selectNewRunIdentity(repositories, dependencies.configIdentity);
      const snapshot = repositories.configSnapshots.get(configSnapshotId);
      if (snapshot === undefined) {
        throw new Error(
          `intake session ${sessionId} cannot enqueue: authority holds no config snapshot ${configSnapshotId}`,
        );
      }
      if (snapshot.fingerprint !== configFingerprint) {
        throw new Error(
          `intake session ${sessionId} cannot enqueue: config snapshot ${configSnapshotId} holds fingerprint `
          + `${snapshot.fingerprint.slice(0, 12)}…, not the ${configFingerprint.slice(0, 12)}… this process resolved`,
        );
      }

      const stored = repositories.intakeManifests.insert(plan.manifest);
      if (stored.state !== "inserted") {
        throw new Error(
          `intake session ${sessionId} minted manifest id ${plan.manifest.manifestId}, which already exists; `
          + "refusing to adopt it",
        );
      }

      const fanOut = fanOutQueuedRuns(
        repositories,
        dependencies.lifecycle,
        (message, refusal) => refusal === undefined ? reject(request, "policy-refused", message) : lifecycleRefusal(request, refusal),
        descriptor,
        {
          commandId: request.commandId, actorId: request.requestedBy,
          workflow: current.workflow,
          descriptorVersion: descriptor.version,
          contractFingerprint: descriptor.contractFingerprint,
          resolvedInstance: resolveInstances(descriptor, undefined),
          configFingerprint,
          configSnapshotId,

          shape: "single",
          // A spreadsheet fan-out is the definition of bulk, and this is a
          // server stamp rather than a caller claim (ref dashboard-surfaces ).
          priority: "bulk",
          dryRun: request.payload.dryRun,
          ingressSchemaHash: deriveSchemaHash(descriptor.input, "input"),
          appVersion: dependencies.appVersion,

          session: {
            sessionId: dependencies.ids.uuid(),
            origin: {
              kind: "intake-manifest",
              intakeManifestId: plan.manifest.manifestId,
              actorId: request.requestedBy,
            },
          },
        },
        plan.manifest.validRows.map((row) => {
          let admitted: ReturnType<typeof admitProtectedInput>;
          try { admitted = admitProtectedInput(descriptor, [row.parsedInput]); }
          catch (error) { reject(request, "invalid-state", error instanceof Error ? error.message : String(error)); }
          if (admitted.length !== 1) throw new Error("intake protected-input admission count mismatch");
          let canonicalInput: unknown;
          try {
            // Parse stored manifests through the current canonical schema, never ingress defaults.
            canonicalInput = planning.parseCanonicalInput(row.parsedInput);
          } catch (error) {
            throw new Error(
              `intake manifest ${plan.manifest.manifestId} source row ${String(row.sourceRow)} does not satisfy `
              + `${current.workflow}'s canonical input schema; nothing was enqueued`,
              { cause: error },
            );
          }
          return {
            itemId: row.itemId,
            title: planning.title(row.parsedInput), subtitle: planning.subtitle(row.parsedInput),
            matchKey: planning.matchKey(row.parsedInput),
            // The manifest's own stored value IS this run's ingress: it is what
            // intake submitted, and `validRows[].inputHash` pins its bytes.
            rawInput: row.parsedInput,
            parsedInput: { schemaHash: canonicalInputSchemaHash, value: canonicalInput, protectedBindings: admitted[0].bindings },
          };
        }),
        now,
        `intake manifest ${plan.manifest.manifestId}`,
      );

      const updated = repositories.intakeSessions.update({
        ...current,
        state: "enqueued",
        intakeManifestId: plan.manifest.manifestId,
        updatedAt: now,
        version: current.version + 1,
      });
      return applied(
        request,
        [target, ...fanOut.affectedTargets],
        [{ target, before: current.version, after: updated.version }, ...fanOut.versionChanges],
      );
    }
  }
}
