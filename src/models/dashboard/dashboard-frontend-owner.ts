import { z } from "zod";

/** Process-owned proof shared by the launcher, Vite middleware, and local probe adapter. */
export const DASHBOARD_LAUNCH_NONCE_ENV = "HRAUTO_DASHBOARD_LAUNCH_NONCE";
/** The one address the dev frontend binds and the owner probe fetches; `localhost` may resolve to ::1 first. */
export const DASHBOARD_FRONTEND_HOST = "127.0.0.1";
export const DASHBOARD_FRONTEND_OWNER_PATH = "/.well-known/hrauto-dashboard-owner";
export const DashboardLaunchNonceSchema = z.string().regex(/^[0-9a-f]{64}$/u);
