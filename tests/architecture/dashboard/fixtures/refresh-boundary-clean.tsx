/**
 * Clean fixture for `dashboard-refresh-boundary.test.ts` — everything a surface
 * module MAY export: components (declared, wrapped, re-exported) and types. The
 * module-private hook and constant are the shape the rule asks for when a
 * surface needs them and no `-model.ts` sibling exists yet.
 */
import { memo, forwardRef, useState, type ReactElement } from "react";

export type SurfaceProps = { label: string };
export interface SurfaceHandle { focus(): void }

const TONE: Record<string, string> = { a: "b" };

function useThing(): number {
  const [n] = useState(0);
  return n;
}

export function Surface({ label }: SurfaceProps): ReactElement {
  return <div className={TONE.a}>{label}{useThing()}</div>;
}

export const MemoSurface = memo(Surface);

export const RefSurface = forwardRef<HTMLDivElement, SurfaceProps>(function RefSurface({ label }, ref) {
  return <div ref={ref}>{label}</div>;
});

export const ArrowSurface = ({ label }: SurfaceProps): ReactElement => <span>{label}</span>;

function Hidden(): ReactElement {
  return <i />;
}

export { Hidden as Exposed };
export type { ReactElement as SurfaceElement };
