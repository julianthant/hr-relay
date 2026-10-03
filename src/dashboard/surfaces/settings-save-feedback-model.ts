export type ConfirmedSettingsSave = Readonly<{
  actorId: string;
  commandId: string;
  kind: "ordinary" | "protected" | "provider-key";
  replayed: boolean;
}>;

export type DefinitiveSettingsRefusal = Readonly<{
  actorId: string;
  commandId: string;
  kind: ConfirmedSettingsSave["kind"];
  outcome: "refused" | "conflict";
}>;

export type UnconfirmedSettingsSave = Readonly<{
  actorId: string;
  commandId: string;
  kind: ConfirmedSettingsSave["kind"];
}>;

export function deliverDefinitiveSettingsRefusal(
  callback: ((receipt: DefinitiveSettingsRefusal) => void) | undefined,
  receipt: DefinitiveSettingsRefusal,
): void {
  try { callback?.(receipt); } catch { /* feedback delivery cannot change the command result */ }
}

export function deliverUnconfirmedSettingsSave(
  callback: ((receipt: UnconfirmedSettingsSave) => void) | undefined,
  receipt: UnconfirmedSettingsSave,
): void {
  try { callback?.(receipt); } catch { /* feedback delivery cannot change the command result */ }
}

export function createSettingsSaveFeedback(emit: (tone: "success" | "danger", title: string, description: string) => string, dismiss: (id: string) => void) {
  const seen = new Set<string>();
  const active = new Set<string>();
  const unknown = new Map<string, string>();
  const attempt = (receipt: UnconfirmedSettingsSave): string => `${receipt.actorId}:${receipt.kind}:${receipt.commandId}`;
  const settleUnknown = (receipt: UnconfirmedSettingsSave): void => {
    const key = attempt(receipt);
    const id = unknown.get(key);
    if (id === undefined) return;
    unknown.delete(key);
    active.delete(id);
    try { dismiss(id); } catch { /* command feedback remains separate from delivery */ }
  };
  return {
    reset() { for (const id of active) dismiss(id); active.clear(); unknown.clear(); seen.clear(); },
    publish(receipt: ConfirmedSettingsSave, actorId: string): "delivered" | "duplicate" | "stale" | "delivery-failed" {
      if (receipt.actorId !== actorId) return "stale";
      const key = `${receipt.actorId}:${receipt.kind}:${receipt.commandId}:saved`;
      if (seen.has(key)) return "duplicate";
      const title = receipt.replayed ? "Already saved" : "Saved";
      const description = receipt.kind === "ordinary" ? "Settings saved." : receipt.kind === "protected" ? "Credential settings saved." : "Provider keys saved.";
      try { active.add(emit("success", title, description)); }
      catch { return "delivery-failed"; }
      settleUnknown(receipt);
      seen.add(key);
      return "delivered";
    },
    publishRefusal(receipt: DefinitiveSettingsRefusal, actorId: string): "delivered" | "duplicate" | "stale" | "delivery-failed" {
      if (receipt.actorId !== actorId) return "stale";
      const key = `${receipt.actorId}:${receipt.kind}:${receipt.commandId}:${receipt.outcome}`;
      if (seen.has(key)) return "duplicate";
      const subject = receipt.kind === "ordinary" ? "Settings" : receipt.kind === "protected" ? "Credentials" : "Provider keys";
      const title = receipt.outcome === "conflict" ? `${subject} changed` : `${subject} not saved`;
      const description = receipt.outcome === "conflict"
        ? "Current saved values changed. Review your retained edit before retrying."
        : "The save was refused. Review your retained edit before retrying.";
      try { active.add(emit("danger", title, description)); }
      catch { return "delivery-failed"; }
      settleUnknown(receipt);
      seen.add(key);
      return "delivered";
    },
    publishUnconfirmed(receipt: UnconfirmedSettingsSave, actorId: string): "delivered" | "duplicate" | "stale" | "delivery-failed" {
      if (receipt.actorId !== actorId) return "stale";
      const key = `${attempt(receipt)}:unconfirmed`;
      if (seen.has(key)) return "duplicate";
      const description = receipt.kind === "ordinary" ? "Settings save could not be confirmed. Use the existing recovery control."
        : receipt.kind === "protected" ? "Credential save could not be confirmed. Use the existing recovery control."
          : "Provider key save could not be confirmed. Use the existing recovery control.";
      try {
        const id = emit("danger", "Save unconfirmed", description);
        active.add(id);
        unknown.set(attempt(receipt), id);
      } catch { return "delivery-failed"; }
      seen.add(key);
      return "delivered";
    },
  };
}
