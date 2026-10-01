import { useRef, useState } from "react";
import { SessionsView } from "./sessions/sessions-view.js";
import { previewSessionAdd, previewSessionControl, SESSION_SAMPLE_WORKFLOWS, sessionsSample } from "./sessions/sessions-fixture.js";
import type { SessionsViewState } from "./sessions/sessions-view-model.js";

/** Local fictional producer; the canonical view accepts presentation data and callbacks. */
export function SessionPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [data, setData] = useState<SessionsViewState>(() => sessionsSample(typeof window === "undefined" ? "active" : new URLSearchParams(window.location.search).get("sessionsPreview") ?? "active"));
  const [notice, setNotice] = useState<string | undefined>();
  const ordinal = useRef(5);
  return <SessionsView data={data} open={open} onOpenChange={onOpenChange} workflows={SESSION_SAMPLE_WORKFLOWS} notice={notice}
    onControl={(id, control) => { setData(current => previewSessionControl(current, id, control)); setNotice(`Worker ${control === "retry" ? "restarting" : control === "stop" ? "stopped" : control === "resume" ? "resumed" : "paused"}.`); }}
    onAdd={(workflow, count) => { const first = ordinal.current; ordinal.current += count; setData(current => previewSessionAdd(current, workflow, count, first)); setNotice(`${count} ${count === 1 ? "worker" : "workers"} added.`); }} />;
}
