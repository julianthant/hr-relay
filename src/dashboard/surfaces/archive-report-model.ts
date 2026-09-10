import { useEffect, useState } from "react";
import { systemClock } from "../../domain/clock.js";
import type { SavedVersionIndexWire } from "../../domain/dashboard/archive.js";

export type SavedResource<T> = { state: "loading" } | { state: "loaded"; value: T } | { state: "error"; message: string };
export function useSavedResource<T>(read: () => Promise<T>, revision = 0): SavedResource<T> {
  const [settled, setSettled] = useState<{ read: typeof read; revision: number; resource: SavedResource<T> }>();
  useEffect(() => {
    let active = true;
    void read().then(value => { if (active) setSettled({ read, revision, resource: { state: "loaded", value } }); },
      (error: unknown) => { if (active) setSettled({ read, revision, resource: { state: "error", message: error instanceof Error ? error.message : "Saved report request failed." } }); });
    return () => { active = false; };
  }, [read, revision]);
  const resource: SavedResource<T> = settled?.read === read && settled.revision === revision ? settled.resource : { state: "loading" };
  return resource;
}
export function savedCell(value: string | number | boolean | null): string {
  return value === null ? "Not recorded" : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
}
export function savedCommandEnvelope(actorId: string) {
  return { commandId: crypto.randomUUID(), requestedAt: systemClock.now().toISOString(), requestedBy: actorId, source: "archive", family: "version-archive" };
}
export function savedPlanRequest(wire: SavedVersionIndexWire, actorId: string, workflow: string, kind: "major" | "minor", what: string, why: string) {
  const target = workflow === "application" ? wire.workflows[0] : wire.workflows.find(row => row.workflow === workflow);
  if (target === undefined) throw new Error("Select a currently registered workflow.");
  return { ...savedCommandEnvelope(actorId), type: "plan-version-bump", target: { scope: workflow === "application" ? { kind: "application", applicationVersion: wire.appVersion } : { kind: "workflows", workflowIds: [workflow] } },
    payload: { targetVersion: wire.appVersion, changeFingerprint: target.fingerprint, changeRecord: { kind, what, why, commit: { state: "absent", reason: "No commit reference supplied." } } } };
}
