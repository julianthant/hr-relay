import { z } from "zod";
import { StartCommandRequestSchema } from "../../rules/commands/commands.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";

const RecoverySchema = z.strictObject({ version: z.literal(1), command: StartCommandRequestSchema });
export type LaunchFinalCommand = z.infer<typeof StartCommandRequestSchema>;
const key = (actor: string) => `hrauto:run-launch:v1:${actor}`;

/** Only command identity and reviewed plan bindings; never raw values or source output. */
export function readLaunchRecovery(storage: Pick<Storage, "getItem">, actor: string): LaunchFinalCommand | null {
  const raw = storage.getItem(key(actor));
  if (raw === null) return null;
  try {
    const { command } = RecoverySchema.parse(JSON.parse(raw));
    if (command.requestedBy !== actor) throw new Error("actor mismatch");
    return command;
  } catch { throw new Error("RUN_LAUNCH_RECOVERY_INVALID: saved submission cannot be replayed; reconcile it before starting again."); }
}
export function retainLaunchFinal(storage: Pick<Storage, "getItem" | "setItem">, command: LaunchFinalCommand): void {
  const existing = readLaunchRecovery(storage, command.requestedBy);
  if (existing !== null && canonicalJsonStringify(existing) !== canonicalJsonStringify(command)) {
    throw new Error("RUN_LAUNCH_RECOVERY_PENDING: resolve the previous submission before starting another.");
  }
  storage.setItem(key(command.requestedBy), JSON.stringify(RecoverySchema.parse({ version: 1, command })));
  if (canonicalJsonStringify(readLaunchRecovery(storage, command.requestedBy)) !== canonicalJsonStringify(command)) {
    throw new Error("RUN_LAUNCH_RECOVERY_WRITE_FAILED");
  }
}
export function dismissLaunchRecovery(storage: Pick<Storage, "getItem" | "removeItem">, command: LaunchFinalCommand): void {
  const existing = readLaunchRecovery(storage, command.requestedBy);
  if (existing === null || canonicalJsonStringify(existing) !== canonicalJsonStringify(command)) throw new Error("RUN_LAUNCH_RECOVERY_MISMATCH");
  storage.removeItem(key(command.requestedBy));
}
