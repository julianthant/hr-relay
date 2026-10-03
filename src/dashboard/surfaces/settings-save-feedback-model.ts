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

export function deliverDefinitiveSettingsRefusal(
  callback: ((receipt: DefinitiveSettingsRefusal) => void) | undefined,
  receipt: DefinitiveSettingsRefusal,
): void {
  try { callback?.(receipt); } catch { /* feedback delivery cannot change the command result */ }
}

export function createSettingsSaveFeedback(emit: (tone: "success" | "danger", title: string, description: string) => string, dismiss: (id: string) => void) {
  const seen = new Set<string>();
  const active = new Set<string>();
  return {
    reset() { for (const id of active) dismiss(id); active.clear(); seen.clear(); },
    publish(receipt: ConfirmedSettingsSave, actorId: string): "delivered" | "duplicate" | "stale" | "delivery-failed" {
      if (receipt.actorId !== actorId) return "stale";
      const key = `${receipt.actorId}:${receipt.kind}:${receipt.commandId}:saved`;
      if (seen.has(key)) return "duplicate";
      const title = receipt.replayed ? "Already saved" : "Saved";
      const description = receipt.kind === "ordinary" ? "Settings saved." : receipt.kind === "protected" ? "Credential settings saved." : "Provider keys saved.";
      try { active.add(emit("success", title, description)); }
      catch { return "delivery-failed"; }
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
      seen.add(key);
      return "delivered";
    },
  };
}
