import { LoadingRegion } from "../shared/loading/loading.js";

/** The report while it loads: a busy region with nothing drawn. The report settles to its sections or to "No runs in this
 * period", so no guessed section stands in for either. */
export function ActivitySkeleton() {
  return <LoadingRegion label="Loading analytics report">{null}</LoadingRegion>;
}
