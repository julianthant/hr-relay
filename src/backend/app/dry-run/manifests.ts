import { PERSON_LOOKUP_LIVE_READ } from "./person-lookup-manifest.js";

const WORKFLOWS_WITHOUT_SCENARIO_MANIFESTS = new Set([
  "separations",
  "separations-kuali-finalization",
]);

export class DryRunScenarioUnavailableError extends Error {
  readonly name = "DryRunScenarioUnavailableError";

  constructor(workflow: string) {
    super(`dry-run scenario manifest unavailable for ${workflow}`);
  }
}

export function listDryRunScenarioWorkflows(): readonly string[] {
  return ["person-lookup"];
}

export function loadDryRunScenarioManifest(workflow: string): Promise<unknown> {
  if (workflow === "person-lookup") return Promise.resolve(PERSON_LOOKUP_LIVE_READ);
  if (WORKFLOWS_WITHOUT_SCENARIO_MANIFESTS.has(workflow)) {
    throw new DryRunScenarioUnavailableError(workflow);
  }
  throw new Error(`unknown dry-run scenario workflow ${workflow}; registered: ${listDryRunScenarioWorkflows().join(", ")}`);
}
