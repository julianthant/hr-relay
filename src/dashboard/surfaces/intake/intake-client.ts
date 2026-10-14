import type { DashboardClient } from "../../client/index.js";
import { useDashboardClient } from "../../state/client-context.js";
/** The surface port is the provider's existing object; no per-render adapter or second client. */
export function useIntakeClient(): DashboardClient { return useDashboardClient(); }
