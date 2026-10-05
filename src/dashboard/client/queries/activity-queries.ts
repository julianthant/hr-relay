import { ActivityReportSelectionSchema,type ActivityReportSelection } from "../../../domain/dashboard/activity-selection.js";
import { parseOrThrow } from "./query-parse.js";
import { protocolError } from "../errors.js";
import { verifySelectionDownload,type SelectionDownload } from "./selection-download.js";
import type { DashboardTransport } from "../transport.js";

export interface ActivityQueries {
  activityReport(from:string,to:string,signal?:AbortSignal):Promise<ActivityReportSelection>;
  exportActivityCsv(report:ActivityReportSelection,signal?:AbortSignal):Promise<SelectionDownload>;
}
export function createActivityQueries(transport:DashboardTransport):ActivityQueries {return Object.freeze({
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
