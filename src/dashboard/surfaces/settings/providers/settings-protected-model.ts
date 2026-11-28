import type { CommandExecutionOptions, CommandExecutionScope } from "../../../app/commands/command-executor.js";
import { attemptUnresolved, commandAttemptView } from "../../../app/commands/command-outcome.js";
import { readBack } from "../../../app/commands/command-readback.js";
import { useDashboardCommandBinding } from "../../../state/client-context.js";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../../models/failures/error-catalog.js";
import { deepFreeze } from "../../../../rules/validation/immutability.js";
import { ProtectedSettingsCommandRequestSchema } from "../../../../rules/commands/commands.js";
import { PROTECTED_SETTINGS_SET_MARKER, ProtectedSettingsPatchSchema, ProtectedValueSchemas, type ProtectedSettingsName } from "../../../../models/config/protected-settings.js";
import type { EditableSettingsWire } from "../../../../models/dashboard/settings-editor.js";
import { checkedSettingsResult, commandSaveState, settingsScopeRecoveryState, protectedReadbackConfirms, settingsSaveFailure, settingsSaveNotice, settingsSaveProblem, type SettingsSaveListener, type SettingsSaveProblemListener, type ProtectedSettingsAttempt, type SettingsSaveState } from "../editor/settings-attempt-model.js";

type ProtectedDraftOperation = { readonly kind: "set"; readonly raw: string } | { readonly kind: "clear" };
type ProtectedDraft = Partial<Record<ProtectedSettingsName, ProtectedDraftOperation>>;
function protectedValue(name: ProtectedSettingsName, raw: string): unknown {
  return ProtectedValueSchemas[name].parse(raw);
}
/** Whether the served credentials hold exactly what this save asked for: each set value served as sent, each cleared one absent.
 * A marked attempt holds no values to compare, so it never counts as landed. */
type ProtectedReadbackAttempt = Pick<ProtectedSettingsAttempt, "commandId" | "target"> & { readonly payload: { readonly entries: Readonly<Record<string, { readonly set: unknown } | { readonly clear: true } | undefined>> } };
export function protectedSaveLanded(attempt: ProtectedReadbackAttempt, document: EditableSettingsWire | undefined): boolean {
  const served = document?.protectedSettings.state === "available" ? document.protectedSettings : undefined;
  if (served === undefined || served.readback.revision <= attempt.target.expectedRevision) return false;
  const entries = Object.entries(attempt.payload.entries);
  return entries.length > 0 && entries.every(([name, operation]) => {
    const entry = served.entries[name as ProtectedSettingsName];
    if (operation === undefined) return false;
    return "clear" in operation ? entry === undefined : operation.set !== PROTECTED_SETTINGS_SET_MARKER && entry?.value === operation.set;
  });
}
export function useProtectedSettings(input: {
  actorId: string; readReady: boolean; editable: boolean; document: EditableSettingsWire | undefined; refresh: () => Promise<EditableSettingsWire>; readCurrent: () => Promise<EditableSettingsWire>; acceptReadback: (document: EditableSettingsWire) => void; onSaved?: SettingsSaveListener; onSaveProblem?: SettingsSaveProblemListener;
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
  const attemptScope = useRef<CommandExecutionScope | undefined>(undefined);
  const readingBack = useRef<string | undefined>(undefined);
  const retained = binding?.executor.retainedAttempts().find(attempt => attemptUnresolved(attempt) && attempt.scope.actorId === binding.scope.actorId
    && attempt.request.family === "settings" && attempt.request.type === "apply-protected-settings");
  if (pending.current === undefined && retained?.request.family === "settings" && retained.request.type === "apply-protected-settings") {
    pending.current = retained.request.commandId;
  }
  if (attemptScope.current === undefined && retained !== undefined) attemptScope.current = retained.scope;
  const available = input.document?.protectedSettings;
  const update = (name: ProtectedSettingsName, raw: string): void => {
    if (!input.editable || busy.current || pending.current !== undefined || available?.state !== "available" || !available.rows.some(row => row.name === name)) return;
    let error: string | undefined;
    try { protectedValue(name, raw); } catch { error = "Enter a valid value for this credential."; }
    forgive(name); setDraft(previous => ({ ...previous, [name]: { kind: "set", raw } }));
    setErrors(previous => ({ ...previous, [name]: error })); setSave({ state: "idle" });
  };
  const clear = (name: ProtectedSettingsName): void => {
    if (!input.editable || busy.current || pending.current !== undefined || available?.state !== "available") return;
    forgive(name); setDraft(previous => ({ ...previous, [name]: { kind: "clear" } }));
    setErrors(previous => ({ ...previous, [name]: undefined })); setSave({ state: "idle" });
  };
  const reset = (name: ProtectedSettingsName): void => {
    if (busy.current || pending.current !== undefined) return;
    setDraft(previous => { const next = { ...previous }; delete next[name]; return next; });
    setErrors(previous => ({ ...previous, [name]: undefined })); forgive(name);
    if (Object.keys(draft).every(key => key === name)) setSave({ state: "idle" });
  };
  const discard = (): void => {
    if (busy.current) return;
    pending.current = undefined; setDraft({}); setErrors({}); setFailedNames([]); setSave({ state: "idle" });
  };
  /** Credentials whose last submission failed: their draft waits for an explicit Save, never an autosave, and the row shows the served value. */
  const [failedNames, setFailedNames] = useState<readonly string[]>([]);
  const forgive = (name: string): void => setFailedNames(previous => previous.filter(candidate => candidate !== name));
  /** The credentials of the command in flight: only their rows show a spinner. */
  const [savingNames, setSavingNames] = useState<readonly string[]>([]);
  const perform = async (command: ProtectedSettingsAttempt): Promise<void> => {
    if (busy.current || binding === undefined) return;
    busy.current = true; pending.current = command.commandId; setSave({ state: "saving" }); setSavingNames(Object.keys(command.payload.entries));
    attemptScope.current = binding.scope;
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
        if (view.view === "unknown") { settleUnknown(command); return; }
        if (!(view.view === "call-refused" && view.reason === "locked")) pending.current = undefined;
        const next = outcome.kind === "refused" && outcome.reason === "locked" ? settingsScopeRecoveryState() : commandSaveState(outcome); setSave(next);
        if (outcome.kind === "confirmed" && document?.protectedSettings.state === "available") {
          setDraft({}); setErrors({});
          input.onSaved?.(settingsSaveNotice(document.protectedSettings.rows.filter(row => entryNames.includes(row.name)).map(row => row.name === "ucpathUserId" ? "UCPath username" : row.label), next.state === "applied" && next.replayed));
        }
        if (outcome.kind !== "confirmed") setFailedNames(Object.keys(command.payload.entries));
        const problem = settingsSaveProblem(next, true);
        if (problem) input.onSaveProblem?.(problem);
      },
    };
    try {
      await binding.executor.execute(command, options);
    } finally { busy.current = false; setSavingNames([]); }
  };

  const submit = (): void => {
    if (!input.readReady || busy.current || pending.current !== undefined || available?.state !== "available" || Object.keys(draft).length === 0 || Object.values(errors).some(error => error !== undefined)) return;
    if (binding === undefined) { setSave(commandSaveState(undefined)); return; }
    try {
      const entries = ProtectedSettingsPatchSchema.parse(Object.fromEntries(Object.entries(draft).map(([name, operation]) => [name,
        operation.kind === "clear" ? { clear: true } : { set: protectedValue(name as ProtectedSettingsName, operation.raw) },
      ])));
      const command = deepFreeze(ProtectedSettingsCommandRequestSchema.parse({ family: "settings", type: "apply-protected-settings", commandId: crypto.randomUUID(), requestedAt: binding.authority.now(), requestedBy: binding.scope.actorId, source: "settings-surface",
        target: { expectedRevision: available.readback.revision }, payload: { protectedSchemaHash: available.protectedSchemaHash, writeId: crypto.randomUUID(), entries } }));
      void perform(command);
    } catch { setSave({ state: "refused", code: "PROTECTED_SETTINGS_DRAFT_INVALID", message: formatErrorCatalogFailure(createErrorCatalogFailure("PROTECTED_SETTINGS_DRAFT_INVALID", {})).text }); }
  };
  const autosave = useEffectEvent(submit);
  useEffect(() => {
    if (explicitSave || !input.readReady || available?.state !== "available" || save.state !== "idle" || Object.keys(draft).some(name => failedNames.includes(name))
      || Object.keys(draft).length === 0 || Object.values(errors).some(error => error !== undefined)) return;
    const timer = window.setTimeout(() => autosave(), 1200);
    return () => window.clearTimeout(timer);
  }, [available, draft, errors, explicitSave, failedNames, input.readReady, save.state]);
  const shown = pending.current !== undefined && attemptScope.current !== binding?.scope ? settingsScopeRecoveryState() : save;
  // An unknown save is read back, never resent: the served credentials show silently, or one failure toast.
  function settleUnknown(attempt: ProtectedReadbackAttempt): void {
    if (readingBack.current === attempt.commandId) return;
    readingBack.current = attempt.commandId;
    setSave({ state: "unconfirmed", code: "COMMAND_OUTCOME_UNCERTAIN", message: formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_OUTCOME_UNCERTAIN", {})).text });
    void readBack(input.readCurrent, document => protectedSaveLanded(attempt, document)).then(document => {
      const landed = protectedSaveLanded(attempt, document);
      if (binding !== undefined) binding.executor.resolve(attempt.commandId, landed, binding.scope);
      readingBack.current = undefined;
      if (!live.current) return;
      if (document !== undefined) input.acceptReadback(document);
      pending.current = undefined;
      setDraft({}); setErrors({}); setSave({ state: "idle" });
      if (!landed) input.onSaveProblem?.({ ...settingsSaveFailure(), title: "Credentials weren't saved" });
    });
  }
  // A save another mount left unknown is read back here once, instead of being adopted and resent;
  // one still in flight is followed to its end so the editor never stays locked behind it.
  const adopted = useEffectEvent(() => {
    const attempt = retained?.request;
    if (binding === undefined || (busy.current && attemptScope.current === binding.scope)
      || attempt?.family !== "settings" || attempt.type !== "apply-protected-settings") return;
    if (retained?.state === "settled") { settleUnknown(attempt); return; }
    void binding.executor.whenSettled(attempt.commandId).then(() => {
      const after = binding.executor.retainedAttempts().find(next => next.request.commandId === attempt.commandId);
      if (after !== undefined && attemptUnresolved(after)) { settleUnknown(attempt); return; }
      if (!live.current || pending.current !== attempt.commandId) return;
      pending.current = undefined; setSave({ state: "idle" });
      void input.readCurrent().then(input.acceptReadback, () => undefined);
      if (after?.outcome?.kind === "confirmed") { setDraft({}); setErrors({}); }
      else input.onSaveProblem?.({ ...settingsSaveFailure(), title: "Credentials weren't saved" });
    });
  });
  useEffect(() => { adopted(); }, [binding?.scope, retained?.request.commandId, retained?.state]);
  return { draft, errors, save: shown, dirtyCount: Object.keys(draft).length, savingNames, failedNames, locked: !input.editable || save.state === "saving" || pending.current !== undefined,
    explicitSave, setExplicitSave, update, clear, reset, discard, submit };
}
