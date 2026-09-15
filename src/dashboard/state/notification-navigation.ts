import type { NotificationTarget } from "../../domain/notifications.js";
export type OpenNotification = (id: string, opened: () => void, refused: (message: string) => void) => void;
/** The second lookup runs only after Settings accepts leaving its draft. */
export async function navigateNotification(input: {
  lookup(): Promise<NotificationTarget>;
  guard(proceed: () => void): void;
  open(target: Exclude<NotificationTarget, { kind: "refused" }>): void;
  refused(message: string): void;
}): Promise<void> {
  const refuse = () => input.refused("Notification destination is unavailable. Refresh the inbox and try again.");
  try {
    const first = await input.lookup();
    if (first.kind === "refused") { input.refused(`Cannot open notification: ${first.reason}.`); return; }
    input.guard(() => {
      void input.lookup().then(current => {
        if (current.kind === "refused") { input.refused(`Cannot open notification: ${current.reason}.`); return; }
        if (JSON.stringify(first) !== JSON.stringify(current)) { input.refused("Notification destination changed. Open it again to use its current location."); return; }
        input.open(current);
      }, refuse);
    });
  } catch { refuse(); }
}
