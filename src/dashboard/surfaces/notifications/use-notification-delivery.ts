import { useNotificationClient } from "./notification-client.js";
import { useEffect, useRef, useState } from "react";
import type { NotificationWire } from "../../../domain/dashboard/projection.js";
import { browserNotificationPlatform, createNotificationDelivery, type NotificationDeliveryState } from "./notification-delivery.js";
export function useNotificationDelivery(rows: readonly NotificationWire[], connected: boolean) {
  const client = useNotificationClient();
  const [state, setState] = useState<NotificationDeliveryState>("off");
  const controller = useRef<ReturnType<typeof createNotificationDelivery> | undefined>(undefined);
  useEffect(() => {
    const delivery = createNotificationDelivery(browserNotificationPlatform(() => client.notificationSnapshot()), setState);
    controller.current = delivery;
    return () => { delivery.close(); controller.current = undefined; };
  }, [client]);
  useEffect(() => { controller.current?.update(rows, connected); }, [rows, connected, state]);
  return { state, enable: () => { void controller.current?.enable(); } };
}
export const NOTIFICATION_DELIVERY_LABELS: Record<NotificationDeliveryState, string> = {
  off: "Desktop pings off", requesting: "Waiting for permission", "permission-default": "Permission not granted", "permission-denied": "Blocked in browser settings", unsupported: "Desktop pings unavailable in this browser", standby: "Desktop pings enabled in another tab", active: "Desktop pings enabled", "delivery-failed": "Desktop delivery failed; notifications remain in the inbox",
};
