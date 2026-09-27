import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { systemClock } from "../../domain/clock.js";
import { deepFreeze } from "../../domain/immutability.js";
import { SettingsCommandRequestSchema } from "../../domain/commands.js";
import { deriveSettingsPatchFingerprint } from "../../domain/config/settings.js";
import { EditableSettingsWireSchema, type EditableSettingsWire } from "../../domain/dashboard/settings-editor.js";
import { useSettingsClient } from "../state/settings-client.js";
import { useSettingsPreflight } from "./settings-preflight-model.js";
import { useProtectedSettings } from "./settings-protected-model.js";
import { useProviderKeys } from "./settings-provider-model.js";
import { useStorageRelocation } from "./settings-relocation-model.js";
import { beforeEffectRefusal, checkedSettingsResult, settingsRefusal, uncertainSettingsCode, type OrdinarySettingsAttempt, type SettingsSaveState } from "./settings-attempt-model.js";
import { coupledSettingsLeaves, draftError, ordinaryReadbackConfirms, patchFromSettingsDraft, settingInput, settingsLeaves, type SettingsDraft, type SettingsDraftInput } from "./settings-draft-model.js";

export type EditableSettingsState = { readonly state: "loading" } | { readonly state: "failed"; readonly message: string } | { readonly state: "loaded"; readonly document: EditableSettingsWire };
export type { SettingsSaveState } from "./settings-attempt-model.js";
export type { PreflightRerunState } from "./settings-preflight-model.js";

/** One ordinary atomic draft, independent protected draft, no browser-persisted values or attempts. */
export function useEditableSettings(input: Readonly<{ actorId: string; descriptorFingerprint: string }>) {
  const client = useSettingsClient();
  const [editor, setEditor] = useState<EditableSettingsState>({ state: "loading" });
  const current = useRef<EditableSettingsWire | undefined>(undefined);
  const [readProblem, setReadProblem] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<SettingsDraft>({});
  const [save, setSave] = useState<SettingsSaveState>({ state: "idle" });
  const pending = useRef<OrdinarySettingsAttempt | undefined>(undefined);
  const busy = useRef(false);
  const { preflight, rerunPreflight } = useSettingsPreflight(editor, input);
  const refresh = useCallback(async (): Promise<EditableSettingsWire> => {
    try {
      const document = EditableSettingsWireSchema.parse(await client.editableSettings());
      const previous = current.current;
      if (previous !== undefined && (previous.revision > document.revision
        || (previous.protectedSettings.state === "available" && document.protectedSettings.state === "available" && previous.protectedSettings.readback.revision > document.protectedSettings.readback.revision))) throw new Error("settings-readback-stale");
      current.current = document; setEditor({ state: "loaded", document }); setReadProblem(undefined); return document;
    } catch {
      setReadProblem("Current settings could not be read. Your drafts are retained.");
      throw new Error("settings-read-unavailable");
    }
  }, [client]);
  useEffect(() => {
    let active = true;
    void refresh().catch(() => { if (active && current.current === undefined) setEditor({ state: "failed", message: "Settings could not be read. Try again." }); });
    return () => { active = false; };
  }, [refresh]);
  const protectedEditor = useProtectedSettings({ actorId: input.actorId, readReady: readProblem === undefined, document: editor.state === "loaded" ? editor.document : undefined, refresh });
  const providerEditor = useProviderKeys({ actorId: input.actorId, readReady: readProblem === undefined, document: editor.state === "loaded" ? editor.document : undefined, refresh });
  const relocationEditor = useStorageRelocation({ actorId: input.actorId });
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
    try {
      const result = checkedSettingsResult(command, await client.applySettings(command));
      if (result.state === "conflict") {
        pending.current = undefined;
        try { await refresh(); setSave({ state: "conflict", message: "Settings changed. Current values are refreshed beside your retained edit. Review them before retrying." }); }
        catch { setSave({ state: "conflict", message: "Settings changed, but current values could not be read. Refresh before retrying the retained edit." }); }
        return;
      }
      if (result.state === "rejected") {
        if (!uncertainSettingsCode(result.code)) pending.current = undefined;
        setSave({ state: uncertainSettingsCode(result.code) ? "unconfirmed" : "refused", code: result.code, message: settingsRefusal(result.code) }); return;
      }
      if (result.state !== "applied" && result.state !== "already-applied") throw new Error("settings-result-unconfirmed");
      const document = await refresh();
      if (document.revision !== result.settingsRevision || document.settingsFingerprint !== result.settingsFingerprint || !ordinaryReadbackConfirms(document, command.payload.patch)) throw new Error("settings-readback-unconfirmed");
      pending.current = undefined; setDraft({}); setSave({ state: "applied", replayed: result.state === "already-applied" });
    } catch (error) {
      const refused = beforeEffectRefusal(error); if (refused) pending.current = undefined;
      setSave({ state: refused ? "refused" : "unconfirmed", code: refused ? "settings-admission-refused" : undefined, message: refused ? "The request was refused before execution. Your draft is retained." : "The settings write could not be confirmed. It may already be stored. Retry the exact attempt; your draft is retained." });
    } finally { busy.current = false; }
  };
  const submit = (): void => {
    if (editor.state !== "loaded" || busy.current || pending.current !== undefined || Object.keys(draft).length === 0 || Object.values(errors).some(error => error !== undefined) || readProblem !== undefined) return;
    try {
      const patch = patchFromSettingsDraft(leaves, draft);
      const command = deepFreeze(SettingsCommandRequestSchema.parse({ commandId: crypto.randomUUID(), requestedAt: systemClock.now().toISOString(), requestedBy: input.actorId, source: "settings-surface", family: "settings", type: "apply-settings",
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
  const reload = (): void => { void refresh().catch(() => undefined); };
  return Object.freeze({ editor, draft, errors, save, preflight, protectedEditor, providerEditor, relocationEditor, leaves, readProblem,
    dirtyCount: Object.keys(draft).length, locked: save.state === "saving" || pending.current !== undefined,
    update, reset, clear, discard, submit, retry, reload, rerunPreflight });
}
