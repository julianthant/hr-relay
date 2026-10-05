import type { WorkflowCatalogEntry } from "./workflow-catalog-model.js";
import { useMemo, useRef, useState } from "react";
import { SessionsView } from "./sessions/sessions-view.js";
import { previewSessionAdd, previewSessionControl, sessionsSample } from "./sessions/sessions-fixture.js";
import type { SessionsViewState } from "./sessions/sessions-view-model.js";

/** Local fictional producer; the canonical view accepts presentation data and callbacks. */
export function SessionPanel({ catalog, open, onOpenChange, settingsOpen, onSettings }: { catalog: readonly WorkflowCatalogEntry[]; open: boolean; onOpenChange: (open: boolean) => void; settingsOpen?: boolean; onSettings?: () => void }) {
  const [data, setData] = useState<SessionsViewState>(() => sessionsSample(typeof window === "undefined" ? "active" : new URLSearchParams(window.location.search).get("sessionsPreview") ?? "active"));
  const display = useMemo((): SessionsViewState => data.state === "ready" ? { ...data, workers: data.workers.map(worker => {
    const registration = catalog.find(entry => entry.id === worker.workflowId);
    if (!registration) throw new Error(`SESSION_WORKFLOW_UNREGISTERED: ${worker.workflowId}`);
    return { ...worker, workflow: registration.label };
  }) } : data, [data, catalog]);
  const ordinal = useRef(5);
  return <SessionsView data={display} open={open} onOpenChange={onOpenChange} workflows={catalog}
    onControl={(id, control) => setData(current => previewSessionControl(current, id, control))}
    settingsOpen={settingsOpen} onSettings={onSettings}
    onAdd={(workflow, count) => { const first = ordinal.current; ordinal.current += count; setData(current => previewSessionAdd(current, catalog, workflow, count, first)); }} />;
}
