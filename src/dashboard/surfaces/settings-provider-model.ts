import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { systemClock } from "../../rules/time/clock.js";
import { ProviderKeysCommandRequestSchema, ProviderKeysRetryIntentSchema, type CommandResult } from "../../rules/commands/commands.js";
import { ProviderKeySlotSchema } from "../../models/config/provider-keys.js";
import type { EditableSettingsWire } from "../../models/dashboard/settings-editor.js";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { DashboardClientError } from "../client/errors.js";
import { useSettingsClient } from "../state/settings-client.js";
import { beforeEffectRefusal, settingsRefusal, type SettingsSaveState } from "./settings-attempt-model.js";
import { deliverDefinitiveSettingsRefusal, type ConfirmedSettingsSave, type DefinitiveSettingsRefusal } from "./settings-save-feedback-model.js";

type Slot = (typeof ProviderKeySlotSchema.options)[number];
type DraftOperation = { readonly kind: "set"; readonly raw: string; readonly added?: true } | { readonly kind: "clear" };
type Draft = Partial<Record<Slot, DraftOperation>>;
type Command = ReturnType<typeof ProviderKeysCommandRequestSchema.parse>;
type ProviderDocument = EditableSettingsWire["providerKeys"];

function available(document: EditableSettingsWire | undefined): Extract<ProviderDocument, { state: "available" | "pending" }> | undefined {
  const keys = document?.providerKeys;
  return keys?.state === "available" || keys?.state === "pending" ? keys : undefined;
}

function confirms(result: CommandResult, document: EditableSettingsWire, commandId: string, operations?: Command["payload"]["operations"]): boolean {
  if ((result.state !== "applied" && result.state !== "already-applied") || result.commandId !== commandId
    || document.providerKeys.state !== "available" || result.providerRevision !== document.providerKeys.revision
    || result.providerSourceVersionToken !== document.providerKeys.sourceVersionToken
    || result.providerReceiptId === undefined || result.affectedTargets.length !== 1
    || result.affectedTargets[0]?.family !== "provider-keys"
    || result.affectedTargets[0]?.revision !== result.providerRevision) return false;
  return operations === undefined || Object.entries(operations).every(([slot, operation]) => {
    if (operation === undefined) return false;
    const saved = document.providerKeys.state === "available" ? document.providerKeys.slots[slot] : undefined;
    return "set" in operation ? saved === operation.set : saved === undefined;
  });
}

function acceptedReceipt(result: CommandResult, command: Command): boolean {
  return (result.state === "applied" || result.state === "already-applied")
    && result.commandId === command.commandId
    && result.providerRevision === command.target.expectedRevision + 1
    && result.providerReceiptId !== undefined && result.providerSourceVersionToken !== undefined
    && result.affectedTargets.length === 1
    && result.affectedTargets[0]?.family === "provider-keys"
    && result.affectedTargets[0]?.revision === result.providerRevision;
}
export function providerReadbackState(command: Command, result: CommandResult, document: EditableSettingsWire): "confirmed" | "superseded" | "unresolved" {
  if ((result.state !== "applied" && result.state !== "already-applied")
    || !acceptedReceipt(result, command) || result.providerRevision === undefined) return "unresolved";
  if (document.providerKeys.state === "available" && document.providerKeys.revision > result.providerRevision) return "superseded";
  return confirms(result, document, command.commandId, command.payload.operations) ? "confirmed" : "unresolved";
}

export function useProviderKeys(input: {
  actorId: string; readReady: boolean; document: EditableSettingsWire | undefined;
  refresh: () => Promise<EditableSettingsWire>;
  onConfirmedSave?: (receipt: ConfirmedSettingsSave) => void;
  onDefinitiveRefusal?: (receipt: DefinitiveSettingsRefusal) => void;
}) {
  const client = useSettingsClient();
  const incarnation = useMemo(() => ({ client, actorId: input.actorId }), [client, input.actorId]);
  const activeIncarnation = useRef(incarnation);
  const [draft, setDraft] = useState<Draft>({});
  const [save, setSave] = useState<SettingsSaveState>({ state: "idle" });
  const pending = useRef<Command | undefined>(undefined);
  const busy = useRef(false);
  useLayoutEffect(() => {
    activeIncarnation.current = incarnation;
    if (pending.current !== undefined || busy.current) setSave({ state: "unconfirmed",
      message: pending.current === undefined
        ? "The pending provider recovery could not be confirmed after the Settings connection changed. Retry the bound recovery attempt."
        : "The provider write could not be confirmed after the Settings connection changed. Retry the exact attempt; your edit is retained." });
    else setSave(previous => previous.state === "applied" ? { state: "idle" } : previous);
  }, [incarnation]);
  const keys = available(input.document);
  const errors = Object.fromEntries(Object.entries(draft).map(([slot, operation]) => [slot,
    operation?.kind === "set" && operation.raw.trim() === "" ? "Enter a provider key before saving." : undefined,
  ])) as Partial<Record<Slot, string | undefined>>;
  const locked = busy.current || pending.current !== undefined || keys?.state === "pending";

  const update = (slot: Slot, raw: string): void => {
    if (!input.readReady || locked || keys?.state !== "available" || (keys.slots[slot] === undefined && draft[slot]?.kind !== "set")) return;
    setDraft(previous => ({ ...previous, [slot]: { kind: "set", raw, ...(previous[slot]?.kind === "set" && previous[slot].added ? { added: true as const } : {}) } }));
    setSave({ state: "idle" });
  };
  const add = (prefix: string): Slot | undefined => {
    if (!input.readReady || locked || keys?.state !== "available") return undefined;
    const slot = ProviderKeySlotSchema.options.find(candidate => (candidate === prefix || candidate.startsWith(prefix) && /^\d+$/u.test(candidate.slice(prefix.length)))
      && keys.slots[candidate] === undefined && draft[candidate] === undefined);
    if (slot === undefined) return undefined;
    setDraft(previous => ({ ...previous, [slot]: { kind: "set", raw: "", added: true } }));
    setSave({ state: "idle" });
    return slot;
  };
  const remove = (slot: Slot): void => {
    if (locked || keys?.state !== "available") return;
    if (keys.slots[slot] === undefined) {
      setDraft(previous => { const next = { ...previous }; delete next[slot]; return next; });
    } else setDraft(previous => ({ ...previous, [slot]: { kind: "clear" } }));
    setSave({ state: "idle" });
  };
  const discard = (): void => {
    if (busy.current) return;
    pending.current = undefined; setDraft({}); setSave({ state: "idle" });
  };
  const perform = async (command: Command): Promise<void> => {
    if (busy.current || incarnation !== activeIncarnation.current) return;
    const attemptIncarnation = incarnation;
    busy.current = true; pending.current = command; setSave({ state: "saving" });
    let confirmed: ConfirmedSettingsSave | undefined;
    try {
      const result = await client.applyProviderKeys(command);
      if (attemptIncarnation !== activeIncarnation.current) return;
      if (result.commandId !== command.commandId) throw new Error("provider-result-identity");
      if (result.state === "conflict") {
        pending.current = undefined;
        try { await input.refresh(); if (attemptIncarnation !== activeIncarnation.current) return; setSave({ state: "conflict", feedback: "chip", message: "Provider keys changed. Review the refreshed saved values before retrying your retained edit." }); }
        catch { if (attemptIncarnation !== activeIncarnation.current) return; setSave({ state: "conflict", feedback: "chip", message: "Provider keys changed, but saved values could not be read. Refresh before retrying." }); }
        deliverDefinitiveSettingsRefusal(input.onDefinitiveRefusal, { actorId: command.requestedBy, commandId: command.commandId, kind: "provider-key", outcome: "conflict" });
        return;
      }
      if (result.state === "rejected") {
        if (result.code !== "authority-uncertain" && result.code !== "authority-unjournaled") pending.current = undefined;
        const uncertain = pending.current !== undefined;
        setSave({ state: uncertain ? "unconfirmed" : "refused", ...(!uncertain && { feedback: "chip" as const }), code: result.code, message: settingsRefusal(result.code) });
        if (!uncertain) deliverDefinitiveSettingsRefusal(input.onDefinitiveRefusal, { actorId: command.requestedBy, commandId: command.commandId, kind: "provider-key", outcome: "refused" });
        return;
      }
      const document = await input.refresh();
      if (attemptIncarnation !== activeIncarnation.current) return;
      const readback = providerReadbackState(command, result, document);
      if (readback === "superseded") {
        pending.current = undefined;
        setSave({ state: "conflict", message: "Your provider write was accepted, then newer keys replaced it. Current saved values are shown beside your retained edit. Review before submitting again." });
        return;
      }
      if (readback !== "confirmed") throw new Error("provider-readback-unconfirmed");
      pending.current = undefined; setDraft({}); setSave({ state: "applied", replayed: result.state === "already-applied" });
      confirmed = { actorId: command.requestedBy, commandId: command.commandId, kind: "provider-key", replayed: result.state === "already-applied" };
    } catch (error) {
      if (attemptIncarnation !== activeIncarnation.current) return;
      const refused = beforeEffectRefusal(error) || error instanceof DashboardClientError && error.kind === "http"
        && ["SCHEMA_INVALID", "REQUEST_IDENTITY_REFUSED"].includes(error.code ?? "");
      if (refused) pending.current = undefined;
      setSave({ state: refused ? "refused" : "unconfirmed", code: refused ? "provider-admission-refused" : undefined,
        message: refused ? "The provider request was refused before execution. Your edit is retained." : "The provider write could not be confirmed. Retry the exact attempt; your edit is retained." });
    } finally { busy.current = false; }
    if (confirmed !== undefined && attemptIncarnation === activeIncarnation.current) input.onConfirmedSave?.(confirmed);
  };
  const submit = (): void => {
    if (!input.readReady || busy.current || pending.current !== undefined || keys?.state !== "available"
      || Object.keys(draft).length === 0 || Object.values(errors).some(Boolean)) return;
    try {
      const operations = Object.fromEntries(Object.entries(draft).map(([slot, operation]) => [slot,
        operation?.kind === "clear" ? { clear: true } : { set: operation?.raw },
      ]));
      const command = deepFreeze(ProviderKeysCommandRequestSchema.parse({
        commandId: crypto.randomUUID(), requestedAt: systemClock.now().toISOString(), requestedBy: input.actorId,
        source: "settings-surface", family: "settings", type: "apply-provider-keys",
        target: { expectedRevision: keys.revision, sourceVersionToken: keys.sourceVersionToken },
        payload: { providerSchemaHash: keys.providerSchemaHash, writeId: crypto.randomUUID(), operations },
      }));
      void perform(command);
    } catch { setSave({ state: "refused", message: "Check the provider key edit. No request was sent." }); }
  };
  const autosave = useEffectEvent(submit);
  useEffect(() => {
    if (!input.readReady || keys?.state !== "available" || save.state !== "idle" || locked
      || Object.keys(draft).length === 0 || Object.values(errors).some(Boolean)) return;
    const timer = window.setTimeout(() => autosave(), 1200);
    return () => window.clearTimeout(timer);
  }, [draft, errors, input.readReady, keys?.state, locked, save.state]);
  const retry = (): void => { if (pending.current !== undefined) void perform(pending.current); };
  const retryPending = async (): Promise<void> => {
    if (busy.current || keys?.state !== "pending" || incarnation !== activeIncarnation.current) return;
    const attemptIncarnation = incarnation;
    busy.current = true; setSave({ state: "saving" });
    let confirmed: ConfirmedSettingsSave | undefined;
    try {
      const intent = ProviderKeysRetryIntentSchema.parse({ family: "settings", type: "apply-provider-keys", requestedBy: input.actorId,
        retry: { commandId: keys.pending.commandId, writeId: keys.pending.writeId,
          pendingReceiptId: keys.pending.receiptId, providerSchemaHash: keys.providerSchemaHash } });
      const result = await client.retryProviderKeys(intent);
      if (attemptIncarnation !== activeIncarnation.current) return;
      if (result.commandId !== keys.pending.commandId || (result.state !== "applied" && result.state !== "already-applied")
        || result.providerReceiptId !== keys.pending.receiptId) throw new Error("provider-recovery-unconfirmed");
      const document = await input.refresh();
      if (attemptIncarnation !== activeIncarnation.current) return;
      if (!confirms(result, document, keys.pending.commandId)) throw new Error("provider-recovery-readback-unconfirmed");
      pending.current = undefined; setDraft({}); setSave({ state: "applied", replayed: result.state === "already-applied" });
      confirmed = { actorId: input.actorId, commandId: keys.pending.commandId, kind: "provider-key", replayed: result.state === "already-applied" };
    } catch { if (attemptIncarnation === activeIncarnation.current) setSave({ state: "unconfirmed", message: "The pending provider write could not be confirmed. Retry the bound recovery attempt." }); }
    finally { busy.current = false; }
    if (confirmed !== undefined && attemptIncarnation === activeIncarnation.current) input.onConfirmedSave?.(confirmed);
  };
  return { draft, errors, save, dirtyCount: Object.keys(draft).length, locked, hasExactAttempt: pending.current !== undefined, update, add, remove,
    discard, submit, retry, retryPending };
}
