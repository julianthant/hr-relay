import { z } from "zod";
import { StartCommandRequestSchema } from "../../../rules/commands/commands.js";
import { StartPlanWireSchema, type StartPlanWire } from "../../../models/dashboard/start-plan.js";
import { StartSupersedeTargetsSchema } from "../../../models/run/start-supersede.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";

const VerificationPlanSchema = StartPlanWireSchema.pick({ startPlanId: true, workflowId: true, expectedVersion: true,
  plannedBy: true, fingerprints: true, dryRun: true }).extend({ planned: z.array(z.strictObject({ supersedeTargets: StartSupersedeTargetsSchema.optional() })) });
export type LaunchVerificationPlan = z.infer<typeof VerificationPlanSchema>;
const RecoverySchema = z.strictObject({ version: z.literal(1), command: StartCommandRequestSchema, plan: VerificationPlanSchema.optional() });
export type LaunchFinalCommand = z.infer<typeof StartCommandRequestSchema>;
const key = (actor: string) => `hrauto:run-launch:v1:${actor}`;

function requireMatchingPlan(command: LaunchFinalCommand, plan: LaunchVerificationPlan | undefined): void {
  if (plan !== undefined && (plan.startPlanId !== command.target.startPlanId || plan.workflowId !== command.target.workflowId
    || plan.expectedVersion !== command.target.expectedVersion || plan.plannedBy !== command.requestedBy
    || canonicalJsonStringify(plan.fingerprints) !== canonicalJsonStringify(command.payload))) throw new Error("RUN_LAUNCH_RECOVERY_INVALID");
}

/** Only command identity and reviewed plan bindings; never raw values or source output. */
export function readLaunchRecovery(storage: Pick<Storage, "getItem">, actor: string): LaunchFinalCommand | null {
  const raw = storage.getItem(key(actor));
  if (raw === null) return null;
  try {
    const { command, plan } = RecoverySchema.parse(JSON.parse(raw));
    requireMatchingPlan(command, plan);
    if (command.requestedBy !== actor) throw new Error("actor mismatch");
    return command;
  } catch { throw new Error("RUN_LAUNCH_RECOVERY_INVALID: saved submission cannot be replayed; reconcile it before starting again."); }
}
export function readLaunchVerificationPlan(storage: Pick<Storage, "getItem">, actor: string): LaunchVerificationPlan | undefined {
  const raw = storage.getItem(key(actor));
  if (raw === null) return undefined;
  readLaunchRecovery(storage, actor);
  const record = RecoverySchema.parse(JSON.parse(raw));
  requireMatchingPlan(record.command, record.plan);
  return record.plan;
}

export function retainLaunchFinal(storage: Pick<Storage, "getItem" | "setItem">, command: LaunchFinalCommand, plan?: StartPlanWire | LaunchVerificationPlan): void {
  const existing = readLaunchRecovery(storage, command.requestedBy);
  if (existing !== null && canonicalJsonStringify(existing) !== canonicalJsonStringify(command)) {
    throw new Error("RUN_LAUNCH_RECOVERY_PENDING: resolve the previous submission before starting another.");
  }
  const previousPlan = readLaunchVerificationPlan(storage, command.requestedBy);
  const verificationPlan = plan === undefined ? previousPlan : VerificationPlanSchema.parse({ startPlanId: plan.startPlanId, workflowId: plan.workflowId, expectedVersion: plan.expectedVersion,
    plannedBy: plan.plannedBy, fingerprints: plan.fingerprints, dryRun: plan.dryRun,
    planned: plan.planned.map(entry => ({ ...(entry.supersedeTargets === undefined ? {} : { supersedeTargets: entry.supersedeTargets }) })) });
  requireMatchingPlan(command, verificationPlan);
  if (previousPlan !== undefined && verificationPlan !== undefined && canonicalJsonStringify(previousPlan) !== canonicalJsonStringify(verificationPlan)) {
    throw new Error("RUN_LAUNCH_RECOVERY_MISMATCH");
  }
  storage.setItem(key(command.requestedBy), JSON.stringify(RecoverySchema.parse({ version: 1, command, ...(verificationPlan === undefined ? {} : { plan: verificationPlan }) })));
  if (canonicalJsonStringify(readLaunchVerificationPlan(storage, command.requestedBy) ?? null) !== canonicalJsonStringify(verificationPlan ?? null)) {
    throw new Error("RUN_LAUNCH_RECOVERY_WRITE_FAILED");
  }
  if (canonicalJsonStringify(readLaunchRecovery(storage, command.requestedBy)) !== canonicalJsonStringify(command)) {
    throw new Error("RUN_LAUNCH_RECOVERY_WRITE_FAILED");
  }
}
export function dismissLaunchRecovery(storage: Pick<Storage, "getItem" | "removeItem">, command: LaunchFinalCommand): void {
  const existing = readLaunchRecovery(storage, command.requestedBy);
  if (existing === null || canonicalJsonStringify(existing) !== canonicalJsonStringify(command)) throw new Error("RUN_LAUNCH_RECOVERY_MISMATCH");
  storage.removeItem(key(command.requestedBy));
}
