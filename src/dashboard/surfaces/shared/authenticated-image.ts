import { useEffect, useState } from "react";
import { useOptionalDashboardClient } from "../../state/client-context.js";

export type AuthenticatedImage = Readonly<{ src: string | undefined; failed: boolean }>;
type Settled = Readonly<{ source: string; attempt: number; url?: string; failed?: true }>;

const PROTECTED = /^\/(?:api\/v1|artifacts)\//u;

function isProtected(url: URL): boolean {
  return PROTECTED.test(url.pathname) && url.protocol !== "data:" && url.protocol !== "blob:";
}

/** Protected dashboard images use authenticated object URLs. Other valid URLs pass through. */
export function useAuthenticatedImage(source: string, attempt = 0): AuthenticatedImage {
  const client = useOptionalDashboardClient();
  const parsed = URL.parse(source, "http://dashboard.invalid");
  const fetched = client !== undefined && parsed !== null && isProtected(parsed);
  const [settled, setSettled] = useState<Settled>();
  useEffect(() => {
    if (!fetched) return;
    const controller = new AbortController();
    let held: { release(): void } | undefined;
    client.fetchAuthenticatedResource(source, controller.signal).then(resource => {
      if (controller.signal.aborted) { resource.release(); return; }
      held = resource;
      setSettled({ source, attempt, url: resource.url });
    }, () => { if (!controller.signal.aborted) setSettled({ source, attempt, failed: true }); });
    return () => { controller.abort(); held?.release(); };
  }, [client, fetched, source, attempt]);
  if (parsed === null) return { src: undefined, failed: true };
  if (!fetched) return { src: source, failed: false };
  if (settled?.source !== source || settled.attempt !== attempt) return { src: undefined, failed: false };
  return { src: settled.url, failed: settled.failed === true };
}
