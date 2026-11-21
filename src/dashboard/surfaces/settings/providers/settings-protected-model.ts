import type { CommandExecutionOptions, CommandExecutionScope, CommandOutcome } from "../../../app/commands/command-executor.js";
import { attemptUnresolved, commandAttemptView } from "../../../app/commands/command-outcome.js";
import { READBACK_WAITS_MS } from "../../../app/commands/command-readback.js";
import { useDashboardCommandBinding } from "../../../state/client-context.js";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../../models/failures/error-catalog.js";
import { deepFreeze } from "../../../../rules/validation/immutability.js";
import { ProtectedSettingsCommandRequestSchema } from "../../../../rules/commands/commands.js";
import { ProtectedSettingsPatchSchema, ProtectedValueSchemas, type ProtectedSettingsName } from "../../../../models/config/protected-settings.js";
import type { EditableSettingsWire } from "../../../../models/dashboard/settings-editor.js";
import { checkedSettingsResult, commandSaveState, settingsScopeRecoveryState, protectedReadbackConfirms, settingsSaveFailure, settingsSaveNotice, settingsSaveProblem, type SettingsSaveListener, type SettingsSaveProblemListener, type ProtectedSettingsAttempt, type SettingsSaveState } from "../editor/settings-attempt-model.js";

type ProtectedDraftOperation = { readonly kind: "set"; readonly raw: string } | { readonly kind: "clear" };
type ProtectedDraft = Partial<Record<ProtectedSettingsName, ProtectedDraftOperation>>;
function protectedValue(name: ProtectedSettingsName, raw: string): unknown {
  return ProtectedValueSchemas[name].parse(raw);
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
  const [explicitSave, setExplicitSave] = useState(false);
  const pending = useRef<string | undefined>(undefined);
  const busy = useRef(false);
  const recoveryFailure = useRef<CommandOutcome | undefined>(undefined);
  const attemptScope = useRef<CommandExecutionScope | undefined>(undefined);
  const replays = useRef(0);
  const retained = binding?.executor.retainedAttempts().find(attempt => attemptUnresolved(attempt) && attempt.scope.actorId === binding.scope.actorId
    && attempt.request.family === "settings" && attempt.request.type === "apply-protected-settings");
  if (pending.current === undefined && retained?.request.family === "settings" && retained.request.type === "apply-protected-settings") {
    pending.current = retained.request.commandId;
  }
  if (attemptScope.current === undefined && retained !== undefined) attemptScope.current = retained.scope;
  const available = input.document?.protectedSettings;
  const update = (name: ProtectedSettingsName, raw: string): void => {
    if (!input.readReady || busy.current || pending.current !== undefined || available?.state !== "available" || !available.rows.some(row => row.name === name)) return;
    let error: string | undefined;
    try { protectedValue(name, raw); } catch { error = "Enter a valid value for this credential."; }
    setDraft(previous => ({ ...previous, [name]: { kind: "set", raw } }));
    setErrors(previous => ({ ...previous, [name]: error })); setSave({ state: "idle" });
  };
  const clear = (name: ProtectedSettingsName): void => {
    if (!input.readReady || busy.current || pending.current !== undefined || available?.state !== "available") return;
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
  const perform = async (command: ProtectedSettingsAttempt | string): Promise<void> => {
    const commandId = typeof command === "string" ? command : command.commandId;
    if (busy.current) return;
    busy.current = true; pending.current = commandId; setSave({ state: "saving" });
    if (binding === undefined) { busy.current = false; setSave(settingsScopeRecoveryState()); return; }
    attemptScope.current = binding.scope;
    const originalAttempt = binding.executor.retainedAttempts().find(attempt => attempt.request.commandId === commandId);
    const original = typeof command === "string" ? originalAttempt?.request : command;
    const parsed = ProtectedSettingsCommandRequestSchema.safeParse(original);
    if (!parsed.success) {
      recoveryFailure.current = { kind: "uncertain", commandId, cause: { request: original, error: parsed.error },
        feedback: formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_OUTCOME_UNCERTAIN", {})) };
      busy.current = false; setSave(commandSaveState(recoveryFailure.current)); return;
    }
    if (parsed.data.requestedBy !== binding.scope.actorId) { busy.current = false; setSave(settingsScopeRecoveryState()); return; }
    let document: EditableSettingsWire | undefined;
    let entryNames: readonly string[] = [];
    const options: CommandExecutionOptions = {
      scope: binding.scope,
      readback: async (request, reply) => {
        if (request.family !== "settings" || request.type !== "apply-protected-settings") return { state: "mismatch", evidence: request };
        const original = ProtectedSettingsCommandRequestSchema.parse(request);
        const result = checkedSettingsResult(original, reply);
        entryNames = Object.keys(original.payload.entries);
        document = await input.readCurrent();
        return { state: protectedReadbackConfirms(original, result, document) ? "matched" : "mismatch", evidence: document };
      },
      publish: outcome => {
        if (!live.current) return;
        binding.feedback(outcome);
        if (document !== undefined) input.acceptReadback(document);
        if (outcome.kind === "conflict") void input.refresh().catch(() => undefined);
        const view = commandAttemptView(outcome);
        if (view.view !== "unknown" && !(view.view === "call-refused" && view.reason === "locked")) { pending.current = undefined; replays.current = 0; }
        const next = outcome.kind === "refused" && outcome.reason === "locked" ? settingsScopeRecoveryState() : commandSaveState(outcome); setSave(next);
        if (outcome.kind === "confirmed" && document?.protectedSettings.state === "available") {
          setDraft({}); setErrors({});
          input.onSaved?.(settingsSaveNotice(document.protectedSettings.rows.filter(row => entryNames.includes(row.name)).map(row => row.name === "ucpathUserId" ? "UCPath username" : row.label), next.state === "applied" && next.replayed));
        }
        const problem = settingsSaveProblem(next, true);
        if (problem) input.onSaveProblem?.(problem);
      },
    };
    try {
      if (typeof command === "string" || originalAttempt !== undefined) await binding.executor.replay(commandId, options);
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
    } catch { setSave({ state: "refused", code: "PROTECTED_SETTINGS_DRAFT_INVALID", message: formatErrorCatalogFailure(createErrorCatalogFailure("PROTECTED_SETTINGS_DRAFT_INVALID", {})).text }); }
  };
  const autosave = useEffectEvent(submit);
  useEffect(() => {
    if (explicitSave || !input.readReady || available?.state !== "available" || save.state !== "idle"
      || Object.keys(draft).length === 0 || Object.values(errors).some(error => error !== undefined)) return;
    const timer = window.setTimeout(() => autosave(), 1200);
    return () => window.clearTimeout(timer);
  }, [available, draft, errors, explicitSave, input.readReady, save.state]);
  const retry = (): void => { if (pending.current !== undefined) void perform(pending.current); };
  const shown = pending.current !== undefined && attemptScope.current !== binding?.scope ? settingsScopeRecoveryState() : save.state === "idle" && retained?.outcome !== undefined ? commandSaveState(retained.outcome) : save;
  // An unconfirmed save replays its exact attempt a few times by itself, then shows the served values with one failure toast.
  const settleUnconfirmed = useEffectEvent(() => {
    if (busy.current || pending.current === undefined) return;
    if (replays.current < READBACK_WAITS_MS.length) { replays.current += 1; retry(); return; }
    const attempt = ProtectedSettingsCommandRequestSchema.safeParse(binding?.executor.retainedAttempts().find(retained => retained.request.commandId === pending.current)?.request);
    replays.current = 0; pending.current = undefined;
    const finish = (document: EditableSettingsWire | undefined) => {
      if (!live.current) return;
      const served = document?.protectedSettings.state === "available" ? document.protectedSettings : undefined;
      // shortcut: protected values are presence-only, so a newer revision with the asked presence counts as this save.
      const stored = attempt.success && served !== undefined && served.readback.revision > attempt.data.target.expectedRevision
        && Object.entries(attempt.data.payload.entries).every(([name, operation]) => operation !== undefined && ("clear" in operation) !== served.readback.entries[name as ProtectedSettingsName].present);
      setDraft({}); setErrors({}); setSave(stored ? { state: "applied", replayed: false } : { state: "idle" });
      if (stored && attempt.success && served !== undefined) input.onSaved?.(settingsSaveNotice(served.rows.filter(row => row.name in attempt.data.payload.entries).map(row => row.name === "ucpathUserId" ? "UCPath username" : row.label), false));
      else input.onSaveProblem?.({ ...settingsSaveFailure(), title: "Credentials weren't saved" });
    };
    void input.readCurrent().then(document => { input.acceptReadback(document); finish(document); }, () => finish(undefined));
  });
  useEffect(() => {
    if (shown.state !== "unconfirmed") return;
    const timer = window.setTimeout(() => settleUnconfirmed(), READBACK_WAITS_MS[Math.min(replays.current, READBACK_WAITS_MS.length - 1)]);
    return () => window.clearTimeout(timer);
  }, [shown.state, save]);
  return { draft, errors, save: shown, dirtyCount: Object.keys(draft).length, locked: !input.readReady || save.state === "saving" || pending.current !== undefined,
    explicitSave, setExplicitSave, update, clear, reset, discard, submit, retry };
}
