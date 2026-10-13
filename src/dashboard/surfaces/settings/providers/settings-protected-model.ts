import type { CommandExecutionOptions, CommandExecutionScope } from "../../../app/commands/command-executor.js";
import { useDashboardCommandBinding } from "../../../state/client-context.js";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { deepFreeze } from "../../../../rules/validation/immutability.js";
import { ProtectedSettingsCommandRequestSchema } from "../../../../rules/commands/commands.js";
import { ProtectedSettingsPatchSchema, ProtectedValueSchemas, type ProtectedSettingsName } from "../../../../models/config/protected-settings.js";
import type { EditableSettingsWire } from "../../../../models/dashboard/settings-editor.js";
import { checkedSettingsResult, commandSaveState, settingsScopeRecoveryState, protectedReadbackConfirms, settingsSaveNotice, settingsSaveProblem, type SettingsSaveListener, type SettingsSaveProblemListener, type ProtectedSettingsAttempt, type SettingsSaveState } from "../editor/settings-attempt-model.js";

type ProtectedDraftOperation = { readonly kind: "set"; readonly raw: string } | { readonly kind: "clear" };
type ProtectedDraft = Partial<Record<ProtectedSettingsName, ProtectedDraftOperation>>;
function protectedValue(name: ProtectedSettingsName, raw: string): unknown {
  return ProtectedValueSchemas[name].parse(name === "activityPersonPseudonym" ? JSON.parse(raw) as unknown : raw);
}
export function useProtectedSettings(input: {
  actorId: string; readReady: boolean; document: EditableSettingsWire | undefined; refresh: () => Promise<EditableSettingsWire>; readCurrent: () => Promise<EditableSettingsWire>; acceptReadback: (document: EditableSettingsWire) => void; onSaved?: SettingsSaveListener; onSaveProblem?: SettingsSaveProblemListener;
}) {
  const binding = useDashboardCommandBinding();
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const [draft, setDraft] = useState<ProtectedDraft>({});
  const [errors, setErrors] = useState<Partial<Record<ProtectedSettingsName, string>>>({});
  const [save, setSave] = useState<SettingsSaveState>({ state: "idle" });
  const pending = useRef<ProtectedSettingsAttempt | undefined>(undefined);
  const busy = useRef(false);
  const attemptScope = useRef<CommandExecutionScope | undefined>(undefined);
  const retained = binding?.executor.retainedAttempts().find(attempt => (attempt.state === "pending" || attempt.outcome?.kind === "uncertain") && attempt.scope.actorId === binding.scope.actorId
    && attempt.request.family === "settings" && attempt.request.type === "apply-protected-settings");
  if (pending.current === undefined && retained?.request.family === "settings" && retained.request.type === "apply-protected-settings") pending.current = retained.request;
  if (attemptScope.current === undefined && retained !== undefined) attemptScope.current = retained.scope;
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
    if (binding === undefined) { busy.current = false; pending.current = undefined; setSave(commandSaveState(undefined)); return; }
    attemptScope.current = binding.scope;
    let document: EditableSettingsWire | undefined;
    const options: CommandExecutionOptions = {
      scope: binding.scope,
      readback: async (_request, reply) => {
        const result = checkedSettingsResult(command, reply);
        document = await input.readCurrent();
        return { state: protectedReadbackConfirms(command, result, document) ? "matched" : "mismatch", evidence: document };
      },
      publish: outcome => {
        if (!live.current) return;
        binding.feedback(outcome);
        if (document !== undefined) input.acceptReadback(document);
        if (outcome.kind === "conflict") void input.refresh().catch(() => undefined);
        if (outcome.kind !== "uncertain" && !(outcome.kind === "refused" && outcome.reason === "locked")) pending.current = undefined;
        const next = outcome.kind === "refused" && outcome.reason === "locked" ? settingsScopeRecoveryState() : commandSaveState(outcome); setSave(next);
        if (outcome.kind === "confirmed" && document?.protectedSettings.state === "available") {
          setDraft({}); setErrors({});
          input.onSaved?.(settingsSaveNotice(document.protectedSettings.rows.filter(row => row.name in command.payload.entries).map(row => row.name === "ucpathUserId" ? "UCPath username" : row.label), next.state === "applied" && next.replayed));
        }
        const problem = settingsSaveProblem(next, true);
        if (problem) input.onSaveProblem?.(problem);
      },
    };
    try {
      if (binding.executor.retainedAttempts().some(attempt => attempt.request.commandId === command.commandId)) await binding.executor.replay(command.commandId, options);
      else await binding.executor.execute(command, options);
    } finally { busy.current = false; }
  };

  const submit = (): void => {
    if (!input.readReady || busy.current || pending.current !== undefined || available?.state !== "available" || Object.keys(draft).length === 0 || Object.values(errors).some(error => error !== undefined)) return;
    if (binding === undefined) { setSave(commandSaveState(undefined)); return; }
    try {
      const entries = ProtectedSettingsPatchSchema.parse(Object.fromEntries(Object.entries(draft).map(([name, operation]) => [name,
        operation.kind === "clear" ? { clear: true } : { set: protectedValue(name as ProtectedSettingsName, operation.raw) },
      ])));
      const command = deepFreeze(ProtectedSettingsCommandRequestSchema.parse({ family: "settings", type: "apply-protected-settings", commandId: crypto.randomUUID(), requestedAt: binding.authority.nowIso, requestedBy: binding.scope.actorId, source: "settings-surface",
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
  return { draft, errors, save: pending.current !== undefined && attemptScope.current !== binding?.scope ? settingsScopeRecoveryState() : save.state === "idle" && retained?.outcome !== undefined ? commandSaveState(retained.outcome) : save, dirtyCount: Object.keys(draft).length, locked: save.state === "saving" || pending.current !== undefined,
    update, clear, reset, discard, submit, retry };
}
