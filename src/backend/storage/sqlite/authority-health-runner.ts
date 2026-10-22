import type { CredentialStore } from "../../../models/config/credential-store.js";
import type { Clock } from "../../../rules/time/clock.js";
import { systemClock } from "../../../rules/time/clock.js";
import type { PreflightRunner, PreflightRunnerContext } from "../../../models/preflight/preflight.js";
import { PreflightObservationSchema } from "../../../models/preflight/preflight.js";
import { PreflightCheckIdSchema } from "../../../models/preflight/preflight-contract.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import {
  doctorAuthorityStorage,
  StorageDoctorOptionsSchema,
} from "./storage-doctor.js";

export class AuthorityHealthPreflightRunner implements PreflightRunner {
  readonly check = PreflightCheckIdSchema.parse("authority.health");
  readonly kind = "io" as const;
  #options: ReturnType<typeof StorageDoctorOptionsSchema.parse>;
  #clock: Clock;
  #admission: RuntimeAdmission;
  #credentials: CredentialStore | undefined;

  constructor(admission: RuntimeAdmission, input: unknown, clock: Clock = systemClock, credentials?: CredentialStore) {
    this.#admission = admission;
    this.#credentials = credentials;
    this.#options = StorageDoctorOptionsSchema.parse(input);
    this.#clock = clock;
  }

  async run(context: PreflightRunnerContext) {
    if (context.signal.aborted) throw new Error("authority.health preflight was aborted before inspection");
    const report = await doctorAuthorityStorage(this.#admission, this.#options, this.#clock, this.#credentials);
    if (context.signal.aborted) throw new Error("authority.health preflight was aborted during inspection");
    const protectedSummary = report.protectedSettings.state === "available"
      ? report.protectedSettings.entries.map(({ name, present }) => `${name}=${present ? "present" : "absent"}`).join(", ")
      : report.protectedSettings.cause.summary;
    const latestUpgrade = report.authorityUpgrades.state === "available" ? report.authorityUpgrades.phases.at(-1) : undefined;
    const upgradeSummary = latestUpgrade === undefined
      ? `authority upgrade journal ${report.authorityUpgrades.state}`
      : `authority upgrade phase ${latestUpgrade.phase}`;
    const upgradeSettled = latestUpgrade?.phase === "baseline" || latestUpgrade?.phase === "settled";

    if (report.authority.state === "healthy"
      && report.spanAuthority.state === "reconciled"
      && report.protectedSettings.state === "available" && upgradeSettled) {
      const backupState = report.backup.state === "current" || report.backup.state === "stale"
        ? `${report.backup.state} verified backup at generation ${String(report.backup.latest.authorityGeneration)}`
        : `backup ${report.backup.state}`;
      return PreflightObservationSchema.parse({
        check: this.check,
        state: "healthy",
        summary: `authority schema ${String(report.authority.inspection.schemaVersion)}, ${backupState}, `
          + `and ${String(report.spanAuthority.streamRunCount)} span run(s) are reconciled`
          + ` (${String(report.spanAuthority.archived.length)} archived, ${String(report.spanAuthority.deleted.length)} deleted); ${protectedSummary}; ${upgradeSummary}`,
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
      summary: `${authorityState}; backup state is ${report.backup.state}; span authority is ${spanState}; ${protectedSummary}; ${upgradeSummary}`,
      impact: "authority mutations remain blocked until storage health and exact span authority reconcile",
    });
  }
}
