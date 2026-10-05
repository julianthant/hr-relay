import { settleCommandResult } from "../../../app/commands/command-result.js";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { systemClock } from "../../../../domain/clock.js";
import { deepFreeze } from "../../../../domain/immutability.js";
import { ProtectedSettingsCommandRequestSchema } from "../../../../domain/commands.js";
import { ProtectedSettingsPatchSchema, ProtectedValueSchemas, type ProtectedSettingsName } from "../../../../domain/config/protected-settings.js";
import type { EditableSettingsWire } from "../../../../domain/dashboard/settings-editor.js";
import { useSettingsClient } from "../editor/settings-client.js";
import { beforeEffectRefusal, checkedSettingsResult, protectedReadbackConfirms, settingsRefusal, uncertainSettingsCode, type ProtectedSettingsAttempt, type SettingsSaveState } from "../editor/settings-attempt-model.js";

type ProtectedDraftOperation = { readonly kind: "set"; readonly raw: string } | { readonly kind: "clear" };
type ProtectedDraft = Partial<Record<ProtectedSettingsName, ProtectedDraftOperation>>;
function protectedValue(name: ProtectedSettingsName, raw: string): unknown {
  return ProtectedValueSchemas[name].parse(name === "activityPersonPseudonym" ? JSON.parse(raw) as unknown : raw);
}
export function useProtectedSettings(input: {
  actorId: string; readReady: boolean; document: EditableSettingsWire | undefined; refresh: () => Promise<EditableSettingsWire>;
}) {
  const client = useSettingsClient();
  const [draft, setDraft] = useState<ProtectedDraft>({});
  const [errors, setErrors] = useState<Partial<Record<ProtectedSettingsName, string>>>({});
  const [save, setSave] = useState<SettingsSaveState>({ state: "idle" });
  const pending = useRef<ProtectedSettingsAttempt | undefined>(undefined);
  const busy = useRef(false);
  const available = input.document?.protectedSettings;
  const update = (name: ProtectedSettingsName, raw: string): void => {
    if (busy.current || pending.current !== undefined || available?.state !== "available" || !available.rows.some(row => row.name === name)) return;
    let error: string | undefined;
    try { protectedValue(name, raw); } catch { error = name === "activityPersonPseudonym" ? "Enter JSON with keyHex (64 lowercase hex characters) and keyGeneration (activity-person-…)." : "Enter a valid value for this credential."; }
    setDraft(previous => ({ ...previous, [name]: { kind: "set", raw } }));
    setErrors(previous => ({ ...previous, [name]: error })); setSave({ state: "idle" });
  };
  const clear = (name: ProtectedSettingsName): void => {
    if (busy.current || pending.current !== undefined || available?.state !== "available") return;
    setDraft(previous => ({ ...previous, [name]: { kind: "clear" } }));
    setErrors(previous => ({ ...previous, [name]: undefined })); setSave({ state: "idle" });
  };
  const reset = (name: ProtectedSettingsName): void => {
    if (busy.current || pending.current !== undefined) return;
    setDraft(previous => { const next = { ...previous }; delete next[name]; return next; });
    setErrors(previous => ({ ...previous, [name]: undefined }));
    setSave({ state: "idle" });
  };
  const discard = (): void => {
    if (busy.current) return;
    pending.current = undefined; setDraft({}); setErrors({}); setSave({ state: "idle" });
  };
  const perform = async (command: ProtectedSettingsAttempt): Promise<void> => {
    if (busy.current) return;
    busy.current = true; pending.current = command; setSave({ state: "saving" });
    try {
      const result = checkedSettingsResult(command, await client.executeCommand(command));
      const settled = settleCommandResult(result);
      if (settled.kind === "refused" && settled.reason === "conflict") {
        pending.current = undefined;
        try { await input.refresh(); setSave({ state: "conflict", message: "Credentials changed. Current presence is refreshed beside your retained edit. Review it before retrying." }); }
        catch { setSave({ state: "conflict", message: "Credentials changed, but current presence could not be read. Refresh before retrying the retained edit." }); }
        return;
      }
      if (settled.kind === "refused") {
        if (settled.reason !== "rejected") throw new Error("settings-result-unconfirmed");
        if (!uncertainSettingsCode(settled.code)) pending.current = undefined;
        setSave({ state: uncertainSettingsCode(settled.code) ? "unconfirmed" : "refused", code: settled.code, message: settingsRefusal(settled.code) }); return;
      }
      const document = await input.refresh();
      if (!protectedReadbackConfirms(command, result, document)) throw new Error("credential-readback-unconfirmed");
      pending.current = undefined; setDraft({}); setErrors({});
      setSave({ state: "applied", replayed: settled.replayed });
    } catch (error) {
      const refused = beforeEffectRefusal(error);
      if (refused) pending.current = undefined;
      setSave({ state: refused ? "refused" : "unconfirmed", code: refused ? "settings-admission-refused" : undefined, message: refused ? "The request was refused before execution. Your credential draft is retained." : "The credential write could not be confirmed. It may already be stored. Retry the exact attempt; your draft is retained." });
    } finally { busy.current = false; }
  };
  const submit = (): void => {
    if (!input.readReady || busy.current || pending.current !== undefined || available?.state !== "available" || Object.keys(draft).length === 0 || Object.values(errors).some(error => error !== undefined)) return;
    try {
      const entries = ProtectedSettingsPatchSchema.parse(Object.fromEntries(Object.entries(draft).map(([name, operation]) => [name,
        operation.kind === "clear" ? { clear: true } : { set: protectedValue(name as ProtectedSettingsName, operation.raw) },
      ])));
      const command = deepFreeze(ProtectedSettingsCommandRequestSchema.parse({ family: "settings", type: "apply-protected-settings", commandId: crypto.randomUUID(), requestedAt: systemClock.now().toISOString(), requestedBy: input.actorId, source: "settings-surface",
        target: { expectedRevision: available.readback.revision }, payload: { protectedSchemaHash: available.protectedSchemaHash, writeId: crypto.randomUUID(), entries } }));
      void perform(command);
    } catch { setSave({ state: "refused", message: "Check the credential draft. No request was sent." }); }
  };
  const autosave = useEffectEvent(submit);
  useEffect(() => {
    if (!input.readReady || available?.state !== "available" || save.state !== "idle"
      || Object.keys(draft).length === 0 || Object.values(errors).some(error => error !== undefined)) return;
    const timer = window.setTimeout(() => autosave(), 1200);
    return () => window.clearTimeout(timer);
  }, [available, draft, errors, input.readReady, save.state]);
  const retry = (): void => { if (pending.current !== undefined) void perform(pending.current); };
  return { draft, errors, save, dirtyCount: Object.keys(draft).length, locked: save.state === "saving" || pending.current !== undefined,
    update, clear, reset, discard, submit, retry };
}
