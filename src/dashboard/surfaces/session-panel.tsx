import { useRef, useState } from "react";
import { Select } from "../ds/ui.js";
import { SessionsView } from "./sessions/sessions-view.js";
import { previewSessionAdd, previewSessionControl, SESSION_SAMPLE_OPTIONS, SESSION_SAMPLE_WORKFLOWS, sessionsSample } from "./sessions/sessions-fixture.js";
import type { SessionsViewState } from "./sessions/sessions-view-model.js";

/** Local fictional producer; the canonical view accepts presentation data and callbacks. */
export function SessionPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [scenario, setScenario] = useState("active");
  const [data, setData] = useState<SessionsViewState>(() => sessionsSample("active"));
  const [notice, setNotice] = useState<string | undefined>();
  const ordinal = useRef(5);
  return <SessionsView data={data} open={open} onOpenChange={onOpenChange} workflows={SESSION_SAMPLE_WORKFLOWS} notice={notice}
    onControl={(id, control) => { setData(current => previewSessionControl(current, id, control)); setNotice(`Sample worker ${control === "retry" ? "restarting" : control === "stop" ? "stopped" : control === "resume" ? "resumed" : "paused"}.`); }}
    onAdd={(workflow, count) => { const first = ordinal.current; ordinal.current += count; setData(current => previewSessionAdd(current, workflow, count, first)); setNotice(`${count} sample ${count === 1 ? "worker" : "workers"} added.`); }}
    sampleControl={<Select aria-label="Sessions sample data" variant="toolbar" value={scenario} onChange={event => { const next = event.target.value; const nextData = sessionsSample(next); ordinal.current = nextData.state === "ready" ? nextData.workers.length + 1 : 1; setScenario(next); setData(nextData); setNotice(undefined); }}>{SESSION_SAMPLE_OPTIONS.map(item => <option key={item.id} value={item.id}>Sample data · {item.label}</option>)}</Select>} />;
}
