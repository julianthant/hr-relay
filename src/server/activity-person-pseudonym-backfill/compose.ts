import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { RuntimeIsolation } from "../../config/define-runtime-isolation.js";
import { systemClock, type Clock } from "../../domain/clock.js";
import { RunIdSchema } from "../../domain/ids.js";
import { assertNoMigratedEnvironmentKeys, requireActivityPersonPseudonymDomain } from "../../domain/secrets.js";
import { settingsRootPaths } from "../../domain/config/settings-root.js";
import {
  ActivityPersonPseudonymRunSetSchema,
} from "../../domain/trust/activity-person-pseudonym.js";
import {
  ActivityPersonPseudonymBackfillReportSchema,
  type ActivityPersonPseudonymBackfillReport,
} from "../../domain/trust/activity-person-pseudonym-backfill.js";
import { AuthorityDatabase } from "../../infra/sqlite/index.js";
import { createProtectedSettingsFileAuthority } from "../../infra/config/settings-file.js";
import { createJournaledProtectedSecretSource } from "../settings-runtime.js";
import { createActivityPersonPseudonymBackfillService } from "./service.js";

export const ACTIVITY_PERSON_PSEUDONYM_BACKFILL_USAGE =
  "usage: activity-person-pseudonyms backfill [--run <run-id> ...] [--json]";

const ActivityPersonPseudonymBackfillCommandOptionsSchema = z.strictObject({
  runIds: ActivityPersonPseudonymRunSetSchema,
  json: z.boolean(),
});

export const ActivityPersonPseudonymBackfillCommandOutcomeSchema = z.strictObject({
  output: z.string().min(1),
  exitCode: z.union([z.literal(0), z.literal(1), z.literal(2)]),
});

export type ActivityPersonPseudonymBackfillCommandOutcome = z.infer<
  typeof ActivityPersonPseudonymBackfillCommandOutcomeSchema
>;

function parseCommandArgs(args: readonly string[]): z.infer<
  typeof ActivityPersonPseudonymBackfillCommandOptionsSchema
> | undefined {
  if (args[0] !== "backfill") return undefined;
  const runIds: string[] = [];
  let json = false;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      if (json) return undefined;
      json = true;
      continue;
    }
    if (argument === "--run") {
      const runId = args[index + 1];
      if (runId === undefined) return undefined;
      const parsed = RunIdSchema.safeParse(runId);
      if (!parsed.success) return undefined;
      runIds.push(parsed.data);
      index += 1;
      continue;
    }
    return undefined;
  }
  const parsed = ActivityPersonPseudonymBackfillCommandOptionsSchema.safeParse({ runIds, json });
  return parsed.success ? parsed.data : undefined;
}

function formatReport(report: ActivityPersonPseudonymBackfillReport): string {
  const lines = [
    `activity person pseudonym backfill — ${report.keyGeneration}`,
    `examined ${String(report.counts.examined)} · inserted ${String(report.counts.inserted)} · `
      + `existing ${String(report.counts.existing)} · unavailable ${String(report.counts.unavailable)}`,
  ];
  for (const outcome of report.outcomes) {
    lines.push(outcome.state === "unavailable"
      ? `${outcome.runId} unavailable: ${outcome.reason}`
      : `${outcome.runId} ${outcome.state}: ${outcome.keyGeneration}`);
  }
  return lines.join("\n");
}

/**
 * D288's one reviewed mutation command. It opens the isolated authority,
 * derives only through the secret-holding pseudonym domain, and returns a
 * report whose strict schema has no identifier, key, or pseudonym field.
 */
export function composeActivityPersonPseudonymBackfillCommand(input: Readonly<{
  isolation: RuntimeIsolation;
  args: readonly string[];
  repoRoot?: string;
  clock?: Clock;
}>): ActivityPersonPseudonymBackfillCommandOutcome {
  assertNoMigratedEnvironmentKeys();
  const options = parseCommandArgs(input.args);
  if (options === undefined) {
    return ActivityPersonPseudonymBackfillCommandOutcomeSchema.parse({
      output: ACTIVITY_PERSON_PSEUDONYM_BACKFILL_USAGE,
      exitCode: 2,
    });
  }
  const repoRoot = resolve(input.repoRoot ?? resolve(import.meta.dirname, "../../.."));
  const stateRoot = join(repoRoot, input.isolation.stateRoot);
  const authorityPath = join(stateRoot, "state.db");
  if (!existsSync(authorityPath)) {
    throw new Error(`activity person pseudonym backfill authority is missing at ${authorityPath}`);
  }
  const database = AuthorityDatabase.open(
    {
      path: authorityPath,
      busyTimeoutMs: 5000,
      migrationOwner: "activity-person-pseudonym-backfill",
    },
    input.clock ?? systemClock,
  );
  try {
    const protectedAuthority = createProtectedSettingsFileAuthority({
      path: settingsRootPaths(stateRoot).ordinary,
      assertWriteIdAvailable: () => undefined,
    });
    const writeCapability = database.createActivityPersonPseudonymBackfillWriteCapability(
      requireActivityPersonPseudonymDomain(createJournaledProtectedSecretSource({ file: protectedAuthority, database })),
    );
    const service = createActivityPersonPseudonymBackfillService({
      authority: database.authority,
      writeCapability,
    });
    const report = ActivityPersonPseudonymBackfillReportSchema.parse(service.backfill(
      options.runIds.length === 0
        ? { scope: "current-separations" }
        : { scope: "selected-runs", runIds: options.runIds },
    ));
    return ActivityPersonPseudonymBackfillCommandOutcomeSchema.parse({
      output: options.json ? JSON.stringify(report) : formatReport(report),
      exitCode: report.counts.unavailable === 0 ? 0 : 1,
    });
  } finally {
    database.close();
  }
}
