import { useMemo, useState } from "react";
import { Select, PageHeading } from "../ds/ui.js";
import { activityPresetOf, activityPresetRange, activityRangeValue, parseActivityRange, type ActivityDatePreset } from "./activity-model.js";
import { ACTIVITY_SAMPLE_RANGE, ACTIVITY_SAMPLE_STATES, ACTIVITY_SAMPLE_TODAY, activitySample, type ActivitySampleState } from "./activity/activity-fixture.js";
import { ActivityView } from "./activity/activity-view.js";

/** Temporary local producer for the production presentation. Replace only this seam when wiring. */
export function ActivityReport({ range, onRange }: { range: string; onRange: (range: string) => void }) {
  const [scenario, setScenario] = useState<ActivitySampleState>("normal");
  const [choice, setChoice] = useState<{ range: string; value: ActivityDatePreset }>();
  const [notice, setNotice] = useState("");
  const resolved = useMemo(() => parseActivityRange(range || activityRangeValue(ACTIVITY_SAMPLE_RANGE), ACTIVITY_SAMPLE_TODAY), [range]);
  const data = useMemo(() => resolved.refusal ? { state: "unavailable" as const, reason: resolved.refusal } : activitySample(resolved, scenario), [resolved, scenario]);
  if (resolved.refusal) return <section aria-label="Activity report" className="settings-reference-page settings-data-section"><PageHeading title="Activity" description="Report unavailable" /><p role="alert" className="text-body text-ui-danger">{resolved.refusal} Requested: {range}</p></section>;
  const period = choice?.range === range ? choice.value : activityPresetOf(resolved, ACTIVITY_SAMPLE_TODAY);
  return <ActivityView data={data} range={resolved} today={ACTIVITY_SAMPLE_TODAY} period={period}
    onRange={next => { const value = activityRangeValue(next); setChoice({ range: value, value: "custom" }); setNotice(""); onRange(value); }}
    onPreset={preset => { const value = preset === "custom" ? range : activityRangeValue(activityPresetRange(preset, ACTIVITY_SAMPLE_TODAY)); setChoice({ range: value, value: preset }); setNotice(""); if (preset !== "custom") onRange(value); }}
    onExport={() => setNotice("Export is not connected yet.")}
    notice={notice}
    sampleControl={<Select aria-label="Activity sample data" variant="toolbar" value={scenario} onChange={event => { setScenario(event.target.value as ActivitySampleState); setNotice(""); }}>{ACTIVITY_SAMPLE_STATES.map(item => <option key={item.id} value={item.id}>Sample data · {item.label}</option>)}</Select>}
  />;
}
