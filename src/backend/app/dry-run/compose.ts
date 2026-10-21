
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeIsolation } from "../../../models/config/define-runtime-isolation.js";
import {
  parseDryRunScenarioArguments,
  runDryRunScenario,
  type DryRunScenarioRuntime,
  type DryRunScenarioTargetResolution,
} from "../../runs/start/dry-run-scenario-runner.js";
import {
  readTestTargetRegistry,
  resolvePersonLookupTestTarget,
  resolveSeparationsKualiFinalizationTestTarget,
  resolveSeparationsTestTarget,
  type TestTargetRegistry,
} from "../registries/test-target-registry.js";
import { createTestDataInputSource, testDataLocalPath } from "../registries/test-data.js";
import type { TestDataInputSource } from "../../../models/config/test-data.js";
import { systemClock, type Clock } from "../../../rules/time/clock.js";
import { systemIdFactory, type IdFactory } from "../../../rules/identity/identifiers.js";
import {
  assertNoMigratedEnvironmentKeys,
  hostAwareResolutionEnvironment,
} from "../../../models/config/secrets.js";
import { probePrimaryDisplay } from "../host/primary-display.js";
import {
  parseDryRunScenarioManifest,
  type DryRunScenarioManifest,
} from "../../../models/trust/dry-run-scenario.js";
import { AuthorityDatabase } from "../../storage/sqlite/index.js";
import { type RuntimeAdmission } from "../../storage/admission/admission.js";
import { requireRuntimeAdmission } from "../../storage/admission/admission-identity.js";


export function resolveDryRunScenarioTarget(
  registry: TestTargetRegistry,
  manifest: DryRunScenarioManifest,
  subjectLabel: string,
  testInputs: TestDataInputSource,
): DryRunScenarioTargetResolution {
  switch (manifest.workflow) {
    case "separations-kuali-finalization":
      return resolveSeparationsKualiFinalizationTestTarget(registry, subjectLabel);
    case "separations":
      return resolveSeparationsTestTarget(registry, subjectLabel, testInputs);
    case "person-lookup":
      return resolvePersonLookupTestTarget(registry, subjectLabel, testInputs);
    default:
      throw new Error(`dry-run target resolution does not support workflow ${manifest.workflow}`);
  }
}

export interface DryRunScenarioComposeInput {
  readonly admission?: RuntimeAdmission;
  readonly isolation: RuntimeIsolation;
  readonly args: readonly string[];
  readonly loadManifest: (workflow: string) => Promise<unknown>;
  readonly createRuntime: (input: Readonly<{
    isolation: RuntimeIsolation;
    admission?: RuntimeAdmission;
    repoRoot: string;
    env: NodeJS.ProcessEnv;
    clock: Clock;
    ids: IdFactory;
  }>) => DryRunScenarioRuntime;
  /** The exact checkout root whose `config/` owns the shared and private test data. */
  readonly repoRoot: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Test-only override of the private input capture; production reads `config/test-data.local.json`. */
  readonly testInputs?: TestDataInputSource;
  readonly clock?: Clock;
  readonly ids?: IdFactory;
}

export async function composeDryRunScenarioCommand(
  input: DryRunScenarioComposeInput,
): Promise<{ readonly output: string; readonly exitCode: 0 | 1 | 2 }> {
  const args = parseDryRunScenarioArguments(input.args);
  const repoRoot = input.repoRoot;
  const admission = requireRuntimeAdmission(input.admission);

  const env = input.env ?? hostAwareResolutionEnvironment(probePrimaryDisplay);
  assertNoMigratedEnvironmentKeys(env);
  const clock = input.clock ?? systemClock;
  const ids = input.ids ?? systemIdFactory;
  const manifestInput = parseDryRunScenarioManifest(await input.loadManifest(args.workflow));
  const registry = readTestTargetRegistry(repoRoot, [manifestInput]);
  const stateRoot = admission.stateRoot;
  mkdirSync(stateRoot, { recursive: true });
  const database = AuthorityDatabase.open(
    admission,
    { path: join(stateRoot, "state.db"), busyTimeoutMs: 5000, migrationOwner: "dry-run-scenario" },
    clock,
  );
  try {
    // One capture per start: the same source instance answers every read of this composition.
    const testInputs = input.testInputs ?? createTestDataInputSource(testDataLocalPath(repoRoot));
    const outcome = await runDryRunScenario({
      args,
      loadManifest: () => Promise.resolve(manifestInput),
      resolveTarget: (manifest, subjectLabel) =>
        resolveDryRunScenarioTarget(registry, manifest, subjectLabel, testInputs),
      persistResult: (result) => {
        database.authority.dryRunScenarioResults.insert(result);
      },
      createRuntime: () => input.createRuntime({
        isolation: input.isolation,
        admission,
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
