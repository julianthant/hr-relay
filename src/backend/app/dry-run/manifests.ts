const WORKFLOWS_WITHOUT_SCENARIO_MANIFESTS = new Set([
  "person-lookup",
  "separations",
  "separations-kuali-finalization",
]);

export class DryRunScenarioUnavailableError extends Error {
  readonly name = "DryRunScenarioUnavailableError";

  constructor(workflow: string) {
    super(`dry-run scenario manifest unavailable for ${workflow}`);
  }
}

/** No T1b scenario manifest is present in this build. */
export function listDryRunScenarioWorkflows(): readonly string[] {
  return [];
}

export function loadDryRunScenarioManifest(workflow: string): Promise<unknown> {
  if (WORKFLOWS_WITHOUT_SCENARIO_MANIFESTS.has(workflow)) {
    throw new DryRunScenarioUnavailableError(workflow);
  }
  throw new Error(`unknown dry-run scenario workflow ${workflow}; registered: ${listDryRunScenarioWorkflows().join(", ")}`);
}
