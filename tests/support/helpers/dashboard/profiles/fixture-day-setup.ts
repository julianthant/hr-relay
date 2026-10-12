import { CommandResultSchema, type CommandResult } from "../../../../../src/rules/commands/commands.js";
import type * as FixtureIdentityTypes from "../../../fixtures/dashboard/fixture-identity.js";


export function createFixtureDaySetup({ uuidOf }: {
  uuidOf: typeof FixtureIdentityTypes.uuidOf;
}) {
  const FIXTURE_COMMAND_RESULTS: Readonly<Record<"applied" | "conflict" | "rejected", CommandResult>> = Object.freeze({
    applied: CommandResultSchema.parse({
      state: "applied",
      commandId: uuidOf(920),
      affectedTargets: [{ family: "run", runId: uuidOf(910) }],
    }),
    conflict: CommandResultSchema.parse({
      state: "conflict",
      commandId: uuidOf(921),
      currentVersion: 2,
      message: "the row moved while you were looking at it; the fresh projection replaces it",
    }),
    rejected: CommandResultSchema.parse({
      state: "rejected",
      commandId: uuidOf(922),
      code: "policy-refused",
      message: "a cancelled run cannot be retried from this surface",
    }),
  });

  return { FIXTURE_COMMAND_RESULTS };
}
