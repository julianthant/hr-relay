import { z } from "zod";

export const DASHBOARD_LAUNCH_NONCE_ENV = "HRAUTO_DASHBOARD_LAUNCH_NONCE";
export const DASHBOARD_FRONTEND_OWNER_PATH = "/.well-known/hrauto-dashboard-owner";
export const DashboardLaunchNonceSchema = z.string().regex(/^[0-9a-f]{64}$/u);
