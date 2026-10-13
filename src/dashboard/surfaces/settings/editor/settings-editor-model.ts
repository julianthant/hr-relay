import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { deepFreeze } from "../../../../rules/validation/immutability.js";
import { SettingsCommandRequestSchema } from "../../../../rules/commands/commands.js";
import { deriveSettingsPatchFingerprint } from "../../../../models/config/settings.js";
import { EditableSettingsWireSchema, type EditableSettingsWire } from "../../../../models/dashboard/settings-editor.js";
import { settingTitle } from "../settings-presentation.js";
import { routePresentation } from "../routes/settings-routes-model.js";
import { useSettingsClient } from "./settings-client.js";
import type { CommandExecutionOptions, CommandExecutionScope } from "../../../app/commands/command-executor.js";
import { useDashboardCommandBinding } from "../../../state/client-context.js";
import { useSettingsPreflight } from "../preflight/settings-preflight-model.js";
import { useProtectedSettings } from "../providers/settings-protected-model.js";
import { useStorageRelocation } from "../general/settings-relocation-model.js";
import { checkedSettingsResult, commandSaveState, settingsScopeRecoveryState, ordinaryReadbackState, settingsSaveNotice, settingsSaveProblem, type SettingsSaveListener, type SettingsSaveProblemListener, type OrdinarySettingsAttempt, type SettingsSaveState } from "./settings-attempt-model.js";
import { blurredSettingsPath, type SettingsBlurEvent } from "./settings-autosave-model.js";
import { coupledSettingsLeaves, draftError, patchFromSettingsDraft, settingInput, settingsLeaves, type SettingsDraft, type SettingsDraftInput } from "./settings-draft-model.js";

export type EditableSettingsState = { readonly state: "loading" } | { readonly state: "failed"; readonly message: string } | { readonly state: "loaded"; readonly document: EditableSettingsWire };
export type { SettingsSaveState } from "./settings-attempt-model.js";
export type { PreflightRerunState } from "../preflight/settings-preflight-model.js";

/** One ordinary atomic draft, independent protected draft, no browser-persisted values or attempts. */
export function useEditableSettings(input: Readonly<{ actorId: string; descriptorFingerprint: string; onSaved?: SettingsSaveListener; onSaveProblem?: SettingsSaveProblemListener }>) {
  const client = useSettingsClient();
  const binding = useDashboardCommandBinding();
  const generation = useRef<object>({});
  const request = useMemo(() => ({ client, scope: binding?.scope }), [client, binding?.scope]);
  generation.current = request;
  useEffect(() => () => { if (generation.current === request) generation.current = {}; }, [request]);
  const [editor, setEditor] = useState<EditableSettingsState>({ state: "loading" });
  const current = useRef<EditableSettingsWire | undefined>(undefined);
  const [readProblem, setReadProblem] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<SettingsDraft>({});
  const [save, setSave] = useState<SettingsSaveState>({ state: "idle" });
  const pending = useRef<OrdinarySettingsAttempt | undefined>(undefined);
  const busy = useRef(false);
  const attemptScope = useRef<CommandExecutionScope | undefined>(undefined);
  const retained = binding?.executor.retainedAttempts().find(attempt => (attempt.state === "pending" || attempt.outcome?.kind === "uncertain") && attempt.scope.actorId === binding.scope.actorId
    && attempt.request.family === "settings" && attempt.request.type === "apply-settings");
  if (pending.current === undefined && retained?.request.family === "settings" && retained.request.type === "apply-settings") pending.current = retained.request;
  if (attemptScope.current === undefined && retained !== undefined) attemptScope.current = retained.scope;
  const { preflight, rerunPreflight } = useSettingsPreflight(editor, input);
  const refresh = useCallback(async (publish = true): Promise<EditableSettingsWire> => {
    try {
      const document = EditableSettingsWireSchema.parse(await client.editableSettings());
      const previous = current.current;
      if (previous !== undefined && (previous.revision > document.revision
        || (previous.protectedSettings.state === "available" && document.protectedSettings.state === "available" && previous.protectedSettings.readback.revision > document.protectedSettings.readback.revision))) throw new Error("settings-readback-stale");
      if (publish && generation.current === request) { current.current = document; setEditor({ state: "loaded", document }); setReadProblem(undefined); }
      return document;
    } catch {
      if (publish && generation.current === request) setReadProblem("Current settings could not be read. Your drafts are retained.");
      throw new Error("settings-read-unavailable");
    }
  }, [client, request]);
  useEffect(() => {
    let active = true;
    void refresh().catch(() => { if (active && current.current === undefined) setEditor({ state: "failed", message: "Settings could not be read. Try again." }); });
    return () => { active = false; };
  }, [refresh]);
  const protectedEditor = useProtectedSettings({ actorId: input.actorId, readReady: readProblem === undefined, document: editor.state === "loaded" ? editor.document : undefined, refresh, readCurrent: () => refresh(false), acceptReadback: document => { current.current = document; setEditor({ state: "loaded", document }); setReadProblem(undefined); }, onSaved: input.onSaved, onSaveProblem: input.onSaveProblem });
  const relocationEditor = useStorageRelocation({ actorId: input.actorId, onSaved: input.onSaved });
  const leaves = editor.state === "loaded" ? settingsLeaves(editor.document) : [];
  const errors = Object.fromEntries(Object.entries(draft).map(([path, operation]) => {
    const leaf = leaves.find(candidate => candidate.path === path);
    return [path, leaf === undefined ? "This setting is no longer served. Reset its draft." : draftError(leaf, operation)];
  }));
  const update = (path: string, raw: SettingsDraftInput): void => {
    if (busy.current || pending.current !== undefined) return;
    const leaf = leaves.find(candidate => candidate.path === path); if (leaf === undefined) return;
    setDraft(previous => {
      const next = { ...previous };
      for (const coupled of coupledSettingsLeaves(leaf, leaves)) {
        if (next[coupled.path] === undefined || next[coupled.path]?.kind === "clear") next[coupled.path] = { kind: "set", raw: settingInput(coupled), companion: true };
      }
      next[path] = { kind: "set", raw }; return next;
    });
    setSave({ state: "idle" });
  };
  const clear = (path: string): void => {
    if (busy.current || pending.current !== undefined) return;
    const leaf = leaves.find(candidate => candidate.path === path); if (leaf === undefined) return;
    setDraft(previous => ({ ...previous, ...Object.fromEntries(coupledSettingsLeaves(leaf, leaves).map(value => [value.path, { kind: "clear" as const }])) }));
    setSave({ state: "idle" });
  };
  const reset = (path: string): void => {
    if (busy.current || pending.current !== undefined) return;
    const leaf = leaves.find(candidate => candidate.path === path); if (leaf === undefined) return;
    setDraft(previous => {
      const next = { ...previous };
      const coupled = coupledSettingsLeaves(leaf, leaves);
      const keep = previous[path]?.kind !== "clear" && coupled.some(other => { const operation = next[other.path]; return other.path !== path && operation?.kind === "set" && !operation.companion; });
      if (keep) next[path] = { kind: "set", raw: settingInput(leaf), companion: true };
      else for (const other of coupled) delete next[other.path];
      return next;
    });
    setSave({ state: "idle" });
  };
  const discard = (): void => {
    if (busy.current) return;
    pending.current = undefined; setDraft({}); setSave({ state: "idle" });
  };
  const perform = async (command: OrdinarySettingsAttempt): Promise<void> => {
    if (busy.current) return;
    busy.current = true; pending.current = command; setSave({ state: "saving" });
    if (binding === undefined) {
      busy.current = false; pending.current = undefined;
      setSave(commandSaveState(undefined)); return;
    }
    attemptScope.current = binding.scope;
    let readDocument: EditableSettingsWire | undefined;
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
        if (outcome.kind === "conflict") void refresh().catch(() => undefined);
        if (readDocument !== undefined) {
          current.current = readDocument; setEditor({ state: "loaded", document: readDocument }); setReadProblem(undefined);
        }
        if (outcome.kind !== "uncertain" && !(outcome.kind === "refused" && outcome.reason === "locked")) pending.current = undefined;
        const next = outcome.kind === "refused" && outcome.reason === "locked" ? settingsScopeRecoveryState() : commandSaveState(outcome);
        setSave(next);
        if (outcome.kind === "confirmed") {
          setDraft({});
          input.onSaved?.(settingsSaveNotice(leaves.filter(leaf => leaf.path in command.payload.patch).map(leaf => leaf.path.startsWith("urls.") ? `${routePresentation(leaf).name} routes` : settingTitle(leaf)), next.state === "applied" && next.replayed, readDocument?.runtimeStatus.state === "restart-required"));
        }
        const problem = settingsSaveProblem(next);
        if (problem) input.onSaveProblem?.(problem);
      },
    };
    try {
      if (binding.executor.retainedAttempts().some(attempt => attempt.request.commandId === command.commandId)) await binding.executor.replay(command.commandId, options);
      else await binding.executor.execute(command, options);
    } finally { busy.current = false; }
  };

  const submit = (): void => {
    if (editor.state !== "loaded" || busy.current || pending.current !== undefined || Object.keys(draft).length === 0 || Object.values(errors).some(error => error !== undefined) || readProblem !== undefined) return;
    if (binding === undefined) { setSave(commandSaveState(undefined)); return; }
    try {
      const patch = patchFromSettingsDraft(leaves, draft);
      const command = deepFreeze(SettingsCommandRequestSchema.parse({ commandId: crypto.randomUUID(), requestedAt: binding.authority.nowIso, requestedBy: binding.scope.actorId, source: "settings-surface", family: "settings", type: "apply-settings",
        target: { expectedRevision: editor.document.revision }, payload: { settingsSchemaHash: editor.document.settingsSchemaHash, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } }));
      void perform(command);
    } catch { setSave({ state: "refused", message: "Check the draft values. No request was sent." }); }
  };
  const autosave = useEffectEvent(submit);
  useEffect(() => {
    if (editor.state !== "loaded" || save.state !== "idle" || readProblem !== undefined
      || Object.keys(draft).length === 0 || Object.values(errors).some(error => error !== undefined)) return;
    const timer = window.setTimeout(() => autosave(), 700);
    return () => window.clearTimeout(timer);
  }, [draft, editor, errors, readProblem, save.state]);
  const retry = (): void => { if (pending.current !== undefined) void perform(pending.current); };
  const onFieldBlur = (event: SettingsBlurEvent): void => {
    const path = blurredSettingsPath(event);
    if (path === undefined) return;
    if (path.startsWith("protected.")) {
      if (protectedEditor.save.state === "idle") protectedEditor.submit();
    } else if (save.state === "idle" && Object.keys(draft).some(key => path === key || path.startsWith(`${key}.`))) submit();
  };
  const reload = (): void => { void refresh().catch(() => undefined); };
  const visibleSave = pending.current !== undefined && attemptScope.current !== binding?.scope ? settingsScopeRecoveryState() : save.state === "idle" && retained?.outcome !== undefined ? commandSaveState(retained.outcome) : save;
  return Object.freeze({ editor, draft, errors, save: visibleSave, preflight, protectedEditor, relocationEditor, leaves, readProblem,
    dirtyCount: Object.keys(draft).length, locked: save.state === "saving" || pending.current !== undefined,
    update, reset, clear, discard, submit, retry, reload, rerunPreflight, onFieldBlur });
}
