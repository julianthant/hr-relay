/**
 * CLI composition for one T1b dry-run case. Manifest loading and the ready
 * runtime are injected at the outer composition root: this server module never
 * imports `tests/**`, while the blocked path opens only v16 authority and the
 * checked-in target registry — no worker or browser service is constructed.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeIsolation } from "../../config/define-runtime-isolation.js";
import {
  parseDryRunScenarioArguments,
  runDryRunScenario,
  type DryRunScenarioRuntime,
} from "../../core/dry-run-scenario-runner.js";
import {
  readTestTargetRegistry,
  resolveSeparationsKualiFinalizationTestTarget,
} from "../../control/test-target-registry.js";
import { systemClock, type Clock } from "../../domain/clock.js";
import { systemIdFactory, type IdFactory } from "../../domain/identifiers.js";
import { configResolutionEnvironment } from "../../domain/secrets.js";
import { parseDryRunScenarioManifest } from "../../domain/trust/dry-run-scenario.js";
import { AuthorityDatabase } from "../../infra/sqlite/index.js";

export interface DryRunScenarioComposeInput {
  readonly isolation: RuntimeIsolation;
  readonly args: readonly string[];
  readonly loadManifest: (workflow: string) => Promise<unknown>;
  readonly createRuntime: (input: Readonly<{
    isolation: RuntimeIsolation;
    repoRoot: string;
    env: NodeJS.ProcessEnv;
    clock: Clock;
    ids: IdFactory;
  }>) => DryRunScenarioRuntime;
  readonly repoRoot?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly clock?: Clock;
  readonly ids?: IdFactory;
}

export async function composeDryRunScenarioCommand(
  input: DryRunScenarioComposeInput,
): Promise<{ readonly output: string; readonly exitCode: 0 | 1 | 2 }> {
  const args = parseDryRunScenarioArguments(input.args);
  const repoRoot = input.repoRoot ?? process.cwd();
  const env = input.env ?? configResolutionEnvironment();
  const clock = input.clock ?? systemClock;
  const ids = input.ids ?? systemIdFactory;
  const manifestInput = parseDryRunScenarioManifest(await input.loadManifest(args.workflow));
  const registry = readTestTargetRegistry(repoRoot, [manifestInput]);
  const stateRoot = join(repoRoot, input.isolation.stateRoot);
  mkdirSync(stateRoot, { recursive: true });
  const database = AuthorityDatabase.open(
    { path: join(stateRoot, "state.db"), busyTimeoutMs: 5000, migrationOwner: "dry-run-scenario" },
    clock,
  );
  try {
    const outcome = await runDryRunScenario({
      args,
      loadManifest: () => Promise.resolve(manifestInput),
      resolveTarget: (manifest, subjectLabel) => {
        if (manifest.workflow !== "separations-kuali-finalization") {
          throw new Error(`dry-run target resolution does not support workflow ${manifest.workflow}`);
        }
        return resolveSeparationsKualiFinalizationTestTarget(registry, subjectLabel, env);
      },
      persistResult: (result) => {
        database.authority.dryRunScenarioResults.insert(result);
      },
      createRuntime: () => input.createRuntime({
        isolation: input.isolation,
        repoRoot,
        env,
        clock,
        ids,
      }),
      clock,
      ids,
    });
    return Object.freeze({ output: outcome.output, exitCode: outcome.exitCode });
  } finally {
    database.close();
  }
}
