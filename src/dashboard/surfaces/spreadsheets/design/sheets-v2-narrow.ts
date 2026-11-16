import { useEffect, useRef, useState } from 'react';

/** Download folds into the ⋯ menu when the list is narrower than this. */
const NARROW_BELOW = 760;
export function useNarrow<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const element = ref.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < NARROW_BELOW));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  return [ref, narrow] as const;
}
