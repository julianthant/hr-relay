export type ConfirmedSettingsSave = Readonly<{
  actorId: string;
  commandId: string;
  kind: "ordinary" | "protected" | "provider-key";
  replayed: boolean;
}>;

export function createSettingsSaveFeedback(emit: (title: string, description: string) => string, dismiss: (id: string) => void) {
  const seen = new Set<string>();
  const active = new Set<string>();
  return {
    reset() { for (const id of active) dismiss(id); active.clear(); seen.clear(); },
    publish(receipt: ConfirmedSettingsSave, actorId: string): "delivered" | "duplicate" | "stale" | "delivery-failed" {
      if (receipt.actorId !== actorId) return "stale";
      const key = `${receipt.actorId}:${receipt.kind}:${receipt.commandId}`;
      if (seen.has(key)) return "duplicate";
      const title = receipt.replayed ? "Already saved" : "Saved";
      const description = receipt.kind === "ordinary" ? "Settings saved." : receipt.kind === "protected" ? "Credential settings saved." : "Provider keys saved.";
      try { active.add(emit(title, description)); }
      catch { return "delivery-failed"; }
      seen.add(key);
      return "delivered";
    },
  };
}
