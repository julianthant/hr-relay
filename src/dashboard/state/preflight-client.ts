import type { PreflightQueries } from "../client/preflight-queries.js";
import { useDashboardClient } from "./client-context.js";
export function usePreflightClient(): PreflightQueries { return useDashboardClient(); }
