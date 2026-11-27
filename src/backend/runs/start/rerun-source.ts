import type { RunRecord } from "../../../models/run/record.js";
import type { RerunPlanRefusalCode } from "../../../models/run/rerun.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-repositories.js";

export class RerunRefusedError extends Error {
  constructor(readonly code: RerunPlanRefusalCode, message: string) {
    super(message); this.name = "RerunRefusedError";
  }
}

export function validateRerunSourcePlan(repositories: AuthorityRepositories, run: RunRecord): void {
  if (run.sessionId === undefined) return;
  const session = repositories.runSessions.get(run.sessionId);
  if (session === undefined || session.workflow !== run.envelope.workflow) {
    throw new RerunRefusedError("schema-mismatch", "Rerun source session is missing or mismatched");
  }
  if (session.origin.kind !== "start-plan") return;
  const plan = repositories.startPlans.get(session.origin.startPlanId);
  if (plan === undefined || plan.workflowId !== run.envelope.workflow || plan.plannedBy !== session.origin.actorId
    || plan.descriptorVersion !== run.envelope.descriptorVersion || plan.descriptorFingerprint !== run.envelope.contractFingerprint
    || plan.configSnapshotId !== run.envelope.configSnapshotId || plan.configFingerprint !== run.envelope.configFingerprint
    || plan.consumedBy?.consumedAt !== session.startedAt
    || !plan.planned.some(entry => entry.itemId === run.envelope.itemId)) {
    throw new RerunRefusedError("schema-mismatch", "Rerun source start plan is missing or mismatched");
  }
}
