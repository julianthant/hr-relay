import { z } from "zod";
const RouteVersionSchema = z.strictObject({ major: z.number().int().positive(), minor: z.number().int().nonnegative() });
const ArchiveRouteFiltersSchema = z.strictObject({
  workflow: z.string().min(1).max(160).optional(), title: z.string().max(160).optional(),
  search: z.string().trim().min(1).max(120).optional(), capturedFrom: z.string().datetime().optional(),
  capturedTo: z.string().datetime().optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional(),
  descriptorVersion: z.string().max(120).optional(),
  outcome: z.enum(["done", "failed", "cancelled", "discarded", "interrupted", "superseded"]).optional(),
  dashboardVersion: RouteVersionSchema.optional(), workflowVersion: RouteVersionSchema.optional(),
  versionState: z.enum(["stamped", "adopted", "unrecorded"]).optional(),
});

const ArchiveBrowseStateSchema = z.strictObject({
  filters: ArchiveRouteFiltersSchema.default({}),
  after: z.strictObject({ completedAt: z.string().datetime(), runId: z.uuid() }).optional(),
  columns: z.array(z.string().min(1).max(1024)).max(100).refine(columns => new Set(columns).size === columns.length, "Duplicate Archive columns").optional(),
  section: z.number().int().min(0).max(1000).optional(),
}).superRefine((state, context) => {
  for (const [from, to] of [[state.filters.from, state.filters.to], [state.filters.capturedFrom, state.filters.capturedTo]]) {
    if (from !== undefined && to !== undefined && from > to) context.addIssue({ code: "custom", message: "Archive date range is reversed" });
  }
});
export type ArchiveBrowseState = z.infer<typeof ArchiveBrowseStateSchema>;
export function parseArchiveBrowse(value: string): ArchiveBrowseState | null {
  if (value.length > 24000) return null;
  try { const result = ArchiveBrowseStateSchema.safeParse(JSON.parse(value)); return result.success ? result.data : null; }
  catch { return null; }
}

const ArchiveFolderRouteSchema = z.strictObject({
  dashboardKey: z.string().max(40).regex(/^(?:unrecorded|[1-9]\d*\.\d+)$/u),
  workflow: z.string().min(1).max(160),
});
export function parseArchiveFolderRoute(dashboardKey: string, workflow: string) {
  const result = ArchiveFolderRouteSchema.safeParse({ dashboardKey, workflow });
  return result.success ? result.data : null;
}
