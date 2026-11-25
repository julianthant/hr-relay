import { useMemo, useRef, useState } from "react";
import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import { createSessionPreviewPort, useSessionAddFeedback, useSessionPreviewCommands, type SessionCommandBinding, type SessionPreviewCommandPort } from "./session-preview-command-model.js";
import { sessionsFromDay, sessionsUnavailable, type SessionsViewState } from "./sessions-view-model.js";
import { useToasts } from "../../ds/ui.js";

/** A harness supplies the first state and the command port in place of the served day and its commands. */
export type SessionsHarness = (catalog: readonly WorkflowCatalogEntry[]) => Readonly<{ initial: SessionsViewState; port: SessionPreviewCommandPort }>;

/** The workers and their commands, read once for both the sidebar controls and the docked console. */
export function useSessions({ catalog, harness, binding }: { catalog: readonly WorkflowCatalogEntry[]; harness?: SessionsHarness; binding?: SessionCommandBinding }) {
  const { toast } = useToasts();
  const harnessed = useMemo(() => harness?.(catalog), [harness, catalog]);
  const day = binding?.dayState.day;
  // Worker cards come with every day; while another day loads, the console keeps the cards it last read, marked stale, instead of loading again.
  const [heldDay, setHeldDay] = useState(day?.state === "loaded" ? day.value : undefined);
  if (day?.state === "loaded" && day.value !== heldDay) setHeldDay(day.value);
  const shownDay = day?.state === "loaded" ? day.value : day?.state === "loading" ? heldDay : undefined;
  const stale = day?.state !== "loaded";
  const initial = useMemo((): SessionsViewState => {
    if (harnessed) return harnessed.initial;
    if (binding === undefined) return sessionsUnavailable();
    if (shownDay !== undefined) {
      const sessions = sessionsFromDay(shownDay, catalog, binding.now());
      return stale && sessions.state === "ready" ? { ...sessions, stale: true } : sessions;
    }
    return day?.state === "failed" ? sessionsUnavailable(day.error) : { state: "loading" };
  }, [harnessed, binding, shownDay, stale, catalog, day]);
  const current = useMemo(() => ({ binding, catalog }), [binding, catalog]);
  const currentRef = useRef(current); currentRef.current = current;
  const servedPort = useMemo(() => createSessionPreviewPort(() => currentRef.current), []);
  const scope = useMemo(() => ({ scope: binding?.scope, workflowId: binding?.workflowId }), [binding?.scope, binding?.workflowId]);
  const commands = useSessionPreviewCommands(initial, catalog, harnessed ? harnessed.port : servedPort, binding === undefined || harnessed ? undefined : { snapshot: binding.dayState.day, scope, actorId: binding.scope.actorId,
    onRefused: title => toast({ tone: "danger", title, duration: 6000 }) });
  useSessionAddFeedback(commands.operations.add);
  const data = commands.data;
  // Add workers offers only workflows the server registered and can start.
  const addable = useMemo(() => catalog.filter(entry => entry.served !== undefined && entry.launch.state === "served"), [catalog]);
  const display = useMemo((): SessionsViewState => {
    if (data.state !== "ready") return data;
    const workers = [];
    for (const worker of data.workers) {
      const registration = catalog.find(entry => entry.id === worker.workflowId);
      if (registration === undefined) return sessionsUnavailable({ code: "SESSION_WORKFLOW_UNREGISTERED", workflowId: worker.workflowId });
      workers.push({ ...worker, workflow: registration.label });
    }
    return { ...data, workers };
  }, [data, catalog]);
  return { data: display, addable, commands };
}
export type Sessions = ReturnType<typeof useSessions>;
