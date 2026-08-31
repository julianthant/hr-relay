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
    if (report.authority.state === "healthy"
      && report.backup.state === "current"
      && report.spanAuthority.state === "reconciled") {
      return PreflightObservationSchema.parse({
        check: this.check,
        state: "healthy",
        summary: `authority schema ${String(report.authority.inspection.schemaVersion)}, verified backup generation `
          + `${String(report.backup.latest.authorityGeneration)}, and ${String(report.spanAuthority.streamRunCount)} span run(s) are reconciled`,
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
