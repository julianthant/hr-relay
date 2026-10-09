
import {
  WORKFLOW_MODULES,
  readPendingImplBindings,
} from "../../../src/backend/app/registries/workflow-registry.js";
import type { Clock } from "../../../src/rules/time/clock.js";
import type { Fingerprint } from "../../../src/rules/identity/ids.js";
import {
  EXPLORER_SOURCE_ROOT,
  type ExplorerQueryDeps,
} from "../../../src/backend/runs/queries/explorer.js";
import { buildUiTaskLinks } from "../../../src/backend/systems/ui-task-links.js";

/** The same anchor production uses, so a harness cannot read a different tree. */
const REPO_ROOT = EXPLORER_SOURCE_ROOT;

/** Test-only scenario text for registered definitions; no executable corpus is implied. */
export function registeredScenarioFixtureSources(): readonly Readonly<{ path: string; text: string }>[] {
  return [];
}

export function explorerQueryDeps(
  clock: Clock,
  descriptorSetHash: Fingerprint,
): ExplorerQueryDeps {
  return {
    clock,
    modules: WORKFLOW_MODULES,
    descriptorSetHash,
    pendingImplBindings: readPendingImplBindings(REPO_ROOT),
    uiTaskLinks: buildUiTaskLinks(),
    listScenarioSources: registeredScenarioFixtureSources,
  };
}
