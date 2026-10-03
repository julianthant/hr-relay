import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { systemClock } from "../../rules/time/clock.js";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { SettingsCommandRequestSchema } from "../../rules/commands/commands.js";
import { deriveSettingsPatchFingerprint } from "../../models/config/settings.js";
import { EditableSettingsWireSchema, type EditableSettingsWire } from "../../models/dashboard/settings-editor.js";
import { useSettingsClient } from "../state/settings-client.js";
import { useSettingsPreflight } from "./settings-preflight-model.js";
import { useProtectedSettings } from "./settings-protected-model.js";
import { useProviderKeys } from "./settings-provider-model.js";
import { useStorageRelocation } from "./settings-relocation-model.js";
import { beforeEffectRefusal, checkedSettingsResult, ordinaryReadbackState, settingsRefusal, uncertainSettingsCode, type OrdinarySettingsAttempt, type SettingsSaveState } from "./settings-attempt-model.js";
import { coupledSettingsLeaves, draftError, patchFromSettingsDraft, settingInput, settingsLeaves, type SettingsDraft, type SettingsDraftInput } from "./settings-draft-model.js";
import { deliverDefinitiveSettingsRefusal, type ConfirmedSettingsSave, type DefinitiveSettingsRefusal } from "./settings-save-feedback-model.js";

export type EditableSettingsState = { readonly state: "loading" } | { readonly state: "failed"; readonly message: string } | { readonly state: "loaded"; readonly document: EditableSettingsWire };
export type { SettingsSaveState } from "./settings-attempt-model.js";
export type { PreflightRerunState } from "./settings-preflight-model.js";

/** One ordinary atomic draft, independent protected draft, no browser-persisted values or attempts. */
export function useEditableSettings(input: Readonly<{ actorId: string; descriptorFingerprint: string; onConfirmedSave?: (receipt: ConfirmedSettingsSave) => void; onDefinitiveRefusal?: (receipt: DefinitiveSettingsRefusal) => void }>) {
  const client = useSettingsClient();
  const incarnation = useMemo(() => ({ client, actorId: input.actorId }), [client, input.actorId]);
  const activeIncarnation = useRef(incarnation);
  const [editor, setEditor] = useState<EditableSettingsState>({ state: "loading" });
  const current = useRef<EditableSettingsWire | undefined>(undefined);
  const readGeneration = useRef(0);
  const [readProblem, setReadProblem] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<SettingsDraft>({});
  const [save, setSave] = useState<SettingsSaveState>({ state: "idle" });
  const pending = useRef<OrdinarySettingsAttempt | undefined>(undefined);
  const busy = useRef(false);
  const { preflight, rerunPreflight } = useSettingsPreflight(editor, input);
  useLayoutEffect(() => {
    activeIncarnation.current = incarnation;
    readGeneration.current += 1;
    current.current = undefined;
    setEditor({ state: "loading" });
    setReadProblem(undefined);
    if (pending.current !== undefined) setSave({ state: "unconfirmed",
      message: "The settings write could not be confirmed after the Settings connection changed. Retry the exact attempt; your draft is retained." });
    else setSave(previous => previous.state === "applied" ? { state: "idle" } : previous);
  }, [incarnation]);
  const refresh = useCallback(async (): Promise<EditableSettingsWire> => {
    if (incarnation !== activeIncarnation.current) throw new Error("settings-read-superseded");
    const generation = ++readGeneration.current;
    try {
      const document = EditableSettingsWireSchema.parse(await client.editableSettings());
      if (incarnation !== activeIncarnation.current || generation !== readGeneration.current) throw new Error("settings-read-superseded");
      const previous = current.current;
      if (previous !== undefined && (previous.revision > document.revision
        || (previous.protectedSettings.state === "available" && document.protectedSettings.state === "available" && previous.protectedSettings.readback.revision > document.protectedSettings.readback.revision)
        || ((previous.providerKeys.state === "available" || previous.providerKeys.state === "pending")
          && (document.providerKeys.state === "available" || document.providerKeys.state === "pending")
          && previous.providerKeys.revision > document.providerKeys.revision))) throw new Error("settings-readback-stale");
      current.current = document; setEditor({ state: "loaded", document }); setReadProblem(undefined); return document;
    } catch (error) {
      if (incarnation !== activeIncarnation.current || generation !== readGeneration.current) throw new Error("settings-read-superseded", { cause: error });
      if (generation === readGeneration.current) setReadProblem("Current settings could not be read. Your drafts are retained.");
      throw new Error("settings-read-unavailable", { cause: error });
    }
  }, [client, incarnation]);
  useEffect(() => {
    let active = true;
    void refresh().catch((error: unknown) => { if (active && error instanceof Error && error.message !== "settings-read-superseded" && current.current === undefined) setEditor({ state: "failed", message: "Settings could not be read. Try again." }); });
    return () => { active = false; readGeneration.current += 1; };
  }, [refresh]);
  const protectedEditor = useProtectedSettings({ actorId: input.actorId, readReady: readProblem === undefined, document: editor.state === "loaded" ? editor.document : undefined, refresh, onConfirmedSave: input.onConfirmedSave, onDefinitiveRefusal: input.onDefinitiveRefusal });
  const providerEditor = useProviderKeys({ actorId: input.actorId, readReady: readProblem === undefined, document: editor.state === "loaded" ? editor.document : undefined, refresh, onConfirmedSave: input.onConfirmedSave, onDefinitiveRefusal: input.onDefinitiveRefusal });
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
    const attemptIncarnation = incarnation;
    busy.current = true; pending.current = command; setSave({ state: "saving" });
    let confirmed: ConfirmedSettingsSave | undefined;
    try {
      const result = checkedSettingsResult(command, await client.applySettings(command));
      if (attemptIncarnation !== activeIncarnation.current) return;
      if (result.state === "conflict") {
        pending.current = undefined;
        try { await refresh(); if (attemptIncarnation !== activeIncarnation.current) return; setSave({ state: "conflict", feedback: "chip", message: "Settings changed. Current values are refreshed beside your retained edit. Review them before retrying." }); }
        catch { if (attemptIncarnation !== activeIncarnation.current) return; setSave({ state: "conflict", feedback: "chip", message: "Settings changed, but current values could not be read. Refresh before retrying the retained edit." }); }
        deliverDefinitiveSettingsRefusal(input.onDefinitiveRefusal, { actorId: command.requestedBy, commandId: command.commandId, kind: "ordinary", outcome: "conflict" });
        return;
      }
      if (result.state === "rejected") {
        if (!uncertainSettingsCode(result.code)) pending.current = undefined;
        const uncertain = uncertainSettingsCode(result.code);
        setSave({ state: uncertain ? "unconfirmed" : "refused", ...(!uncertain && { feedback: "chip" as const }), code: result.code, message: settingsRefusal(result.code) });
        if (!uncertain) deliverDefinitiveSettingsRefusal(input.onDefinitiveRefusal, { actorId: command.requestedBy, commandId: command.commandId, kind: "ordinary", outcome: "refused" });
        return;
      }
      if (result.state !== "applied" && result.state !== "already-applied") throw new Error("settings-result-unconfirmed");
      const document = await refresh();
      if (attemptIncarnation !== activeIncarnation.current) return;
      const readback = ordinaryReadbackState(command, result, document);
      if (readback === "superseded") {
        pending.current = undefined;
        setSave({ state: "conflict", message: "Your settings write was accepted, then newer settings replaced it. Current saved values are shown beside your retained edit. Review before submitting again." });
        return;
      }
      if (readback !== "confirmed") throw new Error("settings-readback-unconfirmed");
      pending.current = undefined; setDraft({}); setSave({ state: "applied", replayed: result.state === "already-applied" });
      confirmed = { actorId: command.requestedBy, commandId: command.commandId, kind: "ordinary", replayed: result.state === "already-applied" };
    } catch (error) {
      if (attemptIncarnation !== activeIncarnation.current) return;
      const refused = beforeEffectRefusal(error); if (refused) pending.current = undefined;
      setSave({ state: refused ? "refused" : "unconfirmed", code: refused ? "settings-admission-refused" : undefined, message: refused ? "The request was refused before execution. Your draft is retained." : "The settings write could not be confirmed. It may already be stored. Retry the exact attempt; your draft is retained." });
    } finally { busy.current = false; }
    if (confirmed !== undefined && attemptIncarnation === activeIncarnation.current) input.onConfirmedSave?.(confirmed);
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
