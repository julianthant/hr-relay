import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import { useMemo, useRef } from "react";
import { SessionsView } from "./sessions-view.js";
import { createFixtureSessionPort, sessionsSample } from "./sessions-fixture.js";
import { createSessionPreviewPort, useSessionPreviewCommands, type SessionCommandBinding } from "./session-preview-command-model.js";
import { sessionsFromDay, type SessionsViewState } from "./sessions-view-model.js";

export function SessionPanel({ catalog, open, onOpenChange, settingsOpen, onSettings, source = "served", binding }: { catalog: readonly WorkflowCatalogEntry[]; open: boolean; onOpenChange: (open: boolean) => void; settingsOpen?: boolean; onSettings?: () => void; source?: "served" | "mock"; binding?: SessionCommandBinding }) {
  const fixture = useMemo(() => source === "mock" ? sessionsSample(typeof window === "undefined" ? "active" : new URLSearchParams(window.location.search).get("sessionsPreview") ?? "active") : undefined, [source]);
  const initial = useMemo((): SessionsViewState => source === "mock" ? fixture! : binding?.dayState.day.state === "loaded"
    ? sessionsFromDay(binding.dayState.day.value, catalog, binding.nowIso) : binding === undefined ? { state: "unavailable", reason: "Session information is unavailable." } : binding.dayState.day.state === "failed"
      ? { state: "unavailable", reason: binding.dayState.day.error.message } : { state: "loading" }, [source, fixture, binding, catalog]);
  const current = useMemo(() => ({ binding, catalog }), [binding, catalog]);
  const currentRef = useRef(current); currentRef.current = current;
  const servedPort = useMemo(() => createSessionPreviewPort(() => currentRef.current), []);
  const fixturePort = useMemo(() => {
    if (source !== "mock") return undefined;
    const scenario = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('workerCommandPreview');
    if (scenario !== null && scenario !== 'refused' && scenario !== 'uncertain') throw new Error('SESSION_COMMAND_SCENARIO_INVALID');
    return createFixtureSessionPort(fixture!, catalog, scenario ?? 'normal');
  }, [source, fixture, catalog]);
  const commands = useSessionPreviewCommands(initial, catalog, source === "served" ? servedPort : fixturePort!, binding === undefined || source === "mock" ? undefined : { snapshot: binding.dayState.day, scope: binding.scope, actorId: binding.scope.actorId, records: binding.dayState.day.state === "loaded" ? binding.dayState.day.value.workerOperations : undefined });
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
