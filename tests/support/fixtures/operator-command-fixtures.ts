import assert from "node:assert/strict";
import { initialSettingsFileRecord } from "../../../src/models/config/settings.js";
import { hostConfigFacts } from "../../../src/models/config/host-display.js";
import { resolveConfigWithProvenance } from "../../../src/backend/app/config/resolve.js";
import { capturedInstantClock } from "../../../src/rules/time/clock.js";
import type { Clock } from "../../../src/rules/time/clock.js";
import type { CommandResult } from "../../../src/rules/commands/commands.js";
import type { AuthorityDatabase } from "../helpers/synthetic-storage-admission.js";
import { CONFIG_SNAPSHOT, NOW, UUID_4 } from "./phase1c-contract-fixtures.js";

/** Seed the synthetic authority that admits start-plan fan-out through RunRecordService. */
export function seedSyntheticRuntimeConfig(database: AuthorityDatabase, pair?: Parameters<typeof resolveConfigWithProvenance>[3]): void {
  seedInitialSettingsRuntimeConfig(database,capturedInstantClock(NOW), pair);
}

/** Initial settings and runtime activation share the same resolved document. */
export function seedInitialSettingsRuntimeConfig(database: AuthorityDatabase, clock: Clock, pair?: Parameters<typeof resolveConfigWithProvenance>[3]): void {
  const record = initialSettingsFileRecord();
  const resolved = resolveConfigWithProvenance(record.settings, hostConfigFacts({}), clock, pair);
  const snapshot = { ...CONFIG_SNAPSHOT, configSnapshotId: UUID_4, config: resolved.config,
    fingerprint: resolved.fingerprint, provenance: resolved.provenance, capturedAt: clock.now().toISOString() };
  const active = database.authority.runtimeConfig.initialize(snapshot);
  assert.equal(active.generation, 1);
}

/** Read lifecycle identities only from the authoritative command result. */
export function appliedRunIds(result: CommandResult): readonly string[] {
  assert.ok(result.state === "applied" || result.state === "already-applied");
  return result.affectedTargets.flatMap((target) => target.family === "run" ? [target.runId] : []);
}

export function singleAppliedRunId(result: CommandResult): string {
  const runIds = appliedRunIds(result);
  assert.equal(runIds.length, 1);
  const runId = runIds[0];
  assert.ok(runId !== undefined);
  return runId;
}
