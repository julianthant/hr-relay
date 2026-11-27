import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import type { StartPlanRecord } from "../../../models/run/start-plan.js";
import { PreflightAdmissionRefusal } from "../../../rules/preflight/preflight-admission.js";
import { workflowPlanning, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";

export function assertOcrStartReady(descriptor: AnyWorkflowDescriptor, plan: Pick<StartPlanRecord, "planned" | "rerun">, available: (() => boolean) | undefined): void {
  if (available === undefined || plan.rerun?.continuation !== undefined) return;
  const { requiresOcrProvider } = workflowPlanning(descriptor);
  const requiresOcr = plan.planned.some(({ input }) => requiresOcrProvider(input.value));
  if (requiresOcr && !available()) throw new PreflightAdmissionRefusal("blocked", ERROR_CATALOG.PROVIDER_UNAVAILABLE.text);
}
