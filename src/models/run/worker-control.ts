import { z } from "zod";
import { bindErrorOrigin } from "../failures/error-origins.js";
import { BrowserSessionIdSchema, BrowserSystemIdSchema, FingerprintSchema, IsoInstantSchema, PositiveIntSchema, WorkerIdSchema } from "../../rules/identity/ids.js";

/** Current observations come from the resource owner, never inferred from an open span. */
export const WorkerBrowserObservationSchema = z.strictObject({
  workerId: WorkerIdSchema,
  sessionId: BrowserSessionIdSchema,
  system: BrowserSystemIdSchema,
  instance: z.string().min(1).optional(),
  configFingerprint: FingerprintSchema,
  signInFingerprint: FingerprintSchema,
  browserMode: z.enum(["headed", "headless"]),
  profileDirectory: z.string().min(1).optional(),
  acceptDownloads: z.boolean(),
  exclusive: z.boolean(),
  health: z.enum(["starting", "authenticated", "unknown", "failed", "closed"]),
  observedAt: IsoInstantSchema,
  openedAt: IsoInstantSchema,
  profileRevision: PositiveIntSchema,
});
export type WorkerBrowserObservation = z.infer<typeof WorkerBrowserObservationSchema>;

export class WorkerControlRefusal extends Error {
  override readonly name = "WorkerControlRefusal";
}
/** The worker lifecycle refusals a log row may name; any other refusal text stays unnamed. */
const NAMED_WORKER_REFUSALS: ReadonlySet<string> = new Set(["worker-start-failed", "worker-removal-child-close-unproved", "worker-execution-lost"]);
bindErrorOrigin(WorkerControlRefusal, error => ({ key: "worker-refusal", reason: NAMED_WORKER_REFUSALS.has(error.message) ? error.message : "cause-unavailable" }));
