/**
 * CLI composition for one T1b dry-run case. Manifest loading and the ready
 * runtime are injected at the outer composition root: this server module never
 * imports `tests/**`, while the blocked path opens only v16 authority and the
 * checked-in target registry — no worker or browser service is constructed.
 *
 * D341: the subject's private input comes from ignored
 * `config/test-data.local.json`, captured once per start; protected Settings
 * (the credential store) are no longer opened here at all.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeIsolation } from "../../../config/define-runtime-isolation.js";
import {
  parseDryRunScenarioArguments,
  runDryRunScenario,
  type DryRunScenarioRuntime,
  type DryRunScenarioTargetResolution,
} from "../../runs/dry-run-scenario-runner.js";
import {
  readTestTargetRegistry,
  resolvePersonLookupTestTarget,
  resolveSeparationsKualiFinalizationTestTarget,
  resolveSeparationsTestTarget,
  type TestTargetRegistry,
} from "../control/test-target-registry.js";
import { createTestDataInputSource, testDataLocalPath } from "../control/test-data.js";
import type { TestDataInputSource } from "../../../domain/test-data.js";
import { systemClock, type Clock } from "../../../domain/clock.js";
import { systemIdFactory, type IdFactory } from "../../../domain/identifiers.js";
import {
  assertNoMigratedEnvironmentKeys,
  hostAwareResolutionEnvironment,
} from "../../../domain/secrets.js";
import { probePrimaryDisplay } from "../host/primary-display.js";
import {
  parseDryRunScenarioManifest,
  type DryRunScenarioManifest,
} from "../../../domain/trust/dry-run-scenario.js";
import { AuthorityDatabase } from "../../storage/sqlite/index.js";
import { requireRuntimeAdmission, type RuntimeAdmission } from "../../storage/admission/admission.js";

/**
 * One workflow, one resolver. The runner itself is workflow-generic — it reads
 * the descriptor and its dry-run support out of the registry — but turning a
 * LABEL into that workflow's canonical input is per-workflow work, because the
 * ingress shapes differ. A workflow with a registry arm and no resolver is a
 * half-wired seam, so it fails loud by name here rather than resolving to
 * something plausible.
 */
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
  // D324: the production environment carries the host's primary display as the `display` default.
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
