import { z } from "zod";

const HttpStatusSchema = z.number().int().min(100).max(599);

export const DashboardFrontendProbeResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("dashboard"), status: HttpStatusSchema }),
  z.strictObject({
    state: z.literal("foreign"),
    reason: z.enum(["http-status", "document-marker-missing"]),
    status: HttpStatusSchema,
  }),
]);
export type DashboardFrontendProbeResult = z.infer<typeof DashboardFrontendProbeResultSchema>;

export interface DashboardFrontendProbe {
  inspect(input: Readonly<{ port: number; signal: AbortSignal }>): Promise<DashboardFrontendProbeResult>;
}

export type DashboardFrontendFetch = (
  url: string,
  init: Readonly<{ signal: AbortSignal }>,
) => Promise<Readonly<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>>;

/** The one owned loopback HTTP adapter for identifying the dashboard frontend. */
export function createDashboardFrontendHttpProbe(
  request: DashboardFrontendFetch = fetch,
): DashboardFrontendProbe {
  return Object.freeze({
    async inspect(input) {
      const port = z.number().int().positive().parse(input.port);
      const response = await request(`http://127.0.0.1:${String(port)}/`, { signal: input.signal });
      if (!response.ok) {
        return DashboardFrontendProbeResultSchema.parse({
          state: "foreign",
          reason: "http-status",
          status: response.status,
        });
      }
      const body = await response.text();
      return DashboardFrontendProbeResultSchema.parse(body.includes("<title>HR Automation — rebuild</title>")
        ? { state: "dashboard", status: response.status }
        : { state: "foreign", reason: "document-marker-missing", status: response.status });
    },
  });
}
