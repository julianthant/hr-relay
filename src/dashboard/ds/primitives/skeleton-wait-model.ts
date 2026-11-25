import { useEffect, useState } from "react";

/** How long a read may wait before its placeholder shows; faster reads render their data with no skeleton frame. */
export const SKELETON_WAIT_MS = 300;

/** True for the first SKELETON_WAIT_MS after mount. The placeholder stays mounted and keeps its size, so the
 * page does not move and startup still counts it as loading; it is only invisible while this is true. */
export function useSkeletonWait(): boolean {
  const [waiting, setWaiting] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setWaiting(false), SKELETON_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);
  return waiting;
}
