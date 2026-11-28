import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { chatGptOcrAvailable } from "../../../models/dashboard/chatgpt-account.js";
import type { RunContinuation } from "../../../models/run/continuation.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { StartPlanRecord } from "../../../models/run/start-plan.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { CheckpointExpectationSchema, loadCheckpoint } from "../../../models/workflow/checkpoint.js";
import { evaluateNodeCondition } from "../../../models/workflow/node-condition.js";
import { delegatedStepOmissions } from "../../../models/workflow/step-omission.js";
import { PreflightAdmissionRefusal } from "../../../rules/preflight/preflight-admission.js";
import { taskImplFingerprint } from "../../../workflow-kit/fingerprints.js";
import { descriptorRuntimeNodes, workflowDelegatedDescriptor, workflowPlanning, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import type { ChatGptAccountService } from "../../accounts/chatgpt-account-service.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-repositories.js";
import { captureRunContinuation, retainedCheckpoint, RunContinuationRefusedError } from "../../storage/sqlite/run-continuation.js";
import { applyStepOmissionInputs, bindSingleStartChild } from "./step-selection.js";

const OCR_EDGES: ReadonlySet<string> = new Set(["document-ocr", "i9-documents", "ocr-pages"]);

export function createOcrStartReadiness(account: Pick<ChatGptAccountService, "checkStatus" | "checkedModelAvailable">, model: string) {
  const ocrProviderAvailable = () => account.checkedModelAvailable(model);
  return {
    ocrProviderAvailable,
    async prepareOcrProvider(signal: AbortSignal): Promise<void> {
      const status = await account.checkStatus(AbortSignal.any([signal, AbortSignal.timeout(30_000)]), { fresh: true })
        .catch((cause: unknown) => { throw new PreflightAdmissionRefusal("unavailable", ERROR_CATALOG.PROVIDER_UNAVAILABLE.text, { cause }); });
      if (!chatGptOcrAvailable(status) || !ocrProviderAvailable()) throw new PreflightAdmissionRefusal("blocked", ERROR_CATALOG.PROVIDER_UNAVAILABLE.text);
    },
  };
}

function hasPendingExtraction(repositories: AuthorityRepositories, descriptor: AnyWorkflowDescriptor, run: RunRecord, continuation?: RunContinuation): boolean {
  if (descriptor.id !== run.envelope.workflow || descriptor.version !== run.envelope.descriptorVersion
    || descriptor.contractFingerprint !== run.envelope.contractFingerprint) throw new RunContinuationRefusedError("run-continuation-ocr-descriptor-mismatch");
  const nodes = descriptorRuntimeNodes(descriptor), input = run.input.parsed.value;
  const extraction = nodes.find(node => node.kind === "task" && node.uses.providers?.includes("ocr.extract"));
  if (extraction?.kind === "task") {
    if (extraction.when !== undefined && !evaluateNodeCondition(extraction.when, { input, outputs: {} })) return false;
    const reference = (continuation ?? captureRunContinuation(repositories, run)).checkpoints.find(row => row.nodeId === extraction.id);
    if (reference === undefined) return true;
    const checkpoint = retainedCheckpoint(repositories, run.envelope, reference);
    return checkpoint.assertion !== undefined || !loadCheckpoint(checkpoint, CheckpointExpectationSchema.parse({
      descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint,
      implFingerprint: taskImplFingerprint(extraction.uses), outputSchemaHash: deriveSchemaHash(extraction.uses.output, "output"),
    }), extraction.uses.output).found;
  }
  if (!workflowPlanning(descriptor).requiresOcrProvider(input)) return false;
  const groups = repositories.dependencies.groups(run.envelope.runId);
  const delegates = nodes.flatMap(node => node.kind === "child-run" && OCR_EDGES.has(node.edgeId) ? [node] : []);
  return delegates.length === 0 || delegates.some(node => {
    const retained = groups.find(({ group }) => group.invocation.nodeId === node.id && group.invocation.edgeId === node.edgeId);
    if (retained === undefined) return true;
    const target = workflowDelegatedDescriptor(descriptor, node.target.id);
    return retained.group.children.some(({ child, terminal }) => terminal?.state !== "satisfied" && terminal?.state !== "cancelled"
      && hasPendingExtraction(repositories, target, child));
  });
}

export function requiresOcrForStart(repositories: AuthorityRepositories, descriptor: AnyWorkflowDescriptor,
  plan: Pick<StartPlanRecord, "planned" | "rerun" | "stepOmissions">): boolean {
  const { requiresOcrProvider } = workflowPlanning(descriptor);
  const delegate = plan.stepOmissions === undefined ? undefined : descriptorRuntimeNodes(descriptor).find(node => node.kind === "child-run"
    && OCR_EDGES.has(node.edgeId) && plan.stepOmissions?.some(entry => entry.workflow === node.target.id));
  const target = delegate?.kind === "child-run" ? workflowDelegatedDescriptor(descriptor, delegate.target.id) : undefined;
  const omissions = target === undefined ? undefined : delegatedStepOmissions(plan.stepOmissions, target.id);
  const requiresOcr = plan.planned.some(({ input }) => {
    if (!requiresOcrProvider(input.value)) return false;
    if (target === undefined || !target.stepOmissions.some(spec => spec.bindInput !== undefined && omissions?.some(entry => entry.step === spec.step))) return true;
    const childInput = bindSingleStartChild(descriptor, target.id, input.value);
    return workflowPlanning(target).requiresOcrProvider(applyStepOmissionInputs(target, childInput, omissions));
  });
  if (!requiresOcr) return false;
  if (plan.rerun?.continuation === undefined) return true;
  const source = repositories.runs.get(plan.rerun.source.runId);
  if (source === undefined) throw new RunContinuationRefusedError("run-continuation-ocr-source-unavailable");
  return hasPendingExtraction(repositories, descriptor, source, plan.rerun.continuation);
}

export function assertOcrStartReady(repositories: AuthorityRepositories, descriptor: AnyWorkflowDescriptor,
  plan: Pick<StartPlanRecord, "planned" | "rerun" | "stepOmissions">, available: (() => boolean) | undefined): void {
  if (available !== undefined && requiresOcrForStart(repositories, descriptor, plan) && !available())
    throw new PreflightAdmissionRefusal("blocked", ERROR_CATALOG.PROVIDER_UNAVAILABLE.text);
}
