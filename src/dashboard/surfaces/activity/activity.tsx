import { useCallback, useMemo, useState } from "react";
import { PageHeading } from "../../ds/ui.js";
import { activityPresetOf, activityPresetRange, activityRangeValue, parseActivityRange, type ActivityDatePreset } from "./activity-model.js";
import { ACTIVITY_SAMPLE_RANGE, ACTIVITY_SAMPLE_TODAY, activitySample } from "./activity-fixture.js";
import { ActivityView } from "./activity-view.js";
import { useViewNavigation, useViewState } from '../../app/navigation/view-route-model.js';
import type { ActivitySelectionHandler } from './activity-drilldown-model.js';

/** Temporary local producer for the production presentation. Replace only this seam when wiring. */
export function ActivityReport({ range, onRange }: { range: string; onRange: (range: string) => void }) {
  const [scenario] = useViewState('activityPreview', 'normal');
  const [choice, setChoice] = useState<{ range: string; value: ActivityDatePreset }>();
  const [rangeRevision, setRangeRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const [selection, setSelection] = useViewState('activityBrowse', null);
  const navigation = useViewNavigation();
  const onSelection = useCallback<ActivitySelectionHandler>((next, mode = 'push') => {
    if (navigation) navigation.update({ activityBrowse: next }, mode);
    else setSelection(next);
  }, [navigation, setSelection]);
  const resolved = useMemo(() => parseActivityRange(range || activityRangeValue(ACTIVITY_SAMPLE_RANGE), ACTIVITY_SAMPLE_TODAY), [range]);
  const data = useMemo(() => resolved.refusal ? { state: "unavailable" as const, reason: resolved.refusal } : activitySample(resolved, scenario), [resolved, scenario]);
  if (resolved.refusal) return <section aria-label="Analytics report" className="settings-reference-page settings-data-section"><PageHeading title="Analytics" description="Report unavailable" /><p role="alert" className="text-body text-ui-danger">{resolved.refusal} Requested: {range}</p></section>;
  const period = choice?.range === range ? choice.value : activityPresetOf(resolved, ACTIVITY_SAMPLE_TODAY);
  return <ActivityView data={data} range={resolved} rangeRevision={rangeRevision} today={ACTIVITY_SAMPLE_TODAY} period={period}
    selection={selection} onSelection={onSelection}
    onRange={next => { const value = activityRangeValue(next); setChoice({ range: value, value: "custom" }); setNotice(""); setSelection(null); onRange(value); }}
    onPreset={preset => { const value = preset === "custom" ? range : activityRangeValue(activityPresetRange(preset, ACTIVITY_SAMPLE_TODAY)); setChoice({ range: value, value: preset }); setNotice(""); if (preset !== "custom") { setSelection(null); setRangeRevision(current => current + 1); onRange(value); } }}
    onExport={() => setNotice("CSV export is unavailable in this preview.")}
    notice={notice}
  />;
}
