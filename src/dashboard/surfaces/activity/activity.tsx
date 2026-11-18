import { activityFailureText, useActivityWiring, type ActivityClient } from "../../state/activity-wiring-adapter.js";
import { WORKFLOW_SOURCES, type WorkflowSource, type WorkflowSourcePolicy } from "../../app/workflow-sources.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { useCallback, useMemo, useState } from "react";
import { PageHeading } from "../../ds/ui.js";
import { activityRangeValue, parseActivityRange } from "./activity-model.js";
import { ACTIVITY_SAMPLE_RANGE, ACTIVITY_SAMPLE_TODAY, activitySample } from "./activity-fixture.js";
import { ActivityView } from "./activity-view.js";
import { useViewNavigation, useViewState } from '../../app/navigation/view-route-model.js';
import type { ActivitySelectionHandler } from './activity-drilldown-model.js';

export function ActivityReport(props: Omit<Parameters<typeof ActivityReportBody>[0], "onRetry">) {
  const [attempt, setAttempt] = useState(0);
  return <ActivityReportBody key={attempt} {...props} onRetry={() => setAttempt(count => count + 1)} />;
}

function ActivityReportBody({ range, onRange, client, today: servedToday, source = "served", workflowSources = WORKFLOW_SOURCES, onRetry }: { onRetry: () => void; range: string; onRange: (range: string) => void; client?: ActivityClient; today?: string; source?: WorkflowSource; workflowSources?: WorkflowSourcePolicy }) {
  const [scenario] = useViewState('activityPreview', 'normal');
  const [notice, setNotice] = useState<{ scope: object; text: string }>();
  const [selection, setSelection] = useViewState('activityBrowse', null);
  const navigation = useViewNavigation();
  const today = source === "mock" ? ACTIVITY_SAMPLE_TODAY : servedToday ?? "";
  const resolved = useMemo(() => parseActivityRange(range || (source === "mock" ? activityRangeValue(ACTIVITY_SAMPLE_RANGE) : ""), today), [range, source, today]);
  const scope = useMemo(() => ({ client, source, from: resolved.from, to: resolved.to }), [client, source, resolved.from, resolved.to]);
  const wire = useActivityWiring(client, resolved, selection, workflowSources, source === "served" && !resolved.refusal);
  const data = useMemo(() => source === "mock" ? resolved.refusal ? { state: "unavailable" as const, reason: resolved.refusal } : activitySample(resolved, scenario) : wire.data, [source, resolved, scenario, wire.data]);
  const onSelection = useCallback<ActivitySelectionHandler>((next, mode = 'push') => {
    if (source === "served" && !wire.exportReady && next?.run !== undefined) return;
    if (navigation) navigation.update({ activityBrowse: next }, mode);
    else setSelection(next);
  }, [navigation, setSelection, source, wire.exportReady]);
  const onExport = (format: "csv" | "xlsx") => {
    if (source === "mock") { setNotice({ scope, text: "CSV export is unavailable in this preview." }); return; }
    if (format !== "csv") { setNotice({ scope, text: ERROR_CATALOG.DASHBOARD_READ_FAILED.text }); return; }
    return wire.exportCsv().then(download => {
      const url = URL.createObjectURL(new Blob([download.bytes], { type: download.mediaType }));
      const link = document.createElement("a"); link.href = url; link.download = download.filename;
      link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, error => setNotice({ scope, text: activityFailureText(error) }));
  };
  const badRange = { state: "unavailable" as const, reason: "That date range is not valid. Pick a period above." };
  if (resolved.refusal && parseActivityRange("", today).refusal) return <section aria-label="Analytics report" className="settings-reference-page settings-data-section"><PageHeading title="Analytics" description="Report unavailable" /><p role="alert" className="text-body text-ui-danger">That date range is not valid.</p></section>;
  return <ActivityView data={resolved.refusal ? badRange : data} onRetry={resolved.refusal ? undefined : onRetry} range={resolved} today={today}
    selection={selection} onSelection={onSelection} browse={source === "served" ? wire.browse : undefined} pending={source === "served" && wire.pending} blocked={source === "served" && !wire.exportReady}
    onRange={next => { setNotice(undefined); setSelection(null); onRange(activityRangeValue(next)); }}
    onExport={source === "served" && !wire.exportReady ? undefined : onExport}
    notice={notice?.scope === scope ? notice.text : source === "served" ? wire.notice : ""}
  />;
}
