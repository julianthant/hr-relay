import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { systemClock } from "../../domain/clock.js";
import { deepFreeze } from "../../domain/immutability.js";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import {
  StorageRelocationCommandRequestSchema, StorageRelocationPlanViewSchema,
  storageRelocationDesiredDigest, storageRelocationRequestFingerprint,
  type CommandResult, type StorageRelocationCommandRequest, type StorageRelocationPlanView,
} from "../../domain/commands.js";
import { beforeEffectRefusal, uncertainSettingsCode } from "./settings-attempt-model.js";
import { useSettingsClient } from "../state/settings-client.js";

type Pair = StorageRelocationPlanView["sourcePair"];
type Field = keyof Pair;
type Draft = Partial<Record<Field, string>>;
type Save = { readonly state: "idle" | "saving" | "applied" } | { readonly state: "conflict" | "refused" | "unconfirmed"; readonly message: string };
type Read = { readonly state: "loading" } | { readonly state: "unavailable" } | { readonly state: "available"; readonly view: StorageRelocationPlanView };

function validPath(value: string): boolean {
  return value.startsWith("/") && value !== "/" && !value.endsWith("/")
    && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    && !value.slice(1).split("/").some(part => part === "." || part === ".." || part === "");
}
export function relocationDraftErrors(draft: Draft): Partial<Record<Field, string>> {
  return Object.fromEntries(Object.entries(draft).map(([field, value]) => [field,
    value !== undefined && !validPath(value) ? "Enter a canonical absolute folder path." : undefined]));
}
export function desiredRelocationPair(view: StorageRelocationPlanView, draft: Draft): Pair {
  const base = view.pending?.desiredPair ?? view.sourcePair;
  return { stateRoot: draft.stateRoot ?? base.stateRoot, artifactRoot: draft.artifactRoot ?? base.artifactRoot };
}
function target(view: StorageRelocationPlanView) {
  return { installationId: view.installationId, sourceGeneration: view.sourceGeneration,
    sourcePair: view.sourcePair, expectedRevision: view.revision };
}
export function planRelocationCommand(view: StorageRelocationPlanView, pair: Pair, actorId: string): StorageRelocationCommandRequest {
  const basis = { commandId: crypto.randomUUID(), requestedAt: systemClock.now().toISOString(), requestedBy: actorId,
    source: "settings-surface" as const, family: "storage-relocation" as const, type: "plan-storage-relocation" as const,
    target: target(view), payload: { writeId: crypto.randomUUID(), desiredPair: pair,
      desiredDigest: storageRelocationDesiredDigest(target(view), pair), requestFingerprint: "0".repeat(64) } };
  return deepFreeze(StorageRelocationCommandRequestSchema.parse({ ...basis, payload: { ...basis.payload,
    requestFingerprint: storageRelocationRequestFingerprint(StorageRelocationCommandRequestSchema.parse(basis)) } }));
}
export function cancelRelocationCommand(view: StorageRelocationPlanView, actorId: string): StorageRelocationCommandRequest {
  if (view.pending === null) throw new Error("storage-relocation-no-pending-plan");
  const basis = { commandId: crypto.randomUUID(), requestedAt: systemClock.now().toISOString(), requestedBy: actorId,
    source: "settings-surface" as const, family: "storage-relocation" as const, type: "cancel-storage-relocation" as const,
    target: target(view), payload: { writeId: crypto.randomUUID(), cancelledPlanCommandId: view.pending.commandId,
      cancelledPlanDigest: view.pending.desiredDigest, requestFingerprint: "0".repeat(64) } };
  return deepFreeze(StorageRelocationCommandRequestSchema.parse({ ...basis, payload: { ...basis.payload,
    requestFingerprint: storageRelocationRequestFingerprint(StorageRelocationCommandRequestSchema.parse(basis)) } }));
}
function confirms(command: StorageRelocationCommandRequest, result: CommandResult, readback: StorageRelocationPlanView): boolean {
  if ((result.state !== "applied" && result.state !== "already-applied") || result.commandId !== command.commandId
    || result.affectedTargets.length !== 1 || result.affectedTargets[0]?.family !== "storage-relocation"
    || result.affectedTargets[0].revision !== command.target.expectedRevision + 1
    || readback.revision !== command.target.expectedRevision + 1 || readback.installationId !== command.target.installationId
    || readback.sourceGeneration !== command.target.sourceGeneration
    || readback.sourcePair.stateRoot !== command.target.sourcePair.stateRoot
    || readback.sourcePair.artifactRoot !== command.target.sourcePair.artifactRoot) return false;
  if (command.type === "cancel-storage-relocation") return readback.pending === null;
  return readback.pending?.commandId === command.commandId && readback.pending.writeId === command.payload.writeId
    && readback.pending.desiredDigest === command.payload.desiredDigest
    && readback.pending.requestFingerprint === command.payload.requestFingerprint
    && readback.pending.desiredPair.stateRoot === command.payload.desiredPair.stateRoot
    && readback.pending.desiredPair.artifactRoot === command.payload.desiredPair.artifactRoot;
}

export function useStorageRelocation(input: Readonly<{ actorId: string }>) {
  const client = useSettingsClient();
  const [read, setRead] = useState<Read>({ state: "loading" });
  const [readProblem, setReadProblem] = useState(false);
  const lastVerified = useRef<StorageRelocationPlanView | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>({});
  const [save, setSave] = useState<Save>({ state: "idle" });
  const attempt = useRef<StorageRelocationCommandRequest | undefined>(undefined);
  const busy = useRef(false);
  const readCurrent = useCallback(async (): Promise<StorageRelocationPlanView> => {
    const view = StorageRelocationPlanViewSchema.parse(await client.storageRelocationPlans());
    const previous = lastVerified.current;
    if (previous !== undefined && (view.installationId !== previous.installationId
      || view.sourceGeneration < previous.sourceGeneration
      || (view.sourceGeneration === previous.sourceGeneration && (view.sourcePair.stateRoot !== previous.sourcePair.stateRoot
        || view.sourcePair.artifactRoot !== previous.sourcePair.artifactRoot || view.revision < previous.revision
        || view.revision === previous.revision && canonicalJsonStringify(view) !== canonicalJsonStringify(previous))))) {
      throw new Error("storage-relocation-readback-stale-or-divergent");
    }
    lastVerified.current = view; setRead({ state: "available", view }); setReadProblem(false); return view;
  }, [client]);
  const markReadUnavailable = useCallback((): void => { if (lastVerified.current === undefined) setRead({ state: "unavailable" }); else setReadProblem(true); }, []);
  useEffect(() => { void readCurrent().catch(() => markReadUnavailable()); }, [readCurrent, markReadUnavailable]);
  const errors = relocationDraftErrors(draft);
  const locked = busy.current || attempt.current !== undefined || read.state !== "available" || readProblem;
  const update = (field: Field, raw: string): void => {
    if (locked) return;
    setDraft(previous => ({ ...previous, [field]: raw })); setSave({ state: "idle" });
  };
  const reset = (field: Field): void => {
    if (locked) return;
    setDraft(previous => { const next = { ...previous }; delete next[field]; return next; }); setSave({ state: "idle" });
  };
  const discard = (): void => { if (busy.current) return; attempt.current = undefined; setDraft({}); setSave({ state: "idle" }); };
  const perform = async (command: StorageRelocationCommandRequest): Promise<void> => {
    if (busy.current) return;
    busy.current = true; attempt.current = command; setSave({ state: "saving" });
    try {
      const result = await client.applyStorageRelocation(command);
      if (result.commandId !== command.commandId) throw new Error("storage-relocation-result-identity");
      if (result.state === "conflict") {
        attempt.current = undefined;
        try { await readCurrent(); setSave({ state: "conflict", message: "The plan changed. Review the current paths before retrying your retained edit." }); }
        catch { markReadUnavailable(); setSave({ state: "conflict", message: "The plan changed. Refresh current paths before retrying." }); }
        return;
      }
      if (result.state === "rejected") {
        const uncertain = uncertainSettingsCode(result.code);
        if (!uncertain) attempt.current = undefined;
        setSave({ state: uncertain ? "unconfirmed" : "refused", message: uncertain
          ? "The plan write could not be confirmed. Retry the exact attempt."
          : "The plan was refused. Review the paths before retrying." }); return;
      }
      const readback = await readCurrent();
      if (!confirms(command, result, readback)) throw new Error("storage-relocation-readback-unconfirmed");
      attempt.current = undefined; setDraft({}); setSave({ state: "applied" });
    } catch (error) {
      const refused = beforeEffectRefusal(error);
      if (refused) attempt.current = undefined;
      setSave({ state: refused ? "refused" : "unconfirmed", message: refused
        ? "The request was refused before execution. Your draft is retained."
        : "The plan write could not be confirmed. It may already be recorded. Retry the exact attempt; your draft is retained." });
    } finally { busy.current = false; }
  };
  const submit = (): void => {
    if (read.state !== "available" || locked || Object.keys(draft).length === 0 || Object.values(errors).some(Boolean)) return;
    const pair = desiredRelocationPair(read.view, draft);
    const previousDesired = desiredRelocationPair(read.view, {});
    if (pair.stateRoot === previousDesired.stateRoot && pair.artifactRoot === previousDesired.artifactRoot) {
      setSave({ state: "refused", message: "The draft matches the current plan. Undo the edit or choose another folder." }); return;
    }
    if (pair.stateRoot === read.view.sourcePair.stateRoot && pair.artifactRoot === read.view.sourcePair.artifactRoot) {
      setSave({ state: "refused", message: "Cancel the current plan to keep the active locations, or choose another folder." }); return;
    }
    try { void perform(planRelocationCommand(read.view, pair, input.actorId)); }
    catch { setSave({ state: "refused", message: "Check the folder paths. No plan was sent." }); }
  };
  const cancel = (): void => {
    if (read.state !== "available" || locked || read.view.pending === null || Object.keys(draft).length > 0) return;
    void perform(cancelRelocationCommand(read.view, input.actorId));
  };
  const autosave = useEffectEvent(submit);
  useEffect(() => {
    if (read.state !== "available" || readProblem || save.state !== "idle" || Object.keys(draft).length === 0 || Object.values(errors).some(Boolean)) return;
    const timer = window.setTimeout(() => autosave(), 700);
    return () => window.clearTimeout(timer);
  }, [draft, read, readProblem, errors, save.state]);
  const retry = (): void => { if (attempt.current !== undefined) void perform(attempt.current); };
  const reload = (): void => { void readCurrent().catch(() => markReadUnavailable()); };
  return Object.freeze({ read, readProblem, draft, errors, save, locked, update, reset, discard, submit, cancel, retry, reload,
    dirtyCount: Object.keys(draft).length, uncertain: save.state === "unconfirmed", saving: save.state === "saving" });
}
