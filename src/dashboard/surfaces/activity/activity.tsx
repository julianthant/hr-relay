import { activityFailureText, useActivityWiring, type ActivityClient } from "../../state/activity-wiring-adapter.js";
import { WORKFLOW_SOURCES, type WorkflowSourcePolicy } from "../../app/workflow-sources.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { useCallback, useMemo, useState } from "react";
import { PageHeading } from "../../ds/ui.js";
import { activityRangeValue, parseActivityRange } from "./activity-model.js";
import { ActivityView } from "./activity-view.js";
import { useViewNavigation, useViewState } from '../../app/navigation/view-route-model.js';
import type { ActivityBrowse, ActivityDrilldownData, ActivitySelectionHandler } from './activity-drilldown-model.js';
import type { ActivityViewState } from './activity-view-model.js';
import type { ActivityDateRange } from "./activity-model.js";
import type { AnalyticsDesign } from "./analytics-model.js";

/** What the report reads; the product passes useActivityWiring and a harness may pass a hook with the same shape. */
export interface ActivityReportWiring {
  readonly data: ActivityViewState; readonly browse?: ActivityDrilldownData; readonly pending: boolean; readonly exportReady: boolean; readonly notice: string;
  readonly exportCsv: (signal?: AbortSignal) => ReturnType<ActivityClient["exportActivityPopulationCsv"]>;
}
export type ActivityReportHook = (client: ActivityClient | undefined, range: ActivityDateRange, browse: ActivityBrowse | null, sources: WorkflowSourcePolicy, enabled: boolean) => ActivityReportWiring;

export function ActivityReport(props: Omit<Parameters<typeof ActivityReportBody>[0], "onRetry">) {
  const [attempt, setAttempt] = useState(0);
  return <ActivityReportBody key={attempt} {...props} onRetry={() => setAttempt(count => count + 1)} />;
}

function ActivityReportBody({ range, onRange, client, today = "", useReport = useActivityWiring, workflowSources = WORKFLOW_SOURCES, onRetry, design }: { onRetry: () => void; design?: AnalyticsDesign; range: string; onRange: (range: string) => void; client?: ActivityClient; today?: string; useReport?: ActivityReportHook; workflowSources?: WorkflowSourcePolicy }) {
  const [notice, setNotice] = useState<{ scope: object; text: string }>();
  const [selection, setSelection] = useViewState('activityBrowse', null);
  const navigation = useViewNavigation();
  const resolved = useMemo(() => parseActivityRange(range, today), [range, today]);
  const scope = useMemo(() => ({ client, from: resolved.from, to: resolved.to }), [client, resolved.from, resolved.to]);
  const wire = useReport(client, resolved, selection, workflowSources, !resolved.refusal);
  const onSelection = useCallback<ActivitySelectionHandler>((next, mode = 'push') => {
    if (!wire.exportReady && next?.run !== undefined) return;
    if (navigation) navigation.update({ activityBrowse: next }, mode);
    else setSelection(next);
  }, [navigation, setSelection, wire.exportReady]);
  const onExport = (format: "csv" | "xlsx") => {
    if (format !== "csv") { setNotice({ scope, text: ERROR_CATALOG.DASHBOARD_READ_FAILED.text }); return; }
    return wire.exportCsv().then(download => {
      const url = URL.createObjectURL(new Blob([download.bytes], { type: download.mediaType }));
      const link = document.createElement("a"); link.href = url; link.download = download.filename;
      link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, error => setNotice({ scope, text: activityFailureText(error) }));
  };
  const badRange = { state: "unavailable" as const, reason: "That date range is not valid. Pick a period above." };
  if (resolved.refusal && parseActivityRange("", today).refusal) return <section aria-label="Analytics report" className="settings-reference-page settings-data-section"><PageHeading title="Analytics" description="Report unavailable" /><p role="alert" className="text-body text-ui-danger">That date range is not valid.</p></section>;
  return <ActivityView design={design} data={resolved.refusal ? badRange : wire.data} onRetry={resolved.refusal ? undefined : onRetry} range={resolved} today={today}
    selection={selection} onSelection={onSelection} browse={wire.browse} pending={wire.pending} blocked={!wire.exportReady}
    onRange={next => { setNotice(undefined); setSelection(null); onRange(activityRangeValue(next)); }}
    onExport={wire.exportReady ? onExport : undefined}
    notice={notice?.scope === scope ? notice.text : wire.notice}
  />;
}
