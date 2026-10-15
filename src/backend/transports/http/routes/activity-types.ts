import type { ActivitySelectionService } from "../../../runs/queries/activity-selection.js";
import type { ActivityPopulationService } from "../../../runs/queries/activity-population.js";
export interface ActivityRouteDeps {
  readonly activity: ActivitySelectionService;
  readonly activityPopulation: ActivityPopulationService;
}
