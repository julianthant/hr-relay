import { z } from "zod";
import { TimelineEventRecordSchema, TimelinePageRequestSchema } from "../../../models/events/timeline.js";
import { BrowserSystemIdSchema, FingerprintSchema, IsoInstantSchema, PositiveIntSchema, RunSessionIdSchema,
  WorkerIdSchema, WorkflowIdSchema } from "../../../rules/identity/ids.js";
import type { AuthorityDatabase } from "./authority-database.js";
import { createDashboardSnapshotQuery } from "./authority-dashboard-snapshot.js";
import { defineLaneRead, ReadLaneRestartedError, type DashboardReadLanes } from "./dashboard-read-host.js";
import { openReadOnlyDatabase } from "./readonly-authority-snapshot.js";

const WorkerCursorSchema = z.strictObject({ offset: PositiveIntSchema, digest: FingerprintSchema });
const RequestSchema = TimelinePageRequestSchema.pick({ after: true, through: true, limit: true, spanTypes: true })
  .extend({ nowMs: z.number().int(), workerCursor: WorkerCursorSchema.optional() });
export type DashboardBackgroundReadRequest = z.output<typeof RequestSchema>;

const ResultSchema = z.strictObject({
  records: z.array(TimelineEventRecordSchema).max(1000), cursor: z.number().int().nonnegative(), through: z.number().int().nonnegative(),
  workers: z.strictObject({ fingerprint: FingerprintSchema, next: WorkerCursorSchema.nullable(), slotWorkflows: z.array(WorkflowIdSchema).max(1000),
    batchVersions: z.array(z.strictObject({ sessionId: RunSessionIdSchema, version: PositiveIntSchema })).max(1000),
    heldDuoLeases: z.array(z.strictObject({ workerId: WorkerIdSchema, system: BrowserSystemIdSchema, since: IsoInstantSchema, expiresAt: IsoInstantSchema })).max(1000) }),
});
/** cursor resumes the timeline through its captured high water. workers.next resumes the same durable facts. */
export type DashboardBackgroundReadResult = z.infer<typeof ResultSchema>;

/** One native connection per lane validates peer commits and captures a page and its reconciliation facts together. */
const snapshotQueries = new WeakMap<AuthorityDatabase, ReturnType<typeof createDashboardSnapshotQuery>>();

/**
 * Timeline pages and worker facts, read in the navigation lane. Archive rows come from the lane's history reader below the
 * logical cursor offset; native rows and worker facts come from one native snapshot, shifted by that offset.
 */
const dashboardTimelinePage = defineLaneRead(import.meta.url, "dashboard-timeline-page", {
  lane: "navigation", priority: "background", args: RequestSchema,
  run(context, request) {
    let query = snapshotQueries.get(context.native);
    if (query === undefined) {
      const connection = openReadOnlyDatabase(context.start.path, 250);
      connection.exec("PRAGMA query_only=ON");
      context.retain({ close: () => { connection.close(); }, inTransaction: () => connection.isOpen && connection.isTransaction });
      query = createDashboardSnapshotQuery(connection, context.start.binding);
      snapshotQueries.set(context.native, query);
    }
    const offset = context.start.cursorOffset;
    if (offset === 0) return query(request);
    const nativeCursor = (cursor: number) => Math.max(0, cursor - offset);
    if (request.through !== undefined && request.after > request.through) throw new Error("timeline-cursor-reset-required");
    const archive = request.after < offset ? context.history.authority.timelineEvents.page({ after: request.after,
      through: Math.min(request.through ?? offset, offset), limit: request.limit, spanTypes: request.spanTypes }) : [];
    const throughNative = request.through === undefined ? undefined : nativeCursor(request.through);
    // A full archive page needs worker facts and a valid high water, but no native rows.
    const page = query({ ...request, through: throughNative,
      after: archive.length === request.limit && throughNative !== undefined ? throughNative : nativeCursor(request.after) });
    const through = request.through ?? page.through + offset;
    const records = [...archive, ...page.records.slice(0, request.limit - archive.length)
      .map(record => ({ ...record, cursor: PositiveIntSchema.parse(record.cursor + offset) }))];
    const cursor = records.length === request.limit ? records[records.length - 1].cursor : through;
    return { ...page, records, cursor, through };
  },
});

/** #484's background reader on the navigation lane: one page per request, abandoned when the caller's signal aborts. */
export function createDashboardBackgroundReader(lanes: DashboardReadLanes) {
  return {
    async read(input: DashboardBackgroundReadRequest, signal?: AbortSignal): Promise<DashboardBackgroundReadResult> {
      let reply;
      try { reply = await lanes.read(dashboardTimelinePage, RequestSchema.parse(input), signal === undefined ? {} : { signal }); }
      catch (error) {
        if (!(error instanceof ReadLaneRestartedError)) throw error;
        const cause: unknown = error.cause;
        throw new Error(`dashboard-background-worker-exited: ${cause instanceof Error ? cause.message : "unknown"}`, { cause: error });
      }
      return ResultSchema.parse(JSON.parse(reply.body));
    },
  };
}
