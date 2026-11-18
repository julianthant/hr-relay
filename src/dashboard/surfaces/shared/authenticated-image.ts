import { useEffect, useState } from "react";
import { useOptionalDashboardClient } from "../../state/client-context.js";

export type AuthenticatedImage = Readonly<{ src: string | undefined; failed: boolean }>;
type Settled = Readonly<{ source: string; attempt: number; url?: string; failed?: true }>;

const PROTECTED = /^\/(?:api\/v1|artifacts)\//u;

function isProtected(source: string): boolean {
  try { return PROTECTED.test(new URL(source, "http://dashboard.invalid").pathname) && !/^(?:data|blob):/iu.test(source); }
  catch { return false; }
}

/** Resolve an image URL to something an `<img>` can load: protected dashboard resources go through the authenticated fetch as an object URL, anything else passes through. */
export function useAuthenticatedImage(source: string, attempt = 0): AuthenticatedImage {
  const client = useOptionalDashboardClient();
  const fetched = client !== undefined && isProtected(source);
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
  if (!fetched) return { src: source, failed: false };
  if (settled?.source !== source || settled.attempt !== attempt) return { src: undefined, failed: false };
  return { src: settled.url, failed: settled.failed === true };
}
