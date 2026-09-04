import type { Clock } from "../../domain/clock.js";
import { systemClock } from "../../domain/clock.js";
import type { PreflightRunner, PreflightRunnerContext } from "../../domain/preflight.js";
import { PreflightObservationSchema } from "../../domain/preflight.js";
import { PreflightCheckIdSchema } from "../../domain/preflight-contract.js";
import {
  doctorAuthorityStorage,
  StorageDoctorOptionsSchema,
} from "./storage-doctor.js";

export class AuthorityHealthPreflightRunner implements PreflightRunner {
  readonly check = PreflightCheckIdSchema.parse("authority.health");
  readonly kind = "io" as const;
  #options: ReturnType<typeof StorageDoctorOptionsSchema.parse>;
  #clock: Clock;

  constructor(input: unknown, clock: Clock = systemClock) {
    this.#options = StorageDoctorOptionsSchema.parse(input);
    this.#clock = clock;
  }

  async run(context: PreflightRunnerContext) {
    if (context.signal.aborted) throw new Error("authority.health preflight was aborted before inspection");
    const report = await doctorAuthorityStorage(this.#options, this.#clock);
    if (context.signal.aborted) throw new Error("authority.health preflight was aborted during inspection");
    // D322: the backup arm is REPORTED, never gated — a backup exists only after
    // `cli storage backup`, so its absence is the operator's choice, not a fault.
    if (report.authority.state === "healthy"
      && report.spanAuthority.state === "reconciled") {
      const backupState = report.backup.state === "current" || report.backup.state === "stale"
        ? `${report.backup.state} verified backup at generation ${String(report.backup.latest.authorityGeneration)}`
        : `backup ${report.backup.state}`;
      return PreflightObservationSchema.parse({
        check: this.check,
        state: "healthy",
        summary: `authority schema ${String(report.authority.inspection.schemaVersion)}, ${backupState}, `
          + `and ${String(report.spanAuthority.streamRunCount)} span run(s) are reconciled`
          + ` (${String(report.spanAuthority.archived.length)} archived, ${String(report.spanAuthority.deleted.length)} deleted)`,
      });
    }
    const authorityState = report.authority.state === "healthy"
      ? "authority database inspection passed"
      : `authority database is degraded (${report.authority.cause.code})`;
    const spanState = report.spanAuthority.state === "unavailable"
      ? `unavailable (${report.spanAuthority.cause.code})`
      : report.spanAuthority.state;
    return PreflightObservationSchema.parse({
      check: this.check,
      state: "unhealthy",
      summary: `${authorityState}; backup state is ${report.backup.state}; span authority is ${spanState}`,
      impact: "authority mutations remain blocked until storage health and exact span authority reconcile",
    });
  }
}
