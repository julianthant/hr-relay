/** Compile and apply service for the Explorer's closed safe-edit protocol. */
import type { AnyWorkflowDescriptor } from "../../../base/workflow.js";
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import type { Clock } from "../../../domain/clock.js";
import {
  deriveExplorerEditFingerprint,
  ExplorerCompiledEditSchema,
  ExplorerEditApplyRequestSchema,
  ExplorerEditApplyResultSchema,
  ExplorerEditReadbackSchema,
  type ExplorerCompiledEdit,
  type ExplorerEditApplyRequest,
  type ExplorerEditApplyResult,
  type ExplorerEditChange,
  type ExplorerEditReadback,
} from "../../../domain/dashboard/explorer-edit.js";
import type { WorkflowId } from "../../../domain/ids.js";
import type { ExplorerEditAuthority } from "../../../infra/explorer-edit-authority.js";

export interface ExplorerEditServiceDeps {
  readonly authority: ExplorerEditAuthority;
  readonly clock: Clock;
  /** A function so the apply-time check can observe a descriptor replacement. */
  readonly descriptors: () => readonly AnyWorkflowDescriptor[];
}

type CompileResult =
  | Readonly<{ state: "compiled"; compiled: ExplorerCompiledEdit; descriptor: AnyWorkflowDescriptor }>
  | Extract<ExplorerEditApplyResult, { state: "conflict" }>;

class DescriptorMovedDuringApply extends Error {
  readonly conflict: Extract<ExplorerEditApplyResult, { state: "conflict" }>;
  constructor(conflict: Extract<ExplorerEditApplyResult, { state: "conflict" }>) {
    super(conflict.message);
    this.name = "DescriptorMovedDuringApply";
    this.conflict = conflict;
  }
}

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
    this.#deps = deps;
  }

  compile(input: unknown): CompileResult {
    const request = ExplorerEditApplyRequestSchema.parse(input);
    const descriptor = this.#descriptor(request.draft.workflowId);
    if (
      descriptor.version !== request.draft.baseDescriptorVersion
      || descriptor.contractFingerprint !== request.draft.baseContractFingerprint
    ) {
      const currentOverrideRevision = this.#deps.authority.read(String(request.draft.workflowId))?.revision ?? 0;
      return descriptorConflict(request, descriptor, currentOverrideRevision);
    }
    for (const change of request.draft.changes) validateChangeOwnership(descriptor, change);
    const compiledFingerprint = deriveExplorerEditFingerprint(request.draft);
    return {
      state: "compiled",
      descriptor,
      compiled: ExplorerCompiledEditSchema.parse({
        commandId: request.commandId,
        draft: request.draft,
        compiledFingerprint,
      }),
    };
  }

  apply(input: unknown): ExplorerEditApplyResult {
    const request = ExplorerEditApplyRequestSchema.parse(input);
    const ingress = this.compile(request);
    if (ingress.state === "conflict") return ingress;
    try {
      const committed = this.#deps.authority.commit(
        ingress.compiled,
        this.#deps.clock.now().toISOString(),
        () => {
          const applyTime = this.compile(request);
          if (applyTime.state === "conflict") throw new DescriptorMovedDuringApply(applyTime);
          if (applyTime.compiled.compiledFingerprint !== ingress.compiled.compiledFingerprint) {
            throw new Error(`Explorer draft ${String(request.commandId)} compiled to two fingerprints`);
          }
        },
      );
      if (committed.state === "conflict") {
        return ExplorerEditApplyResultSchema.parse({
          state: "conflict",
          workflowId: request.draft.workflowId,
          currentOverrideRevision: committed.currentRevision,
          currentDescriptorVersion: ingress.descriptor.version,
          currentContractFingerprint: ingress.descriptor.contractFingerprint,
          message: `Explorer override for ${String(request.draft.workflowId)} is revision `
            + `${String(committed.currentRevision)}, not ${String(request.draft.baseOverrideRevision)}`,
        });
      }
      return ExplorerEditApplyResultSchema.parse(committed);
    } catch (error) {
      if (error instanceof DescriptorMovedDuringApply) return error.conflict;
      throw error;
    }
  }

  read(workflowId: WorkflowId): ExplorerEditReadback {
    const descriptor = this.#descriptor(workflowId);
    const override = this.#deps.authority.read(String(workflowId));
    if (override === undefined) return ExplorerEditReadbackSchema.parse({ state: "none", revision: 0 });
    if (
      override.baseDescriptorVersion !== descriptor.version
      || override.baseContractFingerprint !== descriptor.contractFingerprint
    ) {
      throw new Error(
        `Explorer override for ${String(workflowId)} targets descriptor v${String(override.baseDescriptorVersion)} `
        + `${override.baseContractFingerprint}, but the running descriptor is v${String(descriptor.version)} `
        + descriptor.contractFingerprint,
      );
    }
    for (const change of override.changes) validateChangeOwnership(descriptor, change);
    return ExplorerEditReadbackSchema.parse({ state: "applied", override });
  }

  #descriptor(workflowId: WorkflowId): AnyWorkflowDescriptor {
    const descriptor = this.#deps.descriptors().find(({ id }) => String(id) === String(workflowId));
    if (descriptor === undefined) throw new Error(`workflow ${String(workflowId)} is not registered`);
    return descriptor;
  }
}
