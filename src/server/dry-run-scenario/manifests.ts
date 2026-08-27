/**
 * The one production registration surface from a workflow id to its T1b
 * manifest loader (ref guards-and-tests §10.9). `src/cli.ts` calls
 * `loadDryRunScenarioManifest` rather than carrying this map itself, and
 * `tests/unit/architecture/test-target-registry.test.ts` reads THIS file's
 * own source to prove the layout's manifests are registered here in both
 * directions — a stray manifest under `tests/scenario/workflows/*` with no
 * entry here, or an entry here that outlives its manifest, is red.
 *
 * A `Map`, never a plain object literal: `manifests[workflow]` on an object
 * resolves PROTOTYPE keys too — `manifests["constructor"]` returns `Object`,
 * so an unknown-but-inherited key would silently "load" instead of failing
 * loud. A `Map` has no such surface; `.get` on any key not explicitly `.set`
 * always returns `undefined`.
 *
 * The executable declarations intentionally remain under `tests/scenario`
 * and are loaded only from this outer composition root. No production module
 * statically depends on a test module, and Vitest still cannot collect these
 * non-test files (they carry no `.test.` segment).
 */
const DRY_RUN_SCENARIO_MANIFEST_LOADERS: ReadonlyMap<string, () => Promise<unknown>> = new Map([
  ["separations", async () => (await import(
    "../../../tests/scenario/workflows/separations/dry-run.scenario.js"
  )).SEPARATIONS_DRY_RUN],
  ["separations-kuali-finalization", async () => (await import(
    "../../../tests/scenario/workflows/separations-kuali-finalization/dry-run.scenario.js"
  )).SEPARATIONS_KUALI_FINALIZATION_DRY_RUN],
]);

/** Every workflow this build can load a T1b manifest for, sorted. */
export function listDryRunScenarioWorkflows(): readonly string[] {
  return [...DRY_RUN_SCENARIO_MANIFEST_LOADERS.keys()].sort();
}

/**
 * Load the named workflow's T1b manifest, or fail loud naming both the
 * unknown workflow and every workflow actually registered.
 */
export function loadDryRunScenarioManifest(workflow: string): Promise<unknown> {
  const load = DRY_RUN_SCENARIO_MANIFEST_LOADERS.get(workflow);
  if (load === undefined) {
    throw new Error(
      `unknown dry-run scenario workflow ${workflow}; registered: ${listDryRunScenarioWorkflows().join(", ")}`,
    );
  }
  return load();
}
