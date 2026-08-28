/**
 * Explorer draft validation and apply authority (D186/D283).
 *
 * Validation always starts from the live, factory-built Explorer projection.
 * That projection has already traversed the registered descriptor, graph,
 * contracts, UI registry and scenario corpus and parsed the resulting strict
 * wire. Presentation overrides never become a second executable graph.
 */
import { createHash } from "node:crypto";
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import {
  ExplorerEditApplyRequestSchema,
  ExplorerEditApplyResultSchema,
  ExplorerEditDraftSchema,
  ExplorerEditValidationResultSchema,
  ExplorerProposedWorkflowOverrideSchema,
  ExplorerWorkflowOverrideSchema,
  type ExplorerEditApplyResult,
  type ExplorerEditValidationResult,
  type ExplorerWorkflowOverride,
} from "../../../domain/dashboard/explorer.js";
import { buildWorkflowExplorer, type ExplorerQueryDeps } from "../queries/explorer.js";
import { ExplorerOverrideConflictError } from "./explorer-override-store.js";
import type { ExplorerOverrideRepository } from "./explorer-override-store.js";

export interface ExplorerEditService {
  validate(input: unknown): ExplorerEditValidationResult;
  apply(input: unknown): ExplorerEditApplyResult;
}

export interface ExplorerEditServiceDeps {
  readonly explorer: ExplorerQueryDeps;
  readonly overrides: ExplorerOverrideRepository;
}

export function createExplorerEditService(deps: ExplorerEditServiceDeps): ExplorerEditService {
  const validate = (input: unknown): ExplorerEditValidationResult => {
    const draft = ExplorerEditDraftSchema.parse(input);
    // This is the real compile-integrity path, not a descriptor-shaped fixture.
    const explorer = buildWorkflowExplorer(deps.explorer);
    const workflow = explorer.workflows.find(({ id }) => String(id) === String(draft.workflowId));
    if (workflow === undefined) {
      return ExplorerEditValidationResultSchema.parse({
        state: "refused",
        category: "new-workflow-authoring",
        message: `workflow ${String(draft.workflowId)} is not registered; Explorer safe edit cannot author a new workflow`,
      });
    }
    const current = deps.overrides.read(String(draft.workflowId));
    const currentRevision = current?.revision ?? 0;
    if (draft.baseDescriptorVersion !== workflow.version) {
      return ExplorerEditValidationResultSchema.parse({
        state: "conflict",
        conflict: "descriptor-version",
        message: `workflow ${String(draft.workflowId)} is v${String(workflow.version)}, not draft base v${String(draft.baseDescriptorVersion)}`,
        currentDescriptorVersion: workflow.version,
        currentContractFingerprint: workflow.contractFingerprint,
        currentOverrideRevision: currentRevision,
      });
    }
    if (draft.baseContractFingerprint !== workflow.contractFingerprint) {
      return ExplorerEditValidationResultSchema.parse({
        state: "conflict",
        conflict: "contract-fingerprint",
        message: `workflow ${String(draft.workflowId)} contract fingerprint changed after the draft was opened`,
        currentDescriptorVersion: workflow.version,
        currentContractFingerprint: workflow.contractFingerprint,
        currentOverrideRevision: currentRevision,
      });
    }
    if (draft.baseOverrideRevision !== currentRevision) {
      return ExplorerEditValidationResultSchema.parse({
        state: "conflict",
        conflict: "override-revision",
        message: `workflow ${String(draft.workflowId)} override is revision ${String(currentRevision)}, not draft base ${String(draft.baseOverrideRevision)}`,
        currentDescriptorVersion: workflow.version,
        currentContractFingerprint: workflow.contractFingerprint,
        currentOverrideRevision: currentRevision,
      });
    }

    const descriptor = deps.explorer.modules.find(
      (module) => String(module.descriptor.id) === String(draft.workflowId),
    )?.descriptor;
    if (descriptor === undefined) {
      throw new Error(`workflow ${String(draft.workflowId)} is projected but absent from the Explorer module tuple`);
    }
    const descriptorSource = workflow.sources.descriptor;
    if (descriptorSource.state !== "resolved") {
      throw new Error(
        `workflow ${String(draft.workflowId)} descriptor source is unresolved: ${descriptorSource.reason}`,
      );
    }
    const codeChange = draft.changes.filter(
      (change) => change.kind === "enqueue-policy" || change.kind === "edit-data-fields",
    );
    for (const change of codeChange) {
      if (change.kind !== "edit-data-fields") continue;
      const declared = new Set(workflow.nodes.flatMap((node) => node.editableFields.map(
        (field) => `${String(node.id)}\0${String(field.fieldPath)}\0${field.label}`,
      )));
      const unallowlisted = change.fields.filter(
        (field) => !declared.has(`${String(field.nodeId)}\0${String(field.fieldPath)}\0${field.label}`),
      );
      if (unallowlisted.length > 0) {
        return ExplorerEditValidationResultSchema.parse({
          state: "refused",
          category: "edit-data-field-allowlist",
          message: `workflow ${String(draft.workflowId)} does not descriptor-allowlist Edit Data field(s): `
            + unallowlisted.map((field) => `${String(field.nodeId)}.${String(field.fieldPath)}`).join(", "),
        });
      }
    }
    if (codeChange.length > 0) {
      const policy = codeChange.some((change) => change.kind === "enqueue-policy");
      return ExplorerEditValidationResultSchema.parse({
        state: "code-change-required",
        brief: {
          workflowId: workflow.id,
          reason: policy
            ? "operational policy has no descriptor-declared allowlist; it remains a reviewed source change"
            : "Edit Data changes runtime correction authority and remain a reviewed descriptor source change",
          requiredFiles: [descriptorSource.path],
          failedObligations: codeChange.map((change) => change.kind === "enqueue-policy"
            ? "declare and review an exact allowed-value set before changing enqueue policy"
            : "update the descriptor allowlist and re-run full output-schema/edit-field integrity"),
          impactedTasks: workflow.nodes.flatMap((node) => node.tasks.map((task) => task.taskId)),
          impactedScenarios: workflow.scenarios.map(({ scenarioId }) => scenarioId),
          descriptorVersionRequired: workflow.version + 1,
          currentContractFingerprint: workflow.contractFingerprint,
        },
      });
    }

    let label = current?.presentation.label;
    let icon = current?.presentation.icon;
    let category = current?.presentation.category;
    const categoryLabels = new Map(
      (current?.presentation.timelineCategoryLabels ?? []).map((entry) => [String(entry.categoryKey), entry.label]),
    );
    let categoryOrder = current?.presentation.timelineCategoryOrder;
    const semanticDiff: { path: string; before: string | string[]; after: string | string[] }[] = [];
    const duplicateKeys = draft.changes.map((change) => change.kind === "timeline-category-label"
      ? `${change.kind}:${String(change.categoryKey)}`
      : change.kind);
    if (new Set(duplicateKeys).size !== duplicateKeys.length) {
      return ExplorerEditValidationResultSchema.parse({
        state: "refused",
        category: "duplicate-change",
        message: `workflow ${String(draft.workflowId)} draft repeats a change target`,
      });
    }
    for (const change of draft.changes) {
      if (change.kind === "workflow-label") {
        const before = label ?? workflow.label;
        label = change.value;
        if (before !== change.value) semanticDiff.push({ path: "presentation.label", before, after: change.value });
      } else if (change.kind === "workflow-icon") {
        const before = icon ?? workflow.icon;
        icon = change.value;
        if (before !== change.value) semanticDiff.push({ path: "presentation.icon", before, after: change.value });
      } else if (change.kind === "workflow-category") {
        const before = category ?? workflow.category;
        category = change.value;
        if (before !== change.value) semanticDiff.push({ path: "presentation.category", before, after: change.value });
      } else if (change.kind === "timeline-category-label") {
        const declared = descriptor.timeline.find(({ key }) => String(key) === String(change.categoryKey));
        if (declared === undefined) {
          return ExplorerEditValidationResultSchema.parse({
            state: "refused",
            category: "timeline-category-owner",
            message: `workflow ${String(draft.workflowId)} declares no timeline category ${String(change.categoryKey)}`,
          });
        }
        const before = categoryLabels.get(String(change.categoryKey)) ?? declared.label;
        categoryLabels.set(String(change.categoryKey), change.value);
        if (before !== change.value) semanticDiff.push({
          path: `presentation.timeline.${String(change.categoryKey)}.label`,
          before,
          after: change.value,
        });
      } else if (change.kind === "timeline-category-order") {
        const expected = descriptor.timeline.map(({ key }) => String(key));
        const received = change.categoryKeys.map(String);
        if (received.length !== expected.length
          || new Set(received).size !== received.length
          || expected.some((key) => !received.includes(key))) {
          return ExplorerEditValidationResultSchema.parse({
            state: "refused",
            category: "timeline-category-order",
            message: `workflow ${String(draft.workflowId)} timeline order must be an exact permutation of: ${expected.join(", ")}`,
          });
        }
        const before = categoryOrder?.map(String) ?? expected;
        categoryOrder = change.categoryKeys;
        if (before.some((key, index) => key !== received[index])) semanticDiff.push({
          path: "presentation.timeline.order",
          before,
          after: received,
        });
      }
    }
    if (semanticDiff.length === 0) {
      return ExplorerEditValidationResultSchema.parse({
        state: "refused",
        category: "empty-diff",
        message: `workflow ${String(draft.workflowId)} draft changes no effective presentation value`,
      });
    }
    const override = ExplorerProposedWorkflowOverrideSchema.parse({
      overrideVersion: 1,
      workflowId: workflow.id,
      descriptorVersion: workflow.version,
      contractFingerprint: workflow.contractFingerprint,
      revision: currentRevision + 1,
      presentation: {
        ...(label === undefined ? {} : { label }),
        ...(icon === undefined ? {} : { icon }),
        ...(category === undefined ? {} : { category }),
        timelineCategoryLabels: [...categoryLabels].map(([categoryKey, categoryLabel]) => ({
          categoryKey,
          label: categoryLabel,
        })),
        ...(categoryOrder === undefined
          ? {}
          : { timelineCategoryOrder: categoryOrder }),
      },
    });
    return ExplorerEditValidationResultSchema.parse({
      state: "ready-to-apply",
      draft,
      override,
      semanticDiff,
      impactedTasks: workflow.nodes.flatMap((node) => node.tasks.map((task) => task.taskId)),
      impactedScenarios: workflow.scenarios.map(({ scenarioId }) => scenarioId),
    });
  };

  return Object.freeze({
    validate,
    apply(input: unknown): ExplorerEditApplyResult {
      const request = ExplorerEditApplyRequestSchema.parse(input);
      const commandFingerprint = createHash("sha256")
        .update("hrauto:explorer-edit-command:v1\0")
        .update(canonicalJsonStringify(request))
        .digest("hex");
      const existing = deps.overrides.read(String(request.draft.workflowId));
      if (existing?.appliedCommandId === request.commandId) {
        if (existing.commandFingerprint !== commandFingerprint) {
          throw new Error(
            `Explorer command ${request.commandId} was already persisted with different content`,
          );
        }
        return ExplorerEditApplyResultSchema.parse({ state: "applied", override: existing, readback: existing });
      }
      const validation = validate(request.draft);
      if (validation.state !== "ready-to-apply") return ExplorerEditApplyResultSchema.parse(validation);
      const override = ExplorerWorkflowOverrideSchema.parse({
        ...validation.override,
        appliedCommandId: request.commandId,
        commandFingerprint,
      });
      let persisted: ExplorerWorkflowOverride;
      try {
        persisted = deps.overrides.replace(validation.draft.baseOverrideRevision, override);
      } catch (error) {
        if (!(error instanceof ExplorerOverrideConflictError)) throw error;
        const workflow = buildWorkflowExplorer(deps.explorer).workflows.find(
          ({ id }) => String(id) === String(validation.draft.workflowId),
        );
        if (workflow === undefined) {
          throw new Error(`workflow ${String(validation.draft.workflowId)} vanished while reporting override conflict`);
        }
        return ExplorerEditApplyResultSchema.parse({
          state: "conflict",
          conflict: "override-revision",
          message: error.message,
          currentDescriptorVersion: workflow.version,
          currentContractFingerprint: workflow.contractFingerprint,
          currentOverrideRevision: error.currentRevision,
        });
      }
      const readback = deps.overrides.read(String(validation.draft.workflowId));
      if (readback === undefined) {
        throw new Error(`Explorer override ${String(validation.draft.workflowId)} vanished after atomic replace`);
      }
      return ExplorerEditApplyResultSchema.parse({ state: "applied", override: persisted, readback });
    },
  });
}
