import { useCallback,useEffect,useEffectEvent,useMemo,useRef,useState,useSyncExternalStore } from "react";
import { deriveSettingsPatchFingerprint } from "../../../../models/config/settings.js";
import { EditableSettingsWireSchema,type EditableSettingsWire } from "../../../../models/dashboard/settings-editor.js";
import { createErrorCatalogFailure,formatErrorCatalogFailure } from "../../../../models/failures/error-catalog.js";
import { SettingsCommandRequestSchema } from "../../../../rules/commands/commands.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { deepFreeze } from "../../../../rules/validation/immutability.js";
import type { CommandExecutionOptions } from "../../../app/commands/command-executor.js";
import { readWithDeadline } from "../../../client/read-deadline.js";
import { useDashboardCommandBinding } from "../../../state/client-context.js";
import { SettingsReadSuperseded,useSettingsRead } from "../../../state/settings-read-model.js";
import { useProtectedSettings } from "../providers/settings-protected-model.js";
import { routePresentation } from "../routes/settings-routes-model.js";
import { settingTitle } from "../settings-presentation.js";
import { checkedSettingsResult,commandSaveState,ordinaryReadbackState,settingsSaveNotice,settingsSaveFailure,type OrdinarySettingsAttempt,type SettingsSaveListener,type SettingsSaveProblemListener,type SettingsSaveState } from "./settings-attempt-model.js";
import { blurredSettingsPath,type SettingsBlurEvent } from "./settings-autosave-model.js";
import { useSettingsClient } from "./settings-client.js";
import { readBack } from "../../../app/commands/command-readback.js";
import { coupledSettingsLeaves,draftError,ordinaryReadbackConfirms,patchFromSettingsDraft,settingInput,settingsLeaves,type SettingsDraft,type SettingsDraftInput } from "./settings-draft-model.js";

export type EditableSettingsState = { readonly state: "loading" } | { readonly state: "failed"; readonly message: string } | { readonly state: "loaded"; readonly document: EditableSettingsWire };
export type { SettingsSaveState } from "./settings-attempt-model.js";

/** Ordinary Settings never lock or show a save row: the control keeps the new value while the save runs. */
const IDLE_SAVE: SettingsSaveState = Object.freeze({ state: "idle" });

/** One ordinary atomic draft, independent protected draft, no browser-persisted values or attempts. */
export function useEditableSettings(input: Readonly<{ actorId: string; descriptorFingerprint: string; view?: string; onSaved?: SettingsSaveListener; onSaveProblem?: SettingsSaveProblemListener }>) {
  const client = useSettingsClient();
  const binding = useDashboardCommandBinding();
  const generation = useRef<object>({});
  // Each section visit is its own read: leaving one retires its read, and only the visit that started a read may accept it.
  const request = useMemo(() => ({ client, scope: binding?.scope, actorId: input.actorId, descriptorFingerprint: input.descriptorFingerprint, view: input.view }), [client, binding?.scope, input.actorId, input.descriptorFingerprint, input.view]);
  const acceptedRequest = useRef<typeof request | undefined>(undefined);
  generation.current = request;
  useEffect(() => { generation.current = request; return () => { if (generation.current === request) generation.current = {}; }; }, [request]);
  const resource = useSettingsRead<EditableSettingsWire>(client, "editor", input);
  const previousRead = useRef({ request, resource });
  if (previousRead.current.request !== request) {
    if (previousRead.current.resource === resource) resource.supersede();
    previousRead.current = { request, resource };
  }
  const observation = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const stale = useSyncExternalStore(resource.subscribe, resource.stale, resource.stale);
  const held = observation.value;
  const [observed, setObserved] = useState<{ resource: typeof resource; editor: EditableSettingsState }>({ resource, editor: held === undefined ? { state: "loading" } : { state: "loaded", document: held } });
  // A document the shared read settled since (a fresh read after a reset, a preference save's readback) replaces the shown one.
  const editor = useMemo<EditableSettingsState>(() => observation.state === "loaded" && (observed.resource !== resource || observed.editor.state !== "loaded" || observed.editor.document !== observation.value)
    ? { state: "loaded", document: observation.value }
    : observed.resource === resource ? observed.editor : held === undefined ? { state: "loading" } : { state: "loaded", document: held }, [observed, resource, held, observation]);
  const setEditor = useCallback((editor: EditableSettingsState): void => setObserved({ resource, editor }), [resource]);
  const [reportedReadProblem, setReadProblem] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<SettingsDraft>({});
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  /** Toggles and choices save without the typing wait; the last change decides. */
  const saveAtOnce = useRef(false);
  // Edits wait for a fresh read of what is shown: a kept copy, or a document the resource has since replaced, decides nothing.
  const readReady = acceptedRequest.current === request && observation.state === "loaded" && editor.state === "loaded" && editor.document === observation.value;
  const readProblem = reportedReadProblem;
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
      const document = await (publish ? resource.read(read, "SETTINGS_INITIAL_READ_UNAVAILABLE") : readWithDeadline(read, "SETTINGS_INITIAL_READ_UNAVAILABLE"));
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
  const protectedEditor = useProtectedSettings({ actorId: input.actorId, readReady: readReady && readProblem === undefined, document: editor.state === "loaded" ? editor.document : undefined, refresh, readCurrent: () => refresh(false), acceptReadback: document => { if (generation.current !== request) return; acceptedRequest.current = request; resource.accept(document); setEditor({ state: "loaded", document }); setReadProblem(undefined); }, onSaved: input.onSaved, onSaveProblem: input.onSaveProblem });
  const leaves = editor.state === "loaded" ? settingsLeaves(editor.document) : [];
  const errors = Object.fromEntries(Object.entries(draft).map(([path, operation]) => {
    const leaf = leaves.find(candidate => candidate.path === path);
    return [path, leaf === undefined ? "This setting is no longer served. Reset its draft." : draftError(leaf, operation)];
  }));
  const update = (path: string, raw: SettingsDraftInput, immediate = false): void => {
    if (!readReady || readProblem !== undefined) return;
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
    if (!readReady || readProblem !== undefined) return;
    const leaf = leaves.find(candidate => candidate.path === path); if (leaf === undefined) return;
    setDraft(previous => ({ ...previous, ...Object.fromEntries(coupledSettingsLeaves(leaf, leaves).map(value => [value.path, { kind: "clear" as const }])) }));
  };
  const reset = (path: string): void => {
    if (!readReady || readProblem !== undefined) return;
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
  const failed = (sent: SettingsDraft): void => {
    settle(sent);
    input.onSaveProblem?.(settingsSaveFailure());
    // The control shows what the backend holds, never a guess about an unknown outcome.
    void refresh().catch(() => undefined);
  };
  const perform = async (command: OrdinarySettingsAttempt, sent: SettingsDraft): Promise<void> => {
    if (busy.current) return;
    busy.current = true; setSaving(true);
    try {
      if (binding === undefined || command.requestedBy !== binding.scope.actorId) { failed(sent); return; }
      let readDocument: EditableSettingsWire | undefined;
      let unknown: Promise<void> | undefined;
      const saved = (replayed: boolean) => {
        settle(sent);
        input.onSaved?.(settingsSaveNotice(leaves.filter(leaf => leaf.path in command.payload.patch).map(leaf => leaf.path.startsWith("urls.") ? `${routePresentation(leaf).name} routes` : settingTitle(leaf)), replayed, readDocument?.runtimeStatus.state === "restart-required"));
      };
      const options: CommandExecutionOptions = {
        scope: binding.scope,
        readback: async (_request, reply) => {
          const result = checkedSettingsResult(command, reply);
          readDocument = await refresh(false);
          const readback = ordinaryReadbackState(command, result, readDocument);
          return { state: readback === "confirmed" ? "matched" : readback === "superseded" ? "conflict" : "mismatch", evidence: readDocument };
        },
        publish: outcome => {
          if (generation.current !== request) return;
          binding.feedback(outcome);
          if (readDocument !== undefined) {
            acceptedRequest.current = request; resource.accept(readDocument); setEditor({ state: "loaded", document: readDocument }); setReadProblem(undefined);
          }
          const next = commandSaveState(outcome);
          // An unknown outcome is read back: the served value shows silently, or one failure toast. Either way the lock is freed.
          if (next.state === "unconfirmed") {
            unknown = readBack(() => refresh(false), served => ordinaryReadbackConfirms(served, command.payload.patch)).then(served => {
              const landed = served !== undefined && ordinaryReadbackConfirms(served, command.payload.patch);
              binding.executor.resolve(command.commandId, landed, binding.scope);
              if (generation.current !== request) return;
              if (!landed || served === undefined) { failed(sent); return; }
              acceptedRequest.current = request; resource.accept(served); setEditor({ state: "loaded", document: served }); setReadProblem(undefined);
              settle(sent);
            });
            return;
          }
          if (next.state !== "applied") { failed(sent); return; }
          saved(next.replayed);
        },
      };
      await binding.executor.execute(command, options);
      await unknown;
    } finally { busy.current = false; setSaving(false); }
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
  return Object.freeze({ editor, refreshing: observation.state === "loading", draft, errors, save: IDLE_SAVE, protectedEditor, leaves, readProblem,
    dirtyCount: Object.keys(draft).length, locked: !readReady || readProblem !== undefined,
    update, reset, clear, discard, submit, reload, onFieldBlur, readCurrent: () => refresh() });
}
