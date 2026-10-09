import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import { useMemo } from "react";
import { SessionsView } from "./sessions-view.js";
import { sessionsSample } from "./sessions-fixture.js";
import { createSessionPreviewPort, useSessionPreviewCommands } from "./session-preview-command-model.js";
import type { SessionsViewState } from "./sessions-view-model.js";

/** Local fictional producer; the canonical view accepts presentation data and callbacks. */
export function SessionPanel({ catalog, open, onOpenChange, settingsOpen, onSettings }: { catalog: readonly WorkflowCatalogEntry[]; open: boolean; onOpenChange: (open: boolean) => void; settingsOpen?: boolean; onSettings?: () => void }) {
  const initial = useMemo(() => sessionsSample(typeof window === "undefined" ? "active" : new URLSearchParams(window.location.search).get("sessionsPreview") ?? "active"), []);
  const port = useMemo(() => {
    const scenario = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('workerCommandPreview');
    if (scenario !== null && scenario !== 'refused' && scenario !== 'uncertain') throw new Error('SESSION_COMMAND_SCENARIO_INVALID');
    return createSessionPreviewPort(scenario ?? 'normal');
  }, []);
  const commands = useSessionPreviewCommands(initial, catalog, port);
  const data = commands.data;
  const display = useMemo((): SessionsViewState => data.state === "ready" ? { ...data, workers: data.workers.map(worker => {
    const registration = catalog.find(entry => entry.id === worker.workflowId);
    if (!registration) throw new Error(`SESSION_WORKFLOW_UNREGISTERED: ${worker.workflowId}`);
    return { ...worker, workflow: registration.label };
  }) } : data, [data, catalog]);
  return <SessionsView data={display} open={open} onOpenChange={onOpenChange} workflows={catalog}
    idleCountdowns={commands.idleCountdowns} onControl={commands.control} operations={commands.operations} onCheck={commands.check}
    settingsOpen={settingsOpen} onSettings={onSettings}
    onAdd={commands.add} />;
}
