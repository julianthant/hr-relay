import { useActivityWiring, type ActivityClient } from "../../state/activity-wiring-adapter.js";
import { WORKFLOW_SOURCES, type WorkflowSource, type WorkflowSourcePolicy } from "../../app/workflow-sources.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { useCallback, useMemo, useState } from "react";
import { PageHeading } from "../../ds/ui.js";
import { activityPresetOf, activityPresetRange, activityRangeValue, parseActivityRange, type ActivityDatePreset } from "./activity-model.js";
import { ACTIVITY_SAMPLE_RANGE, ACTIVITY_SAMPLE_TODAY, activitySample } from "./activity-fixture.js";
import { ActivityView } from "./activity-view.js";
import { useViewNavigation, useViewState } from '../../app/navigation/view-route-model.js';
import type { ActivitySelectionHandler } from './activity-drilldown-model.js';

export function ActivityReport({ range, onRange, client, today: servedToday, source = "served", workflowSources = WORKFLOW_SOURCES }: { range: string; onRange: (range: string) => void; client?: ActivityClient; today?: string; source?: WorkflowSource; workflowSources?: WorkflowSourcePolicy }) {
  const [scenario] = useViewState('activityPreview', 'normal');
  const [choice, setChoice] = useState<{ range: string; value: ActivityDatePreset }>();
  const [rangeRevision, setRangeRevision] = useState(0);
  const [notice, setNotice] = useState<{ scope: object; text: string }>();
  const [selection, setSelection] = useViewState('activityBrowse', null);
  const navigation = useViewNavigation();
  const today = source === "mock" ? ACTIVITY_SAMPLE_TODAY : servedToday ?? "";
  const resolved = useMemo(() => parseActivityRange(range || (source === "mock" ? activityRangeValue(ACTIVITY_SAMPLE_RANGE) : ""), today), [range, source, today]);
  const scope = useMemo(() => ({ client, source, from: resolved.from, to: resolved.to }), [client, source, resolved.from, resolved.to]);
  const wire = useActivityWiring(client, resolved, selection, workflowSources, source === "served" && !resolved.refusal);
  const data = useMemo(() => source === "mock" ? resolved.refusal ? { state: "unavailable" as const, reason: resolved.refusal } : activitySample(resolved, scenario) : wire.data, [source, resolved, scenario, wire.data]);
  const onSelection = useCallback<ActivitySelectionHandler>((next, mode = 'push') => {
    if (source === "served" && wire.pending && next?.run !== undefined) return;
    if (navigation) navigation.update({ activityBrowse: next }, mode);
    else setSelection(next);
  }, [navigation, setSelection, source, wire.pending]);
  const onExport = (format: "csv" | "xlsx") => {
    if (source !== "served" || format !== "csv") { setNotice({ scope, text: ERROR_CATALOG.DASHBOARD_READ_FAILED.text }); return; }
    void wire.exportCsv().then(download => {
      const url = URL.createObjectURL(new Blob([download.bytes], { type: download.mediaType }));
      const link = document.createElement("a"); link.href = url; link.download = download.filename;
      link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, () => setNotice({ scope, text: ERROR_CATALOG.DASHBOARD_READ_FAILED.text }));
  };
  if (resolved.refusal) return <section aria-label="Analytics report" className="settings-reference-page settings-data-section"><PageHeading title="Analytics" description="Report unavailable" /><p role="alert" className="text-body text-ui-danger">{resolved.refusal} Requested: {range}</p></section>;
  const period = choice?.range === range ? choice.value : activityPresetOf(resolved, today);
  return <ActivityView data={data} range={resolved} rangeRevision={rangeRevision} today={today} period={period}
    selection={selection} onSelection={onSelection} browse={source === "served" ? wire.browse : undefined} pending={source === "served" && wire.pending}
    onRange={next => { const value = activityRangeValue(next); setChoice({ range: value, value: "custom" }); setNotice(undefined); setSelection(null); onRange(value); }}
    onPreset={preset => { const value = preset === "custom" ? range : activityRangeValue(activityPresetRange(preset, today)); setChoice({ range: value, value: preset }); setNotice(undefined); if (preset !== "custom") { setSelection(null); setRangeRevision(current => current + 1); onRange(value); } }}
    onExport={onExport}
    notice={notice?.scope === scope ? notice.text : source === "served" ? wire.notice : ""}
  />;
}
