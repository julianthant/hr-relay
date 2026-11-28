import { randomBytes } from "node:crypto";
import { z } from "zod";
import { ActivityPopulationError, createActivityPopulationService } from "../../../runs/queries/activity-population.js";
import { ActivityRangeSchema, ActivitySnapshotError } from "../../../runs/queries/activity-selection.js";
import { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import { defineLaneRead, type DashboardReadLanes } from "../../../storage/sqlite/dashboard-read-host.js";
import { createTransactionHistory } from "../../../storage/sqlite/transaction-history.js";
import type { Clock } from "../../../../rules/time/clock.js";
import { FingerprintSchema } from "../../../../rules/identity/ids.js";
import { ErrorCatalogCodeSchema, type ErrorCatalogCode } from "../../../../models/failures/error-catalog.js";
import { ActivityPopulationExportSchema } from "../../../../models/dashboard/activity-population.js";
import type { queryActivitySummaries } from "../../../runs/queries/activity-summaries.js";
import type { ActivityRouteDeps } from "../../../transports/http/routes/activity-types.js";
import { SERVER_REGISTRY } from "../../registries/workflow-registry.js";
import { activityDocumentOf } from "../../../runs/exports/operator-xlsx-export-service.js";
import { OperatorXlsxActivityDocumentSchema, OperatorXlsxActivityExportRequestSelectionSchema } from "../../../../models/dashboard/xlsx-export.js";

type ActivitySummaryDeps = Parameters<typeof queryActivitySummaries>[2];
type ActivityInput = ActivitySummaryDeps & { database: AuthorityDatabase; clock: Clock };
type LocalPopulation = ReturnType<typeof createActivityPopulationService>;
/** An Activity XLSX document collected from one proved authority generation. */
type LaneXlsx = { readActivityDocument: (selection: z.input<typeof OperatorXlsxActivityExportRequestSelectionSchema>) => Promise<z.output<typeof OperatorXlsxActivityDocumentSchema>> };
type LocalActivity = { activity: LocalPopulation["reports"]; activityPopulation: LocalPopulation; reports: LocalPopulation["reports"] };

const ActivityLaneRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("report"), from: z.string(), to: z.string() }),
  z.strictObject({ kind: z.literal("population"), range: z.unknown() }),
  z.strictObject({ kind: z.literal("population-selected"), range: z.unknown(), token: z.unknown(), browse: z.unknown().optional() }),
  z.strictObject({ kind: z.literal("population-export"), range: z.unknown(), token: z.unknown() }),
  z.strictObject({ kind: z.literal("xlsx-document"), selection: z.unknown() }),
]);
const codesWith = <Prefix extends string>(prefix: Prefix) => z.enum(ErrorCatalogCodeSchema.options.filter(
  (code): code is Extract<ErrorCatalogCode, `${Prefix}${string}`> => code.startsWith(prefix)));
const ActivityLaneReplySchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("served"), body: z.string() }),
  z.strictObject({ state: z.literal("snapshot-refused"), code: codesWith("ACTIVITY_SNAPSHOT_") }),
  z.strictObject({ state: z.literal("population-refused"), code: codesWith("ACTIVITY_POPULATION_") }),
]);

const lanePopulations = new WeakMap<AuthorityDatabase, {
  signingKey: string;
  sourceIdentity: string;
  clock: { nowMs: number };
  service: LocalPopulation;
}>();

/** Activity reads yield to navigation between pages while holding one authority generation. */
const activityLaneRead = defineLaneRead(import.meta.url, "activity", {
  lane: "navigation", priority: "background", sourceProof: "per-read",
  args: z.strictObject({ signingKey: FingerprintSchema, request: ActivityLaneRequestSchema }),
  *chunks({ history, nowMs, start }, { signingKey, request }): Generator<void, z.infer<typeof ActivityLaneReplySchema>, void> {
    let held = lanePopulations.get(history);
    if (held?.signingKey !== signingKey) {
      const sourceIdentity = AuthorityDatabase.sourceDatabaseIdentity({ kind: "profile", binding: start.binding });
      const clock = { nowMs };
      const service = createActivityPopulationService({ database: history,
        clock: { now: () => new Date(clock.nowMs), nowMs: () => clock.nowMs }, sourceIdentity,
        signingKey: Buffer.from(signingKey, "hex"), ledger: createTransactionHistory(history.authority),
        descriptors: { resolve: workflowId => SERVER_REGISTRY[workflowId]?.descriptor } });
      held = { signingKey, sourceIdentity, clock, service };
      lanePopulations.set(history, held);
    }
    held.clock.nowMs = nowMs;
    const { service, sourceIdentity } = held;
    try {
      let served: unknown;
      if (request.kind === "xlsx-document") {
        const selection = OperatorXlsxActivityExportRequestSelectionSchema.parse(request.selection);
        const report = yield* service.reports.readSelectedChunks(selection.from, selection.to, selection.snapshotToken);
        served = activityDocumentOf(sourceIdentity, report, selection);
      } else {
        served = request.kind === "report" ? yield* service.reports.readChunks(request.from, request.to)
          : request.kind === "population" ? yield* service.readChunks(request.range)
            : request.kind === "population-selected" ? yield* service.readSelectedChunks(request.range, request.token, request.browse)
              : yield* service.exportSelectedChunks(request.range, request.token);
      }
      yield;
      return { state: "served", body: JSON.stringify(served) };
    } catch (error) {
      if (error instanceof ActivitySnapshotError) return { state: "snapshot-refused", code: error.code };
      if (error instanceof ActivityPopulationError) return { state: "population-refused", code: error.code };
      throw error;
    }
  },
});

function laneActivity(lanes: Pick<DashboardReadLanes, "read">, key: Uint8Array): ActivityRouteDeps & LaneXlsx {
  const signingKey = FingerprintSchema.parse(Buffer.from(key).toString("hex"));
  const read = async (request: z.input<typeof ActivityLaneRequestSchema>): Promise<string> => {
    const reply = ActivityLaneReplySchema.parse(JSON.parse((await lanes.read(activityLaneRead, { signingKey, request })).body));
    if (reply.state === "snapshot-refused") throw new ActivitySnapshotError(reply.code);
    if (reply.state === "population-refused") throw new ActivityPopulationError(reply.code);
    return reply.body;
  };
  return {
    activity: {
      read: (from, to) => { ActivityRangeSchema.parse({ from, to }); return read({ kind: "report", from, to }); },
    },
    activityPopulation: {
      read: range => read({ kind: "population", range }),
      readSelected: (range, token, browse) => read({ kind: "population-selected", range, token, ...(browse === undefined ? {} : { browse }) }),
      exportSelected: async (range, token) => ActivityPopulationExportSchema.parse(JSON.parse(await read({ kind: "population-export", range, token }))),
    },
    readActivityDocument: async selection => OperatorXlsxActivityDocumentSchema.parse(JSON.parse(await read({ kind: "xlsx-document", selection }))),
  };
}

/** `reports` is the request-thread report the queue projection's summaries read; the routes use `activity`, on a lane when one is given. */
export function composeActivity(input: ActivityInput): LocalActivity;
export function composeActivity(input: ActivityInput & { readLanes: Pick<DashboardReadLanes, "read"> }): ActivityRouteDeps & Pick<LocalActivity, "reports"> & LaneXlsx;
export function composeActivity(input: ActivityInput & { readLanes?: Pick<DashboardReadLanes, "read"> }): ActivityRouteDeps & Pick<LocalActivity, "reports"> & Partial<LaneXlsx>;
export function composeActivity(input: ActivityInput & { readLanes?: Pick<DashboardReadLanes, "read"> }): ActivityRouteDeps & Pick<LocalActivity, "reports"> & Partial<LaneXlsx> {
  // One key for this runtime: the lane issues and validates the same tokens as the request-thread service.
  const signingKey = randomBytes(32);
  const activityPopulation = createActivityPopulationService({ ...input, signingKey });
  const { reports } = activityPopulation;
  if (input.readLanes !== undefined) return { ...laneActivity(input.readLanes, signingKey), reports };
  return { activity: reports, activityPopulation, reports };
}
