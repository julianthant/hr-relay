import { useEffect, useState } from "react";

export function useDelayedLoading(missing: boolean): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!missing) return;
    const timer = setTimeout(() => setElapsed(true), 150);
    return () => clearTimeout(timer);
  }, [missing]);
  useEffect(() => { if (!missing) setElapsed(false); }, [missing]);
  return missing && elapsed;
}
