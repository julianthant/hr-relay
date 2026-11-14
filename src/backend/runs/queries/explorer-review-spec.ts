import type { ExplorerNodeWire } from "../../../models/dashboard/explorer.js";
import { ExplorerReviewSpecSchema, type ExplorerReviewDecision, type ExplorerReviewSpec } from "../../../models/dashboard/explorer-review-spec.js";
import { failureCodeFromTaskCode, operatorFailureSentence } from "../../../models/failures/error-catalog.js";
import { contractCollectionFieldOptions, contractSchemaLeavesForModes } from "../../../models/validation/contract-boundary.js";
import { WorkflowStepReviewSchema } from "../../../models/workflow/review-spec.js";
import { descriptorRuntimeNodes, workflowDryRunSupport } from "../../../workflow-kit/workflow.js";
import type { ExplorerModuleView } from "./explorer.js";

function runOptions(module: ExplorerModuleView): ExplorerReviewSpec["runOptions"] {
  const descriptor = module.descriptor;
  const inputRun = descriptor.surfaces.inputRun;
  const typed = inputRun?.typedInput;
  const upload = descriptor.surfaces.uploadRun;
  const controls: ExplorerReviewSpec["runOptions"]["controls"] = [];
  if (typed !== undefined) for (const control of typed.controls) {
    if (control.placement === "hidden") continue;
    const leaves = contractSchemaLeavesForModes(descriptor.input, typed.modeField, control.modes);
    const leaf = leaves.find(candidate => candidate.path === control.field);
    if (leaf === undefined) throw new Error(`workflow ${descriptor.id} review control names unknown input field ${control.field}`);
    controls.push({ ...control, placement: control.placement, kind: leaf.kind,
      ...(leaf.options === undefined ? {} : { options: [...leaf.options] }) });
  }
  const visibleFields = new Set(controls.map(control => control.field));
  return {
    start: { input: inputRun !== undefined, upload: upload !== undefined, emptyOpensUpload: inputRun?.emptyOpensUpload === true },
    supportsDryRun: workflowDryRunSupport(descriptor).state === "supported",
    omittableSteps: descriptor.stepOmissions.map(omission => {
      const step = descriptor.timeline.find(group => group.key === omission.step);
      if (step === undefined) throw new Error(`workflow ${descriptor.id} review omission names unknown step ${omission.step}`);
      return { stepKey: step.key, label: step.label, form: omission.form };
    }),
    ...(typed === undefined ? {} : { mode: { field: typed.modeField, label: typed.modeLabel, initial: typed.initialMode,
      options: typed.modes.map(mode => ({ value: mode.value, label: mode.label,
        defaults: mode.defaults.filter(field => visibleFields.has(field.field)) })) } }),
    controls,
    ...(upload === undefined ? {} : { upload: { fields: [...upload.fields], accepts: [...upload.accepts] } }),
  };
}

function sessionRequirements(module: ExplorerModuleView, modules: readonly ExplorerModuleView[]): ExplorerReviewSpec["sessionStep"] {
  const requirements: ExplorerReviewSpec["sessionStep"]["requirements"] = [];
  const unavailableDelegations: ExplorerReviewSpec["sessionStep"]["unavailableDelegations"] = [];
  const visit = (current: ExplorerModuleView, path: ExplorerReviewSpec["sessionStep"]["requirements"][number]["delegationPath"], ancestry: readonly string[]): void => {
    const workflowId = current.descriptor.id;
    if (ancestry.includes(workflowId)) throw new Error(`workflow ${workflowId} review session delegation cycle`);
    const nodes = descriptorRuntimeNodes(current.descriptor);
    for (const group of current.descriptor.timeline) for (const member of group.nodes) {
      const node = nodes.find(candidate => candidate.id === member.id);
      if (node === undefined) throw new Error(`workflow ${workflowId} review session names unknown node ${member.id}`);
      const contracts = node.kind === "task" ? [node.uses] : node.kind === "transaction" ? [node.prepare.uses, node.commit.uses] : [];
      for (const contract of contracts) for (const store of current.stores) for (const task of Object.values(store.tasks)) {
        if (task.contract !== contract || store.kind !== "browser") continue;
        for (const [index, need] of task.impl.sessions.entries()) {
          requirements.push({
            id: [...path.map(edge => `${edge.workflowId}/${edge.nodeId}`), `${workflowId}/${node.id}/${contract.id}/${index}`].join("/"),
            workflowId, stepKey: group.key, stepTitle: group.label, nodeId: node.id, taskId: contract.id, need,
            scope: path.length === 0 ? "direct" : "delegated",
            preparation: "before-owning-workflow-claim",
            useTiming: path.length === 0 ? "when-step-runs" : "when-delegated-step-runs",
            delegationPath: path, signIn: "required-by-declaration",
            lock: need.exclusive === true ? "exclusive-required" : "not-exclusive",
          });
        }
      }
      if (node.kind !== "child-run") continue;
      const child = modules.find(candidate => candidate.descriptor.id === node.target.id);
      if (child === undefined) {
        unavailableDelegations.push({ workflowId: node.target.id, nodeId: node.id,
          reason: "The delegated workflow is absent from this catalog; its browser requirements are unavailable." });
        continue;
      }
      visit(child, [...path, { workflowId, stepKey: group.key, nodeId: node.id }], [...ancestry, workflowId]);
    }
  };
  visit(module, [], []);
  return { id: "browser-sessions", title: "Open browser sessions", requirements, unavailableDelegations };
}

function decisions(node: ExplorerNodeWire, labels: readonly { nodeId: string; outcome: string; label: string }[]): ExplorerReviewDecision[] {
  const outcomes: ExplorerReviewDecision[] = [];
  const add = (outcome: string, action: ExplorerReviewDecision["action"], text: string): void => {
    outcomes.push({ id: `${node.id}/${outcome}`, nodeId: node.id,
      kind: node.shape.kind === "child-run" ? "delegation" : node.shape.kind,
      outcome, action, label: { state: "authored", text } });
  };
  switch (node.shape.kind) {
    case "task":
      add("succeeded", "continue", "The step finishes successfully; continue.");
      if (node.shape.dryRun === "stop-before-publish") add("dry-run", "continue", "Preview the prepared output without saving it.");
      if (node.shape.condition !== undefined) outcomes.push({ id: `${node.id}/skipped`, nodeId: node.id, kind: "condition",
        outcome: "skipped", action: "continue", label: { state: "authored", text: "This step does not apply; continue." } });
      break;
    case "branch":
      for (const branch of node.shape.cases) {
        const label = labels.find(candidate => candidate.nodeId === node.id && candidate.outcome === branch.name);
        outcomes.push({ id: `${node.id}/${branch.name}`, nodeId: node.id, kind: "branch", outcome: branch.name, action: "continue",
          label: label === undefined ? { state: "unavailable", reason: "This declared branch outcome has no operator label." }
            : { state: "authored", text: label.label } });
      }
      break;
    case "gate":
      add("waiting", node.shape.resolvedBy === "operator" ? "ask" : "continue", node.shape.resolvedBy === "operator"
        ? "Ask the operator to resolve this review before continuing." : "Wait for the required results, then continue automatically.");
      add("resolved", "continue", "The review is complete; continue.");
      if (node.shape.condition !== undefined) outcomes.push({ id: `${node.id}/skipped`, nodeId: node.id, kind: "condition",
        outcome: "skipped", action: "continue", label: { state: "authored", text: "This review does not apply; continue." } });
      break;
    case "child-run":
      add("dispatched", "continue", node.shape.await === "none" ? "Start the delegated work without waiting for its result." : "Start the delegated work and wait for its terminal result.");
      if (node.shape.await !== "none") {
        add("succeeded", "continue", "The delegated work succeeds; continue.");
        add("child-failed", node.shape.onChildFailed === "allow-partial" ? "continue" : node.shape.onChildFailed === "block-parent" ? "ask" : "stop",
          node.shape.onChildFailed === "allow-partial" ? "Keep the available results when delegated work fails."
            : node.shape.onChildFailed === "block-parent" ? "Hold this run for review when delegated work fails." : "Stop this run when delegated work fails.");
        add("child-retried", node.shape.afterChildRetry === "resume-parent" ? "continue" : "ask",
          node.shape.afterChildRetry === "resume-parent" ? "Resume this run after delegated work is retried." : "Ask the operator to resume after delegated work is retried.");
      }
      break;
    case "transaction":
      add("committed", "continue", "The save is confirmed; continue.");
      add("already-present", "continue", "The intended record is already confirmed; continue without saving again.");
      add("unknown", "ask", "The save is unconfirmed; park the write for operator review and do not retry it.");
      if (node.shape.dryRun === "stop-after-prepare") add("dry-run", "continue", "Preview the prepared change without saving it.");
      break;
    case "parallel":
      add("succeeded", "continue", "The parallel reads finish; continue.");
      add("failed", node.shape.join === "all-settled" ? "continue" : "stop", node.shape.join === "all-settled"
        ? "Wait for every parallel result, including failed reads, then continue." : "Stop if a parallel read fails.");
      break;
  }
  for (const task of node.tasks) for (const code of task.errorCodes) {
    const failureCode = failureCodeFromTaskCode(code);
    outcomes.push({ id: `${node.id}/${task.arm}/${code}`, nodeId: node.id, taskId: task.taskId, kind: "failure",
      outcome: code, action: "stop", failureCode, label: { state: "authored", text: operatorFailureSentence(failureCode) } });
  }
  return outcomes;
}

export function buildExplorerReviewSpec(module: ExplorerModuleView, modules: readonly ExplorerModuleView[], nodes: readonly ExplorerNodeWire[]): ExplorerReviewSpec {
  const runtimeNodes = descriptorRuntimeNodes(module.descriptor);
  const steps = module.descriptor.timeline.map(group => {
    const authored = module.definition?.steps.find(([candidate]) => candidate.key === group.key)?.[0].review;
    const review = authored === undefined ? undefined : WorkflowStepReviewSchema.parse(authored);
    return {
      id: group.key, title: group.label, ...(group.system === undefined ? {} : { system: group.system }),
      pages: review === undefined ? { state: "unavailable" as const, reason: "This step has no authored page review metadata." }
        : { state: "authored" as const, items: review.pages.map(page => ({ ...page, fields: page.fields.map(field => {
          if (!("operatorField" in field)) {
            if ("constant" in field) return { id: field.id, label: field.label,
              example: field.example ?? String(field.constant.value),
              sources: field.constant.nodeIds.map(nodeId => ({ nodeId, kind: "constant" as const, value: field.constant.value })), source: field.source };
            const sources = field.transactionFields.map(reference => {
              const node = runtimeNodes.find(node => node.id === reference.nodeId);
              if (node?.kind !== "transaction") throw new Error(`workflow ${module.descriptor.id} review field ${field.id} requires transaction source ${reference.nodeId}`);
              const options = contractCollectionFieldOptions(node.prepare.uses[reference.kind], reference.fieldPath,
                `workflow ${module.descriptor.id} review transaction field ${field.id} source ${reference.nodeId}`);
              return { binding: { ...reference, arm: "prepare" as const, taskId: node.prepare.uses.id }, options };
            });
            const options = field.display !== undefined ? field.display.cases.map(entry => entry.text)
              : sources.some(source => source.options === undefined) ? [] : [...new Set(sources.flatMap(source => source.options ?? []))];
            return { id: field.id, label: field.label, ...(field.example === undefined ? {} : { example: field.example }),
              ...(field.display === undefined ? {} : { display: field.display }), ...(options.length === 0 ? {} : { options }),
              sources: sources.map(source => source.binding), source: field.source };
          }
          const operator = group.operatorFields?.find(candidate => candidate.label === field.operatorField && candidate.visibility !== "logs");
          if (operator === undefined) throw new Error(`workflow ${module.descriptor.id} review field ${field.id} has no visible operator field ${field.operatorField}`);
          const sourceOptions = operator.sources.map(source => {
            const node = runtimeNodes.find(candidate => candidate.id === source.nodeId);
            if (node?.kind !== "task") throw new Error(`workflow ${module.descriptor.id} review field ${field.id} requires task source ${source.nodeId}`);
            return contractCollectionFieldOptions(node.uses[source.kind], source.fieldPath,
              `workflow ${module.descriptor.id} review field ${field.id} source ${source.nodeId}`);
          });
          const options = operator.display !== undefined ? operator.display.cases.map(entry => entry.text)
            : sourceOptions.some(options => options === undefined) ? [] : [...new Set(sourceOptions.flatMap(options => options ?? []))];
          return { id: field.id, label: operator.label, ...(operator.example === undefined ? {} : { example: operator.example }),
            ...(operator.display === undefined ? {} : { display: operator.display }),
            ...(options.length === 0 ? {} : { options }), sources: operator.sources, source: field.source };
        }) })) },
      decisions: group.nodes.flatMap(member => {
        const node = nodes.find(candidate => candidate.id === member.id);
        if (node === undefined) throw new Error(`workflow ${module.descriptor.id} review step ${group.key} names unknown node ${member.id}`);
        return decisions(node, review?.branchLabels ?? []);
      }),
    };
  });
  return ExplorerReviewSpecSchema.parse({ unlistedFailure: "Anything not listed stops the run with a failure card",
    runOptions: runOptions(module), sessionStep: sessionRequirements(module, modules), steps });
}
