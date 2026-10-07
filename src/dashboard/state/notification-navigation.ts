import type { NotificationTarget } from "../../models/notifications/notifications.js";
export type OpenNotification = (id: string, opened: () => void, refused: (message: string) => void) => void;
export function createNotificationNavigationIdentity(route: object, client: object) {
  let currentRoute = route, currentClient = client, context = 0, selection = 0;
  return {
    update(nextRoute: object, nextClient: object) {
      if (nextRoute !== currentRoute || nextClient !== currentClient) {
        currentRoute = nextRoute; currentClient = nextClient; context += 1;
      }
    },
    start() { selection += 1; return { context, selection }; },
    isCurrent(token: { context: number; selection: number }) { return token.context === context && token.selection === selection; },
  };
}
/** The second lookup runs only after Settings accepts leaving its draft. */
export async function navigateNotification(input: {
  lookup(): Promise<NotificationTarget>;
  guard(proceed: () => void): void;
  open(target: Exclude<NotificationTarget, { kind: "refused" }>): void;
  refused(message: string): void;
  isCurrent?(): boolean;
}): Promise<void> {
  const refuse = () => { if (input.isCurrent?.() !== false) input.refused("Notification destination is unavailable. Refresh the inbox and try again."); };
  try {
    const first = await input.lookup();
    if (input.isCurrent?.() === false) return;
    if (first.kind === "refused") { input.refused(`Cannot open notification: ${first.reason}.`); return; }
    input.guard(() => {
      if (input.isCurrent?.() === false) return;
      void input.lookup().then(current => {
        if (input.isCurrent?.() === false) return;
        if (current.kind === "refused") { input.refused(`Cannot open notification: ${current.reason}.`); return; }
        if (JSON.stringify(first) !== JSON.stringify(current)) { input.refused("Notification destination changed. Open it again to use its current location."); return; }
        input.open(current);
      }, refuse);
    });
  } catch { refuse(); }
}
