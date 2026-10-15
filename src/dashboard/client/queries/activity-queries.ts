import { ActivityPopulationRangeSchema, ActivityPopulationSelectionSchema, ActivityPopulationBrowseSchema, ActivityPopulationSelectedReadSchema, type ActivityPopulationSelection, type ActivityPopulationBrowse, type ActivityPopulationSelectedRead } from "../../../models/dashboard/activity-population.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { ActivityReportSelectionSchema,type ActivityReportSelection } from "../../../models/dashboard/activity-selection.js";
import { parseOrThrow } from "./query-parse.js";
import { protocolError } from "../errors.js";
import { verifySelectionDownload,type SelectionDownload } from "./selection-download.js";
import type { DashboardTransport } from "../transport.js";

export interface ActivityQueries {
  activityPopulation(from:string,to:string,signal?:AbortSignal):Promise<ActivityPopulationSelection>;
  readActivityPopulation(selection:ActivityPopulationSelection,browse?:ActivityPopulationBrowse,signal?:AbortSignal):Promise<ActivityPopulationSelectedRead>;
  exportActivityPopulationCsv(selection:ActivityPopulationSelection,signal?:AbortSignal):Promise<SelectionDownload>;
  activityReport(from:string,to:string,signal?:AbortSignal):Promise<ActivityReportSelection>;
  exportActivityCsv(report:ActivityReportSelection,signal?:AbortSignal):Promise<SelectionDownload>;
}
function verifyPopulation(selection: ActivityPopulationSelection, from: string, to: string): ActivityPopulationSelection {
  const { snapshot, ...report } = selection.report;
  if (report.from !== from || report.to !== to
    || snapshot.reportDigest !== sha256Hex(canonicalJsonStringify(report))
    || selection.snapshot.populationDigest !== sha256Hex(canonicalJsonStringify({ population: selection.population, successfulTiming: selection.successfulTiming })))
    throw protocolError("activity-population-identity-mismatch");
  return selection;
}

export function createActivityQueries(transport:DashboardTransport):ActivityQueries {return Object.freeze({
  async activityPopulation(from:string,to:string,signal?:AbortSignal) {
    const range = ActivityPopulationRangeSchema.parse({ from, to });
    const path = `/api/v1/reports/activity/population?${new URLSearchParams(range)}`;
    return verifyPopulation(parseOrThrow(ActivityPopulationSelectionSchema, path, await transport.requestJson(path, { signal })), from, to);
  },
  async readActivityPopulation(input:ActivityPopulationSelection,browseInput?:ActivityPopulationBrowse,signal?:AbortSignal) {
    const selected = ActivityPopulationSelectionSchema.parse(input);
    verifyPopulation(selected, selected.report.from, selected.report.to);
    const browse = browseInput === undefined ? undefined : ActivityPopulationBrowseSchema.parse(JSON.parse(JSON.stringify(ActivityPopulationBrowseSchema.parse(browseInput))));
    const parameters = { from: selected.report.from, to: selected.report.to, snapshot: selected.snapshot.token };
    const path = `/api/v1/reports/activity/population/selected?${new URLSearchParams({ ...parameters, ...(browse === undefined ? {} : { browse: canonicalJsonStringify(browse) }) })}`;
    const result = parseOrThrow(ActivityPopulationSelectedReadSchema, path, await transport.requestJson(path, { signal }));
    verifyPopulation(result.selection, parameters.from, parameters.to);
    if (canonicalJsonStringify(result.selection) !== canonicalJsonStringify(selected)) throw protocolError("activity-population-selection-mismatch");
    if (browse === undefined) {
      if (result.browse !== null) throw protocolError("activity-population-browse-identity-mismatch");
    } else {
      const observed = result.browse;
      const populationRows = new Set(selected.population.map(row => canonicalJsonStringify(row)));
      const identity = { from: parameters.from, to: parameters.to, token: parameters.snapshot, browse };
      if (observed === null || canonicalJsonStringify(observed.identity) !== canonicalJsonStringify({ ...identity, digest: sha256Hex(canonicalJsonStringify(identity)) })
        || observed.start !== browse.page * 20 || observed.totalMatches > observed.total || observed.total > selected.population.length
        || observed.rows.length !== Math.min(20, observed.totalMatches - observed.start) || observed.rows.some(row => !populationRows.has(canonicalJsonStringify(row)))
        || (browse.run === undefined ? observed.run !== null : observed.run?.runId !== browse.run)
        || (observed.run !== null && !populationRows.has(canonicalJsonStringify(observed.run))))
        throw protocolError("activity-population-browse-identity-mismatch");
    }
    return result;
  },
  async exportActivityPopulationCsv(input:ActivityPopulationSelection,signal?:AbortSignal) {
    const selection = ActivityPopulationSelectionSchema.parse(input);
    verifyPopulation(selection, selection.report.from, selection.report.to);
    const path = `/api/v1/reports/activity/population.csv?${new URLSearchParams({ from: selection.report.from, to: selection.report.to, snapshot: selection.snapshot.token })}`;
    return verifySelectionDownload(await transport.requestBinary(path, { signal }), { path, filename: `activity-${selection.report.from}_${selection.report.to}.csv`, mediaType: "text/csv; charset=utf-8", token: selection.snapshot.token });
  },
  async activityReport(from:string,to:string,signal?:AbortSignal) {
    const path=`/api/v1/reports/activity?${new URLSearchParams({from,to})}`;
    const report=parseOrThrow(ActivityReportSelectionSchema,"GET /api/v1/reports/activity",await transport.requestJson(path,{signal}));
    if(report.from!==from||report.to!==to)throw protocolError("activity-request-identity-mismatch");
    return report;
  },
  async exportActivityCsv(input:ActivityReportSelection,signal?:AbortSignal) {
    const report=ActivityReportSelectionSchema.parse(input);
    const path=`/api/v1/reports/activity.csv?${new URLSearchParams({from:report.from,to:report.to,snapshot:report.snapshot.token})}`;
    return verifySelectionDownload(await transport.requestBinary(path,{signal}),{path,filename:`activity-${report.from}_${report.to}.csv`,mediaType:"text/csv; charset=utf-8",token:report.snapshot.token});
  },
});}
