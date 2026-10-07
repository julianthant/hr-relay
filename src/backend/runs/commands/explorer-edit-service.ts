import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
/**
 * Explorer draft validation and apply authority (D186/D283).
 *
 * Validation always starts from the live, factory-built Explorer projection.
 * That projection has already traversed the registered descriptor, graph,
 * contracts, UI registry and scenario corpus and parsed the resulting strict
 * wire. Presentation overrides never become a second executable graph.
 */
import {
  descriptorRuntimeNodes,
  workflowProjections,
  workflowTerminalResultExecution,
} from "../../../workflow-kit/workflow.js";
import {
  auditWorkflowCodes,
  auditWorkflowModuleBindings,
  auditWorkflowModuleRoles,
} from "../../../workflow-kit/validation/workflow-module-audit.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import {
  ExplorerCodeChangeBriefSchema,
  ExplorerCompileAttestationSchema,
  ExplorerDescriptorPatchSchema,
  ExplorerEditApplyRequestSchema,
  ExplorerEditApplyResultSchema,
  ExplorerEditDraftSchema,
  ExplorerEditValidationResultSchema,
  ExplorerProposedWorkflowOverrideSchema,
  ExplorerWorkflowOverrideSchema,
  type ExplorerCompileAttestation,
  type ExplorerCodeChangeBrief,
  type ExplorerEditApplyResult,
  type ExplorerEditDraft,
  type ExplorerEditValidationResult,
  type ExplorerWorkflowWire,
  type ExplorerWorkflowOverride,
} from "../../../models/dashboard/explorer.js";
import { FingerprintSchema } from "../../../rules/identity/ids.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { EnqueuePolicySchema } from "../../../models/workflow/presentation.js";
import { buildWorkflowExplorer, type ExplorerQueryDeps } from "../queries/explorer.js";
import {
  explorerEditCommandFingerprint,
  ExplorerOverrideConflictError,
} from "../../../models/dashboard/explorer-override.js";
import type { ExplorerOverrideReader } from "../../../models/dashboard/explorer-override.js";

export interface ExplorerEditExecution {
  readonly result: ExplorerEditApplyResult;
}

export interface ExplorerEditService {
  validate(input: unknown): ExplorerEditValidationResult;
  apply(input: unknown, repositories: Pick<AuthorityRepositories, "explorerOverrides">): ExplorerEditExecution;
}

export interface ExplorerEditServiceDeps {
  readonly explorer: ExplorerQueryDeps;
  readonly overrides: ExplorerOverrideReader;
}

const REQUIRED_SOURCE_CHECKS = [
  { check: "builder", state: "required" },
  { check: "schema", state: "required" },
  { check: "graph", state: "required" },
  { check: "guard", state: "required" },
  { check: "scenario", state: "required" },
] as const;

const EVIDENCE_OBLIGATIONS = ["builder", "schema", "graph", "guard", "scenario"] as const;

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return canonicalJsonStringify([...left]) === canonicalJsonStringify([...right]);
}

/**
 * Re-run the runtime-capable arms of `workflow-editor-compile-integrity` over the
 * exact live composition. Static/no-DSL and executed-scenario arms remain source-gate
 * obligations and are never reported as having run inside the BFF.
 */
export function buildExplorerCompileAttestation(
  deps: ExplorerQueryDeps,
  workflow: ExplorerWorkflowWire,
): ExplorerCompileAttestation {
  const module = deps.modules.find(({ descriptor }) => String(descriptor.id) === String(workflow.id));
  if (module === undefined) {
    throw new Error(`Explorer compile attestation cannot resolve registered workflow ${String(workflow.id)}`);
  }
  const descriptor = module.descriptor;
  const projections = workflowProjections(descriptor);
  const runtimeNodes = descriptorRuntimeNodes(descriptor);
  const terminal = workflowTerminalResultExecution(descriptor);
  const tasks = workflow.nodes.flatMap((node) => node.tasks);
  const violations: string[] = [
    ...auditWorkflowModuleBindings(deps.modules),
    ...auditWorkflowModuleRoles(deps.modules),
    ...auditWorkflowCodes(deps.modules.map(({ descriptor: candidate }) => candidate)),
  ];

  if (workflow.version !== descriptor.version || workflow.contractFingerprint !== descriptor.contractFingerprint) {
    violations.push("served descriptor version/fingerprint differs from the factory-built descriptor");
  }
  if (workflow.inputSchemaHash !== deriveSchemaHash(descriptor.input, "input")
    || workflow.canonicalInputSchemaHash !== deriveSchemaHash(descriptor.canonicalInput, "input")
    || workflow.resultSchemaHash !== terminal.schemaHash) {
    violations.push("served workflow schema hashes differ from the factory-built descriptor");
  }

  const contracts = new Map(projections.contracts.map((contract) => [String(contract.id), contract]));
  const servedTaskIds = tasks.map(({ taskId }) => String(taskId));
  const projectedTaskIds = projections.contracts.map(({ id }) => String(id));
  if (!sameStrings([...servedTaskIds].sort(), [...projectedTaskIds].sort())) {
    violations.push("served task identities differ from the descriptor projection");
  }
  for (const task of tasks) {
    const contract = contracts.get(String(task.taskId));
    if (contract === undefined) continue;
    if (task.inputSchemaHash !== deriveSchemaHash(contract.input, "input")
      || task.outputSchemaHash !== deriveSchemaHash(contract.output, "output")) {
      violations.push(`task ${String(task.taskId)} schema hashes differ from its sealed contract`);
    }
    for (const [name, source] of [["contract", task.contractSource], ["implementation", task.implSource]] as const) {
      if (source.state !== "resolved") {
        violations.push(`task ${String(task.taskId)} ${name} source is unresolved: ${source.reason}`);
      }
    }
  }

  const runtimeNodeIds = runtimeNodes.map(({ id }) => String(id));
  const servedNodeIds = workflow.nodes.map(({ id }) => String(id));
  if (!sameStrings(servedNodeIds, runtimeNodeIds)) {
    violations.push("served node identities/order differ from the factory-built graph");
  }
  const projectedCoverage = projections.coveragePoints.map(({ id }) => id).sort();
  const servedCoverage = workflow.nodes.flatMap((node) => node.coveragePoints.map(({ id }) => id)).sort();
  if (!sameStrings(servedCoverage, projectedCoverage)) {
    violations.push("served graph coverage points differ from the factory-built graph");
  }

  const projectedScenarios = projections.scenarios.map(String).sort();
  const servedScenarios = workflow.scenarios.map(({ scenarioId }) => String(scenarioId)).sort();
  if (!sameStrings(servedScenarios, projectedScenarios)) {
    violations.push("served scenario registrations differ from the descriptor/task union");
  }
  for (const scenario of workflow.scenarios) {
    if (scenario.source.state !== "resolved") {
      violations.push(`scenario ${String(scenario.scenarioId)} source is unresolved: ${scenario.source.reason}`);
    }
  }
  for (const [name, source] of [["descriptor", workflow.sources.descriptor], ["module", workflow.sources.module]] as const) {
    if (source.state !== "resolved") {
      violations.push(`${name} source is unresolved: ${source.reason}`);
    }
  }

  const catalogIds = new Set(deps.uiTaskLinks.map(({ id }) => String(id)));
  for (const task of tasks) {
    for (const link of task.ui) {
      if (!catalogIds.has(link.catalogId)) {
        violations.push(`task ${String(task.taskId)} names unknown UI catalog id ${link.catalogId}`);
      }
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `Explorer compile attestation refused workflow ${String(workflow.id)}: ${violations.join("; ")}`,
    );
  }

  const scenarioRegistrations = workflow.scenarios.map((scenario) => {
    if (scenario.source.state !== "resolved") {
      throw new Error(`Explorer compile attestation lost scenario ${String(scenario.scenarioId)} source after audit`);
    }
    return { scenarioId: scenario.scenarioId, sourcePath: scenario.source.path };
  });
  return ExplorerCompileAttestationSchema.parse({
    attestationVersion: 1,
    workflowId: workflow.id,
    descriptorVersion: workflow.version,
    contractFingerprint: workflow.contractFingerprint,
    checks: {
      builder: { state: "held", factory: "defineWorkflowDescriptor" },
      schema: {
        state: "held",
        inputSchemaHash: workflow.inputSchemaHash,
        canonicalInputSchemaHash: workflow.canonicalInputSchemaHash,
        resultSchemaHash: workflow.resultSchemaHash,
        tasks: tasks.map((task) => ({
          taskId: task.taskId,
          inputSchemaHash: task.inputSchemaHash,
          outputSchemaHash: task.outputSchemaHash,
        })),
      },
      graph: {
        state: "held",
        nodeIds: workflow.nodes.map(({ id }) => id),
        edgeFingerprint: FingerprintSchema.parse(
          sha256Hex(`hrauto:explorer-graph-edges:v1\0${canonicalJsonStringify(workflow.edges)}`),
        ),
        coveragePointIds: workflow.nodes.flatMap((node) => node.coveragePoints.map(({ id }) => id)),
      },
      guard: {
        state: "held",
        name: "workflow-editor-compile-integrity",
        scope: "runtime-registry-round-trip",
        descriptorSetHash: deps.descriptorSetHash,
      },
      scenario: {
        state: "held",
        scope: "registered-source-resolution",
        registrations: scenarioRegistrations,
      },
    },
  });
}

function codeChangeBrief(
  draft: ExplorerEditDraft,
  workflow: ExplorerWorkflowWire,
  attestation: ExplorerCompileAttestation,
):
  | Readonly<{ state: "brief"; brief: ExplorerCodeChangeBrief }>
  | Readonly<{ state: "empty" }>
  | Readonly<{ state: "partial-no-op"; noOpKinds: readonly ("enqueue-policy" | "edit-data-fields")[] }> {
  const descriptorSource = workflow.sources.descriptor;
  if (descriptorSource.state !== "resolved") {
    throw new Error(`workflow ${String(workflow.id)} descriptor source is unresolved: ${descriptorSource.reason}`);
  }
  const changes = draft.changes.filter(
    (change): change is Extract<ExplorerEditDraft["changes"][number], { kind: "enqueue-policy" | "edit-data-fields" }> =>
      change.kind === "enqueue-policy" || change.kind === "edit-data-fields",
  );
  const operations: Array<{
    propertyPath: "enqueue" | "capabilities.editData.fields";
    beforeExpression: string;
    afterExpression: string;
  }> = [];
  const policies: Array<{ path: string; before: string; after: string }> = [];
  const noOpKinds: Array<"enqueue-policy" | "edit-data-fields"> = [];
  const changedNodes = new Set<string>();
  const currentEditDataFields = workflow.nodes.flatMap((node) => node.editableFields.map((field) => ({
    nodeId: node.id,
    fieldPath: field.fieldPath,
    label: field.label,
  })));
  for (const change of changes) {
    if (change.kind === "enqueue-policy") {
      const before = EnqueuePolicySchema.parse(workflow.enqueue);
      if (before === change.value) {
        noOpKinds.push(change.kind);
        continue;
      }
      operations.push({
        propertyPath: "enqueue",
        beforeExpression: canonicalJsonStringify(before),
        afterExpression: canonicalJsonStringify(change.value),
      });
      policies.push({ path: "enqueue", before, after: change.value });
      continue;
    }
    const before = canonicalJsonStringify(currentEditDataFields);
    const after = canonicalJsonStringify(change.fields);
    if (before === after) {
      noOpKinds.push(change.kind);
      continue;
    }
    operations.push({
      propertyPath: "capabilities.editData.fields",
      beforeExpression: before,
      afterExpression: after,
    });
    policies.push({ path: "capabilities.editData.fields", before, after });
    for (const field of [...currentEditDataFields, ...change.fields]) changedNodes.add(String(field.nodeId));
  }
  if (operations.length === 0) return { state: "empty" };
  if (noOpKinds.length > 0) return { state: "partial-no-op", noOpKinds };
  const patchDocument = {
    patchVersion: 1 as const,
    workflowId: workflow.id,
    baseDescriptorVersion: workflow.version,
    baseContractFingerprint: workflow.contractFingerprint,
    changes,
  };
  const patch = ExplorerDescriptorPatchSchema.parse({
    ...patchDocument,
    canonicalDescriptorJson: canonicalJsonStringify(patchDocument),
    typescript: { sourcePath: descriptorSource.path, operations },
  });
  const policy = changes.some((change) => change.kind === "enqueue-policy");
  const editData = changes.some((change) => change.kind === "edit-data-fields");
  return {
    state: "brief",
    brief: ExplorerCodeChangeBriefSchema.parse({
    workflowId: workflow.id,
    reason: policy && editData
      ? "operational policy has no descriptor-declared allowlist and Edit Data changes correction authority; both remain reviewed source changes"
      : policy
        ? "operational policy has no descriptor-declared allowlist; it remains a reviewed source change"
        : "Edit Data changes runtime correction authority and remains a reviewed descriptor source change",
    requiredFiles: [descriptorSource.path],
    failedObligations: [
      "rebuild through defineWorkflow and compileWorkflow with the exact source patch",
      "re-derive every input, canonical-input, result and task schema hash",
      "re-derive the graph, edges and coverage points",
      "run workflow-editor-compile-integrity and the full architecture gate",
      "run every impacted executable scenario and scenario-coverage audit",
    ],
    baseAttestation: attestation,
    patch,
    semanticDiff: {
      presentation: [],
      nodes: { added: [], removed: [], changed: [...changedNodes].sort() },
      edges: { added: [], removed: [], changed: [] },
      effects: { added: [], removed: [] },
      policies,
      uiIds: { added: [], removed: [] },
      evidenceObligations: EVIDENCE_OBLIGATIONS,
    },
    impacts: {
      workflows: [workflow.id],
      tasks: attestation.checks.schema.tasks.map(({ taskId }) => taskId),
      scenarios: attestation.checks.scenario.registrations.map(({ scenarioId }) => scenarioId),
      sourceFiles: [descriptorSource.path],
    },
    nextDescriptor: {
      version: workflow.version + 1,
      contractFingerprint: { state: "must-change", current: workflow.contractFingerprint },
    },
      requiredChecks: REQUIRED_SOURCE_CHECKS,
    }),
  };
}

export function createExplorerEditService(deps: ExplorerEditServiceDeps): ExplorerEditService {
  const validate = (input: unknown, overrides: ExplorerOverrideReader = deps.overrides): ExplorerEditValidationResult => {
    const draft = ExplorerEditDraftSchema.parse(input);
    // This is the real compile-integrity path, not a descriptor-shaped fixture.
    const explorer = buildWorkflowExplorer({ ...deps.explorer, overrides });
    const workflow = explorer.workflows.find(({ id }) => String(id) === String(draft.workflowId));
    if (workflow === undefined) {
      return ExplorerEditValidationResultSchema.parse({
        state: "refused",
        category: "new-workflow-authoring",
        message: `workflow ${String(draft.workflowId)} is not registered; Explorer safe edit cannot author a new workflow`,
      });
    }
    const current = overrides.read(String(draft.workflowId));
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

    const duplicateKeys = draft.changes.map((change) => change.kind);
    if (new Set(duplicateKeys).size !== duplicateKeys.length) {
      return ExplorerEditValidationResultSchema.parse({
        state: "refused",
        category: "duplicate-change",
        message: `workflow ${String(draft.workflowId)} draft repeats a change target`,
      });
    }
    const presentationChanges = draft.changes.filter(
      (change) => change.kind === "workflow-label"
        || change.kind === "workflow-icon"
        || change.kind === "workflow-category",
    );
    const codeChange = draft.changes.filter(
      (change) => change.kind === "enqueue-policy" || change.kind === "edit-data-fields",
    );
    const compileAttestation = buildExplorerCompileAttestation(deps.explorer, workflow);

    const descriptorSource = workflow.sources.descriptor;
    if (descriptorSource.state !== "resolved") {
      throw new Error(
        `workflow ${String(draft.workflowId)} descriptor source is unresolved: ${descriptorSource.reason}`,
      );
    }
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
    if (presentationChanges.length > 0 && codeChange.length > 0) {
      return ExplorerEditValidationResultSchema.parse({
        state: "refused",
        category: "mixed-apply-levels",
        message: `workflow ${String(draft.workflowId)} mixes hot-apply presentation and reviewed source changes; review them as separate atomic drafts`,
      });
    }
    if (codeChange.length > 0) {
      const result = codeChangeBrief(draft, workflow, compileAttestation);
      if (result.state === "empty") {
        return ExplorerEditValidationResultSchema.parse({
          state: "refused",
          category: "empty-diff",
          message: `workflow ${String(draft.workflowId)} draft changes no source-owned value`,
        });
      }
      if (result.state === "partial-no-op") {
        return ExplorerEditValidationResultSchema.parse({
          state: "refused",
          category: "partial-no-op",
          message: `workflow ${String(draft.workflowId)} source draft target(s) ${result.noOpKinds.join(", ")} make no effective source change; preserve the reviewed draft by removing or changing those targets before validation`,
        });
      }
      return ExplorerEditValidationResultSchema.parse({
        state: "code-change-required",
        brief: result.brief,
      });
    }

    let label = current?.presentation.label;
    let icon = current?.presentation.icon;
    let category = current?.presentation.category;
    const semanticDiff: { path: string; before: string; after: string }[] = [];
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
      },
    });
    return ExplorerEditValidationResultSchema.parse({
      state: "ready-to-apply",
      draft,
      override,
      semanticDiff,
      impactedTasks: workflow.nodes.flatMap((node) => node.tasks.map((task) => task.taskId)),
      impactedScenarios: workflow.scenarios.map(({ scenarioId }) => scenarioId),
      compileAttestation,
    });
  };

  return Object.freeze({
    validate,
    apply(input: unknown, repositories: Pick<AuthorityRepositories, "explorerOverrides">): ExplorerEditExecution {
      const request = ExplorerEditApplyRequestSchema.parse(input);
      const overrides = repositories.explorerOverrides;
      const draft = ExplorerEditDraftSchema.parse({
        draftVersion: 1,
        workflowId: request.target.workflowId,
        baseDescriptorVersion: request.target.expectedVersion,
        baseContractFingerprint: request.target.contractFingerprint,
        baseOverrideRevision: request.target.expectedOverrideRevision,
        changes: request.payload.changes,
      });
      const commandFingerprint = explorerEditCommandFingerprint(request);
      const validation = validate(draft, overrides);
      if (validation.state !== "ready-to-apply") {
        return Object.freeze({ result: ExplorerEditApplyResultSchema.parse(validation) });
      }
      const override = ExplorerWorkflowOverrideSchema.parse({
        ...validation.override,
        appliedCommandId: request.commandId,
        commandFingerprint,
      });
      let committed: ExplorerWorkflowOverride;
      try {
        committed = overrides.replace(request, override);
      } catch (error) {
        if (!(error instanceof ExplorerOverrideConflictError)) throw error;
        const workflow = buildWorkflowExplorer(deps.explorer).workflows.find(
          ({ id }) => String(id) === String(validation.draft.workflowId),
        );
        if (workflow === undefined) {
          throw new Error(
            `workflow ${String(validation.draft.workflowId)} vanished while reporting override conflict`,
            { cause: error },
          );
        }
        return Object.freeze({
          result: ExplorerEditApplyResultSchema.parse({
            state: "conflict",
            conflict: "override-revision",
            message: error.message,
            currentDescriptorVersion: workflow.version,
            currentContractFingerprint: workflow.contractFingerprint,
            currentOverrideRevision: error.currentRevision,
          }),
        });
      }
      const result = ExplorerEditApplyResultSchema.parse({
        state: "applied",
        override: committed,
        readback: committed,
      });
      return Object.freeze({ result });
    },
  });
}
