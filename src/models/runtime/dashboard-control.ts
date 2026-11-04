import { z } from "zod";

export const DashboardStopSchema = z.strictObject({ type: z.literal("relay-dashboard-stop") });
export const DashboardStoppedSchema = z.strictObject({
  type: z.literal("relay-dashboard-stopped"),
  state: z.enum(["clean", "backup-unavailable"]),
});
