import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import './sheets-v2.css';

const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'off';

/** Swaps `children` when `id` changes: the old pane slides out and the new one in, toward higher `index`es from the right. The height eases to the new pane's. */
export function Slide({ id, index, children, className = '' }: { id: string; index: number; children: ReactNode; className?: string }) {
  const last = useRef({ id, index, node: children });
  const pane = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState<{ node: ReactNode; forward: boolean }>();
  const [entering, setEntering] = useState<boolean>();
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const before = last.current;
    if (before.id === id) return;
    if (!still()) { const forward = index > before.index; setLeaving({ node: before.node, forward }); setEntering(forward); }
    const timer = setTimeout(() => { setLeaving(undefined); setEntering(undefined); }, 200);
    return () => clearTimeout(timer);
  }, [id, index]);
  useEffect(() => { last.current = { id, index, node: children }; });
  useLayoutEffect(() => {
    const element = pane.current; if (!element) return;
    setHeight(element.offsetHeight);
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight)); observer.observe(element); return () => observer.disconnect();
  }, [id]);
  return <div className={`sv2-height relative overflow-hidden ${className}`} style={height === undefined ? undefined : { height }}>
    <div ref={pane} key={id} className={entering === undefined ? '' : entering ? 'sv2-in-right' : 'sv2-in-left'}>{children}</div>
    {leaving && <div aria-hidden inert className={`absolute inset-x-0 top-0 ${leaving.forward ? 'sv2-out-left' : 'sv2-out-right'}`}>{leaving.node}</div>}
  </div>;
}
