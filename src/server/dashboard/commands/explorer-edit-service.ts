/**
 * Explorer draft validation and apply authority (D186/D283).
 *
 * Validation always starts from the live, factory-built Explorer projection.
 * That projection has already traversed the registered descriptor, graph,
 * contracts, UI registry and scenario corpus and parsed the resulting strict
 * wire. Presentation overrides never become a second executable graph.
 */
import {
  ExplorerEditApplyResultSchema,
  ExplorerEditDraftSchema,
  ExplorerEditValidationResultSchema,
  ExplorerWorkflowOverrideSchema,
  type ExplorerEditApplyResult,
  type ExplorerEditValidationResult,
  type ExplorerWorkflowOverride,
} from "../../../domain/dashboard/explorer.js";
import { buildWorkflowExplorer, type ExplorerQueryDeps } from "../queries/explorer.js";

export interface ExplorerOverrideRepository {
  read(workflowId: string): ExplorerWorkflowOverride | undefined;
  replace(expectedRevision: number, override: ExplorerWorkflowOverride): ExplorerWorkflowOverride;
}

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

    let label = current?.presentation.label;
    const semanticDiff: { path: string; before: string | string[]; after: string | string[] }[] = [];
    for (const change of draft.changes) {
      if (change.kind !== "workflow-label") continue;
      const before = label ?? workflow.label;
      label = change.value;
      if (before !== change.value) semanticDiff.push({ path: "presentation.label", before, after: change.value });
    }
    if (semanticDiff.length === 0) {
      return ExplorerEditValidationResultSchema.parse({
        state: "refused",
        category: "empty-diff",
        message: `workflow ${String(draft.workflowId)} draft changes no effective presentation value`,
      });
    }
    const override = ExplorerWorkflowOverrideSchema.parse({
      overrideVersion: 1,
      workflowId: workflow.id,
      descriptorVersion: workflow.version,
      contractFingerprint: workflow.contractFingerprint,
      revision: currentRevision + 1,
      presentation: {
        ...(label === undefined ? {} : { label }),
        ...(current?.presentation.icon === undefined ? {} : { icon: current.presentation.icon }),
        ...(current?.presentation.category === undefined ? {} : { category: current.presentation.category }),
        timelineCategoryLabels: current?.presentation.timelineCategoryLabels ?? [],
        ...(current?.presentation.timelineCategoryOrder === undefined
          ? {}
          : { timelineCategoryOrder: current.presentation.timelineCategoryOrder }),
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
      const validation = validate(input);
      if (validation.state !== "ready-to-apply") return ExplorerEditApplyResultSchema.parse(validation);
      const persisted = deps.overrides.replace(validation.draft.baseOverrideRevision, validation.override);
      const readback = deps.overrides.read(String(validation.draft.workflowId));
      if (readback === undefined) {
        throw new Error(`Explorer override ${String(validation.draft.workflowId)} vanished after atomic replace`);
      }
      return ExplorerEditApplyResultSchema.parse({ state: "applied", override: persisted, readback });
    },
  });
}
