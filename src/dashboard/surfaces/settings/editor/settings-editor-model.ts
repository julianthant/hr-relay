import { useCallback,useEffect,useEffectEvent,useMemo,useRef,useState,useSyncExternalStore } from "react";
import { deriveSettingsPatchFingerprint } from "../../../../models/config/settings.js";
import { EditableSettingsWireSchema,type EditableSettingsWire } from "../../../../models/dashboard/settings-editor.js";
import { createErrorCatalogFailure,formatErrorCatalogFailure } from "../../../../models/failures/error-catalog.js";
import { SettingsCommandRequestSchema } from "../../../../rules/commands/commands.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { deepFreeze } from "../../../../rules/validation/immutability.js";
import type { CommandExecutionOptions } from "../../../app/commands/command-executor.js";
import { readWithDeadline } from "../../../client/read-deadline.js";
import { settingsRowAt } from "../../../client/subscriptions/row-store.js";
import { useDashboardCommandBinding } from "../../../state/client-context.js";
import { SettingsReadSuperseded,useSettingsRead } from "../../../state/settings-read-model.js";
import { useProtectedSettings } from "../providers/settings-protected-model.js";
import { routePresentation } from "../routes/settings-routes-model.js";
import { settingTitle } from "../settings-presentation.js";
import { checkedSettingsResult,commandSaveState,keepNewerProtected,ordinaryReadbackState,settingsSaveNotice,settingsSaveFailure,type OrdinarySettingsAttempt,type SettingsSaveListener,type SettingsSaveProblemListener,type SettingsSaveState } from "./settings-attempt-model.js";
import { blurredSettingsPath,type SettingsBlurEvent } from "./settings-autosave-model.js";
import { useSettingsClient } from "./settings-client.js";
import { readBack } from "../../../app/commands/command-readback.js";
import { coupledSettingsLeaves,draftError,ordinaryReadbackConfirms,patchFromSettingsDraft,settingInput,settingsLeaves,type SettingsDraft,type SettingsDraftInput } from "./settings-draft-model.js";

export type EditableSettingsState = { readonly state: "loading" } | { readonly state: "failed"; readonly message: string } | { readonly state: "loaded"; readonly document: EditableSettingsWire };
export type { SettingsSaveState } from "./settings-attempt-model.js";

/** Ordinary Settings never lock or show a save row: the control keeps the new value while the save runs. */
const IDLE_SAVE: SettingsSaveState = Object.freeze({ state: "idle" });
const noRows = (): (() => void) => () => undefined;

/** One ordinary atomic draft, independent protected draft, no browser-persisted values or attempts. */
export function useEditableSettings(input: Readonly<{ actorId: string; descriptorFingerprint: string; onSaved?: SettingsSaveListener; onSaveProblem?: SettingsSaveProblemListener }>) {
  const client = useSettingsClient();
  const binding = useDashboardCommandBinding();
  const generation = useRef<object>({});
  // One Settings visit is one read: switching sections reuses it, and leaving Settings retires it.
  const request = useMemo(() => ({ client, scope: binding?.scope, actorId: input.actorId, descriptorFingerprint: input.descriptorFingerprint }), [client, binding?.scope, input.actorId, input.descriptorFingerprint]);
  const acceptedRequest = useRef<typeof request | undefined>(undefined);
  generation.current = request;
  const currentRequest = useRef(request);
  currentRequest.current = request;
  useEffect(() => { generation.current = request; return () => { if (generation.current === request) generation.current = {}; }; }, [request]);
  // A command outlives the section it was sent from: it settles while the same authority holds, whatever section is open.
  const commandOwner = useMemo(() => ({ client, scope: binding?.scope, actorId: input.actorId, descriptorFingerprint: input.descriptorFingerprint }), [client, binding?.scope, input.actorId, input.descriptorFingerprint]);
  const commandLife = useRef<object>(commandOwner);
  commandLife.current = commandOwner;
  useEffect(() => { commandLife.current = commandOwner; return () => { if (commandLife.current === commandOwner) commandLife.current = {}; }; }, [commandOwner]);
  // Leaving a visit (another section, or closing Settings) retires the read it started; a read another owner started is not its to retire.
  const visitRead = useRef<AbortController | undefined>(undefined);
  useEffect(() => { const controller = new AbortController(); visitRead.current = controller; return () => { controller.abort(); }; }, [request]);
  const resource = useSettingsRead<EditableSettingsWire>(client, "editor", input);
  const previousRead = useRef({ request, resource });
  if (previousRead.current.request !== request) {
    if (previousRead.current.resource === resource) resource.supersede();
    previousRead.current = { request, resource };
  }
  const observation = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const stale = useSyncExternalStore(resource.subscribe, resource.stale, resource.stale);
  const held = observation.value;
  const [observed, setObserved] = useState<{ resource: typeof resource; stale: number; editor: EditableSettingsState }>({ resource, stale, editor: held === undefined ? { state: "loading" } : { state: "loaded", document: held } });
  const staleRef = useRef(stale);
  staleRef.current = stale;
  // A document the shared read settled since (a fresh read after a reset, a preference save's readback) replaces the shown one.
  const shownEditor = useMemo<EditableSettingsState>(() => observation.state === "loaded" && (observed.resource !== resource || observed.editor.state !== "loaded" || observed.editor.document !== observation.value)
    ? { state: "loaded", document: observation.value }
    : observed.resource === resource && observed.stale === stale ? observed.editor : held === undefined ? { state: "loading" } : { state: "loaded", document: held }, [observed, resource, held, observation, stale]);
  const setEditor = useCallback((editor: EditableSettingsState): void => setObserved({ resource, stale: staleRef.current, editor }), [resource]);
  const [reportedReadProblem, setReadProblem] = useState<string | undefined>(undefined);
  // The stream's settings row: another session's commit, and the document a save's readback joins its reply to.
  const rowStore = binding?.authority.dayState.rows;
  const streamStopped = binding?.authority.dayState.connection.state === "stopped";
  const subscribeRows = useCallback((listener: () => void) => rowStore?.subscribe(listener) ?? noRows(), [rowStore]);
  const readRows = useCallback(() => rowStore?.settings(), [rowStore]);
  const streamed = useSyncExternalStore(subscribeRows, readRows, readRows);
  const stream = useRef({ rows: rowStore, stopped: streamStopped });
  stream.current = { rows: rowStore, stopped: streamStopped };
  const rowWaiters = useRef(new Set<() => void>());
  useEffect(() => { for (const check of [...rowWaiters.current]) check(); }, [rowStore, streamStopped]);
  // A first row the stream could not read, with nothing shown yet, is the initial read's failure.
  const streamUnavailable = streamed?.unavailable === true;
  const editor = useMemo<EditableSettingsState>(() => streamUnavailable && shownEditor.state === "loading"
    ? { state: "failed", message: formatErrorCatalogFailure(createErrorCatalogFailure("SETTINGS_INITIAL_READ_UNAVAILABLE", {})).text } : shownEditor, [streamUnavailable, shownEditor]);
  const [draft, setDraft] = useState<SettingsDraft>({});
  const [saving, setSaving] = useState(false);
  /** The paths of the command in flight: only their rows show a spinner. */
  const [savingPaths, setSavingPaths] = useState<readonly string[]>([]);
  const busy = useRef(false);
  /** Toggles and choices save without the typing wait; the last change decides. */
  const saveAtOnce = useRef(false);
  // Fields stay editable while a read is in flight; a save waits for a fresh read of what is shown, since a kept copy decides nothing.
  const readReady = acceptedRequest.current === request && observation.state === "loaded" && editor.state === "loaded" && editor.document === observation.value;
  // A row the stream could not read keeps the shown document display-only until the next good row.
  const readProblem = reportedReadProblem ?? (streamed?.unavailable === true
    ? formatErrorCatalogFailure(createErrorCatalogFailure("SETTINGS_REFRESH_UNAVAILABLE", {})).text : undefined);
  // A document this visit's authority verified stays editable through a re-read; only a read problem, or a document this authority's read does not hold, locks it.
  const verified = editor.state === "loaded" && (acceptedRequest.current === request || editor.document === observation.value);
  const editable = verified && readProblem === undefined;
  const refresh = useCallback(async (publish = true): Promise<EditableSettingsWire> => {
    try {
      const read = async (): Promise<EditableSettingsWire> => {
        const document = EditableSettingsWireSchema.parse(await client.editableSettings());
        const previous = resource.snapshot().value;
        if (previous !== undefined && (previous.revision > document.revision
          || previous.revision === document.revision && (previous.settingsFingerprint !== document.settingsFingerprint
            || canonicalJsonStringify(settingsLeaves(previous).map(leaf => [leaf.path, leaf.settingsValue ?? null]))
              !== canonicalJsonStringify(settingsLeaves(document).map(leaf => [leaf.path, leaf.settingsValue ?? null])))
          || (previous.protectedSettings.state === "available" && document.protectedSettings.state === "available"
            && (previous.protectedSettings.readback.revision > document.protectedSettings.readback.revision
              || previous.protectedSettings.readback.revision === document.protectedSettings.readback.revision
                && (canonicalJsonStringify(previous.protectedSettings.readback) !== canonicalJsonStringify(document.protectedSettings.readback)
                  || canonicalJsonStringify(previous.protectedSettings.entries) !== canonicalJsonStringify(document.protectedSettings.entries)))))) throw new Error("settings-readback-stale-or-divergent");
        return document;
      };
      const document = await (publish ? resource.read(read, "SETTINGS_INITIAL_READ_UNAVAILABLE", undefined, visitRead.current?.signal) : readWithDeadline(read, "SETTINGS_INITIAL_READ_UNAVAILABLE"));
      if (publish && generation.current === request) { acceptedRequest.current = request; resource.accept(document); setEditor({ state: "loaded", document }); setReadProblem(undefined); }
      return document;
    } catch (error) {
      if (error instanceof SettingsReadSuperseded) throw error;
      if (publish && generation.current === request) setReadProblem(formatErrorCatalogFailure(createErrorCatalogFailure("SETTINGS_REFRESH_UNAVAILABLE", {})).text);
      throw new Error("settings-read-unavailable", { cause: error });
    }
  }, [client, request, resource, setEditor]);
  useEffect(() => {
    let active = true;
    void refresh().catch(() => { if (active && resource.snapshot().value === undefined) setEditor({ state: "failed", message: formatErrorCatalogFailure(createErrorCatalogFailure("SETTINGS_INITIAL_READ_UNAVAILABLE", {})).text }); });
    return () => { active = false; };
    // A section return and a stream reset read again; the shown document stays, locked, until the fresh one lands.
  }, [refresh, resource, setEditor, stale]);
  const keepProtected = useCallback((document: EditableSettingsWire): EditableSettingsWire => keepNewerProtected(document, resource.snapshot().value), [resource]);
  // A row above the shown document replaces it; with nothing shown, only once the editor's own read has failed.
  useEffect(() => {
    const document = streamed?.document;
    if (document === undefined || streamed?.unavailable === true || generation.current !== request) return;
    const shown = resource.snapshot().value;
    if (shown === undefined ? editor.state !== "failed" : document.revision <= shown.revision) return;
    const accepted = keepProtected(document);
    acceptedRequest.current = request; resource.accept(accepted); setEditor({ state: "loaded", document: accepted }); setReadProblem(undefined);
  }, [streamed, request, resource, editor.state, setEditor, keepProtected]);
  const protectedEditor = useProtectedSettings({ actorId: input.actorId, readReady: readReady && reportedReadProblem === undefined, editable: verified && reportedReadProblem === undefined, document: editor.state === "loaded" ? editor.document : undefined, refresh, readCurrent: () => refresh(false), acceptReadback: document => { if (generation.current !== request) return; acceptedRequest.current = request; resource.accept(document); setEditor({ state: "loaded", document }); setReadProblem(undefined); }, onSaved: input.onSaved, onSaveProblem: input.onSaveProblem });
  const leaves = editor.state === "loaded" ? settingsLeaves(editor.document) : [];
  const errors = Object.fromEntries(Object.entries(draft).map(([path, operation]) => {
    const leaf = leaves.find(candidate => candidate.path === path);
    return [path, leaf === undefined ? "This setting is no longer served. Reset its draft." : draftError(leaf, operation)];
  }));
  const update = (path: string, raw: SettingsDraftInput, immediate = false): void => {
    if (!editable) return;
    saveAtOnce.current = immediate;
    const leaf = leaves.find(candidate => candidate.path === path); if (leaf === undefined) return;
    setDraft(previous => {
      const next = { ...previous };
      for (const coupled of coupledSettingsLeaves(leaf, leaves)) {
        if (next[coupled.path] === undefined || next[coupled.path]?.kind === "clear") next[coupled.path] = { kind: "set", raw: settingInput(coupled), companion: true };
      }
      next[path] = { kind: "set", raw }; return next;
    });
  };
  const clear = (path: string): void => {
    if (!editable) return;
    const leaf = leaves.find(candidate => candidate.path === path); if (leaf === undefined) return;
    setDraft(previous => ({ ...previous, ...Object.fromEntries(coupledSettingsLeaves(leaf, leaves).map(value => [value.path, { kind: "clear" as const }])) }));
  };
  const reset = (path: string): void => {
    if (!editable) return;
    const leaf = leaves.find(candidate => candidate.path === path); if (leaf === undefined) return;
    setDraft(previous => {
      const next = { ...previous };
      const coupled = coupledSettingsLeaves(leaf, leaves);
      const keep = previous[path]?.kind !== "clear" && coupled.some(other => { const operation = next[other.path]; return other.path !== path && operation?.kind === "set" && !operation.companion; });
      if (keep) next[path] = { kind: "set", raw: settingInput(leaf), companion: true };
      else for (const other of coupled) delete next[other.path];
      return next;
    });
  };
  /** Drops every unsaved edit when the operator chooses to leave Settings without saving. */
  const discard = (): void => setDraft({});
  /** Drops only what this save sent; an edit made while it was in flight stays and saves next. */
  const settle = (sent: SettingsDraft): void => setDraft(previous => Object.fromEntries(Object.entries(previous).filter(([path, operation]) => sent[path] !== operation)));
  const failed = (sent: SettingsDraft, held = false): void => {
    settle(sent);
    input.onSaveProblem?.(settingsSaveFailure());
    // The control shows what the backend holds, never a guess about an unknown outcome; a readback row already holds it.
    if (!held) void refresh().catch(() => undefined);
  };
  const perform = async (command: OrdinarySettingsAttempt, sent: SettingsDraft): Promise<void> => {
    if (busy.current) return;
    busy.current = true; setSaving(true); setSavingPaths(Object.keys(sent));
    try {
      if (binding === undefined || command.requestedBy !== binding.scope.actorId) { failed(sent); return; }
      let readDocument: EditableSettingsWire | undefined;
      // The reply landed but no row answered it: the save ends unresolved, with no read of Settings.
      let joinFailure: unknown;
      const saved = (replayed: boolean) => {
        settle(sent);
        input.onSaved?.(settingsSaveNotice(leaves.filter(leaf => leaf.path in command.payload.patch).map(leaf => leaf.path.startsWith("urls.") ? `${routePresentation(leaf).name} routes` : settingTitle(leaf)), replayed, readDocument?.runtimeStatus.state === "restart-required"));
      };
      const options: CommandExecutionOptions = {
        scope: binding.scope,
        readback: async (_request, reply) => {
          const result = checkedSettingsResult(command, reply);
          if ((result.state !== "applied" && result.state !== "already-applied") || result.settingsRevision === undefined) throw new Error("settings-result-unconfirmed");
          const rows = stream.current.rows;
          try {
            readDocument = keepProtected(await settingsRowAt(rows, result.settingsRevision, () => stream.current.rows !== rows || stream.current.stopped, rowWaiters.current));
          } catch (error) { joinFailure = error; throw error; }
          const readback = ordinaryReadbackState(command, result, readDocument);
          return { state: readback === "confirmed" ? "matched" : readback === "superseded" ? "conflict" : "mismatch", evidence: readDocument };
        },
        publish: outcome => {
          if (commandLife.current !== commandOwner) return;
          binding.feedback(outcome);
          if (readDocument !== undefined) {
            // A protected save may have landed while this readback waited.
            readDocument = keepProtected(readDocument);
            acceptedRequest.current = currentRequest.current; resource.accept(readDocument); setEditor({ state: "loaded", document: readDocument }); setReadProblem(undefined);
          }
          const next = commandSaveState(outcome);
          if (next.state === "unconfirmed") return;
          if (next.state !== "applied") { failed(sent, readDocument !== undefined); return; }
          saved(next.replayed);
        },
      };
      const outcome = await binding.executor.execute(command, options);
      if (commandSaveState(outcome).state !== "unconfirmed") return;
      if (joinFailure !== undefined) {
        // Frees the lock so the next edit reaches Relay; the editor shows the last held row and the save problem.
        binding.executor.resolve(command.commandId, false, binding.scope);
        if (commandLife.current !== commandOwner) return;
        const held = stream.current.rows?.settings()?.document;
        const shown = resource.snapshot().value;
        if (held !== undefined && (shown === undefined || held.revision > shown.revision)) {
          const accepted = keepProtected(held);
          acceptedRequest.current = currentRequest.current; resource.accept(accepted); setEditor({ state: "loaded", document: accepted });
        }
        failed(sent, true);
        return;
      }
      // Release the command reservation even if the editor that sent it has closed.
      const served = await readBack<EditableSettingsWire | undefined>(() => binding.executor.isCurrentAuthority(binding.scope) ? refresh(false) : Promise.resolve(undefined),
        document => document === undefined || ordinaryReadbackConfirms(document, command.payload.patch));
      if (!binding.executor.isCurrentAuthority(binding.scope)) return;
      const landed = served !== undefined && ordinaryReadbackConfirms(served, command.payload.patch);
      binding.executor.resolve(command.commandId, landed, binding.scope);
      if (commandLife.current !== commandOwner) return;
      if (!landed) { failed(sent); return; }
      acceptedRequest.current = currentRequest.current; resource.accept(served); setEditor({ state: "loaded", document: served }); setReadProblem(undefined);
      settle(sent);
    } finally { busy.current = false; setSaving(false); setSavingPaths([]); }
  };

  const submit = (): void => {
    if (!readReady || editor.state !== "loaded" || busy.current || Object.keys(draft).length === 0 || Object.values(errors).some(error => error !== undefined) || readProblem !== undefined) return;
    if (binding === undefined) { failed(draft); return; }
    try {
      const patch = patchFromSettingsDraft(leaves, draft);
      const command = deepFreeze(SettingsCommandRequestSchema.parse({ commandId: crypto.randomUUID(), requestedAt: binding.authority.now(), requestedBy: binding.scope.actorId, source: "settings-surface", family: "settings", type: "apply-settings",
        target: { expectedRevision: editor.document.revision }, payload: { settingsSchemaHash: editor.document.settingsSchemaHash, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } }));
      void perform(command, draft);
    } catch { failed(draft); }
  };
  const autosave = useEffectEvent(submit);
  const invalid = Object.values(errors).some(error => error !== undefined);
  useEffect(() => {
    if (!readReady || editor.state !== "loaded" || saving || readProblem !== undefined
      || Object.keys(draft).length === 0 || invalid) return;
    if (saveAtOnce.current) { autosave(); return; }
    const timer = window.setTimeout(() => autosave(), 700);
    return () => window.clearTimeout(timer);
  }, [draft, editor, invalid, readProblem, readReady, saving]);
  const onFieldBlur = (event: SettingsBlurEvent): void => {
    const path = blurredSettingsPath(event);
    if (path === undefined) return;
    if (path.startsWith("protected.")) {
      if (protectedEditor.save.state === "idle" && !protectedEditor.explicitSave) protectedEditor.submit();
    } else if (!busy.current && Object.keys(draft).some(key => path === key || path.startsWith(`${key}.`))) submit();
  };
  const reload = (): void => { void refresh().catch(() => undefined); };
  return Object.freeze({ editor, savingPaths, refreshing: observation.state === "loading", draft, errors, save: IDLE_SAVE, protectedEditor, leaves, readProblem,
    dirtyCount: Object.keys(draft).length, locked: !editable,
    update, reset, clear, discard, submit, reload, onFieldBlur, readCurrent: () => refresh() });
}
