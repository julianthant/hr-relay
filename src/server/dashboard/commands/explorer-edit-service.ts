/** Compile, review-token, and journal-backed projection service for Explorer safe edits. */
import type { AnyWorkflowDescriptor } from "../../../base/workflow.js";
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import type { Clock } from "../../../domain/clock.js";
import {
  deriveExplorerEditFingerprint,
  ExplorerCompiledEditSchema,
  ExplorerEditApplyRequestSchema,
  ExplorerEditApplyResultSchema,
  ExplorerEditReadbackSchema,
  ExplorerEditReviewReceiptSchema,
  ExplorerEditReviewRequestSchema,
  ExplorerEditReviewTokenRecordSchema,
  type ExplorerEditApplyRequest,
  type ExplorerEditApplyResult,
  type ExplorerEditChange,
  type ExplorerEditReadback,
  type ExplorerEditReviewReceipt,
} from "../../../domain/dashboard/explorer-edit.js";
import type { IdFactory } from "../../../domain/identifiers.js";
import type { WorkflowId } from "../../../domain/ids.js";
import type { ExplorerEditAuthority } from "../../../infra/explorer-edit-authority.js";
import type { AuthorityRepositories } from "../../../infra/sqlite/authority-database.js";

export interface ExplorerEditAuthorityState {
  withAuthorityTransaction<Result>(work: (repositories: AuthorityRepositories) => Result): Result;
}

export interface ExplorerEditServiceDeps {
  readonly authority: ExplorerEditAuthority;
  readonly authorityState: ExplorerEditAuthorityState;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly reviewTtlMs: number;
  /** A function so review/apply checks can observe descriptor replacement. */
  readonly descriptors: () => readonly AnyWorkflowDescriptor[];
}

export type ExplorerEditCompileResult =
  | Readonly<{
    state: "compiled";
    compiled: ReturnType<typeof ExplorerCompiledEditSchema.parse>;
    descriptor: AnyWorkflowDescriptor;
  }>
  | Extract<ExplorerEditApplyResult, { state: "conflict" | "rejected" }>;

function descriptorConflict(
  request: ExplorerEditApplyRequest,
  descriptor: AnyWorkflowDescriptor,
  currentOverrideRevision: number,
): Extract<ExplorerEditApplyResult, { state: "conflict" }> {
  const parsed = ExplorerEditApplyResultSchema.parse({
    state: "conflict",
    workflowId: request.draft.workflowId,
    currentOverrideRevision,
    currentDescriptorVersion: descriptor.version,
    currentContractFingerprint: descriptor.contractFingerprint,
    message: `Explorer draft for ${String(request.draft.workflowId)} is based on descriptor `
      + `v${String(request.draft.baseDescriptorVersion)} ${request.draft.baseContractFingerprint}, but the running `
      + `descriptor is v${String(descriptor.version)} ${descriptor.contractFingerprint}`,
  });
  if (parsed.state !== "conflict") throw new Error("descriptor conflict parsed as an applied Explorer edit");
  return parsed;
}

function revisionConflict(
  request: ExplorerEditApplyRequest,
  descriptor: AnyWorkflowDescriptor,
  currentOverrideRevision: number,
): Extract<ExplorerEditApplyResult, { state: "conflict" }> {
  const parsed = ExplorerEditApplyResultSchema.parse({
    state: "conflict",
    workflowId: request.draft.workflowId,
    currentOverrideRevision,
    currentDescriptorVersion: descriptor.version,
    currentContractFingerprint: descriptor.contractFingerprint,
    message: `Explorer override for ${String(request.draft.workflowId)} is revision `
      + `${String(currentOverrideRevision)}, not ${String(request.draft.baseOverrideRevision)}`,
  });
  if (parsed.state !== "conflict") throw new Error("revision conflict parsed as an applied Explorer edit");
  return parsed;
}

function validateChangeOwnership(descriptor: AnyWorkflowDescriptor, change: ExplorerEditChange): void {
  if (change.kind === "timeline-category-label") {
    if (!descriptor.timeline.some(({ key }) => key === change.categoryKey)) {
      throw new Error(`${String(descriptor.id)} does not declare timeline category ${change.categoryKey}`);
    }
    return;
  }
  if (change.kind === "timeline-category-order") {
    const declared = descriptor.timeline.map(({ key }) => String(key)).toSorted();
    const proposed = change.categoryKeys.map(String).toSorted();
    if (canonicalJsonStringify(declared) !== canonicalJsonStringify(proposed)) {
      throw new Error(
        `${String(descriptor.id)} does not declare exactly the proposed timeline category order; `
        + `expected ${declared.join(", ")}`,
      );
    }
    return;
  }
  if (change.kind !== "edit-data-fields") return;
  const editData = descriptor.capabilities?.editData;
  const declared = typeof editData === "object" ? editData.fields : [];
  for (const field of change.fields) {
    if (!declared.some((candidate) =>
      String(candidate.nodeId) === String(field.nodeId)
      && String(candidate.fieldPath) === String(field.fieldPath))) {
      throw new Error(
        `${String(descriptor.id)} does not declare Edit Data field ${String(field.nodeId)}.${String(field.fieldPath)}`,
      );
    }
  }
}

export class ExplorerEditService {
  readonly #deps: ExplorerEditServiceDeps;

  constructor(deps: ExplorerEditServiceDeps) {
    if (!Number.isSafeInteger(deps.reviewTtlMs) || deps.reviewTtlMs <= 0) {
      throw new Error("Explorer review TTL must be a positive safe integer");
    }
    this.#deps = deps;
  }

  issueReview(input: unknown): ExplorerEditReviewReceipt {
    const request = ExplorerEditReviewRequestSchema.parse(input);
    const issuedAt = this.#deps.clock.now();
    const expiresAt = new Date(issuedAt.getTime() + this.#deps.reviewTtlMs);
    return this.#deps.authorityState.withAuthorityTransaction((repositories) => {
      const descriptor = this.#validateDraft(request.draft.workflowId, request.draft);
      const currentRevision = repositories.explorerEditOutbox
        .latestForWorkflow(String(request.draft.workflowId))?.override.revision ?? 0;
      if (request.draft.baseOverrideRevision !== currentRevision) {
        throw new Error(
          `Explorer review for ${String(request.draft.workflowId)} is based on override revision `
          + `${String(request.draft.baseOverrideRevision)}, but authority is at ${String(currentRevision)}`,
        );
      }
      if (descriptor.version !== request.draft.baseDescriptorVersion
        || descriptor.contractFingerprint !== request.draft.baseContractFingerprint) {
        throw new Error(`Explorer review for ${String(request.draft.workflowId)} is based on a stale descriptor identity`);
      }
      const record = ExplorerEditReviewTokenRecordSchema.parse({
        recordVersion: 1,
        reviewTokenId: this.#deps.ids.uuid(),
        draftFingerprint: deriveExplorerEditFingerprint(request.draft),
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        requestedBy: request.requestedBy,
        source: request.source,
        draft: request.draft,
        state: "issued",
      });
      const inserted = repositories.explorerEditReviews.insert(record);
      if (inserted.state !== "inserted") throw new Error(`fresh Explorer review token ${record.reviewTokenId} already exists`);
      return ExplorerEditReviewReceiptSchema.parse({
        reviewTokenId: record.reviewTokenId,
        draftFingerprint: record.draftFingerprint,
        issuedAt: record.issuedAt,
        expiresAt: record.expiresAt,
      });
    });
  }

  compile(input: unknown, currentOverrideRevision: number): ExplorerEditCompileResult {
    const request = ExplorerEditApplyRequestSchema.parse(input);
    const descriptor = this.#descriptor(request.draft.workflowId);
    if (descriptor.version !== request.draft.baseDescriptorVersion
      || descriptor.contractFingerprint !== request.draft.baseContractFingerprint) {
      return descriptorConflict(request, descriptor, currentOverrideRevision);
    }
    if (request.draft.baseOverrideRevision !== currentOverrideRevision) {
      return revisionConflict(request, descriptor, currentOverrideRevision);
    }
    for (const change of request.draft.changes) validateChangeOwnership(descriptor, change);
    return {
      state: "compiled",
      descriptor,
      compiled: ExplorerCompiledEditSchema.parse({
        commandId: request.commandId,
        draft: request.draft,
        compiledFingerprint: deriveExplorerEditFingerprint(request.draft),
      }),
    };
  }

  /** At-least-once restart drain. File replace happens only after command+audit commit. */
  reconcile(): void {
    const pending = this.#deps.authorityState.withAuthorityTransaction((repositories) =>
      repositories.explorerEditOutbox.listPending());
    for (const record of pending) {
      this.#deps.authorityState.withAuthorityTransaction((repositories) =>
        repositories.explorerEditOutbox.requireJournaled(record.commandId));
      const projected = this.#deps.authority.project(record.override);
      if (projected.state !== "applied") {
        throw new Error(
          `Explorer projection ${record.commandId} expected revision ${String(record.override.revision - 1)}, `
          + `but file authority is at ${String(projected.currentRevision)}`,
        );
      }
      this.#deps.authorityState.withAuthorityTransaction((repositories) => {
        repositories.explorerEditOutbox.requireJournaled(record.commandId);
        repositories.explorerEditOutbox.markProjected({
          commandId: record.commandId,
          projectedAt: this.#deps.clock.now().toISOString(),
        });
      });
    }
    const projectedCurrent = this.#deps.authorityState.withAuthorityTransaction((repositories) =>
      repositories.explorerEditOutbox.listProjectedCurrent());
    const reconciledCommands = new Set(pending.map(({ commandId }) => String(commandId)));
    for (const record of projectedCurrent) {
      if (reconciledCommands.has(String(record.commandId))) continue;
      this.#deps.authorityState.withAuthorityTransaction((repositories) =>
        repositories.explorerEditOutbox.requireJournaled(record.commandId));
      const projected = this.#deps.authority.project(record.override);
      if (projected.state !== "applied") {
        throw new Error(
          `Explorer projected outbox ${record.commandId} is revision ${String(record.override.revision)}, `
          + `but file authority is at ${String(projected.currentRevision)}`,
        );
      }
    }
    this.#verifyFileAuthority();
  }

  read(workflowId: WorkflowId): ExplorerEditReadback {
    this.reconcile();
    const descriptor = this.#descriptor(workflowId);
    const override = this.#deps.authority.read(String(workflowId));
    const durable = this.#deps.authorityState.withAuthorityTransaction((repositories) =>
      repositories.explorerEditOutbox.latestForWorkflow(String(workflowId)));
    if (durable === undefined) {
      if (override !== undefined) throw new Error(`Explorer file override for ${String(workflowId)} has no durable outbox`);
      return ExplorerEditReadbackSchema.parse({ state: "none", revision: 0 });
    }
    if (durable.state !== "projected") throw new Error(`Explorer outbox ${durable.commandId} remains pending after reconciliation`);
    if (override === undefined || canonicalJsonStringify(override) !== canonicalJsonStringify(durable.override)) {
      throw new Error(`Explorer file override for ${String(workflowId)} does not match durable outbox ${durable.commandId}`);
    }
    if (override.baseDescriptorVersion !== descriptor.version
      || override.baseContractFingerprint !== descriptor.contractFingerprint) {
      throw new Error(
        `Explorer override for ${String(workflowId)} targets descriptor v${String(override.baseDescriptorVersion)} `
        + `${override.baseContractFingerprint}, but the running descriptor is v${String(descriptor.version)} `
        + descriptor.contractFingerprint,
      );
    }
    for (const change of override.changes) validateChangeOwnership(descriptor, change);
    return ExplorerEditReadbackSchema.parse({ state: "applied", override });
  }

  #verifyFileAuthority(): void {
    for (const override of this.#deps.authority.readFile().overrides) {
      const durable = this.#deps.authorityState.withAuthorityTransaction((repositories) => {
        const latest = repositories.explorerEditOutbox.latestForWorkflow(String(override.workflowId));
        if (latest !== undefined) repositories.explorerEditOutbox.requireJournaled(latest.commandId);
        return latest;
      });
      if (durable === undefined || durable.state !== "projected"
        || canonicalJsonStringify(durable.override) !== canonicalJsonStringify(override)) {
        throw new Error(`Explorer file override for ${String(override.workflowId)} is not a projected journaled outbox`);
      }
    }
  }

  #validateDraft(workflowId: WorkflowId, draft: ExplorerEditApplyRequest["draft"]): AnyWorkflowDescriptor {
    const descriptor = this.#descriptor(workflowId);
    for (const change of draft.changes) validateChangeOwnership(descriptor, change);
    return descriptor;
  }

  #descriptor(workflowId: WorkflowId): AnyWorkflowDescriptor {
    const descriptor = this.#deps.descriptors().find(({ id }) => String(id) === String(workflowId));
    if (descriptor === undefined) throw new Error(`workflow ${String(workflowId)} is not registered`);
    return descriptor;
  }
}
