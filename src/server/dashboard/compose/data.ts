import { createDataQueries } from "../queries/data.js";
import type { RunDetailQueryDeps } from "../queries/run-detail-types.js";

/** Each composition supplies its own explicit query backing. */
export function composeDataQueries(deps: RunDetailQueryDeps) { return createDataQueries(deps); }
