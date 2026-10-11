import { z } from "zod";
export const DashboardErrorReportSchema = z.strictObject({
  reportId: z.uuid(), clientId: z.string().min(1).max(128), release: z.string().min(1).max(128),
  route: z.string().min(1).max(512), surface: z.string().min(1).max(128), code: z.string().min(1).max(128),
  message: z.string().max(32768), stack: z.string().max(32768).optional(),
});
export type DashboardErrorReport = z.infer<typeof DashboardErrorReportSchema>;
