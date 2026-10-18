import { SettingsReadSuperseded, useSettingsRead } from "../../../state/settings-read-model.js";
import { readWithDeadline } from "../../../client/read-deadline.js";
import type { CommandExecutionOptions, CommandExecutionScope } from "../../../app/commands/command-executor.js";
import { useDashboardCommandBinding } from "../../../state/client-context.js";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { deepFreeze } from "../../../../rules/validation/immutability.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import {
  StorageRelocationCommandRequestSchema, StorageRelocationPlanViewSchema,
  storageRelocationDesiredDigest, storageRelocationRequestFingerprint,
  type CommandResult, type StorageRelocationCommandRequest, type StorageRelocationPlanView,
} from "../../../../rules/commands/commands.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure, type ErrorCatalogCode } from "../../../../models/failures/error-catalog.js";
import { commandSaveState, settingsScopeRecoveryState, type SettingsSaveListener } from "../editor/settings-attempt-model.js";
import { useSettingsClient } from "../editor/settings-client.js";

type Pair = StorageRelocationPlanView["sourcePair"];
type Field = keyof Pair;
type Draft = Partial<Record<Field, string>>;
type Save = { readonly state: "idle" | "saving" | "applied" } | { readonly state: "conflict" | "refused" | "unconfirmed"; readonly code?: ErrorCatalogCode; readonly message: string };
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
export function planRelocationCommand(view: StorageRelocationPlanView, pair: Pair, actorId: string, requestedAt: string): StorageRelocationCommandRequest {
  const basis = { commandId: crypto.randomUUID(), requestedAt, requestedBy: actorId,
    source: "settings-surface" as const, family: "storage-relocation" as const, type: "plan-storage-relocation" as const,
    target: target(view), payload: { writeId: crypto.randomUUID(), desiredPair: pair,
      desiredDigest: storageRelocationDesiredDigest(target(view), pair), requestFingerprint: "0".repeat(64) } };
  return deepFreeze(StorageRelocationCommandRequestSchema.parse({ ...basis, payload: { ...basis.payload,
    requestFingerprint: storageRelocationRequestFingerprint(StorageRelocationCommandRequestSchema.parse(basis)) } }));
}
export function cancelRelocationCommand(view: StorageRelocationPlanView, actorId: string, requestedAt: string): StorageRelocationCommandRequest {
  if (view.pending === null) throw new Error("storage-relocation-no-pending-plan");
  const basis = { commandId: crypto.randomUUID(), requestedAt, requestedBy: actorId,
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

export function useStorageRelocation(input: Readonly<{ actorId: string; descriptorFingerprint?: string; onSaved?: SettingsSaveListener }>) {
  const client = useSettingsClient();
  const binding = useDashboardCommandBinding();
  const generation = useRef<object>({});
  const request = useMemo(() => ({ client, scope: binding?.scope, actorId: input.actorId, descriptorFingerprint: input.descriptorFingerprint }), [client, binding?.scope, input.actorId, input.descriptorFingerprint]);
  const acceptedRequest = useRef<typeof request | undefined>(undefined);
  generation.current = request;
  useEffect(() => { generation.current = request; return () => { if (generation.current === request) generation.current = {}; }; }, [request]);
  const resource = useSettingsRead<StorageRelocationPlanView>(client, "relocation", input);
  const previousRead = useRef({ request, resource });
  if (previousRead.current.request !== request) {
    if (previousRead.current.resource === resource) resource.supersede();
    previousRead.current = { request, resource };
  }
  const observation = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const held = observation.value;
  const [observed, setObserved] = useState<{ resource: typeof resource; read: Read }>({ resource, read: held === undefined ? { state: "loading" } : { state: "available", view: held } });
  const read = useMemo<Read>(() => observed.resource === resource ? observed.read : held === undefined ? { state: "loading" } : { state: "available", view: held }, [observed, resource, held]);
  const setRead = useCallback((read: Read): void => setObserved({ resource, read }), [resource]);
  const [reportedReadProblem, setReadProblem] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [save, setSave] = useState<Save>({ state: "idle" });
  const attempt = useRef<StorageRelocationCommandRequest | undefined>(undefined);
  const busy = useRef(false);
  const attemptScope = useRef<CommandExecutionScope | undefined>(undefined);
  const retained = binding?.executor.retainedAttempts().find(entry => (entry.state === "pending" || entry.outcome?.kind === "uncertain") && entry.scope.actorId === binding.scope.actorId && entry.request.family === "storage-relocation");
  if (attempt.current === undefined && retained?.request.family === "storage-relocation") attempt.current = retained.request;
  if (attemptScope.current === undefined && retained !== undefined) attemptScope.current = retained.scope;
  const readCurrent = useCallback(async (publish = true): Promise<StorageRelocationPlanView> => {
    const load = async (): Promise<StorageRelocationPlanView> => {
      const view = StorageRelocationPlanViewSchema.parse(await client.storageRelocationPlans());
      const previous = resource.snapshot().value;
      if (previous !== undefined && (view.installationId !== previous.installationId
        || view.revision < previous.revision || view.sourceGeneration < previous.sourceGeneration
        || (view.sourceGeneration === previous.sourceGeneration && (view.sourcePair.stateRoot !== previous.sourcePair.stateRoot
          || view.sourcePair.artifactRoot !== previous.sourcePair.artifactRoot
          || view.revision === previous.revision && canonicalJsonStringify(view) !== canonicalJsonStringify(previous))))) {
        throw new Error("storage-relocation-readback-stale-or-divergent");
      }
      return view;
    };
    const view = await (publish ? resource.read(load, "SETTINGS_INITIAL_READ_UNAVAILABLE") : readWithDeadline(load, "SETTINGS_INITIAL_READ_UNAVAILABLE"));
    if (publish && generation.current === request) { acceptedRequest.current = request; resource.accept(view); setRead({ state: "available", view }); setReadProblem(false); }
    return view;
  }, [client, request, resource, setRead]);
  const markReadUnavailable = useCallback((error?: unknown): void => { if (error instanceof SettingsReadSuperseded) return; if (resource.snapshot().value === undefined) setRead({ state: "unavailable" }); else setReadProblem(true); }, [resource, setRead]);
  useEffect(() => { void readCurrent().catch((error: unknown) => { if (generation.current === request) markReadUnavailable(error); }); }, [readCurrent, markReadUnavailable, request]);
  const readReady = acceptedRequest.current === request && observation.state === "loaded";
  const readProblem = reportedReadProblem;
  const errors = relocationDraftErrors(draft);
  const locked = !readReady || save.state === "saving" || attempt.current !== undefined || read.state !== "available" || readProblem;
  const update = (field: Field, raw: string): void => {
    if (locked || busy.current) return;
    setDraft(previous => ({ ...previous, [field]: raw })); setSave({ state: "idle" });
  };
  const reset = (field: Field): void => {
    if (locked || busy.current) return;
    setDraft(previous => { const next = { ...previous }; delete next[field]; return next; }); setSave({ state: "idle" });
  };
  const discard = (): void => { if (busy.current) return; attempt.current = undefined; setDraft({}); setSave({ state: "idle" }); };
  const perform = async (command: StorageRelocationCommandRequest): Promise<void> => {
    if (busy.current) return;
    busy.current = true; attempt.current = command; setSave({ state: "saving" });
    if (binding === undefined) { busy.current = false; attempt.current = undefined; setSave(commandSaveState(undefined)); return; }
    if (command.requestedBy !== binding.scope.actorId) { busy.current = false; setSave(settingsScopeRecoveryState()); return; }
    attemptScope.current = binding.scope;
    let view: StorageRelocationPlanView | undefined;
    const options: CommandExecutionOptions = {
      scope: binding.scope,
      readback: async (_request, reply) => {
        view = await readCurrent(false);
        const valid = !('outcome' in reply) && confirms(command, reply, view);
        return { state: valid ? "matched" : "mismatch", evidence: view };
      },
      publish: outcome => {
        if (generation.current !== request) return;
        binding.feedback(outcome);
        if (view !== undefined) { acceptedRequest.current = request; resource.accept(view); setRead({ state: "available", view }); setReadProblem(false); }
        if (outcome.kind === "conflict") void readCurrent().catch((error: unknown) => { if (generation.current === request) markReadUnavailable(error); });
        if (outcome.kind !== "uncertain" && !(outcome.kind === "refused" && outcome.reason === "locked")) attempt.current = undefined;
        const saveState = outcome.kind === "refused" && outcome.reason === "locked" ? settingsScopeRecoveryState() : commandSaveState(outcome);
        setSave(outcome.kind === "uncertain" && outcome.feedback.code === "COMMAND_OUTCOME_UNCERTAIN"
          ? { state: "unconfirmed", code: "STORAGE_RELOCATION_OUTCOME_UNCERTAIN", message: formatErrorCatalogFailure(createErrorCatalogFailure("STORAGE_RELOCATION_OUTCOME_UNCERTAIN", {})).text }
          : saveState);
        if (outcome.kind === "confirmed") {
          setDraft({});
          input.onSaved?.(command.type === "plan-storage-relocation"
            ? { title: outcome.reply !== undefined && "state" in outcome.reply && outcome.reply.state === "already-applied" ? "Location plan already saved" : "Saved location plan" }
            : { title: "Location plan cancelled" });
        }
      },
    };
    try {
      if (binding.executor.retainedAttempts().some(entry => entry.request.commandId === command.commandId)) await binding.executor.replay(command.commandId, options);
      else await binding.executor.execute(command, options);
    } finally { busy.current = false; }
  };

  const submit = (): void => {
    if (read.state !== "available" || locked || Object.keys(draft).length === 0 || Object.values(errors).some(Boolean)) return;
    const pair = desiredRelocationPair(read.view, draft);
    const previousDesired = desiredRelocationPair(read.view, {});
    if (pair.stateRoot === previousDesired.stateRoot && pair.artifactRoot === previousDesired.artifactRoot) {
      setSave({ state: "refused", code: "STORAGE_RELOCATION_DRAFT_UNCHANGED", message: formatErrorCatalogFailure(createErrorCatalogFailure("STORAGE_RELOCATION_DRAFT_UNCHANGED", {})).text }); return;
    }
    if (pair.stateRoot === read.view.sourcePair.stateRoot && pair.artifactRoot === read.view.sourcePair.artifactRoot) {
      setSave({ state: "refused", code: "STORAGE_RELOCATION_CANCEL_REQUIRED", message: formatErrorCatalogFailure(createErrorCatalogFailure("STORAGE_RELOCATION_CANCEL_REQUIRED", {})).text }); return;
    }
    try { if (binding === undefined) { setSave(commandSaveState(undefined)); return; } void perform(planRelocationCommand(read.view, pair, binding.scope.actorId, binding.authority.nowIso)); }
    catch { setSave({ state: "refused", code: "STORAGE_RELOCATION_DRAFT_INVALID", message: formatErrorCatalogFailure(createErrorCatalogFailure("STORAGE_RELOCATION_DRAFT_INVALID", {})).text }); }
  };
  const cancel = (): void => {
    if (read.state !== "available" || locked || read.view.pending === null || Object.keys(draft).length > 0) return;
    if (binding === undefined) { setSave(commandSaveState(undefined)); return; }
    void perform(cancelRelocationCommand(read.view, binding.scope.actorId, binding.authority.nowIso));
  };
  const autosave = useEffectEvent(submit);
  useEffect(() => {
    if (!readReady || read.state !== "available" || readProblem || save.state !== "idle" || Object.keys(draft).length === 0 || Object.values(errors).some(Boolean)) return;
    const timer = window.setTimeout(() => autosave(), 700);
    return () => window.clearTimeout(timer);
  }, [draft, read, readProblem, readReady, errors, save.state]);
  const retry = (): void => { if (attempt.current !== undefined) void perform(attempt.current); };
  const reload = (): void => { void readCurrent().catch((error: unknown) => { if (generation.current === request) markReadUnavailable(error); }); };
  const visibleSave = attempt.current !== undefined && attemptScope.current !== binding?.scope ? settingsScopeRecoveryState() : save.state === "idle" && retained?.outcome !== undefined ? commandSaveState(retained.outcome) : save;
  return Object.freeze({ read, refreshing: observation.state === "loading", readProblem, draft, errors, save: visibleSave, locked, update, reset, discard, submit, cancel, retry, reload,
    dirtyCount: Object.keys(draft).length, uncertain: visibleSave.state === "unconfirmed", saving: visibleSave.state === "saving" });
}
