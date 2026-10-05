import { useEffect, useMemo, useState } from "react";
import type { CalendarWire } from "../../../domain/dashboard/calendar.js";
import { protocolError } from "../../client/errors.js";
import { useDashboardClient } from "../../state/client-context.js";
import { LOADING, observeAsyncResource, type AsyncResource } from "../../state/async-resource.js";

/** Month browsing and day navigation share a request, never an old resource label. */
export function useCalendar(month: string, day: string | undefined, today: string, revision?: object, attempt = 0): AsyncResource<CalendarWire> {
  const client = useDashboardClient();
  const request = useMemo(() => ({ month, day, today, revision, client, attempt }), [month, day, today, revision, client, attempt]);
  const [settled, setSettled] = useState<{ request: typeof request; value: AsyncResource<CalendarWire> }>();
  useEffect(() => {
    if (day === undefined) return;
    return observeAsyncResource(async () => {
      const wire = await client.calendar({ month, day });
      if (wire.month !== month || wire.day !== day) throw protocolError("calendar-request-identity-mismatch");
      return wire;
    }, value => setSettled({ request, value }));
  }, [request, client, month, day]);
  return settled?.request === request ? settled.value : LOADING;
}
